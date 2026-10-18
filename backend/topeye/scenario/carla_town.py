"""A CARLA town recording as a nuScenes-format dataset (plan56, 01-CONTRACTS).

`scripts/carla_record_scene.py` records one clip in CARLA (map lanes, ego, traffic, LiDAR) in the town's
OpenDRIVE frame. `build_dataset` writes the same clip as nuScenes v1.0-mini tables, LiDAR .bin files and a
map-expansion JSON, so the app reads it with its unchanged nuScenes adapter. The map location is
`carla-<Town>`; CARLA export uses it to load the town itself (see export_job.carla_town_of).
"""

import hashlib
import json
import math
import shutil
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import unary_union

from topeye.scenario.models import ScenarioError, require

VERSION = "v1.0-mini"
T0_US = 1_700_000_000_000_000
LOCATION_PREFIX = "carla-"
# nuScenes-style 1x1 PNG: the adapter only checks that the semantic-prior raster file exists.
PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)
BROKEN = {"Broken", "BrokenBroken", "BottsDots"}
SOLID = {"Solid", "SolidSolid", "SolidBroken", "BrokenSolid"}
WALKABLE = {"Sidewalk"}
DRIVABLE_EXTRA = {"Shoulder", "Parking", "Bidirectional", "Biking"}


# App physics (reactive.MAX_ACCEL, MAX_DECEL, HEAVY_MAX_DECEL) minus a margin: Traffic Manager sometimes jerks a
# vehicle harder than any driver; those moments are cut from the dataset like nuScenes label errors (plan56 D7).
ACCEL_LIMIT, DECEL_LIMIT, HEAVY_DECEL_LIMIT = 3.5, 7.5, 4.5
HEAVY = ("vehicle.bus", "vehicle.truck", "vehicle.trailer", "vehicle.construction")
CUT_S = 0.5  # s cut on each side of a violation: keyframes are 0.5 s apart and the app interpolates between them


def clean_tracks(actors, dt):
    """Tracks split where the vehicle left the recorded radius, and cut around physically implausible moments.

    Pieces keep the vehicle's category and size; the first keeps its id, the next ones get `<id>~<n>`.
    """
    out = {}
    for actor_id, track in actors.items():
        rows = sorted(track["rows"], key=lambda r: r[0])
        heavy = track["category"].startswith(HEAVY)
        t = np.array([r[0] for r in rows])
        xy = np.array([[r[1], r[2]] for r in rows])
        keep = np.ones(len(rows), bool)
        if len(rows) >= 5:
            v = np.full(len(rows), np.nan)
            v[1:-1] = np.linalg.norm(xy[2:] - xy[:-2], axis=1) / np.maximum(t[2:] - t[:-2], 1e-9)
            a = np.full(len(rows), np.nan)
            a[2:-2] = (v[3:-1] - v[1:-3]) / np.maximum(t[3:-1] - t[1:-3], 1e-9)
            contiguous = np.zeros(len(rows), bool)
            contiguous[2:-2] = (t[4:] - t[:-4]) < 4.5 * dt
            bad = contiguous & ((a > ACCEL_LIMIT) | (a < -(HEAVY_DECEL_LIMIT if heavy else DECEL_LIMIT)))
            for tb in t[bad]:
                keep &= np.abs(t - tb) > CUT_S
        pieces, current = [], []
        for i, row in enumerate(rows):
            if not keep[i] or (current and row[0] - current[-1][0] > 1.5 * dt):
                if len(current) >= 2:
                    pieces.append(current)
                current = []
            if keep[i]:
                current.append(row)
        if len(current) >= 2:
            pieces.append(current)
        for n, piece in enumerate(pieces):
            out[actor_id if n == 0 else f"{actor_id}~{n}"] = {**track, "rows": piece}
    return out


def _token(*parts):
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()


def _quat(yaw):
    return [math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2)]


def _parts(geom):
    """Valid polygons of a (multi)polygon, largest first; empty or degenerate parts dropped."""
    geom = geom.buffer(0)
    parts = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    return sorted((p for p in parts if isinstance(p, Polygon) and p.is_valid and p.area > 0.05), key=lambda p: -p.area)


def _lane_polygon(lane):
    ring = [*lane["left"], *reversed(lane["right"])]
    return Polygon(ring) if len(ring) >= 4 else Polygon()


