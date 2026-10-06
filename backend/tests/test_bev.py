from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from topeye.core import ground
from topeye.core.bev import BEVScene, box_mask, outside_boxes
from topeye.core.cache import prepare_scene
from topeye.core.types import Box3D, CameraCalib, FrameInfo


def fixture_scene(tmp_path, boxes=None, distances=(5, 8)):
    frames = []
    for index, distance in enumerate(distances):
        pose = np.eye(4)
        pose[2, 3] = -distance
        calib = CameraCalib(
            "CAM_FRONT",
            np.array([[10.0, 0, 16], [0, 10, 16], [0, 0, 1]]),
            np.linalg.inv(pose),
            32,
            32,
        )
        path = tmp_path / f"{index}.png"
        cv2.imwrite(str(path), np.full((32, 32, 3), 40 + index * 100, np.uint8))
        frames.append(
            FrameInfo(
                f"test_{index:06d}",
                "test",
                index,
                Path("unused"),
                index,
                np.eye(4),
                {"CAM_FRONT": (path, index, calib, pose)},
            )
        )
    x, y = np.meshgrid(np.arange(-4, 4, 0.5), np.arange(-4, 4, 0.5))
    points = np.column_stack((x.ravel(), y.ravel(), np.zeros(x.size), np.ones(x.size)))
    return SimpleNamespace(
        frames=lambda _: frames,
        load_points=lambda _: points,
        gt_boxes=lambda frame: (boxes or {}).get(frame.index, []),
    )


def test_height_grid_median_and_radius():
    points = np.array([[0.1, 0.1, 1], [0.2, 0.2, 5], [0.3, 0.3, 3]])
    grid = ground.height_grid(points, np.ones(3, bool), res_m=1, extent_m=5)
    assert grid[5, 5] == 3
    assert grid[5, 8] == 3
    assert grid[7, 7] == 3
    assert np.isnan(grid[5, 9]) and np.isnan(grid[8, 8])
    assert np.isnan(ground.height_grid(points, np.zeros(3, bool))).all()


def test_grid_fallback_meta(tmp_path, monkeypatch):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    adapter = fixture_scene(tmp_path, distances=(5,))
    meta = prepare_scene(
        adapter,
        "test",
        tmp_path / "cache",
        SimpleNamespace(calib_ok_ms=50, calib_warn_ms=100),
        workers=1,
    )
    assert meta["ground_algo"] == "grid" and meta["failures"] == []
    image = cv2.imread(str(tmp_path / "cache/test/frames/test_000000/bev.png"), -1)
    assert image.shape == (1200, 1200, 4)
    assert image[600, 600, 3] == 255
    assert np.all(image[:100, :, 3] == 0)


def test_grid_quantile_and_slope(monkeypatch):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    points = np.array([[0.1, 0.1, 0], [0.2, 0.2, 0], [0.3, 0.3, 1], [1.1, 0.1, 0.1]])
    assert ground.ground_mask(points).tolist() == [True, True, False, True]
    points[-1, 2] = 1
    assert not ground.ground_mask(points).any()


@pytest.mark.parametrize("distances,expected", [((5, 8), 40), ((8, 5), 140), ((5, 5), 40)])
def test_nearest_source_and_tie(tmp_path, monkeypatch, distances, expected):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    scene = BEVScene(fixture_scene(tmp_path, distances=distances), "test")
    assert scene.build(0)[600, 600].tolist() == [expected, expected, expected, 255]


def test_box_masks_nearest_source(tmp_path, monkeypatch):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    boxes = {0: [Box3D(0, 0, -2, 2, 2, 1, 0, "car")]}
    scene = BEVScene(fixture_scene(tmp_path, boxes), "test")
    assert scene.build(0)[600, 600].tolist() == [140, 140, 140, 255]
    assert scene.build(0, window=0)[600, 600, 3] == 0


def test_box_crossing_near_plane(tmp_path):
    adapter = fixture_scene(tmp_path, distances=(5,))
    calib = adapter.frames("test")[0].cameras["CAM_FRONT"][2]
    mask = box_mask([Box3D(0, 0, -4.5, 2, 2, 2, 0, "car")], calib)
    assert mask[16, 16] == 1
    assert not box_mask([Box3D(0, 0, -10, 2, 2, 1, 0, "car")], calib).any()


