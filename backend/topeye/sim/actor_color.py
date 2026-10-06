"""Dominant vehicle paint measured from upper-body camera pixels (SPEC-S8 §3)."""

from dataclasses import replace

import cv2
import numpy as np

from topeye.core.bev import box_mask
from topeye.sim.labels import actor_boxes_lidar
from topeye.sim.traffic import VEHICLES


def upper_body_mask(box, calib, boxes=()):
    """Upper physical half of a box, excluding silhouettes of nearer actors."""
    upper = replace(box, cz=box.cz + box.h / 4, h=box.h / 2)
    mask = box_mask([upper], calib, pad=0.0)
    center = np.array([box.cx, box.cy, box.cz, 1.0])
    depth = (calib.T_lidar_cam @ center)[2]
    if depth <= 0.5:
        return np.zeros_like(mask)
    for other in boxes:
        other_depth = (calib.T_lidar_cam @ [other.cx, other.cy, other.cz, 1.0])[2]
        if other is not box and 0.5 < other_depth < depth:
            mask[box_mask([other], calib, pad=0.0) > 0] = 0
    return mask


def median_paint_rgb(pixels):
    """HSV median with circular hue unwrapping; input is uint8 RGB."""
    pixels = np.asarray(pixels, dtype=np.uint8).reshape(-1, 1, 3)
    if not len(pixels):
        return None
    hsv = cv2.cvtColor(pixels, cv2.COLOR_RGB2HSV).reshape(-1, 3).astype(float)
    hsv = hsv[(hsv[:, 2] > 30) & (hsv[:, 2] < 245)]
    if not len(hsv):
        return None
    # Hue wraps at red (0/179). Saturated pixels provide the circular reference.
    chromatic = hsv[hsv[:, 1] > 40]
    if len(chromatic):
        angles = chromatic[:, 0] * (2 * np.pi / 180)
        reference = np.arctan2(np.sin(angles).sum(), np.cos(angles).sum()) * 180 / (2 * np.pi)
        hsv[:, 0] = reference + (hsv[:, 0] - reference + 90) % 180 - 90
    median = np.median(hsv, axis=0)
    median[0] %= 180
    color = cv2.cvtColor(np.rint(median).astype(np.uint8).reshape(1, 1, 3), cv2.COLOR_HSV2RGB)
    return color[0, 0].tolist()


def actor_colors(adapter, scene, layout) -> dict[str, list[int]]:
    """Return measured track -> RGB; omit tracks without usable visible pixels."""
    vehicles = {a["track"] for a in layout["actors"] if a["label"] in VEHICLES
                and a.get("origin", "recorded") != "generated"}
    samples = {}
    indices = {record["index"] for record in layout["frames"]}
    for frame in adapter.frames(scene):
        if frame.index not in indices:
            continue
        boxes = actor_boxes_lidar(layout, frame.index)
        all_boxes = [box for _, box in boxes]
        for path, _, calib, _ in frame.cameras.values():
            image = cv2.imread(str(path))
            if image is None:
                raise ValueError(f"Cannot read actor color image: {path}")
            for track, box in boxes:
                if track not in vehicles:
                    continue
                mask = upper_body_mask(box, calib, all_boxes)
                if np.count_nonzero(mask) < 64:
                    continue
                pixels = image[mask > 0, ::-1]
                # Bound memory and weight each clear observation equally.
                pixels = pixels[::max(1, len(pixels) // 512)][:512]
                color = median_paint_rgb(pixels)
                if color is not None:
                    samples.setdefault(track, []).append(color)
    return {track: median_paint_rgb(colors) for track, colors in samples.items()}
