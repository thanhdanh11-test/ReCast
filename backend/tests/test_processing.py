import os
import subprocess
import sys
from dataclasses import replace
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from topeye.api.main import create_app
from topeye.core.adapters.base import DatasetError
from topeye.core.cache import BEV_GRID, CACHE_VERSION, prepare_scene, read_meta, write_json
from topeye.core.calib_check import calib_report, render_overlay
from topeye.core.colorize import colorize
from topeye.core.types import CameraCalib, FrameInfo, GTBox3D
from topeye.prepare import main


@pytest.fixture
def sample(tmp_path):
    image = tmp_path / "camera.jpg"
    cv2.imwrite(str(image), np.full((32, 32, 3), [10, 20, 200], np.uint8))
    calib = CameraCalib(
        "CAM_FRONT", np.array([[10.0, 0, 16], [0, 10, 16], [0, 0, 1]]), np.eye(4), 32, 32
    )
    frame = FrameInfo(
        "scene-test_000000",
        "scene-test",
        0,
        tmp_path / "lidar.bin",
        1000000,
        np.eye(4),
        {"CAM_FRONT": (image, 1050000, calib, np.eye(4))},
    )
    points = np.array([[0, 0, 5, 1], [0, 0, 10, 1]], dtype=np.float32)
    adapter = SimpleNamespace(
        scenes=lambda: ["scene-test"],
        frames=lambda _: [frame],
        load_points=lambda _: points,
        gt_boxes=lambda _: [],
    )
    config = SimpleNamespace(calib_ok_ms=50, calib_warn_ms=100)
    return adapter, frame, config


def test_zbuffer_two_planes_and_rgb(sample):
    _, frame, _ = sample
    xy = np.array([(x, y) for x in range(-2, 3) for y in range(-2, 3)])
    front = np.column_stack([xy, np.full(25, 5), np.ones(25)])
    back = np.column_stack([xy * 2, np.full(25, 10), np.ones(25)])
    image = np.full((32, 32, 3), [10, 20, 200], np.uint8)
    result = colorize(np.vstack([front, back]), frame, {"CAM_FRONT": image})
    assert result.dtype == np.float32
    np.testing.assert_array_equal(result[:25, 4:], np.tile([200, 20, 10], (25, 1)))
    assert np.all(result[25:, 4:] == -1)


def test_near_plane_and_empty(sample):
    _, frame, _ = sample
    image = np.zeros((32, 32, 3), np.uint8)
    points = np.array([[0, 0, 0.5, 1], [0, 0, -1, 1], [100, 0, 1, 1]])
    assert np.all(colorize(points, frame, {"CAM_FRONT": image})[:, 4:] == -1)
    assert colorize(np.empty((0, 4)), frame, {}).shape == (0, 7)


def test_choose_optical_axis(sample):
    _, frame, _ = sample
    path, ts, calib, pose = frame.cameras["CAM_FRONT"]
    transform = np.eye(4)
    transform[0, 3] = 1
    other = replace(calib, name="CAM_OTHER", T_lidar_cam=transform)
    frame = replace(frame, cameras={"CAM_OTHER": (path, ts, other, pose), **frame.cameras})
    result = colorize(
        np.array([[0, 0, 5, 1]]),
        frame,
        {
            "CAM_OTHER": np.full((32, 32, 3), 50, np.uint8),
            "CAM_FRONT": np.full((32, 32, 3), 100, np.uint8),
        },
    )
    assert np.all(result[:, 4:] == 100)


@pytest.mark.parametrize("delta, verdict", [(50000, "ok"), (100000, "warn"), (100001, "fail")])
def test_sync_thresholds(sample, delta, verdict):
    adapter, frame, config = sample
    path, _, calib, pose = frame.cameras["CAM_FRONT"]
    frame = replace(frame, cameras={"CAM_FRONT": (path, 1000000 + delta, calib, pose)})
    adapter.frames = lambda _: [frame]
    report = calib_report(adapter, frame.scene, config)
    assert report["verdict"] == verdict
    assert report["cameras"]["CAM_FRONT"]["dt_ms_max"] == delta / 1000
    config.calib_ok_ms = 200
    assert calib_report(adapter, frame.scene, config)["verdict"] == "ok"


def test_overlay(sample):
    adapter, frame, _ = sample
    assert render_overlay(frame, adapter.load_points(frame), "CAM_FRONT").shape == (32, 32, 3)


