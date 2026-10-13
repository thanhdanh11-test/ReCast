"""Read-only original scene: annotations, vector map and measured static geometry."""

import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from topeye.core.adapters.base import DatasetError
from topeye.scenario.extract import raw_scene
from topeye.scenario.models import require, samples
from topeye.scenario.presentation import build_presentation, estimate_ground


def map_directory():
    return Path(__file__).resolve().parents[2] / "data/scenario/maps"


def vector_map(path, origin, bounds):
    data = json.loads(path.read_text())
    nodes = {r["token"]: np.array([r["x"], r["y"]]) - origin[:2] for r in data["node"]}
    polygons = {r["token"]: r for r in data["polygon"]}
    lines = {r["token"]: r for r in data["line"]}
    low, high = np.array(bounds[:2]), np.array(bounds[2:])

    def coords(tokens):
        return np.array([nodes[t] for t in tokens])

    def intersects(points):
        return (
            len(points) > 1
            and (points.max(axis=0) >= low).all()
            and (points.min(axis=0) <= high).all()
        )

    out, strokes = [], []
    seen = set()
    for kind in ("drivable_area", "road_segment", "lane", "walkway", "ped_crossing", "stop_line"):
        for row in data.get(kind, []):
            for token in row.get("polygon_tokens", [row.get("polygon_token")]):
                if not token or (kind, token) in seen:
                    continue
                seen.add((kind, token))
                poly = polygons[token]
                outer = coords(poly["exterior_node_tokens"])
                if intersects(outer):
                    out.append(
                        {
                            "kind": kind,
                            "outer": outer.tolist(),
                            "holes": [
                                coords(h["node_tokens"]).tolist() for h in poly.get("holes", [])
                            ],
                        }
                    )
    for kind in ("road_divider", "lane_divider"):
        for row in data.get(kind, []):
            line = coords(lines[row["line_token"]]["node_tokens"])
            if intersects(line):
                strokes.append({"kind": kind, "points": line.tolist()})
    return out, strokes


_KEY_BITS = 21  # per axis; 0.3 m voxels span ±314 km before overflow
_KEY_OFFSET = 1 << (_KEY_BITS - 1)


def _unique_rows(cells, return_inverse=False):
    """`np.unique(cells, axis=0)` for int rows of ≤3 columns via one monotone int64 key.

    Same lexicographic order and inverse as the row-wise unique, without its structured-array cost.
    """
    cells = np.asarray(cells, dtype=np.int64)
    if not len(cells):
        empty = np.empty((0, cells.shape[1]), dtype=np.int32)
        return (empty, np.empty(0, dtype=np.int64)) if return_inverse else empty
    if cells.min() < -_KEY_OFFSET or cells.max() >= _KEY_OFFSET:
        raise DatasetError("Static point cloud exceeds supported coordinate range")
    key = np.zeros(len(cells), dtype=np.int64)
    for column in range(cells.shape[1]):
        key = (key << _KEY_BITS) | (cells[:, column] + _KEY_OFFSET)
    _, first, inverse = np.unique(key, return_index=True, return_inverse=True)
    rows = cells[first].astype(np.int32)
    return (rows, inverse) if return_inverse else rows


def static_environment(adapter, scene, origin, progress):
    # Keyframes have exact annotations: mask ALL labelled boxes before fitting static structures.
    from topeye.sim.procedural_layout import (
        building_footprints,
        classify_static,
        pole_instances,
        vegetation_instances,
    )

    record = adapter._scene(scene)[0]
    frames = adapter.frames(scene)
    scene_shift = adapter.scene_origin(scene) - origin

    def sweep(frame):
        points = adapter.load_points(frame)[:, :3]
        keep = np.linalg.norm(points[:, :2], axis=1) > 3
        boxes = adapter.mask_boxes(frame) or []
        if boxes:
            # Only points within each box's bounding radius can be inside it; test those exactly.
            tree = cKDTree(points[:, :2])
            radii = [np.hypot(b.l / 2 + 0.4, b.w / 2 + 0.4) + 1e-6 for b in boxes]
            for box, candidates in zip(
                boxes,
                (tree.query_ball_point([b.cx, b.cy], r) for b, r in zip(boxes, radii)),
            ):
                if not candidates:
                    continue
                idx = np.asarray(candidates)
                delta = points[idx] - [box.cx, box.cy, box.cz]
                c, s = np.cos(box.yaw), np.sin(box.yaw)
                inside = (
                    (np.abs(delta[:, 0] * c + delta[:, 1] * s) < box.l / 2 + 0.4)
                    & (np.abs(-delta[:, 0] * s + delta[:, 1] * c) < box.w / 2 + 0.4)
                    & (np.abs(delta[:, 2]) < box.h / 2 + 0.4)
                )
                keep[idx[inside]] = False
        local = points[keep] @ frame.T_world_lidar[:3, :3].T + frame.T_world_lidar[:3, 3]
        local += scene_shift
        # Voxelize each frame first to bound memory without density bias.
        return _unique_rows(np.floor(local / 0.3).astype(np.int32)) * 0.3 + 0.15

    # Sweeps are independent and numpy/scipy release the GIL; map keeps frame order.
    gathered, sweep_ids = [], []
    pool = ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 1))
    try:
        for i, local in enumerate(pool.map(sweep, frames)):
            progress("Đang dựng nhà/cây từ LiDAR", i, len(frames))
            gathered.append(local)
            sweep_ids.append(np.full(len(local), i, dtype=np.int32))
    finally:
        # A cancel raised by progress must not wait for the remaining sweeps.
        pool.shutdown(cancel_futures=True)
    if not gathered:
        raise DatasetError("Missing LiDAR keyframes")
    xyz = np.concatenate(gathered)
    ids = np.concatenate(sweep_ids)
    ground_samples = estimate_ground(xyz, ids)
    cells, inverse = _unique_rows(np.floor(xyz / 0.3).astype(np.int32), return_inverse=True)
    pairs = _unique_rows(np.column_stack((inverse, ids)))
    support = np.bincount(pairs[:, 0], minlength=len(cells))
    xyz = (cells[support >= 2] + 0.5) * 0.3
    if not len(xyz):
        return [], [], [], {"static_points": 0, "keyframes": len(frames)}
    labels = classify_static(xyz, np.zeros(len(xyz), dtype=np.int32))
    bounds = [*xyz[:, :2].min(axis=0), *xyz[:, :2].max(axis=0)]
    buildings = building_footprints(xyz, labels, bounds)
    for building in buildings:
        # Existing research helper extrapolates floors; source viewer uses observed height only.
        building["height"] = max(0.5, building["observed_top_z"] - building["base_z"])
        building["height_source"] = "LiDAR observed extent; footprint simplified/estimated"
    return (
        buildings,
        vegetation_instances(xyz, labels),
        pole_instances(xyz, labels),
        {
            "static_points": len(xyz),
            "keyframes": len(frames),
            "scene_token": record["token"],
            "ground_samples": ground_samples,
        },
    )


