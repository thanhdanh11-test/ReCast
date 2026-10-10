"""Private Service import lifecycle, independent from legacy scenario cache."""

import base64
import copy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from test_scenario_map_context import source_fixture
from test_scenario_xosc_import import fixture_xml

from topeye.scenario.map_context import build_map_context
from topeye.scenario.models import ScenarioError, sha256, write_json
from topeye.scenario.worker import Service


@pytest.fixture
def service(tmp_path, monkeypatch):
    from topeye.scenario import worker

    source = source_fixture()
    source["id"] = "a" * 32
    adapter = SimpleNamespace(root=tmp_path / "dataset", version="v1.0-mini")
    monkeypatch.setattr(worker, "NuScenesAdapter", lambda root, version: adapter)
    monkeypatch.setattr(
        worker, "source_scene", lambda adapter, scene, progress: copy.deepcopy(source)
    )
    params = {
        "dataset": str(adapter.root),
        "workspace": str(tmp_path / "workspace"),
        "scene": "scene-test",
    }
    return Service(), params


def test_import_persist_reopen_and_map_staleness(service, tmp_path):
    api, params = service
    source = api.call("source_scene", params)
    context = api.call("map_context", {**params, "source_id": source["id"]})
    xml = fixture_xml(context)
    scenario = api.call(
        "import_xosc",
        {**params, "source_id": source["id"], "xml_base64": base64.b64encode(xml).decode()},
    )
    assert scenario["mode"] == "imported"
    assert len(scenario["actors"]) == 3
    assert not api.scenarios  # No weakening/reuse of legacy admission.
    package = Path(params["workspace"]) / scenario["id"] / "import"
    reopened = api.call(
        "open_imported", {**params, "source_id": source["id"], "package_path": str(package)}
    )
    assert reopened["id"] == scenario["id"]
    api.sources[source["id"]]["environment"]["polygons"][0]["outer"][0][0] -= 1
    with pytest.raises(ScenarioError, match="Map"):
        api.call("replay_imported", {**params, "scenario_id": scenario["id"]})
    assert not (package.parent / "runs").exists()


def test_unknown_source_and_invalid_import_preserve_existing(service):
    api, params = service
    source = api.call("source_scene", params)
    with pytest.raises(ScenarioError) as exc:
        api.call("map_context", {**params, "source_id": "unknown"})
    assert exc.value.code == "STALE_CONTEXT"
    context = build_map_context(api.sources[source["id"]])
    xml = fixture_xml(context)
    imported = api.call(
        "import_xosc",
        {**params, "source_id": source["id"], "xml_base64": base64.b64encode(xml).decode()},
    )
    with pytest.raises(ScenarioError):
        api.call(
            "import_xosc",
            {
                **params,
                "source_id": source["id"],
                "xml_base64": base64.b64encode(b"<OpenSCENARIO/>").decode(),
            },
        )
    assert list(api.imports) == [imported["id"]]
    assert list(api.sources) == [source["id"]]


def test_import_recovery_marks_running_only(tmp_path):
    identity = "a" * 32
    project = tmp_path / "workspace" / identity
    (project / "import").mkdir(parents=True)
    write_json(project / "import/manifest.json", {"kind": "imported", "scenario_id": identity})
    for name, state in [("abandoned", "running"), ("done", "completed")]:
        (project / "runs" / name).mkdir(parents=True)
        write_json(project / "runs" / name / "status.json", {"status": state})
    Service.recover(tmp_path / "workspace", tmp_path / "dataset")
    assert (
        json.loads((project / "runs/abandoned/status.json").read_text())["status"] == "interrupted"
    )
    assert json.loads((project / "runs/done/status.json").read_text())["status"] == "completed"


def test_reopen_uses_app_owned_dataset_path(service, tmp_path):
    api, params = service
    source = api.call("source_scene", params)
    context = api.call("map_context", {**params, "source_id": source["id"]})
    scenario = api.call(
        "import_xosc",
        {
            **params,
            "source_id": source["id"],
            "xml_base64": base64.b64encode(fixture_xml(context)).decode(),
        },
    )
    package = Path(params["workspace"]) / scenario["id"] / "import"
    stored = json.loads((package / "scenario.json").read_text())
    stored["source"]["dataset_root"] = str(tmp_path / "untrusted-root")
    write_json(package / "scenario.json", stored)
    manifest = json.loads((package / "manifest.json").read_text())
    manifest["files"]["scenario.json"] = sha256(package / "scenario.json")
    write_json(package / "manifest.json", manifest)
    reopened = api.call(
        "open_imported", {**params, "source_id": source["id"], "package_path": str(package)}
    )
    assert reopened["source"]["dataset_root"] == params["dataset"]