def test_cache_idempotent_and_failure_retry(sample, tmp_path):
    adapter, frame, config = sample
    root = tmp_path / "cache"
    load = adapter.load_points
    adapter.load_points = lambda _: (_ for _ in ()).throw(DatasetError("lidar missing"))
    failed = prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )
    assert failed["failures"][0]["frame_id"] == frame.frame_id
    adapter.load_points = load
    meta = prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )
    assert meta["bev"] == BEV_GRID and not meta["failures"]
    path = root / frame.scene / "frames" / frame.frame_id / "points.bin"
    stamp = path.stat().st_mtime_ns
    prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )
    assert path.stat().st_mtime_ns == stamp
    assert not list(root.rglob("bev.png"))
    assert not list(root.rglob("*.tmp"))


def test_killed_cache_has_no_meta_and_can_retry(sample, tmp_path):
    root = tmp_path / "cache"
    code = """
import os, signal
from pathlib import Path
from types import SimpleNamespace
from topeye.core.cache import prepare_scene
frame = SimpleNamespace(frame_id="scene-test_000000", cameras={})
def load(frame):
    os.kill(os.getpid(), signal.SIGKILL)
adapter = SimpleNamespace(frames=lambda _: [frame], load_points=load)
prepare_scene(adapter, "scene-test", Path(os.environ["TEST_CACHE"]), None, 1, no_bev=True, no_atlas=True, no_pano=True)
"""
    process = subprocess.run(
        [sys.executable, "-c", code], check=False, env={**os.environ, "TEST_CACHE": str(root)}
    )
    assert process.returncode == -9
    assert not (root / "scene-test" / "meta.json").exists()
    adapter, frame, config = sample
    assert not prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )["failures"]
    assert read_meta(root / frame.scene)


def test_cli_codes(sample, tmp_path, monkeypatch):
    adapter, frame, config = sample
    config.cache_root = tmp_path / "cache"
    config.nusc_root = tmp_path
    monkeypatch.setattr("topeye.prepare.load_config", lambda _: config)
    monkeypatch.setattr("topeye.prepare.NuScenesAdapter", lambda _: adapter)
    assert main(
        ["--scene", frame.scene, "--workers", "1", "--no-bev", "--no-atlas", "--no-pano"]
    ) == 0
    assert main(["--scene", "../escape"]) == 2
    assert main(["--all", "--workers", "0"]) == 2
    adapter.load_points = lambda _: (_ for _ in ()).throw(DatasetError("lidar missing"))
    assert main(
        [
            "--all", "--cache-root", str(tmp_path / "failed"), "--no-bev", "--no-atlas",
            "--no-pano",
        ]
    ) == 1
    result = subprocess.run(
        [sys.executable, "-m", "topeye.prepare", "--all"],
        check=False,
        env={**os.environ, "TOPEYE_NUSC_ROOT": str(tmp_path / "missing")},
    )
    assert result.returncode == 2


def test_api_contract_and_traversal(sample, tmp_path):
    adapter, frame, config = sample
    root = tmp_path / "cache"
    client = TestClient(create_app(adapter, root))
    prefix = f"/api/scenes/{frame.scene}"
    base = f"{prefix}/frames/{frame.frame_id}"
    assert client.get("/api/scenes").json()[0]["cached"] is False
    assert client.get(prefix + "/meta").status_code == 425
    assert client.get(base + "/points").status_code == 425
    prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )
    assert client.get("/api/scenes").json() == [
        {"scene": frame.scene, "n_frames": 1, "cached": True}
    ]
    assert client.get(prefix + "/meta").json()["calib_report"]["verdict"] == "ok"
    response = client.get(base + "/points")
    assert response.status_code == 200 and len(response.content) == 2 * 7 * 4
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["cache-control"] == "max-age=3600"
    assert response.headers["etag"].startswith(f'"{CACHE_VERSION}-')
    assert client.get(base + "/bev.png").status_code == 404
    assert client.get(base + "/cams/CAM_FRONT.jpg").status_code == 200
    assert client.get(base + "/calib").json()["CAM_FRONT"]["width"] == 32
    assert client.get(base + "/boxes?source=gt").json() == []
    assert client.get(base + "/boxes?source=db").status_code == 404
    for path in [
        "/api/scenes/..%2F/meta",
        "/api/scenes/../meta",
        prefix + "/frames/../points",
        base + "/cams/..%2Fsecret.jpg",
        base + "/cams/..jpg",
        base + "/cams/NOPE.jpg",
        prefix + "/frames/unknown/points",
        "/api/scenes/unknown/meta",
    ]:
        assert client.get(path).status_code == 404, path
    points = root / frame.scene / "frames" / frame.frame_id / "points.bin"
    points.unlink()
    points.symlink_to(tmp_path / "camera.jpg")
    assert client.get(base + "/points").status_code == 404


