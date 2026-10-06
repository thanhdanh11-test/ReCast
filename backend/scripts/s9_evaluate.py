"""Measure both S9 meshes against the exact S6 held-out camera split."""

import argparse
import copy
import json
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np

from topeye.config import load_config
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.bev import BEVScene
from topeye.core.cache import write_json
from topeye.sim.cli import scene_dir, sim_root
from topeye.sim.layout import read_ply
from topeye.sim.static_map import static_points
from topeye.sim.texture_mesh import (
    build_static_mesh,
    export_textured,
    render_mesh,
    save_mesh,
    texture_mesh,
    triangulate,
)


def image(path, gray=False):
    result = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE if gray else cv2.IMREAD_COLOR)
    if result is None:
        raise ValueError(f"Cannot read {path}")
    return result if gray else result[:, :, ::-1].copy()


def masked_metrics(pred, target, mask):
    """Same 11x11 mask-normalized SSIM moments as splat, calculated by OpenCV."""
    if not mask.any():
        return {"pixels": 0, "squared_error": 0., "ssim_sum": 0.}
    x, y, m = pred.astype(np.float64) / 255, target.astype(np.float64) / 255, mask.astype(float)
    weight = np.maximum(cv2.boxFilter(m, -1, (11, 11), normalize=True,
                                     borderType=cv2.BORDER_CONSTANT), 1e-6)

    def mean(a):
        return cv2.boxFilter(a * m[:, :, None], -1, (11, 11), normalize=True,
                             borderType=cv2.BORDER_CONSTANT) / weight[:, :, None]

    ux, uy = mean(x), mean(y)
    vx, vy = np.maximum(mean(x * x) - ux * ux, 0), np.maximum(mean(y * y) - uy * uy, 0)
    cov = mean(x * y) - ux * uy
    score = ((2 * ux * uy + .01 ** 2) * (2 * cov + .03 ** 2)
             / ((ux * ux + uy * uy + .01 ** 2) * (vx + vy + .03 ** 2)))
    return {"pixels": int(mask.sum()), "squared_error": float(((x - y)[mask] ** 2).sum()),
            "ssim_sum": float(score[mask].sum())}


def aggregate(rows):
    pixels = sum(r["pixels"] for r in rows)
    if not pixels:
        return {"pixels": 0, "psnr": None, "ssim": None}
    mse = sum(r["squared_error"] for r in rows) / (pixels * 3)
    return {"pixels": pixels, "psnr": float(-10 * np.log10(max(mse, 1e-12))),
            "ssim": sum(r["ssim_sum"] for r in rows) / (pixels * 3)}


def read_init(path):
    data = path.read_bytes()
    end = data.index(b"end_header\n") + len(b"end_header\n")
    count = int(next(line.split()[2] for line in data[:end].decode().splitlines()
                     if line.startswith("element vertex")))
    vertices = np.frombuffer(data, dtype=[("xyz", "<f4", 3), ("rgb", "u1", 3)],
                             count=count, offset=end)
    return vertices["xyz"].astype(float)


def combine_ground(mesh, root, layout):
    """Retain the existing heightfield and its orthophoto without remeshing it."""
    V, F, UV, atlas = mesh
    ground, quads, _ = read_ply(root / "ground.ply")
    faces = triangulate(quads)
    bounds = layout["bounds"]
    u = (ground[:, 0] - bounds["xmin"]) / (bounds["xmax"] - bounds["xmin"])
    v = (ground[:, 1] - bounds["ymin"]) / (bounds["ymax"] - bounds["ymin"])
    return [(V, F, UV, atlas), (ground, faces, np.column_stack((u, v)),
                              image(root / "ground_photo.png"))]


def render(parts, view):
    output = np.zeros((view["height"], view["width"], 3), np.uint8)
    depth = np.full(output.shape[:2], np.inf)
    for part in parts:
        rgb, coverage, z = render_mesh(*part, view)
        take = coverage & (z < depth)
        output[take], depth[take] = rgb[take], z[take]
    return output, np.isfinite(depth)


