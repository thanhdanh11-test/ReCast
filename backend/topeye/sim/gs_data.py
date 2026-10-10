"""Local, masked OpenCV camera dataset for background Gaussian training (SPEC-S6)."""

import argparse
import io
import json
from dataclasses import replace
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np

from topeye.config import load_config
from topeye.core.adapters.base import DatasetError
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.bev import box_mask, outside_boxes
from topeye.core.cache import atomic_write, write_json
from topeye.core.geometry import project
from topeye.sim.cli import scene_dir, sim_root
from topeye.sim.static_map import static_points, static_voxels, sweep_boxes

EGO_IMAGE_MASK = {"CAM_BACK": 0.10}
"""Observed ego trunk occupies the bottom 10% of CAM_BACK; a 3D box hides background."""


def _views(sweeps, max_hz, test_every):
    """Deduplicate source files and thin independently in camera timestamp order."""
    cameras = {}
    for sweep in sweeps:
        for name, camera in sweep.cameras.items():
            cameras.setdefault(name, {}).setdefault(Path(camera[0]).resolve(), camera)
    for name in sorted(cameras):
        previous = None
        k = 0
        for camera in sorted(cameras[name].values(), key=lambda c: (c[1], str(c[0]))):
            timestamp = camera[1]
            if previous is not None and timestamp - previous < 1e6 / max_hz:
                continue
            yield name, camera, "test" if k % test_every == 4 else "train"
            previous = timestamp
            k += 1


def _scaled_calib(calib, scale, world_camera, sweep):
    width, height = round(calib.width * scale), round(calib.height * scale)
    if width < 1 or height < 1:
        raise ValueError("scale produces an empty image")
    K = calib.K.copy()
    K[0] *= width / calib.width
    K[1] *= height / calib.height
    return replace(calib, K=K, width=width, height=height,
                   T_lidar_cam=np.linalg.inv(world_camera) @ sweep.T_world_lidar)


def _sparse_depth(points, boxes, calib):
    points = points[outside_boxes(points, boxes)]
    uv, depth = project(points, calib.K, calib.T_lidar_cam)
    valid = ((depth > 0) & np.isfinite(uv).all(axis=1)
             & (uv[:, 0] >= 0) & (uv[:, 0] < calib.width)
             & (uv[:, 1] >= 0) & (uv[:, 1] < calib.height))
    pixels = uv[valid].astype(np.int64)
    result = np.full((calib.height, calib.width), np.inf, np.float32)
    np.minimum.at(result, (pixels[:, 1], pixels[:, 0]), depth[valid])
    result[~np.isfinite(result)] = 0
    return result


def _write_image(path, image, suffix):
    options = [cv2.IMWRITE_JPEG_QUALITY, 95] if suffix == ".jpg" else []
    ok, encoded = cv2.imencode(suffix, image, options)
    if not ok:
        raise ValueError(f"Cannot encode {path}")
    atomic_write(path, encoded.tobytes())


