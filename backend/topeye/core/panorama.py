"""LiDAR-shaped equirectangular panorama generation for Surround 3D."""

import cv2
import numpy as np

DEPTH_WIDTH = 1024
DEPTH_HEIGHT = 512
COLOR_WIDTH = 4096
COLOR_HEIGHT = 2048
MAX_DEPTH_M = 60.0
MIN_DEPTH_M = 0.5


def panorama_directions(width, height, row_start=0, row_stop=None):
    """Return unit rays for the mandatory +y-forward equirectangular convention."""
    row_stop = height if row_stop is None else row_stop
    u = np.arange(width, dtype=np.float32)
    v = np.arange(row_start, row_stop, dtype=np.float32)
    phi = (u + 0.5) * (2 * np.pi / width) - np.pi
    theta = np.pi / 2 - (v + 0.5) * (np.pi / height)
    cos_theta = np.cos(theta)[:, None]
    directions = np.empty((len(v), width, 3), np.float32)
    directions[:, :, 0] = cos_theta * np.sin(phi)[None]
    directions[:, :, 1] = cos_theta * np.cos(phi)[None]
    directions[:, :, 2] = np.sin(theta)[:, None]
    return directions


def camera_center(frame):
    """Mean optical center in the frame's LIDAR_TOP coordinates."""
    centers = []
    for _, _, calib, _ in frame.cameras.values():
        rotation = np.asarray(calib.T_lidar_cam[:3, :3], dtype=np.float64)
        translation = np.asarray(calib.T_lidar_cam[:3, 3], dtype=np.float64)
        centers.append(-(rotation.T @ translation))
    if not centers:
        raise ValueError("no_camera_center")
    return np.mean(centers, axis=0)


def _fill_depth_columns(depth):
    rows = np.broadcast_to(np.arange(depth.shape[0])[:, None], depth.shape)
    measured = np.isfinite(depth)
    above = np.maximum.accumulate(np.where(measured, rows, -1), axis=0)
    below = np.minimum.accumulate(
        np.where(measured, rows, depth.shape[0])[::-1], axis=0
    )[::-1]
    top = np.take_along_axis(depth, np.maximum(above, 0), axis=0)
    bottom = np.take_along_axis(depth, np.minimum(below, depth.shape[0] - 1), axis=0)
    span = below - above
    with np.errstate(invalid="ignore", divide="ignore"):
        delta = bottom - top
        fill = (
            (~measured)
            & (above >= 0)
            & (below < depth.shape[0])
            & (span <= 12)
            & (np.abs(delta) < 1.0)
        )
        interpolated = top + delta * (rows - above) / span
    result = depth.copy()
    result[fill] = interpolated[fill]
    return result


def smooth_upper_depth(depth):
    """Suppress isolated upper-hemisphere noise without blurring ground geometry."""
    depth = np.asarray(depth, np.float32)
    if depth.ndim != 2:
        raise ValueError("Expected depth (H,W)")
    result = depth.copy()
    horizon = depth.shape[0] // 2
    upper = cv2.medianBlur(result[:horizon], 5)
    result[:horizon] = cv2.bilateralFilter(
        upper, d=0, sigmaColor=1.5, sigmaSpace=3.0
    )
    return result


