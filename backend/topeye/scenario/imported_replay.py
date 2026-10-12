"""Atomic import packages and isolated measured replay; legacy admission unchanged."""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

from topeye.scenario.map_context import check_map, footprint, verify_context
from topeye.scenario.models import (
    ScenarioError,
    guard_output,
    interpolate,
    matrix,
    require,
    sha256,
    write_json,
)
from topeye.scenario.xosc_import import normalized_xml, validate_xosc

PAYLOADS = {"original.xosc", "normalized.xosc", "context.json", "scenario.json"}


def semantic(scenario):
    return {
        k: scenario[k]
        for k in ("schema_version", "mode", "profile", "map_id", "interval_s", "actors", "import")
    }


def require_ipc_budget(value):
    # Reserve 1MiB of the 8MiB transport buffer for protocol metadata/escaping.
    size = len(json.dumps(value, allow_nan=False).encode("utf-8"))
    require(
        size <= 7 * 1024 * 1024,
        "Scenario result exceeds desktop transport budget",
        "RESOURCE_LIMIT",
    )


def public_observed(observed):
    keys = ("id", "t_s", "x_m", "y_m", "z_m", "yaw_rad")
    return [{k: row[k] for k in keys} for row in observed]


def contact_observations(measured, times):
    contacts = {}
    for index, time_s in enumerate(times):
        boxes = [(a["id"], footprint(a, a["samples"][index])) for a in measured]
        for j, (name, p) in enumerate(boxes):
            for other, q in boxes[j + 1 :]:
                if p.intersects(q):
                    pair = tuple(sorted((name, other)))
                    observation = contacts.setdefault(
                        pair,
                        {
                            "actors": list(pair),
                            "first_t_s": float(time_s),
                            "last_t_s": float(time_s),
                            "contact_samples": 0,
                        },
                    )
                    observation["last_t_s"] = float(time_s)
                    observation["contact_samples"] += 1
    return [contacts[pair] for pair in sorted(contacts)]


def persist_import(imported, xml_bytes, context, workspace, dataset):
    require_ipc_budget(imported)
    checked = validate_xosc(xml_bytes, context)
    require(
        semantic(checked) == semantic(imported),
        "Import does not match validated XML",
        "HASH_MISMATCH",
    )
    normalized = normalized_xml(xml_bytes)
    require(re.fullmatch(r"[a-f0-9]{32}", imported["id"]), "Invalid scenario identity")
    workspace = guard_output(workspace, dataset)
    destination = workspace / imported["id"]
    require(not destination.exists(), "Import already exists")
    workspace.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=".import-", dir=workspace))
    try:
        package = temp / "import"
        package.mkdir()
        (package / "original.xosc").write_bytes(xml_bytes)
        (package / "normalized.xosc").write_bytes(normalized)
        write_json(package / "context.json", context)
        stored_import = json.loads(json.dumps(imported))
        stored_import["environment"]["polygons"] = context["polygons"]
        write_json(package / "scenario.json", stored_import)
        write_json(
            package / "manifest.json",
            {
                "schema_version": 1,
                "kind": "imported",
                "scenario_id": imported["id"],
                "map_id": context["map_id"],
                "files": {n: sha256(package / n) for n in PAYLOADS},
            },
        )
        os.rename(temp, destination)
        return destination / "import"
    except BaseException:
        shutil.rmtree(temp)
        raise


def load_imported(package_path, context, dataset):
    raw = Path(package_path)
    require(not raw.is_symlink(), "Package symlink forbidden", "PATH_ESCAPE")
    package = guard_output(raw, dataset)
    require(package.is_dir(), "Import package missing", "IO_ERROR")
    for name in PAYLOADS | {"manifest.json"}:
        p = package / name
        require(
            p.is_file() and not p.is_symlink(), "Missing or linked import payload", "PATH_ESCAPE"
        )
        require(
            p.stat().st_size <= (2097152 if name.endswith("xosc") else 32 * 1024 * 1024),
            "Oversized package payload",
            "RESOURCE_LIMIT",
        )
    try:
        manifest = json.loads((package / "manifest.json").read_text())
        require(
            isinstance(manifest, dict)
            and manifest.get("schema_version") == 1
            and manifest.get("kind") == "imported"
            and isinstance(manifest.get("files"), dict)
            and set(manifest["files"]) == PAYLOADS,
            "Invalid import manifest",
            "HASH_MISMATCH",
        )
        require(
            all(sha256(package / n) == h for n, h in manifest["files"].items()),
            "Import integrity mismatch",
            "HASH_MISMATCH",
        )
        stored = json.loads((package / "context.json").read_text())
        scenario = json.loads((package / "scenario.json").read_text())
        verify_context(stored)
        verify_context(context)
        require(
            stored["map_id"] == context["map_id"] == manifest["map_id"] == scenario["map_id"],
            "Current map mismatch",
            "MAP_MISMATCH",
        )
        require(
            scenario["id"] == manifest["scenario_id"]
            and re.fullmatch(r"[a-f0-9]{32}", scenario["id"]),
            "Import identity mismatch",
            "HASH_MISMATCH",
        )
        original = (package / "original.xosc").read_bytes()
        checked = validate_xosc(original, context)
        require(
            semantic(checked) == semantic(scenario),
            "Stored scenario differs from XML",
            "HASH_MISMATCH",
        )
        require(
            (package / "normalized.xosc").read_bytes() == normalized_xml(original),
            "Normalized XML mismatch",
            "HASH_MISMATCH",
        )
        # Context geometry is authoritative; reject arbitrary environment substitutions.
        env = scenario.get("environment")
        require(
            isinstance(env, dict) and env.get("polygons") == context["polygons"],
            "Stored environment map mismatch",
            "HASH_MISMATCH",
        )
        require_ipc_budget(scenario)
        return scenario
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, ScenarioError):
            raise
        raise ScenarioError("HASH_MISMATCH", "Malformed import package") from exc


