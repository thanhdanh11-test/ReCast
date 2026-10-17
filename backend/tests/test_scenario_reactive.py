"""plan45 P01: reactive scenarios — a vehicle ahead brakes, the vehicles behind react (SPEC-P01 §6)."""

import copy
import csv
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from test_scenario_map_context import source_fixture

from topeye.scenario import reactive
from topeye.scenario.map_context import build_map_context
from topeye.scenario.models import ScenarioError
from topeye.scenario.reactive import DT, GROUPS, Event, candidates, run_event, scene_model, simulate
from topeye.scenario.real2sim import parse_package
from topeye.scenario.worker import Service

NUSC = Path(os.environ.get("TOPEYE_NUSC_ROOT", Path.home() / "cvat-day2/tools/traffic_pipeline/data/nuscenes"))


def actor(identity, x0, speed, duration, role="traffic", category="vehicle.car", y=0.0, dt=0.5, size=(4.5, 1.8)):
    times = np.arange(0.0, duration + 1e-9, dt)
    return {
        "id": identity,
        "role": role,
        "category": category,
        "length_m": size[0],
        "width_m": size[1],
        "height_m": 1.6,
        "attributes": [],
        "samples": [{"t_s": float(t), "x_m": x0 + speed * t, "y_m": y, "z_m": 0.0, "yaw_rad": 0.0} for t in times],
    }


def platoon(duration=20.0, order=None):
    """Straight road: lead (x=40) <- mid (x=20) <- ego (x=0), all at 10 m/s; a pedestrian stands aside."""
    source = source_fixture()
    source["interval_s"] = [0, duration]
    side = [
        actor("lead-token", 40.0, 10.0, duration),
        actor("mid-token", 20.0, 10.0, duration),
        actor("ped-token", 60.0, 0.0, duration, category="human.pedestrian.adult", y=25.0, size=(0.6, 0.6)),
    ]
    if order:
        side = [side[i] for i in order]
    source["actors"] = [actor("ego", 0.0, 10.0, duration, role="ego", dt=0.05), *side]
    source["environment"]["polygons"][0]["outer"] = [[-50, -40], [400, -40], [400, 40], [-50, 40]]
    return source


def event(model, name, **kw):
    return {"actor_id": model.agents[model.index[name]].actor_id, "t0_s": 2.0, "decel_mps2": 4.0, "target": "stop",
            "dwell_s": 3.0, "react": True, "reaction_s": 1.0, **kw}


@pytest.fixture(scope="module")
def model():
    return scene_model(platoon())


def test_ego_box_is_ahead_of_ego_pose(model):
    """The ego samples are the ego pose (rear axle): the engine's ego box sits EGO_BBOX_CENTER_X ahead with EGO_SIZE,
    while the package keeps the app's poses and size (B4)."""
    ego = model.agents[0]
    assert (ego.length, ego.width, ego.centre_x) == (4.084, 1.730, 1.39)
    pose_x = np.interp(model.t, model.tracks[0].t, model.tracks[0].xy[:, 0])  # 2 Hz keyframe ego (H07)
    assert np.allclose(model.X[:, 0] - pose_x, 1.39, atol=1e-9)
    files = run_event(model, event(model, "car_001", react=False))["files"]
    rows = [r for r in csv.DictReader(io.StringIO(files["trajectories.csv"].decode())) if r["object_id"] == "ego"]
    assert float(rows[0]["x_m"]) == 0.0 and float(rows[0]["length_m"]) == 4.5
    xml = files["car_001_t2.0_stop_a4.xosc"].decode()
    assert 'name="ego"' in xml and 'width="1.8000" length="4.5000"' in xml


def test_names_follow_source_order(model):
    assert [a.name for a in model.agents] == ["ego", "car_001", "car_002", "pedestrian_003"]
    assert model.agents[3].static and model.agents[2].T == pytest.approx(1.55, abs=0.01)


