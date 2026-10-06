"""Keyframe-only static scene export for Brush's Nerfstudio loader."""

import argparse
import json
import re
import shutil
import tempfile
from dataclasses import replace
from pathlib import Path

import cv2
import numpy as np

from topeye.config import load_config
from topeye.core.adapters.base import DatasetError
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.bev import box_mask, outside_boxes, transform
from topeye.core.cache import read_meta

OPENGL_FROM_OPENCV = np.diag([1., -1., -1., 1.])


def dynamic_tracks(frames, boxes_by_frame):
    endpoints, dynamic = {}, set()
    for frame in sorted(frames, key=lambda f: f.lidar_ts_us):
        for box in boxes_by_frame[frame.frame_id]:
            key = box.instance_token
            if not key:
                raise ValueError("Every mask box must have a track key")
            if (box.label in {"pedestrian", "bicycle", "motorcycle"}
                    or box.label.startswith("human.") or box.label.startswith("animal")):
                dynamic.add(key)
            center = transform(np.array([[box.cx, box.cy, box.cz]]), frame.T_world_lidar)[0]
            first = endpoints.get(key, (center, center))[0]
            endpoints[key] = first, center
    dynamic.update(key for key, (first, last) in endpoints.items()
                   if np.linalg.norm(last - first) > 1.)
    return dynamic


def camera_record(frame, name, width, height):
    _, timestamp, calib, world_cam = frame.cameras[name]
    sx, sy = width / calib.width, height / calib.height
    stem = f"{frame.frame_id}_{name}"
    return {"file_path": f"images/{stem}.png", "mask_path": f"masks/{stem}.png",
            "fl_x": float(calib.K[0, 0] * sx), "fl_y": float(calib.K[1, 1] * sy),
            "cx": float(calib.K[0, 2] * sx), "cy": float(calib.K[1, 2] * sy),
            "w": width, "h": height,
            "transform_matrix": (world_cam @ OPENGL_FROM_OPENCV).tolist(),
            "timestamp_us": timestamp, "frame_id": frame.frame_id, "camera": name}


def write_points(path, points):
    """Binary XYZ/RGB PLY; uncolored measured points use neutral grey."""
    vertex = np.empty(len(points), dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
                                         ("red", "u1"), ("green", "u1"), ("blue", "u1")])
    rgb = np.where(points[:, 4:7] < 0, 128, points[:, 4:7]).clip(0, 255).astype("u1")
    for i, name in enumerate(("x", "y", "z")):
        vertex[name] = points[:, i]
    for i, name in enumerate(("red", "green", "blue")):
        vertex[name] = rgb[:, i]
    with path.open("wb") as stream:
        stream.write((f"ply\nformat binary_little_endian 1.0\nelement vertex {len(points)}\n"
                      "property float x\nproperty float y\nproperty float z\n"
                      "property uchar red\nproperty uchar green\nproperty uchar blue\n"
                      "end_header\n").encode())
        vertex.tofile(stream)


def export_scene(adapter, scene, cache_root, out, scale=.5):
    if re.fullmatch(r"[A-Za-z0-9_-]+", scene) is None or scene not in adapter.scenes():
        raise ValueError("Unknown or invalid scene")
    if not np.isfinite(scale) or not 0 < scale <= 1:
        raise ValueError("scale must be finite and in (0, 1]")
    cache_root, out = Path(cache_root).resolve(), Path(out).resolve()
    meta = read_meta(cache_root / scene)
    if meta is None or meta.get("failures"):
        raise ValueError("Prepare the complete scene before exporting")
    if out.exists():
        raise ValueError("Output already exists; choose a fresh directory")
    frames = sorted(adapter.frames(scene), key=lambda f: f.lidar_ts_us)
    boxes = {f.frame_id: adapter.mask_boxes(f) for f in frames}
    if any(b is None for b in boxes.values()):
        raise ValueError("Export requires annotated keyframes only")
    dynamic = dynamic_tracks(frames, boxes)
    out.parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=f".{out.name}-", dir=out.parent))
    try:
        (work / "images").mkdir()
        (work / "masks").mkdir()
        records, chunks, removed, input_count = [], [], 0, 0
        for frame in frames:
            moving = [b for b in boxes[frame.frame_id] if b.instance_token in dynamic]
            source = (cache_root / scene / "frames" / frame.frame_id / "points.bin").resolve()
            if not source.is_relative_to(cache_root) or source.stat().st_size % 28:
                raise ValueError("Invalid points cache path or size")
            points = np.fromfile(source, dtype="<f4").reshape(-1, 7)
            if not np.isfinite(points).all():
                raise ValueError("Nonfinite cached points")
            keep = outside_boxes(points, moving)
            input_count += len(points)
            removed += int((~keep).sum())
            points = points[keep].copy()
            points[:, :3] = transform(points, frame.T_world_lidar)
            chunks.append(points)
            for name, (path, _, calib, _) in sorted(frame.cameras.items()):
                image = cv2.imread(str(path))
                if image is None or image.shape[:2] != (calib.height, calib.width):
                    raise ValueError(f"Missing or mismatched image: {path}")
                w, h = max(1, round(calib.width * scale)), max(1, round(calib.height * scale))
                record = camera_record(frame, name, w, h)
                intrinsic = calib.K.copy()
                intrinsic[0] *= w / calib.width
                intrinsic[1] *= h / calib.height
                mask = (1 - box_mask(moving, replace(calib, K=intrinsic, width=w, height=h))) * 255
                image = cv2.resize(image, (w, h), interpolation=cv2.INTER_AREA)
                if not (cv2.imwrite(str(work / record["file_path"]), image)
                        and cv2.imwrite(str(work / record["mask_path"]), mask)):
                    raise OSError("Cannot write exported image/mask")
                records.append(record)
        records.sort(key=lambda r: (r["timestamp_us"], r["file_path"]))
        train, test = records[:0], records[:0]
        for i, record in enumerate(records, 1):
            (test if i % 8 == 0 else train).append(record)
        if not train or not test:
            raise ValueError("Need at least eight camera images for the held-out split")
        points = np.concatenate(chunks)
        # Prefer camera-colored returns in each 10 cm voxel.
        points = points[np.argsort(points[:, 4] < 0, kind="stable")]
        _, selected = np.unique(np.floor(points[:, :3] / .1).astype(np.int64),
                                axis=0, return_index=True)
        points = points[np.sort(selected)]
        if not len(points):
            raise ValueError("No static initialization points")
        write_points(work / "points3D.ply", points)
        for filename, subset in (("transforms.json", train), ("transforms_test.json", test)):
            (work / filename).write_text(json.dumps({"camera_model": "OPENCV",
                "ply_file_path": "points3D.ply", "frames": subset}, indent=2))
        metrics = {"scene": scene, "keyframes": len(frames), "train_images": len(train),
                   "test_images": len(test), "dynamic_tracks": len(dynamic),
                   "input_points": input_count, "removed_dynamic_points": removed,
                   "voxel_points": len(points), "voxel_m": .1, "scale": scale}
        (work / "export_metrics.json").write_text(json.dumps(metrics, indent=2))
        work.rename(out)
        return metrics
    finally:
        if work.exists():
            shutil.rmtree(work)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--scale", type=float, default=.5)
    parser.add_argument("--config", default="config.toml")
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        result = export_scene(NuScenesAdapter(config.nusc_root), args.scene,
                              config.cache_root, args.out, args.scale)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, RuntimeError, DatasetError) as exc:
        print(f"Export failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
