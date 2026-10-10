"""Measured ground support and cosmetic free-space repair; never map authority."""

import math

import numpy as np
from scipy.spatial import cKDTree
from shapely import contains_xy
from shapely.geometry import MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union


def estimate_ground(xyz, sweep_ids=None):
    """Robust low-cell horizontal planes from already multi-sweep-supported points."""
    xyz = np.asarray(xyz, dtype=float)
    if xyz.ndim != 2 or xyz.shape[1] != 3 or not np.isfinite(xyz).all():
        return []
    if not len(xyz):
        return []
    cells, inverse = np.unique(np.floor(xyz[:, :2] / 3).astype(int), axis=0, return_inverse=True)
    order = np.argsort(inverse)
    groups = np.split(order, np.flatnonzero(np.diff(inverse[order])) + 1)
    out = []
    for cell, ids in zip(cells, groups, strict=True):
        points = xyz[ids]
        if sweep_ids is not None and len(np.unique(np.asarray(sweep_ids)[ids])) < 2:
            continue
        if len(points) < 12:
            continue
        low = points[points[:, 2] <= np.quantile(points[:, 2], 0.35)]
        if len(low) < 8:
            continue
        if sweep_ids is not None:
            low_ids = ids[points[:, 2] <= np.quantile(points[:, 2], 0.35)]
            if len(np.unique(np.asarray(sweep_ids)[low_ids])) < 2:
                continue
        center = low[:, :2].mean(axis=0)
        xy = low[:, :2] - center
        if np.linalg.eigvalsh(xy.T @ xy / len(xy))[0] < 0.06:
            continue
        coefficients, _, rank, _ = np.linalg.lstsq(
            np.c_[xy, np.ones(len(xy))], low[:, 2], rcond=None
        )
        residual = float(
            np.quantile(np.abs(np.c_[xy, np.ones(len(xy))] @ coefficients - low[:, 2]), 0.8)
        )
        if rank < 3 or np.linalg.norm(coefficients[:2]) > 0.35 or residual > 0.15:
            continue
        # Center of the measured XY support, not extrapolated to an unobserved cell corner.
        out.append([float(center[0]), float(center[1]), float(coefficients[2]), len(low), residual])
    return out[:20000]


def _parts(geometry):
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    return [p for g in getattr(geometry, "geoms", []) for p in _parts(g)]


def _polygon_record(poly, **extra):
    return {
        "polygon": [list(p) for p in list(poly.exterior.coords)[:-1]],
        "holes": [[list(p) for p in list(r.coords)[:-1]] for r in poly.interiors],
        **extra,
    }


def _actor_box(actor, pose):
    length, width = actor["length_m"] / 2 + 0.45, actor["width_m"] / 2 + 0.45
    c, s = math.cos(pose["yaw_rad"]), math.sin(pose["yaw_rad"])
    return Polygon(
        [
            (pose["x_m"] + c * x - s * y, pose["y_m"] + s * x + c * y)
            for x, y in [(-length, -width), (length, -width), (length, width), (-length, width)]
        ]
    )


def _terrain_spikes(points, reference):
    """Roof/deck/overpass cells can pass the per-cell plane fit; the SPEC slope bound
    |dz| <= 0.35·d + 0.3 is judged LOCALLY against `reference` (rows x, y, z; `points` are its
    first rows) so distant cells cannot vouch for a spike. Neighbours within the 8 m terrain
    kernel: a cell must agree with at least half of them (also rejects 2-cell roof/deck clusters
    amid road). Only 8–20 m neighbours: it must agree with the nearest. None within 20 m: reject
    when > 3 m off the scene median. Rejected areas keep raw/unknown height; nothing is clamped.
    """
    xy, z = reference[:, :2], reference[:, 2]
    tree = cKDTree(xy)
    median = np.median(points[:, 2])
    spike = np.zeros(len(points), dtype=bool)
    for i, neighbours in enumerate(tree.query_ball_point(points[:, :2], 20)):
        neighbours = [j for j in neighbours if j != i]
        if not neighbours:
            spike[i] = abs(points[i, 2] - median) > 3
            continue
        d = np.linalg.norm(xy[neighbours] - xy[i], axis=1)
        ok = np.abs(z[neighbours] - points[i, 2]) <= 0.35 * d + 0.3
        local = d <= 8
        spike[i] = 2 * ok[local].sum() < local.sum() if local.any() else not ok[np.argmin(d)]
    return spike


