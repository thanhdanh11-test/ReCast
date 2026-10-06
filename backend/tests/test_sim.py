import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from topeye.core.geometry import project
from topeye.core.types import Box3D, CameraCalib, FrameInfo, GTBox3D
from topeye.sim import cli, static_map
from topeye.sim import layout as sim_layout
from topeye.sim.camera import CV_TO_BLENDER, blender_camera, intrinsics_from_blender
from topeye.sim.labels import camera_calib, write_labels, yolo_lines

K = np.array([[800.0, 0, 610.0], [0, 800.0, 395.0], [0, 0, 1]])


def rot_z(angle, translation=(0, 0, 0)):
    c, s = np.cos(angle), np.sin(angle)
    T = np.eye(4)
    T[:3, :3] = [[c, -s, 0], [s, c, 0], [0, 0, 1]]
    T[:3, 3] = translation
    return T


def forward_camera(position, yaw=0.0):
    """World <- OpenCV camera looking along world +x rotated by yaw, image y down."""
    T = np.eye(4)
    T[:3, :3] = rot_z(yaw)[:3, :3] @ np.array([[0, 0, 1], [-1, 0, 0], [0, -1, 0]])
    T[:3, 3] = position
    return T


# ---------------------------------------------------------------- camera

def test_camera_round_trip_off_centre():
    params = blender_camera(K, 1200, 800, np.eye(4))
    np.testing.assert_allclose(intrinsics_from_blender(params), K, atol=1e-9)
    assert params["lens"] == pytest.approx(800 * 36 / 1200)


def test_camera_axes_follow_blender_convention():
    T = forward_camera((1, 2, 3))
    matrix = np.asarray(blender_camera(K, 1200, 800, T)["matrix_world"])
    np.testing.assert_allclose(matrix, T @ CV_TO_BLENDER)
    # Blender looks along local -Z: must be the OpenCV optical axis (world +x here).
    np.testing.assert_allclose(matrix[:3, :3] @ [0, 0, -1], [1, 0, 0], atol=1e-12)
    # OpenCV image-down (+y) is Blender -Y: world -z here.
    np.testing.assert_allclose(matrix[:3, :3] @ [0, -1, 0], [0, 0, -1], atol=1e-12)


@pytest.mark.parametrize("bad", ["aspect", "skew"])
def test_camera_rejects_non_square_or_skew(bad):
    K_bad = K.copy()
    if bad == "aspect":
        K_bad[1, 1] *= 1.01
    else:
        K_bad[0, 1] = 1.0
    with pytest.raises(ValueError):
        blender_camera(K_bad, 1200, 800, np.eye(4))


# ---------------------------------------------------------------- layout

@pytest.fixture
def scene(tmp_path):
    T_world_lidar = rot_z(np.pi / 2, (10.0, 5.0, 0.0))
    T_world_cam = T_world_lidar @ forward_camera((0, 0, 0))
    image = tmp_path / "cam.png"
    cv2.imwrite(str(image), np.full((800, 1200, 3), [30, 60, 90], np.uint8))
    calib = CameraCalib("CAM_FRONT", K, np.linalg.inv(T_world_cam) @ T_world_lidar, 1200, 800)
    frame = FrameInfo("s_000000", "s", 0, tmp_path / "unused.bin", 1000, T_world_lidar,
                      {"CAM_FRONT": (image, 1000, calib, T_world_cam)})
    x, y = np.meshgrid(np.arange(-20, 20, 0.25), np.arange(-20, 20, 0.25))
    ground = np.column_stack((x.ravel(), y.ravel(), np.full(x.size, -1.8),
                              np.where(np.abs(y.ravel() - 5.1) < 0.15, 100.0, 10.0)))
    rng = np.random.default_rng(0)
    box = GTBox3D(8.0, 0.0, -1.0, 4.0, 2.0, 1.6, 0.3, "car", "ann", "track-car")
    inside = np.column_stack((rng.uniform(6.5, 9.5, 100), rng.uniform(-0.8, 0.8, 100),
                              rng.uniform(-1.6, -0.3, 100), np.ones(100)))
    wy, wz = np.meshgrid(np.arange(-5, 5, 0.1), np.arange(-1.5, 3, 0.1))
    wall = np.column_stack((np.full(wy.size, 15.0), wy.ravel(), wz.ravel(), np.ones(wy.size)))
    points = np.vstack((ground, inside, wall)).astype(np.float32)
    sweeps = [frame] + [replace(frame, frame_id=f"s_sweep_{i}") for i in range(2)]
    adapter = SimpleNamespace(
        frames=lambda _: [frame], sweep_frames=lambda _: sweeps,
        load_points=lambda _: points, gt_boxes=lambda _: [box], mask_boxes=lambda _: [box],
        scene_origin=lambda _: np.array([100.0, 200.0, 0.0]), scene_map=lambda _: None,
        root=tmp_path, scenes=lambda: ["s"])
    monkey = pytest.MonkeyPatch()
    is_ground = lambda p: np.abs(p[:, 2] + 1.8) < 0.05
    monkey.setattr(sim_layout, "ground_mask", is_ground)
    monkey.setattr(static_map, "ground_mask", is_ground)
    monkey.setattr(static_map, "BEVScene", lambda *_: SimpleNamespace(
        gains={}, camera=SimpleNamespace(cache_clear=lambda: None)))
    yield adapter, frame, box, tmp_path / "out"
    monkey.undo()


