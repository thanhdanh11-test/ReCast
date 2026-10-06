import json
import os
from dataclasses import asdict, replace
from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pyquaternion import Quaternion

from topeye.api.main import create_app
from topeye.core.adapters.base import DatasetError
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.cache import CACHE_VERSION, write_json
from topeye.core.geometry import project, transform_matrix

DATA = Path.home() / "cvat-day2/tools/traffic_pipeline/data"


@pytest.fixture(scope="module")
def adapter():
    root = Path(os.environ.get("TOPEYE_NUSC_ROOT", DATA / "nuscenes"))
    if not root.is_dir():
        pytest.skip(f"nuScenes integration dataset missing: {root}")
    return NuScenesAdapter(root)


def test_missing_dataset(tmp_path):
    with pytest.raises(DatasetError):
        NuScenesAdapter(tmp_path / "missing")


def test_invalid_json(tmp_path):
    tables = tmp_path / "v1.0-mini"
    tables.mkdir()
    (tables / "scene.json").write_text("{")
    with pytest.raises(DatasetError):
        NuScenesAdapter(tmp_path)


def test_gt_boxes_match_devkit(adapter):
    path = DATA / "3d/nusc-mini/gt.json"
    if not path.is_file():
        pytest.skip(f"Devkit reference missing: {path}")
    reference = json.loads(path.read_text())
    samples = reference["samples"]
    scenes = {sample["frame"].rsplit("_", 1)[0] for sample in samples}
    assert len(scenes) >= 3
    frames = {frame.frame_id: frame for scene in scenes for frame in adapter.frames(scene)}
    max_center = max_size = max_yaw = 0.0
    count = 0
    for sample in samples:
        actual = adapter.gt_boxes(frames[sample["frame"]])
        expected = sample["boxes"]
        assert len(actual) == len(expected), sample["frame"]
        # nuScenes JSON order need not match the devkit export's annotation order.
        remaining = list(actual)
        for box in expected:
            distances = [
                np.linalg.norm(np.array([b.cx, b.cy, b.cz]) - box["center"])
                if b.label == box["label"]
                else np.inf
                for b in remaining
            ]
            selected = remaining.pop(int(np.argmin(distances)))
            center_error = np.linalg.norm(
                np.array([selected.cx, selected.cy, selected.cz]) - box["center"]
            )
            size_error = np.max(
                np.abs(np.array([selected.l, selected.w, selected.h]) - box["size_lwh"])
            )
            axis = Quaternion(box["rotation_wxyz"]).rotate([1, 0, 0])
            expected_yaw = np.arctan2(axis[1], axis[0])
            yaw_error = abs(
                np.arctan2(np.sin(selected.yaw - expected_yaw), np.cos(selected.yaw - expected_yaw))
            )
            assert center_error < 1e-3
            assert size_error < 1e-3
            assert yaw_error < 1e-3
            max_center = max(max_center, center_error)
            max_size = max(max_size, size_error)
            max_yaw = max(max_yaw, yaw_error)
            count += 1
    assert count > 0
    print(
        f"GT scenes={len(scenes)} frames={len(samples)} boxes={count} "
        f"max_center_m={max_center:.12g} max_size_m={max_size:.12g} "
        f"max_yaw_rad={max_yaw:.12g}"
    )


def test_ego_compensation_rejects_static_chain(adapter):
    # Compare projection against an independent inverse quaternion pose chain.
    for frame in adapter.frames("scene-0061"):
        lidar = adapter._frame_lidars[frame.frame_id]
        lidar_cal = adapter.tables["calibrated_sensor"][lidar["calibrated_sensor_token"]]
        lidar_pose = adapter.tables["ego_pose"][lidar["ego_pose_token"]]
        points = adapter.load_points(frame)
        for name, (_, _, calib, _) in frame.cameras.items():
            cam = adapter._key_data[lidar["sample_token"]][name]
            cam_cal = adapter.tables["calibrated_sensor"][cam["calibrated_sensor_token"]]
            cam_pose = adapter.tables["ego_pose"][cam["ego_pose_token"]]
            xyz = points[:, :3].astype(np.float64)
            for row in (lidar_cal, lidar_pose):
                xyz = xyz @ Quaternion(row["rotation"]).rotation_matrix.T + row["translation"]
            for row in (cam_pose, cam_cal):
                xyz = (xyz - row["translation"]) @ Quaternion(row["rotation"]).rotation_matrix
            expected, depth = project(xyz, calib.K, np.eye(4))
            static = np.linalg.inv(
                transform_matrix(cam_cal["translation"], cam_cal["rotation"])
            ) @ transform_matrix(lidar_cal["translation"], lidar_cal["rotation"])
            incorrect, _ = project(points, calib.K, static)
            visible = (
                (depth > 2)
                & (expected[:, 0] > 0)
                & (expected[:, 0] < calib.width)
                & (expected[:, 1] > 0)
                & (expected[:, 1] < calib.height)
                & np.isfinite(incorrect).all(axis=1)
            )
            if not visible.any():
                continue
            error = np.linalg.norm(incorrect[visible] - expected[visible], axis=1)
            if error.max() <= 5:
                continue
            actual, _ = project(points, calib.K, calib.T_lidar_cam)
            np.testing.assert_allclose(actual[visible], expected[visible], atol=1e-8)
            # Mutation proof: this exact oracle rejects the deliberately static chain.
            with pytest.raises(AssertionError):
                np.testing.assert_allclose(incorrect[visible], expected[visible], atol=1e-8)
            print(
                f"Ego frame={frame.frame_id} cam={name} static_max_px={error.max():.6f} "
                f"compensated_max_px={np.max(np.abs(actual[visible] - expected[visible])):.12g}"
            )
            return
    pytest.fail("No moving frame demonstrates >5px error from the static chain")


