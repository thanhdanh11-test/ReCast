import json
import os
import re
from pathlib import Path

import pytest
from test_scenario_map_context import source_fixture
from test_scenario_xosc_import import fixture_xml

from topeye.scenario.imported_replay import load_imported, persist_import
from topeye.scenario.library import delete_imported, display_name, list_imported, read_imported
from topeye.scenario.map_context import build_map_context
from topeye.scenario.models import ScenarioError
from topeye.scenario.xosc_import import validate_xosc


def package(tmp_path, name=None):
    context = build_map_context(source_fixture())
    xml = fixture_xml(context)
    imported = validate_xosc(xml, context)
    path = persist_import(
        imported, xml, context, tmp_path / "workspace", tmp_path / "dataset", name
    )
    return path, context, imported


def run(project, run_id, status, report=None, mtime=None):
    folder = project / "runs" / run_id
    folder.mkdir(parents=True)
    (folder / "status.json").write_text(json.dumps(status))
    if report:
        (folder / "report.json").write_text(json.dumps(report))
    if mtime:
        os.utime(folder / "status.json", (mtime, mtime))


def test_display_name_is_a_bounded_basename():
    assert display_name("/tmp/cut-in.xosc") == "cut-in.xosc"
    assert display_name("C:\\a\\b\\x.xosc") == "x.xosc"
    assert display_name("a\x00b\x1f.xosc") == "ab.xosc"
    assert display_name("x" * 300) == "x" * 120
    assert display_name("") is None and display_name(None) is None and display_name(3) is None


def test_display_name_does_not_break_package_verification(tmp_path):
    path, context, imported = package(tmp_path, "cut-in-left.xosc")
    assert json.loads((path / "manifest.json").read_text())["display_name"] == "cut-in-left.xosc"
    assert load_imported(path, context, tmp_path / "dataset")["id"] == imported["id"]


def test_lists_packages_with_runs_newest_first_and_skips_junk(tmp_path):
    path, _, imported = package(tmp_path, "cut-in-left.xosc")
    project = path.parent
    report = {
        "kind": "imported",
        "execution": "fail",
        "map_conformance": "pass",
        "fidelity": {"coverage": 1.0, "max_xy_m": 0.6, "max_yaw_rad": 0.01},
        "contacts": [{}, {}],
    }
    run(project, "a" * 32, {"status": "completed", "execution": "fail"}, report, mtime=1_000)
    run(project, "b" * 32, {"status": "running"}, mtime=2_000)
    workspace = tmp_path / "workspace"
    (workspace / ("c" * 32) / "import").mkdir(parents=True)
    (workspace / ("c" * 32) / "import" / "manifest.json").write_text("{broken")
    (workspace / ("d" * 32)).symlink_to(project)
    (workspace / "not-an-id").mkdir()
    entries = list_imported(workspace)
    assert [e["scenario_id"] for e in entries] == [imported["id"]]
    entry = entries[0]
    assert entry["name"] == "cut-in-left.xosc"
    assert entry["package_path"] == str(path.resolve())
    assert (
        entry["actors"] == len(imported["actors"]) and entry["scene"] == imported["source"]["scene"]
    )
    assert entry["duration_s"] == imported["interval_s"][1] - imported["interval_s"][0]
    assert [r["run_id"] for r in entry["runs"]] == ["b" * 32, "a" * 32]
    assert entry["runs"][0] == {
        "run_id": "b" * 32,
        "at": entry["runs"][0]["at"],
        "status": "running",
    }
    assert (
        entry["runs"][1]["execution"] == "fail"
        and entry["runs"][1]["max_xy_m"] == 0.6
        and entry["runs"][1]["contacts"] == 2
    )


def test_unnamed_legacy_package_and_missing_workspace(tmp_path):
    path, _, imported = package(tmp_path)
    original = path / "original.xosc"
    original.write_bytes(re.sub(rb'\sdescription="[^"]*"', b"", original.read_bytes(), count=1))
    assert list_imported(tmp_path / "workspace")[0]["name"] == f"kịch bản {imported['id'][:8]}"
    assert list_imported(tmp_path / "nope") == []


