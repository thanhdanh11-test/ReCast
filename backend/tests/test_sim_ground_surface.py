"""Ground surface geometry, support and raster-orientation contracts."""

import numpy as np
import pytest

from topeye.sim.ground_surface import ground_surface


def plane():
    rows, cols = np.indices((20, 20))
    z = 0.02 * cols + 0.01 * rows
    points = np.column_stack(((cols.ravel() + 0.5) * 0.5,
                              (rows.ravel() + 0.5) * 0.5, z.ravel(), np.ones(400)))
    return points, z


def test_sloped_plane_hole_is_filled():
    points, expected = plane()
    keep = ~((points[:, 0] > 3) & (points[:, 0] < 7)
             & (points[:, 1] > 3) & (points[:, 1] < 7))
    grid = ground_surface(points[keep], (0, 0, 10, 10), np.full((100, 100), 255, np.uint8))
    assert grid.shape == (20, 20)
    assert grid.dtype == np.float32
    assert np.isfinite(grid).all()
    assert np.max(np.abs(grid - expected)) < 0.05


def test_support_radius_and_top_down_drivable():
    road = np.zeros((100, 100), np.uint8)
    road[:10] = 255
    grid = ground_surface(np.array([[0.25, 0.25, 2, 0]]), (0, 0, 10, 10), road, fill_m=1)
    assert np.isfinite(grid[0, 2])
    assert np.isnan(grid[0, 3])
    assert np.isnan(grid[2, 2])
    assert np.isnan(grid[10, 10])
    assert np.all(grid[-2:] == 2)


def test_five_metre_spike_is_rejected():
    points, expected = plane()
    points[210, 2] += 5
    grid = ground_surface(points, (0, 0, 10, 10), np.full((100, 100), 255, np.uint8))
    assert abs(grid[10, 10] - expected[10, 10]) < 0.05


def test_observed_cell_smoothing_is_bounded():
    points, _ = plane()
    points[210, 2] += 0.29
    grid = ground_surface(points, (0, 0, 10, 10), np.full((100, 100), 255, np.uint8))
    assert np.max(np.abs(grid.ravel() - points[:, 2])) <= 0.100001


def test_cell_median_and_nan_normalization():
    points = np.array([[1.25, 1.25, 2, 0], [1.25, 1.25, 2, 0], [1.25, 1.25, 8, 0]])
    grid = ground_surface(points, (0, 0, 3, 3), np.zeros((30, 30), np.uint8), fill_m=0)
    assert np.isfinite(grid).sum() == 1
    assert grid[2, 2] == 2


def test_collinear_observations_use_nearest_fallback():
    points = np.array([[0.25, 0.25, 2, 0], [0.75, 0.25, 2, 0], [1.25, 0.25, 2, 0]])
    grid = ground_surface(points, (0, 0, 2, 2), np.full((20, 20), 255, np.uint8))
    assert np.all(grid == 2)


def test_empty_input_has_no_invented_ground():
    grid = ground_surface(np.empty((0, 4)), (-1, -2, 1.1, 1.1),
                          np.full((31, 21), 255, np.uint8))
    assert grid.shape == (7, 5)
    assert np.isnan(grid).all()


def test_nonfinite_and_outside_points_are_ignored_without_mutation():
    points = np.array([[0.25, 0.25, 2, 0], [0, 0, np.nan, 0], [2, 2, 9, 0],
                       [-1, -1, 8, 0], [np.inf, 0, 1, 0]])
    saved = points.copy()
    road = np.full((20, 20), 255, np.uint8)
    grid = ground_surface(points, (0, 0, 2, 2), road)
    assert np.all(grid == 2)
    np.testing.assert_array_equal(points, saved)
    assert np.all(road == 255)


@pytest.mark.parametrize("kwargs", [{"res_m": 0}, {"tex_res_m": -1}, {"fill_m": -1},
                                    {"res_m": np.nan}])
def test_invalid_resolution_and_radius(kwargs):
    with pytest.raises(ValueError):
        ground_surface(np.empty((0, 4)), (0, 0, 1, 1), np.zeros((10, 10)), **kwargs)


def test_invalid_shapes_and_bounds():
    for points, bounds, road in [(np.empty((0, 3)), (0, 0, 1, 1), np.zeros((10, 10))),
                                  (np.empty((0, 4)), (0, 0, 0, 1), np.zeros((10, 10))),
                                  (np.empty((0, 4)), (0, 0, 1, 1), np.zeros((2, 2)))]:
        with pytest.raises(ValueError):
            ground_surface(points, bounds, road)