def test_empty_event_replays_pilot_exactly(model):
    """B1: nothing happens -> every track is its pilot motion (the ego: its recording)."""
    out = simulate(model, None)
    assert not out.changed.any() and not out.A.any()
    assert np.array_equal(out.S, model.S, equal_nan=True) and np.array_equal(out.V, model.V, equal_nan=True)
    for i, a in enumerate(model.agents):
        nominal = model.nominal[i]
        ok = model.present[:, i]
        x = np.interp(model.t[ok], nominal.t, nominal.xy[:, 0]) if len(nominal.t) > 1 else nominal.xy[0, 0]
        x = x + a.centre_x * np.cos(model.H[ok, i])  # the box centre (the ego: ahead of its pose)
        assert np.abs(model.X[ok, i] - x).max() <= 1e-9, a.name
    # in a package, an object the event does not touch keeps its pilot poses at its source timestamps
    files = run_event(model, event(model, "car_001", react=False))["files"]  # baseline: nobody reacts
    rows = [r for r in csv.DictReader(io.StringIO(files["trajectories.csv"].decode())) if r["object_id"] == "ego"]
    ego = model.tracks[0]
    assert len(rows) == len(ego.t)
    assert max(abs(float(r["x_m"]) - x) for r, x in zip(rows, ego.xy[:, 0])) <= 1e-4


def test_follower_stops_at_standstill_gap():
    model = scene_model(platoon(duration=30.0))
    out = simulate(model, Event("car_001", 2.0, 4.0, "stop", 10.0))
    lead, mid = model.index["car_001"], model.index["car_002"]
    k = round(out.event_phases["dwell_end"] / DT) - 1
    gap = (out.S[k, lead] - out.S[k, mid]) + 20.0 - 4.5  # paths start 20 m apart, bumper to bumper
    assert out.V[k, mid] == pytest.approx(0.0, abs=0.05)
    assert gap == pytest.approx(model.agents[mid].s0, abs=0.05)


def test_reaction_time(model):
    for reaction in (0.5, 1.5):
        out = simulate(model, Event("car_001", 2.0, 4.0, "stop", 3.0), reaction=reaction)
        assert out.driving_from["car_002"] - out.stimulus["car_002"] == pytest.approx(reaction, abs=DT + 1e-9)


def test_stop_inside_one_step_no_overshoot_no_reverse(model):
    s, v = reactive.integrate(10.0, 0.2, -8.0)
    assert v == 0.0 and s == pytest.approx(10.0 + 0.2**2 / 16)
    assert reactive.integrate(10.0, 0.0, -8.0) == (10.0, 0.0)
    out = simulate(model, Event("car_001", 2.0, 8.0, "stop", 3.0))
    for i in np.flatnonzero(out.changed):
        s, v = out.S[:, i], out.V[:, i]
        ok = ~np.isnan(s)
        assert (v[ok] >= 0).all() and (np.diff(s[ok]) >= -1e-12).all()


def test_order_of_agents_does_not_matter(model):
    other = scene_model(platoon(order=[2, 1, 0]))

    def by_actor(m):
        out = simulate(m, Event(m.agents[m.by_actor["lead-token"]].name, 2.0, 6.0, "stop", 3.0))
        X, Y, _ = reactive.centres(m, out)
        return {a.actor_id: (X[:, i], Y[:, i]) for i, a in enumerate(m.agents)}

    a, b = by_actor(model), by_actor(other)
    for key in a:
        assert np.allclose(a[key][0], b[key][0], equal_nan=True, atol=1e-9)
        assert np.allclose(a[key][1], b[key][1], equal_nan=True, atol=1e-9)


