"""Local masked background Gaussian training; consumes SPEC-S6's file contract."""

from __future__ import annotations

import argparse
import json
import math
import resource
import time
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
from gsplat import export_splats, rasterization, rasterization_2dgs
from gsplat.strategy import DefaultStrategy
from gsplat.strategy.ops import duplicate, split
from gsplat.utils import depth_to_normal
from PIL import Image
from plyfile import PlyData
from scipy.spatial import cKDTree
from torch import nn
from torch.nn import functional as F

C0 = 0.28209479177387814


class CappedStrategy(DefaultStrategy):
    """Keep gsplat's default refinement, but budget growth BEFORE allocating."""

    def __init__(self, max_gaussians: int, **kwargs):
        super().__init__(**kwargs)
        self.max_gaussians = max_gaussians

    @torch.no_grad()
    def _grow_gs(self, params, optimizers, state, step):
        grads = state["grad2d"] / state["count"].clamp_min(1)
        small = params["scales"].exp().max(-1).values <= self.grow_scale3d * state["scene_scale"]
        dupli = (grads > self.grow_grad2d) & small
        splitting = (grads > self.grow_grad2d) & ~small
        if step < self.refine_scale2d_stop_iter:
            splitting |= state["radii"] > self.grow_scale2d
        budget = max(0, self.max_gaussians - len(grads))
        candidates = torch.where(dupli | splitting)[0]
        if len(candidates) > budget:
            chosen = candidates[torch.topk(grads[candidates], budget).indices]
            allowed = torch.zeros_like(dupli)
            allowed[chosen] = True
            dupli &= allowed
            splitting &= allowed
        n_dupli, n_split = int(dupli.sum()), int(splitting.sum())
        if n_dupli:
            duplicate(params, optimizers, state, mask=dupli)
        if n_split:
            splitting = torch.cat(
                [splitting, torch.zeros(n_dupli, device=grads.device, dtype=torch.bool)]
            )
            split(params, optimizers, state, mask=splitting, revised_opacity=self.revised_opacity)
        return n_dupli, n_split


def local_path(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"Dataset path escapes root: {relative}")
    return path


