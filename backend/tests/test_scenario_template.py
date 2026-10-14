import copy
import math
from pathlib import Path

import pytest
from lxml import etree

from topeye.scenario.map_context import build_map_context
from topeye.scenario.models import ScenarioError
from topeye.scenario.template import check_template, compile_template
from topeye.scenario.xosc_import import validate_xosc


def curved_source():
    """Ego drives 120 m along a gentle left curve on a wide drivable area with walkways on both sides."""
    samples = []
    for i in range(41):
        t = i * 0.5
        a = t * 0.02
        samples.append({"t_s": t, "x_m": 300 * math.sin(a), "y_m": 300 * (1 - math.cos(a)), "z_m": 0, "yaw_rad": a})
    return {
        "id": "source",
        "mode": "source",
        "source": {"scene": "scene-curve", "origin_global_m": [0, 0, 0], "dataset_version": "v1.0-mini", "bounds_m": [-80, -80, 260, 200]},
        "actors": [{"id": "ego", "role": "ego", "category": "vehicle.car", "length_m": 4.5, "width_m": 1.8, "height_m": 1.6, "samples": samples}],
        "environment": {
            "polygons": [
                {"kind": "drivable_area", "outer": [[-80, -80], [260, -80], [260, 200], [-80, 200]], "holes": []},
            ],
            "buildings": [],
            "trees": [],
            "poles": [],
        },
    }


def actor(aid, role="traffic", kind="car", start=(0, 0, 0), route=(), speed=(10, 10, 0), delay=0, size=(4.5, 1.8, 1.5)):
    return {
        "id": aid, "role": role, "kind": kind, "length_m": size[0], "width_m": size[1], "height_m": size[2],
        "start": {"x_m": start[0], "y_m": start[1], "yaw_deg": start[2]},
        "route": [{"x_m": x, "y_m": y} for x, y in route],
        "speed": {"initial_mps": speed[0], "target_mps": speed[1], "accel_mps2": speed[2]},
        "start_delay_s": delay,
    }


def template(actors, events=(), duration=10, hz=10, placement=None):
    return {
        "profile": "topeye-scenario-template-v1", "name": "Dừng khẩn cấp / test", "description": "", "tags": [],
        "scenario_type": "emergency_stop", "params": {}, "customized": False,
        "map": {"scene": "scene-curve", "placement": placement or {"start_m": 0, "lateral_m": 0}, "duration_s": duration, "sample_hz": hz},
        "environment": {"weather_preset": "ClearNoon"},
        "actors": list(actors), "events": list(events),
        "expect": {"min_ttc_s": 1.5, "min_gap_m": 2, "no_contact": True},
        "provenance": {"mode": "template", "created_at": "2026-10-13T00:00:00Z"},
    }


def compiled(t):
    source = curved_source()
    context = build_map_context(source)
    xml, name, _ = compile_template(t, source, context)
    return validate_xosc(xml, context), xml, name


def test_emergency_stop_follows_source_path_and_brakes():
    t = template([
        actor("ego", "ego", route=[(150, 0)], speed=(13.9, 13.9, 0)),
        actor("lead", start=(24.5, 0, 0), route=[(200, 0)], speed=(13.9, 13.9, 0)),
    ], [{"id": "b", "type": "hard_brake", "actor": "lead", "at_s": 4, "params": {"decel_mps2": 6}}], duration=12)
    imported, xml, name = compiled(t)
    assert name == "Dừng_khẩn_cấp_test.xosc"
    assert len(etree.fromstring(xml).findall(".//Polyline")) == 2
    lead = next(a for a in imported["actors"] if a["id"] == "lead")["reference_samples"]
    assert len(lead) == 121 and lead[-1]["t_s"] == 12
    # Brakes to a stop after 4 s + 13.9/6 s, then stands still.
    tail = lead[-30:]
    assert max(math.hypot(b["x_m"] - a["x_m"], b["y_m"] - a["y_m"]) for a, b in zip(tail, tail[1:])) < 1e-6
    ego = next(a for a in imported["actors"] if a["id"] == "ego")["reference_samples"]
    # Ego follows the curved source path: heading grows like the source (0.02 rad/s at ~10 m/s on R=300 m).
    assert ego[0]["x_m"] == pytest.approx(0, abs=1e-6) and ego[-1]["yaw_rad"] > 0.3