def test_package_admitted_by_parse_package(model):
    source = platoon()
    result = run_event(model, event(model, "car_001", decel_mps2=8.0))
    assert set(result["files"]) == {"car_001_t2.0_stop_a8.xosc", "report.json", "trajectories.csv"}
    imported = parse_package(result["files"], build_map_context(source))
    assert not [n for n in imported["import"]["diagnostics"] if n["code"] == "REPORT_FIELD"]
    assert len(imported["actors"]) == sum(bool(a["samples"]) for a in source["actors"])
    report = imported["report"]
    assert report["valid"] is result["valid"] and report["group"] == result["group"] in GROUPS
    assert report["event"] == {"actor": "car_001", "t0": 2.0, "decel": 8.0, "target": "stop", "dwell": 3.0}
    assert report["source"] == "topeye-reactive-v1" and report["esmini"] is None
    assert report["drivers"]["thresholds"]["jerk_brake"] == 10 and "car_002" in report["reacted"]
    assert set(report["drivers"]["per_vehicle"]) == {"ego", "car_001", "car_002"}
    raw = json.loads(result["files"]["report.json"])
    assert raw["run"]["config"] == {"dt": 0.05, "road": "none"}


def test_unsupported_case_is_saved_invalid_with_reason():
    """B6: delayed vehicles meet a pedestrian who crosses after they passed in the recording -> still a package,
    valid=false with an [unsupported] reason."""
    source = platoon()
    walker = actor("walker", 100.0, 0.0, 20.0, category="human.pedestrian.adult", y=-6.0, size=(0.6, 0.6))
    for r in walker["samples"]:
        r["y_m"] = -6.0 + max(0.0, r["t_s"] - 11.0) * 1.33
    source["actors"].append(walker)
    m = scene_model(source)
    result = run_event(m, event(m, "car_001", decel_mps2=4.0))
    assert result["valid"] is False and any(r.startswith("[unsupported]") for r in result["reasons"])
    report = json.loads(result["files"]["report.json"])
    assert report["valid"] is False and report["collisions"]


@pytest.mark.parametrize(
    "change, code",
    [
        ({"actor_id": "nope"}, "EVENT_NOT_ALLOWED"),
        ({"actor_id": "ped-token"}, "EVENT_NOT_ALLOWED"),
        ({"actor_id": "ego"}, "EVENT_NOT_ALLOWED"),
        ({"t0_s": 19.0}, "EVENT_NOT_ALLOWED"),
        ({"decel_mps2": 9.0}, "EVENT_NOT_ALLOWED"),
        ({"decel_mps2": 0.0}, "EVENT_NOT_ALLOWED"),
        ({"dwell_s": 11.0}, "EVENT_NOT_ALLOWED"),
        ({"reaction_s": 0.1}, "EVENT_NOT_ALLOWED"),
        ({"target": "crawl"}, "INVALID_INPUT"),
        ({"t0_s": float("nan")}, "INVALID_INPUT"),
        ({"react": 1}, "INVALID_INPUT"),
        ({"dwell_s": None}, "INVALID_INPUT"),
    ],
)
def test_event_errors(model, change, code):
    with pytest.raises(ScenarioError) as exc:
        run_event(model, event(model, "car_001", **change))
    assert exc.value.code == code


def test_candidates_shape(model):
    out = candidates(model)
    assert out["scene"] == "scene-test" and out["duration_s"] == 20.0 and out["label_problems"] == []
    by = {c["name"]: c for c in out["candidates"]}
    assert set(by) == {"car_001", "car_002"}  # the ego never brakes; a pedestrian is not a candidate
    lead = by["car_001"]
    assert lead["actor_id"] == "lead-token" and lead["max_decel_mps2"] == 8.0 and lead["followers"] == ["car_002"]
    assert lead["windows"][0][0] == 0.0 and all(lo <= hi for lo, hi in lead["windows"])


@pytest.fixture(scope="module")
def scene_0061():
    if not (NUSC / "v1.0-mini").is_dir():
        pytest.skip("nuScenes v1.0-mini not on this machine (TOPEYE_NUSC_ROOT)")
    from topeye.scenario.dataset import create_adapter
    from topeye.scenario.source_scene import source_scene

    source = source_scene(create_adapter(NUSC, "v1.0-mini"), "scene-0061")
    return source, scene_model(source)


