"""Directional sky gradients and wall-clock stopping."""
import json

import numpy as np
import pytest
import torch
from test_train_bg import write_dataset
from train_bg import background_image, losses, sky_geometry, train


def test_sky_world_horizon_and_directional_gradient():
    # OpenCV forward world +y, image up world +z.
    rotation = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]])
    view = {"width": 4, "height": 4, "K": [[3, 0, 2], [0, 3, 2], [0, 0, 1]],
            "c2w": np.eye(4).tolist()}
    view["c2w"] = np.block([[rotation, np.zeros((3, 1))], [np.zeros((1, 3)), np.ones((1, 1))]]).tolist()
    sky, rows, cols = sky_geometry(4, 4, tuple(np.array(view["K"]).ravel()), tuple(rotation.ravel()))
    assert sky[:2].all() and not sky[2:].any()
    table = torch.ones(32, 64, 3, requires_grad=True)
    image = background_image(table, view)
    image[:2].sum().backward()
    assert table.grad[rows[0, 0], cols[0, 0]].sum() > 0
    assert table.grad.sum() == 24


def test_timed_training_stops_and_saves_last_finite_checkpoint(tmp_path):
    data = write_dataset(tmp_path / "data")
    metrics = train(data, tmp_path / "out", iters=100000, time_budget_s=2,
                    sky_model=True, max_gaussians=30)
    assert metrics["stop_reason"] == "time_budget"
    assert metrics["iters"] < 100000
    assert metrics["total_s"] < 20
    assert json.loads((tmp_path / "out/metrics.json").read_text())["sky_model"]
    model = torch.load(tmp_path / "out/model.pt", weights_only=False)
    assert model["background"].shape == (32, 64, 3)
    assert all(torch.isfinite(p).all() for p in model["params"].values())


@pytest.mark.parametrize("budget", [0, -1, float("nan"), float("inf")])
def test_time_budget_validation(tmp_path, budget):
    with pytest.raises(ValueError):
        train(tmp_path, tmp_path / "out", time_budget_s=budget)



def test_directional_sky_requires_background_training(tmp_path):
    with pytest.raises(ValueError):
        train(tmp_path, tmp_path / "out", sky_model=True, learn_background=False)



def test_sky_loss_supervises_composited_rgb_and_excludes_actors():
    pred = torch.full((16, 16, 3), 0.5, requires_grad=True)
    target = torch.zeros_like(pred)
    mask = torch.ones(16, 16, dtype=torch.bool)
    mask[:2] = False
    sky = torch.ones_like(mask)
    lidar = torch.zeros_like(mask, dtype=torch.float32)
    loss = losses(pred, target, mask, None, lidar, 1, sky_mask=sky)
    loss.backward()
    assert pred.grad[mask].abs().sum() > 0
    assert pred.grad[~mask].abs().sum() == 0
    assert torch.isfinite(pred.grad).all()
