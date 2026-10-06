import json
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from topeye.api.main import create_app
from topeye.core.cache import CACHE_VERSION, prepare_scene
from topeye.core.panorama import (
    build_depth_panorama,
    camera_center,
    panorama_directions,
    render_color_panorama,
    smooth_upper_depth,
)
from topeye.core.types import CameraCalib, FrameInfo


def front_camera(tmp_path, image=None):
    image = image if image is not None else np.full((32, 32, 3), [10, 20, 200], np.uint8)
    path = tmp_path / "front.png"
    cv2.imwrite(str(path), image)
    rotation = np.array([[1.0, 0, 0], [0, 0, -1], [0, 1, 0]])
    transform = np.eye(4)
    transform[:3, :3] = rotation
    calib = CameraCalib(
        "CAM_FRONT", np.array([[16.0, 0, 16], [0, 16, 16], [0, 0, 1]]), transform, 32, 32
    )
    return FrameInfo(
        "scene-test_000010",
        "scene-test",
        0,
        Path("unused"),
        0,
        np.eye(4),
        {"CAM_FRONT": (path, 0, calib, np.eye(4))},
    )


def test_panorama_coordinate_contract():
    directions = panorama_directions(1024, 512)
    assert directions[256, 512, 1] > 0.999
    assert directions[256, 768, 0] > 0.999
    assert abs(directions[256, 512, 2]) < 0.01


def test_depth_plane_and_ground_fill():
    center = np.zeros(3)
    points = np.array([[0, 10, 0], [0, 20, 0]], np.float32)
    grid = np.zeros((240, 240), np.float32)
    depth = build_depth_panorama(points, center, grid, width=1024, height=512)
    assert depth[256, 512] == pytest.approx(10, abs=0.1)

    center[2] = 1
    ground_only = build_depth_panorama(np.empty((0, 3)), center, grid, width=32, height=16)
    assert 1 < ground_only[12, 16] < 60
    assert ground_only[3, 16] == 60


def test_depth_smoothing_only_changes_upper_noise_and_preserves_real_edge():
    depth = np.full((32, 32), 10.0, np.float32)
    depth[:16, 16:] = 20.0
    depth[5, 5] = 30.0
    depth[16:] = np.arange(16, dtype=np.float32)[:, None] + 1

    smoothed = smooth_upper_depth(depth)

    np.testing.assert_array_equal(smoothed[16:], depth[16:])
    assert smoothed[5, 5] == pytest.approx(10.0, abs=0.1)
    assert smoothed[8, 15] < 12.0
    assert smoothed[8, 16] > 18.0
    assert smoothed[8, 16] - smoothed[8, 15] > 3.0


def test_color_uses_source_pixel_and_camera_center(tmp_path):
    image = np.zeros((32, 32, 3), np.uint8)
    image[16, 16] = [5, 70, 220]
    frame = front_camera(tmp_path, image)
    np.testing.assert_allclose(camera_center(frame), [0, 0, 0])
    depth = np.full((8, 16), 10, np.float32)
    color, alpha = render_color_panorama(
        depth, np.zeros(3), frame, {"CAM_FRONT": image}, {"CAM_FRONT": 1.0}, width=64, height=32
    )
    assert color[16, 32].tolist() == [5, 70, 220]
    assert alpha[4, 8] == 255
    assert alpha[4, 0] == 0


def test_cache_artifacts_endpoints_disable_and_recovery(tmp_path, monkeypatch):
    monkeypatch.setattr("topeye.core.ground.pypatchworkpp", None)
    frame = front_camera(tmp_path)
    x, y = np.meshgrid(np.arange(-3, 3, 0.5), np.arange(2, 12, 0.5))
    points = np.column_stack((x.ravel(), y.ravel(), np.zeros(x.size), np.ones(x.size)))
    adapter = SimpleNamespace(
        scenes=lambda: [frame.scene],
        frames=lambda _: [frame],
        load_points=lambda _: points,
        gt_boxes=lambda _: [],
    )
    config = SimpleNamespace(calib_ok_ms=50, calib_warn_ms=100)
    root = tmp_path / "cache"
    meta = prepare_scene(
        adapter,
        frame.scene,
        root,
        config,
        workers=1,
        no_bev=True,
        no_atlas=True,
        no_dense=True,
    )
    assert meta["cache_version"] == CACHE_VERSION == 10
    target = root / frame.scene / "frames" / frame.frame_id
    assert (target / "pano_depth.bin").stat().st_size == 2 * 1024 * 512
    assert cv2.imread(str(target / "pano_rgb.jpg")).shape[:2] == (2048, 4096)
    assert cv2.imread(str(target / "pano_alpha.png"), -1).shape == (512, 1024)
    assert json.loads((target / "pano.json").read_text())["center"] == [0.0, 0.0, 0.0]

    client = TestClient(create_app(adapter, root))
    base = f"/api/scenes/{frame.scene}/frames/{frame.frame_id}"
    for name in ("pano.json", "pano_rgb.jpg", "pano_alpha.png", "pano_depth.bin"):
        assert client.get(f"{base}/{name}").status_code == 200

    (target / "pano.json").unlink()
    assert client.get(f"{base}/pano.json").status_code == 404
    prepare_scene(
        adapter,
        frame.scene,
        root,
        config,
        workers=1,
        no_bev=True,
        no_atlas=True,
        no_dense=True,
    )
    assert (target / "pano.json").is_file()
    prepare_scene(
        adapter,
        frame.scene,
        root,
        config,
        workers=1,
        no_bev=True,
        no_atlas=True,
        no_dense=True,
        no_pano=True,
    )
    assert not list(target.glob("pano*"))
