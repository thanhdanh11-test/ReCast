"""Float64 rigid transforms using column-vector destination-from-source notation."""

import numpy as np


def quaternion_to_matrix(quaternion) -> np.ndarray:
    """Convert a nonzero finite quaternion in w,x,y,z order to a 3x3 rotation."""
    q = np.asarray(quaternion, dtype=np.float64)
    if q.shape != (4,) or not np.isfinite(q).all() or not np.any(q):
        raise ValueError("Quaternion must contain four finite values and be nonzero")
    q = q / np.max(np.abs(q))
    w, x, y, z = q / np.linalg.norm(q)
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


def transform_matrix(translation, rotation) -> np.ndarray:
    """Build a 4x4 transform from translation and a w,x,y,z quaternion."""
    translation = np.asarray(translation, dtype=np.float64)
    if translation.shape != (3,) or not np.isfinite(translation).all():
        raise ValueError("Translation must contain three finite values")
    result = np.eye(4, dtype=np.float64)
    result[:3, :3] = quaternion_to_matrix(rotation)
    result[:3, 3] = translation
    return result


def project(points: np.ndarray, K: np.ndarray, T: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (uv Nx2, depth N); uv is NaN for depth <= 0, without dropping rows.

    Points have at least xyz columns. K is 3x3 pinhole intrinsics and T maps
    the input frame to camera coordinates. Bounds/near-plane filtering is caller-owned.
    """
    points = np.asarray(points, dtype=np.float64)
    K, T = np.asarray(K, dtype=np.float64), np.asarray(T, dtype=np.float64)
    if points.ndim != 2 or points.shape[1] < 3 or K.shape != (3, 3) or T.shape != (4, 4):
        raise ValueError("Expected points (N,>=3), K (3,3), T (4,4)")
    if not all(np.isfinite(a).all() for a in (points[:, :3], K, T)):
        raise ValueError("Projection geometry must be finite")
    camera = points[:, :3] @ T[:3, :3].T + T[:3, 3]
    depth = camera[:, 2].copy()
    homogeneous = camera @ K.T
    uv = np.full((len(points), 2), np.nan, dtype=np.float64)
    valid = (depth > 0) & (homogeneous[:, 2] != 0)
    uv[valid] = homogeneous[valid, :2] / homogeneous[valid, 2, None]
    return uv, depth