def test_cut_in_lane_change_and_delayed_pedestrian_ramp_pass_dynamic_limits():
    t = template([
        actor("ego", "ego", route=[(150, 0)], speed=(16.7, 16.7, 0)),
        actor("cutter", start=(20, 3.5, 0), route=[(200, 3.5)], speed=(13.9, 13.9, 0)),
        actor("ped", kind="pedestrian", start=(60, -6, 90), route=[(60, 6)], speed=(1.4, 1.4, 0), delay=2, size=(0.5, 0.5, 1.75)),
    ], [{"id": "c", "type": "lane_change", "actor": "cutter", "at_s": 3, "params": {"lateral_m": -3.5, "duration_s": 2}}], duration=10)
    imported, _, _ = compiled(t)
    cutter = next(a for a in imported["actors"] if a["id"] == "cutter")["reference_samples"]
    ped = next(a for a in imported["actors"] if a["id"] == "ped")
    assert ped["category"] == "human.pedestrian"
    assert ped["reference_samples"][10]["x_m"] == ped["reference_samples"][0]["x_m"]  # waits 2 s
    # Source path is a circle (center (0, 300), R 300): the left lane is R 296.5; the cut-in ends in the ego lane.
    radius = [math.hypot(r["x_m"], r["y_m"] - 300) for r in cutter]
    assert radius[0] == pytest.approx(296.5, abs=0.05) and radius[60] == pytest.approx(300, abs=0.05)  # t=6 s, still on the measured part


def test_left_turn_corners_are_smoothed_and_stationary_actor_keeps_heading():
    t = template([
        actor("ego", "ego", route=[(22, 0), (30, 1.75), (33, 10), (33, 40)], speed=(6.9, 6.9, 0)),
        actor("parked", start=(15, -3.5, 0), speed=(0, 0, 0)),
    ], duration=8)
    imported, _, _ = compiled(t)
    parked = next(a for a in imported["actors"] if a["id"] == "parked")["reference_samples"]
    assert len({(r["x_m"], r["y_m"], r["yaw_rad"]) for r in parked}) == 1


def test_free_drive_single_actor_and_placement_shift():
    base, _, _ = compiled(template([actor("ego", "ego", route=[(80, 0)], speed=(8, 8, 0))]))
    moved, _, _ = compiled(template([actor("ego", "ego", route=[(80, 0)], speed=(8, 8, 0))], placement={"start_m": 30, "lateral_m": 0}))
    a, b = base["actors"][0]["reference_samples"][0], moved["actors"][0]["reference_samples"][0]
    assert math.hypot(b["x_m"] - a["x_m"], b["y_m"] - a["y_m"]) == pytest.approx(30, abs=0.3)


@pytest.mark.parametrize(
    ("mutate", "code", "text"),
    [
        (lambda t: t["actors"].append(copy.deepcopy(t["actors"][0])), "INVALID_TEMPLATE", "không trùng"),
        (lambda t: t["actors"][0].update(id="1ego"), "INVALID_TEMPLATE", "bắt đầu bằng chữ"),
        (lambda t: t["actors"][0]["speed"].update(target_mps=80), "INVALID_TEMPLATE", "vận tốc đích"),
        (lambda t: t["actors"][0].update(route=[]), "INVALID_TEMPLATE", "chưa có điểm lộ trình"),
        (lambda t: t["map"].update(duration_s=90), "INVALID_TEMPLATE", "Thời lượng"),
        (lambda t: t["map"].update(sample_hz=2.5), "INVALID_TEMPLATE", "số nguyên"),
        (lambda t: t.update(profile="x"), "INVALID_TEMPLATE", "template"),
        (lambda t: t["actors"][0].update(length_m=True), "INVALID_TEMPLATE", "phải là số"),
        (lambda t: t["actors"][0].update(role="traffic"), "INVALID_TEMPLATE", "đúng một xe ego"),
    ],
)
def test_rejections(mutate, code, text):
    t = template([actor("ego", "ego", route=[(150, 0)], speed=(10, 10, 0))])
    mutate(t)
    with pytest.raises(ScenarioError) as err:
        compiled(t)
    assert err.value.code == code and text in str(err.value)


def test_map_rejection_names_actor_and_time():
    # 60 s at 10 m/s leaves the scene envelope; the backend gate rejects it with a located hint.
    t = template([actor("ego", "ego", route=[(450, 0)], speed=(10, 10, 0))], duration=60, hz=2)
    with pytest.raises(ScenarioError) as err:
        compiled(t)
    assert err.value.code == "OUTSIDE_MAP"
    assert "“ego” lúc" in str(err.value) and "ra ngoài vùng map" in str(err.value)