class Dataset:
    def __init__(self, root: Path):
        self.root = root
        self.load = lru_cache(maxsize=8)(self._load)
        self.views = json.loads((root / "cameras.json").read_text())
        if not isinstance(self.views, list) or not self.views:
            raise ValueError("cameras.json must contain views")
        ids = set()
        for view in self.views:
            if view["id"] in ids or view["split"] not in ("train", "test"):
                raise ValueError("Duplicate view ID or invalid split")
            ids.add(view["id"])
            safe_id = str(view["id"])
            if not safe_id or any(
                c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
                for c in safe_id
            ):
                raise ValueError("Unsafe view ID for render output")
            if view["width"] <= 0 or view["height"] <= 0:
                raise ValueError("Invalid image dimensions")
            k, pose = np.array(view["K"]), np.array(view["c2w"])
            if (
                k.shape != (3, 3)
                or pose.shape != (4, 4)
                or not np.isfinite(k).all()
                or not np.isfinite(pose).all()
            ):
                raise ValueError("Invalid camera matrices")
            if k[0, 0] <= 0 or k[1, 1] <= 0 or not np.allclose(pose[3], [0, 0, 0, 1]):
                raise ValueError("Invalid camera calibration")
            if (
                not np.allclose(k[2], [0, 0, 1])
                or not np.allclose(pose[:3, :3].T @ pose[:3, :3], np.eye(3), atol=1e-4)
                or not np.isclose(np.linalg.det(pose[:3, :3]), 1, atol=1e-4)
            ):
                raise ValueError("Camera must use rigid OpenCV c2w and pinhole K")
            for key in ("image", "mask", "depth"):
                local_path(root, view[key])
        self.train_ids = [i for i, v in enumerate(self.views) if v["split"] == "train"]
        self.test_ids = [i for i, v in enumerate(self.views) if v["split"] == "test"]
        if not self.train_ids or not self.test_ids:
            raise ValueError("Dataset needs both train and test views")
        self.skipped_views = []
        usable = set()
        for i, view in enumerate(self.views):
            with Image.open(local_path(root, view["mask"])) as image:
                mask = np.array(image.convert("L"))
            if mask.shape != (view["height"], view["width"]) or not np.isin(mask, [0, 255]).all():
                raise ValueError(f"Invalid binary mask: {view['id']}")
            fraction = float((mask == 255).mean())
            if fraction < 0.05:
                self.skipped_views.append(
                    {"id": view["id"], "split": view["split"], "background_fraction": fraction}
                )
            else:
                usable.add(i)
        self.train_ids = [i for i in self.train_ids if i in usable]
        self.test_ids = [i for i in self.test_ids if i in usable]
        if not self.train_ids or not self.test_ids:
            raise ValueError("Dataset needs usable train and test views after mask filtering")
        self.camera_ids = {
            name: i for i, name in enumerate(sorted({v["camera"] for v in self.views}))
        }
        if {self.views[i]["camera"] for i in self.test_ids} - {
            self.views[i]["camera"] for i in self.train_ids
        }:
            raise ValueError("Test cameras must have training exposure observations")

    def _load(self, index):
        v = self.views[index]
        with Image.open(local_path(self.root, v["image"])) as image:
            rgb = np.array(image.convert("RGB"), dtype=np.float32) / 255
        with Image.open(local_path(self.root, v["mask"])) as image:
            raw_mask = np.array(image.convert("L"))
        depth = np.load(local_path(self.root, v["depth"]), allow_pickle=False)
        shape = (v["height"], v["width"])
        if rgb.shape != (*shape, 3) or raw_mask.shape != shape or depth.shape != shape:
            raise ValueError(f"Image/mask/depth shape mismatch: {v['id']}")
        if depth.dtype != np.float32 or not np.isfinite(depth).all() or (depth < 0).any():
            raise ValueError(f"Invalid float32 depth: {v['id']}")
        if not np.isin(raw_mask, [0, 255]).all() or not (raw_mask == 255).any():
            raise ValueError(f"Invalid or empty background mask: {v['id']}")
        return rgb, raw_mask == 255, depth

    def tensors(self, index, device):
        return tuple(torch.from_numpy(a.copy()).to(device) for a in self.load(index))


def read_points(path: Path):
    points = PlyData.read(str(path))["vertex"].data
    xyz = np.stack([points[name] for name in ("x", "y", "z")], -1).astype(np.float32)
    rgb = np.stack([points[name] for name in ("red", "green", "blue")], -1).astype(np.float32) / 255
    if (
        len(xyz) < 2
        or not np.isfinite(xyz).all()
        or not np.isfinite(rgb).all()
        or (rgb < 0).any()
        or (rgb > 1).any()
    ):
        raise ValueError("init_points.ply requires at least two finite colored points")
    return xyz, rgb


def initialize(xyz, rgb, device, max_gaussians, fixed_scale=None):
    if len(xyz) > max_gaussians:
        # Uniform, deterministic sample; never allocate above the configured cap.
        indices = np.linspace(0, len(xyz) - 1, max_gaussians, dtype=int)
        xyz, rgb = xyz[indices], rgb[indices]
    if fixed_scale is None:
        distances = cKDTree(xyz).query(xyz, k=min(4, len(xyz)), workers=1)[0][:, 1:]
        scales = np.sqrt((distances**2).mean(-1)).clip(0.05, 1.0)
    else:
        scales = np.full(len(xyz), fixed_scale)
    quats = np.zeros((len(xyz), 4), dtype=np.float32)
    quats[:, 0] = 1
    values = {
        "means": xyz,
        "scales": np.repeat(np.log(scales)[:, None], 3, axis=1),
        "quats": quats,
        "opacities": np.full(len(xyz), math.log(0.1 / 0.9)),
        "sh0": ((rgb - 0.5) / C0)[:, None, :],
    }
    return nn.ParameterDict(
        {
            k: nn.Parameter(torch.as_tensor(v, dtype=torch.float32, device=device))
            for k, v in values.items()
        }
    )


