"""Bounded, drivable-aware ground height interpolation (SPEC-S4 Q2)."""

import numpy as np
from scipy.interpolate import griddata
from scipy.ndimage import distance_transform_edt, gaussian_filter, generic_filter
from scipy.spatial import QhullError

from topeye.core.ground import cell_quantile


def ground_surface(points: np.ndarray, bounds: tuple, drivable: np.ndarray,
                   res_m: float = 0.5, tex_res_m: float = 0.1,
                   fill_m: float = 3.0) -> np.ndarray:
    """Return float32 heights with row zero at ymin; unsupported cells are NaN.

    Input points are Nx4 world x/y/z/intensity; drivable row zero is at ymax.
    Retained observations move by at most 0.1 m from their cell median.
    """
    points = np.asarray(points)
    bounds = np.asarray(bounds, dtype=float)
    drivable = np.asarray(drivable)
    if points.ndim != 2 or points.shape[1] != 4:
        raise ValueError("points must have shape (N, 4)")
    if bounds.shape != (4,) or not np.isfinite(bounds).all():
        raise ValueError("bounds must contain four finite coordinates")
    if (not np.isfinite([res_m, tex_res_m, fill_m]).all()
            or res_m <= 0 or tex_res_m <= 0 or fill_m < 0):
        raise ValueError("resolutions must be positive and fill_m nonnegative")
    xmin, ymin, xmax, ymax = bounds
    if xmax <= xmin or ymax <= ymin:
        raise ValueError("bounds must have positive extents")
    tex_shape = tuple(np.ceil([(ymax - ymin) / tex_res_m,
                               (xmax - xmin) / tex_res_m]).astype(int))
    if drivable.shape != tex_shape:
        raise ValueError("drivable shape must match bounds and tex_res_m")
    width, height = np.ceil([(xmax - xmin) / res_m, (ymax - ymin) / res_m]).astype(int)
    inside = (np.isfinite(points[:, :3]).all(axis=1)
              & (points[:, 0] >= xmin) & (points[:, 0] < xmax)
              & (points[:, 1] >= ymin) & (points[:, 1] < ymax))
    xyz = points[inside, :3]
    cols = np.floor((xyz[:, 0] - xmin) / res_m).astype(int)
    rows = np.floor((xyz[:, 1] - ymin) / res_m).astype(int)
    ids = rows * width + cols
    counts = np.bincount(ids, minlength=height * width).reshape(height, width)
    grid = cell_quantile(ids, xyz[:, 2], height * width, 0.5).reshape(height, width)
    if not counts.any():
        return grid

    def finite_median(window):
        values = window[np.isfinite(window)]
        return np.median(values) if len(values) else np.nan

    local = generic_filter(grid, finite_median, size=5, mode="constant", cval=np.nan)
    grid[np.abs(grid - local) > 0.3] = np.nan
    known = np.isfinite(grid)
    if not known.any():
        return grid
    distance, nearest = distance_transform_edt(~known, sampling=res_m, return_indices=True)
    filled = grid[tuple(nearest)]
    rows, cols = np.indices(grid.shape)
    locations = np.column_stack((rows[known], cols[known]))
    missing = ~known
    if len(locations) >= 3 and missing.any():
        try:
            linear = griddata(locations, grid[known], (rows[missing], cols[missing]),
                              method="linear")
        except QhullError:
            # A single row/column (or collinear observations) has no 2D convex hull.
            pass
        else:
            filled[missing] = np.where(np.isfinite(linear), linear, filled[missing])
    u = np.floor((cols + 0.5) * res_m / tex_res_m).astype(int)
    v = np.floor((ymax - ymin - (rows + 0.5) * res_m) / tex_res_m).astype(int)
    in_raster = (u >= 0) & (u < tex_shape[1]) & (v >= 0) & (v < tex_shape[0])
    on_road = np.zeros(grid.shape, bool)
    on_road[in_raster] = drivable[v[in_raster], u[in_raster]] > 0
    valid = on_road | (distance <= fill_m + 1e-9)
    weight = gaussian_filter(valid.astype(float), sigma=1, mode="constant")
    total = gaussian_filter(np.where(valid, filled, 0).astype(float), sigma=1, mode="constant")
    result = np.full(grid.shape, np.nan, np.float32)
    result[valid] = total[valid] / weight[valid]
    result[known] = grid[known] + np.clip(result[known] - grid[known], -0.1, 0.1)
    return result
