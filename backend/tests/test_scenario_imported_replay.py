import json
from pathlib import Path

import pytest
from test_scenario_map_context import source_fixture
from test_scenario_xosc_import import fixture_xml

from topeye.scenario.imported_replay import load_imported, persist_import, run_imported_replay
from topeye.scenario.map_context import build_map_context
from topeye.scenario.models import ScenarioError
from topeye.scenario.xosc_import import validate_xosc


def test_real_roadless_engine_and_roundtrip(tmp_path):
    c = build_map_context(source_fixture())
    xml = fixture_xml(c)
    s = validate_xosc(xml, c)
    s["source"]["dataset_root"] = str(tmp_path / "dataset")
    p = persist_import(s, xml, c, tmp_path / "workspace", tmp_path / "dataset")
    s["package_path"] = str(p)
    assert load_imported(p, c, tmp_path / "dataset")["id"] == s["id"]
    engine = (
        Path(__file__).resolve().parents[1]
        / ".tools/esmini/build/EnvironmentSimulator/Libraries/esminiLib/libesminiLib.dylib"
    )
    assert engine.is_file(), "Required actual esmini engine missing"
    result = run_imported_replay(s, c, engine, tmp_path / "run")
    assert result["report"]["execution"] == "pass"
    assert result["report"]["map_conformance"] == "pass"
    assert len(result["observed"]) == 123
    assert result["report"]["fidelity"]["max_xy_m"] < 1e-6
    boxes = json.loads((tmp_path / "run/engine-info.json").read_text())["boxes"]
    assert boxes[2]["object_type"] == 2
    assert abs(boxes[0]["center_offset_m"][0] - 0.3) < 1e-6


@pytest.mark.parametrize(
    "payload", ["original.xosc", "normalized.xosc", "scenario.json", "context.json"]
)
def test_tamper_blocked(payload, tmp_path):
    c = build_map_context(source_fixture())
    xml = fixture_xml(c)
    s = validate_xosc(xml, c)
    p = persist_import(s, xml, c, tmp_path / "workspace", tmp_path / "dataset")
    (p / payload).write_text("tampered")
    with pytest.raises(ScenarioError):
        load_imported(p, c, tmp_path / "dataset")


def test_32_actor_60second_transport_and_contact_aggregation():
    from topeye.scenario.imported_replay import (
        contact_observations,
        public_observed,
        require_ipc_budget,
    )

    times = [i * 0.05 for i in range(1201)]
    measured = []
    detailed = []
    for actor_index in range(32):
        identity = f"actor{actor_index}"
        rows = [
            {
                "id": identity,
                "t_s": t,
                "x_m": 1.25,
                "y_m": 2.5,
                "z_m": 0.5,
                "yaw_rad": 0.0,
                "reference_x_m": 1.25,
                "reference_y_m": 2.5,
                "reference_z_m": 0.5,
            }
            for t in times
        ]
        detailed.extend(rows)
        measured.append({"id": identity, "length_m": 4.5, "width_m": 1.8, "samples": rows})
    contacts = contact_observations(measured, times)
    assert len(contacts) == 496
    assert all(
        c["first_t_s"] == 0 and c["last_t_s"] == 60 and c["contact_samples"] == 1201
        for c in contacts
    )
    public = public_observed(detailed)
    assert len(public) == 38432 and all("reference_x_m" not in r for r in public)
    require_ipc_budget({"path": "run", "observed": public, "report": {"contacts": contacts}})


def test_transport_oversize_rejected_before_publish(tmp_path):
    c = build_map_context(source_fixture())
    xml = fixture_xml(c)
    s = validate_xosc(xml, c)
    s["environment"]["warnings"].append("x" * (8 * 1024 * 1024))
    with pytest.raises(ScenarioError) as exc:
        persist_import(s, xml, c, tmp_path / "workspace", tmp_path / "dataset")
    assert exc.value.code == "RESOURCE_LIMIT"
    assert not (tmp_path / "workspace").exists()


def test_real_rotating_reference_center_arc(tmp_path):
    import xml.etree.ElementTree as E

    from test_scenario_xosc_import import rotated_offset_xml

    c = build_map_context(source_fixture())
    root = rotated_offset_xml(c, 0.3, [0, 0.2, 0.4])
    for group in root.findall("Storyboard/Story/Act/ManeuverGroup"):
        for vertex in group.findall(".//Vertex"):
            vertex.find("Position/WorldPosition").set("x", vertex.get("time"))
    xml = E.tostring(root)
    s = validate_xosc(xml, c)
    assert len(s["actors"][0]["samples"]) > len(s["actors"][0]["reference_samples"])
    midpoint = next(r for r in s["actors"][0]["samples"] if abs(r["t_s"] - 0.5) < 1e-9)
    import math

    assert abs(midpoint["x_m"] - (0.5 + 0.3 * math.cos(0.1))) < 1e-9
    assert abs(midpoint["y_m"] - 0.3 * math.sin(0.1)) < 1e-9
    s["source"]["dataset_root"] = str(tmp_path / "dataset")
    s["package_path"] = str(persist_import(s, xml, c, tmp_path / "workspace", tmp_path / "dataset"))
    engine = (
        Path(__file__).resolve().parents[1]
        / ".tools/esmini/build/EnvironmentSimulator/Libraries/esminiLib/libesminiLib.dylib"
    )
    result = run_imported_replay(s, c, engine, tmp_path / "run")
    assert result["report"]["execution"] == "pass"
    assert result["report"]["fidelity"]["max_yaw_rad"] <= 0.005000001
    observed = next(
        r for r in result["observed"] if r["id"] == "ego" and abs(r["t_s"] - 0.5) < 1e-7
    )
    assert abs(observed["x_m"] - midpoint["x_m"]) < 0.002
    assert abs(observed["y_m"] - midpoint["y_m"]) < 0.002


def test_normalization_overflow_preflight_before_workspace(tmp_path):
    import copy
    import xml.etree.ElementTree as E

    c = build_map_context(source_fixture())
    root = E.fromstring(fixture_xml(c, moving=False, center=(0, 0, 0)))
    entities = root.find("Entities")
    init = root.find("Storyboard/Init/Actions")
    act = root.find("Storyboard/Story/Act")
    base_group = copy.deepcopy(act.findall("ManeuverGroup")[1])
    for index in range(17):
        identity = f"added{index}"
        entity = copy.deepcopy(entities[1])
        entity.set("name", identity)
        entities.append(entity)
        private = copy.deepcopy(init[1])
        private.set("entityRef", identity)
        init.append(private)
        group = copy.deepcopy(base_group)
        group.find("Actors/EntityRef").set("entityRef", identity)
        act.insert(0, group)
    for poly in root.findall(".//Polyline"):
        base = copy.deepcopy(poly[0])
        poly.clear()
        for time_s in range(61):
            vertex = copy.deepcopy(base)
            vertex.set("time", str(time_s))
            poly.append(vertex)
    root.find(
        "Storyboard/StopTrigger/ConditionGroup/Condition/ByValueCondition/SimulationTimeCondition"
    ).set("value", "60")
    xml = E.tostring(root)
    scenario = validate_xosc(xml, c)
    with pytest.raises(ScenarioError) as exc:
        persist_import(scenario, xml, c, tmp_path / "workspace", tmp_path / "dataset")
    assert exc.value.code == "RESOURCE_LIMIT"
    assert "Normalized" in str(exc.value)
    assert not (tmp_path / "workspace").exists()
