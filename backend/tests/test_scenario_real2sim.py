"""plan43: team real2sim replay packages — separate admission path, notes instead of map rejections."""

import base64
import copy
import json
from pathlib import Path

import pytest
from test_scenario_import_service import service  # noqa: F401  (fixture)
from test_scenario_map_context import source_fixture

from topeye.scenario.library import list_imported, read_imported
from topeye.scenario.map_context import build_map_context
from topeye.scenario.models import ScenarioError
from topeye.scenario.real2sim import CSV_HEADER, load_package, parse_package, persist_package

SAMPLE = Path.home() / "Downloads/car_013_t01.0_stop_d3_a8"


def vertex(t, x, y, h=0.0):
    return f'<Vertex time="{t:.4f}"><Position><WorldPosition x="{x:.4f}" y="{y:.4f}" h="{h:.4f}"/></Position></Vertex>'


def trigger(name, t, rule="greaterOrEqual"):
    return (
        f'<StartTrigger><ConditionGroup><Condition name="{name}" delay="0" conditionEdge="none"><ByValueCondition>'
        f'<SimulationTimeCondition value="{t:.4f}" rule="{rule}"/></ByValueCondition></Condition></ConditionGroup></StartTrigger>'
    )


def vehicle(name, category, center_x=0.0):
    return (
        f'<ScenarioObject name="{name}"><Vehicle name="{name}" vehicleCategory="car"><ParameterDeclarations/>'
        f'<BoundingBox><Center x="{center_x}" y="0" z="0.75"/><Dimensions width="1.8" length="4.0" height="1.5"/></BoundingBox>'
        '<Performance maxSpeed="70" maxAcceleration="10" maxDeceleration="10"/>'
        '<Axles><FrontAxle maxSteering="0.5" wheelDiameter="0.6" trackWidth="1.5" positionX="2.6" positionZ="0.3"/>'
        '<RearAxle maxSteering="0.5" wheelDiameter="0.6" trackWidth="1.5" positionX="0" positionZ="0.3"/></Axles>'
        f'<Properties><Property name="nuscenes_category" value="{category}"/></Properties></Vehicle></ScenarioObject>'
    )


def follow(name, rows, start=0.0):
    return (
        f'<ManeuverGroup maximumExecutionCount="1" name="group_{name}"><Actors selectTriggeringEntities="false">'
        f'<EntityRef entityRef="{name}"/></Actors><Maneuver name="m_{name}"><Event name="e_{name}" priority="overwrite" maximumExecutionCount="1">'
        f'<Action name="f_{name}"><PrivateAction><RoutingAction><FollowTrajectoryAction><TrajectoryRef>'
        f'<Trajectory name="t_{name}" closed="false"><ParameterDeclarations/><Shape><Polyline>'
        + "".join(vertex(*r) for r in rows)
        + '</Polyline></Shape></Trajectory></TrajectoryRef><TimeReference><Timing domainAbsoluteRelative="absolute" scale="1" offset="0"/></TimeReference>'
        '<TrajectoryFollowingMode followingMode="position"/></FollowTrajectoryAction></RoutingAction></PrivateAction></Action>'
        + trigger(f"s_{name}", start)
        + "</Event></Maneuver></ManeuverGroup>"
    )