def read_ply(path):
    vertices, faces, _ = sim_layout.read_ply(path)
    return vertices, len(faces)


def test_ply_binary_round_trip(tmp_path):
    vertices = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0.5]])
    faces = np.array([[0, 1, 2, 3]])
    colors = np.array([[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 8, 7]])
    sim_layout.write_ply(tmp_path / "a.ply", vertices, faces, colors)
    v, f, c = sim_layout.read_ply(tmp_path / "a.ply")
    np.testing.assert_allclose(v, vertices)
    np.testing.assert_array_equal(f, faces)
    np.testing.assert_array_equal(c, colors)
    assert (tmp_path / "a.ply").read_bytes().startswith(b"ply\nformat binary_little_endian")


def test_layout_removes_dynamic_points_and_keeps_static(scene):
    adapter, frame, box, out = scene
    layout = sim_layout.build_layout(adapter, "s", out)
    vertices, faces = read_ply(out / "static.ply")
    assert faces > 0
    local = (vertices - frame.T_world_lidar[:3, 3]) @ frame.T_world_lidar[:3, :3]
    in_box = (np.abs(local[:, 0] - box.cx) < box.l / 2 - 0.3) & (np.abs(local[:, 1]) < 0.7)
    assert not in_box.any()
    assert (np.abs(local[:, 0] - 15.0) <= 0.5).any()  # wall survives
    assert json.loads((out / "layout.json").read_text())["version"] == 1
    assert layout["checks"]["ego_on_drivable"] == 1.0


def test_layout_actor_in_world(scene):
    adapter, _, _, out = scene
    actor = sim_layout.build_layout(adapter, "s", out)["actors"][0]
    key = actor["keys"][0]
    np.testing.assert_allclose(key["center"], [10.0, 5.0 + 8.0, -1.0], atol=1e-9)
    assert key["yaw"] == pytest.approx(0.3 + np.pi / 2)
    assert actor["size"] == [4.0, 2.0, 1.6] and actor["label"] == "car"


def test_layout_selftest_uses_reference_projection(scene):
    adapter, frame, _, out = scene
    test = sim_layout.build_layout(adapter, "s", out)["selftest"]
    world_cam = frame.cameras["CAM_FRONT"][3]
    uv, _ = project(np.asarray(test["points"]), K, np.linalg.inv(world_cam))
    np.testing.assert_allclose(uv, test["uv"])
    assert len(test["points"]) == 50


def test_heightfield_mesh_skips_nan_cells():
    grid = np.full((4, 4), np.nan)
    grid[:2, :2] = 1.0
    grid[3, 3] = 2.0
    vertices, quads = sim_layout.heightfield_mesh(grid, (0, 0, 2, 2), 0.5)
    assert len(vertices) == 5 and quads.tolist() == [[0, 1, 3, 2]]
    np.testing.assert_allclose(vertices[0], [0.25, 0.25, 1.0])


def test_paint_raster_marks_stripe_on_drivable_only():
    x, y = np.meshgrid(np.arange(0, 10, 0.05), np.arange(0, 10, 0.05))
    intensity = np.where(np.abs(y.ravel() - 5.0) < 0.1, 100.0, 10.0)
    points = np.column_stack((x.ravel(), y.ravel(), np.zeros(x.size), intensity))
    bounds = (0, 0, 10, 10)
    paint = sim_layout.paint_raster(points, bounds)
    row = int((10 - 5.0) / 0.1)
    assert paint[row, 50] > 200 and paint[20, 50] == 0
    drivable = np.zeros_like(paint)
    assert not sim_layout.paint_raster(points, bounds, drivable).any()