def test_real_ego_box_offset_and_car_154_half(scene_0061):
    """R04: with the ego box at the ego pose, the delayed ego wrongly met pedestrian_091 ([unsupported]);
    replay-forge finds this event valid, group mild."""
    _, model = scene_0061
    ego = model.tracks[0]
    ok = model.present[:, 0]
    pose = [np.interp(model.t[ok], ego.t, ego.xy[:, k]) for k in (0, 1)]  # ego pose on the grid
    offset = np.hypot(model.X[ok, 0] - pose[0], model.Y[ok, 0] - pose[1])
    assert np.allclose(offset, 1.39, atol=1e-6)
    car = next(c for c in candidates(model)["candidates"] if c["name"] == "car_154")
    result = run_event(model, {"actor_id": car["actor_id"], "t0_s": 0.0, "decel_mps2": 4.0, "target": "half",
                               "dwell_s": 0.0, "react": True, "reaction_s": 1.0})
    assert (result["valid"], result["group"], result["reasons"]) == (True, "mild", [])


def test_real_scene_0061(scene_0061):
    source, model = scene_0061
    out = candidates(model)
    assert len(out["candidates"]) >= 1
    first = out["candidates"][0]
    result = run_event(model, {"actor_id": first["actor_id"], "t0_s": first["windows"][0][0], "decel_mps2": 4.0,
                               "target": "stop", "dwell_s": 0.0, "react": True, "reaction_s": 1.0})
    imported = parse_package(result["files"], build_map_context(source))
    assert isinstance(imported["report"]["valid"], bool) and imported["report"]["group"] in GROUPS
    assert len(imported["actors"]) == len(source["actors"])


@pytest.fixture
def service(tmp_path, monkeypatch):
    from topeye.scenario import worker

    source = platoon()
    adapter = SimpleNamespace(root=tmp_path / "dataset", version="v1.0-mini")
    monkeypatch.setattr(worker, "create_adapter", lambda root, version: adapter)
    monkeypatch.setattr(worker, "source_scene", lambda adapter, scene, progress: copy.deepcopy(source))
    return Service(), {"dataset": str(adapter.root), "workspace": str(tmp_path / "workspace"), "scene": "scene-test"}


def test_worker_ops(service):
    api, params = service
    source = api.call("source_scene", params)
    found = api.call("reactive_candidates", {**params, "source_id": source["id"]})
    lead = next(c for c in found["candidates"] if c["name"] == "car_001")
    ev = {"actor_id": lead["actor_id"], "t0_s": 2.0, "decel_mps2": 4.0, "target": "half", "dwell_s": 0.0,
          "react": True, "reaction_s": 1.0}
    scenario = api.call("import_reactive", {**params, "source_id": source["id"], "event": ev})
    assert scenario["kind"] == "real2sim" and scenario["report"]["event"]["actor"] == "car_001"
    listed = api.call("list_imported", params)
    assert [e["kind"] for e in listed] == ["real2sim"]
    manifest = json.loads((Path(params["workspace"]) / scenario["id"] / "import/manifest.json").read_text())
    assert manifest["display_name"] == "car_001_t2.0_half_a4"
    with pytest.raises(ScenarioError) as exc:
        api.call("import_reactive", {**params, "source_id": "gone", "event": ev})
    assert exc.value.code == "STALE_CONTEXT"
    with pytest.raises(ScenarioError) as exc:
        api.call("import_reactive", {**params, "source_id": source["id"], "event": {**ev, "decel_mps2": 9.0}})
    assert exc.value.code == "EVENT_NOT_ALLOWED"


# ---------------------------------------------------------------------------- plan46 WP1 (SPEC-WP1 tests a-g)
def _car_154_half(model):
    car = next(c for c in candidates(model)["candidates"] if c["name"] == "car_154")
    return {"actor_id": car["actor_id"], "t0_s": 0.0, "decel_mps2": 4.0, "target": "half", "dwell_s": 0.0,
            "react": True, "reaction_s": 1.0}