def _write_init_points(path, xyz, colors):
    vertices = np.empty(len(xyz), [("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
                                   ("red", "u1"), ("green", "u1"), ("blue", "u1")])
    for field, column in zip(("x", "y", "z"), xyz.T):
        vertices[field] = column
    for field, column in zip(("red", "green", "blue"), colors.T):
        vertices[field] = column
    header = ("ply\nformat binary_little_endian 1.0\n"
              f"element vertex {len(xyz)}\nproperty float x\nproperty float y\n"
              "property float z\nproperty uchar red\nproperty uchar green\n"
              "property uchar blue\nend_header\n")
    atomic_write(path, header.encode() + vertices.tobytes())


def export_gs_dataset(adapter, scene: str, out_dir: Path, scale: float = 0.5,
                      max_hz: float = 12.0, test_every: int = 8,
                      max_init_points: int = 1_000_000,
                      mask_tokens: set[str] | None = None) -> dict:
    """Export local static supervision; publish cameras.json only after all assets."""
    if not np.isfinite(scale) or not 0 < scale <= 1:
        raise ValueError("scale must be finite and in (0, 1]")
    if not np.isfinite(max_hz) or max_hz <= 0:
        raise ValueError("max_hz must be finite and positive")
    if type(test_every) is not int or test_every < 5:
        raise ValueError("test_every must be an integer >= 5 (test residue is 4)")
    if type(max_init_points) is not int or max_init_points < 1:
        raise ValueError("max_init_points must be a positive integer")
    started = perf_counter()
    sweeps = sorted(adapter.sweep_frames(scene), key=lambda f: (f.lidar_ts_us, f.frame_id))
    if not sweeps:
        raise ValueError(f"No LiDAR sweeps for {scene}")
    timestamps = np.array([f.lidar_ts_us for f in sweeps], np.int64)
    boxes_by_sweep = sweep_boxes(adapter, scene)
    views = list(_views(sweeps, max_hz, test_every))
    if not views:
        raise ValueError(f"No camera views for {scene}")
    out_dir = Path(out_dir)
    records = []
    masked_pixels = depth_pixels = total_pixels = 0
    ego_counts, camera_pixels = {}, {}
    cached_sweep, points = None, None
    for name, (image_path, timestamp, original, world_camera), split in views:
        if not name.startswith("CAM_") or not all(c.isalnum() or c == "_" for c in name):
            raise ValueError(f"Invalid camera name: {name}")
        nearest = int(np.argmin(np.abs(timestamps - timestamp)))
        sweep = sweeps[nearest]
        if nearest != cached_sweep:
            points = adapter.load_points(sweep)
            cached_sweep = nearest
        calib = _scaled_calib(original, scale, world_camera, sweep)
        image = cv2.imread(str(image_path))
        if image is None or image.shape[:2] != (original.height, original.width):
            raise ValueError(f"Cannot read camera with declared dimensions: {image_path}")
        image = cv2.resize(image, (calib.width, calib.height), interpolation=cv2.INTER_AREA)
        boxes = boxes_by_sweep[sweep.frame_id]
        if mask_tokens is not None:
            # Only dynamic actors are removed; static ones stay as photographed background.
            boxes = [b for b in boxes if getattr(b, "instance_token", None) in mask_tokens]
        ego_mask = np.zeros((calib.height, calib.width), np.uint8)
        ego_rows = round(calib.height * EGO_IMAGE_MASK.get(name, 0))
        if ego_rows:
            ego_mask[-ego_rows:] = 1
        mask = (1 - np.maximum(box_mask(boxes, calib, pad=0.3), ego_mask)) * np.uint8(255)
        # Match padded actor exclusion; ego pixels are removed by the image mask below.
        padded = [replace(b, l=b.l + 0.6, w=b.w + 0.6, h=b.h + 0.6) for b in boxes]
        depth = _sparse_depth(points, padded, calib)
        depth[mask == 0] = 0
        paths = {kind: f"{kind}/{name}/{timestamp}{suffix}" for kind, suffix in
                 (("images", ".jpg"), ("masks", ".png"), ("depth", ".npy"))}
        _write_image(out_dir / paths["images"], image, ".jpg")
        _write_image(out_dir / paths["masks"], mask, ".png")
        buffer = io.BytesIO()
        np.save(buffer, depth, allow_pickle=False)
        atomic_write(out_dir / paths["depth"], buffer.getvalue())
        records.append({"id": f"{name}_{timestamp}", "camera": name,
                        "timestamp_us": int(timestamp), "image": paths["images"],
                        "mask": paths["masks"], "depth": paths["depth"],
                        "width": calib.width, "height": calib.height,
                        "K": calib.K.tolist(), "c2w": world_camera.tolist(), "split": split})
        masked_pixels += int(np.count_nonzero(mask == 0))
        depth_pixels += int(np.count_nonzero(depth))
        total_pixels += mask.size
        ego_counts[name] = ego_counts.get(name, 0) + int(np.count_nonzero(ego_mask))
        camera_pixels[name] = camera_pixels.get(name, 0) + mask.size

    if masked_pixels == total_pixels:
        raise ValueError("No usable background pixels: actor/ego masks cover all views")
    ego_ratios = {name: ego_counts[name] / camera_pixels[name] for name in sorted(ego_counts)}
    for name, ratio in ego_ratios.items():
        expected = EGO_IMAGE_MASK.get(name, 0)
        if abs(ratio - expected) > 0.01:
            raise ValueError(f"Ego mask ratio outside image contract: {name}={ratio}")
    xyz, rgb, sweep_indices = static_points(adapter, scene, sweeps=sweeps)
    keys, colors = static_voxels(xyz, rgb, sweep_indices, voxel_m=0.2, min_sweeps=3)
    if len(keys) > max_init_points:
        indices = np.linspace(0, len(keys) - 1, max_init_points, dtype=np.int64)
        keys, colors = keys[indices], colors[indices]
    _write_init_points(out_dir / "init_points.ply", (keys + 0.5) * 0.2, colors)
    write_json(out_dir / "cameras.json", records)
    return {"scene": scene, "views_train": sum(v["split"] == "train" for v in records),
            "views_test": sum(v["split"] == "test" for v in records),
            "masked_pixel_ratio": masked_pixels / total_pixels,
            "depth_pixel_ratio": depth_pixels / total_pixels,
            "ego_masked_pixel_ratio": ego_ratios,
            "init_points": len(keys), "export_s": perf_counter() - started}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Export local masked Gaussian training data")
    parser.add_argument("--scene", required=True)
    parser.add_argument("--scale", type=float, default=0.5)
    parser.add_argument("--config", default="config.toml")
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        target = scene_dir(sim_root(args.config), args.scene) / "gs12"
        adapter = NuScenesAdapter(config.nusc_root)
        if args.scene not in adapter.scenes():
            raise ValueError(f"Unknown scene: {args.scene}")
        summary = export_gs_dataset(adapter, args.scene, target, scale=args.scale)
    except (ValueError, DatasetError) as exc:
        print(str(exc))
        return 2
    except (OSError, RuntimeError) as exc:
        print(str(exc))
        return 1
    print(json.dumps(summary, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
