"""Deterministic source-map contract and conservative planar footprint admission."""

import copy
import hashlib
import json
import math

from shapely.geometry import MultiPoint, Polygon, box
from shapely.ops import unary_union

from topeye.scenario.models import finite, matrix, require

PROFILE = "topeye-map-trajectories-v1"
LIMITS = {
    "max_xml_bytes": 2097152,
    "max_actors": 32,
    "max_duration_s": 60,
    "max_vertices_per_actor": 1201,
    "min_duration_s": 2,
    "max_speed_mps": {"vehicle": 55, "pedestrian": 4},
    "max_acceleration_mps2": {"vehicle": 12, "pedestrian": 6},
}
CAPABILITIES = {
    "xosc_version": "1.0",
    "position": "WorldPosition",
    "action": "FollowTrajectoryAction",
    "shape": "Polyline",
    "time": "absolute",
    "external_assets": False,
    "road_relative_positions": False,
}
DRIVABLE = {"drivable_area", "road_segment", "lane"}


def canonical(value):
    def ieee_numbers(item):
        if isinstance(item, bool):
            return item
        if isinstance(item, (int, float)):
            require(finite(item), "Nonfinite canonical map value", "INVALID_MAP_GEOMETRY")
            number = float(item)
            require(
                math.isfinite(number),
                "Map number exceeds IEEE double range",
                "INVALID_MAP_GEOMETRY",
            )
            return 0.0 if number == 0 else number
        if isinstance(item, dict):
            return {key: ieee_numbers(child) for key, child in item.items()}
        if isinstance(item, (list, tuple)):
            return [ieee_numbers(child) for child in item]
        return item

    return json.dumps(
        ieee_numbers(value), sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def polygon(points, holes=()):
    require(isinstance(points, list) and len(points) >= 3, "Empty map ring", "INVALID_MAP_GEOMETRY")
    for ring in [points, *holes]:
        require(
            len(ring) >= 3 and all(len(p) == 2 and all(finite(v) for v in p) for p in ring),
            "Invalid map coordinates",
            "INVALID_MAP_GEOMETRY",
        )
    p = Polygon(points, holes)
    require(
        p.is_valid and not p.is_empty and p.area > 0, "Invalid map polygon", "INVALID_MAP_GEOMETRY"
    )
    return p


def building_enclosure(points):
    require(
        isinstance(points, list)
        and len(points) >= 3
        and all(len(p) == 2 and all(finite(v) for v in p) for p in points),
        "Invalid estimated building vertices",
        "INVALID_MAP_GEOMETRY",
    )
    hull = MultiPoint(points).convex_hull
    require(
        hull.geom_type == "Polygon" and hull.area > 0,
        "Degenerate estimated building enclosure",
        "INVALID_MAP_GEOMETRY",
    )
    return [list(p) for p in list(hull.exterior.coords)[:-1]]


def context_digest(context):
    keys = (
        "schema_version",
        "profile",
        "scene",
        "dataset_version",
        "coordinates",
        "bounds_m",
        "polygons",
        "static_obstacles",
        "limits",
        "capabilities",
    )
    return "sha256:" + hashlib.sha256(canonical({k: context[k] for k in keys})).hexdigest()


def verify_context(context):
    require(
        context.get("schema_version") == 1 and context.get("profile") == PROFILE,
        "Unsupported map context",
        "INVALID_INPUT",
    )
    require(
        context.get("limits") == LIMITS and context.get("capabilities") == CAPABILITIES,
        "Changed application limits",
        "INVALID_INPUT",
    )
    require(context.get("map_id") == context_digest(context), "Map digest mismatch", "MAP_MISMATCH")
    c = context["coordinates"]
    require(
        c.get("frame") == "source_local"
        and c.get("units") == "m"
        and c.get("yaw_units") == "rad"
        and c.get("axes") == "x-east,y-north,z-up"
        and len(c["origin_global_m"]) == 3
        and all(finite(v) for v in c["origin_global_m"]),
        "Invalid coordinate frame",
        "INVALID_INPUT",
    )
    bounds = context["bounds_m"]
    require(
        len(bounds) == 4
        and all(finite(v) for v in bounds)
        and bounds[0] < bounds[2]
        and bounds[1] < bounds[3],
        "Invalid map bounds",
        "INVALID_MAP_GEOMETRY",
    )
    surfaces = [(p["kind"], polygon(p["outer"], p["holes"])) for p in context["polygons"]]
    require(any(k in DRIVABLE for k, _ in surfaces), "No drivable map surfaces", "MAP_UNAVAILABLE")
    obstacles = [polygon(p["footprint"]) for p in context["static_obstacles"]]
    return surfaces, obstacles


def build_map_context(source):
    require(source.get("mode") == "source", "Map context requires original source")
    env = source.get("environment", {})
    polygons = copy.deepcopy(env.get("polygons", []))
    require(polygons, "Source has no vector map", "MAP_UNAVAILABLE")
    for index, p in enumerate(polygons):
        try:
            polygon(p["outer"], p.get("holes", []))
        except ValueError as exc:
            from topeye.scenario.models import ScenarioError

            raise ScenarioError(
                "INVALID_MAP_GEOMETRY", f"Source polygon {index} ({p.get('kind')}): {exc}"
            ) from exc
        p["holes"] = sorted(p.get("holes", []), key=canonical)
    polygons.sort(key=canonical)
    obstacles = []
    for b in env.get("buildings", []):
        obstacles.append(
            {"kind": "building", "footprint": building_enclosure(b["polygon"]), "estimated": True}
        )
    for plural, kind, radius in [("trees", "tree", 0.24), ("poles", "pole", 0.12)]:
        for p in env.get(plural, []):
            # Circumscribed regular polygon contains the displayed trunk/pole disk.
            r = radius / math.cos(math.pi / 16)
            points = [
                [p["x"] + r * math.cos(i * math.pi / 8), p["y"] + r * math.sin(i * math.pi / 8)]
                for i in range(16)
            ]
            obstacles.append({"kind": kind, "footprint": points, "estimated": True})
    obstacles.sort(key=canonical)
    bounds = source["source"].get("bounds_m")
    if bounds is None:
        ego = next(a for a in source["actors"] if a["role"] == "ego")
        xy = matrix(ego)[:, 1:3]
        bounds = [*(xy.min(axis=0) - 60), *(xy.max(axis=0) + 60)]
    context = {
        "schema_version": 1,
        "profile": PROFILE,
        "scene": source["source"]["scene"],
        "dataset_version": source["source"].get("dataset_version", "v1.0-mini"),
        "coordinates": {
            "frame": "source_local",
            "units": "m",
            "yaw_units": "rad",
            "axes": "x-east,y-north,z-up",
            "origin_global_m": copy.deepcopy(source["source"]["origin_global_m"]),
        },
        "bounds_m": list(map(float, bounds)),
        "polygons": polygons,
        "static_obstacles": obstacles,
        "collision_provenance": [
            "Buildings: conservative convex enclosure of estimated source vertices; source rendering unchanged",
            "Trees/poles: conservative enclosure of displayed trunk disks",
        ],
        "source_actors": [],
        "limits": copy.deepcopy(LIMITS),
        "capabilities": copy.deepcopy(CAPABILITIES),
    }
    for a in sorted(source["actors"], key=lambda a: a["id"]):
        context["source_actors"].append(
            {
                **{k: a[k] for k in ("id", "role", "category", "length_m", "width_m", "height_m")},
                "initial_pose": {k: a["samples"][0][k] for k in ("x_m", "y_m", "z_m", "yaw_rad")},
            }
        )
    context["map_id"] = context_digest(context)
    verify_context(context)
    return context


def footprint(actor, row):
    x, y, h = row["x_m"], row["y_m"], row["yaw_rad"]
    c, s = math.cos(h), math.sin(h)
    l, w = actor["length_m"] / 2, actor["width_m"] / 2
    return Polygon(
        [
            (x + c * dx - s * dy, y + s * dx + c * dy)
            for dx, dy in [(-l, -w), (l, -w), (l, w), (-l, w)]
        ]
    )


def centered_samples(reference, offset):
    """Sample reference interpolation, then rotate the model offset (never interpolate centers)."""
    cx, cy, cz = offset
    radius = math.hypot(cx, cy)
    result = []
    budget = 0
    for index, end in enumerate(reference):
        start = reference[index - 1] if index else end
        yaw = math.remainder(end["yaw_rad"] - start["yaw_rad"], 2 * math.pi)
        distance = math.hypot(end["x_m"] - start["x_m"], end["y_m"] - start["y_m"])
        duration = end["t_s"] - start["t_s"]
        count = max(
            1,
            math.ceil((distance + abs(yaw) * radius) / 0.25),
            math.ceil(abs(yaw) / math.radians(2)),
            math.ceil(duration / 0.05),
        )
        budget += count
        require(budget <= 150000, "Centered preview resource budget exceeded", "RESOURCE_LIMIT")
        for step in [0] if index == 0 else range(1, count + 1):
            f = step / count
            h = start["yaw_rad"] + yaw * f
            row = {k: start[k] + (end[k] - start[k]) * f for k in ("t_s", "x_m", "y_m", "z_m")}
            row.update(
                x_m=row["x_m"] + cx * math.cos(h) - cy * math.sin(h),
                y_m=row["y_m"] + cx * math.sin(h) + cy * math.cos(h),
                z_m=row["z_m"] + cz,
                yaw_rad=h,
                observed=False,
            )
            result.append(row)
    return result


def check_map(actors, context):
    surfaces, obstacles = verify_context(context)
    drive = unary_union([p for k, p in surfaces if k in DRIVABLE])
    walk = unary_union([p for k, p in surfaces if k in DRIVABLE | {"walkway", "ped_crossing"}])
    crossing = unary_union([p for k, p in surfaces if k in {"walkway", "ped_crossing"}])
    obstacles = unary_union(obstacles)
    envelope = box(*context["bounds_m"])
    warnings = []
    sample_budget = 0
    for actor in actors:
        rows = actor["samples"]
        pedestrian = actor["category"].startswith("human.")
        surface = walk if pedestrian else drive
        radius = math.hypot(actor["length_m"], actor["width_m"]) / 2
        radius += math.hypot(*actor.get("center_offset_m", [0, 0])[:2])
        warned = False
        for index, row in enumerate(rows):
            require(
                abs(row["z_m"]) <= 2, f"{actor['id']} vertex {index}: z exceeds ±2m", "OUTSIDE_MAP"
            )
            p = footprint(actor, row)
            require(
                envelope.covers(p),
                f"{actor['id']} vertex {index}: footprint outside envelope",
                "OUTSIDE_MAP",
            )
            require(
                surface.covers(p),
                f"{actor['id']} vertex {index}: footprint outside surface",
                "OUTSIDE_SURFACE",
            )
            require(
                not obstacles.intersects(p),
                f"{actor['id']} vertex {index}: estimated static obstacle",
                "STATIC_OBSTACLE",
            )
            if pedestrian and not crossing.covers(p):
                warned = True
            if index == 0:
                continue
            a = rows[index - 1]
            yaw = math.remainder(row["yaw_rad"] - a["yaw_rad"], 2 * math.pi)
            n = max(
                1,
                math.ceil(math.hypot(row["x_m"] - a["x_m"], row["y_m"] - a["y_m"]) / 0.25),
                math.ceil(abs(yaw) / math.radians(2)),
            )
            sample_budget += n
            require(sample_budget <= 150000, "Map sweep resource budget exceeded", "RESOURCE_LIMIT")
            previous = footprint(actor, a)
            for j in range(1, n + 1):
                q = {k: a[k] + (row[k] - a[k]) * j / n for k in ("x_m", "y_m", "z_m")}
                q["yaw_rad"] = a["yaw_rad"] + yaw * j / n
                current = footprint(actor, q)
                swept = unary_union([previous, current]).convex_hull
                # Bound arc deviation of rotating corners between samples.
                if yaw:
                    swept = swept.buffer(radius * (1 - math.cos(abs(yaw) / n / 2)) + 1e-10)
                require(
                    envelope.covers(swept),
                    f"{actor['id']} segment {index - 1}: outside envelope",
                    "OUTSIDE_MAP",
                )
                require(
                    surface.covers(swept),
                    f"{actor['id']} segment {index - 1}: outside surface",
                    "OUTSIDE_SURFACE",
                )
                require(
                    not obstacles.intersects(swept),
                    f"{actor['id']} segment {index - 1}: static obstacle",
                    "STATIC_OBSTACLE",
                )
                previous = current
        if warned:
            warnings.append(
                {
                    "code": "PEDESTRIAN_ROADWAY",
                    "message": "Pedestrian travels on roadway outside crossing/walkway",
                    "actor_id": actor["id"],
                }
            )
    warnings.append(
        {
            "code": "ESTIMATED_GEOMETRY",
            "message": "Planar map admission uses estimated obstacles; it is not physical safety certification",
        }
    )
    return warnings