def run_imported_replay(imported, context, engine, output, cancel=None):
    package = Path(imported["package_path"])
    dataset = imported["source"]["dataset_root"]
    scenario = load_imported(package, context, dataset)
    require(
        semantic(imported) == semantic(scenario),
        "Cached import differs from package",
        "HASH_MISMATCH",
    )
    engine = Path(engine).resolve()
    require(engine.is_file(), "esmini is not installed", "ENGINE_MISSING")
    output = guard_output(output, dataset)
    require(not output.exists(), "Run already exists")
    output.mkdir(parents=True)
    write_json(output / "status.json", {"status": "running"})
    command = [sys.executable, "-m", "topeye.scenario.worker"]
    command += ["--engine-child-imported", str(package.resolve()), str(engine), str(output)]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[2])
    with (output / "engine-output.log").open("w") as log:
        process = subprocess.Popen(
            command,
            cwd=package,
            stdout=log,
            stderr=subprocess.STDOUT,
            env=env,
        )
        deadline = time.monotonic() + max(60, scenario["interval_s"][1] * 10)
        try:
            while process.poll() is None:
                if cancel is not None and cancel.is_set():
                    raise ScenarioError("CANCELLED", "Replay cancelled")
                if time.monotonic() > deadline:
                    raise ScenarioError("TIMEOUT", "Replay timed out")
                time.sleep(0.05)
            require(
                process.returncode == 0,
                "Imported engine failed; see engine-output.log",
                "ENGINE_FAILED",
            )
        except BaseException as exc:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            write_json(
                output / "status.json",
                {
                    "status": "interrupted"
                    if getattr(exc, "code", None) == "CANCELLED"
                    else "failed",
                    "code": getattr(exc, "code", "INTERNAL"),
                    "exit_code": process.returncode,
                },
            )
            raise
    observed = json.loads((output / "observed.json").read_text())
    duration = scenario["interval_s"][1]
    expected_times = np.arange(int((duration + 1e-9) / 0.05) + 1) * 0.05
    if abs(expected_times[-1] - duration) > 1e-9:
        expected_times = np.append(expected_times, duration)
    max_xy, max_yaw = 0.0, 0.0
    measured = []
    for actor in scenario["actors"]:
        rows = [r for r in observed if r["id"] == actor["id"]]
        require(
            len(rows) == len(expected_times)
            and all(abs(r["t_s"] - t) < 1e-7 for r, t in zip(rows, expected_times)),
            "Incomplete measured timeline",
            "ENGINE_INCOMPATIBLE",
        )
        ref = {**actor, "samples": actor["reference_samples"]}
        expected = interpolate(matrix(ref), expected_times)
        for r, e in zip(rows, expected):
            max_xy = max(max_xy, math.hypot(r["reference_x_m"] - e[1], r["reference_y_m"] - e[2]))
            max_yaw = max(max_yaw, abs(math.remainder(r["yaw_rad"] - e[4], 2 * math.pi)))
        measured.append({**actor, "samples": rows})
    report = {
        "kind": "imported",
        "execution": "pass" if max_xy <= 0.1 and max_yaw <= 0.02 else "fail",
        "fidelity": {"coverage": 1.0, "max_xy_m": max_xy, "max_yaw_rad": max_yaw},
        "map_conformance": "pass",
        "contacts": [],
        "warnings": [
            "Contacts are sampled at 20Hz; geometry is estimated, not a safety certification"
        ],
    }
    try:
        check_map(measured, context)
    except ScenarioError as exc:
        report["map_conformance"] = "fail"
        report["warnings"].append(str(exc))
    report["contacts"] = contact_observations(measured, expected_times)
    write_json(output / "report.json", report)
    write_json(
        output / "status.json",
        {
            "status": "completed",
            "execution": report["execution"],
            "map_conformance": report["map_conformance"],
        },
    )
    result = {"path": str(output), "observed": public_observed(observed), "report": report}
    require_ipc_budget(result)
    return result