def test_name_falls_back_to_xosc_description(tmp_path):
    path, _, _ = package(tmp_path)
    original = path / "original.xosc"
    xml = original.read_bytes()
    header = xml[xml.index(b"<FileHeader") : xml.index(b">", xml.index(b"<FileHeader")) + 1]
    described = (
        header.replace(b"<FileHeader", b'<FileHeader description="Ped &amp; cut-in"', 1)
        if b"description=" not in header
        else header
    )
    assert b"description=" in described
    original.write_bytes(xml.replace(header, described))
    expected = (
        re.search(rb'description="([^"]*)"', described).group(1).decode().replace("&amp;", "&")
    )
    assert list_imported(tmp_path / "workspace")[0]["name"] == expected


def test_read_and_delete_stay_inside_the_workspace(tmp_path):
    path, _, imported = package(tmp_path, "cut-in.xosc")
    workspace = tmp_path / "workspace"
    data = read_imported(workspace, imported["id"])
    assert data["file_name"] == "cut-in.xosc" and data["name"] == "cut-in.xosc"
    assert data["xml"].encode() == (path / "original.xosc").read_bytes()
    assert data["template"] is None  # hand-imported XOSC: edited as XML
    # A linked or foreign template file is ignored rather than trusted.
    (path.parent / "template.json").symlink_to(path / "manifest.json")
    assert read_imported(workspace, imported["id"])["template"] is None
    (path.parent / "template.json").unlink()
    (path.parent / "template.json").write_text('{"profile": "other"}')
    assert read_imported(workspace, imported["id"])["template"] is None
    (path.parent / "template.json").unlink()
    for bad in ("../x", "a" * 31, None):
        with pytest.raises(ScenarioError) as e:
            read_imported(workspace, bad)
        assert e.value.code == "INVALID_INPUT"
    with pytest.raises(ScenarioError) as missing:
        delete_imported(workspace, "f" * 32)
    assert missing.value.code == "NOT_FOUND"
    (workspace / ("e" * 32)).symlink_to(path.parent)
    with pytest.raises(ScenarioError) as link:
        delete_imported(workspace, "e" * 32)
    assert link.value.code == "PATH_ESCAPE"
    result = delete_imported(workspace, imported["id"])
    trashed = Path(result["trash_path"])
    assert (
        trashed.parent == workspace.resolve() / ".trash"
        and (trashed / "import" / "original.xosc").is_file()
    )
    assert not (workspace / imported["id"]).exists()
    assert [e["scenario_id"] for e in list_imported(workspace)] == []


def test_delete_one_run_preserves_scenario_and_other_runs(tmp_path):
    from topeye.scenario.library import delete_imported_run

    path, _, imported = package(tmp_path)
    project = path.parent
    run(project, "a" * 32, {"status": "completed"})
    run(project, "b" * 32, {"status": "failed"})
    original = (path / "original.xosc").read_bytes()
    result = delete_imported_run(project.parent, imported["id"], "a" * 32)
    assert (Path(result["trash_path"]) / "status.json").is_file()
    assert (path / "original.xosc").read_bytes() == original
    assert [r["run_id"] for r in list_imported(project.parent)[0]["runs"]] == ["b" * 32]


@pytest.mark.parametrize("attack", ["traversal", "running", "run_link", "runs_link", "trash_link"])
def test_delete_run_rejects_unsafe_or_running_target(tmp_path, attack):
    from topeye.scenario.library import delete_imported_run

    path, _, imported = package(tmp_path)
    project = path.parent
    rid = "a" * 32
    run(project, rid, {"status": "running" if attack == "running" else "completed"})
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep").write_text("keep")
    if attack == "run_link":
        (project / "runs" / rid).rename(project / "runs" / "backup")
        (project / "runs" / rid).symlink_to(outside)
    elif attack == "runs_link":
        (project / "runs").rename(project / "saved_runs")
        (project / "runs").symlink_to(outside)
    elif attack == "trash_link":
        (project.parent / ".trash").symlink_to(outside)
    with pytest.raises(ScenarioError):
        delete_imported_run(
            project.parent, imported["id"], "../outside" if attack == "traversal" else rid
        )
    assert (outside / "keep").read_text() == "keep"
    assert path.is_dir()
