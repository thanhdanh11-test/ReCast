import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from scripts.splat_evaluate import scores
from topeye.api.main import create_app
from topeye.core.cache import CACHE_VERSION
from topeye.core.geometry import project, transform_matrix
from topeye.core.types import CameraCalib, FrameInfo, GTBox3D
from topeye.export_splat import camera_record, dynamic_tracks, export_scene


@pytest.fixture
def scene(tmp_path):
    frames, boxes = [], {}
    cache = tmp_path / "cache"
    for i in range(8):
        world = np.eye(4)
        world[0, 3] = i
        image = tmp_path / f"image{i}.png"
        cv2.imwrite(str(image), np.full((64, 80, 3), 180, np.uint8))
        calib = CameraCalib("CAM_FRONT", np.array([[40., 0, 40], [0, 40, 32], [0, 0, 1]]),
                            np.eye(4), 80, 64)
        frame = FrameInfo(f"scene-test_{i:06d}", "scene-test", i, Path("lidar"), i * 100,
                          world, {"CAM_FRONT": (image, i * 100, calib, world)})
        frames.append(frame)
        boxes[frame.frame_id] = [
            GTBox3D(-i, 0, 10, 1, 1, 1, 0, "car", f"park{i}", "park"),
            GTBox3D(2 * i / 7 - i, 2, 10, 1, 1, 1, 0, "car", f"move{i}", "move"),
            GTBox3D(3 - i, 0, 10, 1, 1, 1, 0, "pedestrian", f"human{i}", "human"),
        ]
        folder = cache / frame.scene / "frames" / frame.frame_id
        folder.mkdir(parents=True)
        np.array([[-i, 0, 10, 1, 20, 30, 40], [2*i/7-i, 2, 10, 1, 200, 30, 40],
                  [3-i, 0, 10, 1, 200, 30, 40]], dtype="<f4").tofile(folder / "points.bin")
    (cache / "scene-test" / "meta.json").write_text(json.dumps({
        "cache_version": CACHE_VERSION, "frames": [f.frame_id for f in frames], "failures": []}))
    adapter = SimpleNamespace(scenes=lambda: ["scene-test"], frames=lambda _: frames,
                              mask_boxes=lambda f: boxes[f.frame_id])
    return adapter, frames, boxes, cache


def test_track_motion_is_world_space_and_nonrigid_always(scene):
    _, frames, boxes, _ = scene
    assert dynamic_tracks(frames, boxes) == {"move", "human"}
    # Strictly greater than one meter, not >=.
    boxes[frames[-1].frame_id][1].cx -= 1
    assert dynamic_tracks(frames, boxes) == {"human"}


def test_export_split_mask_static_init_and_projection(scene, tmp_path):
    adapter, frames, _, cache = scene
    out = tmp_path / "export"
    result = export_scene(adapter, "scene-test", cache, out)
    assert result["train_images"] == 7 and result["test_images"] == 1
    assert result["removed_dynamic_points"] == 16
    assert result["voxel_points"] == 1
    train = json.loads((out / "transforms.json").read_text())["frames"]
    test = json.loads((out / "transforms_test.json").read_text())["frames"]
    assert test[0]["frame_id"] == frames[7].frame_id
    assert not {r["file_path"] for r in train} & {r["file_path"] for r in test}
    first = train[0]
    mask = cv2.imread(str(out / first["mask_path"]), cv2.IMREAD_GRAYSCALE)
    assert mask[16, 20] == 255  # parked car retained
    assert mask[20, 20] == 0  # moving car
    assert mask[16, 26] == 0  # stationary person still masked
    assert set(np.unique(mask)) == {0, 255}
    assert mask.shape == (32, 40)
    points = np.array([[0., 0, 10], [2, 1, 7]])
    for record, frame in zip(train + test, frames, strict=True):
        world = points @ frame.T_world_lidar[:3, :3].T + frame.T_world_lidar[:3, 3]
        gl = np.linalg.inv(np.array(record["transform_matrix"]))
        camera = world @ gl[:3, :3].T + gl[:3, 3]
        uv = np.column_stack([record["fl_x"] * camera[:, 0] / -camera[:, 2] + record["cx"],
                              record["fl_y"] * -camera[:, 1] / -camera[:, 2] + record["cy"]])
        calib = frame.cameras["CAM_FRONT"][2]
        expected, _ = project(points, calib.K, calib.T_lidar_cam)
        assert np.max(np.linalg.norm(uv - expected * .5, axis=1)) < 1e-6
    with pytest.raises(ValueError, match="already exists"):
        export_scene(adapter, "scene-test", cache, out)


