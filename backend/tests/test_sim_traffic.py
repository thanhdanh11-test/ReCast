"""Traffic safety, determinism, input boundaries and render/label integration."""

import json
from copy import deepcopy
from pathlib import Path

import cv2
import numpy as np
import pytest

from topeye.sim import cli, traffic
from topeye.sim.labels import write_labels


def vehicle(track, y=0, moving=True):
    return {"track": track, "label": "car", "size": [4.0, 1.8, 1.5], "keys": [
        {"frame": i * 2, "center": [-80.0 + 16 * i if moving else -80.0, y, 0.75], "yaw": 0.0}
        for i in range(11)]}


@pytest.fixture
def scene(tmp_path, monkeypatch):
    cv2.imwrite(str(tmp_path / "ground_drivable.png"), np.full((100, 200), 255, np.uint8))
    frames = []
    for i in range(11):
        transform = np.eye(4)
        transform[:3, 3] = [i * 5, 40, 1.5]
        frames.append({"index": i * 2, "timestamp_us": 100000000 + i * 1000000,
                       "T_world_lidar": transform.tolist(), "cameras": {}})
    layout = {"scene": "fixture", "ground": {"drivable": "ground_drivable.png", "tex_res_m": 1},
              "bounds": {"xmin": -100, "xmax": 100, "ymin": -50, "ymax": 50},
              "frames": frames, "actors": [vehicle("a", -10), vehicle("b"), vehicle("c", 10)]}
    original = traffic._road
    monkeypatch.setattr(traffic, "_road", lambda layout, scene_dir=None: original(
        layout, tmp_path if scene_dir is None else scene_dir))
    return layout, tmp_path


@pytest.mark.parametrize("params", [{"unknown": 1}, {"density": -1}, {"density": 4},
    {"speed_scale": 0.49}, {"speed_scale": 2.01}, {"speed_jitter": 0.51},
    {"lane_change_rate": -0.1}, {"aggressiveness": 1.1}, {"pedestrians": 3.1},
    {"density": True}, {"speed_scale": float("nan")}, {"speed_jitter": float("inf")},
    {"keep_parked": 1}, {"seed": True}, {"seed": 0.2}, {"mode": "bad"}, None])
def test_invalid_parameters_rejected_even_in_replay(params):
    with pytest.raises(ValueError):
        traffic.generate_traffic({"actors": []}, params)


def test_replay_returns_original_list_without_loading_raster():
    actors = [vehicle("a")]
    assert traffic.generate_traffic({"actors": actors}, {}) is actors


def test_determinism_and_layout_immutability(scene):
    layout, _ = scene
    before = deepcopy(layout)
    params = {"mode": "generated", "density": 3, "seed": -21, "lane_change_rate": 1}
    first = traffic.generate_traffic(layout, params)
    assert first == traffic.generate_traffic(layout, params)
    assert first != traffic.generate_traffic(layout, {**params, "seed": 22})
    assert before == layout
    assert all(k["frame"] in {f["index"] for f in layout["frames"]}
               for a in first for k in a["keys"])
    assert len({a["track"] for a in first}) == len(first)


def test_density_lane_changes_and_hard_constraints(scene):
    layout, _ = scene
    counts, lane_changes = [], 0
    for density in (0.5, 1, 2):
        actors = traffic.generate_traffic(layout, {"mode": "generated", "density": density,
                                                  "lane_change_rate": 1})
        checks = traffic.check_traffic(layout, actors)
        assert checks["overlaps"] == checks["ego_conflicts"] == 0
        assert checks["off_road_ratio"] == 0
        counts.append(checks["moving_vehicles"])
        lane_changes += sum(abs(a["keys"][-1]["center"][1] - a["keys"][0]["center"][1]) >= 2.5
                            for a in actors if len(a["keys"]) > 1)
    assert counts == sorted(counts) and counts[-1] > counts[0]
    assert lane_changes >= 1