def test_old_cache_rebuilt_with_gt_identity(sample, tmp_path):
    adapter, frame, config = sample
    root = tmp_path / "cache"
    prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )
    directory = root / frame.scene
    meta = read_meta(directory)
    meta["cache_version"] = 1
    write_json(directory / "meta.json", meta)
    client = TestClient(create_app(adapter, root))
    url = f"/api/scenes/{frame.scene}/frames/{frame.frame_id}/boxes?source=gt"
    assert read_meta(directory) is None
    assert client.get(url).status_code == 425
    adapter.gt_boxes = lambda _: [GTBox3D(0, 0, 0, 4, 2, 1, 0, "car", "ann", "instance")]
    rebuilt = prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )
    assert rebuilt["cache_version"] == CACHE_VERSION
    assert rebuilt["failures"] == []
    assert client.get(url).json()[0]["id"] == "gt:ann"


def test_atlas_endpoints_cache_recovery_and_disable(sample, tmp_path, monkeypatch):
    monkeypatch.setattr("topeye.core.ground.pypatchworkpp", None)
    adapter, frame, config = sample
    root = tmp_path / "cache"
    client = TestClient(create_app(adapter, root))
    base = f"/api/scenes/{frame.scene}/frames/{frame.frame_id}"
    prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )
    for suffix in ("png", "json"):
        assert client.get(base + f"/box_atlas.{suffix}").status_code == 404
    meta = prepare_scene(adapter, frame.scene, root, config, no_bev=True, no_pano=True)
    assert not meta["failures"] and meta["cache_version"] == CACHE_VERSION
    assert client.get(base + "/box_atlas.png").status_code == 200
    data = client.get(base + "/box_atlas.json").json()
    assert data["boxes"] == {} and np.isfinite(data["ground_z"])
    target = root / frame.scene / "frames" / frame.frame_id
    atlas = target / "box_atlas.png"
    timestamp = atlas.stat().st_mtime_ns
    prepare_scene(adapter, frame.scene, root, config, no_bev=True, no_pano=True)
    assert atlas.stat().st_mtime_ns == timestamp
    (target / "box_atlas.json").unlink()
    prepare_scene(adapter, frame.scene, root, config, no_bev=True, no_pano=True)
    assert client.get(base + "/box_atlas.json").status_code == 200
    for suffix in ("png", "json"):
        path = target / f"box_atlas.{suffix}"
        path.unlink()
        path.symlink_to(tmp_path / "camera.jpg")
        assert client.get(base + f"/box_atlas.{suffix}").status_code == 404
        assert client.get(base.replace(frame.frame_id, "..%2Fescape")
                          + f"/box_atlas.{suffix}").status_code == 404
    prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )
    assert not atlas.exists()
    assert client.get(base + "/box_atlas.json").status_code == 404


def test_dense_api_recovery_disable_and_symlink(sample, tmp_path):
    adapter, frame, config = sample
    root = tmp_path / 'cache'
    client = TestClient(create_app(adapter, root))
    base = f'/api/scenes/{frame.scene}/frames/{frame.frame_id}'
    adapter.gt_boxes = lambda _: [GTBox3D(0, 0, 5, 2, 2, 2, 0, 'car', 'a', 'track')]
    assert not prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )['failures']
    binary = client.get(base + '/objects_dense.bin')
    meta = client.get(base + '/objects_dense.json')
    assert binary.status_code == meta.status_code == 200
    assert len(binary.content) % 28 == 0
    assert sum(o['count'] for o in meta.json()['objects']) == len(binary.content) // 28 == 1
    target = root / frame.scene / 'frames' / frame.frame_id
    (target / 'objects_dense.bin').unlink()
    assert client.get(base + '/objects_dense.bin').status_code == 404
    prepare_scene(
        adapter, frame.scene, root, config, no_bev=True, no_atlas=True, no_pano=True
    )
    assert client.get(base + '/objects_dense.bin').status_code == 200
    for suffix in ('bin', 'json'):
        path = target / f'objects_dense.{suffix}'
        path.unlink()
        path.symlink_to(tmp_path / 'camera.jpg')
        assert client.get(base + f'/objects_dense.{suffix}').status_code == 404
        assert client.get(base.replace(frame.frame_id, '..%2Fescape')
                          + f'/objects_dense.{suffix}').status_code == 404
    prepare_scene(
        adapter,
        frame.scene,
        root,
        config,
        no_bev=True,
        no_atlas=True,
        no_dense=True,
        no_pano=True,
    )
    for suffix in ('bin', 'json'):
        assert client.get(base + f'/objects_dense.{suffix}').status_code == 404
    config.nusc_root = tmp_path
    config.cache_root = root
