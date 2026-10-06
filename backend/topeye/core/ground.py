"""Ground segmentation and bounded nearest-neighbour height interpolation."""

import numpy as np
from scipy.spatial import cKDTree

try:
    import pypatchworkpp
except ImportError:
    pypatchworkpp = None


def ground_algorithm():
    return "patchworkpp" if pypatchworkpp is not None else "grid"


def cell_quantile(ids, values, size, quantile):
    """Exact linear quantile per occupied cell, without per-cell Python loops."""
    result = np.full(size, np.nan, np.float32)
    if not len(ids):
        return result
    order = np.lexsort((values, ids))
    cells, starts, counts = np.unique(ids[order], return_index=True, return_counts=True)
    positions = (counts - 1) * quantile
    low = np.floor(positions).astype(int)
    high = np.ceil(positions).astype(int)
    sorted_z = values[order]
    result[cells] = sorted_z[starts + low] * (1 - positions + low) + sorted_z[starts + high] * (
        positions - low
    )
    return result


def ground_mask(points):
    points = np.asarray(points)
    if not len(points):
        return np.zeros(0, bool)
    if pypatchworkpp is not None:
        params = pypatchworkpp.Parameters()
        params.verbose = False
        estimator = pypatchworkpp.patchworkpp(params)
        estimator.estimateGround(points[:, :4].astype(np.float64))
        mask = np.zeros(len(points), bool)
        mask[np.asarray(estimator.getGroundIndices(), dtype=int)] = True
        return mask
    xy = np.floor(points[:, :2]).astype(int)
    lower = xy.min(axis=0)
    xy -= lower
    width, height = xy.max(axis=0) + 1
    ids = xy[:, 1] * width + xy[:, 0]
    level = cell_quantile(ids, points[:, 2], width * height, 0.1).reshape(height, width)
    slope = np.zeros_like(level)
    for dy, dx in ((0, 1), (1, 0)):
        a = level[: height - dy, : width - dx]
        b = level[dy:, dx:]
        delta = np.nan_to_num(np.abs(a - b), nan=0)
        slope[: height - dy, : width - dx] = np.maximum(slope[: height - dy, : width - dx], delta)
        slope[dy:, dx:] = np.maximum(slope[dy:, dx:], delta)
    return (points[:, 2] < level.ravel()[ids] + 0.2) & (slope.ravel()[ids] < np.tan(np.deg2rad(15)))


def height_grid(points, mask, res_m=0.5, extent_m=60.0):
    size = round(2 * extent_m / res_m)
    xyz = np.asarray(points)[mask, :3]
    uv = np.floor((xyz[:, :2] + extent_m) / res_m).astype(int)
    valid = ((uv >= 0) & (uv < size)).all(axis=1)
    uv, xyz = uv[valid], xyz[valid]
    grid = cell_quantile(uv[:, 1] * size + uv[:, 0], xyz[:, 2], size * size, 0.5)
    grid = grid.reshape(size, size)
    # Copy only original observed neighbours: never propagate beyond radius three.
    filled = grid.copy()
    offsets = sorted(
        (dx * dx + dy * dy, dy, dx)
        for dy in range(-3, 4)
        for dx in range(-3, 4)
        if 0 < dx * dx + dy * dy <= 9
    )
    for _, dy, dx in offsets:
        ys, xs = slice(max(0, dy), min(size, size + dy)), slice(max(0, dx), min(size, size + dx))
        source = grid[max(0, -dy) : min(size, size - dy), max(0, -dx) : min(size, size - dx)]
        target = filled[ys, xs]
        take = np.isnan(target) & np.isfinite(source)
        target[take] = source[take]
    return filled


def ground_support(points, res_m=0.1, extent_m=60.0):
    """Exact XY distance from BEV pixel centres to actual accumulated ground."""
    size = round(2 * extent_m / res_m)
    if not len(points):
        return np.zeros((size, size), bool)
    v, u = np.indices((size, size))
    xy = np.column_stack(
        ((u.ravel() + 0.5) * res_m - extent_m, extent_m - (v.ravel() + 0.5) * res_m)
    )
    distance, _ = cKDTree(np.asarray(points)[:, :2]).query(xy, distance_upper_bound=1.000000001)
    return (distance <= 1.0).reshape(size, size)