class _MapWriter:
    """nuScenes map-expansion layers built from polygons and polylines."""

    def __init__(self):
        self.data = {"version": "1.3", "node": [], "line": [], "polygon": [], "drivable_area": [], "road_segment": [],
                     "road_block": [], "lane": [], "ped_crossing": [], "walkway": [], "stop_line": [], "carpark_area": [],
                     "road_divider": [], "lane_divider": [], "traffic_light": [], "lane_connector": [], "arcline_path_3": {},
                     "connectivity": {}}

    def _nodes(self, coords, key):
        tokens = []
        for i, (x, y) in enumerate(coords):
            t = _token("node", key, i)
            self.data["node"].append({"token": t, "x": round(float(x), 3), "y": round(float(y), 3)})
            tokens.append(t)
        return tokens

    def polygon(self, poly, key):
        token = _token("polygon", key)
        self.data["polygon"].append({
            "token": token,
            "exterior_node_tokens": self._nodes(list(poly.exterior.coords)[:-1], key + "/x"),
            "holes": [{"node_tokens": self._nodes(list(h.coords)[:-1], f"{key}/h{i}")} for i, h in enumerate(poly.interiors)],
        })
        return token

    def line(self, coords, key):
        token = _token("line", key)
        self.data["line"].append({"token": token, "node_tokens": self._nodes(coords, key)})
        return token


def build_map(raw_map):
    """Map-expansion dict: drivable area, lanes, walkways, crosswalks and lane/road dividers."""
    m = _MapWriter()
    driving, drivable = [], []
    for lane in raw_map.get("lanes", []):
        kind = lane["type"]
        parts = _parts(_lane_polygon(lane))
        if not parts:
            continue
        if kind == "Driving":
            driving.append(lane)
            drivable.extend(parts)
            for i, part in enumerate(parts):
                token = m.polygon(part, f"lane/{lane['id']}/{i}")
                m.data["lane"].append({"token": _token("lane", lane["id"], i), "polygon_token": token, "lane_type": "CAR",
                                       "from_edge_line_token": None, "to_edge_line_token": None,
                                       "left_lane_divider_segments": [], "right_lane_divider_segments": []})
        elif kind in WALKABLE:
            for i, part in enumerate(parts):
                m.data["walkway"].append({"token": _token("walkway", lane["id"], i),
                                          "polygon_token": m.polygon(part, f"walk/{lane['id']}/{i}")})
        elif kind in DRIVABLE_EXTRA:
            drivable.extend(parts)
    for i, ring in enumerate(raw_map.get("crosswalks", [])):
        for j, part in enumerate(_parts(Polygon(ring)) if len(ring) >= 3 else []):
            m.data["ped_crossing"].append({"token": _token("crossing", i, j), "polygon_token": m.polygon(part, f"cross/{i}/{j}")})
    if drivable:
        area = unary_union([p.buffer(0.05) for p in drivable]).buffer(-0.05)
        tokens = [m.polygon(p, f"drivable/{i}") for i, p in enumerate(_parts(area))]
        m.data["drivable_area"].append({"token": _token("drivable"), "polygon_tokens": tokens})
        m.data["road_segment"].extend({"token": _token("segment", t), "polygon_token": t, "is_intersection": False,
                                       "drivable_area_token": _token("drivable")} for t in tokens)
    for lane in driving:
        marking = lane.get("marking_left", "NONE").split(".")[-1]
        layer = "lane_divider" if marking in BROKEN else "road_divider" if marking in SOLID else None
        if layer and len(lane["left"]) >= 2 and LineString(lane["left"]).length > 0.5:
            m.data[layer].append({"token": _token(layer, lane["id"]), "line_token": m.line(lane["left"], f"{layer}/{lane['id']}")})
    xs = [n["x"] for n in m.data["node"]] or [0.0]
    ys = [n["y"] for n in m.data["node"]] or [0.0]
    m.data["canvas_edge"] = [max(xs), max(ys)]
    return m.data


