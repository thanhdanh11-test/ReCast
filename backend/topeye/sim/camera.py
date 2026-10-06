"""OpenCV pinhole camera <-> Blender camera parameters (01-CONTRACTS §2)."""

import numpy as np

SENSOR_WIDTH_MM = 36.0
# OpenCV camera axes (x right, y down, z forward) -> Blender (looks along -Z, y up).
CV_TO_BLENDER = np.diag([1.0, -1.0, -1.0, 1.0])


def blender_camera(K, width, height, T_world_cam):
    K = np.asarray(K, dtype=np.float64)
    T_world_cam = np.asarray(T_world_cam, dtype=np.float64)
    fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
    if K[0, 1] != 0 or abs(fx - fy) / fx >= 1e-3:
        raise ValueError("Blender camera requires square pixels and zero skew")
    return {
        "lens": fx * SENSOR_WIDTH_MM / width,
        "sensor_width": SENSOR_WIDTH_MM,
        "shift_x": (width / 2 - cx) / width,
        "shift_y": (cy - height / 2) / width,
        "resolution_x": int(width),
        "resolution_y": int(height),
        "matrix_world": (T_world_cam @ CV_TO_BLENDER).tolist(),
    }


def intrinsics_from_blender(params):
    width = params["resolution_x"]
    height = params["resolution_y"]
    f = params["lens"] * width / params["sensor_width"]
    return np.array(
        [
            [f, 0.0, width / 2 - params["shift_x"] * width],
            [0.0, f, height / 2 + params["shift_y"] * width],
            [0.0, 0.0, 1.0],
        ]
    )