def _ground_depth(directions, center, grid, extent_m=60.0):
    finite = np.isfinite(grid)
    if not finite.any():
        raise ValueError("no_ground")
    ground_z = float(np.median(grid[finite]))
    dz = directions[:, :, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        distance = (ground_z - center[2]) / dz
    resolution = 2 * extent_m / grid.shape[1]
    for _ in range(3):
        x = center[0] + distance * directions[:, :, 0]
        y = center[1] + distance * directions[:, :, 1]
        map_x = ((x + extent_m) / resolution - 0.5).astype(np.float32)
        map_y = ((y + extent_m) / resolution - 0.5).astype(np.float32)
        heights = cv2.remap(
            grid.astype(np.float32),
            map_x,
            map_y,
            cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=float("nan"),
        )
        heights = np.where(np.isfinite(heights), heights, ground_z)
        with np.errstate(divide="ignore", invalid="ignore"):
            distance = (heights - center[2]) / dz
    return distance


def build_depth_panorama(points, center, ground_grid, width=DEPTH_WIDTH, height=DEPTH_HEIGHT):
    """Project nearest LiDAR ranges, close bounded gaps, then intersect ground/sky."""
    points = np.asarray(points, dtype=np.float64)
    center = np.asarray(center, dtype=np.float64)
    if points.ndim != 2 or points.shape[1] < 3 or center.shape != (3,):
        raise ValueError("Expected points (N,>=3) and center (3,)")
    depth = np.full((height, width), np.inf, np.float32)
    delta = points[:, :3] - center
    distance = np.linalg.norm(delta, axis=1)
    valid = (distance > 0) & np.isfinite(distance) & np.isfinite(delta).all(axis=1)
    delta, distance = delta[valid], distance[valid]
    if len(distance):
        phi = np.arctan2(delta[:, 0], delta[:, 1])
        theta = np.arcsin(np.clip(delta[:, 2] / distance, -1, 1))
        u = np.floor((phi + np.pi) * (width / (2 * np.pi))).astype(int) % width
        v = np.floor((np.pi / 2 - theta) * (height / np.pi)).astype(int)
        inside = (v >= 0) & (v < height)
        np.minimum.at(depth, (v[inside], u[inside]), distance[inside])
    depth = _fill_depth_columns(depth)
    missing = ~np.isfinite(depth)
    directions = panorama_directions(width, height)
    below = directions[:, :, 2] < 0
    ground = _ground_depth(directions, center, np.asarray(ground_grid, np.float32))
    use_ground = missing & below & np.isfinite(ground) & (ground > 0)
    depth[use_ground] = ground[use_ground]
    depth[missing & ~use_ground] = MAX_DEPTH_M
    return np.clip(smooth_upper_depth(depth), MIN_DEPTH_M, MAX_DEPTH_M)


def _paint_cameras(surface, frame, images, gains, output, coverage, best, eligible=None):
    for name, (_, _, calib, _) in frame.cameras.items():
        image = images.get(name)
        if image is None:
            continue
        matrix = np.asarray(calib.T_lidar_cam, np.float32)
        camera = surface @ matrix[:3, :3].T + matrix[:3, 3]
        z = camera[:, :, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            projected = camera @ np.asarray(calib.K, np.float32).T
            u = projected[:, :, 0] / projected[:, :, 2]
            v = projected[:, :, 1] / projected[:, :, 2]
            angle = (camera[:, :, 0] ** 2 + camera[:, :, 1] ** 2) / (z ** 2)
        valid = (
            (z > 0.5)
            & (u >= 0)
            & (u < image.shape[1])
            & (v >= 0)
            & (v < image.shape[0])
            & (angle < best)
        )
        if eligible is not None:
            valid &= eligible
        rows, columns = np.nonzero(valid)
        if not len(rows):
            continue
        pixels = image[v[rows, columns].astype(int), u[rows, columns].astype(int)]
        gain = float(gains.get(name, 1.0))
        output[rows, columns] = np.clip(pixels * gain, 0, 255).astype(np.uint8)
        coverage[rows, columns] = 255
        best[rows, columns] = angle[rows, columns]


def _neighbor_retry_depth(distances, alpha, start, stop):
    """Pick a valid 3x3 neighbor's depth for uncovered edge pixels."""
    rows = np.arange(start, stop)
    uncovered = alpha[start:stop] == 0
    retry = np.full(uncovered.shape, np.nan, np.float32)
    valid = alpha > 0
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1),
                   (-1, -1), (-1, 1), (1, -1), (1, 1)):
        neighbor_rows = rows + dy
        inside = (neighbor_rows >= 0) & (neighbor_rows < alpha.shape[0])
        neighbor_rows = np.clip(neighbor_rows, 0, alpha.shape[0] - 1)
        neighbor_valid = np.roll(valid[neighbor_rows], -dx, axis=1)
        neighbor_valid &= inside[:, None]
        choose = uncovered & np.isnan(retry) & neighbor_valid
        if choose.any():
            neighbor_depth = np.roll(distances[neighbor_rows], -dx, axis=1)
            retry[choose] = neighbor_depth[choose]
    return retry


