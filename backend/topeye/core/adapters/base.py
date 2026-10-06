"""Dataset interface and errors surfaced to CLI/API callers."""

from typing import Protocol

import numpy as np

from topeye.core.types import Box3D, FrameInfo


class DatasetError(Exception):
    """Dataset metadata or requested sensor data cannot be read."""


class DatasetAdapter(Protocol):
    def scenes(self) -> list[str]: ...
    def frames(self, scene: str) -> list[FrameInfo]: ...
    def load_points(self, frame: FrameInfo) -> np.ndarray: ...
    def sweep_frames(self, scene: str) -> list[FrameInfo]: ...
    def gt_boxes(self, frame: FrameInfo) -> list[Box3D] | None: ...