def test_window_ground_transform_and_box_exclusion(tmp_path, monkeypatch):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    adapter = fixture_scene(tmp_path)
    frames = adapter.frames("test")
    pose = np.eye(4)
    pose[0, 3] = 10
    frames[1] = replace(frames[1], T_world_lidar=pose)
    adapter.gt_boxes = lambda f: [Box3D(0, 0, 0, 2, 2, 2, 0, "car")] if f.index == 1 else []
    scene = BEVScene(adapter, "test")
    assert scene.ground[1][:, 0].min() == 6
    assert outside_boxes(scene.ground[1] - [10, 0, 0], adapter.gt_boxes(frames[1])).all()
    assert scene.build(0, window=0)[600, 690, 3] == 0
    assert scene.build(0, window=1)[600, 690, 3] == 255


def test_no_ground_records_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    adapter = fixture_scene(tmp_path, distances=(5,))
    adapter.load_points = lambda _: np.empty((0, 4))
    meta = prepare_scene(
        adapter, "test", tmp_path / "cache", SimpleNamespace(calib_ok_ms=50, calib_warn_ms=100)
    )
    assert meta["failures"] == [{"frame_id": "test_000000", "reason": "no_ground"}]
    assert not list((tmp_path / "cache").rglob("bev.png"))


def test_no_bev_then_default_rebuild(tmp_path, monkeypatch):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    adapter = fixture_scene(tmp_path, distances=(5,))
    config = SimpleNamespace(calib_ok_ms=50, calib_warn_ms=100)
    root = tmp_path / "cache"
    prepare_scene(adapter, "test", root, config, no_bev=True)
    assert not list(root.rglob("bev.png"))
    prepare_scene(adapter, "test", root, config)
    path = next(root.rglob("bev.png"))
    timestamp = path.stat().st_mtime_ns
    prepare_scene(adapter, "test", root, config)
    assert path.stat().st_mtime_ns == timestamp


def test_gain_uses_overlap_relative_to_front(tmp_path, monkeypatch):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    adapter = fixture_scene(tmp_path, distances=(5,))
    frame = adapter.frames("test")[0]
    _, timestamp, calib, pose = frame.cameras["CAM_FRONT"]
    other = tmp_path / "other.png"
    cv2.imwrite(str(other), np.full((32, 32, 3), 20, np.uint8))
    frame.cameras["CAM_OTHER"] = (other, timestamp, replace(calib, name="CAM_OTHER"), pose)
    scene = BEVScene(adapter, "test")
    assert scene.gains == {"CAM_FRONT": 1.0, "CAM_OTHER": 2.0}


def test_object_overlay_rgb_and_unknown_alpha(tmp_path, monkeypatch):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    adapter = fixture_scene(tmp_path, distances=(5,))
    load = adapter.load_points
    points = np.vstack((load(None), [[0, 0, 2, 50], [50, 50, 2, 70]]))
    adapter.load_points = lambda _: points
    scene = BEVScene(adapter, "test")
    colored = np.column_stack((points, np.tile([200, 10, 20], (len(points), 1))))
    image = scene.build(0, colored=colored)
    assert image[600, 600].tolist() == [200, 10, 20, 255]
    assert image[100, 1100, 3] == 0


def test_missing_lidar_failure_with_bev(tmp_path, monkeypatch):
    from topeye.core.adapters.base import DatasetError

    monkeypatch.setattr(ground, "pypatchworkpp", None)
    adapter = fixture_scene(tmp_path, distances=(5,))
    adapter.load_points = lambda _: (_ for _ in ()).throw(DatasetError("missing lidar"))
    meta = prepare_scene(
        adapter, "test", tmp_path / "cache", SimpleNamespace(calib_ok_ms=50, calib_warn_ms=100)
    )
    assert meta["failures"] == [{"frame_id": "test_000000", "reason": "missing lidar"}]


def test_wall_occludes_ground_camera(tmp_path, monkeypatch):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    adapter = fixture_scene(tmp_path)
    load = adapter.load_points
    wall = np.array([[0.1, 0.1, -2, 1]])
    adapter.load_points = lambda f: np.vstack((load(f), wall)) if f.index == 0 else load(f)
    monkeypatch.setattr("topeye.core.bev.ground_mask", lambda p: p[:, 2] == 0)
    scene = BEVScene(adapter, "test")
    points = adapter.load_points(adapter.frames("test")[0])
    colored = np.column_stack((points, np.zeros((len(points), 3))))
    assert scene.build(0, colored=colored)[599, 600].tolist() == [140, 140, 140, 255]
    assert scene.build(0, window=0, colored=colored)[599, 600, 3] == 0