def test_checker_detects_overlap_ego_and_offroad(scene):
    layout, _ = scene
    actor = vehicle("a")
    assert traffic.check_traffic(layout, [actor, {**actor, "track": "b"}])["overlaps"] == 11
    ego_actor = vehicle("gen:0:ego")
    for key, frame in zip(ego_actor["keys"], layout["frames"], strict=True):
        key["center"] = np.asarray(frame["T_world_lidar"])[:3, 3].tolist()
    assert traffic.check_traffic(layout, [ego_actor])["ego_conflicts"] == 11
    # The road rule covers generated vehicles; recorded GT vehicles are real by definition.
    assert traffic.check_traffic(layout, [vehicle("gen:0:offroad", 100)])["off_road_ratio"] == 1
    assert traffic.check_traffic(layout, [vehicle("offroad", 100)])["off_road_ratio"] == 0


def test_rotated_obb_and_exact_ego_clearance():
    a = ([0, 0, 0], np.pi / 4, [4, 1, 1])
    assert traffic._box_distance(a, ([0, 0, 0], -np.pi / 4, [4, 1, 1])) < 0
    a = ([0, 0, 0], 0, [4, 2, 1])
    assert traffic._box_distance(a, ([5, 0, 0], 0, [4, 2, 1])) == pytest.approx(1)
    assert traffic._box_distance(a, ([5, 3, 0], 0, [4, 2, 1])) == pytest.approx(np.sqrt(2))


def test_parked_vehicles_are_kept_as_recorded(scene):
    layout, _ = scene
    parked = vehicle("parked", -20, False)
    layout["actors"] += [parked, vehicle("curbside", 100, False)]
    actors = traffic.generate_traffic(layout, {"mode": "generated", "density": 0})
    assert [a["track"] for a in actors] == ["parked", "curbside"]
    assert traffic.generate_traffic(layout, {"mode": "generated", "density": 0,
                                           "keep_parked": False}) == []


def test_box_jitter_does_not_make_a_parked_vehicle_moving(scene):
    # scene-0061 truck: 1.24 m summed jitter, never more than 0.39 m from its spot.
    layout, _ = scene
    truck = vehicle("truck", -20, False)
    for i, key in enumerate(truck["keys"]):
        key["center"][0] += 0.3 * (-1) ** i
    assert traffic._distance(truck) < 1
    layout["actors"].append(truck)
    actors = traffic.generate_traffic(layout, {"mode": "generated", "density": 0})
    assert [a["track"] for a in actors] == ["truck"]


def test_pedestrian_duplication_preserves_ids_and_bounded_shift(scene):
    layout, _ = scene
    pedestrian = {**vehicle("walker"), "label": "pedestrian"}
    layout["actors"] = [pedestrian]
    actors = traffic.generate_traffic(layout, {"mode": "generated", "pedestrians": 3})
    assert len(actors) == 3 and actors[0]["track"] == "walker"
    for actor in actors[1:]:
        delta = np.array(actor["keys"][0]["center"]) - pedestrian["keys"][0]["center"]
        assert 0.5 <= np.linalg.norm(delta[:2]) <= 1.5
        assert actor["track"].startswith("gen:0:")


def test_missing_raster_and_path_escape(scene):
    layout, directory = scene
    with pytest.raises(ValueError, match="Cannot read ground.drivable"):
        traffic.generate_traffic(layout, {"mode": "generated"}, scene_dir=directory / "missing")
    for path in (str(directory / "ground_drivable.png"), "../ground_drivable.png"):
        bad = deepcopy(layout)
        bad["ground"]["drivable"] = path
        with pytest.raises(ValueError, match="relative"):
            traffic.generate_traffic(bad, {"mode": "generated"}, scene_dir=directory)


def test_shifted_paths_require_90_percent_drivable(scene):
    layout, directory = scene
    image = np.zeros((100, 200), np.uint8)
    image[49:51] = 255
    cv2.imwrite(str(directory / "ground_drivable.png"), image)
    paths = traffic._paths(layout, traffic._road(layout))
    assert paths and all(p.offset == 0 for p in paths)


