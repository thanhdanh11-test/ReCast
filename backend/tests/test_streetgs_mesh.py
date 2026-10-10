"""Geometry guards for the local StreetGS meshing experiment."""

import importlib.util
from pathlib import Path

import numpy as np
import pytest

spec = importlib.util.spec_from_file_location(
    "streetgs_mesh", Path(__file__).parents[1] / "scripts/streetgs_mesh.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_camera_delta_is_in_camera_frame():
    anchor = np.eye(4)
    anchor[:3, 3] = [10, 20, 30]
    camera = anchor.copy()
    camera[:3, :3] = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
    delta = np.zeros(9)
    delta[0] = 2
    result = module.adjusted_pose(anchor, camera, delta)
    np.testing.assert_allclose(result[:3, 3], [0, 2, 0], atol=1e-10)
    np.testing.assert_allclose(result[:3, :3], camera[:3, :3])


def test_camera_rotation_delta_uses_rows():
    delta = np.zeros(9)
    delta[3:] = np.array([0, -1, 0, 1, 0, 0]) - [1, 0, 0, 0, 1, 0]
    pose = module.adjusted_pose(np.eye(4), np.eye(4), delta)
    np.testing.assert_allclose(pose[:3, :3], [[0, -1, 0], [1, 0, 0], [0, 0, 1]])


def test_degenerate_camera_rejected():
    delta = np.zeros(9)
    delta[3] = -1
    with pytest.raises(ValueError, match="rotation"):
        module.adjusted_pose(np.eye(4), np.eye(4), delta)


def test_depth_alpha_normalization_and_invalid_pixels():
    z = np.array([8., 4., np.nan, 0., 60., -1.])
    alpha = np.array([.8, .4, 1., 0., 1., 1.])
    np.testing.assert_allclose(module.valid_depth(z, alpha), [10, 0, 0, 0, 0, 0])


def test_lidar_depth_nearest_surface_wins_and_rejects_behind_camera():
    points = np.array([[0, 0, 10], [0, 0, 5], [0, 0, -2], [100, 0, 1]])
    intrinsic = np.array([[10, 0, 2], [0, 10, 2], [0, 0, 1]])
    depth = module.lidar_depth(points, np.eye(4), intrinsic, 5, 5)
    assert np.isfinite(depth).sum() == 1
    assert depth[2, 2] == 5


def test_tsdf_axial_plane_geometry():
    volume = module.tsdf_volume(voxel_size=.05, block_count=1000)
    rgb = np.full((48, 64, 3), 127, np.uint8)
    depth = np.full((48, 64), 2.013, np.float32)
    intrinsic = np.array([[50., 0, 32], [0, 50., 24], [0, 0, 1]])
    module.integrate_depth(volume, rgb, depth, intrinsic, np.eye(4))
    mesh = volume.extract_triangle_mesh(weight_threshold=.1).to_legacy()
    assert len(mesh.triangles) > 100
    assert np.max(np.abs(np.asarray(mesh.vertices)[:, 2] - 2.013)) < .01
