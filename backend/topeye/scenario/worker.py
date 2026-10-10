"""Private JSONL worker owned by Electron. No socket or public HTTP endpoint."""

import copy
import json
import sys
import traceback
import uuid
from collections import OrderedDict
from pathlib import Path

from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.scenario.export import export_bundle
from topeye.scenario.extract import extract_scene, list_scenes
from topeye.scenario.models import ScenarioError, guard_output, require, write_json
from topeye.scenario.replay import run_replay
from topeye.scenario.source_scene import source_scene
from topeye.scenario.variants import make_variant

# Source scenes are deterministic for a dataset/version/scene; rebuilding costs seconds of LiDAR
# work. Kept in memory only (a new worker process starts empty, so code updates never reuse it).
SOURCE_CACHE_SIZE = 12  # whole v1.0-mini (10 scenes); bounded for full datasets


class Service:
    def __init__(self):
        self.adapter = None
        self.scenarios = {}
        self.sources = {}
        self.source_cache = OrderedDict()
        self.imports = {}
        self.recovered_workspaces = set()

    @staticmethod
    def public_import(scenario):
        """Keep engine reference-point data private and bound the JSONL result."""
        public = {
            **scenario,
            "actors": [
                {k: v for k, v in actor.items() if k != "reference_samples"}
                for actor in scenario["actors"]
            ],
        }
        require(
            len(json.dumps(public, ensure_ascii=False, allow_nan=False).encode())
            <= 8 * 1024 * 1024 - 1024,
            "Kịch bản vượt giới hạn phản hồi",
            "RESOURCE_LIMIT",
        )
        return public

    @staticmethod
    def recover(workspace, dataset):
        dataset = Path(dataset).resolve()
        # Only completed, self-identifying project bundles establish ownership.
        for manifest in [
            *workspace.glob("*/bundle/manifest.json"),
            *workspace.glob("*/import/manifest.json"),
        ]:
            project = manifest.parent.parent
            if manifest.is_symlink() or not manifest.resolve().is_relative_to(workspace):
                continue
            try:
                metadata = json.loads(manifest.read_text())
                if not isinstance(metadata, dict):
                    continue
                identity = metadata.get("scenario_id")
                if identity != project.name or len(identity) != 32:
                    continue
                for status in project.glob("runs/*/status.json"):
                    if status.is_symlink() or not status.resolve().is_relative_to(
                        project.resolve()
                    ):
                        continue
                    if status.resolve().is_relative_to(dataset):
                        continue
                    marker = json.loads(status.read_text())
                    if isinstance(marker, dict) and marker.get("status") == "running":
                        write_json(status, {"status": "interrupted"})
            except (OSError, ValueError, TypeError):
                # A damaged prior project must not prevent opening a different one.
                continue

    def call(self, method, params, progress=lambda *args: None):
        require(
            method
            in {
                "list_scenes",
                "source_scene",
                "extract",
                "variant",
                "export",
                "replay",
                "inspect_dataset",
                "map_context",
                "import_xosc",
                "open_imported",
                "replay_imported",
            },
            "Unknown operation",
        )
        if method == "inspect_dataset":
            from topeye.scenario.dataset import inspect_dataset

            return inspect_dataset(params["dataset"])

        root = Path(params["dataset"]).expanduser().resolve()
        version = params.get("dataset_version") or "v1.0-mini"
        if (
            self.adapter is None
            or self.adapter.root != root
            or getattr(self.adapter, "version", "v1.0-mini") != version
        ):
            self.adapter = NuScenesAdapter(root, version)
            self.scenarios.clear()
            self.sources.clear()
            self.source_cache.clear()
            self.imports.clear()
        workspace = guard_output(params["workspace"], self.adapter.root)
        if workspace not in self.recovered_workspaces:
            self.recover(workspace, self.adapter.root)
            self.recovered_workspaces.add(workspace)
        if method == "list_scenes":
            return list_scenes(self.adapter)
        if method == "source_scene":
            scene = params["scene"]
            if scene in self.source_cache:
                self.source_cache.move_to_end(scene)
                source = copy.deepcopy(self.source_cache[scene])
                source["id"] = uuid.uuid4().hex  # every load stays a distinct source
            else:
                source = source_scene(self.adapter, scene, progress)
                self.source_cache[scene] = copy.deepcopy(source)
                if len(self.source_cache) > SOURCE_CACHE_SIZE:
                    self.source_cache.popitem(last=False)
            source["source"]["dataset_version"] = version
            source["source"]["dataset_root"] = str(self.adapter.root)
            self.sources[source["id"]] = source
            return source
        if method in {"map_context", "import_xosc", "open_imported"}:
            from topeye.scenario.map_context import build_map_context

            source = self.sources.get(params.get("source_id"))
            require(source is not None, "Tải lại cảnh nguồn trước", "STALE_CONTEXT")
            context = build_map_context(source)
            if method == "map_context":
                return context
            from topeye.scenario.imported_replay import (
                load_imported,
                persist_import,
                require_ipc_budget,
            )
            from topeye.scenario.xosc_import import validate_xosc

            if method == "import_xosc":
                import base64

                encoded = params.get("xml_base64")
                require(
                    isinstance(encoded, str) and len(encoded) <= 2796204,
                    "File XOSC quá lớn",
                    "RESOURCE_LIMIT",
                )
                xml_bytes = base64.b64decode(encoded, validate=True)
                imported = validate_xosc(xml_bytes, context)
                imported["source"]["source_id"] = source["id"]
                imported["source"]["dataset_root"] = str(self.adapter.root)
                imported["environment"] = source["environment"]
                require_ipc_budget(imported)
                self.public_import(imported)
                package = persist_import(imported, xml_bytes, context, workspace, self.adapter.root)
            else:
                package = Path(params["package_path"])
                imported = load_imported(package, context, self.adapter.root)
                imported["source"]["source_id"] = source["id"]
                imported["environment"] = source["environment"]
            imported["source"]["dataset_root"] = str(self.adapter.root)
            require_ipc_budget(imported)
            self.imports[imported["id"]] = {
                "scenario": imported,
                "context": context,
                "source_id": source["id"],
                "package": str(package),
            }
            return self.public_import(imported)
        if method == "replay_imported":
            from topeye.scenario.imported_replay import run_imported_replay
            from topeye.scenario.map_context import build_map_context

            entry = self.imports.get(params.get("scenario_id"))
            require(entry is not None, "Nạp lại kịch bản trước", "STALE_CONTEXT")
            source = self.sources.get(entry["source_id"])
            require(source is not None, "Tải lại cảnh nguồn trước", "STALE_CONTEXT")
            context = build_map_context(source)
            require(
                context["map_id"] == entry["context"]["map_id"], "Map đã thay đổi", "MAP_MISMATCH"
            )
            output = workspace / entry["scenario"]["id"] / "runs" / uuid.uuid4().hex
            progress("Đang chạy kịch bản đã nạp", 0, 1)
            # The package path is app-owned and reverified by the replay layer.
            imported = {**entry["scenario"], "package_path": entry["package"]}
            result = run_imported_replay(imported, context, Path(params["engine"]), output)
            progress("Đã đo kịch bản đã nạp", 1, 1)
            return result
        if method == "extract":
            scenario = extract_scene(
                self.adapter,
                params["scene"],
                params["actor_tokens"],
                params["start_s"],
                params["end_s"],
            )
            self.scenarios[scenario["id"]] = scenario
            return scenario
        require(params.get("scenario_id") in self.scenarios, "Extract a scenario first")
        scenario = self.scenarios[params["scenario_id"]]
        if method == "variant":
            variant = make_variant(
                scenario, params["target_actor"], params["speed_factor"], params["gap_offset_m"]
            )
            self.scenarios[variant["id"]] = variant
            return variant
        workspace = guard_output(params["workspace"], self.adapter.root)
        workspace.mkdir(parents=True, exist_ok=True)
        project = workspace / scenario["id"]
        require(not project.is_symlink(), "Project path is a symlink", "PATH_ESCAPE")
        bundle = project / "bundle"
        require(
            not bundle.is_symlink() and not (project / "runs").is_symlink(),
            "Project children must not be symlinks",
            "PATH_ESCAPE",
        )
        if not bundle.exists():
            export_bundle(scenario, bundle)
        if method == "export":
            return {"path": str(bundle), "scenario_id": scenario["id"]}
        engine = Path(params["engine"])
        output = project / "runs" / uuid.uuid4().hex
        progress("Đang phát lại bằng esmini", 0, 1)
        report = run_replay(bundle, engine, output)
        progress("Đã đo kết quả phát lại", 1, 1)
        return {
            "report": report,
            "path": str(output),
            "observed": json.loads((output / "observed.json").read_text()),
        }


