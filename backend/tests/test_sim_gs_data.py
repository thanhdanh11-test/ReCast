import json
from dataclasses import replace
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from topeye.core.bev import box_mask
from topeye.core.geometry import project
from topeye.core.types import Box3D, CameraCalib, FrameInfo, GTBox3D
from topeye.sim import gs_data, static_map


@pytest.fixture
def dataset(tmp_path, monkeypatch):
    K = np.array([[60., 0, 40], [0, 60, 30], [0, 0, 1]])
    camera_pose = np.eye(4)
    camera_pose[:3, 3] = [0, 0, -10]
    calib = CameraCalib("CAM_FRONT", K, np.eye(4), 80, 60)
    sweeps = []
    for i in range(9):
        image = tmp_path / f"{i}.jpg"
        assert cv2.imwrite(str(image), np.full((60, 80, 3), [20, 50, 80], np.uint8))
        pose = np.eye(4)
        pose[0, 3] = i * 0.02
        sweeps.append(FrameInfo(f"s_{i}", "s", i, tmp_path / "unused", i * 250_000,
                                pose, {"CAM_FRONT": (image, i * 250_000, calib, camera_pose)}))
    box = GTBox3D(4., 0, 3., 1., 1., 1., 0., "other", "ann", "actor")
    # Two static returns in one pixel at different depths, plus a masked actor return.
    points = np.array([[-5, 0, 5, 20], [-20 / 3, 0, 10, 20], [4, 0, 3, 20],
                       [2, 5, 5, 20], [0, 0, -1, 20]], np.float32)
    adapter = SimpleNamespace(sweep_frames=lambda _: sweeps, frames=lambda _: sweeps,
                              load_points=lambda _: points, mask_boxes=lambda _: [box])
    monkeypatch.setattr(static_map, "ground_mask", lambda p: np.zeros(len(p), bool))
    monkeypatch.setattr(static_map, "BEVScene", lambda *_: SimpleNamespace(
        gains={}, camera=SimpleNamespace(cache_clear=lambda: None)))
    return adapter, sweeps, box, points


def test_export_camera_mask_depth_split_and_binary_init(dataset, tmp_path):
    adapter, sweeps, box, points = dataset
    out = tmp_path / "gs"
    summary = gs_data.export_gs_dataset(adapter, "s", out, max_init_points=1)
    records = json.loads((out / "cameras.json").read_text())
    assert len(records) == 9
    assert summary["views_train"] == 8 and summary["views_test"] == 1
    assert [i for i, view in enumerate(records) if view["split"] == "test"] == [4]
    assert summary["init_points"] == 1
    assert summary["ego_masked_pixel_ratio"]["CAM_FRONT"] == 0
    for record, sweep in zip(records, sweeps):
        original = sweep.cameras["CAM_FRONT"][2]
        world_cam = sweep.cameras["CAM_FRONT"][3]
        scaled = gs_data._scaled_calib(original, .5, world_cam, sweep)
        np.testing.assert_allclose(record["K"], np.diag([.5, .5, 1]) @ original.K)
        np.testing.assert_allclose(record["c2w"], world_cam)
        uv_original, _ = project(points, original.K, np.linalg.inv(world_cam)
                                 @ sweep.T_world_lidar)
        uv_scaled, _ = project(points, np.array(record["K"]), scaled.T_lidar_cam)
        np.testing.assert_allclose(uv_scaled, uv_original * .5, atol=.5)
        mask = cv2.imread(str(out / record["mask"]), cv2.IMREAD_GRAYSCALE)
        expected = (1 - box_mask([box], scaled, pad=.3)) * 255
        np.testing.assert_array_equal(mask, expected)
        assert (mask == 0).any() and (mask == 255).any()
        depth = np.load(out / record["depth"], allow_pickle=False)
        assert depth.dtype == np.float32 and depth.shape == (30, 40)
        # Independent project oracle for the closest return; masked pixel depth stays zero.
        uv, z = project(points[:2], scaled.K, scaled.T_lidar_cam)
        x, y = uv[0].astype(int)
        assert depth[y, x] == pytest.approx(z[0])
        assert z[0] < z[1]
        assert np.all(depth[mask == 0] == 0)
        assert cv2.imread(str(out / record["image"])).shape == (30, 40, 3)
    data = (out / "init_points.ply").read_bytes()
    header, payload = data.split(b"end_header\n")
    assert b"format binary_little_endian 1.0" in header and b"element vertex 1" in header
    assert len(payload) == 15
    assert np.isfinite(np.frombuffer(payload[:12], "<f4")).all()
    # Stable view order and per-camera test assignment on a repeated export.
    gs_data.export_gs_dataset(adapter, "s", out, max_init_points=1)
    assert records == json.loads((out / "cameras.json").read_text())