def test_detail_baseline_collides_pilot_mild(scene_0061):
    """(a) the same event without reactions: the ego runs into car_154; with reactions: mild (measured 2026-10-15)."""
    _, model = scene_0061
    detail = json.loads(run_event(model, _car_154_half(model))["files"]["report.json"])["topeye"]
    baseline, pilot = detail["comparison"]["baseline"], detail["comparison"]["pilot"]
    assert (baseline["valid"], baseline["group"]) == (True, "collision")
    assert (pilot["valid"], pilot["group"]) == (True, "mild")
    assert ["car_154", "ego"] == sorted(baseline["collisions"][0][:2]) and baseline["collisions"][0][3] == "ego"
    assert detail["version"] == "topeye-reactive-v2" and detail["summary"].startswith("Dùng được · phanh nhẹ là đủ")


def test_detail_checks_series_markers_vehicles(model):
    """(b) 7 checks in CheckId order, esmini not checked; (c) every series as long as t, no NaN."""
    report = json.loads(run_event(model, event(model, "car_001", decel_mps2=8.0))["files"]["report.json"])
    detail = report["topeye"]
    assert [c["id"] for c in detail["checks"]] == list(reactive.CHECK_IDS) == \
        ["esmini", "physics", "label", "collision", "tailgate", "merge", "appear"]
    esmini = detail["checks"][0]
    assert esmini["passed"] is None and esmini["value"] is None
    for c in detail["checks"][1:]:
        assert isinstance(c["passed"], bool) and set(c) == {"id", "passed", "value", "threshold", "unit", "t", "detail"}
    # passed mirrors the package's own verdict
    assert all(c["passed"] for c in detail["checks"][1:]) is report["valid"]
    physics = detail["checks"][1]
    assert physics["unit"] == "m/s²" and physics["value"] == pytest.approx(8.0, abs=0.3) and physics["threshold"] == 8.2
    series = detail["series"]
    n = len(series["t"])
    assert n == len(np.arange(0, model.K, 2)) and series["t"][1] == pytest.approx(0.1)
    assert set(series["vehicles"]) == {"ego", "car_001", "car_002"}
    lengths = {len(v) for s in series["vehicles"].values() for v in s.values()} | {len(v) for v in series["ego"].values()}
    assert lengths == {n}
    values = [x for s in series["vehicles"].values() for v in s.values() for x in v] + \
        [x for v in series["ego"].values() for x in v]
    assert all(x is None or np.isfinite(x) for x in values) and any(x is None for x in series["ego"]["ttc"])
    kinds = [m["kind"] for m in detail["markers"]]
    assert kinds[:2] == ["brake_start", "brake_full"] and {"stopped", "resume", "reacts"} <= set(kinds)
    at = {m["kind"]: m["t"] for m in detail["markers"] if m["agent"] == "car_001"}
    assert at["stopped"] < at["resume"] == pytest.approx(at["stopped"] + 3.0 + DT, abs=DT + 1e-9)  # dwell 3 s
    assert [m["t"] for m in detail["markers"]] == sorted(m["t"] for m in detail["markers"])
    vehicles = detail["vehicles"]
    assert {k: v["role"] for k, v in vehicles.items()} == {"ego": "ego", "car_001": "event", "car_002": "reacted"}
    assert vehicles["car_002"]["T_source"] == "measured" and vehicles["car_001"]["decel_used"] == 8.0
    assert vehicles["car_002"]["modes"][0][2] == "nominal" and {m[2] for m in vehicles["car_002"]["modes"]} >= {"waiting", "driving"}
    assert detail["trigger_note"].startswith("Kích hoạt theo thời gian")


def test_detail_invalid_summary_and_checks():
    """Invalid package: the summary gives the reason in plain words with a hint; the failing check says so."""
    source = platoon()
    walker = actor("walker", 100.0, 0.0, 20.0, category="human.pedestrian.adult", y=-6.0, size=(0.6, 0.6))
    for r in walker["samples"]:
        r["y_m"] = -6.0 + max(0.0, r["t_s"] - 11.0) * 1.33
    source["actors"].append(walker)
    m = scene_model(source)
    detail = json.loads(run_event(m, event(m, "car_001", decel_mps2=4.0))["files"]["report.json"])["topeye"]
    assert detail["summary"].startswith("Chưa mô phỏng được:") and detail["summary"].endswith("Thử lúc khác hoặc xe khác.")
    merge = next(c for c in detail["checks"] if c["id"] == "merge")
    assert merge["passed"] is False and merge["t"] is not None and "người đi bộ" in merge["detail"]
    assert detail["comparison"]["pilot"]["group"] is None and detail["comparison"]["pilot"]["reasons"]


