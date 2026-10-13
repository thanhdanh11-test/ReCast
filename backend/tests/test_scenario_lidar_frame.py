import base64
import os
from pathlib import Path

import numpy as np
import pytest

from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.geometry import transform_matrix
from topeye.scenario.lidar_frame import encode_points, lidar_frame, nearest_sweep
from topeye.scenario.models import ScenarioError
from topeye.scenario.worker import Service

DATA = Path.home() / "cvat-day2/tools/traffic_pipeline/data"


@pytest.fixture(scope="module")
def adapter():
    root = Path(os.environ.get("TOPEYE_NUSC_ROOT", DATA / "nuscenes"))
    if not root.is_dir():
        pytest.skip(f"nuScenes integration dataset missing: {root}")
    return NuScenesAdapter(root)


def decode(frame):
    xyz = np.frombuffer(base64.b64decode(frame["xyz_cm_b64"]), "<i2").reshape(-1, 3) / 100
    intensity = np.frombuffer(base64.b64decode(frame["intensity_b64"]), np.uint8)
    return xyz, intensity


def test_nearest_sweep_prefers_closest_then_earlier():
    stamps = [100, 200, 300]
    assert [nearest_sweep(stamps, t) for t in (0, 149, 150, 151, 299, 999)] == [0, 0, 0, 1, 2, 2]


def test_encode_points_applies_rigid_transform_and_range():
    pose = transform_matrix([1.0, 2.0, 3.0], [np.cos(np.pi / 4), 0, 0, np.sin(np.pi / 4)])
    points = np.array([[1.0, 0.0, 0.0, 300.0], [200.0, 0.0, 0.0, 5.0]], dtype=np.float32)
    xyz, intensity = encode_points(points, pose)
    assert xyz.tolist() == [[100, 300, 300]]  # (1,0,0) rotated 90° about z then + (1,2,3) m
    assert intensity.tolist() == [255]


def test_measured_sweep_matches_manual_transform(adapter):
    frame = lidar_frame(adapter, "scene-0103", 6.0)
    record, samples, _ = adapter._scene("scene-0103")
    row = next(r for r in adapter._data[record["token"]]["LIDAR_TOP"] if r["timestamp"] == frame["timestamp_us"])
    raw = np.fromfile(adapter._path(row["filename"]), "<f4").reshape(-1, 5)
    calib = adapter.tables["calibrated_sensor"][row["calibrated_sensor_token"]]
    pose = transform_matrix(calib["translation"], calib["rotation"])
    ego = raw[:, :3] @ pose[:3, :3].T + pose[:3, 3]
    ego = ego[(np.abs(ego[:, 0]) <= 100) & (np.abs(ego[:, 1]) <= 100)]
    xyz, intensity = decode(frame)
    assert frame["count"] == len(xyz) == len(intensity) == len(ego) > 20000
    assert np.max(np.abs(xyz - ego)) <= 0.0051
    assert abs(frame["offset_s"]) <= 0.05
    assert frame["time_s"] == pytest.approx((row["timestamp"] - samples[0]["timestamp"]) / 1e6)
    assert frame["frame"] == "ego" and frame["sensor"] == "LIDAR_TOP"


def test_out_of_range_time_and_unknown_scene(adapter):
    with pytest.raises(ScenarioError) as late:
        lidar_frame(adapter, "scene-0103", 999.0)
    assert late.value.code == "LIDAR_UNAVAILABLE"
    with pytest.raises(ScenarioError) as unknown:
        lidar_frame(adapter, "scene-9999", 1.0)
    assert unknown.value.code == "DATASET_INVALID"
    with pytest.raises(ScenarioError):
        lidar_frame(adapter, "scene-0103", float("nan"))


def test_worker_lidar_frame_skips_workspace_recovery(adapter, tmp_path, monkeypatch):
    service = Service()
    monkeypatch.setattr(service, "recover", lambda *a: pytest.fail("lidar_frame must not recover workspaces"))
    frame = service.call(
        "lidar_frame",
        {"scene": "scene-0103", "time_s": 2.0, "dataset": str(adapter.root), "workspace": str(tmp_path), "engine": ""},
    )
    assert frame["count"] > 20000