def source_scene(adapter, scene, progress=lambda *args: None):
    require(isinstance(scene, str), "Invalid scene")
    t0, ego, tracks = raw_scene(adapter, scene, all_categories=True)
    # Display keyframe interval, including objects with a single observation.
    duration = (
        max(s["timestamp"] for s in adapter._samples[adapter._scene(scene)[0]["token"]]) / 1e6
        - t0 / 1e6
    )
    origin = ego[np.argmin(np.abs(ego[:, 0])), 1:4].copy()
    attrs_path = adapter._path(f"{adapter.version}/attribute.json")
    attributes = (
        {r["token"]: r["name"] for r in json.loads(attrs_path.read_text())}
        if attrs_path.exists()
        else {}
    )
    attrs = {}
    for a in adapter.tables["sample_annotation"].values():
        if a["instance_token"] in tracks:
            attrs.setdefault(a["instance_token"], set()).update(
                attributes.get(t, t) for t in a.get("attribute_tokens", [])
            )
    actors = []
    for token, tr in [
        (None, {"rows": ego, "sizes": [[1.85, 4.5, 1.6]], "category": "vehicle.car"}),
        *tracks.items(),
    ]:
        values = tr["rows"].copy()
        values[:, 1:4] -= origin
        values = values[(values[:, 0] >= 0) & (values[:, 0] <= duration + 1e-6)]
        if not len(values):
            continue
        size = np.median(tr["sizes"], axis=0)
        actors.append(
            {
                "id": "ego" if token is None else token,
                "instance_token": token,
                "role": "ego" if token is None else "traffic",
                "category": tr["category"],
                "length_m": float(size[1]),
                "width_m": float(size[0]),
                "height_m": float(size[2]),
                "attributes": sorted(attrs.get(token, [])),
                "samples": samples(values, values[:, 0]),
            }
        )
    environment = {
        "polygons": [],
        "lines": [],
        "buildings": [],
        "trees": [],
        "poles": [],
        "warnings": [],
        "provenance": [
            "Participants: original sample_annotation/ego_pose",
            "Structures: masked keyframe LiDAR; simplified estimated footprints",
            "Rear lights: red material only, no measured brake state",
        ],
    }
    map_info = adapter.scene_map(scene)
    xy = ego[:, 1:3] - origin[:2]
    bounds = [*(xy.min(axis=0) - 60), *(xy.max(axis=0) + 60)]
    if map_info and hasattr(adapter, "vector_map"):
        environment["polygons"], environment["lines"] = adapter.vector_map(scene, origin, bounds)
        environment["provenance"][0] = "Argoverse 2: annotations.feather and exact city_SE3_egovehicle poses"
        environment["provenance"].append("Argoverse 2 Sensor: per-log vector map")
    elif map_info:
        candidates = [
            adapter.root / "maps/expansion" / f"{map_info[0]}.json",
            map_directory() / f"{map_info[0]}.json",
        ]
        path = next((p for p in candidates if p.is_file()), None)
        if path:
            environment["polygons"], environment["lines"] = vector_map(path, origin, bounds)
            environment["provenance"].append(f"nuScenes expansion: {map_info[0]}")
    if not environment["polygons"]:
        environment["warnings"].append("Thiếu vector map: chưa dựng được đường/vạch chính xác.")
    try:
        b, t, p, stats = static_environment(adapter, scene, origin, progress)
    except DatasetError as exc:
        b, t, p, stats = [], [], [], {"complete": False}
        environment["warnings"].append(f"Môi trường LiDAR chưa đầy đủ: {exc}")
    ground_samples = stats.pop("ground_samples", [])
    environment.update(buildings=b, trees=t, poles=p, stats=stats)
    environment["presentation"] = build_presentation(environment, actors, bounds, ground_samples)
    if not b:
        environment["warnings"].append("LiDAR chưa đủ mặt đứng để dựng nhà ở cảnh này.")
    return {
        "id": uuid.uuid4().hex,
        "mode": "source",
        "interval_s": [0, duration],
        "actors": actors,
        "source": {
            "scene": scene,
            "selected_interval_s": [0, duration],
            "origin_global_m": origin.tolist(),
            "t0_us": int(t0),
            "bounds_m": list(map(float, bounds)),
            "dataset_version": adapter.version,
        },
        "road": {"kind": "source_map"},
        "environment": environment,
    }
