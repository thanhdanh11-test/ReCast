"""Domain regression proof: timestamps, coordinate transforms and error gates."""

import json
from copy import deepcopy
from pathlib import Path

import numpy as np
import pytest

from topeye.scenario.metrics import score_replay
from topeye.scenario.models import ScenarioError, guard_output, interpolate, samples, validate
from topeye.scenario.variants import make_variant


@pytest.fixture(name="scenario")
def scenario_fixture(tmp_path):
    rows = np.array([[t, 100 + t * 5, 30, 1, 0] for t in np.arange(0, 5.1, 0.5)])
    actors = []
    for i, name in enumerate(["ego", "vehicle_1"]):
        data = rows.copy()
        data[:, 1] += i * 10
        actors.append(
            {
                "id": name,
                "instance_token": str(i),
                "role": "ego" if i == 0 else "traffic",
                "category": "vehicle.car",
                "length_m": 4,
                "width_m": 2,
                "height_m": 1.5,
                "samples": samples(data, data[:, 0]),
            }
        )
    return {
        "schema_version": 1,
        "id": "fixture",
        "source": {
            "scene": "test",
            "dataset_root": str(tmp_path / "input"),
            "origin_global_m": [100, 30, 0],
        },
        "interval_s": [0, 5],
        "actors": actors,
        "road": {"kind": "synthetic_corridor", "file": "road.xodr", "heading_rad": 0},
    }


def observations(s):
    from topeye.scenario.models import matrix

    return [
        dict(row, id=a["id"])
        for a in s["actors"]
        for row in samples(interpolate(matrix(a), np.arange(0, s["interval_s"][1] + 1e-7, 0.05)))
    ]


def test_score_positive_and_deliberately_corrupted(scenario):
    correct = observations(scenario)
    assert score_replay(scenario, correct)["status"] == "pass"
    corrupt = deepcopy(correct)
    for r in corrupt:
        r["x_m"] += 1
    assert score_replay(scenario, corrupt)["status"] == "fail"
    assert score_replay(scenario, correct[::2])["status"] == "fail"
    assert score_replay(scenario, [r for r in correct if r["id"] == "ego"])["status"] == "fail"
    for r in corrupt:
        r["x_m"] -= 1
        r["yaw_rad"] += 0.2
    assert score_replay(scenario, corrupt)["status"] == "fail"


def test_yaw_wrap():
    a = np.array([[0, 0, 0, 0, np.deg2rad(179)], [1, 1, 0, 0, np.deg2rad(-179)]])
    assert abs(abs(interpolate(a, [0.5])[0, 4]) - np.pi) < 1e-8
    with pytest.raises(ScenarioError):
        interpolate(a, [-0.1])


@pytest.mark.parametrize("factor,offset", [(0, 0), (-1, 0), (float("nan"), 0), (1, 11), (2, 0)])
def test_variant_invalid(scenario, factor, offset):
    with pytest.raises(ScenarioError):
        make_variant(scenario, "vehicle_1", factor, offset)


def test_variant_identity_speed_offset_and_immutable(scenario):
    snapshot = json.dumps(scenario)
    same = make_variant(scenario, "vehicle_1", 1, 0)
    assert same["actors"] == scenario["actors"]
    faster = make_variant(scenario, "vehicle_1", 1.2, 0)
    assert faster["interval_s"][1] < 5
    assert faster["actors"][1]["samples"][20]["x_m"] == pytest.approx(116)
    shifted = make_variant(scenario, "vehicle_1", 1, 2)
    assert shifted["actors"][1]["samples"][0]["x_m"] == 112
    assert json.dumps(scenario) == snapshot


def test_stationary_rejects_variant(scenario):
    for r in scenario["actors"][1]["samples"]:
        r["x_m"] = 110
    with pytest.raises(ScenarioError):
        make_variant(scenario, "vehicle_1", 1.2, 0)


def test_validation_missing_gap_duplicate_nan(scenario):
    for fault in ["gap", "duplicate", "nan"]:
        s = deepcopy(scenario)
        if fault == "gap":
            del s["actors"][0]["samples"][2:5]
        if fault == "duplicate":
            s["actors"][0]["samples"][1]["t_s"] = 0
        if fault == "nan":
            s["actors"][0]["samples"][0]["x_m"] = float("nan")
        with pytest.raises(ScenarioError):
            validate(s)