def build_dataset(raw_dir, out_dir, name):
    """Write the nuScenes-format dataset for the recording in raw_dir; returns the dataset root."""
    raw_dir, out = Path(raw_dir), Path(out_dir)
    try:
        raw = json.loads((raw_dir / "raw.json").read_text())
        town, dt, every, ticks = raw["town"], float(raw["dt"]), int(raw["keyframe_every"]), int(raw["ticks"])
        ego_rows, actors, height = raw["ego"], raw["actors"], float(raw["lidar"]["height_m"])
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ScenarioError("DATASET_INVALID", f"Bản ghi CARLA không đọc được: {exc}") from exc
    require(len(ego_rows) == ticks >= 3, "Bản ghi CARLA thiếu tư thế xe ego", "DATASET_INVALID")
    scans = [raw_dir / "lidar" / f"{i:04d}.npy" for i in range(ticks)]
    missing = [p.name for p in scans if not p.is_file()]
    require(not missing, f"Bản ghi CARLA thiếu LiDAR: {', '.join(missing[:3])}", "DATASET_INVALID")

    location = LOCATION_PREFIX + town
    if out.exists():
        shutil.rmtree(out)
    meta = out / VERSION
    for folder in (meta, out / "samples/LIDAR_TOP", out / "sweeps/LIDAR_TOP", out / "maps/expansion"):
        folder.mkdir(parents=True, exist_ok=True)
    (out / "maps/expansion" / f"{location}.json").write_text(json.dumps(build_map(raw.get("map", {}))))
    (out / "maps" / f"{location}.png").write_bytes(PNG_1X1)

    log_token, scene_token = _token("log", name), _token("scene", name)
    sensor_token, calib_token = _token("sensor", "LIDAR_TOP"), _token("calib", name)
    tables = {k: [] for k in ("scene", "sample", "sample_data", "ego_pose", "sample_annotation", "instance", "category")}
    tables["sensor"] = [{"token": sensor_token, "channel": "LIDAR_TOP", "modality": "lidar"}]
    tables["calibrated_sensor"] = [{"token": calib_token, "sensor_token": sensor_token, "translation": [0.0, 0.0, height],
                                    "rotation": [1.0, 0.0, 0.0, 0.0], "camera_intrinsic": []}]
    stamp = [T0_US + round(i * dt * 1e6) for i in range(ticks)]
    keys = list(range(0, ticks, every))
    sample_of = {}
    for n, i in enumerate(keys):
        token = _token("sample", name, i)
        sample_of[i] = token
        tables["sample"].append({"token": token, "timestamp": stamp[i], "scene_token": scene_token,
                                 "prev": _token("sample", name, keys[n - 1]) if n else "",
                                 "next": _token("sample", name, keys[n + 1]) if n + 1 < len(keys) else ""})
    for i, (t, x, y, z, yaw) in enumerate(ego_rows):
        pose = _token("ego_pose", name, i)
        tables["ego_pose"].append({"token": pose, "timestamp": stamp[i], "translation": [x, y, z], "rotation": _quat(yaw)})
        key = i % every == 0
        folder = "samples" if key else "sweeps"
        filename = f"{folder}/LIDAR_TOP/{name}__LIDAR_TOP__{stamp[i]}.pcd.bin"
        points = np.load(scans[i]).astype("<f4").reshape(-1, 4)
        np.hstack([points, np.zeros((len(points), 1), "<f4")]).tofile(out / filename)  # x y z intensity ring
        tables["sample_data"].append({
            "token": _token("sample_data", name, i), "sample_token": sample_of[(i // every) * every],
            "ego_pose_token": pose, "calibrated_sensor_token": calib_token, "timestamp": stamp[i], "fileformat": "pcd",
            "is_key_frame": key, "height": 0, "width": 0, "filename": filename,
            "prev": _token("sample_data", name, i - 1) if i else "", "next": _token("sample_data", name, i + 1) if i + 1 < ticks else ""})
    categories = {}
    for actor_id, track in sorted(clean_tracks(actors, dt).items()):
        by_time = {round(r[0], 3): r for r in track["rows"]}
        rows = [(i, by_time[round(i * dt, 3)]) for i in keys if round(i * dt, 3) in by_time]
        if not rows:
            continue
        category = track["category"]
        cat_token = categories.setdefault(category, _token("category", category))
        instance = _token("instance", name, actor_id)
        anns = [_token("ann", name, actor_id, i) for i, _ in rows]
        for n, (i, (_, x, y, z, yaw)) in enumerate(rows):
            tables["sample_annotation"].append({
                "token": anns[n], "sample_token": sample_of[i], "instance_token": instance, "attribute_tokens": [],
                "visibility_token": "4", "translation": [x, y, z], "size": track["size"], "rotation": _quat(yaw),
                "prev": anns[n - 1] if n else "", "next": anns[n + 1] if n + 1 < len(anns) else "",
                "num_lidar_pts": 1, "num_radar_pts": 0})
        tables["instance"].append({"token": instance, "category_token": cat_token, "nbr_annotations": len(anns),
                                   "first_annotation_token": anns[0], "last_annotation_token": anns[-1]})
    tables["category"] = [{"token": t, "name": c, "description": "CARLA"} for c, t in categories.items()]
    tables["scene"] = [{"token": scene_token, "log_token": log_token, "nbr_samples": len(keys),
                        "first_sample_token": sample_of[keys[0]], "last_sample_token": sample_of[keys[-1]],
                        "name": name, "description": f"CARLA {town}, Traffic Manager traffic, simulated LiDAR"}]
    tables["log"] = [{"token": log_token, "logfile": name, "vehicle": "carla-ego", "date_captured": "2026-10-18", "location": location}]
    tables["map"] = [{"token": _token("map", name), "log_tokens": [log_token], "category": "semantic_prior",
                      "filename": f"maps/{location}.png"}]
    tables["attribute"], tables["visibility"] = [], [{"token": "4", "level": "v80-100", "description": "CARLA"}]
    for table, rows in tables.items():
        (meta / f"{table}.json").write_text(json.dumps(rows))
    return out
