"""Export admission and private worker boundary regression tests."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from lxml import etree
from test_scenario_domain import scenario_fixture  # noqa: F401 — shared fixture

from topeye.scenario.export import export_bundle, validate_xml
from topeye.scenario.models import ScenarioError, write_json
from topeye.scenario.replay import run_replay
from topeye.scenario.worker import Service


def test_export_schema_and_no_overwrite(scenario, tmp_path):
    bundle = tmp_path / "bundle"
    manifest = export_bundle(scenario, bundle)
    assert set(manifest["files"]) == {"scenario.xosc", "road.xodr", "reference.json"}
    validate_xml(bundle / "scenario.xosc")
    with pytest.raises(ScenarioError):
        export_bundle(scenario, bundle)
    (bundle / "scenario.xosc").write_text("<OpenSCENARIO/>")
    with pytest.raises(etree.DocumentInvalid):
        validate_xml(bundle / "scenario.xosc")


@pytest.mark.parametrize(
    "fault", ["empty", "schema", "traversal", "identity", "digest", "symlink", "xml"]
)
def test_corrupt_bundle_rejected_before_output(scenario, tmp_path, fault):
    bundle = tmp_path / "bundle"
    manifest = export_bundle(scenario, bundle)
    engine = tmp_path / "engine"
    engine.write_text("must never be loaded")
    if fault == "empty":
        manifest["files"] = {}
    if fault == "schema":
        manifest["schema_version"] = 999
    if fault == "traversal":
        manifest["files"]["../outside"] = "0" * 64
    if fault == "identity":
        manifest["scenario_id"] = "other"
    if fault == "digest":
        manifest["files"]["reference.json"] = "0" * 64
    if fault == "symlink":
        source = tmp_path / "outside"
        source.write_bytes((bundle / "road.xodr").read_bytes())
        (bundle / "road.xodr").unlink()
        (bundle / "road.xodr").symlink_to(source)
    if fault == "xml":
        from topeye.scenario.models import sha256

        path = bundle / "scenario.xosc"
        path.write_text(path.read_text().replace('filepath="road.xodr"', 'filepath="/outside"'))
        manifest["files"]["scenario.xosc"] = sha256(path)
    write_json(bundle / "manifest.json", manifest)
    with pytest.raises(ScenarioError):
        run_replay(bundle, engine, tmp_path / "run")
    assert not (tmp_path / "run").exists()


def test_missing_engine(scenario, tmp_path):
    export_bundle(scenario, tmp_path / "bundle")
    with pytest.raises(ScenarioError, match="not installed"):
        run_replay(tmp_path / "bundle", tmp_path / "absent", tmp_path / "run")
    assert not (tmp_path / "run").exists()


def test_recovery_preserves_completed_and_dataset(tmp_path):
    identity = "a" * 32
    project = tmp_path / "projects" / identity
    (project / "bundle").mkdir(parents=True)
    write_json(project / "bundle" / "manifest.json", {"scenario_id": identity})
    for name, state in [("old", "running"), ("done", "completed")]:
        directory = project / "runs" / name
        directory.mkdir(parents=True)
        write_json(directory / "status.json", {"status": state})
    dataset = tmp_path / "data.json"
    dataset.write_text("SOURCE")
    (project / "runs" / "old" / "status.json.tmp").symlink_to(dataset)
    Service.recover(tmp_path / "projects", tmp_path / "data.json")
    assert (
        json.loads((project / "runs" / "old" / "status.json").read_text())["status"]
        == "interrupted"
    )
    assert (
        json.loads((project / "runs" / "done" / "status.json").read_text())["status"] == "completed"
    )
    assert dataset.read_text() == "SOURCE"


def test_worker_private_protocol_errors(tmp_path):
    requests = [
        {"id": "one", "method": "shell", "params": {}},
        {"id": "two", "method": "replay", "params": {}},
    ]
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    result = subprocess.run(
        [sys.executable, "-m", "topeye.scenario.worker"],
        cwd=tmp_path,
        input="\n".join(json.dumps(r) for r in requests) + "\n",
        text=True,
        capture_output=True,
        env=env,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0
    messages = [json.loads(line) for line in result.stdout.splitlines()]
    assert messages[0] == {"type": "ready", "protocol": 1}
    assert [(r["id"], r["type"]) for r in messages[1:]] == [("one", "error"), ("two", "error")]


@pytest.mark.parametrize("location", ["manifest", "status"])
def test_recovery_tolerates_nonobject_json(tmp_path, location):
    project = tmp_path / ("a" * 32)
    (project / "bundle").mkdir(parents=True)
    write_json(project / "bundle" / "manifest.json", {"scenario_id": project.name})
    status = project / "runs" / "run" / "status.json"
    status.parent.mkdir(parents=True)
    write_json(status, {"status": "running"})
    write_json(project / "bundle" / "manifest.json" if location == "manifest" else status, [])
    Service.recover(tmp_path, tmp_path / "dataset")


def test_recovery_never_writes_nested_dataset(tmp_path):
    project = tmp_path / ("a" * 32)
    (project / "bundle").mkdir(parents=True)
    write_json(project / "bundle" / "manifest.json", {"scenario_id": project.name})
    dataset = project / "runs" / "dataset"
    dataset.mkdir(parents=True)
    write_json(dataset / "status.json", {"status": "running"})
    before = (dataset / "status.json").read_bytes()
    Service.recover(tmp_path, dataset)
    assert (dataset / "status.json").read_bytes() == before


def test_engine_crash_records_failure(scenario, tmp_path):
    export_bundle(scenario, tmp_path / "bundle")
    engine = tmp_path / "broken.dylib"
    engine.write_text("invalid native library")
    with pytest.raises(ScenarioError, match="esmini failed"):
        run_replay(tmp_path / "bundle", engine, tmp_path / "run")
    status = json.loads((tmp_path / "run" / "status.json").read_text())
    assert status["status"] == "failed" and status["exit_code"] != 0
    assert not (tmp_path / "run" / "report.json").exists()
