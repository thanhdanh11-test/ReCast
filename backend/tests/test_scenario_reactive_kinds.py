"""Plan47 WP1: kind contracts, lane/stop geometry and real-package admission."""

import copy
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from test_scenario_reactive import actor, platoon

from topeye.scenario.dataset import create_adapter
from topeye.scenario.map_context import build_map_context
from topeye.scenario.models import ScenarioError
from topeye.scenario.reactive import (
    DT,
    STOP_S0,
    Event,
    assess,
    candidates,
    centres,
    checks,
    lane_plan,
    parse_event,
    run_event,
    scene_model,
    simulate,
)
from topeye.scenario.reactive_map import Lane, ReactiveMap, StopLine, load_map
from topeye.scenario.reactive_metrics import _kind_events, _kind_params, reactive_metrics
from topeye.scenario.real2sim import parse_package
from topeye.scenario.source_scene import source_scene
from topeye.scenario.worker import Service


def mapped_source(duration=25.0, target_x=15.0):
    source = platoon(duration)
    source["actors"].append(actor("target-token", target_x, 10, duration, y=3.5))
    x = np.arange(-50.0, 400.0, 0.5)
    lanes = [Lane("old", np.column_stack([x, np.zeros_like(x)]), np.zeros_like(x)),
             Lane("left", np.column_stack([x, np.full_like(x, 3.5)]), np.zeros_like(x))]
    stop = StopLine("line-1", np.array([[106, -5], [107, -5], [107, 5], [106, 5]]), "STOP_SIGN")
    return source, ReactiveMap(lanes, [stop])


def command(model, kind, **fields):
    return {"actor_id": model.agents[model.index["car_001"]].actor_id, "t0_s": 2.0,
            "kind": kind, "react": True, "reaction_s": 1.0, **fields}


def test_brake_without_kind_and_with_kind_replay_identically():
    model = scene_model(platoon(duration=20))
    old = command(model, "brake", decel_mps2=4.0, target="stop", dwell_s=3.0)
    explicit = parse_event(model, old)[0]
    implicit = parse_event(model, {key: value for key, value in old.items() if key != "kind"})[0]
    a, b = simulate(model, explicit), simulate(model, implicit)
    for key in ("S", "V", "A", "mode", "leader", "gap"):
        assert np.array_equal(getattr(a, key), getattr(b, key), equal_nan=True)
    first = reactive_metrics(model)
    wrapped = reactive_metrics(model, kinds=["brake"])["brake"]
    first.pop("runtime_s")
    wrapped.pop("runtime_s")
    assert first == wrapped


@pytest.mark.parametrize("kind,fields", [
    ("accelerate", {"decel_mps2": 4.0, "target_mps": 13.0, "accel_mps2": 2.0}),
    ("stopline", {"target": "stop", "dwell_s": 3.0}),
    ("lane_change", {"dwell_s": 3.0, "direction": "left", "duration_s": 4.0}),
])
def test_foreign_kind_field_is_invalid_input(kind, fields):
    source, map_data = mapped_source()
    model = scene_model(source, map_data)
    with pytest.raises(ScenarioError) as error:
        parse_event(model, command(model, kind, **fields))
    assert error.value.code == "INVALID_INPUT"


def test_accelerate_uses_its_own_window_after_brake_window_ends():
    source, map_data = mapped_source(duration=13.0)
    model = scene_model(source, map_data)
    offer = next(c for c in candidates(model)["candidates"] if c["name"] == "car_001")
    assert all(not (lo <= 2.0 <= hi) for lo, hi in offer["windows"])
    assert any(lo <= 2.0 <= hi for lo, hi in offer["kinds"]["accelerate"]["windows_by_accel"]["3"])
    parsed, _, _ = parse_event(model, command(model, "accelerate", target_mps=13.0, accel_mps2=3.0))
    assert parsed.kind == "accelerate"


def test_stopline_near_braking_boundary_rejects_instant_speed_jump():
    source, map_data = mapped_source(duration=30.0)
    stop = StopLine("near", np.array([[85, -5], [86, -5], [86, 5], [85, 5]]), "STOP_SIGN")
    model = scene_model(source, ReactiveMap(map_data.lanes, [stop]))
    actor = model.index["car_001"]
    assert model.map_data.next_stopline(model, actor, 2.0) is not None
    with pytest.raises(ScenarioError) as error:
        parse_event(model, command(model, "stopline", dwell_s=3.0))
    assert error.value.code == "EVENT_NOT_ALLOWED"