def test_windows_by_event_fit(model, scene_0061):
    """(d) every start time (0.5 s steps) inside a window of a "<target>:<dwell>:<decel>" key fits that event."""
    for m in (model, scene_0061[1]):
        for c in candidates(m)["candidates"]:
            keys = c["windows_by_event"]
            decels = [d for d in reactive.WINDOW_DECELS if d <= c["max_decel_mps2"]]
            assert set(keys) == {f"{t}:{w:g}:{d:g}" for d in decels for t, w in reactive.WINDOW_EVENTS}
            for key, windows in keys.items():
                target, dwell, decel = key.split(":")
                for lo, hi in windows:
                    for t0 in np.arange(lo, hi + 1e-9, 0.5):
                        assert reactive.fits(m, Event(c["name"], round(float(t0), 2), float(decel), target, float(dwell))), key
                        assert any(a - 1e-9 <= t0 <= b + 1e-9 for a, b in c["windows"])
    assert candidates(model)["candidates"][0]["windows_by_event"]["stop:3:4"]


def test_sensitivity_runs(model, scene_0061):
    """(e) three runs, reaction 0.7 / 1.0 / 1.5 s, in that order; 1.0 matches the pilot of the package."""
    _, real = scene_0061
    ev = _car_154_half(real)
    out = reactive.sensitivity(real, ev)
    assert [r["reaction_s"] for r in out["runs"]] == [0.7, 1.0, 1.5]
    pilot = json.loads(run_event(real, ev)["files"]["report.json"])["topeye"]["comparison"]["pilot"]
    assert {k: out["runs"][1][k] for k in ("valid", "group", "reasons", "ego")} == \
        {k: pilot[k] for k in ("valid", "group", "reasons", "ego")}
    assert out["stable"] is (len({(r["valid"], r["group"]) for r in out["runs"]}) == 1)
    with pytest.raises(ScenarioError) as exc:
        reactive.sensitivity(model, event(model, "car_001", decel_mps2=9.0))
    assert exc.value.code == "EVENT_NOT_ALLOWED"


def test_read_report_forwards_topeye_block(model):
    from topeye.scenario.real2sim import read_report

    raw = run_event(model, event(model, "car_001"))["files"]["report.json"]
    notes = []
    assert isinstance(read_report(raw, notes)["topeye"], dict) and not notes
    team = json.loads(raw)
    del team["topeye"]  # a team real2sim package has no such block
    assert read_report(json.dumps(team).encode(), notes)["topeye"] is None
    team["topeye"] = [1]
    assert read_report(json.dumps(team).encode(), notes)["topeye"] is None


@pytest.fixture(scope="module")
def sweep_scenes(scene_0061):
    from topeye.scenario.dataset import create_adapter
    from topeye.scenario.source_scene import source_scene

    adapter = create_adapter(NUSC, "v1.0-mini")
    return {"scene-0061": scene_0061[1], **{s: scene_model(source_scene(adapter, s)) for s in ("scene-0757", "scene-0553")}}


def test_plan45_sweep_and_report_size(sweep_scenes):
    """(g) the plan45 sweep (every candidate x first start of each window x decel 2/4/6/8 x stop(dwell 3)/half,
    reacting) is still 39/100 valid; (f) on each scene, the report.json of the event that changes the most vehicles
    stays within 256 KiB."""
    from topeye.scenario.real2sim import LIMITS

    tried = valid = 0
    for model in sweep_scenes.values():
        widest = (-1, None)
        for c in candidates(model)["candidates"]:
            for lo, _ in c["windows"]:
                for decel in (2.0, 4.0, 6.0, 8.0):
                    for target, dwell in (("stop", 3.0), ("half", 0.0)):
                        ev = {"actor_id": c["actor_id"], "t0_s": lo, "decel_mps2": decel, "target": target,
                              "dwell_s": dwell, "react": True, "reaction_s": 1.0}
                        try:
                            parsed, react, reaction = reactive.parse_event(model, ev)
                        except ScenarioError as exc:
                            assert exc.code == "EVENT_NOT_ALLOWED"
                            continue
                        out = simulate(model, parsed, react=react, reaction=reaction)
                        tried += 1
                        valid += reactive.assess(model, out).valid
                        widest = max(widest, (int(out.changed.sum()), tuple(sorted(ev.items()))))
        report = run_event(model, dict(widest[1]))["files"]["report.json"]
        assert len(report) <= LIMITS["max_report_bytes"], model.name
    assert (tried, valid) == (100, 39)


