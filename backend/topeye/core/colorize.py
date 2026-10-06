"""Nearest optical-axis camera selection with a four-pixel occlusion buffer."""

import numpy as np

from topeye.core.geometry import project


def colorize(points, frame, images):
    """Images are OpenCV BGR; output stores RGB float32, or -1 when unseen."""
    points = np.asarray(points)
    if points.ndim != 2 or points.shape[1] != 4:
        raise ValueError("Expected points (N,4)")
    result = np.full((len(points), 7), -1, dtype=np.float32)
    result[:, :4] = points
    best = np.full(len(points), np.inf)
    for name, (_, _, calib, _) in frame.cameras.items():
        image = images.get(name)
        if image is None:
            continue
        uv, depth = project(points, calib.K, calib.T_lidar_cam)
        height, width = image.shape[:2]
        indices = np.flatnonzero(
            (depth > 0.5)
            & (uv[:, 0] >= 0)
            & (uv[:, 0] < width)
            & (uv[:, 1] >= 0)
            & (uv[:, 1] < height)
        )
        pixels = uv[indices].astype(int)
        cells = (pixels[:, 1] // 4) * ((width + 3) // 4) + pixels[:, 0] // 4
        minimum = np.full(((height + 3) // 4) * ((width + 3) // 4), np.inf)
        np.minimum.at(minimum, cells, depth[indices])
        visible = depth[indices] < minimum[cells] + 0.3
        indices, pixels = indices[visible], pixels[visible]
        camera = points[indices, :3] @ calib.T_lidar_cam[:3, :3].T + calib.T_lidar_cam[:3, 3]
        angle = np.linalg.norm(camera[:, :2], axis=1) / camera[:, 2]
        chosen = angle < best[indices]
        indices, pixels = indices[chosen], pixels[chosen]
        best[indices] = angle[chosen]
        result[indices, 4:] = image[pixels[:, 1], pixels[:, 0], :3][:, ::-1]
    return result
