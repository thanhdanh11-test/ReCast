"""Contract, masking, bounded refinement, and real MPS convergence proofs."""

import json
from pathlib import Path

import numpy as np
import pytest
import torch
from PIL import Image
from plyfile import PlyData, PlyElement
from train_bg import CappedStrategy, Dataset, initialize, losses, masked_ssim, render, train


def write_dataset(root: Path):
    root.mkdir()
    xyz = np.array([[x, y, 3] for x in (-0.6, 0, 0.6) for y in (-0.6, 0, 0.6)], dtype=np.float32)
    color = np.array([[0.3 + i * 0.05, 0.65 - i * 0.04, 0.35] for i in range(9)], dtype=np.float32)
    records = np.empty(
        len(xyz),
        dtype=[(n, "<f4") for n in ("x", "y", "z")] + [(n, "u1") for n in ("red", "green", "blue")],
    )
    for i, n in enumerate(("x", "y", "z")):
        records[n] = xyz[:, i]
    for i, n in enumerate(("red", "green", "blue")):
        records[n] = (color[:, i] * 255).astype(np.uint8)
    PlyData([PlyElement.describe(records, "vertex")]).write(str(root / "init_points.ply"))
    target = initialize(xyz, color, "mps", 9)
    # Different opacity makes the input a genuinely untrained LiDAR seed.
    with torch.no_grad():
        target["opacities"].fill_(torch.logit(torch.tensor(0.7)).item())
    views = []
    for i in range(4):
        pose = np.eye(4)
        pose[0, 3] = (-0.1, 0.1, -0.05, 0.05)[i]
        view = {
            "id": str(i),
            "camera": f"CAM_{i % 2}",
            "timestamp_us": i * 100000,
            "image": f"{i}.jpg",
            "mask": f"{i}.png",
            "depth": f"{i}.npy",
            "width": 32,
            "height": 32,
            "K": [[30, 0, 16], [0, 30, 16], [0, 0, 1]],
            "c2w": pose.tolist(),
            "split": "train" if i < 2 else "test",
        }
        with torch.no_grad():
            rgb, alpha, depth, _, _ = render(
                target, view, "3dgs", torch.zeros(3, device="mps"), True
            )
        Image.fromarray((rgb.cpu().numpy().clip(0, 1) * 255).round().astype("u1")).save(
            root / view["image"], quality=100, subsampling=0
        )
        mask = np.full((32, 32), 255, dtype="u1")
        mask[:2, :2] = 0
        Image.fromarray(mask).save(root / view["mask"])
        d = depth.cpu().numpy().astype("f4")
        d[alpha.cpu().numpy() < 0.1] = 0
        np.save(root / view["depth"], d)
        views.append(view)
    (root / "cameras.json").write_text(json.dumps(views))
    return root


def test_masked_losses_ignore_actor_pixels():
    target = torch.zeros(16, 16, 3)
    pred = target.clone()
    mask = torch.ones(16, 16, dtype=torch.bool)
    mask[:8] = False
    pred[:8] = 10
    lidar = torch.zeros(16, 16)
    lidar[:8] = 100
    loss = losses(pred, target, mask, torch.zeros_like(lidar), lidar, 1)
    assert float(loss) == pytest.approx(0, abs=1e-6)
    assert float(masked_ssim(pred, target, mask)) == pytest.approx(1)
    lidar[12, 12] = 2
    assert float(losses(pred, target, mask, torch.zeros_like(lidar), lidar, 0.1)) == pytest.approx(
        0.2
    )


@pytest.mark.parametrize("cap", [4, 5, 6, 10])
def test_densification_cap_and_optimizer_state(cap):
    xyz = np.array([[i, 0, 3] for i in range(4)], dtype="f4")
    params = initialize(xyz, np.full((4, 3), 0.5), "cpu", 4)
    with torch.no_grad():
        params["scales"][:2] = -8  # Both duplication and splitting exercised.
    optimizers = {k: torch.optim.Adam([p]) for k, p in params.items()}
    sum(p.sum() for p in params.values()).backward()
    for opt in optimizers.values():
        opt.step()
        opt.zero_grad()
    state = {
        "grad2d": torch.tensor([1.0, 2.0, 3.0, 4.0]),
        "count": torch.ones(4),
        "scene_scale": 1.0,
    }
    strategy = CappedStrategy(cap)
    strategy._grow_gs(params, optimizers, state, 600)
    assert len(params["means"]) == min(cap, 8)
    for k, p in params.items():
        assert optimizers[k].state[p]["exp_avg"].shape == p.shape
    assert len(state["grad2d"]) == len(params["means"])