@pytest.mark.parametrize("kind", ["accelerate", "stopline", "lane_change"])
def test_kind_metric_cells_are_accepted_by_event_parser(kind):
    source, map_data = mapped_source(duration=15.0)
    model = scene_model(source, map_data)
    events = _kind_events(model, kind)
    assert events
    for event in events:
        actor_id = model.agents[model.index[event.actor]].actor_id
        parsed, _, _ = parse_event(model, {"actor_id": actor_id, "kind": kind, "t0_s": event.t0,
                                           "react": True, "reaction_s": 1.0, **_kind_params(event)})
        assert parsed.kind == kind


def test_empty_accelerate_and_zero_lane_shift_replay_pilot():
    source, map_data = mapped_source()
    model = scene_model(source, map_data)
    lead = model.index["car_001"]
    empty = (Event("car_001", 2.0, kind="accelerate", target_mps=float(model.V[round(2 / DT), lead]),
                   accel_mps2=2.0),
             Event("car_001", 2.0, kind="lane_change", direction="left", duration_s=0.0))
    for event in empty:
        out = simulate(model, event)
        assert not out.changed.any()
        assert np.array_equal(out.S, model.S, equal_nan=True)
        assert np.array_equal(out.V, model.V, equal_nan=True)


def test_accelerate_obeys_leader_and_followers_catch_up():
    model = scene_model(platoon(duration=25))
    out = simulate(model, Event("car_001", 2.0, kind="accelerate", target_mps=13.0, accel_mps2=2.0))
    lead, follower = model.index["car_001"], model.index["car_002"]
    assert out.V[round(4 / DT), lead] == pytest.approx(13, abs=0.05)
    assert out.V[round(10 / DT), follower] > 11.0
    assert "car_002" in out.driving_from
    assert not assess(model, out).collisions
    behind_leader = simulate(model, Event("car_002", 2.0, kind="accelerate", target_mps=16.0,
                                          accel_mps2=3.0))
    assert np.nanmax(behind_leader.V[:, follower]) <= 10.1  # the car ahead remains at 10 m/s
    assert not assess(model, behind_leader).collisions


def test_stopline_stops_at_fixed_gap_for_exact_dwell():
    source, map_data = mapped_source(duration=30)
    model = scene_model(source, map_data)
    parsed, _, _ = parse_event(model, command(model, "stopline", dwell_s=3.0))
    out = simulate(model, parsed)
    i = model.index["car_001"]
    k = round(out.event_phases["target_reached"] / DT)
    assert out.S[k, i] == pytest.approx(parsed.stopline["s"] - STOP_S0, abs=0.1)
    assert out.V[k, i] == 0
    assert out.event_phases["dwell_end"] - out.event_phases["target_reached"] == pytest.approx(3.0, abs=DT)
    assert out.kind_detail["stopline"]["type"] == "STOP_SIGN"
    without_map = scene_model(source)
    plain = candidates(without_map)["candidates"]
    assert all("stopline" not in row["kinds"] and "lane_change" not in row["kinds"] for row in plain)
    with pytest.raises(ScenarioError) as error:
        parse_event(without_map, command(without_map, "stopline", dwell_s=3.0))
    assert error.value.code == "EVENT_NOT_ALLOWED"


def test_lane_change_reaches_adjacent_centre_and_changes_target_follower_leader():
    source, map_data = mapped_source()
    model = scene_model(source, map_data)
    parsed, _, _ = parse_event(model, command(model, "lane_change", direction="left", duration_s=4.0))
    out = simulate(model, parsed)
    _, Y, _ = centres(model, out)
    lead, follower = model.index["car_001"], model.index["car_004"]
    assert Y[round(6 / DT), lead] == pytest.approx(3.5, abs=0.3)
    assert "car_004" in out.driving_from
    assert lead in out.leader[:, follower]
    assert out.kind_detail["mobil"]["new_follower"] == "car_004"
    assert lane_plan(model, lead, 2.0, "right", 4.0) is None
    with pytest.raises(ScenarioError) as error:
        parse_event(model, command(model, "lane_change", direction="right", duration_s=4.0))
    assert error.value.code == "EVENT_NOT_ALLOWED"


def test_lane_change_finishes_on_time_while_idm_slows_for_target_leader():
    source, map_data = mapped_source()
    source["actors"].append(actor("target-ahead", 50, 8, 25, y=3.5))
    model = scene_model(source, map_data)
    out = simulate(model, Event("car_001", 2.0, kind="lane_change", direction="left", duration_s=4.0))
    _, y, heading = centres(model, out)
    event_index = model.index["car_001"]
    assert out.V[round(6 / DT), event_index] < 4.0
    assert y[round(4 / DT), event_index] == pytest.approx(1.75, abs=0.2)
    assert y[round(6 / DT), event_index] == pytest.approx(3.5, abs=0.3)
    assert 0.05 < heading[round(4 / DT), event_index] < 1.0
    assert model.index["car_005"] in out.leader[:, event_index]
    assert not assess(model, out).collisions


