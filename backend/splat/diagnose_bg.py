"""Measure dataset/rasterizer conventions and save baseline RGB/alpha evidence."""

import json
from pathlib import Path

import numpy as np
import torch
from gsplat import rasterization
from PIL import Image
from train_bg import Dataset, initialize, read_points, render


def diagnose(data, out):
    out.mkdir(parents=True, exist_ok=True)
    dataset = Dataset(data)
    xyz, colors = read_points(data / "init_points.ply")
    index = dataset.test_ids[0]
    view = dataset.views[index]
    target, _mask, _ = dataset.tensors(index, "mps")
    params = initialize(xyz, colors, "mps", len(xyz), fixed_scale=0.07)
    w2c = np.linalg.inv(np.array(view["c2w"]))
    camera_xyz = xyz @ w2c[:3, :3].T + w2c[:3, 3]
    pixel_h = camera_xyz @ np.array(view["K"]).T
    pixels = pixel_h[:, :2] / pixel_h[:, 2:3]
    inside = (
        (camera_xyz[:, 2] > 0)
        & (pixels[:, 0] >= 0)
        & (pixels[:, 0] < view["width"])
        & (pixels[:, 1] >= 0)
        & (pixels[:, 1] < view["height"])
    )
    with torch.no_grad():
        rgb, alpha, _, _, info = render(params, view, "3dgs", torch.zeros(3, device="mps"))
        direct, _, _direct_info = rasterization(
            means=params["means"],
            quats=params["quats"],
            scales=params["scales"].exp(),
            opacities=params["opacities"].sigmoid(),
            colors=torch.as_tensor(colors, device="mps"),
            viewmats=torch.tensor(w2c, device="mps", dtype=torch.float32)[None],
            Ks=torch.tensor(view["K"], device="mps", dtype=torch.float32)[None],
            width=view["width"],
            height=view["height"],
            packed=False,
            render_mode="RGB",
        )
        projected = info["means2d"][0].cpu().numpy()
        radii = info["radii"][0].cpu().numpy()
        valid = inside & (np.max(radii, -1) > 0)
        metrics = {
            "view": view["id"],
            "width": view["width"],
            "height": view["height"],
            "camera_xyz_extent": [camera_xyz.min(0).tolist(), camera_xyz.max(0).tolist()],
            "inside_numpy": int(inside.sum()),
            "valid_rasterizer": int(valid.sum()),
            "max_projection_error_px": float(np.abs(projected[valid] - pixels[valid]).max())
            if valid.any()
            else None,
            "init_rgb_range": [colors.min(0).tolist(), colors.max(0).tolist()],
            "image_rgb_range": [target.amin((0, 1)).tolist(), target.amax((0, 1)).tolist()],
            "alpha_max": float(alpha.max()),
            "alpha_mean": float(alpha.mean()),
            "alpha_nonzero": int((alpha > 1e-4).sum()),
            "rgb_max": float(rgb.max()),
            "rgb_mean": float(rgb.mean()),
            "sh_direct_rgb_max_error": float((direct[0] - rgb).abs().max()),
            "meta_keys": list(info),
            "tiles_per_gauss_sum": int(info["tiles_per_gauss"].sum()),
            "flatten_ids_count": len(info["flatten_ids"]),
        }
    panel = torch.cat([target, rgb, alpha[..., None].expand(-1, -1, 3)], 1)
    Image.fromarray((panel.clamp(0, 1).cpu().numpy() * 255).round().astype("u1")).save(
        out / "h08-baseline-rgb-alpha.jpg", quality=95
    )
    print(json.dumps(metrics, indent=2))
    (out / "h08-diagnose.json").write_text(json.dumps(metrics, indent=2) + "\n")


if __name__ == "__main__":
    diagnose(
        Path("backend/data/sim/scene-0061/gs"),
        Path("planning/02_2026-10-05_blender-real2sim/evidence/s6"),
    )
