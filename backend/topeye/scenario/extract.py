"""Use raw world annotation poses; never confuse ego and LiDAR extrinsics."""

import uuid

import numpy as np

from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.geometry import quaternion_to_matrix
from topeye.scenario.models import interpolate, require, samples, validate

VEHICLES = {
    "vehicle.car",
    "vehicle.truck",
    "vehicle.bus.rigid",
    "vehicle.bus.bendy",
    "vehicle.motorcycle",
    "vehicle.bicycle",
}


def yaw(rotation):
    r = quaternion_to_matrix(rotation)
    return float(np.arctan2(r[1, 0], r[0, 0]))


def raw_scene(adapter, name, all_categories=False):
    records = [s for s in adapter.tables["scene"].values() if s["name"] == name]
    require(len(records) == 1, "Unknown scene", "DATASET_INVALID")
    scene = records[0]
    frames = sorted(
        [s for s in adapter.tables["sample"].values() if s["scene_token"] == scene["token"]],
        key=lambda s: s["timestamp"],
    )
    tokens = {s["token"]: s for s in frames}
    t0 = frames[0]["timestamp"]
    tracks = {}
    for a in adapter.tables["sample_annotation"].values():
        if a["sample_token"] not in tokens:
            continue
        instance = adapter.tables["instance"][a["instance_token"]]
        category = adapter.tables["category"][instance["category_token"]]["name"]
        if not all_categories and category not in VEHICLES:
            continue
        track = tracks.setdefault(
            a["instance_token"], {"category": category, "rows": [], "sizes": [], "source_us": []}
        )
        ts = tokens[a["sample_token"]]["timestamp"]
        track["rows"].append([(ts - t0) / 1e6, *a["translation"], yaw(a["rotation"])])
        track["sizes"].append(a["size"])
        track["source_us"].append(ts)
    ego = {}
    for d in adapter.tables["sample_data"].values():
        if d["sample_token"] not in tokens:
            continue
        calib = adapter.tables["calibrated_sensor"][d["calibrated_sensor_token"]]
        if adapter.tables["sensor"][calib["sensor_token"]]["channel"] != "LIDAR_TOP":
            continue
        pose = adapter.tables["ego_pose"][d["ego_pose_token"]]
        ts = pose["timestamp"]
        ego[ts] = [(ts - t0) / 1e6, *pose["translation"], yaw(pose["rotation"])]
    require(len(ego) >= 3, "Missing ego poses", "DATASET_INVALID")
    for track in tracks.values():
        track["rows"] = np.array(sorted(track["rows"], key=lambda x: x[0]))
    return t0, np.array([ego[k] for k in sorted(ego)]), tracks


def road_check(ego):
    delta = ego[-1, 1:3] - ego[0, 1:3]
    length = np.linalg.norm(delta)
    require(length >= 2, "Select a moving road segment", "UNSUPPORTED_ROAD")
    axis = delta / length
    residual = np.max(np.abs((ego[:, 1:3] - ego[0, 1:3]) @ [-axis[1], axis[0]]))
    angle = np.ptp(np.unwrap(ego[:, 4]))
    require(
        angle <= np.deg2rad(5) and residual <= 1,
        "MVP supports straight clips: heading ≤5°, lateral residual ≤1 m",
        "UNSUPPORTED_ROAD",
    )
    return {
        "heading_rad": float(np.arctan2(axis[1], axis[0])),
        "lateral_residual_m": float(residual),
        "yaw_range_deg": float(np.rad2deg(angle)),
    }


def list_scenes(adapter):
    result = []
    for name in adapter.scenes():
        _, ego, tracks = raw_scene(adapter, name)
        choices = []
        for token, track in tracks.items():
            rows = track["rows"]
            if len(rows) < 3:
                continue
            choices.append(
                {
                    "token": token,
                    "category": track["category"],
                    "start_s": float(rows[0, 0]),
                    "end_s": float(rows[-1, 0]),
                    "observations": len(rows),
                    "distance_m": float(
                        np.linalg.norm(np.diff(rows[:, 1:3], axis=0), axis=1).sum()
                    ),
                }
            )
        result.append(
            {
                "scene": name,
                "duration_s": float(ego[-1, 0]),
                "ego_start_s": float(ego[0, 0]),
                "tracks": sorted(choices, key=lambda r: -r["distance_m"]),
            }
        )
    return result