def test_drivable_raster_axes_and_flip(tmp_path):
    # Map 100 m x 100 m at 0.1 m/px; road band 60 <= global y < 80 (flipped: 20..40).
    rows = np.arange(1000)
    road = ((1000 - rows) * 0.1 >= 60) & ((1000 - rows) * 0.1 < 80)
    image = np.where(road[:, None], 255, 0).astype(np.uint8).repeat(1000, axis=1)
    good, flipped = tmp_path / "map.png", tmp_path / "flipped.png"
    cv2.imwrite(str(good), image)
    cv2.imwrite(str(flipped), image[::-1])
    origin, bounds = np.array([20.0, 30.0, 0.0]), (0.0, 0.0, 40.0, 50.0)
    ego = np.column_stack((np.linspace(5, 35, 30), np.full(30, 40.0)))  # global y = 70
    for path, expected in ((good, 1.0), (flipped, 0.0)):
        raster = sim_layout.drivable_raster(path, origin, bounds)
        assert np.mean(sim_layout.sample_raster(raster, bounds, ego) > 0) == expected


def test_layout_cli_fails_when_ego_off_drivable(monkeypatch, tmp_path):
    adapter = SimpleNamespace(scenes=lambda: ["s"])
    monkeypatch.setattr(cli, "load_config", lambda _: SimpleNamespace(nusc_root=tmp_path))
    monkeypatch.setattr(cli, "NuScenesAdapter", lambda _: adapter)
    monkeypatch.setattr(cli, "sim_root", lambda _: tmp_path)
    monkeypatch.setattr(cli, "build_layout", lambda *a: {
        "frames": [], "actors": [], "checks": {"ego_on_drivable": 0.5, "skipped_sweeps": 0}})
    assert cli.layout_main(["--scene", "s"]) == 1
    assert cli.layout_main(["--scene", "other"]) == 2


# ---------------------------------------------------------------- labels

def front_calib():
    return CameraCalib("CAM_FRONT", K, np.linalg.inv(forward_camera((0, 0, 0))), 1200, 800)


def corners(box):
    signs = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)])
    local = signs * np.array([box.l, box.w, box.h]) / 2
    c, s = np.cos(box.yaw), np.sin(box.yaw)
    return local @ np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]]) + [box.cx, box.cy, box.cz]


def parse(line):
    cls, cx, cy, w, h = line.split()
    return int(cls), float(cx) * 1200, float(cy) * 800, float(w) * 1200, float(h) * 800


def test_yolo_bbox_matches_projected_corners():
    box = Box3D(15.0, 1.0, 0.0, 4.0, 2.0, 1.5, 0.4, "truck")
    calib = front_calib()
    lines, dropped = yolo_lines([("t", box)], calib, {"t": {"visible": 20, "samples": 27}})
    assert dropped == 0 and len(lines) == 1
    cls, cx, cy, w, h = parse(lines[0])
    uv, _ = project(corners(box), K, calib.T_lidar_cam)
    assert cls == 1
    assert cx - w / 2 == pytest.approx(uv[:, 0].min(), abs=1.0)
    assert cx + w / 2 == pytest.approx(uv[:, 0].max(), abs=1.5)
    assert cy - h / 2 == pytest.approx(uv[:, 1].min(), abs=1.0)
    assert cy + h / 2 == pytest.approx(uv[:, 1].max(), abs=1.5)


def test_yolo_near_plane_and_behind():
    calib = front_calib()
    seen = {"a": {"visible": 27, "samples": 27}, "b": {"visible": 27, "samples": 27}}
    crossing = Box3D(1.0, 0.0, 0.0, 6.0, 2.0, 1.5, 0.0, "car")
    behind = Box3D(-10.0, 0.0, 0.0, 4.0, 2.0, 1.5, 0.0, "car")
    lines, _ = yolo_lines([("a", crossing), ("b", behind)], calib, seen)
    assert len(lines) == 1
    _, cx, _, w, _ = parse(lines[0])
    assert 0 <= cx - w / 2 and cx + w / 2 <= 1200 and w > 4


def test_yolo_filters_visibility_and_tiny_boxes():
    calib = front_calib()
    near = Box3D(15.0, 0.0, 0.0, 4.0, 2.0, 1.5, 0.0, "car")
    tiny = Box3D(300.0, 0.0, 0.0, 0.3, 0.3, 0.3, 0.0, "traffic_cone")
    lines, dropped = yolo_lines(
        [("hidden", near), ("tiny", tiny)], calib,
        {"hidden": {"visible": 1, "samples": 20}, "tiny": {"visible": 27, "samples": 27}})
    assert lines == [] and dropped == 2