def test_worker_sensitivity_op(service):
    api, params = service
    source = api.call("source_scene", params)
    lead = next(c for c in api.call("reactive_candidates", {**params, "source_id": source["id"]})["candidates"]
                if c["name"] == "car_001")
    assert "windows_by_event" in lead
    ev = {"actor_id": lead["actor_id"], "t0_s": 2.0, "decel_mps2": 4.0, "target": "stop", "dwell_s": 3.0,
          "react": False, "reaction_s": 1.0}
    out = api.call("reactive_sensitivity", {**params, "source_id": source["id"], "event": ev})
    assert [r["reaction_s"] for r in out["runs"]] == [0.7, 1.0, 1.5] and isinstance(out["stable"], bool)
    assert api.call("list_imported", params) == []  # nothing saved
    scenario = api.call("import_reactive", {**params, "source_id": source["id"], "event": ev})
    assert scenario["report"]["topeye"]["comparison"]["baseline"]["valid"] is scenario["report"]["valid"]
    with pytest.raises(ScenarioError) as exc:
        api.call("reactive_sensitivity", {**params, "source_id": "gone", "event": ev})
    assert exc.value.code == "STALE_CONTEXT"


@pytest.fixture(scope="module")
def scene_1094():
    if not (NUSC / "v1.0-mini").is_dir():
        pytest.skip("nuScenes v1.0-mini not on this machine (TOPEYE_NUSC_ROOT)")
    from topeye.scenario.dataset import create_adapter
    from topeye.scenario.source_scene import source_scene

    return source_scene(create_adapter(NUSC, "v1.0-mini"), "scene-1094")


def _car_029_stop(model):
    car = model.agents[model.index["car_029"]]
    parsed, react, reaction = reactive.parse_event(model, {
        "actor_id": car.actor_id, "t0_s": 7.0, "decel_mps2": 2.0, "target": "stop", "dwell_s": 0.0, "react": True,
        "reaction_s": 1.0})
    outcome = simulate(model, parsed, react=react, reaction=reaction)
    result = reactive.assess(model, outcome)
    return result, {c["id"]: c for c in reactive.checks(model, outcome, result)}


def test_physics_over_limit_never_passes(scene_1094):
    """H07 (R06 phép phá 1): scene-1094 car_029@7 stop/2 on the dense (~20 Hz) ego had value 4.18 > 4.0 put down
    to the recorded label, yet physics.passed=true. Over the limit fails physics, the detail names condition 3."""
    tracks = reactive.source_tracks(scene_1094)
    dense = reactive.SceneModel("scene-1094", float(scene_1094["interval_s"][1]), tracks)
    result, by_id = _car_029_stop(dense)
    assert result.reasons == ["label_error"]
    physics = by_id["physics"]
    assert physics["value"] > physics["threshold"] and physics["passed"] is False
    assert "do nhãn gốc lỗi (điều kiện 3)" in physics["detail"] and by_id["label"]["passed"] is False