def test_depth_two_rgb_passes_and_2dgs_backward():
    xyz = np.array([[x, 0, 3] for x in (-0.5, 0, 0.5)], dtype="f4")
    params = initialize(xyz, np.full((3, 3), 0.5), "mps", 3)
    view = {
        "c2w": np.eye(4).tolist(),
        "K": [[20, 0, 8], [0, 20, 8], [0, 0, 1]],
        "width": 16,
        "height": 16,
    }
    for mode in ("3dgs", "2dgs"):
        rgb, alpha, depth, normals, _ = render(
            params, view, mode, torch.zeros(3, device="mps"), True
        )
        assert float((depth[alpha > 0.001] - 3).abs().max().detach()) < 1e-5
        loss = rgb.mean() + depth.mean() * 0.01
        if mode == "2dgs":
            assert normals is not None and torch.isfinite(normals).all()
            loss = loss + normals.mean() * 0.05
        loss.backward()
        assert all(p.grad is not None and torch.isfinite(p.grad).all() for p in params.values())
        for p in params.values():
            p.grad = None


def test_dataset_validation(tmp_path):
    root = tmp_path / "invalid"
    root.mkdir()
    view = {
        "id": "0",
        "split": "train",
        "width": 1,
        "height": 1,
        "K": np.eye(3).tolist(),
        "c2w": np.eye(4).tolist(),
        "camera": "A",
        "image": "../outside.jpg",
        "mask": "mask.png",
        "depth": "depth.npy",
    }
    (root / "cameras.json").write_text(json.dumps([view]))
    with pytest.raises(ValueError, match="escapes"):
        Dataset(root)
    view["image"] = "image.jpg"
    (root / "cameras.json").write_text(json.dumps([view]))
    with pytest.raises(ValueError, match="both train and test"):
        Dataset(root)


def test_synthetic_300_step_convergence(tmp_path):
    data = write_dataset(tmp_path / "synthetic")
    metrics = train(data, tmp_path / "bg", iters=300, depth_weight=0.01, max_gaussians=20, seed=5)
    assert metrics["loss_history"][-1]["loss"] < metrics["loss_history"][0]["loss"]
    assert metrics["psnr_test_masked"] > 25
    assert metrics["iters"] == 300
    assert metrics["gaussians"] <= 20
    saved = json.loads((tmp_path / "bg" / "metrics.json").read_text())
    assert saved == metrics
    ply = PlyData.read(str(tmp_path / "bg" / "point_cloud.ply"))
    assert "f_dc_0" in ply["vertex"].data.dtype.names
    assert "opacity" in ply["vertex"].data.dtype.names
    assert len(list((tmp_path / "bg" / "renders").glob("test_*.jpg"))) == 2
    with pytest.raises(ValueError, match="empty"):
        train(data, tmp_path / "bg", iters=1)


def test_ssim_gradient_matches_cpu_on_mps():
    gradients = []
    for device in ("cpu", "mps"):
        pred = torch.full((32, 32, 3), 0.1, device=device, requires_grad=True)
        target = torch.full_like(pred, 0.4)
        mask = torch.ones((32, 32), device=device, dtype=torch.bool)
        loss = 0.8 * (pred[mask] - target[mask]).abs().mean() + 0.2 * (
            1 - masked_ssim(pred, target, mask)
        )
        loss.backward()
        gradients.append(pred.grad.cpu())
    torch.testing.assert_close(gradients[0], gradients[1], atol=2e-7, rtol=1e-3)
    assert (gradients[1] < 0).all()


def test_skip_low_background_views_without_changing_dataset(tmp_path):
    root = write_dataset(tmp_path / "data")
    for index in (0, 2):
        mask = np.zeros((32, 32), dtype="u1")
        mask[0, 0] = 255 if index == 0 else 0
        Image.fromarray(mask).save(root / f"{index}.png")
    manifest = (root / "cameras.json").read_bytes()
    dataset = Dataset(root)
    assert dataset.train_ids == [1]
    assert dataset.test_ids == [3]
    assert dataset.skipped_views == [
        {"id": "0", "split": "train", "background_fraction": 1 / 1024},
        {"id": "2", "split": "test", "background_fraction": 0},
    ]
    assert (root / "cameras.json").read_bytes() == manifest