def package_xml(extra_event="", minor="1"):
    """ego + car (drives 0–4 s) + barrier appearing at 1 s and vanishing at 3 s (static, AddEntity)."""
    ego = [(i * 0.5, i * 0.5 * 5, 0.0) for i in range(9)]
    car = [(i * 0.5, 10 + i * 0.5 * 5, 0.0) for i in range(9)]
    entities = vehicle("ego", "vehicle.ego", center_x=1.4) + vehicle("car_001", "vehicle.car") + (
        '<ScenarioObject name="barrier_001"><MiscObject name="barrier_001" mass="100" miscObjectCategory="barrier">'
        '<ParameterDeclarations/><BoundingBox><Center x="0" y="0" z="0.45"/><Dimensions width="2" length="0.8" height="0.9"/>'
        '</BoundingBox><Properties><Property name="nuscenes_category" value="movable_object.barrier"/></Properties></MiscObject></ScenarioObject>'
    )
    init = "".join(
        f'<Private entityRef="{n}"><PrivateAction><TeleportAction><Position><WorldPosition x="{x}" y="0" h="0"/></Position></TeleportAction></PrivateAction></Private>'
        for n, x in (("ego", 0), ("car_001", 10), ("barrier_001", 5))
    ) + '<GlobalAction><EntityAction entityRef="barrier_001"><DeleteEntityAction/></EntityAction></GlobalAction>'
    presence = (
        '<ManeuverGroup maximumExecutionCount="1" name="presence"><Actors selectTriggeringEntities="false"/><Maneuver name="presence">'
        '<Event name="appear_barrier_001" priority="parallel" maximumExecutionCount="1"><Action name="a"><GlobalAction>'
        '<EntityAction entityRef="barrier_001"><AddEntityAction><Position><WorldPosition x="5" y="8" h="0.5"/></Position>'
        "</AddEntityAction></EntityAction></GlobalAction></Action>" + trigger("ap", 1.0) + "</Event>"
        '<Event name="vanish_barrier_001" priority="parallel" maximumExecutionCount="1"><Action name="v"><GlobalAction>'
        '<EntityAction entityRef="barrier_001"><DeleteEntityAction/></EntityAction></GlobalAction></Action>' + trigger("va", 3.0) + "</Event>"
        + extra_event
        + "</Maneuver></ManeuverGroup>"
    )
    return (
        f'<?xml version="1.0" encoding="utf-8"?><OpenSCENARIO><FileHeader revMajor="1" revMinor="{minor}" date="2026-01-01T00:00:00" '
        'description="real2sim replay of nuScenes scene-test" author="real2sim"/><ParameterDeclarations/><CatalogLocations/>'
        '<RoadNetwork><LogicFile filepath="scene-test_map.xodr"/></RoadNetwork>'
        f"<Entities>{entities}</Entities><Storyboard><Init><Actions>{init}</Actions></Init>"
        f'<Story name="replay"><Act name="replay">{presence}{follow("ego", ego)}{follow("car_001", car)}'
        + trigger("act", 0.0, "greaterThan").replace("StartTrigger", "StartTrigger")
        + "</Act></Story><StopTrigger><ConditionGroup><Condition name=\"end\" delay=\"0\" conditionEdge=\"none\"><ByValueCondition>"
        '<SimulationTimeCondition value="4.5" rule="greaterThan"/></ByValueCondition></Condition></ConditionGroup></StopTrigger>'
        "</Storyboard></OpenSCENARIO>"
    ).encode()


REPORT = {
    "id": "car_001_t01.0_stop_d3_a8",
    "scene": "scene-test",
    "source": "nuscenes-mini",
    "event": {"actor": "car_001", "t0": 1.0, "decel": 8.0, "target": "stop", "dwell": 3.0},
    "drivers": {"react": True, "reaction_s": 1.0, "thresholds": {"idm_a": 1.5, "bad": "x"},
                "per_vehicle": {"ego": {"T": 1.46, "s0": 2.0, "max_decel": 8.0}}},
    "valid": True,
    "reasons": [],
    "group": "close",
    "ego": {"a_min": 3.2, "a_used": 5.27, "min_gap": 1.751, "min_ttc": 1.1, "conflict_with": "car_001",
            "recorded_min_gap": 10.335, "recorded_min_ttc": None},
    "reacted": ["car_001", "ego"],
    "max_decel_used": {"ego": 5.27},
    "checks": {"physics": {"ego": {"max_speed": 12.01, "max_decel": 5.1, "t_decel": 2.85, "limit_decel": 8.2}},
               "gaps": {"ego": {"gap": 1.754, "t": 5.2, "leader": "car_001"}}},
    "collisions": [],
    "esmini": {"exit": 0, "problems": [], "version": "v3.9.0", "replay_error_m": {"ego": {"mean": 0.0, "max": 0.0001}}},
    "run": {"created": "2026-10-14T15:23:15", "code": {"commit": "a75ce6b", "dirty": False},
            "esmini": {"version": "v3.9.0"}, "config": {"road": "map", "dt": 0.05}},
}


def files(xml=None, report=REPORT, csv_text=None):
    out = {"car_001_t01.0_stop_d3_a8.xosc": xml or package_xml()}
    if report is not None:
        out["report.json"] = json.dumps(report).encode()
    if csv_text is not None:
        out["trajectories.csv"] = csv_text.encode()
    return out


@pytest.fixture
def context():
    return build_map_context(source_fixture())


def test_parses_lifetimes_categories_and_report(context):
    s = parse_package(files(), context)
    assert s["kind"] == "real2sim" and s["mode"] == "imported"
    by = {a["id"]: a for a in s["actors"]}
    assert by["ego"]["role"] == "ego" and by["ego"]["category"] == "vehicle.car"
    assert by["ego"]["center_offset_m"] == [1.4, 0.0, 0.75]
    assert by["barrier_001"]["category"] == "movable_object.barrier"
    barrier = by["barrier_001"]["reference_samples"]
    assert [r["t_s"] for r in barrier] == [1.0, 3.0] and barrier[0]["y_m"] == 8
    assert by["car_001"]["reference_samples"][-1]["t_s"] == 4.0
    assert s["interval_s"] == [0, 4.0]
    # Dense box-centred samples (≤ 0.05 s), as the runner expects.
    gaps = [b["t_s"] - a["t_s"] for a, b in zip(by["ego"]["samples"], by["ego"]["samples"][1:])]
    assert max(gaps) <= 0.05 + 1e-9
    r = s["report"]
    assert r["valid"] is True and r["group"] == "close"
    assert r["event"] == {"actor": "car_001", "t0": 1.0, "decel": 8.0, "target": "stop", "dwell": 3.0}
    assert r["ego"]["min_gap"] == 1.751 and "recorded_min_ttc" not in r["ego"]
    assert r["drivers"]["thresholds"] == {"idm_a": 1.5}  # non-numbers dropped
    assert r["run"] == {"created": "2026-10-14T15:23:15", "commit": "a75ce6b", "dirty": False,
                        "esmini_version": "v3.9.0", "dt": 0.05, "road": "map"}


