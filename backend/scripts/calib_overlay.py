"""Generate the specified scene's calibration overlays without modifying source data."""

import argparse
from pathlib import Path

import cv2

from topeye.config import load_config
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.calib_check import render_overlay

parser = argparse.ArgumentParser()
parser.add_argument("--scene", required=True)
parser.add_argument("--frames", required=True)
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args()
adapter = NuScenesAdapter(load_config().nusc_root)
frames = adapter.frames(args.scene)
args.out.mkdir(parents=True, exist_ok=True)
for index in map(int, args.frames.split(",")):
    frame = frames[index]
    points = adapter.load_points(frame)
    for cam in frame.cameras:
        target = args.out / f"{frame.frame_id}_{cam}.jpg"
        if not cv2.imwrite(str(target), render_overlay(frame, points, cam)):
            raise OSError(f"Cannot write {target}")
        print(target)