def write_image(path, rgb):
    if not cv2.imwrite(str(path), rgb[:, :, ::-1]):
        raise OSError(f"Cannot write {path}")


def evaluate(scene):
    root = scene_dir(sim_root("config.toml"), scene)
    gs = root / "gs"
    views = json.loads((gs / "cameras.json").read_text())
    train = [v for v in views if v["split"] == "train"]
    test = [v for v in views if v["split"] == "test"]
    if len(test) != 54:
        raise ValueError(f"Expected the S6 54-view split, found {len(test)}")
    target = root / "textured"
    target.mkdir(parents=True, exist_ok=True)
    evidence = Path(__file__).resolve().parents[2] / "planning/02_2026-10-05_blender-real2sim/evidence/s9"
    evidence.mkdir(parents=True, exist_ok=True)
    started = perf_counter()
    print(json.dumps({"phase": "loading_static_lidar"}), flush=True)
    supported = read_init(gs / "init_points.ply")
    adapter = NuScenesAdapter(load_config("config.toml").nusc_root)
    xyz, rgb, sweep_ids = static_points(adapter, scene)
    del rgb, sweep_ids
    keys = np.ascontiguousarray(np.floor(xyz / .2).astype(np.int64))
    support_keys = np.ascontiguousarray(np.floor(supported / .2).astype(np.int64))
    row = np.dtype((np.void, 24))
    keep = np.isin(keys.view(row).ravel(), support_keys.view(row).ravel())
    xyz = xyz[keep]
    del keys, support_keys, keep
    bev = BEVScene(adapter, scene)
    gains = bev.gains.copy()
    bev.camera.cache_clear()
    del bev
    images = [np.clip(image(gs / v["image"]) * gains.get(v["camera"], 1.), 0, 255)
              .astype(np.uint8) for v in train]
    masks = [image(gs / v["mask"], True) for v in train]
    layout = json.loads((root / "layout.json").read_text())
    summary = {"scene": scene, "test_views": len(test), "train_views": len(train),
               "splat_psnr": 17.868448242766075, "static_lidar_points": len(xyz),
               "supported_voxels": len(supported), "camera_gains": gains, "methods": {}}
    parts, previews = {}, {}
    selected = {"CAM_FRONT", "CAM_BACK", "CAM_FRONT_LEFT", "CAM_BACK_RIGHT"}
    for method in ("voxel_smooth", "poisson"):
        print(json.dumps({"phase": "building", "method": method}), flush=True)
        begin = perf_counter()
        checkpoint = target / f"{method}.metrics.json"
        mesh_path = target / f"{method}.npz"
        # Resume this fixed-input POC from completed artifacts after a native failure.
        if checkpoint.exists() and mesh_path.exists():
            with np.load(mesh_path, allow_pickle=False) as saved:
                mesh = tuple(saved[key] for key in ("V", "F", "UV", "atlas"))
            parts[method] = combine_ground(mesh, root, layout)
            summary["methods"][method] = json.loads(checkpoint.read_text())
            previews[method] = {}
            for camera in selected:
                view = next(v for v in test if v["camera"] == camera)
                previews[method][camera] = (view, render(parts[method], view)[0])
            print(json.dumps({"phase": "resumed", "method": method,
                              "metrics": {k: v for k, v in summary["methods"][method].items()
                                          if k != "per_view"}}, allow_nan=False), flush=True)
            continue
        try:
            geometry_stats = {}
            V, F = build_static_mesh(xyz, method=method, stats=geometry_stats)
        except ImportError as exc:
            if method != "poisson":
                raise
            summary["methods"][method] = {"unavailable": str(exc)}
            continue
        geometry_s = perf_counter() - begin
        print(json.dumps({"phase": "texturing", "method": method, "geometry_s": geometry_s,
                          "triangles": len(F)}), flush=True)
        V, F, UV, atlas, stats = texture_mesh(V, F, train, images, masks, atlas_px=8192)
        stats.pop("chosen_views")
        mesh = (V, F, UV, atlas)
        export_textured(target / f"{method}.glb", *mesh)
        save_mesh(target / f"{method}.npz", *mesh)
        parts[method] = combine_ground(mesh, root, layout)
        export_textured(target / "ground.glb", *parts[method][1])
        build_s = perf_counter() - begin
        covered_rows, full_rows, coverage_count, background_count = [], [], 0, 0
        per_view = []
        previews[method] = {}
        for view in test:
            pred, coverage = render(parts[method], view)
            truth, background = image(gs / view["image"]), image(gs / view["mask"], True) == 255
            covered = masked_metrics(pred, truth, background & coverage)
            full = masked_metrics(pred, truth, background)
            covered_rows.append(covered)
            full_rows.append(full)
            coverage_count += int((background & coverage).sum())
            background_count += int(background.sum())
            per_view.append({"id": view["id"], "covered": covered, "full": full})
            if view["camera"] in selected and view["camera"] not in previews[method]:
                previews[method][view["camera"]] = (view, pred)
        summary["methods"][method] = {
            **stats, **geometry_stats, "covered": aggregate(covered_rows), "full_background": aggregate(full_rows),
            "coverage": coverage_count / background_count, "geometry_s": geometry_s,
            "build_texture_s": build_s, "evaluation_s": perf_counter() - begin - build_s,
            "glb_bytes": (target / f"{method}.glb").stat().st_size, "per_view": per_view}
        write_json(checkpoint, summary["methods"][method])
        print(json.dumps({"method": method, **{k: v for k, v in summary["methods"][method].items()
                                              if k != "per_view"}}, allow_nan=False), flush=True)
    for camera in sorted(selected):
        view, a = previews["voxel_smooth"][camera]
        b = previews.get("poisson", {}).get(camera, (None, np.zeros_like(a)))[1]
        splat = image(gs / "bg/renders" / f"test_{view['id']}.jpg")
        if splat.shape == (view["height"], 3 * view["width"], 3):
            # S6 saves [truth | prediction | mask]; only prediction belongs here.
            splat = splat[:, view["width"]:2 * view["width"]]
        if splat.shape != a.shape:
            raise ValueError(f"Unexpected splat render dimensions for {view['id']}")
        columns = []
        for label, rgb in zip(("REAL", "SPLAT M0", "VOXEL + TEXTURE", "POISSON + TEXTURE"),
                              (image(gs / view["image"]), splat, a, b)):
            panel = rgb.copy()
            cv2.putText(panel, label, (15, 30), cv2.FONT_HERSHEY_SIMPLEX, .7, (255, 255, 255), 2)
            columns.append(panel)
        write_image(evidence / f"compare_{camera}.jpg", np.concatenate(columns, axis=1))
        offset = copy.deepcopy(view)
        pose = np.array(offset["c2w"])
        pose[:3, 3] -= 2 * pose[:3, 0]
        offset["c2w"] = pose.tolist()
        write_image(evidence / f"offset_{camera}.jpg",
                    np.concatenate([render(parts[m], offset)[0] for m in parts], axis=1))
    aerial = copy.deepcopy(test[0])
    center = np.array(layout["frames"][0]["T_world_lidar"])[:3, 3]
    pose = np.eye(4)
    forward = np.array([0., 1., -1.]) / np.sqrt(2)
    right = np.array([1., 0., 0.])
    pose[:3, :3] = np.column_stack((right, np.cross(forward, right), forward))
    pose[:3, 3] = center + [0, -15, 15]
    aerial["c2w"] = pose.tolist()
    write_image(evidence / "aerial.jpg",
                np.concatenate([render(parts[m], aerial)[0] for m in parts], axis=1))
    summary["total_s"] = perf_counter() - started
    summary["build_texture_total_s"] = sum(v.get("build_texture_s", 0)
                                            for v in summary["methods"].values())
    write_json(target / "metrics.json", summary)
    write_json(evidence / "metrics.json", summary)
    print(json.dumps({k: v for k, v in summary.items() if k != "methods"}), flush=True)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", required=True)
    args = parser.parse_args()
    return evaluate(args.scene)


if __name__ == "__main__":
    raise SystemExit(main())
