from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from topeye.core import bev
from topeye.core.types import Box3D, CameraCalib, FrameInfo
from topeye.sim import map_photo, static_map


def test_nearest_observations_win_and_unseen_do_not_count():
    xyz = np.tile([0.1, 0, 1], (5, 1))
    rgb = np.array([[220, 120, 80], [20, 30, 40], [20, 30, 40], [20, 30, 40], [-1]*3])
    keys, color = static_map.static_voxels(xyz, rgb, np.arange(5), range_m=[2, 8, 9, 10, 1])
    np.testing.assert_array_equal(keys, [[0, 0, 5]])
    np.testing.assert_array_equal(color, [[220, 120, 80]])
    _, legacy = static_map.static_voxels(xyz, rgb, np.arange(5))
    np.testing.assert_array_equal(legacy, [[20, 30, 40]])


def test_near_fraction_median_and_sweep_support():
    xyz = np.tile([0, 0, 0], (4, 1))
    rgb = np.array([[100]*3, [200]*3, [0]*3, [0]*3])
    _, colors = static_map.static_voxels(xyz, rgb, np.arange(4),
                                        range_m=[1, 2, 8, 9], near_fraction=.5)
    np.testing.assert_array_equal(colors, [[150]*3])
    assert len(static_map.static_voxels(xyz, rgb, [0]*4, range_m=[1, 2, 8, 9])[0]) == 0


@pytest.mark.parametrize('kwargs', [{'near_fraction': 0}, {'near_fraction': 1.1},
                                   {'near_fraction': np.nan}, {'range_m': [-1]},
                                   {'range_m': [np.nan]}, {'range_m': [1, 2]}])
def test_invalid_nearest_parameters(kwargs):
    with pytest.raises(ValueError):
        static_map.static_voxels(np.zeros((1, 3)), np.zeros((1, 3)), [0], **kwargs)


def test_static_points_ranges_are_sensor_local(monkeypatch):
    pose = np.eye(4)
    pose[:3, 3] = [100, 0, 0]
    f = FrameInfo('0', 'scene', 0, Path('unused'), 0, pose, {})
    a = SimpleNamespace(frames=lambda _: [f], sweep_frames=lambda _: [f],
                        mask_boxes=lambda _: [], gt_boxes=lambda _: [],
                        load_points=lambda _: np.array([[3, 4, 0, 20]], np.float32))
    monkeypatch.setattr(static_map, 'ground_mask', lambda p: np.zeros(len(p), bool))
    xyz, _, _, ranges = static_map.static_points(a, 'scene', return_range=True)
    np.testing.assert_allclose(xyz, [[103, 4, 0]])
    np.testing.assert_allclose(ranges, [5])
    a.sweep_frames = lambda _: []
    assert static_map.static_points(a, 'scene', return_range=True)[3].shape == (0,)


def read_splats(path):
    data = path.read_bytes()
    header, body = data.split(b'end_header\n', 1)
    names = [line.split()[-1].decode() for line in header.splitlines()
             if line.startswith(b'property float')]
    count = int(next(line for line in header.splitlines()
                     if line.startswith(b'element vertex')).split()[-1])
    assert b'format binary_little_endian 1.0' in header
    return np.frombuffer(body, [(name, '<f4') for name in names], count=count)


def test_splat_round_trip_color_scale_opacity_rotation_and_median(tmp_path):
    path = tmp_path / 'static_splat.ply'
    xyz = np.array([[0.01, 0, 0], [0.02, 0, 0], [1, 2, 3]])
    rgb = np.array([[10, 20, 30], [30, 40, 50], [255, 0, 128]])
    assert map_photo.export_splat(xyz, rgb, path) == 2
    vertices = read_splats(path)
    colors = np.column_stack([vertices[f'f_dc_{c}'] for c in range(3)])
    colors = (colors * map_photo.SH_C0 + .5) * 255
    np.testing.assert_allclose(colors, [[20, 30, 40], [255, 0, 128]], atol=1)
    np.testing.assert_allclose(vertices['x'], [.05, 1.05])
    np.testing.assert_allclose(np.exp(vertices['scale_0']), .07)
    np.testing.assert_allclose(1 / (1 + np.exp(-vertices['opacity'])), .9)
    np.testing.assert_array_equal(vertices['rot_0'], 1)
    for name in ('nx', 'ny', 'nz', 'rot_1', 'rot_2', 'rot_3'):
        np.testing.assert_array_equal(vertices[name], 0)


