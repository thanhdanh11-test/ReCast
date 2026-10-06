"""Sweep-supported static geometry and robust camera colours (SPEC-S4 Q1)."""

from dataclasses import replace
from functools import lru_cache

import cv2
import numpy as np

from topeye.core.bev import BEVScene, outside_boxes, transform
from topeye.core.colorize import colorize
from topeye.core.ground import cell_quantile, ground_mask
from topeye.core.types import Box3D


def _transform_box(box, matrix):
    center = transform(np.array([[box.cx, box.cy, box.cz]]), matrix)[0]
    heading = matrix[:3, :3] @ [np.cos(box.yaw), np.sin(box.yaw), 0]
    return replace(box, cx=float(center[0]), cy=float(center[1]), cz=float(center[2]),
                   yaw=float(np.arctan2(heading[1], heading[0])))


def sweep_boxes(adapter, scene, max_gap_s: float = 0.25) -> dict[str, list[Box3D]]:
    """Interpolate all annotation categories in world, then return sweep-local boxes."""
    if not np.isfinite(max_gap_s) or max_gap_s < 0:
        raise ValueError("max_gap_s must be finite and non-negative")
    frames = sorted(adapter.frames(scene), key=lambda f: f.lidar_ts_us)
    timestamps = np.array([f.lidar_ts_us for f in frames])
    original = [adapter.mask_boxes(f) or [] for f in frames]
    world = [{b.instance_token: _transform_box(b, f.T_world_lidar) for b in boxes}
             for f, boxes in zip(frames, original)]
    result = {}
    for sweep in adapter.sweep_frames(scene):
        t = sweep.lidar_ts_us
        right = int(np.searchsorted(timestamps, t))
        if right < len(frames) and timestamps[right] == t:
            result[sweep.frame_id] = original[right]
            continue
        left = right - 1
        before = world[left] if left >= 0 else {}
        after = world[right] if right < len(frames) else {}
        boxes = []
        inverse = np.linalg.inv(sweep.T_world_lidar)
        for token in sorted(before.keys() | after.keys()):
            a, b = before.get(token), after.get(token)
            if a is not None and b is not None:
                alpha = (t - timestamps[left]) / (timestamps[right] - timestamps[left])
                delta = np.arctan2(np.sin(b.yaw - a.yaw), np.cos(b.yaw - a.yaw))
                box = replace(a, cx=a.cx + alpha * (b.cx - a.cx),
                              cy=a.cy + alpha * (b.cy - a.cy),
                              cz=a.cz + alpha * (b.cz - a.cz), yaw=a.yaw + alpha * delta)
            else:
                index, box = (left, a) if a is not None else (right, b)
                if abs(t - timestamps[index]) > max_gap_s * 1e6:
                    continue
            boxes.append(_transform_box(box, inverse))
        result[sweep.frame_id] = boxes
    return result


def static_points(adapter, scene, sweeps=None, pad_m: float = 0.4,
                  ego_radius_m: float = 2.5, return_range: bool = False) -> tuple:
    """Return world XYZ, RGB (-1 unseen), sweep IDs, optionally sensor ranges in metres."""
    if not np.isfinite(pad_m) or pad_m < 0:
        raise ValueError("pad_m must be finite and non-negative")
    if not np.isfinite(ego_radius_m) or ego_radius_m < 0:
        raise ValueError("ego_radius_m must be finite and non-negative")
    sweeps = list(adapter.sweep_frames(scene) if sweeps is None else sweeps)
    if not sweeps:
        result = (np.empty((0, 3)), np.empty((0, 3), np.float32), np.empty(0, np.int32))
        return (*result, np.empty(0)) if return_range else result
    boxes = sweep_boxes(adapter, scene)
    bev = BEVScene(adapter, scene)
    gains = bev.gains.copy()
    bev.camera.cache_clear()
    del bev

    @lru_cache(maxsize=6)
    def image(path, gain):
        pixels = cv2.imread(str(path))
        if pixels is None:
            return None
        return np.clip(pixels.astype(np.float32) * gain, 0, 255)

    xyz, rgb, indices, ranges = [], [], [], []
    sweep_ids = {}
    for sweep in sweeps:
        index = sweep_ids.setdefault(sweep.frame_id, len(sweep_ids))
        points = adapter.load_points(sweep)
        padded = [replace(b, l=b.l + pad_m, w=b.w + pad_m, h=b.h + pad_m)
                  for b in boxes[sweep.frame_id]]
        keep = (outside_boxes(points, padded) & ~ground_mask(points)
                & (np.linalg.norm(points[:, :2], axis=1) >= ego_radius_m))
        images = {name: image(path, gains.get(name, 1.0))
                  for name, (path, *_rest) in sweep.cameras.items()}
        colored = colorize(points[keep], sweep, images)
        xyz.append(transform(colored, sweep.T_world_lidar))
        rgb.append(colored[:, 4:7])
        indices.append(np.full(len(colored), index, np.int32))
        if return_range:
            ranges.append(np.linalg.norm(points[keep, :3], axis=1))
    image.cache_clear()
    result = (np.concatenate(xyz), np.concatenate(rgb), np.concatenate(indices))
    return (*result, np.concatenate(ranges)) if return_range else result