def test_frames_points_and_world_origin(adapter):
    assert len(adapter.scenes()) == 10
    frames = adapter.frames("scene-0061")
    assert [f.index for f in frames] == list(range(len(frames)))
    assert all(a.lidar_ts_us < b.lidar_ts_us for a, b in pairwise(frames))
    first = frames[0]
    assert first.frame_id == "scene-0061_000000"
    assert len(first.cameras) == 6
    points = adapter.load_points(first)
    assert points.ndim == 2 and points.shape[1] == 4 and points.dtype == np.float32
    assert len(points) > 10000
    for _, _, calib, world_cam in first.cameras.values():
        np.testing.assert_allclose(world_cam @ calib.T_lidar_cam, first.T_world_lidar, atol=1e-10)
    lidar = adapter._frame_lidars[first.frame_id]
    cal = adapter.tables["calibrated_sensor"][lidar["calibrated_sensor_token"]]
    pose = adapter.tables["ego_pose"][lidar["ego_pose_token"]]
    np.testing.assert_allclose(
        first.T_world_lidar[:3, 3],
        Quaternion(pose["rotation"]).rotate(cal["translation"]),
        atol=1e-10,
    )


def test_sweeps_keep_keyframe_identity(adapter):
    keys = {f.frame_id: f for f in adapter.frames("scene-0061")}
    sweeps = adapter.sweep_frames("scene-0061")
    assert len(sweeps) > len(keys)
    assert len({f.frame_id for f in sweeps}) == len(sweeps)
    assert all(a.lidar_ts_us < b.lidar_ts_us for a, b in pairwise(sweeps))
    for index, frame in enumerate(sweeps):
        if frame.frame_id in keys:
            assert frame.index == keys[frame.frame_id].index
        else:
            assert frame.frame_id == f"scene-0061_sweep_{frame.lidar_ts_us}"
            assert frame.index == index
            assert adapter.gt_boxes(frame) is None


def test_missing_image_is_warning(adapter, monkeypatch, caplog):
    frame = adapter.frames("scene-0061")[0]
    missing = frame.cameras["CAM_FRONT"][0]
    original = Path.is_file
    monkeypatch.setattr(Path, "is_file", lambda path: False if path == missing else original(path))
    updated = adapter.frames("scene-0061")[0]
    assert "CAM_FRONT" not in updated.cameras
    assert len(updated.cameras) == 5
    assert "Missing camera image" in caplog.text


def test_missing_and_malformed_lidar(adapter, tmp_path):
    frame = adapter.frames("scene-0061")[0]
    with pytest.raises(DatasetError):
        adapter.load_points(replace(frame, lidar_path=adapter.root / "missing.bin"))
    # Keep all test writes inside pytest's temp directory, never the source dataset.
    local = NuScenesAdapter.__new__(NuScenesAdapter)
    local.root = tmp_path
    malformed = tmp_path / "bad.bin"
    np.array([1, 2, 3], dtype=np.float32).tofile(malformed)
    with pytest.raises(DatasetError, match="five float32"):
        local.load_points(replace(frame, lidar_path=malformed))
    with pytest.raises(DatasetError, match="escapes root"):
        local.load_points(replace(frame, lidar_path=tmp_path.parent / "outside.bin"))


def test_unknown_scene(adapter):
    with pytest.raises(DatasetError):
        adapter.frames("missing")


def test_gt_api_identity_across_frames(adapter, tmp_path):
    frames = adapter.frames("scene-0061")[:2]
    root = tmp_path / frames[0].scene
    write_json(root / "meta.json", {
        "cache_version": CACHE_VERSION, "frames": [f.frame_id for f in frames],
    })
    client = TestClient(create_app(adapter, tmp_path))
    responses = []
    for frame in frames:
        boxes = adapter.gt_boxes(frame)
        assert boxes
        write_json(root / "frames" / frame.frame_id / "gt.json", [asdict(b) for b in boxes])
        url = f"/api/scenes/{frame.scene}/frames/{frame.frame_id}/boxes?source=gt"
        response = client.get(url)
        assert response.status_code == 200
        result = response.json()
        assert client.get(url).json() == result
        assert len({b["id"] for b in result}) == len(boxes)
        for actual, original in zip(result, boxes, strict=True):
            annotation = adapter.tables["sample_annotation"][original.annotation_token]
            assert isinstance(actual["id"], str)
            assert actual["id"] == f"gt:{annotation['token']}"
            assert actual["track_key"] == annotation["instance_token"]
            assert actual["source"] == "gt"
            assert actual["score"] is None and actual["version"] is None
            assert actual["attributes"] == {}
            assert set(actual) == {
                "id", "source", "track_key", "label", "cx", "cy", "cz", "l", "w", "h",
                "yaw", "score", "version", "attributes",
            }
        responses.append({b["track_key"]: b["id"] for b in result})
    shared = responses[0].keys() & responses[1].keys()
    assert shared
    assert all(responses[0][key] != responses[1][key] for key in shared)