def test_auto_placement_moves_past_an_obstacle_and_reports_where():
    source = curved_source()
    source["environment"]["trees"] = [{"x": 1.0, "y": 0.0}]  # right on the ego start
    context = build_map_context(source)
    t = template([actor("ego", "ego", route=[(60, 0)], speed=(5, 5, 0))], duration=6)
    with pytest.raises(ScenarioError) as err:
        compile_template(t, source, context)
    assert err.value.code == "STATIC_OBSTACLE" and "“ego” lúc 0.0 s" in str(err.value)
    t["map"]["placement"] = {"start_m": 0, "lateral_m": 0, "auto": True}
    xml, _, placement = compile_template(t, source, context)
    assert placement["auto"] and placement["start_m"] in (5.0, -5.0)
    validate_xosc(xml, context)


def test_auto_placement_explains_when_nothing_fits():
    t = template([actor("ego", "ego", route=[(450, 0)], speed=(30, 30, 0))], duration=60, hz=2, placement={"start_m": 0, "lateral_m": 0, "auto": True})
    with pytest.raises(ScenarioError) as err:
        compiled(t)
    assert "Không tìm được vị trí phù hợp" in str(err.value) and "ra ngoài vùng map" in str(err.value)


def test_check_template_ignores_presentation_fields_and_sorts_events():
    t = template([actor("ego", "ego", route=[(50, 0)])], [
        {"id": "b", "type": "stop", "actor": "ego", "at_s": 5, "params": {"decel_mps2": 3}},
        {"id": "a", "type": "accelerate", "actor": "ego", "at_s": 1, "params": {"target_mps": 12, "accel_mps2": 1}},
    ])
    checked = check_template(t)
    assert [e["type"] for e in checked["actors"][0]["events"]] == ["accelerate", "stop"]