def test_behind_camera_gradients_stay_finite_and_culled():
    xyz = np.array([[0, 0, 3], [1, 2, -3], [0, 0, 0], [1, 1, 0.001]], dtype="f4")
    params = initialize(xyz, np.full((4, 3), 0.5), "mps", 4)
    view = {
        "c2w": np.eye(4).tolist(),
        "K": [[20, 0, 8], [0, 20, 8], [0, 0, 1]],
        "width": 16,
        "height": 16,
    }
    rgb, _, depth, _, info = render(params, view, "3dgs", torch.zeros(3, device="mps"), True)
    (rgb.mean() + depth.mean() * 0.01).backward()
    for parameter in params.values():
        assert torch.isfinite(parameter.grad).all()
        assert torch.equal(parameter.grad[1:], torch.zeros_like(parameter.grad[1:]))
    assert (info["radii"][0, 1:] == 0).all()


def test_100_onehot_projections_match_numpy():
    angle = 0.4
    pose = np.eye(4)
    pose[:3, :3] = [
        [np.cos(angle), 0, np.sin(angle)],
        [0, 1, 0],
        [-np.sin(angle), 0, np.cos(angle)],
    ]
    pose[:3, 3] = [100, -80, 5]
    view = {
        "c2w": pose.tolist(),
        "K": [[30, 0, 16], [0, 30, 16], [0, 0, 1]],
        "width": 32,
        "height": 32,
    }
    for i in range(100):
        camera_xyz = np.array([((i % 10) - 4.5) * 0.15, ((i // 10) - 4.5) * 0.15, 3.0])
        world_xyz = camera_xyz @ pose[:3, :3].T + pose[:3, 3]
        behind_xyz = np.array([0, 0, -3]) @ pose[:3, :3].T + pose[:3, 3]
        colors = np.zeros((2, 3), dtype="f4")
        colors[0, i % 3] = 1
        params = initialize(
            np.array([world_xyz, behind_xyz], dtype="f4"), colors, "mps", 2, fixed_scale=0.02
        )
        with torch.no_grad():
            params["opacities"].fill_(torch.logit(torch.tensor(0.8)).item())
            rgb = render(params, view, "3dgs", torch.zeros(3, device="mps"))[0]
        rendered_y, rendered_x = np.unravel_index(int(rgb[..., i % 3].argmax()), (32, 32))
        pixel_h = camera_xyz @ np.array(view["K"]).T
        expected = pixel_h[:2] / pixel_h[2]
        assert np.max(np.abs(np.array([rendered_x, rendered_y]) - expected)) <= 1


def test_train_rejects_nonfinite_gradient_before_optimizer(tmp_path, monkeypatch):
    import train_bg

    data = write_dataset(tmp_path / "data")
    original = train_bg.initialize

    def broken_gradient(*args, **kwargs):
        params = original(*args, **kwargs)
        params["means"].register_hook(lambda gradient: torch.full_like(gradient, float("nan")))
        return params

    monkeypatch.setattr(train_bg, "initialize", broken_gradient)
    with pytest.raises(RuntimeError, match="Nonfinite or missing means gradient"):
        train(data, tmp_path / "bg", iters=1)
    assert not (tmp_path / "bg" / "metrics.json").exists()


def test_checkpoint_saves_model_and_test_previews(tmp_path):
    root = write_dataset(tmp_path / "data")
    out = tmp_path / "bg"
    metrics = train(root, out, iters=2, max_gaussians=20, checkpoint_every=1)
    checkpoint = out / "checkpoints" / "step_000001"
    model = torch.load(checkpoint / "model.pt", weights_only=True)
    assert model["iters"] == 1
    assert all(torch.isfinite(p).all() for p in model["params"].values())
    saved = json.loads((checkpoint / "metrics.json").read_text())
    assert saved["iters"] == 1
    assert len(PlyData.read(str(checkpoint / "point_cloud.ply"))["vertex"]) == saved["gaussians"]
    assert len(list((checkpoint / "renders").glob("test_*.jpg"))) == 2
    assert metrics["checkpoint_every"] == 1
