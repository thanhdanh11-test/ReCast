"""Masked single-source IPM mosaic, with target-frame object points."""

from functools import lru_cache
from itertools import combinations, product

import cv2
import numpy as np

from topeye.core.adapters.base import DatasetError
from topeye.core.colorize import colorize
from topeye.core.ground import ground_mask, ground_support, height_grid


def transform(points, matrix):
    return points[:, :3] @ matrix[:3, :3].T + matrix[:3, 3]


def outside_boxes(points, boxes):
    keep = np.ones(len(points), bool)
    for box in boxes:
        delta = points[:, :3] - [box.cx, box.cy, box.cz]
        c, s = np.cos(box.yaw), np.sin(box.yaw)
        x, y = delta[:, 0] * c + delta[:, 1] * s, -delta[:, 0] * s + delta[:, 1] * c
        keep &= ~(
            (np.abs(x) <= box.l / 2) & (np.abs(y) <= box.w / 2) & (np.abs(delta[:, 2]) <= box.h / 2)
        )
    return keep


def box_mask(boxes, calib, pad=0.3):
    """Convex silhouettes (each side grown by pad metres), clipped at the 0.5 m near plane."""
    mask = np.zeros((calib.height, calib.width), np.uint8)
    signs = np.array(list(product((-1, 1), repeat=3)))
    edges = [
        (a, b)
        for a in range(8)
        for b in range(a + 1, 8)
        if np.count_nonzero(signs[a] != signs[b]) == 1
    ]
    for box in boxes:
        corners = signs * (np.array([box.l, box.w, box.h]) / 2 + pad)
        c, s = np.cos(box.yaw), np.sin(box.yaw)
        corners = corners @ np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])
        corners += [box.cx, box.cy, box.cz]
        camera = transform(corners, calib.T_lidar_cam)
        vertices = [camera[camera[:, 2] >= 0.5]]
        for a, b in edges:
            if (camera[a, 2] >= 0.5) != (camera[b, 2] >= 0.5):
                t = (0.5 - camera[a, 2]) / (camera[b, 2] - camera[a, 2])
                vertices.append((camera[a] + t * (camera[b] - camera[a]))[None])
        vertices = np.concatenate(vertices)
        if len(vertices) < 3:
            continue
        uv = vertices @ calib.K.T
        uv = np.clip(uv[:, :2] / uv[:, 2, None], -1e6, 1e6).astype(np.int32)
        cv2.fillConvexPoly(mask, cv2.convexHull(uv), 1)
    return mask


def source_window(frames, index, window):
    count = min(len(frames), 2 * window + 1)
    start = min(max(0, index - window), len(frames) - count)
    return sorted(frames[start : start + count], key=lambda f: abs(f.index - index))


