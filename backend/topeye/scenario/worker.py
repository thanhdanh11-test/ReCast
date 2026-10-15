"""Private JSONL worker owned by the localhost web server (frontend/server). No socket of its own."""

import copy
import json
import os
import re
import sys
import tempfile
import traceback
import uuid
from collections import OrderedDict
from pathlib import Path

from topeye.scenario.dataset import create_adapter
from topeye.scenario.export import export_bundle
from topeye.scenario.extract import extract_scene, list_scenes
from topeye.scenario.library import (
    delete_imported,
    delete_imported_run,
    display_name,
    list_imported,
    read_imported,
)
from topeye.scenario.lidar_frame import lidar_frame
from topeye.scenario.models import ScenarioError, guard_output, require, write_json
from topeye.scenario.pastel import apply_pastel
from topeye.scenario.replay import run_replay
from topeye.scenario.source_scene import source_scene
from topeye.scenario.variants import make_variant

# Source scenes are deterministic for a dataset/version/scene; rebuilding costs seconds of LiDAR
# work. Kept in memory only (a new worker process starts empty, so code updates never reuse it).
SOURCE_CACHE_SIZE = 12  # whole v1.0-mini (10 scenes); bounded for full datasets


def decode_package(raw):
    """[{name, data_base64}] from the HTTP layer → {basename: bytes} (plan43 01 §2)."""
    import base64

    require(isinstance(raw, list) and 1 <= len(raw) <= 3, "Gói real2sim gồm 1–3 file", "INVALID_INPUT")
    files, total = {}, 0
    for item in raw:
        require(isinstance(item, dict), "Invalid package file", "INVALID_INPUT")
        name, data = item.get("name"), item.get("data_base64")
        require(
            isinstance(name, str) and re.fullmatch(r"[^/\\\x00-\x1f]{1,120}", name) and name not in files,
            "Invalid package file name",
            "INVALID_INPUT",
        )
        require(isinstance(data, str), "Invalid package file data", "INVALID_INPUT")
        total += len(data)
        require(total <= 7.8 * 1024 * 1024, "Gói real2sim quá lớn (tối đa 7,8 MiB sau mã hoá)", "RESOURCE_LIMIT")
        try:
            files[name] = base64.b64decode(data, validate=True)
        except ValueError as exc:
            raise ScenarioError("INVALID_INPUT", "Invalid package file data") from exc
    return files


