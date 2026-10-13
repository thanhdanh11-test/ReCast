"""Read-only scenario library: imported OpenSCENARIO packages and their esmini runs in a workspace."""

import html
import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path

from topeye.scenario.models import ScenarioError, require

ID = re.compile(r"[a-f0-9]{32}")
NAME_MAX = 120


def display_name(value):
    """Basename of a user-chosen file, stripped of control characters; None when unusable."""
    if not isinstance(value, str):
        return None
    name = re.sub(r"[\x00-\x1f\x7f]", "", value.replace("\\", "/").rsplit("/", 1)[-1]).strip()
    return name[:NAME_MAX] or None


DESCRIPTION = re.compile(rb'<FileHeader\b[^>]*\bdescription="([^"]{1,400})"')


def _description(package):
    """FileHeader description of the stored XOSC (read as bytes, no XML parsing)."""
    try:
        with (package / "original.xosc").open("rb") as f:
            match = DESCRIPTION.search(f.read(8192))
    except OSError:
        return None
    return display_name(html.unescape(match.group(1).decode("utf-8", "replace"))) if match else None


def _iso(path):
    return datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat()


def _json(path):
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _run(run):
    status = _json(run / "status.json")
    if status is None:
        return None
    entry = {
        "run_id": run.name,
        "at": _iso(run / "status.json"),
        "status": status.get("status", "failed"),
    }
    report = _json(run / "report.json")
    if report and report.get("kind") == "imported":
        fidelity = report.get("fidelity") or {}
        entry.update(
            execution=report.get("execution"),
            map_conformance=report.get("map_conformance"),
            coverage=fidelity.get("coverage"),
            max_xy_m=fidelity.get("max_xy_m"),
            max_yaw_rad=fidelity.get("max_yaw_rad"),
            contacts=len(report.get("contacts") or []),
        )
    return entry


def list_imported(workspace):
    root = Path(workspace).resolve()
    if not root.is_dir():
        return []
    entries = []
    for project in root.iterdir():
        package = project / "import"
        manifest_path = package / "manifest.json"
        if (
            not ID.fullmatch(project.name)
            or project.is_symlink()
            or package.is_symlink()
            or not manifest_path.is_file()
            or manifest_path.is_symlink()
            or not package.resolve().is_relative_to(root)
        ):
            continue
        manifest = _json(manifest_path)
        scenario = _json(package / "scenario.json")
        if (
            not manifest
            or manifest.get("schema_version") != 1
            or manifest.get("kind") != "imported"
            or manifest.get("scenario_id") != project.name
            or not scenario
        ):
            continue
        interval = scenario.get("interval_s") or [0, 0]
        runs = [
            r
            for r in (
                _run(run)
                for run in (project / "runs").glob("*")
                if run.is_dir() and not run.is_symlink()
            )
            if r
        ]
        runs.sort(key=lambda r: r["at"], reverse=True)
        entries.append(
            {
                "scenario_id": project.name,
                "package_path": str(package.resolve()),
                "name": display_name(manifest.get("display_name"))
                or _description(package)
                or f"kịch bản {project.name[:8]}",
                "scene": (scenario.get("source") or {}).get("scene", ""),
                "map_id": manifest.get("map_id", ""),
                "actors": len(scenario.get("actors") or []),
                "duration_s": float(interval[1]) - float(interval[0]),
                "created_at": _iso(manifest_path),
                "runs": runs,
            }
        )
    entries.sort(key=lambda e: e["created_at"], reverse=True)
    return entries


def _project(workspace, scenario_id):
    require(isinstance(scenario_id, str) and ID.fullmatch(scenario_id), "Invalid scenario identity")
    root = Path(workspace).resolve()
    project = root / scenario_id
    require(
        not project.is_symlink() and not (project / "import").is_symlink(),
        "Package symlink forbidden",
        "PATH_ESCAPE",
    )
    require(
        (project / "import" / "manifest.json").is_file(), "Không tìm thấy kịch bản", "NOT_FOUND"
    )
    require(project.resolve().is_relative_to(root), "Package outside workspace", "PATH_ESCAPE")
    return root, project


def read_imported(workspace, scenario_id):
    """Original XOSC of a library package, for export and editing."""
    _, project = _project(workspace, scenario_id)
    original = project / "import" / "original.xosc"
    require(original.stat().st_size <= 2 * 1024 * 1024, "XOSC tối đa 2 MiB", "RESOURCE_LIMIT")
    manifest = _json(project / "import" / "manifest.json") or {}
    stored = display_name(manifest.get("display_name"))
    name = stored or _description(project / "import") or f"kịch bản {scenario_id[:8]}"
    file_name = (
        stored
        if stored and stored.lower().endswith(".xosc")
        else f"{re.sub(r'[^A-Za-z0-9._-]+', '-', name).strip('-')[:80] or scenario_id[:8]}.xosc"
    )
    try:
        xml = original.read_bytes().decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ScenarioError("IO_ERROR", "XOSC không phải UTF-8") from exc
    return {"scenario_id": scenario_id, "name": name, "file_name": file_name, "xml": xml}


def delete_imported(workspace, scenario_id):
    """Move a package (with its runs) into <workspace>/.trash — recoverable, never deleted outright."""
    root, project = _project(workspace, scenario_id)
    trash = root / ".trash"
    trash.mkdir(exist_ok=True)
    require(not trash.is_symlink(), "Trash symlink forbidden", "PATH_ESCAPE")
    target = trash / f"{scenario_id}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}"
    shutil.move(str(project), str(target))
    return {"trash_path": str(target)}