def test_map_findings_are_notes_not_rejections(context):
    xml = package_xml().replace(b'x="5" y="8"', b'x="5" y="80"')  # barrier outside the map
    s = parse_package(files(xml), context)
    codes = {d["code"] for d in s["import"]["diagnostics"]}
    assert "MAP_NOTE_OUTSIDE" in codes


@pytest.mark.parametrize(
    "extra",
    [
        '<Event name="x" priority="overwrite"><Action name="x"><PrivateAction><LongitudinalAction/></PrivateAction></Action>',
        '<Event name="x" priority="overwrite"><Action name="x"><UserDefinedAction/></Action>',
    ],
)
def test_non_replay_actions_refused_by_name(context, extra):
    xml = package_xml(extra + trigger("x", 0) + "</Event>")
    with pytest.raises(ScenarioError) as exc:
        parse_package(files(xml), context)
    assert exc.value.code == "UNSUPPORTED_XOSC"


def test_entity_condition_trigger_refused(context):
    xml = package_xml().replace(
        b'<SimulationTimeCondition value="1.0000" rule="greaterOrEqual"/>',
        b'<StoryboardElementStateCondition storyboardElementType="act" storyboardElementRef="a" state="endTransition"/>',
    )
    with pytest.raises(ScenarioError) as exc:
        parse_package(files(xml), context)
    assert exc.value.code == "UNSUPPORTED_XOSC"


@pytest.mark.parametrize(
    "mutate,code",
    [
        (lambda x: b'<!DOCTYPE x [<!ENTITY a "b">]>' + x, "UNSUPPORTED_XOSC"),
        (lambda x: x.replace(b'value="vehicle.car"', b'value="vehicle.ego"'), "INVALID_TRAJECTORY"),
        (lambda x: x.replace(b'value="vehicle.ego"', b'value="vehicle.car"').replace(b'name="ego"', b'name="ego2"').replace(b'entityRef="ego"', b'entityRef="ego2"'), "INVALID_TRAJECTORY"),
        (lambda x: x.replace(b'<Vertex time="1.0000">', b'<Vertex time="0.2000">', 1), "INVALID_TRAJECTORY"),
        (lambda x: x.replace(b'revMinor="1"', b'revMinor="3"'), "UNSUPPORTED_XOSC"),
        (lambda x: x + b" " * (4 * 1024 * 1024), "RESOURCE_LIMIT"),
    ],
)
def test_rejections(context, mutate, code):
    with pytest.raises(ScenarioError) as exc:
        parse_package(files(mutate(package_xml())), context)
    assert exc.value.code == code


def test_report_bad_field_is_dropped_with_note(context):
    report = {**REPORT, "event": "broken"}
    s = parse_package(files(report=report), context)
    assert s["report"]["event"] is None
    assert any(d["code"] == "REPORT_FIELD" for d in s["import"]["diagnostics"])


def test_report_scene_must_match(context):
    with pytest.raises(ScenarioError) as exc:
        parse_package(files(report={**REPORT, "scene": "scene-0103"}), context)
    assert exc.value.code == "MAP_MISMATCH"


def test_without_report_still_imports(context):
    assert parse_package(files(report=None), context)["report"] is None


def test_csv_checked(context):
    good = ",".join(CSV_HEADER) + "\nscene-test,0.000,ego,car,0,0,0,4,1.8,1.5\n"
    assert parse_package(files(csv_text=good), context)
    with pytest.raises(ScenarioError, match="tiêu đề"):
        parse_package(files(csv_text="a,b\n"), context)
    with pytest.raises(ScenarioError, match="đối tượng lạ"):
        parse_package(files(csv_text=good.replace(",ego,", ",ghost,")), context)


def test_unknown_files_and_two_xosc_refused(context):
    with pytest.raises(ScenarioError):
        parse_package({**files(), "map.xodr": b"<OpenDRIVE/>"}, context)
    with pytest.raises(ScenarioError):
        parse_package({**files(), "b.xosc": package_xml()}, context)


