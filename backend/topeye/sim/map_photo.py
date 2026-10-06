"""Untrained Gaussian splats and closest-visible-camera ground orthophotos."""

import numpy as np

from topeye.core.bev import BEVScene, sample_camera, transform
from topeye.core.cache import atomic_write
from topeye.core.geometry import project
from topeye.sim.static_map import static_voxels

SPLAT_LIMIT = 3_000_000
SH_C0 = 0.28209479
SPLAT_FIELDS = ("x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2",
                "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3")


def _sample_far_camera(points, image, calib, matrix, mask, depths):
    """Extend the BEV visibility test to (25, 60] m without changing core."""
    uv, depth = project(points, calib.K, matrix)
    distance = np.sum(transform(points, matrix) ** 2, axis=1)
    valid = ((depth > .5) & (distance > 25 ** 2) & (distance <= 60 ** 2)
             & np.isfinite(uv).all(axis=1)
             & (uv[:, 0] >= 0) & (uv[:, 0] < image.shape[1])
             & (uv[:, 1] >= 0) & (uv[:, 1] < image.shape[0]))
    ids = np.flatnonzero(valid)
    pixels = uv[ids].astype(int)
    visible = ((mask[pixels[:, 1], pixels[:, 0]] == 0)
               & (depth[ids] <= depths[pixels[:, 1] // 4, pixels[:, 0] // 4] + .5))
    ids, pixels = ids[visible], pixels[visible]
    return ids, image[pixels[:, 1], pixels[:, 0], ::-1], distance[ids]


def export_splat(xyz, rgb, path, voxel_m: float = 0.1, scale_m: float = 0.07) -> int:
    """Write binary little-endian 3DGS PLY; caller supplies sweep-filtered static points."""
    if not np.isfinite(scale_m) or scale_m <= 0:
        raise ValueError("scale_m must be finite and positive")
    xyz, rgb = np.asarray(xyz), np.asarray(rgb)
    # static_voxels owns shape/finiteness validation and robust RGB aggregation.
    keys, colors = static_voxels(xyz, rgb, np.zeros(len(xyz), np.int32), voxel_m, 1)
    while len(keys) > SPLAT_LIMIT:
        voxel_m *= 2
        keys, colors = static_voxels(xyz, rgb, np.zeros(len(xyz), np.int32), voxel_m, 1)
    vertices = np.zeros(len(keys), dtype=[(name, "<f4") for name in SPLAT_FIELDS])
    centers = (keys + 0.5) * voxel_m
    for channel, axis in enumerate(("x", "y", "z")):
        vertices[axis] = centers[:, channel]
        vertices[f"f_dc_{channel}"] = (colors[:, channel] / 255.0 - 0.5) / SH_C0
        vertices[f"scale_{channel}"] = np.log(scale_m)
    vertices["opacity"] = np.log(9.0)
    vertices["rot_0"] = 1.0
    header = ("ply\nformat binary_little_endian 1.0\n"
              f"element vertex {len(vertices)}\n"
              + "".join(f"property float {name}\n" for name in SPLAT_FIELDS)
              + "end_header\n")
    atomic_write(path, header.encode("ascii") + vertices.tobytes())
    return len(vertices)


def ground_photo(adapter, scene, bounds, grid, res_m: float = 0.1,
                 grid_res_m: float = 0.5) -> np.ndarray:
    """RGB uint8 raster, row zero at ymax; unknown heights/colours stay zero.

    BEVScene supplies camera gains, box silhouettes and LiDAR depth buffers.
    Heights use ground_surface's row-zero-at-ymin convention.
    """
    bounds, grid = np.asarray(bounds, float), np.asarray(grid)
    if bounds.shape != (4,) or not np.isfinite(bounds).all():
        raise ValueError("bounds must contain four finite coordinates")
    if not np.isfinite([res_m, grid_res_m]).all() or min(res_m, grid_res_m) <= 0:
        raise ValueError("resolutions must be finite and positive")
    xmin, ymin, xmax, ymax = bounds
    if xmax <= xmin or ymax <= ymin:
        raise ValueError("bounds must have positive extents")
    grid_shape = tuple(np.ceil([(ymax - ymin) / grid_res_m,
                                (xmax - xmin) / grid_res_m]).astype(int))
    if grid.shape != grid_shape or np.isinf(grid).any():
        raise ValueError("grid must match bounds and grid_res_m, with finite heights or NaN")
    height, width = np.ceil([(ymax - ymin) / res_m, (xmax - xmin) / res_m]).astype(int)
    rows, cols = np.indices((height, width))
    x, y = xmin + (cols + 0.5) * res_m, ymax - (rows + 0.5) * res_m
    valid = (x < xmax) & (y >= ymin)
    u = np.clip(np.floor((x - xmin) / grid_res_m).astype(int), 0, grid.shape[1] - 1)
    v = np.clip(np.floor((y - ymin) / grid_res_m).astype(int), 0, grid.shape[0] - 1)
    z = grid[v, u]
    valid &= np.isfinite(z)
    xyz = np.column_stack((x[valid], y[valid], z[valid])).astype(np.float32)
    colors = np.zeros((len(xyz), 3), np.uint8)
    best = np.full(len(xyz), np.inf, np.float32)
    output = np.zeros((height, width, 3), np.uint8)
    if not len(xyz):
        return output
    bev = BEVScene(adapter, scene)
    try:
        if bev.errors:
            raise ValueError(f"Cannot build ground photo: {bev.errors}")
        for frame in bev.frames:
            for name, (_, _, calib, pose) in frame.cameras.items():
                # Near observations reuse BEV; far observations keep the same masks/depth test.
                distance2 = np.sum((xyz - pose[:3, 3]) ** 2, axis=1)
                ids = np.flatnonzero(distance2 <= 60 ** 2)
                if not len(ids):
                    continue
                image, mask = bev.camera(frame.index, name)
                if image is None:
                    raise ValueError(f"Cannot read camera {name} at frame {frame.index}")
                for far, sampler in ((False, sample_camera), (True, _sample_far_camera)):
                    source_ids = ids[(distance2[ids] > 25 ** 2) == far]
                    if not len(source_ids):
                        continue
                    local, rgb, distance = sampler(
                        xyz[source_ids], image, calib, np.linalg.inv(pose), mask,
                        bev.depths[frame.index][name])
                    selected = source_ids[local]
                    take = distance < best[selected]
                    selected = selected[take]
                    best[selected] = distance[take]
                    colors[selected] = np.clip(
                        rgb[take] * bev.gains[name], 0, 255).astype(np.uint8)
            bev.camera.cache_clear()
    finally:
        bev.camera.cache_clear()
    output[valid] = colors
    return output