def test_engine_ego_is_keyframes_2hz(scene_1094):
    """H07 (plan46 decision 2026-10-15): the engine's ego is sampled at the annotation keyframes (40 poses in
    scene-1094, as replay-forge extract_scene) while the source keeps the dense ego; the box stays 1.39 m ahead.
    car_029@7 stop/2 is then valid, as replay-forge finds it."""
    dense = next(a for a in scene_1094["actors"] if a["role"] == "ego")
    model = scene_model(scene_1094)
    ego = model.tracks[0]
    assert len(dense["samples"]) > 300 and len(ego.t) == 40
    keyframes = np.unique(np.concatenate([tr.t for tr in model.tracks[1:]]))
    assert np.abs(ego.t[:, None] - keyframes[None, :]).min(axis=1).max() <= 1e-6
    ok = model.present[:, 0]
    pose = [np.interp(model.t[ok], ego.t, ego.xy[:, k]) for k in (0, 1)]
    assert np.allclose(np.hypot(model.X[ok, 0] - pose[0], model.Y[ok, 0] - pose[1]), 1.39, atol=1e-6)
    result, by_id = _car_029_stop(model)
    assert result.valid and result.reasons == []
    assert by_id["physics"]["passed"] is True and by_id["physics"]["value"] <= by_id["physics"]["threshold"]


def test_hold_stands_still_to_the_end_while_stop_drives_on(model):
    """plan51: “Dừng hẳn” (hold) never drives off; replay-forge “stop” with dwell 0 still does (metrics parity)."""
    held = simulate(model, Event("car_001", 2.0, 4.0, "hold", 0.0))
    lead = model.index["car_001"]
    k = round(held.event_phases["target_reached"] / DT)
    assert "dwell_end" not in held.event_phases
    assert np.nanmax(held.V[k:, lead]) == 0.0 and np.ptp(held.S[k:, lead]) == 0.0
    moved = simulate(model, Event("car_001", 2.0, 4.0, "stop", 0.0))
    assert "dwell_end" in moved.event_phases and np.nanmax(moved.V[k + 40:, lead]) > 1.0


def test_hold_package_and_window_key(model):
    result = run_event(model, event(model, "car_001", target="hold", dwell_s=0.0))
    report = json.loads(result["files"]["report.json"])
    assert report["event"]["target"] == "hold" and result["valid"] is True
    markers = report["topeye"]["markers"]
    assert any(m["kind"] == "stopped" for m in markers) and not any(m["kind"] == "resume" for m in markers)
    lead = next(c for c in candidates(model)["candidates"] if c["name"] == "car_001")
    assert lead["windows_by_event"]["hold:0:4"]


def ego_close_behind():
    """Ego 12 m behind a lead at 10 m/s: a hard hold of the lead with a slow ego reaction ends in a rear-end hit."""
    source = source_fixture()
    source["interval_s"] = [0, 20.0]
    source["actors"] = [actor("ego", 0.0, 10.0, 20.0, role="ego", dt=0.05), actor("lead-token", 12.0, 10.0, 20.0)]
    source["environment"]["polygons"][0]["outer"] = [[-50, -40], [400, -40], [400, 40], [-50, 40]]
    return scene_model(source)


def test_pilot_with_an_ego_collision_is_invalid_baseline_and_metrics_keep_replay_forge_rules():
    m = ego_close_behind()
    e = {"actor_id": "lead-token", "t0_s": 2.0, "decel_mps2": 8.0, "target": "hold", "dwell_s": 0.0, "react": True, "reaction_s": 3.0}
    pilot = run_event(m, e)
    assert pilot["valid"] is False and any(r.startswith("[ego_collision]") for r in pilot["reasons"])
    report = json.loads(pilot["files"]["report.json"])
    collision = next(c for c in report["topeye"]["checks"] if c["id"] == "collision")
    assert report["topeye"]["summary"].startswith("Không hợp lệ · xe của bạn vẫn va chạm car_001") and "Cách sửa" in report["topeye"]["summary"]
    assert collision["passed"] is False and "xe của bạn chạm" in collision["detail"]
    outcome = simulate(m, reactive.parse_event(m, e)[0], react=True, reaction=3.0)
    assert "ego_collision" not in reactive.assess(m, outcome).reasons  # scene metrics / baseline rule unchanged
    assert "ego_collision" in reactive.assess(m, outcome, strict_ego=True).reasons
