"""Library selection, measured paint and truthful actor metadata (SPEC-S8)."""

import ast
import json
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from topeye.core.types import Box3D, CameraCalib
from topeye.sim.actor_color import actor_colors, median_paint_rgb, upper_body_mask
from topeye.sim.cli import BUILD_SCENE
from topeye.sim.labels import write_labels
from topeye.sim.traffic import generate_traffic


@pytest.fixture
def blender():
    tree = ast.parse(BUILD_SCENE.read_text())
    tree.body = [n for n in tree.body if not (
        isinstance(n, ast.Import) and any(a.name == "bpy" for a in n.names)
        or isinstance(n, ast.ImportFrom) and n.module.startswith(("bpy", "mathutils"))
        or isinstance(n, ast.If))]
    namespace = {"__name__": "library_test", "__file__": str(BUILD_SCENE)}
    exec(compile(tree, str(BUILD_SCENE), "exec"), namespace)  # noqa: S102 - trusted repository AST
    return SimpleNamespace(**namespace)


def asset(identifier, size, label="car"):
    return {"asset_id": identifier, "class": label, "native_size": size}


def test_closest_shape_with_exact_scale(blender):
    actor = {"track": "recorded", "label": "car", "size": [4, 2, 1.5]}
    manifest = [asset("wrong_class", actor["size"], "bus"),
                asset("wrong_shape", [4, 1, 3]), asset("near", [4, 2, 1.4]),
                asset("exact", [8, 4, 3])]
    chosen, scale = blender.select_library_asset(manifest, actor, 42)
    assert chosen["asset_id"] == "exact"
    np.testing.assert_allclose(scale * chosen["native_size"], actor["size"], rtol=0.01)
    assert scale.max() / scale.min() <= 1.3


def test_seeded_ties_independent_of_manifest_order(blender):
    actor = {"track": "one", "label": "car", "size": [4, 2, 1.5]}
    manifest = [asset(str(i), actor["size"]) for i in range(6)]
    choices = {blender.select_library_asset(manifest, {**actor, "track": str(i)}, 0)[0]["asset_id"]
               for i in range(100)}
    assert len(choices) == 6
    for seed in range(10):
        first, _ = blender.select_library_asset(manifest, actor, seed)
        second, _ = blender.select_library_asset(manifest[::-1], actor, seed)
        assert first == second


def test_distortion_cap_and_missing_class(blender):
    actor = {"track": "one", "label": "car", "size": [1.3, 1, 1]}
    assert blender.select_library_asset([asset("edge", [1, 1, 1])], actor, 0)[0]
    actor["size"][0] = 1.301
    assert blender.select_library_asset([asset("over", [1, 1, 1])], actor, 0) == (None, None)
    assert blender.select_library_asset([], actor, 0) == (None, None)


@pytest.mark.parametrize("size", [[0, 1, 1], [1, -1, 1], [1, 1], [1, 1, float("nan")]])
def test_invalid_native_size(blender, size):
    with pytest.raises(blender.InputError):
        blender.select_library_asset([asset("bad", size)],
                                     {"track": "one", "label": "car", "size": [4, 2, 1]}, 0)


@pytest.mark.parametrize("field,value", [("license", "unknown"), ("forward_axis", "+Y"),
                                         ("native_size", [1, 0, 1]), ("file", 1)])
def test_manifest_boundary(blender, tmp_path, field, value):
    source = tmp_path / "topeye/sim/blender/build_scene.py"
    blender.load_library_manifest.__globals__["__file__"] = str(source)
    assets = tmp_path / "assets"
    assets.mkdir()
    entry = {**asset("car", [4, 2, 1.5]), "license": "CC0", "forward_axis": "+X",
             "up_axis": "Z", "file": "library/car.blend", field: value}
    (assets / "library_manifest.json").write_text(json.dumps([entry]))
    with pytest.raises(blender.InputError):
        blender.load_library_manifest()


def test_asset_path_traversal_rejected_before_import(blender, tmp_path):
    outside = tmp_path / "secret.blend"
    outside.write_bytes(b"fixture")
    with pytest.raises(blender.InputError, match="outside library"):
        blender.import_library_actor({"file": "../secret.blend"}, [1, 1, 1],
                                      tmp_path / "assets", "actor", None, False)