def test_lane_change_repeated_simulation_is_independent_of_cached_route():
    source, map_data = mapped_source()
    model = scene_model(source, map_data)
    event = Event("car_001", 2.0, kind="lane_change", direction="left", duration_s=4.0)
    first = simulate(model, event)
    second = simulate(model, event)
    np.testing.assert_array_equal(first.S, second.S)
    np.testing.assert_array_equal(first.V, second.V)


def test_aggressive_cutin_reports_mobil_unsafe_without_blocking():
    source, map_data = mapped_source(target_x=22)
    for sample in source["actors"][-1]["samples"]:
        sample["x_m"] = 22 + 14 * sample["t_s"]
    model = scene_model(source, map_data)
    out = simulate(model, Event("car_001", 2.0, kind="lane_change", direction="left", duration_s=4.0))
    assert out.kind_detail["mobil"]["safe"] is False
    assert out.kind_detail["mobil"]["required_decel_mps2"] > 4.0
    result = assess(model, out)
    assert "collision" in result.reasons
    assert next(row for row in checks(model, out, result)
                if row["id"] == "collision")["passed"] is False


def test_ego_as_new_follower_keeps_rare_group():
    source, map_data = mapped_source(target_x=-100)
    for sample in source["actors"][0]["samples"]:
        sample["x_m"] += 33.5
        sample["y_m"] = 3.5
    model = scene_model(source, map_data)
    out = simulate(model, Event("car_001", 2.0, kind="lane_change", direction="left", duration_s=4.0))
    result = assess(model, out)
    assert out.kind_detail["mobil"]["new_follower"] == "ego"
    assert result.valid and result.group == "close"


def test_candidates_windows_fit_and_kind_metrics_have_real_params():
    source, map_data = mapped_source(duration=15)
    model = scene_model(source, map_data)
    offer = next(row for row in candidates(model)["candidates"] if row["name"] == "car_001")
    assert set(offer["kinds"]) == {"brake", "accelerate", "stopline", "lane_change"}
    for key, windows in offer["kinds"]["lane_change"]["windows_by_change"].items():
        direction, duration = key.split(":")
        for lo, hi in windows:
            for t in np.arange(lo, hi + 0.01, 0.5):
                assert lane_plan(model, model.index["car_001"], float(t), direction, float(duration)) is not None
    result = reactive_metrics(model, kinds=["accelerate", "stopline", "lane_change"])
    for kind in result:
        metric = result[kind]
        assert metric["kind"] == kind and metric["tried"] > 0
        assert metric["tried"] == len(metric["cells"])
        assert all("params" in cell and "decel" not in cell for cell in metric["cells"])
        assert all(axis["name"] in metric["cells"][0]["params"] for axis in metric["grid"]["axes"])


def test_worker_metrics_kinds_route_and_validation(monkeypatch, tmp_path):
    source, map_data = mapped_source(duration=12)
    service = Service()
    service.adapter = SimpleNamespace(root=tmp_path, version="v1.0-mini")
    monkeypatch.setattr(service, "use_adapter", lambda *_: None)
    monkeypatch.setattr(service, "cached_source", lambda *_: source)
    monkeypatch.setattr("topeye.scenario.reactive_map.load_map", lambda *_: map_data)
    params = {"dataset": str(tmp_path), "scene": "scene-test", "reactions": [1.0], "kinds": ["accelerate"]}
    first = service.call("reactive_metrics", params)
    assert first["accelerate"]["tried"] > 0
    assert service.call("reactive_metrics", params) is first  # cache includes the kinds selection
    with pytest.raises(ScenarioError) as error:
        service.call("reactive_metrics", {**params, "kinds": ["brake", "bogus"]})
    assert error.value.code == "INVALID_INPUT"


def test_kind_event_rejects_time_outside_its_candidate_window():
    source, map_data = mapped_source(duration=15)
    model = scene_model(source, map_data)
    offer = next(row for row in candidates(model)["candidates"] if row["name"] == "car_001")
    for kind, fields, window_key in (
        ("accelerate", {"accel_mps2": 1.0, "target_mps": 13.0}, "windows_by_accel"),
        ("stopline", {"dwell_s": 3.0}, "windows_by_dwell"),
    ):
        windows = offer["kinds"][kind][window_key]
        latest = max(hi for spans in windows.values() for _, hi in spans)
        t0 = latest + 0.25
        with pytest.raises(ScenarioError) as error:
            parse_event(model, command(model, kind, **fields, t0_s=t0))
        assert error.value.code == "EVENT_NOT_ALLOWED"