def depth_buffer(points, calib):
    """Minimum camera-z from all source LiDAR returns in each 4x4 pixel bin."""
    camera = transform(points, calib.T_lidar_cam)
    projected = camera @ calib.K.T
    uv = projected[:, :2] / np.maximum(projected[:, 2, None], 1e-6)
    valid = (camera[:, 2] > 0.5) & np.isfinite(uv).all(axis=1)
    valid &= (uv[:, 0] >= 0) & (uv[:, 0] < calib.width)
    valid &= (uv[:, 1] >= 0) & (uv[:, 1] < calib.height)
    bins = (uv[valid] / 4).astype(int)
    buffer = np.full(((calib.height + 3) // 4, (calib.width + 3) // 4), np.inf)
    np.minimum.at(buffer, (bins[:, 1], bins[:, 0]), camera[valid, 2])
    return fill_depth_columns(buffer)


def fill_depth_columns(buffer):
    """Interpolate only bounded, short gaps between consistent measured depths."""
    rows = np.broadcast_to(np.arange(buffer.shape[0])[:, None], buffer.shape)
    measured = np.isfinite(buffer)
    above = np.maximum.accumulate(np.where(measured, rows, -1), axis=0)
    below = np.minimum.accumulate(
        np.where(measured, rows, len(buffer))[::-1], axis=0
    )[::-1]
    top = np.take_along_axis(buffer, np.maximum(above, 0), axis=0)
    bottom = np.take_along_axis(buffer, np.minimum(below, len(buffer) - 1), axis=0)
    bounded = (~measured) & (above >= 0) & (below < len(buffer))
    span = below - above
    with np.errstate(invalid="ignore"):
        delta = bottom - top
        fill = bounded & (span <= 12) & (np.abs(delta) < 1.0)
    result = buffer.copy()
    result[fill] = top[fill] + delta[fill] * (rows[fill] - above[fill]) / span[fill]
    return result


def sample_camera(points, image, calib, matrix, mask, depths=None):
    camera = transform(points, matrix).astype(np.float32)
    homogeneous = camera @ calib.K.astype(np.float32).T
    depth = camera[:, 2]
    uv = homogeneous[:, :2] / np.maximum(homogeneous[:, 2, None], 1e-6)
    valid = (
        (depth > 0.5)
        & (np.sum(camera ** 2, axis=1) <= 25.0 ** 2)
        & (uv[:, 0] >= 0)
        & (uv[:, 0] < image.shape[1])
        & (uv[:, 1] >= 0)
        & (uv[:, 1] < image.shape[0])
    )
    indices = np.flatnonzero(valid)
    pixels = uv[indices].astype(int)
    keep = mask[pixels[:, 1], pixels[:, 0]] == 0
    if depths is not None:
        keep &= depth[indices] <= depths[pixels[:, 1] // 4, pixels[:, 0] // 4] + 0.5
    indices, pixels = indices[keep], pixels[keep]
    return indices, image[pixels[:, 1], pixels[:, 0], ::-1], np.sum(camera[indices] ** 2, axis=1)


class BEVScene:
    """Scene-owned ground and gains; bounded image cache shared by frame jobs."""

    def __init__(self, adapter, scene):
        self.adapter = adapter
        self.frames = adapter.frames(scene)
        self.ground = {}
        self.masks = {}
        self.boxes = {}
        self.errors = {}
        self.depths = {}
        for frame in self.frames:
            try:
                points = adapter.load_points(frame)
                boxes = getattr(adapter, "mask_boxes", adapter.gt_boxes)(frame) or []
                self.depths[frame.index] = {
                    name: depth_buffer(points, camera[2])
                    for name, camera in frame.cameras.items()
                }
                mask = ground_mask(points)
                self.boxes[frame.index] = boxes
                self.masks[frame.index] = mask
                self.ground[frame.index] = transform(
                    points[mask & outside_boxes(points, boxes)], frame.T_world_lidar
                )
            except (OSError, ValueError, RuntimeError, DatasetError) as exc:
                self.errors[frame.index] = str(exc)
        self.camera = lru_cache(maxsize=66)(self._camera)
        self.gains = self._gains()

    def _camera(self, index, name):
        frame = self.frames[index]
        path, _, calib, _ = frame.cameras[name]
        image = cv2.imread(str(path))
        if image is None:
            return None, None
        return image, box_mask(self.boxes.get(index, []), calib)

    def _gains(self):
        ratios = {}
        names = sorted({name for frame in self.frames for name in frame.cameras})
        for frame in self.frames:
            world = self.ground.get(frame.index)
            if world is None or not len(world):
                continue
            samples = {}
            for name, (_, _, calib, pose) in frame.cameras.items():
                image, mask = self.camera(frame.index, name)
                if image is None:
                    continue
                ids, rgb, _ = sample_camera(
                    world, image, calib, np.linalg.inv(pose), mask, self.depths[frame.index][name]
                )
                luma = np.full(len(world), np.nan)
                luma[ids] = rgb @ np.array([0.2126, 0.7152, 0.0722])
                samples[name] = luma
            for a, b in combinations(samples, 2):
                valid = (
                    (samples[a] > 5) & (samples[b] > 5) & (samples[a] < 250) & (samples[b] < 250)
                )
                if valid.sum() >= 5:
                    ratios.setdefault((a, b), []).append(
                        np.median(samples[a][valid]) / np.median(samples[b][valid])
                    )
        gains = {"CAM_FRONT": 1.0}
        # Back cameras connect to the reference through adjacent overlap regions.
        for _ in names:
            for (a, b), values in ratios.items():
                ratio = float(np.median(values))
                if a in gains and b not in gains:
                    gains[b] = gains[a] * ratio
                elif b in gains and a not in gains:
                    gains[a] = gains[b] / ratio
        return {name: float(np.clip(gains.get(name, 1), 0.5, 2)) for name in names}

    def height_grid(self, frame_idx, window=5):
        frame = self.frames[frame_idx]
        sources = source_window(self.frames, frame_idx, window)
        world = np.concatenate([self.ground[f.index] for f in sources if f.index in self.ground])
        local = transform(world, np.linalg.inv(frame.T_world_lidar))
        grid = height_grid(local, np.ones(len(local), bool))
        return local, grid

    def build(self, frame_idx, window=5, colored=None, diagnostics=None):
        frame = self.frames[frame_idx]
        if frame_idx in self.errors:
            raise ValueError(self.errors[frame_idx])
        sources = source_window(self.frames, frame_idx, window)
        local, grid = self.height_grid(frame_idx, window)
        if not np.isfinite(grid).any():
            raise ValueError("no_ground")
        z = np.repeat(np.repeat(grid[::-1], 5, axis=0), 5, axis=1)
        support = ground_support(local)
        z[~support] = np.nan
        v, u = np.nonzero(np.isfinite(z))
        xyz = np.column_stack(((u + 0.5 - 600) * 0.1, (600 - v - 0.5) * 0.1, z[v, u]))
        xyz = xyz.astype(np.float32)
        rgba = np.zeros((1200, 1200, 4), np.uint8)
        colors = np.zeros((len(xyz), 4), np.uint8)
        best = np.full(len(xyz), np.inf, np.float32)
        if diagnostics is not None:
            second = np.full(len(xyz), np.inf, np.float32)
            second_colors = np.zeros((len(xyz), 3), np.uint8)
        for source in sources:
            for name, (_, _, calib, pose) in source.cameras.items():
                image, mask = self.camera(source.index, name)
                if image is None:
                    continue
                matrix = (np.linalg.inv(pose) @ frame.T_world_lidar).astype(np.float32)
                ids, rgb, distance = sample_camera(
                    xyz, image, calib, matrix, mask, self.depths[source.index][name]
                )
                rgb = np.clip(rgb * self.gains[name], 0, 255).astype(np.uint8)
                take = distance < best[ids]
                if diagnostics is not None:
                    replace_second = (~take) & (distance < second[ids])
                    second[ids[replace_second]] = distance[replace_second]
                    second_colors[ids[replace_second]] = rgb[replace_second]
                    second[ids[take]] = best[ids[take]]
                    second_colors[ids[take]] = colors[ids[take], :3]
                ids, rgb, distance = ids[take], rgb[take], distance[take]
                best[ids] = distance
                colors[ids, :3] = rgb
                colors[ids, 3] = 255
        if diagnostics is not None:
            overlap = np.isfinite(second)
            difference = np.abs(colors[:, :3].astype(float) - second_colors).mean(axis=1)
            inconsistent = int((overlap & (difference > 40)).sum())
            denominator = int(overlap.sum())
            diagnostics.update(
                inconsistency_pixels=inconsistent,
                multi_source_pixels=denominator,
                inconsistency_pct=100 * inconsistent / denominator if denominator else None,
            )
        rgba[v, u] = colors
        if colored is None:
            images = {name: self.camera(frame_idx, name)[0] for name in frame.cameras}
            colored = colorize(self.adapter.load_points(frame), frame, images)
        objects = colored[~self.masks[frame_idx]]
        uv = np.floor(
            np.column_stack((objects[:, 0] / 0.1 + 600, 600 - objects[:, 1] / 0.1))
        ).astype(int)
        keep = ((uv >= 0) & (uv < 1200)).all(axis=1)
        uv, objects = uv[keep], objects[keep]
        # The unknown-height invariant also applies to the object overlay.
        keep = np.isfinite(z[uv[:, 1], uv[:, 0]])
        uv, objects = uv[keep], objects[keep]
        rgb = objects[:, 4:].copy()
        missing = (rgb < 0).any(axis=1)
        rgb[missing] = np.clip(objects[missing, 3, None], 0, 255)
        rgba[uv[:, 1], uv[:, 0], :3] = rgb.astype(np.uint8)
        rgba[uv[:, 1], uv[:, 0], 3] = 255
        return rgba


def build_bev(adapter, scene, frame_idx, window=5):
    return BEVScene(adapter, scene).build(frame_idx, window)