def test_heading_audit_detects_reversed_placement(blender):
    key = {"frame": 0, "yaw": 0.7}
    actor = {"track": "vehicle", "label": "truck", "asset_id": "test_truck"}
    def obj(yaw):
        matrix = np.eye(4)
        matrix[:2, :2] = [[np.cos(yaw), -np.sin(yaw)], [np.sin(yaw), np.cos(yaw)]]
        return SimpleNamespace(matrix_world=matrix, hide_render=False)
    correct = blender.actor_heading_checks([(obj(0.7), actor, {0: key})], 0)
    assert abs(correct["vehicle"]["error_deg"]) < 1e-4
    wrong = blender.actor_heading_checks([(obj(0.7 + np.pi), actor, {0: key})], 0)
    assert abs(wrong["vehicle"]["error_deg"]) == pytest.approx(180)


def test_hsv_red_wrap_dark_and_clipped():
    hsv = np.array([[[179, 230, 180]], [[1, 230, 180]], [[90, 200, 0]],
                    [[90, 200, 255]]], np.uint8)
    rgb = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB).reshape(-1, 3)
    result = median_paint_rgb(rgb)
    assert result[0] >= 175 and max(result[1:]) < 25
    assert median_paint_rgb([[0, 0, 0], [255, 255, 255]]) is None
    assert median_paint_rgb([]) is None


def color_fixture(tmp_path):
    # Camera sees world +X forward, +Z upward.
    matrix = np.array([[0, -1, 0, 0], [0, 0, -1, 0], [1, 0, 0, 0], [0, 0, 0, 1]], float)
    calib = CameraCalib("CAM_FRONT", np.array([[120, 0, 100], [0, 120, 100], [0, 0, 1]]),
                        matrix, 200, 200)
    box = Box3D(10, 0, 0, 4, 2, 2, 0, "car")
    image = np.full((200, 200, 3), (30, 30, 30), np.uint8)
    image[upper_body_mask(box, calib) > 0] = [20, 20, 180]
    path = tmp_path / "car.png"
    cv2.imwrite(str(path), image)
    frame = SimpleNamespace(index=0, cameras={"CAM_FRONT": (path, 0, calib, np.eye(4))})
    layout = {"frames": [{"index": 0, "T_world_lidar": np.eye(4).tolist()}], "actors": [
        {"track": "red", "label": "car", "size": [4, 2, 2], "keys": [
            {"frame": 0, "center": [10, 0, 0], "yaw": 0}]}]}
    return frame, layout


def test_actor_colors_red_and_no_mutation(tmp_path):
    frame, layout = color_fixture(tmp_path)
    original = json.dumps(layout)
    colors = actor_colors(SimpleNamespace(frames=lambda _: [frame]), "synthetic", layout)
    assert colors["red"][0] >= 175 and max(colors["red"][1:]) <= 25
    assert json.dumps(layout) == original
    layout["actors"][0]["origin"] = "generated"
    assert actor_colors(SimpleNamespace(frames=lambda _: [frame]), "synthetic", layout) == {}


def test_nearer_occluder_excluded(tmp_path):
    frame, _ = color_fixture(tmp_path)
    calib = frame.cameras["CAM_FRONT"][2]
    back = Box3D(10, 0, 0, 4, 2, 2, 0, "car")
    front = Box3D(5, 0, 0, 4, 3, 3, 0, "truck")
    assert not upper_body_mask(back, calib, [back, front]).any()


def test_label_metadata_and_replay_origin(tmp_path):
    _, layout = color_fixture(tmp_path)
    layout["frames"][0]["cameras"] = {}
    layout["actors"][0].update(appearance="library", asset_id="sedan")
    actors = generate_traffic(layout, {"mode": "replay"})
    assert actors[0]["origin"] == "recorded"
    run = tmp_path / "run"
    (run / "visibility").mkdir(parents=True)
    (tmp_path / "layout.json").write_text(json.dumps(layout))
    actors[0]["origin"] = "generated"
    (run / "actors.json").write_text(json.dumps(actors))
    (run / "visibility" / "000000.json").write_text("{}")
    summary = write_labels(tmp_path, run)
    box = json.loads((run / "labels3d" / "000000.json").read_text())["boxes"][0]
    assert summary["frames"] == 1
    assert {key: box[key] for key in ("appearance", "asset_id", "origin")} == {
        "appearance": "library", "asset_id": "sedan", "origin": "generated"}
