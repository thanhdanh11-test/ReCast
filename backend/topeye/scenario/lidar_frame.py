"""Measured LIDAR_TOP sweep nearest to a scene time, in the ego vehicle frame."""

import base64
import bisect
import math
from types import SimpleNamespace

import numpy as np

from topeye.core.adapters.base import DatasetError
from topeye.core.geometry import transform_matrix
from topeye.scenario.models import ScenarioError, require

MAX_OFFSET_S = 0.1
RANGE_M = 100.0


def nearest_sweep(timestamps, target_us):
    """Index of the timestamp closest to target (ties prefer the earlier sweep)."""
    i = bisect.bisect_left(timestamps, target_us)
    if i == 0:
        return 0
    if i == len(timestamps):
        return len(timestamps) - 1
    return i - 1 if target_us - timestamps[i - 1] <= timestamps[i] - target_us else i


def encode_points(points, sensor_to_ego, range_m=RANGE_M):
    """Sensor-frame x,y,z,intensity rows → ego-frame int16 centimetres + uint8 intensity."""
    ego = points[:, :3] @ sensor_to_ego[:3, :3].T + sensor_to_ego[:3, 3]
    keep = (np.abs(ego[:, 0]) <= range_m) & (np.abs(ego[:, 1]) <= range_m)
    xyz = np.round(ego[keep] * 100).clip(-32767, 32767).astype("<i2")
    intensity = points[keep, 3].clip(0, 255).astype(np.uint8)
    return xyz, intensity


def lidar_frame(adapter, scene, time_s):
    require(
        isinstance(time_s, (int, float)) and not isinstance(time_s, bool) and math.isfinite(time_s),
        "time_s must be a finite number",
    )
    try:
        record, samples, _ = adapter._scene(scene)
    except DatasetError as exc:
        raise ScenarioError("DATASET_INVALID", str(exc)) from exc
    sweeps = adapter._data[record["token"]]["LIDAR_TOP"]
    require(sweeps, "Scene has no LIDAR_TOP sweeps", "LIDAR_UNAVAILABLE")
    t0 = samples[0]["timestamp"]
    target = t0 + time_s * 1e6
    row = sweeps[nearest_sweep([s["timestamp"] for s in sweeps], target)]
    offset = (row["timestamp"] - target) / 1e6
    require(
        abs(offset) <= MAX_OFFSET_S, f"No LiDAR sweep within {MAX_OFFSET_S}s", "LIDAR_UNAVAILABLE"
    )
    try:
        points = adapter.load_points(
            SimpleNamespace(
                lidar_path=row["filename"], frame_id=f"{scene}_lidar_{row['timestamp']}"
            )
        )
    except DatasetError as exc:
        raise ScenarioError("LIDAR_UNAVAILABLE", str(exc)) from exc
    calib = adapter.tables["calibrated_sensor"][row["calibrated_sensor_token"]]
    xyz, intensity = encode_points(
        points, transform_matrix(calib["translation"], calib["rotation"])
    )
    return {
        "scene": scene,
        "sensor": "LIDAR_TOP",
        "frame": "ego",
        "time_s": (row["timestamp"] - t0) / 1e6,
        "offset_s": offset,
        "timestamp_us": int(row["timestamp"]),
        "count": len(xyz),
        "range_m": RANGE_M,
        "xyz_cm_b64": base64.b64encode(xyz.tobytes()).decode("ascii"),
        "intensity_b64": base64.b64encode(intensity.tobytes()).decode("ascii"),
    }
