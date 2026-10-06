"""Verify serialized OpenGL cameras against the existing LiDAR projection."""
import json
import sys
from pathlib import Path

import numpy as np

from topeye.config import load_config
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.geometry import project


def measure(scene):
    adapter = NuScenesAdapter(load_config().nusc_root)
    frames = {f.frame_id: f for f in adapter.frames(scene)}
    root = Path("data/splat") / scene
    records = [record for name in ("transforms.json", "transforms_test.json")
               for record in json.loads((root / name).read_text())["frames"]]
    maximum, count = 0., 0
    for record in records:
        frame = frames[record["frame_id"]]
        points = adapter.load_points(frame)[:, :3]
        calib = frame.cameras[record["camera"]][2]
        expected, depth = project(points, calib.K, calib.T_lidar_cam)
        keep = ((depth > .5) & (expected[:, 0] >= 0) & (expected[:, 0] < calib.width)
                & (expected[:, 1] >= 0) & (expected[:, 1] < calib.height))
        world = points.astype(float) @ frame.T_world_lidar[:3, :3].T + frame.T_world_lidar[:3, 3]
        inverse = np.linalg.inv(record["transform_matrix"])
        gl = (world @ inverse[:3, :3].T + inverse[:3, 3])[keep]
        uv = np.column_stack((record["fl_x"] * gl[:, 0] / -gl[:, 2] + record["cx"],
                              record["fl_y"] * -gl[:, 1] / -gl[:, 2] + record["cy"]))
        delta = np.linalg.norm(uv - expected[keep] * [record["w"] / calib.width,
                                                    record["h"] / calib.height], axis=1)
        maximum = max(maximum, float(delta.max(initial=0)))
        count += len(delta)
    result = {"scene": scene, "views": len(records), "projected_points": count,
              "max_error_px": maximum, "pass": count > 0 and maximum < 1}
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    raise SystemExit(0 if measure(sys.argv[1])["pass"] else 1)