def test_splat_limit_increases_voxel_size(tmp_path, monkeypatch):
    monkeypatch.setattr(map_photo, 'SPLAT_LIMIT', 2)
    xyz = np.column_stack((np.arange(8) * .1, np.zeros((8, 2))))
    assert map_photo.export_splat(xyz, np.full((8, 3), 80), tmp_path/'splat.ply') <= 2


def test_empty_splat(tmp_path):
    path = tmp_path/'empty.ply'
    assert map_photo.export_splat(np.empty((0, 3)), np.empty((0, 3)), path) == 0
    assert len(read_splats(path)) == 0


@pytest.mark.parametrize('kwargs', [{'scale_m': 0}, {'scale_m': np.inf}, {'voxel_m': 0}])
def test_invalid_splat_parameters(tmp_path, kwargs):
    with pytest.raises(ValueError):
        map_photo.export_splat(np.zeros((1, 3)), np.zeros((1, 3)), tmp_path/'x.ply', **kwargs)


def photo_adapter(tmp_path, boxes=(), occluders=False):
    pose = np.diag([1., -1., -1., 1.])
    pose[2, 3] = 4
    K = np.array([[20., 0, 20], [0, 20, 20], [0, 0, 1]])
    image = np.full((40, 40, 3), [30, 80, 160], np.uint8)
    path = tmp_path/'camera.png'
    assert cv2.imwrite(str(path), image)
    calib = CameraCalib('CAM_FRONT', K, np.linalg.inv(pose), 40, 40)
    f = FrameInfo('0', 'scene', 0, Path('lidar'), 0, np.eye(4),
                  {'CAM_FRONT': (path, 0, calib, pose)})
    points = np.array([[0, 0, 0, 1]], np.float32)
    if occluders:
        points = np.array([[x, y, 3, 1] for x in np.arange(-1, 1, .05)
                           for y in np.arange(-1, 1, .05)], np.float32)
    return SimpleNamespace(frames=lambda _: [f], load_points=lambda _: points,
                           mask_boxes=lambda _: boxes, gt_boxes=lambda _: boxes)


def test_ground_photo_real_projection_rgb_orientation_and_unknown(tmp_path, monkeypatch):
    monkeypatch.setattr(bev, 'ground_mask', lambda p: np.ones(len(p), bool))
    a = photo_adapter(tmp_path)
    grid = np.zeros((4, 4), np.float32)
    grid[0] = np.nan  # ymin is the last rows of the photo.
    image = map_photo.ground_photo(a, 'scene', (-1, -1, 1, 1), grid)
    assert image.shape == (20, 20, 3) and image.dtype == np.uint8
    np.testing.assert_array_equal(image[0, 0], [160, 80, 30])
    assert np.all(image[-5:] == 0)


def test_ground_photo_excludes_box_silhouette(tmp_path, monkeypatch):
    monkeypatch.setattr(bev, 'ground_mask', lambda p: np.ones(len(p), bool))
    a = photo_adapter(tmp_path, boxes=[Box3D(0, 0, 1, .4, .4, 1, 0, 'car')])
    image = map_photo.ground_photo(a, 'scene', (-2, -2, 2, 2), np.zeros((8, 8)))
    assert not image[20, 20].any()
    assert image[0, 0].any()


def test_ground_photo_excludes_lidar_occlusion(tmp_path, monkeypatch):
    monkeypatch.setattr(bev, 'ground_mask', lambda p: np.ones(len(p), bool))
    a = photo_adapter(tmp_path, occluders=True)
    image = map_photo.ground_photo(a, 'scene', (-1, -1, 1, 1), np.zeros((4, 4)))
    assert not image.any()