def test_kind_parser_enforces_published_windows_when_generic_window_fits():
    source, map_data = mapped_source(duration=15)
    model = scene_model(source, map_data)
    offers = copy.deepcopy(candidates(model))
    row = next(item for item in offers["candidates"] if item["name"] == "car_001")
    model._candidate_cache = offers
    for kind, fields, key, label in (
        ("accelerate", {"accel_mps2": 1.0, "target_mps": 13.0}, "windows_by_accel", "1"),
        ("stopline", {"dwell_s": 3.0}, "windows_by_dwell", "3"),
        ("lane_change", {"direction": "left", "duration_s": 4.0}, "windows_by_change", "left:4"),
    ):
        event = command(model, kind, t0_s=3.5, **fields)
        row["kinds"][kind][key][label] = [[0.0, 3.0]]
        with pytest.raises(ScenarioError) as error:
            parse_event(model, event)
        assert error.value.code == "EVENT_NOT_ALLOWED"


@pytest.fixture(scope="module")
def real_scene_0061():
    root = Path.home() / "cvat-day2/tools/traffic_pipeline/data/nuscenes"
    adapter = create_adapter(root, "v1.0-mini")
    return source_scene(adapter, "scene-0061"), adapter


def test_real_nuscenes_three_kinds_parse_package(real_scene_0061):
    source, adapter = real_scene_0061
    model = scene_model(source, load_map(adapter, source))
    offers = candidates(model)["candidates"]
    context = build_map_context(source)
    for kind in ("accelerate", "stopline", "lane_change"):
        for row in offers:
            offer = row["kinds"].get(kind)
            if not offer:
                continue
            event = {"actor_id": row["actor_id"], "react": True, "reaction_s": 1.0, "kind": kind}
            if kind == "accelerate":
                accel, windows = next(iter(offer["windows_by_accel"].items()))
                t0 = windows[0][0]
                speed = model.V[round(t0 / DT), model.by_actor[row["actor_id"]]]
                event.update(t0_s=t0, accel_mps2=float(accel), target_mps=min(float(speed) + 3,
                             offer["max_target_mps"]))
            elif kind == "stopline":
                dwell, windows = next(iter(offer["windows_by_dwell"].items()))
                event.update(t0_s=windows[0][0], dwell_s=float(dwell))
            else:
                key, windows = next(iter(offer["windows_by_change"].items()))
                direction, duration = key.split(":")
                event.update(t0_s=windows[0][0], direction=direction, duration_s=float(duration))
            files = run_event(model, event)["files"]
            package = parse_package(files, context)
            detail = json.loads(files["report.json"])["topeye"]
            assert package["actors"] and detail["kind"] == kind
            markers = {marker["kind"] for marker in detail["markers"]}
            assert "event_start" in markers
            if kind == "lane_change":
                assert "lane_arrived" in markers
            if kind == "stopline":
                assert "stopped" in markers and "resume" in markers
            break
        else:
            pytest.fail(f"No real {kind} candidate in scene-0061")


def test_real_truck_stopline_settles_without_teleport_or_physics_violation(real_scene_0061):
    source, adapter = real_scene_0061
    model = scene_model(source, load_map(adapter, source))
    truck = model.agents[model.index["truck_138"]]
    event = {"actor_id": truck.actor_id, "t0_s": 0.0, "kind": "stopline", "dwell_s": 3.0,
             "react": True, "reaction_s": 1.0}
    parsed, _, _ = parse_event(model, event)
    outcome = simulate(model, parsed)
    result = assess(model, outcome)
    assert result.valid and result.reasons == []
    assert result.physics["truck_138"]["max_decel"] <= 5.2
    stopped = round(outcome.event_phases["target_reached"] / DT)
    assert outcome.S[stopped, model.index["truck_138"]] == pytest.approx(parsed.stopline["s"] - STOP_S0, abs=0.1)


def test_real_truck_lane_change_follows_successor_lane_without_physics_violation(real_scene_0061):
    source, adapter = real_scene_0061
    model = scene_model(source, load_map(adapter, source))
    truck = model.agents[model.index["truck_138"]]
    parsed, _, _ = parse_event(model, {"actor_id": truck.actor_id, "t0_s": 0.0,
                                        "kind": "lane_change", "direction": "left", "duration_s": 4.0,
                                        "react": True, "reaction_s": 1.0})
    outcome = simulate(model, parsed)
    result = assess(model, outcome)
    assert result.valid and result.reasons == []
    assert outcome.path_override.route is not None
    assert result.physics["truck_138"]["max_accel"] <= 4.0
    assert result.physics["truck_138"]["max_decel"] <= 5.2