def test_projection_nontrivial_rotation_and_principal_point(scene):
    _, frames, _, _ = scene
    frame = frames[0]
    world_lidar = transform_matrix([15, 20, 3], [.9, .1, .2, .3])
    world_camera = transform_matrix([12, 21, 1], [.7, -.3, .2, .5])
    path, ts, calib, _ = frame.cameras["CAM_FRONT"]
    calib = replace(calib, T_lidar_cam=np.linalg.inv(world_camera) @ world_lidar,
                    K=np.array([[100., 0, 37.3], [0, 103., 29.7], [0, 0, 1]]))
    frame = replace(frame, T_world_lidar=world_lidar,
                    cameras={"CAM_FRONT": (path, ts, calib, world_camera)})
    record = camera_record(frame, "CAM_FRONT", 40, 32)
    cpoints = np.array([[1, 2, 10], [-3, 1, 15], [2, -1, 9]])
    world = cpoints @ world_camera[:3, :3].T + world_camera[:3, 3]
    lidar = (world - world_lidar[:3, 3]) @ world_lidar[:3, :3]
    expected, _ = project(lidar, calib.K, calib.T_lidar_cam)
    gl = np.linalg.inv(record["transform_matrix"])
    camera = world @ gl[:3, :3].T + gl[:3, 3]
    uv = np.column_stack([record["fl_x"] * camera[:, 0] / -camera[:, 2] + record["cx"],
                          record["fl_y"] * -camera[:, 1] / -camera[:, 2] + record["cy"]])
    assert np.max(np.linalg.norm(uv - expected * .5, axis=1)) < 1e-6


@pytest.mark.parametrize("scale", [0, -1, float("nan"), float("inf"), 2])
def test_invalid_scale(scene, tmp_path, scale):
    adapter, _, _, cache = scene
    with pytest.raises(ValueError, match="scale"):
        export_scene(adapter, "scene-test", cache, tmp_path / "export", scale)


def test_api_splat_pose_and_containment(scene, tmp_path):
    adapter, frames, _, cache = scene
    root = tmp_path / "splat"
    directory = root / "scene-test"
    directory.mkdir(parents=True)
    client = TestClient(create_app(adapter, cache, root))
    url = "/api/scenes/scene-test/splat.ply"
    assert client.get(url).status_code == 404
    (directory / "scene.ply").write_bytes(b"ply\n")
    assert client.get(url).status_code == 200
    assert client.get(url).content == b"ply\n"
    assert client.get("/api/scenes/unknown/splat.ply").status_code == 404
    pose = client.get(f"/api/scenes/scene-test/frames/{frames[3].frame_id}/pose")
    assert pose.status_code == 200
    np.testing.assert_array_equal(pose.json()["T_world_lidar"], frames[3].T_world_lidar)
    assert client.get("/api/scenes/scene-test/frames/unknown/pose").status_code == 404
    (directory / "scene.ply").unlink()
    outside = tmp_path / "private"
    outside.write_bytes(b"secret")
    (directory / "scene.ply").symlink_to(outside)
    assert client.get(url).status_code == 404
    assert client.get("/api/scenes/%2e%2e/splat.ply").status_code == 404


def test_metric_known_error_and_mask():
    reference = np.full((40, 40, 3), 100, np.uint8)
    rendered = np.full_like(reference, 110)
    assert scores(reference, reference)["ssim"] == pytest.approx(1)
    assert scores(reference, rendered)["psnr_db"] == pytest.approx(20*np.log10(255/10))
    expected_ssim = (2*(100/255)*(110/255)+.01**2) / ((100/255)**2+(110/255)**2+.01**2)
    assert scores(reference, rendered)["ssim"] == pytest.approx(expected_ssim)
    rendered[:10] = 0
    mask = np.full((40, 40), 255, np.uint8)
    mask[:10] = 0
    assert scores(reference, rendered, mask)["psnr_db"] == pytest.approx(20*np.log10(255/10))
    with pytest.raises(ValueError, match="Empty"):
        scores(reference, rendered, np.zeros_like(mask))


def test_export_rejects_cache_escape_and_incomplete_scene(scene, tmp_path):
    adapter, frames, _, cache = scene
    target = cache / "scene-test/frames" / frames[0].frame_id / "points.bin"
    target.unlink()
    outside = tmp_path / "outside.bin"
    np.zeros((1, 7), dtype="<f4").tofile(outside)
    target.symlink_to(outside)
    with pytest.raises(ValueError, match="path or size"):
        export_scene(adapter, "scene-test", cache, tmp_path / "export")
    assert not (tmp_path / "export").exists()
    assert not list(tmp_path.glob(".export-*"))
    with pytest.raises(ValueError, match="invalid scene"):
        export_scene(adapter, "../scene-test", cache, tmp_path / "export")