def test_service_imports_template_as_a_named_package(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from topeye.scenario import worker
    from topeye.scenario.library import list_imported

    source = curved_source()
    source["id"] = "b" * 32
    adapter = SimpleNamespace(root=tmp_path / "dataset", version="v1.0-mini")
    monkeypatch.setattr(worker, "create_adapter", lambda root, version: adapter)
    monkeypatch.setattr(worker, "source_scene", lambda adapter, scene, progress: copy.deepcopy(source))
    params = {"dataset": str(adapter.root), "workspace": str(tmp_path / "workspace"), "scene": "scene-curve"}
    api = worker.Service()
    loaded = api.call("source_scene", params)
    t = template([actor("ego", "ego", route=[(100, 0)], speed=(8, 8, 0)), actor("lead", start=(20, 0, 0), route=[(150, 0)], speed=(8, 8, 0))])
    scenario = api.call("import_template", {**params, "source_id": loaded["id"], "template": t})
    assert scenario["mode"] == "imported" and len(scenario["actors"]) == 2
    entries = list_imported(params["workspace"])
    assert [e["name"] for e in entries] == ["Dừng_khẩn_cấp_test.xosc"]
    assert entries[0]["has_template"] is True
    from topeye.scenario.library import read_imported

    stored = read_imported(params["workspace"], scenario["id"])["template"]
    assert stored["actors"] == t["actors"] and stored["map"]["placement"] == {"start_m": 0, "lateral_m": 0, "auto": False, "mirror": False}
    # Editing reopens it as a template; the hashed package payloads are untouched by the sidecar.
    assert (Path(params["workspace"]) / scenario["id"] / "template.json").is_file()
    api.call("open_imported", {**params, "source_id": loaded["id"], "package_path": entries[0]["package_path"]})
    t["actors"][1]["id"] = "ego"
    with pytest.raises(ScenarioError) as err:
        api.call("import_template", {**params, "source_id": loaded["id"], "template": t})
    assert err.value.code == "INVALID_TEMPLATE"
    assert len(list_imported(params["workspace"])) == 1


def test_auto_placement_mirrors_for_left_hand_traffic():
    # Straight road whose only same-direction second lane is on ego's right (e.g. Singapore).
    source = curved_source()
    source["actors"][0]["samples"] = [{"t_s": i * 0.5, "x_m": i * 5.0, "y_m": 0, "z_m": 0, "yaw_rad": 0} for i in range(41)]
    source["environment"]["polygons"] = [{"kind": "drivable_area", "outer": [[-80, -6], [260, -6], [260, 2], [-80, 2]], "holes": []}]
    context = build_map_context(source)
    t = template([actor("ego", "ego", route=[(150, 0)], speed=(10, 10, 0)), actor("cutter", start=(15, 3.5, 0), route=[(200, 3.5)], speed=(9, 9, 0))],
                 [{"id": "c", "type": "lane_change", "actor": "cutter", "at_s": 2, "params": {"lateral_m": -3.5, "duration_s": 2}}], duration=8)
    with pytest.raises(ScenarioError) as err:
        compile_template(t, source, context)
    assert err.value.code == "OUTSIDE_SURFACE" and "“cutter” lúc 0.0 s" in str(err.value)
    t["map"]["placement"] = {"start_m": 0, "lateral_m": 0, "auto": True, "mirror": False}
    xml, _, placement = compile_template(t, source, context)
    assert placement == {"start_m": 0, "lateral_m": 0, "auto": True, "mirror": True}
    cutter = next(a for a in validate_xosc(xml, context)["actors"] if a["id"] == "cutter")["reference_samples"]
    assert cutter[0]["y_m"] == pytest.approx(-3.5, abs=1e-6) and cutter[-1]["y_m"] == pytest.approx(0, abs=1e-6)


def test_template_fit_probe_reports_without_persisting(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from topeye.scenario import worker

    good = curved_source()
    bad_map = curved_source()
    bad_map["environment"]["polygons"] = [{"kind": "drivable_area", "outer": [[0, 0], [10, 10], [10, 0], [0, 10]], "holes": []}]
    sources = {"scene-good": good, "scene-bad": bad_map}
    loads = []
    adapter = SimpleNamespace(root=tmp_path / "dataset", version="v1.0-mini")
    monkeypatch.setattr(worker, "create_adapter", lambda root, version: adapter)
    monkeypatch.setattr(worker, "source_scene", lambda adapter, scene, progress: loads.append(scene) or copy.deepcopy(sources[scene]))
    params = {"dataset": str(adapter.root), "workspace": str(tmp_path / "workspace")}
    api = worker.Service()
    t = template([actor("ego", "ego", route=[(100, 0)], speed=(8, 8, 0))], placement={"start_m": 0, "lateral_m": 0, "auto": True})
    ok = api.call("template_fit", {**params, "scene": "scene-good", "template": t})
    assert ok == {"scene": "scene-good", "ok": True, "placement": {"start_m": 0, "lateral_m": 0, "auto": True, "mirror": False}}
    no = api.call("template_fit", {**params, "scene": "scene-bad", "template": t})
    assert no["ok"] is False and no["code"] == "INVALID_MAP_GEOMETRY"
    assert api.call("template_fit", {**params, "scene": "scene-good", "template": t}) == ok
    assert loads == ["scene-good", "scene-bad"]  # cached source and result
    assert not (tmp_path / "workspace").exists()  # read-only: no package, no recovery
    # The probe shares the cache with source_scene but never hands out the cached object.
    loaded = api.call("source_scene", {**params, "scene": "scene-good"})
    loaded["actors"].clear()
    assert api.cached_source("scene-good", lambda *a: None)["actors"]


def test_ego_hard_brake_in_pedestrian_crossing_stops_ego_and_pedestrian_cannot_hard_brake():
    """Regression (owner 2026-10-13): a hard brake added to the crossing scenario must slow the actor it names."""
    ped = actor("ped", kind="pedestrian", start=(60, -5, 90), route=[(60, 5)], speed=(1.4, 1.4, 0), delay=2, size=(0.5, 0.5, 1.75))
    t = template([actor("ego", "ego", route=[(150, 0)], speed=(13.9, 13.9, 0)), ped],
                 [{"id": "e", "type": "hard_brake", "actor": "ego", "at_s": 2, "params": {"decel_mps2": 6}}], duration=7)
    imported, _, _ = compiled(t)
    ego = next(a for a in imported["actors"] if a["id"] == "ego")["reference_samples"]
    speed = [math.hypot(b["x_m"] - a["x_m"], b["y_m"] - a["y_m"]) * 10 for a, b in zip(ego, ego[1:])]
    assert speed[5] == pytest.approx(13.9, abs=0.05)  # before the brake
    assert max(speed[50:]) < 1e-6  # stopped: 13.9 / 6 ≈ 2.3 s after t = 2 s
    t["events"][0]["actor"] = "ped"
    with pytest.raises(ScenarioError, match="người đi bộ không “phanh gấp”"):
        compiled(t)