def test_persist_load_list_read_and_tamper(context, tmp_path):
    f = files(csv_text=",".join(CSV_HEADER) + "\n")
    s = parse_package(f, context)
    package = persist_package(s, f, context, tmp_path / "ws", tmp_path / "dataset", "car_001.xosc")
    manifest = json.loads((package / "manifest.json").read_text())
    assert manifest["kind"] == "real2sim"
    assert set(manifest["files"]) == {"original.xosc", "report.json", "trajectories.csv", "context.json", "scenario.json"}
    loaded = load_package(package, context, tmp_path / "dataset")
    assert loaded["actors"] == s["actors"] and loaded["report"] == s["report"]
    [entry] = list_imported(tmp_path / "ws")
    assert entry["kind"] == "real2sim" and entry["actors"] == 3
    assert entry["report"] == {"valid": True, "group": "close", "event": REPORT["event"],
                               "reasons": REPORT["reasons"], "react": REPORT["drivers"]["react"]}
    assert read_imported(tmp_path / "ws", s["id"])["xml"].startswith("<?xml")
    (package / "report.json").write_text(json.dumps({**REPORT, "valid": False}))
    with pytest.raises(ScenarioError) as exc:
        load_package(package, context, tmp_path / "dataset")
    assert exc.value.code == "HASH_MISMATCH"


def test_worker_import_open_and_refuses_metrics(service):  # noqa: F811
    api, params = service
    source = api.call("source_scene", params)
    payload = [{"name": n, "data_base64": base64.b64encode(b).decode()} for n, b in files().items()]
    scenario = api.call("import_package", {**params, "source_id": source["id"], "files": payload})
    assert scenario["kind"] == "real2sim" and len(scenario["actors"]) == 3
    assert all("reference_samples" not in a for a in scenario["actors"])
    package = Path(params["workspace"]) / scenario["id"] / "import"
    reopened = api.call("open_imported", {**params, "source_id": source["id"], "package_path": str(package)})
    assert reopened["id"] == scenario["id"] and reopened["report"]["group"] == "close"
    with pytest.raises(ScenarioError) as exc:
        api.call("scenario_metrics", {**params, "scenario_id": scenario["id"]})
    assert exc.value.code == "UNSUPPORTED_KIND"
    with pytest.raises(ScenarioError) as exc:
        api.call("replay_imported", {**params, "scenario_id": scenario["id"], "engine": "/nope"})
    assert exc.value.code == "UNSUPPORTED_KIND"
    with pytest.raises(ScenarioError):
        api.call("import_package", {**params, "source_id": source["id"], "files": [{"name": "../x.xosc", "data_base64": ""}]})


@pytest.mark.skipif(not SAMPLE.is_dir(), reason="owner's sample package not present on this machine")
def test_owner_sample_package_shape(context):
    """The real sample: frames, lifetimes and report survive parsing (map = synthetic, so notes are expected)."""
    raw = {
        "car_013_t01.0_stop_d3_a8.xosc": (SAMPLE / "car_013_t01.0_stop_d3_a8.xosc").read_bytes(),
        "report.json": (SAMPLE / "report.json").read_bytes(),
        "trajectories.csv": (SAMPLE / "trajectories.csv").read_bytes(),
    }
    ctx = copy.deepcopy(context)
    report = json.loads(raw["report.json"])
    report["scene"] = ctx["scene"]
    raw["report.json"] = json.dumps(report).encode()
    s = parse_package(raw, ctx)
    by = {a["id"]: a for a in s["actors"]}
    assert len(s["actors"]) == 73
    assert by["ego"]["reference_samples"][-1]["t_s"] == pytest.approx(19.95)
    assert by["barrier_001"]["reference_samples"][0]["t_s"] == pytest.approx(7.8997)
    assert s["report"]["ego"]["min_gap"] == 1.751


def test_persist_reuses_the_parse_but_still_refuses_a_changed_import(context, tmp_path):
    """plan52: persist_package(parsed=…) skips the second parse of the same bytes, never the integrity check."""
    f = files(csv_text=",".join(CSV_HEADER) + "\n")
    parsed = parse_package(f, context)
    imported = copy.deepcopy(parsed)
    imported["source"]["source_id"] = "x" * 32  # bookkeeping fields the worker adds are not semantic
    package = persist_package(imported, f, context, tmp_path / "ws", tmp_path / "dataset", "car_001.xosc", parsed=parsed)
    assert json.loads((package / "manifest.json").read_text())["kind"] == "real2sim"
    tampered = copy.deepcopy(parsed)
    tampered["id"] = "b" * 32
    tampered["actors"][0]["samples"][1]["x_m"] += 5.0
    with pytest.raises(ScenarioError) as exc:
        persist_package(tampered, f, context, tmp_path / "ws2", tmp_path / "dataset", "car_001.xosc", parsed=parsed)
    assert exc.value.code == "HASH_MISMATCH"
