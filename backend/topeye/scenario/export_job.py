"""Scenario export jobs (plan50 P04): CARLA package or plain .xosc, written under <workspace>/exports/<id>/.

`create_job` runs on the metrics worker (validates, writes a queued job.json). `run_job` runs in its own process
started by the local server (`python -m topeye.scenario.export_job run ...`), so progress stays readable while
it works. The stored scenario package is never modified; the export is an immutable copy with hashes.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import unicodedata
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from lxml import etree

from topeye.scenario.library import _project, display_name
from topeye.scenario.models import ScenarioError, require, sha256

FORMATS = ("carla", "xosc")
JOB_ID = re.compile(r"[a-f0-9]{32}")
MAX_TOTAL_BYTES = 32 * 1024 * 1024
MAX_XODR_BYTES = 16 * 1024 * 1024
MAX_JOBS = 200
NO_REPORT = "Không có report.json: kịch bản này không có báo cáo gốc (chỉ kịch bản phản ứng/real2sim có)."


class JobAborted(Exception):
    """The job was ended by the server while this process still ran."""


def now():
    return datetime.now(UTC).isoformat()


def exports_root(workspace):
    root = Path(workspace).resolve() / "exports"
    require(not root.is_symlink(), "Exports symlink forbidden", "PATH_ESCAPE")
    return root


def job_dir(workspace, job_id):
    require(isinstance(job_id, str) and JOB_ID.fullmatch(job_id), "Invalid export identity")
    folder = exports_root(workspace) / job_id
    require(not folder.is_symlink(), "Export symlink forbidden", "PATH_ESCAPE")
    return folder


def write_job(folder, job):
    temporary = folder / f".job-{uuid.uuid4().hex}.tmp"
    temporary.write_text(json.dumps(job, ensure_ascii=False, indent=1))
    os.replace(temporary, folder / "job.json")


def read_job(folder):
    return json.loads((folder / "job.json").read_text())


def stem_of(name):
    """ASCII file stem of a display name: Vietnamese letters folded, others to '_', ≤64 chars."""
    base = re.sub(r"\.xosc$", "", name or "", flags=re.IGNORECASE).replace("đ", "d").replace("Đ", "D")
    ascii_ = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode()
    return re.sub(r"_+", "_", re.sub(r"[^A-Za-z0-9_.-]+", "_", ascii_)).strip("_.-")[:64].rstrip(".") or "scenario"


def stored_package(workspace, scenario_id):
    """(manifest, scenario, {file: bytes}) of a library package, every hashed payload verified."""
    _, project = _project(workspace, scenario_id)
    package = project / "import"
    manifest = json.loads((package / "manifest.json").read_text())
    require(isinstance(manifest.get("files"), dict) and manifest["files"], "Invalid import manifest", "HASH_MISMATCH")
    files = {}
    for name, digest in manifest["files"].items():
        path = package / name
        require(re.fullmatch(r"[A-Za-z0-9_.-]+", name) and not path.is_symlink(), "Linked import payload", "PATH_ESCAPE")
        try:
            data = path.read_bytes()
        except (FileNotFoundError, IsADirectoryError) as exc:  # deleted while exporting
            raise ScenarioError("NOT_FOUND", "Kịch bản đã bị xoá") from exc
        require(hashlib.sha256(data).hexdigest() == digest, "Import integrity mismatch", "HASH_MISMATCH")
        files[name] = data
    return manifest, json.loads(files["scenario.json"]), files


def scenario_name(manifest, scenario_id):
    return display_name(manifest.get("display_name")) or f"kịch bản {scenario_id[:8]}"


def carla_town_of(adapter, scene):
    """CARLA town name of a scene recorded in CARLA (plan56: map location `carla-<Town>`), else None."""
    from topeye.scenario.carla_town import LOCATION_PREFIX

    map_info = adapter.scene_map(scene) if hasattr(adapter, "scene_map") else None
    location = map_info[0] if map_info else ""
    return location[len(LOCATION_PREFIX):] if location.startswith(LOCATION_PREFIX) else None


def in_town_frame(xml_bytes, town, origin):
    """plan56 D6: LogicFile = the CARLA town; every WorldPosition shifted from the scene frame by `origin`."""
    root = etree.fromstring(with_road(xml_bytes, town), etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=True))
    for pos in root.iter("WorldPosition"):
        for axis, offset in zip("xyz", origin, strict=False):
            if pos.get(axis) is not None:
                pos.set(axis, f"{float(pos.get(axis)) + float(offset):.4f}".rstrip("0").rstrip("."))
    return etree.tostring(root.getroottree(), xml_declaration=True, encoding="utf-8") + b"\n"


def shifted_csv(csv_bytes, origin):
    """trajectories.csv with x_m / y_m moved by origin (scene frame -> town frame)."""
    import csv
    import io

    rows = list(csv.reader(io.StringIO(csv_bytes.decode())))
    head = rows[0]
    ix, iy = head.index("x_m"), head.index("y_m")
    for row in rows[1:]:
        row[ix] = f"{float(row[ix]) + float(origin[0]):.4f}"
        row[iy] = f"{float(row[iy]) + float(origin[1]):.4f}"
    out = io.StringIO()
    csv.writer(out, lineterminator="\n").writerows(rows)
    return out.getvalue().encode()


def carla_support(adapter, scene):
    """Raise CARLA_UNSUPPORTED unless `scene` has nuScenes map-expansion lane centrelines (D5) or is a CARLA town."""
    from topeye.scenario.source_scene import map_directory

    if carla_town_of(adapter, scene):
        return
    map_info = adapter.scene_map(scene) if hasattr(adapter, "scene_map") else None
    require(map_info and not hasattr(adapter, "vector_map"),
            "Xuất CARLA chỉ hỗ trợ dataset nuScenes có map expansion", "CARLA_UNSUPPORTED")
    candidates = [adapter.root / "maps/expansion" / f"{map_info[0]}.json", map_directory() / f"{map_info[0]}.json"]
    require(any(p.is_file() for p in candidates), f"Thiếu map expansion {map_info[0]}", "CARLA_UNSUPPORTED")


def create_job(workspace, scenario_id, fmt, adapter):
    require(fmt in FORMATS, "Định dạng xuất không hợp lệ", "INVALID_INPUT")
    manifest, scenario, _ = stored_package(workspace, scenario_id)
    scene = (scenario.get("source") or {}).get("scene", "")
    if fmt == "carla":
        carla_support(adapter, scene)
    root = exports_root(workspace)
    root.mkdir(parents=True, exist_ok=True)
    require(sum(1 for p in root.iterdir() if JOB_ID.fullmatch(p.name)) < MAX_JOBS,
            f"Tối đa {MAX_JOBS} bản xuất; xoá bớt trong trang Đã xuất", "RESOURCE_LIMIT")
    job_id = uuid.uuid4().hex
    folder = root / job_id
    folder.mkdir()
    job = {
        "schema_version": 1, "id": job_id, "scenario_id": scenario_id, "name": scenario_name(manifest, scenario_id),
        "scene": scene, "format": fmt, "status": "queued", "progress": 0, "step": "Đang chờ",
        "created_at": now(), "finished_at": None, "files": [], "notes": [], "error": None,
    }
    write_job(folder, job)
    return job


def with_road(xml_bytes, xodr_name):
    """XOSC with RoadNetwork/LogicFile@filepath = xodr_name; everything else kept."""
    root = etree.fromstring(xml_bytes, etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=True))
    network = root.find("RoadNetwork")
    if network is None:
        network = etree.Element("RoadNetwork")
        anchor = next((root.find(t) for t in ("CatalogLocations", "ParameterDeclarations", "FileHeader")
                       if root.find(t) is not None), None)
        if anchor is None:
            root.insert(0, network)
        else:
            anchor.addnext(network)
    logic = network.find("LogicFile")
    if logic is None:
        logic = etree.Element("LogicFile")
        network.insert(0, logic)
    logic.set("filepath", xodr_name)
    return etree.tostring(root.getroottree(), xml_declaration=True, encoding="utf-8") + b"\n"


def actor_tracks(scenario):
    """trajectories.csv tracks of a stored scenario: its authored (reference) samples, else displayed samples."""
    tracks = []
    for a in scenario.get("actors") or []:
        samples = a.get("reference_samples") or a.get("samples") or []
        rows = [(s["t_s"], s["x_m"], s["y_m"], s.get("yaw_rad", 0.0)) for s in samples]
        if rows:
            tracks.append((a["id"], a.get("category", "vehicle.car"), (a["length_m"], a["width_m"], a["height_m"]), rows))
    return tracks


def build_files(workspace, job, adapter, step):
    """{name: bytes} of the export, plus notes. `step(progress, label)` reports real progress."""
    from topeye.scenario.reactive_package import trajectories_csv
    from topeye.scenario.xodr import scene_xodr

    _, scenario, stored = stored_package(workspace, job["scenario_id"])
    stem, notes, files = stem_of(job["name"]), [], {}
    xosc = stored["original.xosc"]
    if job["format"] == "xosc":
        step(30, "Đọc kịch bản")
        files[f"{stem}.xosc"] = xosc
        step(70, "Ghi .xosc")
        return files, notes
    step(10, "Đọc kịch bản")
    tracks = actor_tracks(scenario)
    require(tracks, "Kịch bản không có quỹ đạo", "INVALID_INPUT")
    points = [(x, y) for _, _, _, rows in tracks for _, x, y, _ in rows]
    origin = (scenario.get("source") or {}).get("origin_global_m")
    require(isinstance(origin, list) and len(origin) >= 2, "Kịch bản thiếu gốc toạ độ", "INVALID_INPUT")
    town = carla_town_of(adapter, job["scene"])
    if town:  # plan56: the town brings its own road and 3D world; positions go back to its frame
        step(40, f"Đặt vào {town}")
        files[f"{stem}.xosc"] = in_town_frame(xosc, town, origin)
        step(60, "Viết .xosc")
        files["trajectories.csv"] = shifted_csv(stored.get("trajectories.csv") or trajectories_csv(job["scene"], tracks), origin)
        step(75, "Viết trajectories.csv")
        if "report.json" in stored:
            files["report.json"] = stored["report.json"]
        else:
            notes.append(NO_REPORT)
        job["carla_town"] = {"town": town, "origin": origin}
        step(85, "Viết report và manifest")
        return files, notes
    xodr_name, xodr = scene_xodr(adapter, job["scene"], origin, points)
    require(len(xodr) <= MAX_XODR_BYTES, ".xodr vượt 16 MiB", "RESOURCE_LIMIT")
    step(40, "Dựng bản đồ .xodr")
    files[f"{stem}.xosc"] = with_road(xosc, xodr_name)
    files[xodr_name] = xodr
    step(60, "Viết .xosc")
    files["trajectories.csv"] = stored.get("trajectories.csv") or trajectories_csv(job["scene"], tracks)
    step(75, "Viết trajectories.csv")
    if "report.json" in stored:
        files["report.json"] = stored["report.json"]
    else:
        notes.append(NO_REPORT)
    step(85, "Viết report và manifest")
    return files, notes


def run_job(workspace, job_id, adapter, version="dev"):
    folder = job_dir(workspace, job_id)
    job = read_job(folder)
    if job["status"] not in ("queued", "running"):
        return job

    def settled():
        """The server already ended this job (timeout / interrupted): never overwrite that verdict."""
        try:
            return read_job(folder)["status"] not in ("queued", "running")
        except (OSError, ValueError):
            return True

    def step(progress, label):
        if settled():
            raise JobAborted()
        job.update(status="running", progress=max(job["progress"], progress), step=label)
        write_job(folder, job)

    try:
        step(1, "Bắt đầu")
        files, notes = build_files(workspace, job, adapter, step)
        files["manifest.json"] = json.dumps({
            "schema_version": 1, "tool": "topeye", "version": version, "scenario_id": job["scenario_id"],
            "scene": job["scene"], "format": job["format"],
            "files": [{"name": n, "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()} for n, b in files.items()],
            "notes": notes,
            **({"carla_town": job["carla_town"]} if job.get("carla_town") else {}),
        }, ensure_ascii=False, indent=1).encode()
        require(sum(map(len, files.values())) <= MAX_TOTAL_BYTES, "Gói xuất vượt 32 MiB", "RESOURCE_LIMIT")
        staging = folder / "files.tmp"
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir()
        for name, data in files.items():
            (staging / name).write_bytes(data)
        for name, data in files.items():  # re-read: what is on disk is what the manifest claims
            require(sha256(staging / name) == hashlib.sha256(data).hexdigest(), "Ghi file xuất lỗi", "IO_ERROR")
        os.replace(staging, folder / "files")
        stem = stem_of(job["name"])
        archive = folder / f".{stem}.zip.tmp"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
            for name in files:
                z.write(folder / "files" / name, f"{stem}/{name}")
        os.replace(archive, folder / f"{stem}.zip")
        job.update(status="done", progress=100, step="Hoàn tất", finished_at=now(), notes=notes,
                   files=[{"name": n, "bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()} for n, b in files.items()])
    except JobAborted:
        return read_job(folder) if (folder / "job.json").is_file() else job
    except ScenarioError as exc:
        job.update(status="failed", step="Lỗi", finished_at=now(), error={"code": exc.code, "message": str(exc)})
    except Exception as exc:  # noqa: BLE001 — any failure must end the job, never leave it running
        job.update(status="failed", step="Lỗi", finished_at=now(), error={"code": "INTERNAL", "message": str(exc)[:500]})
    if settled():
        return read_job(folder) if (folder / "job.json").is_file() else job
    write_job(folder, job)
    return job


def main(argv=None):
    from topeye.scenario.dataset import create_adapter

    parser = argparse.ArgumentParser(prog="topeye.scenario.export_job")
    parser.add_argument("command", choices=["run"])
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--dataset-version", default="v1.0-mini")
    parser.add_argument("--job", required=True)
    parser.add_argument("--version", default="dev")
    args = parser.parse_args(argv)
    from topeye.scenario.models import guard_output

    adapter = create_adapter(Path(args.dataset).expanduser().resolve(), args.dataset_version)
    job = run_job(guard_output(args.workspace, adapter.root), args.job, adapter, args.version)
    print(json.dumps({"id": job["id"], "status": job["status"]}))
    return 0 if job["status"] == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