def main():
    if len(sys.argv) == 5 and sys.argv[1] == "--engine-child-imported":
        from topeye.scenario.engine import execute_imported

        execute_imported(*sys.argv[2:])
        return
    if len(sys.argv) == 5 and sys.argv[1] == "--engine-child":
        from topeye.scenario.engine import execute

        execute(*sys.argv[2:])
        return
    service = Service()

    def send(value):
        print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)

    send({"type": "ready", "protocol": 1})
    while True:
        line = sys.stdin.buffer.readline(8 * 1024 * 1024 + 1)
        if not line:
            break
        if len(line) > 8 * 1024 * 1024:
            send(
                {
                    "id": None,
                    "type": "error",
                    "code": "INVALID_INPUT",
                    "message": "Request too large",
                }
            )
            break
        identity = None
        try:
            request = json.loads(line)
            identity = request["id"]
            require(isinstance(identity, str) and len(identity) <= 64, "Invalid request ID")
            result = service.call(
                request["method"],
                request["params"],
                lambda phase, completed, total, identity=identity: send(
                    {
                        "id": identity,
                        "type": "progress",
                        "phase": phase,
                        "completed": completed,
                        "total": total,
                    }
                ),
            )
            send({"id": identity, "type": "result", "value": result})
        except Exception as exc:  # noqa: BLE001 — process boundary returns one terminal error
            traceback.print_exc(file=sys.stderr)
            code = exc.code if isinstance(exc, ScenarioError) else "INVALID_INPUT"
            send({"id": identity, "type": "error", "code": code, "message": str(exc)})


if __name__ == "__main__":
    main()
