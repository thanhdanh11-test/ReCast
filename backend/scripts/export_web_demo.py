"""Export worker responses for the static demo; never modify source metadata."""

import argparse
import gzip
import hashlib
import json
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from topeye.scenario.models import ScenarioError
from topeye.scenario.worker import Service

ROOT = Path(__file__).resolve().parents[2]
PILOT_TOKEN = "ec0e6425eae2442698ff7b43d405d279"


def compact(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def lookup_key(values):
    def normalize(value):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, list):
            return [normalize(item) for item in value]
        return value

    return hashlib.sha256(compact(normalize(values))).hexdigest()[:16]


def extract_key(scene, actor_tokens, start_s, end_s):
    return lookup_key([scene, sorted(actor_tokens), start_s, end_s])


def variant_key(scenario_id, target_actor, speed_factor, gap_offset_m):
    return lookup_key([scenario_id, target_actor, speed_factor, gap_offset_m])


def metadata_hashes(dataset):
    files = sorted((dataset / "v1.0-mini").glob("*.json"))
    if len(files) != 13:
        raise ValueError("Expected 13 nuScenes mini metadata files")
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}


def public_value(value, private_roots):
    """Copy responses, blank private path fields, preserve all numeric measurements."""
    if isinstance(value, dict):
        return {
            key: "" if key in {"dataset_root", "path"} else public_value(item, private_roots)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [public_value(item, private_roots) for item in value]
    if isinstance(value, str):
        for root in private_roots:
            value = value.replace(str(root), "<local>")
        if "/Users/" in value or value.startswith("/"):
            raise ValueError("Unexpected absolute path in public response")
    return value


def generate(dataset, engine, workspace, staging):
    service = Service()
    common = {
        "dataset": str(dataset),
        "dataset_version": "v1.0-mini",
        "workspace": str(workspace),
        "engine": str(engine),
    }
    private_roots = sorted([dataset, workspace, engine, ROOT], key=lambda p: -len(str(p)))
    manifest = {
        "schema": "topeye-web-demo-v1",
        "app_version": json.loads((ROOT / "frontend/package.json").read_text())["version"],
        "generated_at": datetime.now(timezone(timedelta(hours=7))).isoformat(),
        "dataset": {"name": "nuScenes", "version": "v1.0-mini", "license": "CC BY-NC-SA 4.0"},
        "engine": {"name": "esmini", "version": "3.9.0"},
        "extracts": [],
        "variants": [],
        "replays": [],
        "skipped": [],
        "files": {},
    }

    def call(method, **params):
        return service.call(method, {**common, **params})

    def write(relative, value):
        data = compact(public_value(value, private_roots))
        path = staging / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        manifest["files"][f"data/{relative}"] = hashlib.sha256(data).hexdigest()

    def skipped(key, exc):
        manifest["skipped"].append({"key": key, "reason": f"{exc.code}: {exc}"})

    def replay(scenario_id):
        try:
            result = call("replay", scenario_id=scenario_id)
        except ScenarioError as exc:
            skipped(scenario_id, exc)
            return
        write(f"replay/{scenario_id}.json", result)
        manifest["replays"].append(scenario_id)

    scenes = call("list_scenes")
    if len(scenes) != 10:
        raise ValueError("Expected all 10 mini scenes")
    write("scenes.json", scenes)
    for scene in scenes:
        name = scene["scene"]
        write(f"source/{name}.json", call("source_scene", scene=name))
        pilot = name == "scene-0103"
        params = {
            "scene": name,
            "actor_tokens": [PILOT_TOKEN] if pilot else [t["token"] for t in scene["tracks"][:1]],
            "start_s": 8 if pilot else 3,
            "end_s": 13 if pilot else 8,
        }
        key = extract_key(**params)
        try:
            scenario = call("extract", **params)
        except ScenarioError as exc:
            skipped(key, exc)
            continue
        write(f"extract/{key}.json", scenario)
        manifest["extracts"].append({"key": key, **params, "scenario_id": scenario["id"]})
        replay(scenario["id"])
        if pilot:
            target = next(a["id"] for a in scenario["actors"] if a["role"] == "traffic")
            for speed, gap in [(0.8, 0), (1.2, 0), (1.0, 2)]:
                args = {
                    "scenario_id": scenario["id"],
                    "target_actor": target,
                    "speed_factor": speed,
                    "gap_offset_m": gap,
                }
                key = variant_key(**args)
                try:
                    variant = call("variant", **args)
                except ScenarioError as exc:
                    skipped(key, exc)
                    continue
                write(f"variant/{key}.json", variant)
                manifest["variants"].append({"key": key, **args, "result_id": variant["id"]})
                replay(variant["id"])
    pilot = [e for e in manifest["extracts"] if e["scene"] == "scene-0103"]
    ids = [e["scenario_id"] for e in pilot] + [v["result_id"] for v in manifest["variants"]]
    if len(ids) != 4 or not set(ids).issubset(manifest["replays"]):
        raise ValueError("Pilot requires baseline and three real variant replays")
    # A manifest cannot contain its own file hash. Index every payload, excluding itself.
    (staging / "manifest.json").write_bytes(compact(public_value(manifest, private_roots)))
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("dataset", "engine", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--workspace", type=Path)
    args = parser.parse_args(argv)
    dataset, engine, out = (p.expanduser().resolve() for p in (args.dataset, args.engine, args.out))
    if not engine.is_file():
        print("ENGINE_MISSING: esmini is not installed", file=sys.stderr)
        return 3
    try:
        if out.exists():
            raise ValueError("Output already exists; choose a fresh directory")
        if out.is_relative_to(dataset):
            raise ValueError("Output must be outside dataset")
        if args.workspace and args.workspace.resolve().is_relative_to(dataset):
            raise ValueError("Workspace must be outside dataset")
        before = metadata_hashes(dataset)
        out.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="topeye-web-work-") as temporary:
            workspace = args.workspace.resolve() if args.workspace else Path(temporary)
            with tempfile.TemporaryDirectory(prefix=".web-export-", dir=out.parent) as temp:
                staging = Path(temp) / "data"
                staging.mkdir()
                try:
                    manifest = generate(dataset, engine, workspace, staging)
                finally:
                    try:
                        after = metadata_hashes(dataset)
                    except (OSError, ValueError) as exc:
                        raise RuntimeError("DATASET_CHANGED: metadata no longer readable") from exc
                    if before != after:
                        raise RuntimeError("DATASET_CHANGED: metadata hashes differ")
                files = list(staging.rglob("*.json"))
                summary = {
                    "files": len(files),
                    "bytes": sum(p.stat().st_size for p in files),
                    "gzip_bytes": sum(len(gzip.compress(p.read_bytes(), mtime=0)) for p in files),
                    "metadata_files": len(before),
                    "metadata_unchanged": True,
                    "extracts": len(manifest["extracts"]),
                    "variants": len(manifest["variants"]),
                    "replays": len(manifest["replays"]),
                    "skipped": manifest["skipped"],
                }
                staging.rename(out)
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except (OSError, ValueError, ScenarioError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