def test_interpolated_height_without_real_ground_is_transparent(tmp_path, monkeypatch):
    monkeypatch.setattr(ground, "pypatchworkpp", None)
    scene = BEVScene(fixture_scene(tmp_path, distances=(5,)), "test")
    local = scene.ground[0]
    grid = ground.height_grid(local, np.ones(len(local), bool))
    assert np.isfinite(grid[120, 129])
    image = scene.build(0)
    assert image[599, 647, 3] == 0
    assert not (image[:, :, 3][~ground.ground_support(local)] > 0).any()


def test_window_compensates_scene_ends():
    from topeye.core.bev import source_window

    frames = [SimpleNamespace(index=i) for i in range(20)]
    assert {f.index for f in source_window(frames, 19, 5)} == set(range(9, 20))
    assert {f.index for f in source_window(frames, 0, 5)} == set(range(11))
    assert {f.index for f in source_window(frames, 10, 5)} == set(range(5, 16))
    assert len(source_window(frames[:3], 2, 5)) == 3


def test_ground_support_exact_distance():
    points = np.array([[0.05, 0.05, 0]])
    support = ground.ground_support(points, res_m=0.1, extent_m=2)
    assert support[19, 29]
    assert not support[19, 31]
    assert not ground.ground_support(points[:0], extent_m=2).any()


def test_sparse_wall_fill_and_discontinuous_foot():
    from topeye.core.bev import depth_buffer, sample_camera

    calib = CameraCalib('CAM_FRONT', np.diag([100, 100, 1]), np.eye(4), 16, 64)
    # Rows 1 and 13: exactly 12 bins apart, 0.6 m depth difference.
    points = np.array([[0.1, 0.5, 10], [0.106, 5.618, 10.6]])
    depths = depth_buffer(points, calib)
    assert depths[7, 0] == pytest.approx(10.3)
    image = np.full((64, 16, 3), 90, np.uint8)
    mask = np.zeros((64, 16), np.uint8)
    samples = np.array([[0.12, 3.48, 12]])
    assert sample_camera(samples, image, calib, np.eye(4), mask, depths)[0].size == 0
    assert sample_camera(samples, image, calib, np.eye(4), mask, None)[0].size == 1
    # Exactly 1 m jump must remain empty, allowing the ground by the wall foot.
    points[1] = [0.11, 5.83, 11]
    depths = depth_buffer(points, calib)
    assert np.isinf(depths[7, 0])
    assert sample_camera(samples, image, calib, np.eye(4), mask, depths)[0].tolist() == [0]


def test_depth_fill_boundaries_and_linear_values():
    from topeye.core.bev import fill_depth_columns

    buffer = np.full((16, 4), np.inf)
    buffer[1] = 10
    buffer[13, :3] = [10.6, 11, 9]
    buffer[14, 3] = 10.6  # 13 bins apart: prohibited.
    filled = fill_depth_columns(buffer)
    assert filled[7, 0] == pytest.approx(10.3)
    assert np.isinf(filled[7, 1:]).all()
    assert np.isinf(filled[0]).all() and np.isinf(filled[15]).all()
    assert np.array_equal(filled[np.isfinite(buffer)], buffer[np.isfinite(buffer)])
    assert np.isinf(buffer[7]).all()  # Input remains measured-only.


def test_camera_range_is_euclidean_and_inclusive():
    from topeye.core.bev import sample_camera

    calib = CameraCalib('CAM_FRONT', np.eye(3), np.eye(4), 32, 32)
    image = np.ones((32, 32, 3), np.uint8)
    points = np.array([[0, 0, 25], [0, 0, 25.01], [15, 0, 20], [16, 0, 20]])
    ids, _, _ = sample_camera(points, image, calib, np.eye(4), np.zeros((32, 32)))
    assert ids.tolist() == [0, 2]


def test_inconsistency_uses_best_two_sources(tmp_path, monkeypatch):
    monkeypatch.setattr(ground, 'pypatchworkpp', None)
    scene = BEVScene(fixture_scene(tmp_path, distances=(5, 8, 10)), 'test')
    diagnostics = {}
    plain = scene.build(0)
    measured = scene.build(0, diagnostics=diagnostics)
    assert np.array_equal(plain, measured)
    assert diagnostics['multi_source_pixels'] > 0
    assert diagnostics['inconsistency_pct'] == 100
    # Closest two agree; farther third source must not affect this metric.
    first, mask = scene.camera(0, 'CAM_FRONT')
    scene.camera = lambda index, name: (first if index < 2 else first + 100, mask)
    scene.build(0, diagnostics=diagnostics)
    assert diagnostics['inconsistency_pct'] == 0