def masked_ssim(pred, target, mask):
    """Local SSIM using ONLY valid pixels for moments and averaging."""
    x, y = pred.permute(2, 0, 1)[None], target.permute(2, 0, 1)[None]
    m = mask[None, None].to(pred.dtype)
    # MPS overlapping avg_pool2d backward disagrees with finite differences.
    # Fixed convolution computes the same moments with verified gradients.
    kernel = torch.full((3, 1, 11, 11), 1 / 121, device=pred.device, dtype=pred.dtype)
    weight = F.conv2d(m, kernel[:1], padding=5).clamp_min(1e-6)

    def mean(a):
        return F.conv2d(a * m, kernel, padding=5, groups=3) / weight

    ux, uy = mean(x), mean(y)
    vx, vy, cov = (
        (mean(x * x) - ux * ux).clamp_min(0),
        (mean(y * y) - uy * uy).clamp_min(0),
        mean(x * y) - ux * uy,
    )
    score = ((2 * ux * uy + 0.01**2) * (2 * cov + 0.03**2)) / (
        (ux**2 + uy**2 + 0.01**2) * (vx + vy + 0.03**2)
    )
    return score[0, :, mask].mean()


def losses(pred, target, mask, depth, lidar, depth_weight, normal_error=None, sky_mask=None):
    if sky_mask is not None:
        sky = sky_mask & mask & (lidar == 0)
        ground = mask & ~sky
        total = pred.sum() * 0
        if ground.any():
            total = total + losses(pred, target, ground, depth, lidar, depth_weight, normal_error)
        if sky.any():
            # Supervise the composited RGB, including any geometry in this sparse-depth region.
            total = total + losses(pred, target, sky, depth, lidar, 0)
        return total
    l1 = (pred[mask] - target[mask]).abs().mean()
    ssim = masked_ssim(pred, target, mask)
    total = 0.8 * l1 + 0.2 * (1 - ssim)
    valid_depth = mask & (lidar > 0)
    if depth_weight and valid_depth.any():
        total = total + depth_weight * (depth[valid_depth] - lidar[valid_depth]).abs().mean()
    if normal_error is not None:
        total = total + 0.05 * normal_error[mask].mean()
    return total


@lru_cache(maxsize=128)
def sky_geometry(width, height, intrinsic, rotation):
    """World ray elevation and periodic 64x32 lat-long lookup per pixel."""
    y, x = np.mgrid[:height, :width]
    rays = np.stack([x + 0.5, y + 0.5, np.ones_like(x)], -1)
    rays = rays @ np.linalg.inv(np.array(intrinsic).reshape(3, 3)).T
    rays = rays @ np.array(rotation).reshape(3, 3).T
    rays /= np.linalg.norm(rays, axis=-1, keepdims=True)
    longitude = (np.arctan2(rays[..., 1], rays[..., 0]) + np.pi) / (2 * np.pi)
    latitude = (np.arcsin(rays[..., 2]) + np.pi / 2) / np.pi
    return (rays[..., 2] > 0, np.minimum((latitude * 32).astype(int), 31),
            (longitude * 64).astype(int) % 64)


def sky_pixels(view, device):
    rotation = np.array(view["c2w"])[:3, :3]
    arrays = sky_geometry(view["width"], view["height"],
                          tuple(np.array(view["K"]).ravel()), tuple(rotation.ravel()))
    return tuple(torch.as_tensor(a.copy(), device=device) for a in arrays)


def background_image(background, view):
    if background.ndim == 3 and tuple(background.shape) == (32, 64, 3):
        _, rows, columns = sky_pixels(view, background.device)
        return background[rows, columns]
    return background