def test_generated_render_cli_passes_same_actor_file(monkeypatch, scene):
    layout, directory = scene
    scene_directory = directory / "fixture"
    scene_directory.mkdir()
    (scene_directory / "layout.json").write_text(json.dumps(layout))
    cv2.imwrite(str(scene_directory / "ground_drivable.png"), np.full((100, 200), 255, np.uint8))
    scenario = directory / "generated.toml"
    scenario.write_text('name="generated"\n[traffic]\nmode="generated"\ndensity=1\n')
    monkeypatch.setattr(cli, "sim_root", lambda _: directory)
    monkeypatch.setattr(cli, "blender_bin", lambda _: "blender")
    calls = []
    monkeypatch.setattr(cli, "run_blender", lambda *args: calls.append(args) or 0)
    monkeypatch.setattr(cli, "write_labels", lambda *args: {"missing_visibility": []})
    assert cli.render_main(["--scene", "fixture", "--scenario", str(scenario)]) == 0
    assert len(calls) == 2 and "--actors" not in calls[0]
    path = calls[1][calls[1].index("--actors") + 1]
    actors = json.loads(Path(path).read_text())
    assert actors and all(a["track"].startswith("gen:") for a in actors)


def test_scenario_rejects_invalid_traffic_before_blender(tmp_path):
    for value in ('density=4', 'keep_parked=1', 'seed=true', 'color_randomization=1'):
        path = tmp_path / "invalid.toml"
        path.write_text('name="invalid"\n[traffic]\nmode="generated"\n' + value)
        with pytest.raises(cli.InputError):
            cli.check_scenario(path)


def test_labels_use_generated_actors_for_3d_and_visibility(scene):
    layout, directory = scene
    layout["actors"] = [vehicle("old")]
    layout["frames"] = layout["frames"][:1]
    (directory / "layout.json").write_text(json.dumps(layout))
    run = directory / "run"
    (run / "visibility").mkdir(parents=True)
    actor = vehicle("generated")
    actor["keys"] = actor["keys"][:1]
    (run / "actors.json").write_text(json.dumps([actor]))
    (run / "visibility" / "000000.json").write_text('{}')
    result = write_labels(directory, run)
    assert result["missing_visibility"] == []
    labels = json.loads((run / "labels3d" / "000000.json").read_text())["boxes"]
    assert [box["track"] for box in labels] == ["generated"]
    (run / "visibility" / "000000.json").write_text('{"CAM_FRONT":{"old":{}}}')
    with pytest.raises(ValueError, match="Visibility tracks"):
        write_labels(directory, run)
    (run / "actors.json").write_text('[]')
    (run / "visibility" / "000000.json").write_text('{}')
    write_labels(directory, run)
    assert json.loads((run / "labels3d" / "000000.json").read_text())["boxes"] == []


def test_generated_actor_controls_yolo_class_and_3d_track(tmp_path):
    camera = {"width": 120, "height": 80, "K": [[80, 0, 60], [0, 80, 40], [0, 0, 1]],
              "T_world_cam": np.eye(4).tolist()}
    original = {"track": "old", "label": "car", "size": [4, 2, 1.5],
                "keys": [{"frame": 0, "center": [0, 0, 10], "yaw": 0}]}
    generated = {**original, "track": "gen:4:0", "label": "truck"}
    layout = {"frames": [{"index": 0, "T_world_lidar": np.eye(4).tolist(),
                          "cameras": {"CAM_FRONT": camera}}], "actors": [original]}
    (tmp_path / "layout.json").write_text(json.dumps(layout))
    run = tmp_path / "run"
    (run / "visibility").mkdir(parents=True)
    (run / "actors.json").write_text(json.dumps([generated]))
    (run / "visibility" / "000000.json").write_text(json.dumps(
        {"CAM_FRONT": {generated["track"]: {"visible": 27, "samples": 27}}}))
    summary = write_labels(tmp_path, run)
    assert summary["boxes_2d"] == 1
    assert (run / "labels" / "yolo" / "CAM_FRONT" / "000000.txt").read_text().startswith("1 ")
    labels = json.loads((run / "labels3d" / "000000.json").read_text())["boxes"]
    assert labels[0]["track"] == generated["track"]