def extract_scene(
    adapter: NuScenesAdapter, scene: str, actor_tokens: list[str], start_s: float, end_s: float
):
    require(
        1 <= len(actor_tokens) <= 3 and len(set(actor_tokens)) == len(actor_tokens),
        "Choose 1–3 different traffic actors",
    )
    require(
        np.isfinite([start_s, end_s]).all() and end_s - start_s >= 2,
        "Select an interval of at least 2 seconds",
    )
    t0, ego, tracks = raw_scene(adapter, scene)
    require(all(k in tracks for k in actor_tokens), "Unknown actor")
    selected = [("ego", None, "ego", "vehicle.car", ego, [1.85, 4.5, 1.6])]
    for i, token in enumerate(actor_tokens):
        tr = tracks[token]
        selected.append(
            (
                f"vehicle_{i + 1}",
                token,
                "traffic",
                tr["category"],
                tr["rows"],
                np.median(tr["sizes"], axis=0),
            )
        )
    start = max([start_s] + [v[4][0, 0] for v in selected])
    end = min([end_s] + [v[4][-1, 0] for v in selected])
    require(end - start >= 2, "Actors do not share a 2-second interval", "TRACK_TOO_SHORT")
    for _, _, _, _, rows, _ in selected:
        require(
            np.isfinite(rows).all() and (np.diff(rows[:, 0]) > 0).all(),
            "Invalid source timestamps or poses",
            "DATASET_INVALID",
        )
        intersects = (rows[:-1, 0] < end) & (rows[1:, 0] > start)
        require((np.diff(rows[:, 0])[intersects] <= 1).all(), "Track has a gap", "GAP_IN_TRACK")
    origin = interpolate(ego, [start])[0, 1:4]
    actors = []
    for name, token, role, category, rows, size in selected:
        support = rows[(rows[:, 0] >= start - 1) & (rows[:, 0] <= end + 1)]
        require(len(support) >= 3, "Too few observations", "TRACK_TOO_SHORT")
        require((np.diff(support[:, 0]) <= 1).all(), "Track has a gap", "GAP_IN_TRACK")
        times = np.unique(np.r_[start, rows[(rows[:, 0] > start) & (rows[:, 0] < end), 0], end])
        values = interpolate(rows, times)
        values[:, 0] -= start
        values[:, 1:4] -= origin
        actors.append(
            {
                "id": name,
                "instance_token": token,
                "role": role,
                "category": category,
                "length_m": float(size[1]),
                "width_m": float(size[0]),
                "height_m": float(size[2]),
                "samples": samples(values, rows[:, 0] - start),
                "source_timestamps_us": [int(t0 + t * 1e6) for t in rows[:, 0]],
            }
        )
    check = road_check(
        np.array(
            [[r[k] for k in ("t_s", "x_m", "y_m", "z_m", "yaw_rad")] for r in actors[0]["samples"]]
        )
    )
    return validate(
        {
            "schema_version": 1,
            "id": uuid.uuid4().hex,
            "source": {
                "dataset_version": adapter.version,
                "scene": scene,
                "dataset_root": str(adapter.root),
                "origin_global_m": origin.tolist(),
                "t0_us": int(t0 + start * 1e6),
                "selected_interval_s": [float(start), float(end)],
                "ego_dimensions": "assumed 4.5×1.85×1.6m; pose is ego origin",
            },
            "interval_s": [0, float(end - start)],
            "actors": actors,
            "road": {
                "kind": "synthetic_corridor",
                "file": "road.xodr",
                "provenance": "Straight presentation corridor, not recovered HD map",
                **check,
            },
        }
    )
