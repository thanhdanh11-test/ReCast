"""YOLO 2D and LIDAR-frame 3D labels for rendered runs (SPEC-S3 §4)."""

import json
import logging
from pathlib import Path

import cv2
import numpy as np

from topeye.core.bev import box_mask
from topeye.core.cache import atomic_write, write_json
from topeye.core.types import Box3D, CameraCalib
from topeye.sim.layout import CLASSES, world_yaw

logger = logging.getLogger(__name__)

MIN_VISIBLE_RATIO = 0.1
MIN_BOX_PX = 4


def actor_boxes_lidar(layout, frame):
    """(track, Box3D in the frame's LIDAR coordinates) for actors keyed at that frame."""
    record = next(item for item in layout["frames"] if item["index"] == frame)
    T_lidar_world = np.linalg.inv(np.asarray(record["T_world_lidar"]))
    result = []
    for actor in layout["actors"]:
        key = next((key for key in actor["keys"] if key["frame"] == frame), None)
        if key is None:
            continue
        center = T_lidar_world[:3, :3] @ key["center"] + T_lidar_world[:3, 3]
        yaw = world_yaw(T_lidar_world, key["yaw"])
        yaw = float(np.arctan2(np.sin(yaw), np.cos(yaw)))
        result.append((actor["track"], Box3D(*map(float, center), *actor["size"], yaw,
                                             actor["label"])))
    return result


def camera_calib(name, camera, T_world_lidar, scale=1.0):
    K = np.asarray(camera["K"], np.float64).copy()
    K[:2] *= scale
    T_cam_lidar = np.linalg.inv(np.asarray(camera["T_world_cam"])) @ np.asarray(T_world_lidar)
    return CameraCalib(name, K, T_cam_lidar, round(camera["width"] * scale),
                       round(camera["height"] * scale))


def yolo_lines(boxes, calib, visibility):
    """One `class cx cy w h` line per box passing the visibility and size filters."""
    lines, dropped = [], 0
    for track, box in boxes:
        seen = visibility.get(track)
        if not seen or not seen["samples"] or seen["visible"] / seen["samples"] < MIN_VISIBLE_RATIO:
            dropped += seen is not None
            continue
        mask = box_mask([box], calib, pad=0.0)
        if not mask.any():
            dropped += 1
            continue
        x, y, w, h = cv2.boundingRect(mask)
        if w < MIN_BOX_PX or h < MIN_BOX_PX:
            dropped += 1
            continue
        lines.append(f"{CLASSES.index(box.label)} {(x + w / 2) / calib.width:.6f} "
                     f"{(y + h / 2) / calib.height:.6f} {w / calib.width:.6f} "
                     f"{h / calib.height:.6f}")
    return lines, dropped


def write_labels(scene_dir, run_dir):
    scene_dir, run_dir = Path(scene_dir), Path(run_dir)
    layout = json.loads((scene_dir / "layout.json").read_text())
    if (run_dir / "actors.json").is_file():
        layout["actors"] = json.loads((run_dir / "actors.json").read_text())
    run = json.loads((run_dir / "run.json").read_text()) if (run_dir / "run.json").is_file() else {}
    scale = run.get("scenario", {}).get("resolution_scale", 1.0)
    tracks = {actor["track"] for actor in layout["actors"]}
    metadata = {actor["track"]: {key: actor[key] for key in ("appearance", "origin", "asset_id")
                                if key in actor} for actor in layout["actors"]}
    atomic_write(run_dir / "labels" / "classes.txt", ("\n".join(CLASSES) + "\n").encode())
    summary = {"frames": 0, "boxes_2d": 0, "dropped": 0, "missing_visibility": []}
    frames = run.get("frames") or [item["index"] for item in layout["frames"]]
    for record in layout["frames"]:
        frame = record["index"]
        if frame not in frames:
            continue
        boxes = actor_boxes_lidar(layout, frame)
        write_json(run_dir / "labels3d" / f"{frame:06d}.json", {"frame": frame, "boxes": [
            {"track": track, "label": box.label, "cx": box.cx, "cy": box.cy, "cz": box.cz,
             "l": box.l, "w": box.w, "h": box.h, "yaw": box.yaw,
             **metadata[track]} for track, box in boxes]})
        path = run_dir / "visibility" / f"{frame:06d}.json"
        if not path.is_file():
            logger.error("Missing visibility for frame %d", frame)
            summary["missing_visibility"].append(frame)
            continue
        visibility = json.loads(path.read_text())
        for camera_name, seen in visibility.items():
            unknown = set(seen) - tracks
            if unknown:
                raise ValueError(f"Visibility tracks not in layout: {sorted(unknown)[:3]}")
            calib = camera_calib(camera_name, record["cameras"][camera_name],
                                 record["T_world_lidar"], scale)
            lines, dropped = yolo_lines(boxes, calib, seen)
            atomic_write(run_dir / "labels" / "yolo" / camera_name / f"{frame:06d}.txt",
                         "".join(line + "\n" for line in lines).encode())
            summary["boxes_2d"] += len(lines)
            summary["dropped"] += dropped
        summary["frames"] += 1
    return summary
