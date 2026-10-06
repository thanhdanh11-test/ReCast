"""Standalone CPU alternative to Blender for unlit S9 renders (no bpy required)."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from topeye.sim.texture_mesh import render_mesh


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mesh", required=True, help="S9 .npz mesh/UV/atlas")
    parser.add_argument("--view", required=True, help="JSON OpenCV camera record")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    with np.load(args.mesh, allow_pickle=False) as data:
        rgb, _, _ = render_mesh(data["V"], data["F"], data["UV"], data["atlas"],
                                json.loads(Path(args.view).read_text()))
    if not cv2.imwrite(args.output, rgb[:, :, ::-1]):
        raise OSError(f"Cannot write {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