def test_views_deduplicate_thin_and_split_per_camera(dataset):
    _, sweeps, _, _ = dataset
    dense = [replace(s, cameras={name: (entry[0], i * 100_000, *entry[2:])
                                 for name, entry in s.cameras.items()})
             for i, s in enumerate(sweeps)]
    dense = [replace(s, cameras={**s.cameras, "CAM_BACK": s.cameras["CAM_FRONT"]})
             for s in dense]
    result = list(gs_data._views(dense[::-1] + dense, 4, 8))
    for name in ("CAM_FRONT", "CAM_BACK"):
        selected = [r for r in result if r[0] == name]
        assert [r[1][1] for r in selected] == [0, 300_000, 600_000]
        assert all(r[2] == "train" for r in selected)


def test_sparse_depth_minimum_and_all_categories():
    calib = CameraCalib("CAM_FRONT", np.array([[10., 0, 5], [0, 10., 5], [0, 0, 1]]),
                        np.eye(4), 10, 10)
    points = np.array([[0, 0, 5], [0, 0, 10], [1, 0, 5], [0, 0, -1], [100, 0, 1]])
    box = Box3D(1, 0, 5, .2, .2, .2, 0, "unmapped-category")
    depth = gs_data._sparse_depth(points, [box], calib)
    assert depth[5, 5] == 5 and np.count_nonzero(depth) == 1


def test_export_uses_nearest_lidar_pose_not_camera_tuple_source(dataset, tmp_path):
    adapter, sweeps, box, points = dataset
    source = sweeps[0].cameras["CAM_FRONT"]
    # Camera is encountered on sweep zero, but its own timestamp matches sweep one.
    for sweep in sweeps:
        sweep.cameras.clear()
    sweeps[0].cameras["CAM_FRONT"] = (source[0], 250_000, *source[2:])
    sweeps[1].T_world_lidar[0, 3] = 3
    out = tmp_path / "nearest"
    gs_data.export_gs_dataset(adapter, "s", out)
    record = json.loads((out / "cameras.json").read_text())[0]
    calib = gs_data._scaled_calib(source[2], .5, source[3], sweeps[1])
    expected_mask = (1 - box_mask([box], calib, pad=.3)) * 255
    mask = cv2.imread(str(out / record["mask"]), cv2.IMREAD_GRAYSCALE)
    np.testing.assert_array_equal(mask, expected_mask)
    uv, z = project(points[:1], calib.K, calib.T_lidar_cam)
    x, y = uv[0].astype(int)
    depth = np.load(out / record["depth"])
    assert depth[y, x] == z[0]


@pytest.mark.parametrize("kwargs", [
    {"scale": 0}, {"scale": float("nan")}, {"scale": 2}, {"max_hz": 0},
    {"max_hz": float("inf")}, {"test_every": 4}, {"test_every": 8.0},
    {"max_init_points": 0}, {"max_init_points": True},
])
def test_invalid_export_parameters_fail_before_writing(tmp_path, kwargs):
    with pytest.raises(ValueError):
        gs_data.export_gs_dataset(None, "s", tmp_path / "gs", **kwargs)
    assert not (tmp_path / "gs").exists()


def test_missing_camera_does_not_publish_manifest(dataset, tmp_path):
    adapter, sweeps, _, _ = dataset
    sweeps[0].cameras["CAM_FRONT"] = (tmp_path / "missing.jpg", *sweeps[0].cameras["CAM_FRONT"][1:])
    with pytest.raises(ValueError, match="Cannot read camera"):
        gs_data.export_gs_dataset(adapter, "s", tmp_path / "gs")
    assert not (tmp_path / "gs" / "cameras.json").exists()


def test_cli_rejects_scene_path_traversal(tmp_path):
    config = tmp_path / "config.toml"
    config.write_text('nusc_root = "missing"\n')
    assert gs_data.main(["--scene", "../escape", "--config", str(config)]) == 2


def test_export_rejects_dataset_without_background(dataset, tmp_path, monkeypatch):
    adapter, _, _, _ = dataset
    monkeypatch.setattr(gs_data, "box_mask", lambda boxes, calib, **_: np.ones(
        (calib.height, calib.width), np.uint8))
    with pytest.raises(ValueError, match="No usable background pixels"):
        gs_data.export_gs_dataset(adapter, "s", tmp_path / "gs")
    assert not (tmp_path / "gs" / "cameras.json").exists()


def test_export_masks_only_back_trunk(dataset, tmp_path):
    adapter, sweeps, _, _ = dataset
    for sweep in sweeps:
        sweep.cameras["CAM_BACK"] = sweep.cameras["CAM_FRONT"]
    out = tmp_path / "gs"
    summary = gs_data.export_gs_dataset(adapter, "s", out)
    assert summary["ego_masked_pixel_ratio"] == {"CAM_BACK": .1, "CAM_FRONT": 0}
    for view in json.loads((out / "cameras.json").read_text()):
        mask = cv2.imread(str(out / view["mask"]), cv2.IMREAD_GRAYSCALE)
        if view["camera"] == "CAM_BACK":
            assert np.all(mask[-3:] == 0)
            depth = np.load(out / view["depth"])
            assert np.all(depth[-3:] == 0)