def render(params, view, mode, background, need_depth=False):
    device = params["means"].device
    viewmat = torch.as_tensor(
        np.linalg.inv(np.array(view["c2w"])), dtype=torch.float32, device=device
    )[None]
    k = torch.as_tensor(view["K"], dtype=torch.float32, device=device)[None]
    # Metal projection backward evaluates 1/z^3 even for culled points.
    # Behind-camera z is clamped to 1e-12 internally, producing 0*Inf NaNs.
    # Preserve dense indexing for DefaultStrategy, while giving culled points
    # safe constant geometry and zero opacity BEFORE entering that kernel.
    camera_xyz = params["means"] @ viewmat[0, :3, :3].T + viewmat[0, :3, 3]
    active = camera_xyz[:, 2] >= 0.01
    safe_world = (
        torch.as_tensor(view["c2w"], dtype=torch.float32, device=device)[:3, 3]
        + torch.as_tensor(view["c2w"], dtype=torch.float32, device=device)[:3, 2]
    )
    means = torch.where(active[:, None], params["means"], safe_world[None])
    opacity = torch.where(
        active, params["opacities"].sigmoid(), torch.zeros_like(params["opacities"])
    )
    kwargs = {
        "means": means,
        "quats": params["quats"],
        "scales": params["scales"].exp(),
        "opacities": opacity,
        "viewmats": viewmat,
        "Ks": k,
        "width": view["width"],
        "height": view["height"],
        "packed": False,
        "render_mode": "RGB",
    }
    rasterizer = rasterization if mode == "3dgs" else rasterization_2dgs
    result = rasterizer(**kwargs, colors=params["sh0"], sh_degree=0)
    rgb, alpha, info = result[0][0], result[1][0, ..., 0], result[-1]
    rgb = rgb + (1 - alpha[..., None]) * background_image(background, view)
    depth, normal_error = None, None
    if need_depth or mode == "2dgs":
        z = (params["means"] @ viewmat[0, :3, :3].T + viewmat[0, :3, 3])[:, 2]
        depth_result = rasterizer(**kwargs, colors=z[:, None].repeat(1, 3))
        depth = depth_result[0][0, ..., 0] / depth_result[1][0, ..., 0].clamp_min(1e-10)
        if mode == "2dgs":
            normals_from_depth = depth_to_normal(
                depth[None, ..., None],
                torch.as_tensor(view["c2w"], dtype=torch.float32, device=device)[None],
                k,
            ).squeeze(0)
            normal_error = 1 - (result[2][0] * normals_from_depth * alpha.detach()[..., None]).sum(
                -1
            )
    return rgb, alpha, depth, normal_error, info


@torch.no_grad()
def evaluate(params, dataset, mode, background, affine=None, out=None, save_camera_names=None):
    squared_error, pixel_count, ssim_sum = 0.0, 0, 0.0
    saved_cameras = set()
    if out:
        out.mkdir(parents=True, exist_ok=True)
    for index in dataset.test_ids:
        view = dataset.views[index]
        target, mask, _ = dataset.tensors(index, params["means"].device)
        rgb = render(params, view, mode, background)[0]
        if affine is not None:
            a = affine[dataset.camera_ids[view["camera"]]]
            rgb = rgb @ a[:, :3].T + a[:, 3]
        rgb = rgb.clamp(0, 1)
        count = int(mask.sum())
        squared_error += float((rgb[mask] - target[mask]).square().sum())
        pixel_count += count * 3
        ssim_sum += float(masked_ssim(rgb, target, mask)) * count
        if out and (
            save_camera_names is None
            or (view["camera"] in save_camera_names and view["camera"] not in saved_cameras)
        ):
            saved_cameras.add(view["camera"])
            panel = torch.cat([target, rgb, mask[..., None].expand(-1, -1, 3).float()], 1)
            safe_id = str(view["id"])
            if not safe_id or any(
                c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
                for c in safe_id
            ):
                raise ValueError("Unsafe view ID for render output")
            Image.fromarray((panel.cpu().numpy() * 255).round().astype(np.uint8)).save(
                out / f"test_{safe_id}.jpg", quality=95
            )
    return -10 * math.log10(max(squared_error / pixel_count, 1e-12)), ssim_sum / (pixel_count / 3)


@torch.no_grad()
def save_model(params, affine, background, camera_ids, mode, out, completed):
    out.mkdir(parents=True, exist_ok=True)
    cpu_params = {name: p.detach().cpu() for name, p in params.items()}
    if not all(torch.isfinite(value).all() for value in cpu_params.values()):
        raise RuntimeError("Cannot save nonfinite Gaussian parameters")
    export_splats(
        **cpu_params,
        shN=torch.empty(len(params["means"]), 0, 3),
        save_to=str(out / "point_cloud.ply"),
    )
    torch.save(
        {
            "params": cpu_params,
            "affine": affine.detach().cpu(),
            "background": background.detach().cpu(),
            "camera_ids": camera_ids,
            "mode": mode,
            "iters": completed,
        },
        out / "model.pt",
    )