class Service:
    def __init__(self):
        self.adapter = None
        self.spare_adapter = None  # last successfully inspected dataset
        self.scenarios = {}
        self.sources = {}
        self.source_cache = OrderedDict()
        self.fit_cache = {}
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

    def scenario_metrics(self, params, progress):
        """Metrics of one imported scenario: its XOSC replayed in esmini vs a constant-velocity baseline."""
        from topeye.scenario.imported_replay import load_imported
        from topeye.scenario.library import _project
        from topeye.scenario.map_context import build_map_context
        from topeye.scenario.scene_metrics import VERSION, scene_metrics

        workspace = guard_output(params["workspace"], self.adapter.root)
        _, project = _project(workspace, params.get("scenario_id"))
        path = project / "metrics" / f"{VERSION}.json"
        if path.is_file():
            try:
                cached = json.loads(path.read_text())
                if cached.get("version") == VERSION:
                    return cached
            except ValueError:
                pass
        package = project / "import"
        gone = ScenarioError("NOT_FOUND", "Kịch bản đã bị xoá")
        from topeye.scenario.real2sim import is_package

        # plan43: real2sim packages carry the tool's own esmini measurements in report.json.
        require(not is_package(package), "Gói real2sim dùng báo cáo của tool, không tính chỉ số", "UNSUPPORTED_KIND")
        try:
            stored = json.loads((package / "scenario.json").read_text())
            source = self.call("source_scene", {**params, "scene": stored["source"]["scene"]})
            # Reverifies hashes, XML and map before anything is measured.
            imported = load_imported(package, build_map_context(source), self.adapter.root)
        except FileNotFoundError as exc:  # deleted (moved to .trash) meanwhile
            raise gone from exc
        scenario = {
            "source": imported["source"],
            "interval_s": imported["interval_s"],
            "environment": source["environment"],
            # Every authored vertex is a reference point ("observed" marks dataset labels only).
            "actors": [
                {**a, "samples": [{**r, "observed": True} for r in a["reference_samples"]]}
                for a in imported["actors"]
            ],
        }
        # Engine bundles are scratch: outside the package so a concurrent delete moves nothing half-written.
        with tempfile.TemporaryDirectory(prefix="topeye-metrics-") as scratch:
            try:
                result = scene_metrics(
                    scenario,
                    params.get("engine"),
                    cache_dir=scratch,
                    progress=progress,
                    pilot_bundle=package,
                    # Scenario trajectories are authored, not sampled labels: every span is comparable.
                    max_gap=float("inf"),
                )
            except (FileNotFoundError, ScenarioError) as exc:
                # A delete mid-run surfaces as a missing file or a failed engine child.
                if not (package / "manifest.json").is_file():
                    raise gone from exc
                raise
        result["scenario_id"] = imported["id"]
        try:
            # parents=False: never recreate the folder of a scenario deleted while measuring.
            path.parent.mkdir(exist_ok=True)
            temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
            write_json(temporary, result)
            os.replace(temporary, path)
        except FileNotFoundError as exc:
            raise gone from exc
        return result

    def use_adapter(self, root, version):
        root = Path(root).expanduser().resolve()
        if (
            self.adapter is None
            or self.adapter.root != root
            or getattr(self.adapter, "version", "v1.0-mini") != version
        ):
            spare, self.spare_adapter = self.spare_adapter, None
            if spare is not None and (spare.root, spare.version) == (root, version):
                self.adapter = spare
            else:
                self.adapter = create_adapter(root, version)
            self.scenarios.clear()
            self.sources.clear()
            self.source_cache.clear()
            self.fit_cache.clear()
            self.imports.clear()
        return self.adapter

    def cached_source(self, scene, progress):
        """Shared, read-only cached source scene (callers that keep or change it must deep-copy)."""
        if scene in self.source_cache:
            self.source_cache.move_to_end(scene)
            return self.source_cache[scene]
        source = apply_pastel(source_scene(self.adapter, scene, progress))
        self.source_cache[scene] = source
        if len(self.source_cache) > SOURCE_CACHE_SIZE:
            self.source_cache.popitem(last=False)
        return source

    def template_fit(self, params, progress):
        """Would this template compile and pass validate_xosc on `scene`? Same gate as import, no package."""
        import hashlib
        import json

        from topeye.scenario.map_context import build_map_context
        from topeye.scenario.template import compile_template

        scene, template = params.get("scene"), params.get("template")
        require(isinstance(scene, str) and isinstance(template, dict), "Invalid template probe")
        key = (str(self.adapter.root), scene, hashlib.sha256(json.dumps(template, sort_keys=True).encode()).hexdigest())
        if key not in self.fit_cache:
            try:
                source = self.cached_source(scene, progress)
                _, _, placement = compile_template(template, source, build_map_context(source))
                result = {"scene": scene, "ok": True, "placement": placement}
            except ScenarioError as exc:
                result = {"scene": scene, "ok": False, "code": exc.code, "message": str(exc)}
            self.fit_cache[key] = result
            if len(self.fit_cache) > 2000:
                self.fit_cache.pop(next(iter(self.fit_cache)))
        return self.fit_cache[key]

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
                "import_template",
                "import_package",
                "open_imported",
                "replay_imported",
                "lidar_frame",
                "list_imported",
                "read_imported",
                "delete_imported",
                "delete_imported_run",
                "scenario_metrics",
                "template_fit",
            },
            "Unknown operation",
        )
        if method == "inspect_dataset":
            from topeye.scenario.dataset import inspect_dataset

            # Inspection must not disturb the active dataset; keep its adapter aside so
            # switching to it right after (chooseDataset -> list_scenes) does not reload it.
            loaded = []

            def load(root, version):
                if self.adapter is not None and (
                    self.adapter.root,
                    getattr(self.adapter, "version", None),
                ) == (root, version):
                    return self.adapter
                loaded.append(create_adapter(root, version))
                return loaded[0]

            result = inspect_dataset(params["dataset"], load=load)
            if loaded:
                self.spare_adapter = loaded[0]
            return result

        root = Path(params["dataset"]).expanduser().resolve()
        version = params.get("dataset_version") or "v1.0-mini"
        self.use_adapter(root, version)
        if method == "scenario_metrics":
            # Runs on its own worker; like lidar_frame it must not run workspace recovery.
            return self.scenario_metrics(params, progress)
        if method == "template_fit":
            # Read-only probe on the metrics worker: no workspace access, nothing persisted.
            return self.template_fit(params, progress)
        if method == "lidar_frame":
            # Read-only and stateless: must not run workspace recovery (a sibling worker may own runs).
            return lidar_frame(self.adapter, params["scene"], params["time_s"])
        workspace = guard_output(params["workspace"], self.adapter.root)
        if workspace not in self.recovered_workspaces:
            self.recover(workspace, self.adapter.root)
            self.recovered_workspaces.add(workspace)
        if method == "list_scenes":
            return list_scenes(self.adapter)
        if method == "list_imported":
            return list_imported(workspace)
        if method == "read_imported":
            return read_imported(workspace, params.get("scenario_id"))
        if method == "delete_imported_run":
            return delete_imported_run(workspace, params.get("scenario_id"), params.get("run_id"))
        if method == "delete_imported":
            self.imports.pop(params.get("scenario_id"), None)
            return delete_imported(workspace, params.get("scenario_id"))
        if method == "source_scene":
            source = copy.deepcopy(self.cached_source(params["scene"], progress))
            source["id"] = uuid.uuid4().hex  # every load stays a distinct source
            source["source"]["dataset_version"] = version
            source["source"]["dataset_root"] = str(self.adapter.root)
            self.sources[source["id"]] = source
            return source
        if method in {"map_context", "import_xosc", "import_template", "import_package", "open_imported"}:
            from topeye.scenario.map_context import build_map_context

            source = self.sources.get(params.get("source_id"))
            require(source is not None, "Tải lại cảnh nguồn trước", "STALE_CONTEXT")
            context = build_map_context(source)
            if method == "map_context":
                return context
            placement = stored_template = None
            from topeye.scenario.imported_replay import (
                load_imported,
                persist_import,
                require_ipc_budget,
            )
            from topeye.scenario.xosc_import import validate_xosc

            if method == "import_package":
                # plan43: team real2sim replay package — its own admission path, map findings are notes.
                from topeye.scenario.real2sim import parse_package, persist_package

                files = decode_package(params.get("files"))
                imported = parse_package(files, context)
                imported["source"]["source_id"] = source["id"]
                imported["source"]["dataset_root"] = str(self.adapter.root)
                imported["environment"] = source["environment"]
                require_ipc_budget(imported)
                self.public_import(imported)
                package = persist_package(
                    imported, files, context, workspace, self.adapter.root, display_name(imported["import"]["file_name"])
                )
            elif method in {"import_xosc", "import_template"}:
                if method == "import_template":
                    from topeye.scenario.template import compile_template

                    xml_bytes, file_name, placement = compile_template(params.get("template"), source, context)
                    # Stored for "Sửa": the template as given, with the placement that actually fitted.
                    stored_template = {**params["template"], "map": {**params["template"]["map"], "placement": placement}}
                else:
                    import base64

                    encoded = params.get("xml_base64")
                    require(
                        isinstance(encoded, str) and len(encoded) <= 2796204,
                        "File XOSC quá lớn",
                        "RESOURCE_LIMIT",
                    )
                    xml_bytes = base64.b64decode(encoded, validate=True)
                    file_name = params.get("file_name")
                imported = validate_xosc(xml_bytes, context)
                imported["source"]["source_id"] = source["id"]
                imported["source"]["dataset_root"] = str(self.adapter.root)
                imported["environment"] = source["environment"]
                require_ipc_budget(imported)
                self.public_import(imported)
                package = persist_import(
                    imported,
                    xml_bytes,
                    context,
                    workspace,
                    self.adapter.root,
                    display_name(file_name),
                    stored_template,
                )
            else:
                from topeye.scenario.real2sim import is_package, load_package

                package = Path(params["package_path"])
                load = load_package if is_package(package) else load_imported
                imported = load(package, context, self.adapter.root)
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
            result = self.public_import(imported)
            if placement:
                result["placement"] = placement  # where a template landed on the source ego path
            return result
        if method == "replay_imported":
            from topeye.scenario.imported_replay import run_imported_replay
            from topeye.scenario.map_context import build_map_context

            entry = self.imports.get(params.get("scenario_id"))
            require(entry is not None, "Nạp lại kịch bản trước", "STALE_CONTEXT")
            require(entry["scenario"].get("kind") != "real2sim", "Gói real2sim không chạy lại trong app", "UNSUPPORTED_KIND")
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
