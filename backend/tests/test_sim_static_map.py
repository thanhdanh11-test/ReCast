from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from topeye.core.types import FrameInfo, GTBox3D
from topeye.sim import static_map


def frame(index, t, pose=None):
    return FrameInfo(str(index), 'scene', index, Path('unused'), round(t * 1e6),
                     np.eye(4) if pose is None else pose, {})


def box(x, token='car', yaw=0):
    return GTBox3D(x, 5, 1, 1, 1, 1, yaw, 'vehicle.other', 'annotation', token)


def adapter(frames, sweeps, boxes):
    return SimpleNamespace(frames=lambda _: frames, sweep_frames=lambda _: sweeps,
                           mask_boxes=lambda f: boxes[f.frame_id], gt_boxes=lambda _: [])


def test_moving_car_removed_and_static_wall_survives(monkeypatch):
    sweeps = [frame(i, i / 10) for i in range(6)]
    a = adapter([sweeps[0], sweeps[-1]], sweeps, {'0': [box(3)], '5': [box(8)]})
    a.load_points = lambda f: np.array([[3 + f.index, 5, 1, 20], [20.05, 0, 2, 20],
                                      [0, 0, 1, 20], [30, 0, -2, 20]], np.float32)
    monkeypatch.setattr(static_map, 'ground_mask', lambda p: p[:, 2] < 0)
    xyz, rgb, ids = static_map.static_points(a, 'scene')
    assert len(xyz) == 6
    assert xyz.dtype == np.float64 and rgb.dtype == np.float32 and ids.dtype == np.int32
    np.testing.assert_array_equal(xyz[:, 0], np.full(6, np.float32(20.05)))
    keys, colors = static_map.static_voxels(xyz, rgb, ids)
    np.testing.assert_array_equal(keys, [[100, 0, 10]])
    np.testing.assert_array_equal(colors, [[128, 128, 128]])


def test_world_interpolation_short_yaw_and_keyframes_exact():
    pose = np.eye(4)
    pose[:2, :2] = [[0, -1], [1, 0]]
    pose[:3, 3] = [2, 3, 0]
    first, middle, last = frame(0, 0), frame(1, .25, pose), frame(2, .5)
    a = adapter([first, last], [first, middle, last],
                {'0': [box(4, yaw=np.deg2rad(179))],
                 '2': [replace(box(6, yaw=np.deg2rad(-179)), l=3)]})
    result = static_map.sweep_boxes(a, 'scene')
    assert result['0'] is a.mask_boxes(first)
    b = result['1'][0]
    np.testing.assert_allclose([b.cx, b.cy, b.cz], [2, -3, 1], atol=1e-10)
    assert b.yaw == pytest.approx(np.pi / 2)
    assert b.l == 1 and b.label == 'vehicle.other'


def test_one_sided_boxes_gap_and_outside_keyframe_range():
    sweeps = [frame(i, t) for i, t in enumerate([-.3, -.25, 0, .25, .5, .75, 1, 1.25, 1.3])]
    a = adapter([sweeps[2], sweeps[6]], sweeps,
                {'2': [box(3, 'a')], '6': [box(6, 'b')]})
    result = static_map.sweep_boxes(a, 'scene')
    assert [len(result[f.frame_id]) for f in sweeps] == [0, 1, 1, 1, 0, 1, 1, 1, 0]


def test_two_sweeps_rejected_even_with_many_points():
    xyz = np.tile([1, 2, 3], (100, 1))
    keys, colors = static_map.static_voxels(xyz, np.ones((100, 3)), np.arange(100) % 2)
    assert keys.shape == colors.shape == (0, 3)
    assert keys.dtype == np.int64 and colors.dtype == np.uint8


def test_channel_median_rejects_outlier_and_ignores_unseen():
    xyz = np.tile([-.01, 0, 0], (4, 1))
    rgb = np.array([[10, 30, 50], [12, 28, 52], [255, 255, 255], [-1, -1, -1]])
    keys, colors = static_map.static_voxels(xyz, rgb, np.arange(4))
    np.testing.assert_array_equal(keys, [[-1, 0, 0]])
    np.testing.assert_array_equal(colors, [[12, 30, 52]])


def test_empty_inputs():
    a = adapter([], [], {})
    xyz, rgb, ids = static_map.static_points(a, 'scene')
    assert xyz.shape == rgb.shape == (0, 3) and ids.shape == (0,)
    keys, colors = static_map.static_voxels(xyz, rgb, ids)
    assert keys.shape == colors.shape == (0, 3)
    assert static_map.sweep_boxes(a, 'scene') == {}


def test_duplicate_sweep_does_not_inflate_support(monkeypatch):
    f = frame(0, 0)
    a = adapter([f], [f], {'0': []})
    a.load_points = lambda _: np.array([[10, 0, 1, 0]], np.float32)
    monkeypatch.setattr(static_map, 'ground_mask', lambda p: np.zeros(len(p), bool))
    xyz, rgb, ids = static_map.static_points(a, 'scene', sweeps=[f, f, f])
    assert len(static_map.static_voxels(xyz, rgb, ids)[0]) == 0


def test_gain_applied_before_colorize_with_bounded_image_reuse(monkeypatch):
    from topeye.core.types import CameraCalib

    calib = CameraCalib('CAM_FRONT', np.eye(3), np.eye(4), 2, 2)
    camera = {'CAM_FRONT': (Path('same.png'), 0, calib, np.eye(4))}
    sweeps = [replace(frame(i, i / 10), cameras=camera) for i in range(3)]
    a = adapter([sweeps[0], sweeps[-1]], sweeps, {'0': [], '2': []})
    a.load_points = lambda _: np.array([[3, 0, 5, 0]], np.float32)
    monkeypatch.setattr(static_map, 'ground_mask', lambda p: np.zeros(len(p), bool))
    monkeypatch.setattr(static_map, 'BEVScene', lambda *_: SimpleNamespace(
        gains={'CAM_FRONT': 2}, camera=SimpleNamespace(cache_clear=lambda: None)))
    calls = []

    def read(path):
        calls.append(path)
        return np.full((2, 2, 3), [10, 20, 30], np.uint8)

    monkeypatch.setattr(static_map.cv2, 'imread', read)
    _, rgb, _ = static_map.static_points(a, 'scene')
    np.testing.assert_array_equal(rgb, np.tile([60, 40, 20], (3, 1)))
    assert calls == ['same.png']


@pytest.mark.parametrize('kwargs', [{'voxel_m': 0}, {'voxel_m': np.nan},
                                    {'min_sweeps': 0}, {'min_sweeps': 1.5}])
def test_invalid_voxel_parameters(kwargs):
    with pytest.raises(ValueError):
        static_map.static_voxels(np.empty((0, 3)), np.empty((0, 3)), np.empty(0), **kwargs)
