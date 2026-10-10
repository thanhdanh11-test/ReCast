"""Reproducible engine probe and end-to-end acceptance commands."""

import argparse
import tempfile
import uuid
from pathlib import Path

import numpy as np

from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.scenario.export import export_bundle
from topeye.scenario.extract import extract_scene, list_scenes
from topeye.scenario.metrics import score_replay
from topeye.scenario.models import ScenarioError, interpolate, matrix, samples, write_json
from topeye.scenario.replay import run_replay
from topeye.scenario.variants import make_variant


def probe(engine, workspace):
    actors = []
    for i in range(2):
        rows = np.array(
            [[t, 100 + i * 10 + (5 * t if i else 0), 30, 1.25, 0] for t in np.arange(0, 3.1, 0.5)]
        )
        actors.append(
            {
                "id": "ego" if i == 0 else "vehicle_1",
                "instance_token": None,
                "role": "ego" if i == 0 else "traffic",
                "category": "vehicle.car",
                "length_m": 4,
                "width_m": 2,
                "height_m": 1.5,
                "samples": samples(rows, rows[:, 0]),
            }
        )
    scenario = {
        "schema_version": 1,
        "id": uuid.uuid4().hex,
        "actors": actors,
        "interval_s": [0, 3],
        "source": {
            "scene": "engine-probe",
            "dataset_root": str(workspace / "unused-source"),
            "origin_global_m": [0, 0, 0],
        },
        "road": {"kind": "synthetic_corridor", "heading_rad": 0},
    }
    export_bundle(scenario, workspace / "bundle")
    result = run_replay(workspace / "bundle", engine, workspace / "run")
    write_json(workspace / "engine-probe.json", result)
    return result


def reference_is_eligible(scenario):
    # Preflight only: these inferred poses never count as simulator evidence.
    timeline = np.arange(0, scenario["interval_s"][1] + 1e-7, 0.05)
    rows = [
        dict(row, id=actor["id"])
        for actor in scenario["actors"]
        for row in samples(interpolate(matrix(actor), timeline))
    ]
    return score_replay(scenario, rows)["status"] == "pass"


def accept(dataset, engine, workspace):
    adapter = NuScenesAdapter(dataset)
    choices = sorted(list_scenes(adapter), key=lambda s: s["scene"] != "scene-0103")
    base = None
    for scene in choices:
        for track in scene["tracks"][:15]:
            for start in range(16):
                try:
                    candidate = extract_scene(
                        adapter, scene["scene"], [track["token"]], start, start + 5
                    )
                    variants = [
                        make_variant(candidate, "vehicle_1", a, d)
                        for a, d in [(0.8, 0), (1.2, 0), (1, 2)]
                    ]
                    if not all(reference_is_eligible(s) for s in [candidate, *variants]):
                        continue
                    base = candidate
                    break
                except ScenarioError:
                    continue
            if base:
                break
        if base:
            break
    if base is None:
        raise ScenarioError("UNSUPPORTED_ROAD", "No eligible scene segment found")
    cases = []
    for label, scenario in zip(["baseline", "slower", "faster", "offset"], [base, *variants]):
        bundle = workspace / label / "bundle"
        export_bundle(scenario, bundle)
        result = run_replay(bundle, engine, workspace / label / "run")
        cases.append({"case": label, "scenario_id": scenario["id"], "report": result})
    summary = {
        "scene": base["source"]["scene"],
        "generated": len(cases),
        "valid": sum(c["report"]["status"] == "pass" for c in cases),
        "cases": cases,
    }
    write_json(workspace / "acceptance.json", summary)
    return summary


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=["probe-engine", "accept"])
    p.add_argument("--engine", type=Path, required=True)
    p.add_argument("--dataset", type=Path)
    p.add_argument("--workspace", type=Path)
    args = p.parse_args()
    workspace = args.workspace or Path(tempfile.mkdtemp(prefix="topeye-probe-"))
    workspace.mkdir(parents=True, exist_ok=True)
    if args.command == "probe-engine":
        result = probe(args.engine, workspace)
        print(f"Engine probe: {result['status']} · {workspace}")
        raise SystemExit(0 if result["status"] == "pass" else 1)
    if not args.dataset:
        p.error("accept requires --dataset")
    result = accept(args.dataset, args.engine, workspace)
    print(f"{result['valid']}/{result['generated']} valid scenarios · {workspace}")
    raise SystemExit(0 if result["valid"] == result["generated"] else 1)


if __name__ == "__main__":
    main()
