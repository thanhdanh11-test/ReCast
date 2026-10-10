"""Own one simulator subprocess and score its output without fabricating poses."""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from lxml import etree

from topeye.scenario.export import road_xml, scenario_xml, validate_xml
from topeye.scenario.metrics import score_replay
from topeye.scenario.models import (
    ScenarioError,
    guard_output,
    require,
    sha256,
    validate,
    write_json,
)


def run_replay(bundle, engine, output, cancel=None):
    bundle, engine, output = Path(bundle).resolve(), Path(engine).resolve(), Path(output).resolve()
    require(engine.is_file(), "esmini is not installed", "ENGINE_MISSING")
    manifest = json.loads((bundle / "manifest.json").read_text())
    expected_files = {"scenario.xosc", "road.xodr", "reference.json"}
    require(
        manifest.get("schema_version") == 1
        and isinstance(manifest.get("files"), dict)
        and set(manifest["files"]) == expected_files,
        "Invalid bundle manifest",
    )
    require(
        all(not (bundle / name).is_symlink() for name in expected_files),
        "Bundle contains a symlink",
        "PATH_ESCAPE",
    )
    require(
        all(sha256(bundle / name) == digest for name, digest in manifest["files"].items()),
        "Bundle integrity check failed",
    )
    reference = json.loads((bundle / "reference.json").read_text())
    validate(reference)
    require(manifest.get("scenario_id") == reference["id"], "Scenario identity mismatch")
    guard_output(output, reference["source"]["dataset_root"])
    require(not output.exists(), "Run already exists")
    validate_xml(bundle / "scenario.xosc")
    parser = etree.XMLParser(resolve_entities=False, no_network=True, remove_blank_text=True)
    import xml.etree.ElementTree as ET

    for name, generated in (
        ("scenario.xosc", scenario_xml(reference)),
        ("road.xodr", road_xml(reference)),
    ):
        actual = etree.parse(str(bundle / name), parser)
        canonical = etree.fromstring(ET.tostring(generated), parser)
        require(
            etree.tostring(actual, method="c14n") == etree.tostring(canonical, method="c14n"),
            "Bundle XML differs from its validated reference",
        )
    output.mkdir(parents=True)
    write_json(output / "status.json", {"status": "running"})
    command = (
        [sys.executable]
        if getattr(sys, "frozen", False)
        else [sys.executable, "-m", "topeye.scenario.worker"]
    )
    command += ["--engine-child", str(bundle), str(engine), str(output)]
    env = os.environ.copy()
    if not getattr(sys, "frozen", False):
        env["PYTHONPATH"] = str(Path(__file__).resolve().parents[2])
    with (output / "engine-output.log").open("w") as log:
        process = subprocess.Popen(
            command, cwd=bundle, stdout=log, stderr=subprocess.STDOUT, env=env, shell=False
        )
        deadline = time.monotonic() + max(60, reference["interval_s"][1] * 10)
        try:
            while process.poll() is None:
                if cancel is not None and cancel.is_set():
                    raise ScenarioError("CANCELLED", "Replay cancelled")
                if time.monotonic() > deadline:
                    raise ScenarioError("TIMEOUT", "Replay timed out")
                time.sleep(0.05)
            require(
                process.returncode == 0,
                f"esmini failed; see {output / 'engine-output.log'}",
                "ENGINE_FAILED",
            )
        except BaseException as exc:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            code = getattr(exc, "code", "INTERNAL")
            write_json(
                output / "status.json",
                {
                    "status": "interrupted" if code == "CANCELLED" else "failed",
                    "code": code,
                    "exit_code": process.returncode,
                },
            )
            raise
    observed = json.loads((output / "observed.json").read_text())
    report = score_replay(reference, observed)
    report.update(
        {
            "engine_version": "3.9.0",
            "engine_sha256": sha256(engine),
            "scenario_sha256": sha256(bundle / "scenario.xosc"),
            "exit_code": 0,
        }
    )
    report["validity"]["engine_completed"] = True
    write_json(output / "report.json", report)
    write_json(output / "status.json", {"status": "completed", "valid": report["status"] == "pass"})
    return report
