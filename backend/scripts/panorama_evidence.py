"""Validate P09 machine evidence and render the requested frame-10 depth preview."""

import argparse
import json
import re
import shutil
from pathlib import Path

import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--before-depth", type=Path)
    parser.add_argument("--before-alpha", type=Path)
    parser.add_argument("--prepare-log", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--scene", default="scene-0061")
    parser.add_argument("--frame", default="scene-0061_000010")
    args = parser.parse_args()

    source = args.cache_root / args.scene / "frames" / args.frame
    depth_path = source / "pano_depth.bin"
    depth = np.fromfile(depth_path, dtype="<u2")
    if depth.size != 1024 * 512:
        raise ValueError(f"Unexpected depth sample count: {depth.size}")
    depth = depth.reshape(512, 1024)
    alpha = cv2.imread(str(source / "pano_alpha.png"), cv2.IMREAD_GRAYSCALE)
    if alpha is None or alpha.shape != depth.shape:
        raise ValueError(f"Unexpected alpha shape: {getattr(alpha, 'shape', None)}")
    log = args.prepare_log.read_text(errors="replace")
    timings = [float(value) for value in re.findall(r"pano=\S+ seconds=([0-9.]+)", log)]
    if not timings or max(timings) > 3.0:
        raise ValueError(f"Panorama performance gate failed: {max(timings, default=float('inf'))}")

    args.out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / "pano_rgb.jpg", args.out / "scene-0061-frame10-pano_rgb.jpg")

    def colored_depth(values, destination):
        normalized = np.uint8(np.clip(values / 60000, 0, 1) * 255)
        colored = cv2.applyColorMap(normalized, cv2.COLORMAP_TURBO)
        if not cv2.imwrite(str(destination), colored):
            raise ValueError("Cannot write colored depth evidence")

    def dropped_edges(values):
        values = values.astype(np.float32) / 1000
        count = 0
        for first, second in ((values[:, :-1], values[:, 1:]),
                              (values[:-1], values[1:])):
            delta = np.abs(first - second)
            count += int(((delta > 2.0) & (delta / np.minimum(first, second) > 0.2)).sum())
        return count

    colored_depth(depth, args.out / "scene-0061-frame10-pano_depth-after.png")
    comparison = {
        "after": {
            "alpha_zero_pixels": int((alpha == 0).sum()),
            "edges_over_2m_and_20pct": dropped_edges(depth),
        }
    }
    if args.before_depth and args.before_alpha:
        before_depth = np.fromfile(args.before_depth, dtype="<u2").reshape(512, 1024)
        before_alpha = cv2.imread(str(args.before_alpha), cv2.IMREAD_GRAYSCALE)
        if before_alpha is None or before_alpha.shape != before_depth.shape:
            raise ValueError("Unexpected before alpha shape")
        colored_depth(before_depth, args.out / "scene-0061-frame10-pano_depth-before.png")
        comparison["before"] = {
            "alpha_zero_pixels": int((before_alpha == 0).sum()),
            "edges_over_2m_and_20pct": dropped_edges(before_depth),
        }
    summary = {
        "scene": args.scene,
        "frame": args.frame,
        "depth_bytes": depth_path.stat().st_size,
        "frames_timed": len(timings),
        "panorama_seconds_max": max(timings),
        "panorama_seconds_mean": float(np.mean(timings)),
        "comparison": comparison,
    }
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
