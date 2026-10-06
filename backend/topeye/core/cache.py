"""Atomic cache publication; scene lock serializes concurrent preparations."""

import fcntl
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
from tempfile import NamedTemporaryFile
from time import perf_counter

import cv2
import numpy as np

from topeye.core.adapters.base import DatasetError
from topeye.core.bev import BEVScene
from topeye.core.box_texture import MultiFrameTextures, build_box_atlas
from topeye.core.calib_check import calib_report
from topeye.core.colorize import colorize
from topeye.core.ground import ground_algorithm
from topeye.core.object_accum import build_objects_dense
from topeye.core.panorama import build_panorama

CACHE_VERSION = 10
# Top-view grid (01-CONTRACTS §3); fixed even before bev.png exists.
BEV_GRID = {"res_m": 0.1, "extent_m": 60.0, "origin": "ego_center", "size_px": 1200}


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_json(path, value):
    atomic_write(path, json.dumps(value, allow_nan=False).encode())


def read_meta(root):
    try:
        meta = json.loads((Path(root) / "meta.json").read_text())
        if meta["cache_version"] == CACHE_VERSION and isinstance(meta["frames"], list):
            return meta
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def prepare_scene(adapter, scene, cache_root, config, workers=4, window=5, no_bev=False,
                  no_atlas=False, no_dense=False, no_pano=False):
    root = Path(cache_root) / scene
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".prepare.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        previous = read_meta(root)
        if (
            previous
            and not previous.get("failures")
            and (root / ".prepare-options").exists()
            and (root / ".prepare-options").read_text()
            == str((window, no_bev, no_atlas, no_dense, no_pano))
            and (
                no_bev
                or all((root / "frames" / f / "bev.png").is_file() for f in previous["frames"])
            )
            and (no_atlas or all(
                (root / "frames" / f / name).is_file()
                for f in previous["frames"] for name in ("box_atlas.png", "box_atlas.json")
            ))
            and (no_dense or all(
                (root / "frames" / f / name).is_file()
                for f in previous["frames"] for name in ("objects_dense.bin", "objects_dense.json")
            ))
            and (no_pano or all(
                (root / "frames" / f / name).is_file()
                for f in previous["frames"]
                for name in ("pano_rgb.jpg", "pano_alpha.png", "pano_depth.bin", "pano.json")
            ))
        ):
            return previous
        (root / "meta.json").unlink(missing_ok=True)
        frames = adapter.frames(scene)
        bev_scene = None if no_bev and no_atlas and no_pano else BEVScene(adapter, scene)

        boxes_by_frame = {}
        texture_sources = None
        points_by_frame = {}
        if not no_atlas:
            boxes_by_frame = {f.index: {b.instance_token: b for b in adapter.gt_boxes(f) or []}
                              for f in frames}
            texture_sources = MultiFrameTextures(frames, boxes_by_frame, bev_scene.depths,
                                                  bev_scene.camera, bev_scene.gains)

        def prepare(frame):
            started = perf_counter()
            target = root / "frames" / frame.frame_id
            for name in ("bev.png", "box_atlas.png", "box_atlas.json",
                         "objects_dense.bin", "objects_dense.json", "pano_rgb.jpg",
                         "pano_alpha.png", "pano_depth.bin", "pano.json"):
                (target / name).unlink(missing_ok=True)
            try:
                images = {}
                for name, (path, _, _, _) in frame.cameras.items():
                    image = cv2.imread(str(path))
                    if image is None:
                        logging.getLogger(__name__).warning(
                            "Cannot decode camera %s %s", frame.frame_id, name
                        )
                        continue
                    images[name] = image
                    atomic_write(target / "cams" / f"{name}.jpg", path.read_bytes())
                colored = colorize(adapter.load_points(frame), frame, images)
                atomic_write(target / "points.bin", colored.astype("<f4").tobytes())
                boxes = adapter.gt_boxes(frame)
                if not no_dense:
                    points_by_frame[frame.index] = colored
                    boxes_by_frame[frame.index] = {b.instance_token: b for b in boxes or []}
                if boxes is not None:
                    write_json(target / "gt.json", [asdict(box) for box in boxes])
                if not no_bev:
                    rgba = bev_scene.build(frame.index, window, colored)
                    ok, encoded = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
                    if not ok:
                        raise ValueError("Cannot encode BEV")
                    atomic_write(target / "bev.png", encoded.tobytes())
                if not no_atlas:
                    atlas_started = perf_counter()
                    corrected = {name: np.clip(image * bev_scene.gains[name], 0, 255)
                                 .astype(np.uint8) for name, image in images.items()}
                    atlas, atlas_meta = build_box_atlas(
                        frame, boxes or [], corrected, bev_scene.depths[frame.index],
                        sources=texture_sources)
                    _, grid = bev_scene.height_grid(frame.index, window)
                    y, x = np.indices(grid.shape)
                    radius = ((x + 0.5) * 0.5 - 60) ** 2 + ((y + 0.5) * 0.5 - 60) ** 2
                    ground = grid[(radius <= 100) & np.isfinite(grid)]
                    if not len(ground):
                        raise ValueError("no_ground_within_10m")
                    atlas_meta["ground_z"] = float(np.median(ground))
                    ok, encoded = cv2.imencode(".png", cv2.cvtColor(atlas, cv2.COLOR_RGBA2BGRA))
                    if not ok:
                        raise ValueError("Cannot encode box atlas")
                    atomic_write(target / "box_atlas.png", encoded.tobytes())
                    write_json(target / "box_atlas.json", atlas_meta)
                    print(f"atlas={frame.frame_id} seconds={perf_counter() - atlas_started:.6f}",
                          flush=True)
                print(f"frame={frame.frame_id} seconds={perf_counter() - started:.6f}", flush=True)
                return None
            except (OSError, ValueError, RuntimeError, DatasetError) as exc:
                return {"frame_id": frame.frame_id, "reason": str(exc)}

        with ThreadPoolExecutor(max_workers=workers) as pool:
            failures = [failure for failure in pool.map(prepare, frames) if failure]
        if not no_pano:
            failed_frames = {failure["frame_id"] for failure in failures}

            def prepare_pano(frame):
                if frame.frame_id in failed_frames:
                    return None
                started = perf_counter()
                target = root / "frames" / frame.frame_id
                try:
                    images = {}
                    for name, (path, _, _, _) in frame.cameras.items():
                        image = cv2.imread(str(path))
                        if image is not None:
                            images[name] = image
                    _, grid = bev_scene.height_grid(frame.index, window)
                    panorama, alpha, depth, pano_meta = build_panorama(
                        frame, adapter.load_points(frame)[:, :3], images, grid, bev_scene.gains
                    )
                    ok, encoded = cv2.imencode(
                        ".jpg", panorama, [cv2.IMWRITE_JPEG_QUALITY, 90]
                    )
                    if not ok:
                        raise ValueError("Cannot encode panorama")
                    atomic_write(target / "pano_rgb.jpg", encoded.tobytes())
                    ok, encoded = cv2.imencode(".png", alpha)
                    if not ok:
                        raise ValueError("Cannot encode panorama alpha")
                    atomic_write(target / "pano_alpha.png", encoded.tobytes())
                    depth_mm = np.rint(depth * 1000).astype("<u2")
                    atomic_write(target / "pano_depth.bin", depth_mm.tobytes())
                    write_json(target / "pano.json", pano_meta)
                    print(
                        f"pano={frame.frame_id} seconds={perf_counter() - started:.6f}",
                        flush=True,
                    )
                except (OSError, ValueError, RuntimeError, DatasetError) as exc:
                    return {"frame_id": frame.frame_id, "reason": str(exc)}
                return None

            failures.extend(failure for failure in map(prepare_pano, frames) if failure)
        if not no_dense and not failures:
            def dense(frame):
                started = perf_counter()
                try:
                    points, metadata = build_objects_dense(
                        frame, list(boxes_by_frame[frame.index].values()), frames,
                        boxes_by_frame, points_by_frame)
                    target = root / "frames" / frame.frame_id
                    atomic_write(target / "objects_dense.bin", points.tobytes())
                    write_json(target / "objects_dense.json", metadata)
                    print(f"dense={frame.frame_id} seconds={perf_counter() - started:.6f}",
                          flush=True)
                except (OSError, ValueError, RuntimeError) as exc:
                    return {"frame_id": frame.frame_id, "reason": str(exc)}
                return None

            with ThreadPoolExecutor(max_workers=workers) as pool:
                failures.extend(failure for failure in pool.map(dense, frames) if failure)
        if bev_scene is not None:
            bev_scene.camera.cache_clear()
        if texture_sources is not None:
            texture_sources.candidate.cache_clear()
        write_json(root / "calib_report.json", calib_report(adapter, scene, config))
        meta = {
            "cache_version": CACHE_VERSION,
            "ground_algo": ground_algorithm(),
            "scene": scene,
            "frames": [frame.frame_id for frame in frames],
            "bev": BEV_GRID,
            "failures": failures,
        }
        options = (window, no_bev, no_atlas, no_dense, no_pano)
        atomic_write(root / ".prepare-options", str(options).encode())
        write_json(root / "meta.json", meta)
        return meta