def static_voxels(xyz, rgb, sweep_index, voxel_m: float = 0.2,
                  min_sweeps: int = 3, range_m=None,
                  near_fraction: float = 0.25,
                  exposure: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Keep sweep-supported voxels; median nearest seen RGB, or neutral grey.

    Without ranges, preserve the median of all seen observations.
    """
    if not np.isfinite(voxel_m) or voxel_m <= 0:
        raise ValueError("voxel_m must be finite and positive")
    if not isinstance(min_sweeps, (int, np.integer)) or min_sweeps < 1:
        raise ValueError("min_sweeps must be a positive integer")
    xyz, rgb, sweep_index = np.asarray(xyz), np.asarray(rgb), np.asarray(sweep_index)
    if xyz.ndim != 2 or xyz.shape[1] != 3 or rgb.shape != xyz.shape:
        raise ValueError("xyz and rgb must have matching (N,3) shapes")
    if sweep_index.shape != (len(xyz),):
        raise ValueError("sweep_index must have shape (N,)")
    if not np.isfinite(xyz).all() or not np.isfinite(rgb).all():
        raise ValueError("xyz and rgb must be finite")
    if not np.isfinite(near_fraction) or not 0 < near_fraction <= 1:
        raise ValueError("near_fraction must be in (0, 1]")
    if exposure is not None and (not np.isfinite(exposure) or not 1 <= exposure <= 1.6):
        raise ValueError("exposure must be finite and in [1, 1.6]")
    if range_m is not None:
        range_m = np.asarray(range_m)
        if (range_m.shape != (len(xyz),) or not np.isfinite(range_m).all()
                or (range_m < 0).any()):
            raise ValueError("range_m must be finite, nonnegative and have shape (N,)")
    keys, inverse = np.unique(np.floor(xyz / voxel_m).astype(np.int64), axis=0,
                              return_inverse=True)
    inverse = inverse.ravel()
    pairs = np.unique(np.column_stack((inverse, sweep_index)), axis=0)
    support = np.bincount(pairs[:, 0].astype(np.int64), minlength=len(keys))
    keep = support >= min_sweeps
    seen = (rgb >= 0).all(axis=1) & keep[inverse]
    if range_m is not None:
        ids = np.flatnonzero(seen)
        order = ids[np.lexsort((range_m[ids], inverse[ids]))]
        groups, starts, counts = np.unique(inverse[order], return_index=True, return_counts=True)
        ranks = np.arange(len(order)) - np.repeat(starts, counts)
        limit = np.zeros(len(keys), np.int64)
        limit[groups] = np.ceil(counts * near_fraction).astype(np.int64)
        seen[:] = False
        seen[order[ranks < limit[inverse[order]]]] = True
    colors = np.full((len(keys), 3), 128.0)
    for channel in range(3):
        median = cell_quantile(inverse[seen], rgb[seen, channel], len(keys), 0.5)
        valid = np.isfinite(median)
        colors[valid, channel] = median[valid]
    colors = colors[keep]
    if exposure is not None:
        colors *= exposure
    return keys[keep], np.clip(np.rint(colors), 0, 255).astype(np.uint8)


def camera_exposure(adapter, scene, voxel_rgb) -> float:
    """Scene gain: camera-pixel median luminance divided by voxel median, clipped [1, 1.6].

    Sample a regular 16-pixel lattice in every keyframe after the existing camera gains.
    Empty colours or a zero voxel median need no correction.
    """
    voxel_rgb = np.asarray(voxel_rgb)
    if (voxel_rgb.ndim != 2 or voxel_rgb.shape[1] != 3
            or not np.isfinite(voxel_rgb).all() or (voxel_rgb < 0).any()
            or (voxel_rgb > 255).any()):
        raise ValueError("voxel_rgb must have shape (N, 3) with finite colours in [0, 255]")
    weights = np.array([.2126, .7152, .0722])
    if not len(voxel_rgb):
        return 1.0
    denominator = float(np.median(voxel_rgb @ weights))
    if denominator <= 0:
        return 1.0
    bev = BEVScene(adapter, scene)
    samples = []
    try:
        for frame in bev.frames:
            for name in frame.cameras:
                image, _ = bev.camera(frame.index, name)
                if image is None:
                    raise ValueError(f"Cannot read camera {name} at frame {frame.index}")
                rgb = image[::16, ::16, ::-1].astype(np.float32)
                rgb = np.clip(rgb * bev.gains[name], 0, 255)
                samples.append((rgb @ weights).ravel())
            bev.camera.cache_clear()
    finally:
        bev.camera.cache_clear()
    if not samples:
        return 1.0
    return float(np.clip(np.median(np.concatenate(samples)) / denominator, 1, 1.6))