def test_ground_photo_nearest_frame_wins(tmp_path, monkeypatch):
    monkeypatch.setattr(bev, 'ground_mask', lambda p: np.ones(len(p), bool))
    a = photo_adapter(tmp_path)
    first = a.frames('scene')[0]
    far_pose = first.cameras['CAM_FRONT'][3].copy()
    far_pose[2, 3] = 5
    path = tmp_path/'far.png'
    assert cv2.imwrite(str(path), np.full((40, 40, 3), [200, 20, 10], np.uint8))
    calib = replace(first.cameras['CAM_FRONT'][2], T_lidar_cam=np.linalg.inv(far_pose))
    far = replace(first, frame_id='1', index=1,
                  cameras={'CAM_FRONT': (path, 0, calib, far_pose)})
    # Visit the farther source first, then replace it with the nearer source.
    a.frames = lambda _: [replace(far, index=0), replace(first, index=1)]
    image = map_photo.ground_photo(a, 'scene', (-1, -1, 1, 1), np.zeros((4, 4)))
    np.testing.assert_array_equal(image[10, 10], [160, 80, 30])


@pytest.mark.parametrize('bounds,grid,kwargs', [((0, 0, 0, 1), np.zeros((2, 2)), {}),
    ((0, 0, 1, 1), np.zeros((1, 1)), {}),
    ((0, 0, 1, 1), np.zeros((2, 2)), {'res_m': 0}),
    ((0, 0, 1, 1), np.full((2, 2), np.inf), {})])
def test_invalid_photo_parameters(bounds, grid, kwargs):
    with pytest.raises(ValueError):
        map_photo.ground_photo(None, 'scene', bounds, grid, **kwargs)


def test_unknown_ground_needs_no_camera():
    image = map_photo.ground_photo(None, 'scene', (0, 0, 1, 1), np.full((2, 2), np.nan))
    assert image.shape == (10, 10, 3) and not image.any()


def test_far_camera_depth_mask_and_distance_bounds():
    calib = CameraCalib('CAM_FRONT', np.eye(3), np.eye(4), 4, 4)
    image = np.full((4, 4, 3), [30, 80, 160], np.uint8)
    points = np.array([[0., 0, d] for d in (20, 25, 30, 60, 61)])
    mask, depths = np.zeros((4, 4), np.uint8), np.full((1, 1), np.inf)
    ids, rgb, distance = map_photo._sample_far_camera(
        points, image, calib, np.eye(4), mask, depths)
    np.testing.assert_array_equal(ids, [2, 3])
    np.testing.assert_array_equal(rgb, [[160, 80, 30]]*2)
    np.testing.assert_allclose(distance, [900, 3600])
    depths[:] = 40
    assert map_photo._sample_far_camera(points, image, calib, np.eye(4), mask, depths)[0].size == 1
    mask[:] = 1
    assert map_photo._sample_far_camera(points, image, calib, np.eye(4), mask, depths)[0].size == 0


@pytest.mark.parametrize('voxel_value', [20, 80, 200])
def test_camera_exposure_uses_camera_luminance_and_clips(tmp_path, monkeypatch, voxel_value):
    monkeypatch.setattr(bev, 'ground_mask', lambda p: np.ones(len(p), bool))
    a = photo_adapter(tmp_path)
    rgb = np.full((3, 3), voxel_value)
    expected = np.clip(np.array([160, 80, 30]) @ [.2126, .7152, .0722] / voxel_value, 1, 1.6)
    assert static_map.camera_exposure(a, 'scene', rgb) == pytest.approx(expected)


def test_exposure_preserves_legacy_and_clips_highlights():
    xyz, rgb = np.zeros((3, 3)), np.tile([100, 200, 250], (3, 1))
    _, result = static_map.static_voxels(xyz, rgb, np.arange(3), exposure=1.6)
    np.testing.assert_array_equal(result, [[160, 255, 255]])
    assert static_map.camera_exposure(None, 'scene', np.empty((0, 3))) == 1
    assert static_map.camera_exposure(None, 'scene', np.zeros((1, 3))) == 1


@pytest.mark.parametrize('exposure', [0, 1.7, np.nan])
def test_invalid_exposure(exposure):
    with pytest.raises(ValueError):
        static_map.static_voxels(np.zeros((3, 3)), np.zeros((3, 3)), np.arange(3),
                                 exposure=exposure)