def checkpoint_cameras(dataset):
    preferred = ("CAM_FRONT", "CAM_BACK", "CAM_FRONT_LEFT", "CAM_BACK_RIGHT")
    available = {dataset.views[i]["camera"] for i in dataset.test_ids}
    selected = [camera for camera in preferred if camera in available]
    selected.extend(sorted(available - set(selected)))
    return set(selected[:4])


def train(
    data: Path,
    out: Path,
    mode="3dgs",
    iters=10000,
    depth_weight=0.01,
    max_gaussians=1_500_000,
    seed=42,
    learn_background=True,
    checkpoint_every=2500,
    time_budget_s=None,
    sky_model=False,
    eval_data=None,
):
    job_started = time.monotonic()
    if (
        (sky_model and not learn_background)
        or (time_budget_s is not None and (not math.isfinite(time_budget_s) or time_budget_s <= 0))
        or mode not in ("3dgs", "2dgs")
        or iters <= 0
        or checkpoint_every <= 0
        or max_gaussians < 2
        or depth_weight < 0
        or not math.isfinite(depth_weight)
    ):
        raise ValueError("Invalid training configuration")
    if out.exists() and any(out.iterdir()):
        raise ValueError(f"Output must be empty to preserve previous runs: {out}")
    if not torch.backends.mps.is_available():
        raise RuntimeError("This trainer requires the local mpsplat MPS backend")
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    dataset = Dataset(data)
    evaluation_dataset = Dataset(eval_data) if eval_data else dataset
    if set(evaluation_dataset.camera_ids) != set(dataset.camera_ids):
        raise ValueError("Evaluation cameras must match training cameras")
    evaluation_dataset.camera_ids = dataset.camera_ids
    if eval_data:
        held_out = {evaluation_dataset.views[i]["id"] for i in evaluation_dataset.test_ids}
        dataset.train_ids = [i for i in dataset.train_ids if dataset.views[i]["id"] not in held_out]
        if not dataset.train_ids:
            raise ValueError("No training views after fixed evaluation holdout")
    xyz, colors = read_points(data / "init_points.ply")
    device = torch.device("mps")
    params = initialize(xyz, colors, device, max_gaussians)
    centers = np.array([v["c2w"] for v in dataset.views])[:, :3, 3]
    scene_scale = max(float(np.linalg.norm(centers - centers.mean(0), axis=1).max()), 1.0)
    rates = {
        "means": 0.00016 * scene_scale,
        "scales": 0.005,
        "quats": 0.001,
        "opacities": 0.05,
        "sh0": 0.0025,
    }
    optimizers = {
        name: torch.optim.Adam([p], lr=rates[name], eps=1e-15) for name, p in params.items()
    }
    affine = nn.Parameter(
        torch.cat([torch.eye(3), torch.zeros(3, 1)], 1)[None]
        .repeat(len(dataset.camera_ids), 1, 1)
        .to(device)
    )
    bg_logits = nn.Parameter(torch.full((32, 64, 3) if sky_model else (3,), 0.0 if sky_model else -4.0, device=device), requires_grad=learn_background)

    def background():
        return bg_logits.sigmoid() if learn_background else torch.zeros(3, device=device)

    exposure_optimizer = torch.optim.Adam([
        {"params": [affine], "lr": 0.0001},
        {"params": [bg_logits], "lr": 0.01 if sky_model else 0.0001},
    ])
    strategy = CappedStrategy(
        max_gaussians, key_for_gradient="means2d" if mode == "3dgs" else "gradient_2dgs"
    )
    strategy.check_sanity(params, optimizers)
    state = strategy.initialize_state(scene_scale)
    # Same full init point set, renderer, and fixed 7 cm footprint for the baseline.
    baseline = initialize(xyz, colors, device, len(xyz), fixed_scale=0.07)
    baseline_psnr = evaluate(baseline, evaluation_dataset, mode, torch.zeros(3, device=device))[0]
    print(
        json.dumps(
            {
                "event": "baseline",
                "psnr_baseline_lidar_splat": baseline_psnr,
                "test_views": len(evaluation_dataset.test_ids),
            }
        ),
        flush=True,
    )
    del baseline
    torch.mps.empty_cache()
    out.mkdir(parents=True, exist_ok=True)
    history = []
    peak = 0
    started = time.monotonic()
    completed = 0
    evaluation_history = []
    stop_reason = None
    checkpoints = {max(1, math.ceil(iters * fraction / 4)) for fraction in (1, 2, 3, 4)}
    first_checkpoint = min(checkpoints)
    for step in range(iters):
        elapsed = time.monotonic() - job_started
        if time_budget_s is not None:
            if elapsed >= time_budget_s:
                stop_reason = "time_budget"
                break
            # Strategy still owns refinement; enable it only during the time window.
            if sky_model:
                fraction = elapsed / time_budget_s
                strategy.refine_start_iter = -1 if fraction >= 0.05 else step + 1
                strategy.refine_stop_iter = step + 1 if fraction < 0.70 else step
        index = int(rng.choice(dataset.train_ids))
        view = dataset.views[index]
        target, mask, lidar = dataset.tensors(index, device)
        rgb, alpha, depth, normal_error, info = render(
            params,
            view,
            mode,
            background() if sky_model or step >= 1000 else torch.zeros(3, device=device),
            need_depth=depth_weight > 0,
        )
        a = affine[dataset.camera_ids[view["camera"]]]
        rgb = rgb @ a[:, :3].T + a[:, 3]
        loss = losses(
            rgb, target, mask, depth, lidar, depth_weight, normal_error,
            sky_mask=sky_pixels(view, device)[0] if sky_model else None,
        )
        if not torch.isfinite(loss):
            raise RuntimeError(f"Nonfinite loss at step {step}")
        strategy.step_pre_backward(params, optimizers, state, step, info)
        loss.backward()
        for name, parameter in params.items():
            if parameter.grad is None or not torch.isfinite(parameter.grad).all():
                raise RuntimeError(f"Nonfinite or missing {name} gradient at step {step}")
        for parameter in (affine, bg_logits) if sky_model or step >= 1000 else (affine,):
            if parameter.requires_grad and (
                parameter.grad is None or not torch.isfinite(parameter.grad).all()
            ):
                raise RuntimeError(f"Nonfinite exposure/background gradient at step {step}")
        for optimizer in optimizers.values():
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
        exposure_optimizer.step()
        exposure_optimizer.zero_grad(set_to_none=True)
        strategy.step_post_backward(params, optimizers, state, step, info, packed=False)
        if len(params["means"]) == 0:
            raise RuntimeError("DefaultStrategy pruned every Gaussian")
        peak = max(peak, torch.mps.driver_allocated_memory())
        completed = step + 1
        if step % 100 == 0 or completed == iters:
            value = float(loss.detach())
            history.append({"step": completed, "loss": value})
            print(
                json.dumps(
                    {
                        "step": completed,
                        "loss": value,
                        "gaussians": len(params["means"]),
                        "alpha_mean": float(alpha.detach().mean()),
                        "elapsed_s": time.monotonic() - started,
                    }
                ),
                flush=True,
            )
        checkpoint_due = completed % checkpoint_every == 0
        if time_budget_s is None and (completed in checkpoints or checkpoint_due):
            checkpoint_dir = (
                out / "checkpoints" / f"step_{completed:06d}" if checkpoint_due else None
            )
            test_psnr, test_ssim = evaluate(
                params,
                dataset,
                mode,
                background(),
                affine,
                checkpoint_dir / "renders" if checkpoint_dir else None,
                checkpoint_cameras(dataset) if checkpoint_dir else None,
            )
            observation = {
                "event": "evaluation",
                "step": completed,
                "psnr_test_masked": test_psnr,
                "ssim_test_masked": test_ssim,
                "gain_db": test_psnr - baseline_psnr,
            }
            evaluation_history.append(observation)
            print(json.dumps(observation), flush=True)
            if checkpoint_dir:
                save_model(
                    params,
                    affine,
                    background(),
                    dataset.camera_ids,
                    mode,
                    checkpoint_dir,
                    completed,
                )
                checkpoint_metrics = {
                    **observation,
                    "iters": completed,
                    "gaussians": len(params["means"]),
                    "psnr_baseline_lidar_splat": baseline_psnr,
                    "train_s": time.monotonic() - started,
                }
                (checkpoint_dir / "metrics.json").write_text(
                    json.dumps(checkpoint_metrics, indent=2, allow_nan=False) + "\n"
                )
                print(
                    json.dumps(
                        {"event": "checkpoint", "step": completed, "path": str(checkpoint_dir)}
                    ),
                    flush=True,
                )
            if completed == first_checkpoint and test_psnr < baseline_psnr + 2:
                stop_reason = "baseline_gain_below_2dB_at_25_percent"
                break
        if time.monotonic() - started >= 3 * 3600:
            stop_reason = "three_hour_limit"
            break
    torch.mps.synchronize()
    train_s = time.monotonic() - started
    psnr, ssim = evaluate(params, evaluation_dataset, mode, background(), affine, out / "renders")
    save_model(params, affine, background(), dataset.camera_ids, mode, out, completed)
    peak = max(peak, torch.mps.driver_allocated_memory())
    metrics = {
        "psnr_test_masked": psnr,
        "ssim_test_masked": ssim,
        "psnr_baseline_lidar_splat": baseline_psnr,
        "gaussians": len(params["means"]),
        "iters": completed,
        "train_s": train_s,
        "peak_mem_gb": (peak + resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) / 1e9,
        "peak_mem_method": "Conservative sum of sampled MPS driver peak and process RSS high-water mark; peaks need not be simultaneous",
        "peak_mps_driver_gb": peak / 1e9,
        "peak_process_rss_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9,
        "mode": mode,
        "depth_weight": depth_weight,
        "max_gaussians": max_gaussians,
        "seed": seed,
        "loss_history": history,
        "evaluation_history": evaluation_history,
        "stop_reason": stop_reason,
        "gate_psnr": psnr >= 23 and psnr - baseline_psnr >= 5,
        "requested_iters": iters,
        "checkpoint_every": checkpoint_every,
        "train_views": len(dataset.train_ids),
        "dataset_test_views": len(dataset.test_ids),
        "evaluation_test_ids": [evaluation_dataset.views[i]["id"] for i in evaluation_dataset.test_ids],
        "evaluation_train_overlap": len(
            {dataset.views[i]["id"] for i in dataset.train_ids}
            & {evaluation_dataset.views[i]["id"] for i in evaluation_dataset.test_ids}
        ),
        "test_views": len(evaluation_dataset.test_ids),
        "skipped_views": dataset.skipped_views,
        "skipped_view_fraction": len(dataset.skipped_views) / len(dataset.views),
        "background_completion": "learned lat-long 64x32 RGB" if sky_model else ("learned constant RGB" if learn_background else "disabled black"),
        "time_budget_s": time_budget_s,
        "total_s": time.monotonic() - job_started,
        "sky_model": sky_model,
        "eval_data": str(eval_data) if eval_data else str(data),
        "learn_background": learn_background,
        "exposure_affine": affine.detach().cpu().tolist(),
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2, allow_nan=False) + "\n")
    print(json.dumps(metrics), flush=True)
    return metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--mode", choices=("3dgs", "2dgs"), default="3dgs")
    parser.add_argument("--iters", type=int, default=10000)
    parser.add_argument("--depth-weight", type=float, default=0.01)
    parser.add_argument("--max-gaussians", type=int, default=1_500_000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--no-background", action="store_true", help="Disable learned background completion"
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=2500,
        help="Save model and up to four test previews every N steps",
    )
    parser.add_argument("--time-budget-s", type=float)
    parser.add_argument("--sky-model", action="store_true")
    parser.add_argument("--eval-data", type=Path)
    args = parser.parse_args()
    train(
        args.data,
        args.out,
        args.mode,
        args.iters,
        args.depth_weight,
        args.max_gaussians,
        args.seed,
        not args.no_background,
        args.checkpoint_every,
        args.time_budget_s,
        args.sky_model,
        args.eval_data,
    )


if __name__ == "__main__":
    main()
