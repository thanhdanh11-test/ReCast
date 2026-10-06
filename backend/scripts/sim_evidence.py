"""Evidence for plan 02 (TESTING-ACCEPTANCE §2): real vs render sheet, YOLO overlay, LiDAR metrics."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial import cKDTree

from topeye.config import load_config
from topeye.core.adapters.nuscenes import NuScenesAdapter

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT.parent / "planning" / "02_2026-10-05_blender-real2sim" / "evidence" / "s3"
ORDER = ["CAM_FRONT_LEFT", "CAM_FRONT", "CAM_FRONT_RIGHT", "CAM_BACK_LEFT", "CAM_BACK",
         "CAM_BACK_RIGHT"]
LIDAR_RANGE_M = 40.0


def draw_yolo(image, path, classes):
    height, width = image.shape[:2]
    for line in path.read_text().splitlines() if path.is_file() else []:
        cls, cx, cy, w, h = line.split()
        cx, cy, w, h = (float(v) for v in (cx, cy, w, h))
        p1 = (int((cx - w / 2) * width), int((cy - h / 2) * height))
        p2 = (int((cx + w / 2) * width), int((cy + h / 2) * height))
        cv2.rectangle(image, p1, p2, (0, 255, 255), 3)
        cv2.putText(image, classes[int(cls)], (p1[0], max(p1[1] - 6, 20)),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
    return image


def sheet(frame, run_dir, index, classes):
    rows = []
    for names in (ORDER[:3], ORDER[3:]):
        real, sim = [], []
        for name in names:
            path = frame.cameras[name][0]
            real_image = cv2.imread(str(path))
            render = cv2.imread(str(run_dir / "images" / name / f"{index:06d}.png"))
            render = cv2.resize(render, real_image.shape[1::-1])
            draw_yolo(render, run_dir / "labels" / "yolo" / name / f"{index:06d}.txt", classes)
            for image, label in ((real_image, f"REAL {name}"), (render, f"SIM {name}")):
                cv2.putText(image, label, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5,
                            (0, 0, 255), 3)
            real.append(real_image)
            sim.append(render)
        rows += [np.hstack(real), np.hstack(sim)]
    return cv2.resize(np.vstack(rows), None, fx=0.4, fy=0.4, interpolation=cv2.INTER_AREA)


def within(points, range_m=LIDAR_RANGE_M):
    return points[np.linalg.norm(points[:, :2], axis=1) <= range_m]


def lidar_metrics(adapter, frame, run_dir, index):
    real = adapter.load_points(frame)[:, :3]
    sim = np.fromfile(run_dir / "lidar" / f"{index:06d}.bin", "<f4").reshape(-1, 5)[:, :3]
    real = real[np.linalg.norm(real[:, :2], axis=1) >= 2.5]
    real_r, sim_r = within(real), within(sim)
    distance, _ = cKDTree(real).query(sim_r)
    reverse, _ = cKDTree(sim).query(real_r)
    return {"frame": index, "real_points": len(real), "sim_points": len(sim),
            "point_ratio": round(len(sim) / len(real), 3),
            "chamfer_sim_to_real_median_m": round(float(np.median(distance)), 3),
            "chamfer_sim_to_real_p90_m": round(float(np.percentile(distance, 90)), 3),
            "chamfer_real_to_sim_median_m": round(float(np.median(reverse)), 3),
            "range_m": LIDAR_RANGE_M}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scene", required=True)
    parser.add_argument("--run", required=True, nargs="+")
    parser.add_argument("--frame", type=int, default=0)
    args = parser.parse_args()
    adapter = NuScenesAdapter(load_config(ROOT / "config.toml").nusc_root)
    frame = adapter.frames(args.scene)[args.frame]
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    metrics_path = EVIDENCE / "lidar_metrics.json"
    metrics = json.loads(metrics_path.read_text()) if metrics_path.is_file() else {}
    for run in args.run:
        run_dir = ROOT / "data" / "sim" / args.scene / "runs" / run
        classes = (run_dir / "labels" / "classes.txt").read_text().split()
        cv2.imwrite(str(EVIDENCE / f"compare_{run}.jpg"), sheet(frame, run_dir, args.frame,
                                                                classes),
                    [cv2.IMWRITE_JPEG_QUALITY, 85])
        metrics[run] = lidar_metrics(adapter, frame, run_dir, args.frame)
        print(run, metrics[run])
    metrics_path.write_text(json.dumps(metrics, indent=2) + "\n")


if __name__ == "__main__":
    main()
