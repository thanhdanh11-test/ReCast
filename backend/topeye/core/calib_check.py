"""Timestamp checks and depth overlays, with thresholds owned by configuration."""

import cv2
import numpy as np

from topeye.config import load_config
from topeye.core.geometry import project


def calib_report(adapter, scene, config=None):
    config = config or load_config()
    deltas = {}
    for frame in adapter.frames(scene):
        for name, (_, timestamp, _, _) in frame.cameras.items():
            deltas.setdefault(name, []).append(abs(timestamp - frame.lidar_ts_us) / 1000)
    cameras = {
        name: {"dt_ms_mean": float(np.mean(values)), "dt_ms_max": max(values), "n": len(values)}
        for name, values in deltas.items()
    }
    maximum = max((c["dt_ms_max"] for c in cameras.values()), default=float("inf"))
    verdict = (
        "ok"
        if maximum <= config.calib_ok_ms
        else "warn"
        if maximum <= config.calib_warn_ms
        else "fail"
    )
    return {"scene": scene, "cameras": cameras, "verdict": verdict}


def render_overlay(frame, points, cam):
    path, _, calib, _ = frame.cameras[cam]
    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(f"Cannot decode image: {path}")
    uv, depth = project(points, calib.K, calib.T_lidar_cam)
    valid = (
        (depth > 0.5)
        & (uv[:, 0] >= 0)
        & (uv[:, 0] < image.shape[1])
        & (uv[:, 1] >= 0)
        & (uv[:, 1] < image.shape[0])
    )
    colors = cv2.applyColorMap(
        np.uint8(np.clip(depth[valid] / 60, 0, 1) * 255), cv2.COLORMAP_TURBO
    ).reshape(-1, 3)
    for pixel, color in zip(uv[valid].astype(int), colors):
        cv2.circle(image, tuple(pixel), 2, tuple(map(int, color)), -1)
    return image