def _retry_edge_pixels(retry_depth, start, width, height, center, frame, images, gains,
                       color, alpha):
    local_rows, columns = np.nonzero(np.isfinite(retry_depth))
    if not len(local_rows):
        return
    rows = local_rows + start
    phi = (columns + 0.5) * (2 * np.pi / width) - np.pi
    theta = np.pi / 2 - (rows + 0.5) * (np.pi / height)
    cos_theta = np.cos(theta)
    rays = np.column_stack((np.sin(phi) * cos_theta,
                            np.cos(phi) * cos_theta, np.sin(theta))).astype(np.float32)
    surface = center + retry_depth[local_rows, columns, None] * rays
    best = np.full(len(rows), np.inf, np.float32)
    for name, (_, _, calib, _) in frame.cameras.items():
        image = images.get(name)
        if image is None:
            continue
        matrix = np.asarray(calib.T_lidar_cam, np.float32)
        camera = surface @ matrix[:3, :3].T + matrix[:3, 3]
        z = camera[:, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            projected = camera @ np.asarray(calib.K, np.float32).T
            u = projected[:, 0] / projected[:, 2]
            v = projected[:, 1] / projected[:, 2]
            angle = (camera[:, 0] ** 2 + camera[:, 1] ** 2) / (z ** 2)
        valid = ((z > 0.5) & (u >= 0) & (u < image.shape[1])
                 & (v >= 0) & (v < image.shape[0]) & (angle < best))
        selected = np.nonzero(valid)[0]
        if not len(selected):
            continue
        pixels = image[v[selected].astype(int), u[selected].astype(int)]
        gain = float(gains.get(name, 1.0))
        color[rows[selected], columns[selected]] = np.clip(
            pixels * gain, 0, 255
        ).astype(np.uint8)
        alpha[rows[selected], columns[selected]] = 255
        best[selected] = angle[selected]


def render_color_panorama(
    depth,
    center,
    frame,
    images,
    gains,
    width=COLOR_WIDTH,
    height=COLOR_HEIGHT,
    chunk_rows=64,
):
    """Project depth-derived surface into the smallest-optical-angle valid camera."""
    depth = np.asarray(depth, np.float32)
    center = np.asarray(center, np.float32)
    if depth.ndim != 2 or center.shape != (3,):
        raise ValueError("Expected depth (H,W) and center (3,)")
    distances = cv2.resize(depth, (width, height), interpolation=cv2.INTER_LINEAR)
    color = np.zeros((height, width, 3), np.uint8)
    alpha = np.zeros((height, width), np.uint8)
    for start in range(0, height, chunk_rows):
        stop = min(height, start + chunk_rows)
        rays = panorama_directions(width, height, start, stop)
        surface = center + distances[start:stop, :, None] * rays
        best = np.full((stop - start, width), np.inf, np.float32)
        output = color[start:stop]
        coverage = alpha[start:stop]
        _paint_cameras(surface, frame, images, gains, output, coverage, best)
    for start in range(0, height, chunk_rows):
        stop = min(height, start + chunk_rows)
        retry_depth = _neighbor_retry_depth(distances, alpha, start, stop)
        _retry_edge_pixels(
            retry_depth, start, width, height, center, frame, images, gains, color, alpha
        )
    alpha_small = cv2.resize(
        alpha, (depth.shape[1], depth.shape[0]), interpolation=cv2.INTER_AREA
    )
    alpha_small[alpha_small > 0] = 255
    return color, alpha_small


def build_panorama(frame, points, images, ground_grid, gains):
    center = camera_center(frame)
    depth = build_depth_panorama(points, center, ground_grid)
    color, alpha = render_color_panorama(depth, center, frame, images, gains)
    metadata = {
        "center": [float(value) for value in center],
        "width": COLOR_WIDTH,
        "height": COLOR_HEIGHT,
        "depth_width": DEPTH_WIDTH,
        "depth_height": DEPTH_HEIGHT,
        "depth_unit_m": 0.001,
        "max_depth_m": MAX_DEPTH_M,
    }
    return color, alpha, depth, metadata