def test_dataset_write_and_symlink_guard(tmp_path):
    dataset = tmp_path / "data"
    dataset.mkdir()
    link = tmp_path / "link"
    link.symlink_to(dataset)
    with pytest.raises(ScenarioError):
        guard_output(link / "run", dataset)
    assert guard_output(tmp_path / "output", dataset) == tmp_path / "output"


def test_raw_extraction_ego_not_sensor():
    from types import SimpleNamespace

    from topeye.scenario.extract import extract_scene

    tables = {
        name: {}
        for name in [
            "scene",
            "sample",
            "sample_annotation",
            "instance",
            "category",
            "sample_data",
            "calibrated_sensor",
            "sensor",
            "ego_pose",
        ]
    }
    tables["scene"]["sc"] = {"token": "sc", "name": "scene-test"}
    tables["instance"]["actor"] = {"category_token": "cat"}
    tables["category"]["cat"] = {"name": "vehicle.car"}
    tables["calibrated_sensor"]["cal"] = {"sensor_token": "lidar", "translation": [20, 0, 3]}
    tables["sensor"]["lidar"] = {"channel": "LIDAR_TOP"}
    for i in range(7):
        key = str(i)
        ts = 1000000 + i * 500000
        tables["sample"][key] = {"token": key, "scene_token": "sc", "timestamp": ts}
        tables["sample_data"][key] = {
            "sample_token": key,
            "ego_pose_token": key,
            "calibrated_sensor_token": "cal",
        }
        tables["ego_pose"][key] = {
            "timestamp": ts,
            "translation": [100 + i * 2, 50, 0],
            "rotation": [1, 0, 0, 0],
        }
        tables["sample_annotation"][key] = {
            "sample_token": key,
            "instance_token": "actor",
            "translation": [110 + i * 2, 50, 1],
            "rotation": [1, 0, 0, 0],
            "size": [2, 4, 2],
        }
    adapter = SimpleNamespace(tables=tables, root=Path("/source"), version="test")
    result = extract_scene(adapter, "scene-test", ["actor"], 0, 3)
    assert result["actors"][0]["samples"][0]["x_m"] == 0
    assert result["actors"][1]["samples"][0]["x_m"] == 10
    assert result["source"]["origin_global_m"] == [100, 50, 0]


@pytest.mark.parametrize("times,start,end", [([0, 3, 4, 5], 2, 5), ([0, 1, 2, 5], 0, 3)])
def test_extraction_rejects_boundary_gap(monkeypatch, times, start, end):
    from types import SimpleNamespace

    from topeye.scenario import extract

    rows = np.array([[t, t * 5, 0, 0, 0] for t in times], dtype=float)
    ego = np.array([[t, t * 5, 0, 0, 0] for t in np.arange(0, 5.1, 0.5)])
    monkeypatch.setattr(
        extract,
        "raw_scene",
        lambda *_: (
            0,
            ego,
            {"actor": {"rows": rows, "category": "vehicle.car", "sizes": [[2, 4, 1.5]]}},
        ),
    )
    with pytest.raises(ScenarioError, match="gap"):
        extract.extract_scene(
            SimpleNamespace(root=Path("/source"), version="test"), "scene", ["actor"], start, end
        )


def test_atomic_write_ignores_predictable_tmp_symlink(tmp_path):
    from topeye.scenario.models import write_json

    dataset = tmp_path / "source.json"
    dataset.write_text("ORIGINAL")
    (tmp_path / "status.json.tmp").symlink_to(dataset)
    write_json(tmp_path / "status.json", {"status": "interrupted"})
    assert dataset.read_text() == "ORIGINAL"
    assert json.loads((tmp_path / "status.json").read_text()) == {"status": "interrupted"}


def test_oriented_box_contacts_and_clearance(scenario):
    from topeye.scenario.contacts import clearance, contact_events, corners

    a, b = scenario["actors"]
    left = corners(a, a["samples"][0])
    right = corners(b, b["samples"][0])
    assert clearance(left, right) == pytest.approx(6)
    assert clearance(left, left) == 0
    assert clearance(left, right + np.array([0, 6])) == pytest.approx(np.sqrt(52))
    events = contact_events(scenario["actors"], observations(scenario))
    assert events[0]["contact_samples"] == 0
    for row in scenario["actors"][1]["samples"]:
        row["x_m"] -= 10
    report = score_replay(scenario, observations(scenario))
    assert report["events"][0]["contact_samples"] > 0
    assert report["status"] == "pass"  # Deliberate contact is not an invalid replay.