def build_presentation(environment, actors, bounds, ground_samples):
    envelope = box(*bounds)
    surfaces, free, diagnostics = [], [], []
    for index, record in enumerate(environment["polygons"]):
        poly = Polygon(record["outer"], record["holes"])
        if not poly.is_valid or poly.area < 1e-8:
            diagnostics.append(
                f"polygon {index} ({record['kind']}): invalid source surface omitted"
            )
            continue
        poly = poly.intersection(envelope)
        for part in _parts(poly):
            if part.area < 1e-8:
                continue
            r = _polygon_record(part)
            if record["kind"] not in {"drivable_area", "road_segment", "lane"}:
                surfaces.append(
                    {"kind": record["kind"], "outer": r["polygon"], "holes": r["holes"]}
                )
        if record["kind"] in {"drivable_area", "road_segment", "lane"}:
            free.append(poly)
    # One common road support mesh: overlapping lane/segment fills must not fight at different tessellations.
    for part in _parts(unary_union(free)):
        r = _polygon_record(part)
        surfaces.append({"kind": "drivable_area", "outer": r["polygon"], "holes": r["holes"]})
    corridors = []
    for actor in actors:
        if not actor["category"].startswith("vehicle."):
            continue
        previous, previous_time = None, None
        for pose in actor["samples"]:
            current = _actor_box(actor, pose)
            corridors.append(current)
            if previous is not None and 0 < pose["t_s"] - previous_time <= 1:
                corridors.append(unary_union([previous, current]).convex_hull)
            previous, previous_time = current, pose["t_s"]
    clear = unary_union(free + corridors).intersection(envelope)
    buildings, changed = [], 0
    for record in environment["buildings"]:
        poly = Polygon(record["polygon"])
        if not poly.is_valid:
            poly = poly.convex_hull  # Same cosmetic conservative enclosure as the prior renderer.
        visible = poly.intersection(envelope)
        trimmed = visible.difference(clear)
        if visible.area - trimmed.area > 1e-6:
            changed += 1
        for part in _parts(trimmed):
            if part.area >= 0.5:
                buildings.append(
                    _polygon_record(part, base_z=record["base_z"], height=record["height"])
                )
    if changed:
        diagnostics.append(
            f"Trimmed {changed} estimated buildings against observed vehicle free space; raw map unchanged"
        )
    # Estimated vegetation/poles whose base lies well inside the road (beyond map-edge
    # tolerance) or on an observed vehicle footprint are LiDAR misclassifications for display.
    road = unary_union(free)
    tree_blocked = unary_union([road.buffer(-0.3), *corridors])
    pole_blocked = unary_union([road.buffer(-0.5), *corridors])
    trees = [
        t for t in environment.get("trees", []) if not tree_blocked.covers(Point(t["x"], t["y"]))
    ]
    poles = [
        p for p in environment.get("poles", []) if not pole_blocked.covers(Point(p["x"], p["y"]))
    ]
    omitted_trees = len(environment.get("trees", [])) - len(trees)
    omitted_poles = len(environment.get("poles", [])) - len(poles)
    if omitted_trees or omitted_poles:
        diagnostics.append(
            f"Omitted {omitted_trees} estimated trees and {omitted_poles} poles on the road "
            "or observed vehicle paths; raw estimates unchanged"
        )
    covered = unary_union(
        [Polygon(p["outer"], p["holes"]) for p in surfaces if p["kind"] != "stop_line"]
    )
    for part in _parts(envelope.difference(covered)):
        r = _polygon_record(part)
        surfaces.append({"kind": "background", "outer": r["polygon"], "holes": r["holes"]})
    # Roof/facade low cells outside actual walkable/drivable map do not become road heights.
    ground_area = unary_union(
        [
            Polygon(p["outer"], p["holes"])
            for p in surfaces
            if p["kind"] in {"drivable_area", "road_segment", "lane", "walkway", "ped_crossing"}
        ]
        + corridors
    ).intersection(envelope)
    points = np.asarray(ground_samples, dtype=float)
    if points.size:
        keep = contains_xy(ground_area, points[:, 0], points[:, 1])
        points = points[keep]
        ground_samples = points.tolist()
    # Repeated 3D box feet provide explicitly inferred support where LiDAR has no nearby ground.
    # These are not independent LiDAR measurements or physical collision ground truth.
    anchors_by_cell = {}
    measured = np.asarray(ground_samples, dtype=float)
    for actor in actors:
        if not actor["category"].startswith(("vehicle.", "human.")) or "height_m" not in actor:
            continue
        rows = actor["samples"]
        for i, pose in enumerate(rows):
            if "z_m" not in pose or not ground_area.covers(Point(pose["x_m"], pose["y_m"])):
                continue
            foot = pose["z_m"] - (0 if actor.get("role") == "ego" else actor["height_m"] / 2)
            supported = False
            for j in [i - 1, i + 1]:
                if not 0 <= j < len(rows) or "z_m" not in rows[j]:
                    continue
                other = rows[j]
                distance = math.hypot(pose["x_m"] - other["x_m"], pose["y_m"] - other["y_m"])
                other_foot = other["z_m"] - (
                    0 if actor.get("role") == "ego" else actor["height_m"] / 2
                )
                if (
                    0 < abs(pose["t_s"] - other["t_s"]) <= 1
                    and distance <= 12
                    and abs(foot - other_foot) <= 0.35 * distance + 0.15
                ):
                    supported = True
                    break
            if not supported or (
                measured.size
                and np.min(np.linalg.norm(measured[:, :2] - [pose["x_m"], pose["y_m"]], axis=1))
                <= 2
            ):
                continue
            key = (math.floor(pose["x_m"] / 3), math.floor(pose["y_m"] / 3))
            anchors_by_cell.setdefault(key, []).append([pose["x_m"], pose["y_m"], foot])
    anchors = []
    for points in anchors_by_cell.values():
        points = np.asarray(points, dtype=float)
        z = float(np.median(points[:, 2]))
        residual = float(np.quantile(abs(points[:, 2] - z), 0.8))
        if np.ptp(points[:, 2]) > 0.6 or residual > 0.15:
            continue
        x, y = np.median(points[:, :2], axis=0)
        # Each estimate has a distinct adjacent observed pose supporting a bounded local slope.
        anchors.append([float(x), float(y), z, 2, residual, 1])
    if anchors:
        diagnostics.append(
            f"Ground support includes {len(anchors)} inferred repeated-annotation cells; not measured LiDAR"
        )
    if len(ground_samples):
        # Measured cells are judged against measured AND anchor neighbours: a lone roof/deck
        # LiDAR cell beside repeated car-foot ground is as untrusted as one amid road cells.
        points = np.asarray(ground_samples, dtype=float)
        reference = np.asarray([r[:3] for r in ground_samples + anchors], dtype=float)
        spike = _terrain_spikes(points[:, :3], reference)
        if spike.any():
            diagnostics.append(
                f"Rejected {int(spike.sum())} measured ground cells inconsistent with neighbouring terrain"
            )
        ground_samples = points[~spike].tolist()
    return {
        "schema_version": 1,
        "bounds_m": list(bounds),
        "ground": {"cell_m": 3, "samples": ground_samples + anchors},
        "surfaces": surfaces,
        "buildings": buildings,
        "trees": trees,
        "poles": poles,
        "diagnostics": diagnostics,
    }