def test_write_labels_round_trip(tmp_path):
    T_world_lidar = rot_z(np.pi / 2, (10.0, 5.0, 0.0))
    camera = {"width": 1200, "height": 800, "K": K.tolist(),
              "T_world_cam": (T_world_lidar @ forward_camera((0, 0, 0))).tolist()}
    layout = {"frames": [{"index": 0, "T_world_lidar": T_world_lidar.tolist(),
                          "cameras": {"CAM_FRONT": camera}}],
              "actors": [{"track": "t", "label": "car", "size": [4.0, 2.0, 1.5],
                          "keys": [{"frame": 0, "center": [10.0, 20.0, 0.0], "yaw": 1.8}]}]}
    scene_dir, run_dir = tmp_path, tmp_path / "runs" / "day"
    (scene_dir / "layout.json").write_text(json.dumps(layout))
    (run_dir / "visibility").mkdir(parents=True)
    (run_dir / "visibility" / "000000.json").write_text(
        json.dumps({"CAM_FRONT": {"t": {"visible": 27, "samples": 27}}}))
    summary = write_labels(scene_dir, run_dir)
    assert summary["boxes_2d"] == 1 and summary["missing_visibility"] == []
    box = json.loads((run_dir / "labels3d" / "000000.json").read_text())["boxes"][0]
    assert (box["cx"], box["cy"]) == pytest.approx((15.0, 0.0))
    assert box["yaw"] == pytest.approx(1.8 - np.pi / 2)
    assert (run_dir / "labels" / "yolo" / "CAM_FRONT" / "000000.txt").read_text().startswith("0 ")
    calib = camera_calib("CAM_FRONT", camera, T_world_lidar, 0.5)
    assert (calib.width, calib.height, calib.K[0, 0]) == (600, 400, 400.0)
    (run_dir / "visibility" / "000000.json").write_text(
        json.dumps({"CAM_FRONT": {"ghost": {"visible": 1, "samples": 1}}}))
    with pytest.raises(ValueError):
        write_labels(scene_dir, run_dir)


# ---------------------------------------------------------------- render CLI

def test_render_cli_rejects_bad_scenario_before_blender(monkeypatch, tmp_path):
    (tmp_path / "s").mkdir()
    (tmp_path / "s" / "layout.json").write_text("{}")
    bad = tmp_path / "bad.toml"
    bad.write_text('name = "x"\n[weather]\npreset = "day"\nsnow = 1\n')
    monkeypatch.setattr(cli, "sim_root", lambda _: tmp_path)
    monkeypatch.setattr(cli, "run_blender", lambda *a: pytest.fail("Blender must not start"))
    assert cli.render_main(["--scene", "s", "--scenario", str(bad)]) == 2
    assert cli.render_main(["--scene", "../etc", "--selftest"]) == 2
    assert cli.render_main(["--scene", "missing", "--selftest"]) == 2


def test_render_cli_blender_missing(monkeypatch, tmp_path):
    (tmp_path / "s").mkdir()
    (tmp_path / "s" / "layout.json").write_text("{}")
    monkeypatch.setattr(cli, "sim_root", lambda _: tmp_path)
    monkeypatch.setenv("TOPEYE_BLENDER", str(tmp_path / "no-blender"))
    assert cli.render_main(["--scene", "s", "--selftest"]) == 3


@pytest.mark.parametrize("preset", ["day", "night", "rain", "fog"])
def test_shipped_scenarios_pass_structural_check(preset):
    path = Path(cli.__file__).parent / "blender" / "scenarios" / f"{preset}.toml"
    assert cli.check_scenario(path)["weather"]["preset"] == preset


# ---------------------------------------------------------------- web viewer

def test_viewer_server_serves_page_and_sim_files_only(tmp_path):
    import threading
    import urllib.error
    import urllib.request

    from topeye.sim.view import make_server

    (tmp_path / "sim" / "s").mkdir(parents=True)
    (tmp_path / "sim" / "s" / "layout.json").write_text('{"version": 1}')
    (tmp_path / "secret.toml").write_text("token")
    server = make_server(tmp_path / "sim", port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        page = urllib.request.urlopen(f"{base}/?scene=s").read().decode()
        assert "three.module.js" in page and "PLYLoader" in page
        assert json.loads(urllib.request.urlopen(f"{base}/s/layout.json").read()) == {"version": 1}
        for path in ("/../secret.toml", "/%2e%2e/secret.toml", "/s/"):
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + path)
            assert error.value.code == 404
    finally:
        server.shutdown()
        server.server_close()
