"""Shared geometry in the frame's native LIDAR_TOP coordinate system."""

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class CameraCalib:
    name: str
    K: np.ndarray
    T_lidar_cam: np.ndarray
    width: int
    height: int


@dataclass(frozen=True)
class FrameInfo:
    frame_id: str
    scene: str
    index: int
    lidar_path: Path
    lidar_ts_us: int
    T_world_lidar: np.ndarray
    cameras: dict[str, tuple[Path, int, CameraCalib, np.ndarray]]


@dataclass
class Box3D:
    cx: float
    cy: float
    cz: float
    l: float
    w: float
    h: float
    yaw: float
    label: str


@dataclass
class GTBox3D(Box3D):
    annotation_token: str
    instance_token: str
