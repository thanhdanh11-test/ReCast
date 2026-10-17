"""plan46 WP3: esmini check of a real2sim / reactive package (validity condition 1 of replay-forge docs §8.3).

The package's own XOSC is replayed by the bundled esmini library (3.9.0 C ABI, DT 0.05, trajectory filter off, as
replay-forge real2sim/esmini.py runs the esmini binary) in a child process; its log is compared with
trajectories.csv. Nothing in the package changes: the result is cached at `<ws>/<id>/metrics/esmini-check-v1.json`,
outside the hashed manifest, with the inputs it was measured on (`fingerprint`); the package hash and kind are checked
before a cached result is returned, and other inputs are measured again.

  exit            child exit code: 0 esmini initialised and stepped to the end, 2 SE_Init failed (e.g. a road file
                  the XOSC references is absent), 3 a step failed, 4 an object state was unreadable, other: crash
  missing         objects absent from the log at a step inside their CSV time span (Add/Delete are written
                  PRESENCE_MARGIN outside it, so the span itself must be covered)
  replay_error_m  per object, distance between the logged reference point and the CSV pose interpolated at the same
                  time, moved from the box centre (the CSV frame) to the reference point with the CSV yaw (team
                  packages put the ego's reference on its rear axle, 1.4 m behind the centre), inside the span
                  minus EDGE_SKIP at both ends (replay-forge pipeline.export_event); a span shorter than 2 EDGE_SKIP
                  is measured on the steps it exists in esmini (PRESENCE_MARGIN around it)
  passed          exit == 0 and nothing missing; null with skipped_reason "no_road" when esmini could not run because
                  the road file the XOSC references is not next to it (a team package is stored without its .xodr;
                  plan46 decision 2026-10-15: not checked, never a failure)
  accel_max_mps2  largest acceleration of the changed vehicles on the log (raw, the "esmini_raw" of replay-forge
                  events.replay_dynamics), same EDGE_SKIP; changed = report event actor + reacted, or every moving
                  object without a report
"""

import csv
import ctypes as C
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

from topeye.scenario.models import ScenarioError, require, write_json

VERSION = "esmini-check-v1"
DT = 0.05  # s, esmini fixed step
EDGE_SKIP = 0.2  # s, replay-forge events.EDGE_SKIP
TIME_TOL = 1e-6  # s
PRESENCE_MARGIN = 0.1  # s, objects are added / deleted this long outside their data (plan45 C4)
CHILD_TIMEOUT = 120.0  # s, plus 10 s per scene second


# ---------------------------------------------------------------------------- child (runs esmini)
def _child(xosc, engine, end, out):
    from topeye.scenario.engine import ObjectState

    lib = C.CDLL(engine)
    lib.SE_Init.argtypes = [C.c_char_p, C.c_int, C.c_int, C.c_int, C.c_int]
    lib.SE_Init.restype = C.c_int
    lib.SE_StepDT.argtypes = [C.c_double]
    lib.SE_StepDT.restype = C.c_int
    lib.SE_GetSimulationTime.restype = C.c_double
    lib.SE_GetObjectState.argtypes = [C.c_int, C.POINTER(ObjectState)]
    lib.SE_GetObjectState.restype = C.c_int
    lib.SE_GetObjectName.argtypes = [C.c_int]
    lib.SE_GetObjectName.restype = C.c_char_p
    lib.SE_GetId.argtypes = [C.c_int]
    lib.SE_GetId.restype = C.c_int
    lib.SE_SetOptionValue.argtypes = [C.c_char_p, C.c_char_p]
    lib.SE_SetLogFilePath.argtypes = [C.c_char_p]
    out = Path(out)
    lib.SE_SetLogFilePath(str(out / "esmini.log").encode())
    lib.SE_SetOptionValue(b"traj_filter", b"0")  # never merge close trajectory vertices (replay-forge)
    if lib.SE_Init(str(xosc).encode(), 1, 0, 0, 0) != 0:
        return 2
    rows, code = [], 0
    try:
        for i in range(int(float(end) / DT + 1e-6) + 1):
            if i and lib.SE_StepDT(DT) != 0:
                code = 3
                break
            t = float(lib.SE_GetSimulationTime())
            for index in range(lib.SE_GetNumberOfObjects()):
                identity = lib.SE_GetId(index)
                state = ObjectState()
                if lib.SE_GetObjectState(identity, C.byref(state)) != 0:
                    code = 4
                    break
                rows.append([lib.SE_GetObjectName(identity).decode(), t, state.x, state.y, state.h,
                             state.centerOffsetX, state.centerOffsetY])
    finally:
        lib.SE_Close()
    write_json(out / "log.json", rows)
    return code


def esmini_version(engine):
    try:
        return C.c_char_p.in_dll(C.CDLL(str(engine)), "ESMINI_BUILD_VERSION").value.decode() or None
    except (OSError, ValueError, AttributeError):
        return None


def run(xosc, engine, end, workdir):
    """(exit code, {name: array[[t, x, y, h, centre offset x, y]]}) of the XOSC replayed until `end` seconds."""
    out = Path(tempfile.mkdtemp(prefix="esmini-check-", dir=workdir))
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[2])}
    try:
        code = subprocess.run(
            [sys.executable, "-m", "topeye.scenario.esmini_check", "--child", str(Path(xosc).resolve()),
             str(Path(engine).resolve()), f"{end:.4f}", str(out)],
            cwd=Path(xosc).resolve().parent, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, check=False,
            timeout=CHILD_TIMEOUT + 10 * end,
        ).returncode
    except subprocess.TimeoutExpired as exc:
        raise ScenarioError("TIMEOUT", "esmini chạy quá lâu") from exc
    log = {}
    if (out / "log.json").is_file():
        for name, *row in json.loads((out / "log.json").read_text()):
            log.setdefault(name, []).append(row)
    return code, {k: np.array(v, float) for k, v in log.items()}


# ---------------------------------------------------------------------------- comparison
def read_tracks(csv_bytes):
    """{object_id: array[[t, x, y, yaw]]} of trajectories.csv (box centres), time-ordered, yaw unwrapped."""
    tracks = {}
    for row in csv.DictReader(io.StringIO(csv_bytes.decode("utf-8"))):
        tracks.setdefault(row["object_id"], []).append(
            [float(row["time_s"]), float(row["x_m"]), float(row["y_m"]), float(row["yaw_rad"])])
    out = {}
    for name, rows in tracks.items():
        arr = np.array(sorted(rows), float)
        arr[:, 3] = np.unwrap(arr[:, 3])
        out[name] = arr
    return out


def _changed(report, tracks):
    if isinstance(report, dict) and isinstance(report.get("event"), dict):
        names = {report["event"].get("actor"), *(report.get("reacted") or [])}
        return [n for n in names if n in tracks]
    return [n for n, tr in tracks.items() if len({(x, y) for _, x, y, _ in tr}) > 1]


def _peak_accel(t, xy):
    """Largest |dv/dt| of a logged track (raw speed from positions, replay-forge replay_dynamics `peak`)."""
    if len(t) < 8:  # 2 * PHYSICS_SMOOTH
        return 0.0
    s = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])
    return float(np.abs(np.gradient(np.gradient(s, t), t)).max())


def missing_road(xosc):
    """The road file (RoadNetwork/LogicFile) the XOSC references, when it is absent next to it; else None."""
    try:
        logic = ET.parse(xosc).getroot().find("RoadNetwork/LogicFile")
    except (ET.ParseError, OSError):
        return None
    path = (logic.get("filepath") or "").strip() if logic is not None else ""
    return path if path and not (Path(xosc).resolve().parent / path).is_file() else None


def present(got, t0, t1):
    """Whether a logged object covers its CSV span [t0, t1] (plan45 C4: Add/Delete within PRESENCE_MARGIN of it):
    in esmini from t0 + PRESENCE_MARGIN at the latest until t1 - PRESENCE_MARGIN at the earliest, with no step
    missing in between. Exact timestamps are not required (a CSV time off the esmini step grid never is one)."""
    if got is None or not len(got):
        return False
    t = np.sort(got[:, 0])
    if t[0] > t0 + PRESENCE_MARGIN + TIME_TOL or t[-1] < t1 - PRESENCE_MARGIN - TIME_TOL:
        return False
    return bool(np.all(np.diff(t) <= DT + TIME_TOL))


def compare(code, log, tracks, report, version):
    """`EsminiCheck` of one replay."""
    missing, errors, worst, accel = [], {}, None, None
    for name, tr in tracks.items():
        t0, t1 = tr[0, 0], tr[-1, 0]
        got = log.get(name)
        if not present(got, t0, t1):
            missing.append(name)
            continue
        if t1 - t0 > 2 * EDGE_SKIP:
            inner = (got[:, 0] >= t0 + EDGE_SKIP) & (got[:, 0] <= t1 - EDGE_SKIP)
        else:  # a short (or single-sample) span: the steps it is in esmini, held at its first / last pose
            inner = (got[:, 0] >= t0 - PRESENCE_MARGIN - TIME_TOL) & (got[:, 0] <= t1 + PRESENCE_MARGIN + TIME_TOL)
        if not inner.any():
            continue
        t = got[inner, 0]
        centre = np.column_stack([np.interp(t, tr[:, 0], tr[:, k]) for k in (1, 2)])
        yaw = np.interp(t, tr[:, 0], tr[:, 3])
        ox, oy = got[inner, 4], got[inner, 5]
        want = centre - np.column_stack([ox * np.cos(yaw) - oy * np.sin(yaw), ox * np.sin(yaw) + oy * np.cos(yaw)])
        d = np.hypot(*(got[inner, 1:3] - want).T)
        errors[name] = {"mean": round(float(d.mean()), 4), "max": round(float(d.max()), 4)}
        worst = max(worst or 0.0, errors[name]["max"])
    for name in _changed(report, tracks):
        got = log.get(name)
        if got is None:
            continue
        t0, t1 = tracks[name][0, 0], tracks[name][-1, 0]
        inner = (got[:, 0] >= t0 + EDGE_SKIP) & (got[:, 0] <= t1 - EDGE_SKIP)
        accel = max(accel or 0.0, round(_peak_accel(got[inner, 0], got[inner, 1:3]), 2))
    return {"version": VERSION, "exit": code, "esmini_version": version, "missing": sorted(missing),
            "replay_error_m": errors, "max_error_m": worst, "accel_max_mps2": accel, "edge_skip_s": EDGE_SKIP,
            "passed": code == 0 and not missing, "skipped_reason": None}


def check_files(xosc, csv_bytes, report, engine, workdir):
    """EsminiCheck of an XOSC file on disk (its folder is esmini's working directory) and its trajectories.csv."""
    require(engine and Path(engine).is_file(), "Thiếu esmini", "ESMINI_MISSING")
    tracks = read_tracks(csv_bytes)
    require(tracks, "Gói không có trajectories.csv để so", "UNSUPPORTED_KIND")
    end = max(tr[-1, 0] for tr in tracks.values())
    code, log = run(xosc, engine, end, workdir)
    result = compare(code, log, tracks, report, esmini_version(engine))
    if code != 0 and missing_road(xosc):
        result.update(passed=None, skipped_reason="no_road")
    return result


# ---------------------------------------------------------------------------- stored scenario (worker op)
def _verified(package):
    """Payload names of a stored real2sim package after the manifest hash check (as real2sim.load_package)."""
    from topeye.scenario.real2sim import CSV, REPORT

    try:
        manifest = json.loads((package / "manifest.json").read_text())
    except (OSError, ValueError) as exc:
        raise ScenarioError("HASH_MISMATCH", "Invalid import manifest") from exc
    require(isinstance(manifest, dict) and manifest.get("kind") == "real2sim",
            "esmini check chỉ dành cho gói real2sim", "UNSUPPORTED_KIND")
    files = manifest.get("files")
    require(isinstance(files, dict), "Invalid import manifest", "HASH_MISMATCH")
    names = set(files)
    require({"original.xosc", CSV} <= names <= {"original.xosc", "context.json", "scenario.json", REPORT, CSV},
            "Invalid import manifest", "HASH_MISMATCH")
    for name, digest in files.items():
        p = package / name
        require(p.is_file() and not p.is_symlink(), "Missing or linked import payload", "PATH_ESCAPE")
        require(p.stat().st_size <= 32 * 1024 * 1024, "Oversized package payload", "RESOURCE_LIMIT")
        require(hashlib.sha256(p.read_bytes()).hexdigest() == digest, "Import integrity mismatch", "HASH_MISMATCH")
    return names


def _road_input(xosc):
    """State of the road referenced outside the hashed package; it can change independently of the manifest."""
    try:
        logic = ET.parse(xosc).getroot().find("RoadNetwork/LogicFile")
    except (ET.ParseError, OSError):
        return None
    name = (logic.get("filepath") or "").strip() if logic is not None else ""
    if not name:
        return None
    road = (Path(xosc).resolve().parent / name).resolve()
    try:
        stat = road.stat()
    except OSError:
        return {"path": str(road), "present": False}
    return {"path": str(road), "present": road.is_file(), "size": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def fingerprint(package, engine):
    """What a cached check was measured on: the verified manifest (its hashes cover every payload file), the engine
    file (resolved path, size, mtime), the referenced road file, and the check version."""
    stat = Path(engine).resolve().stat()
    return {"version": VERSION, "manifest_sha256": hashlib.sha256((package / "manifest.json").read_bytes()).hexdigest(),
            "engine": {"path": str(Path(engine).resolve()), "size": stat.st_size, "mtime_ns": stat.st_mtime_ns},
            "road": _road_input(package / "original.xosc")}


def esmini_check(workspace, scenario_id, engine):
    """C1 `esmini_check`: cached EsminiCheck of a stored real2sim package."""
    from topeye.scenario.library import _project
    from topeye.scenario.real2sim import CSV, REPORT

    _, project = _project(workspace, scenario_id)
    path = project / "metrics" / f"{VERSION}.json"
    package = project / "import"
    # the package is verified on every call: a cached result is only for the exact package and engine it measured
    names = _verified(package)
    require(CSV in names, "Gói không có trajectories.csv để so", "UNSUPPORTED_KIND")
    require(engine and Path(engine).is_file(), "Thiếu esmini", "ESMINI_MISSING")
    inputs = fingerprint(package, engine)
    if path.is_file():
        try:
            cached = json.loads(path.read_text())
            # older v1 caches (no skipped_reason / no inputs) and other inputs: measure again
            if isinstance(cached, dict) and cached.get("version") == VERSION and cached.get("inputs") == inputs:
                return {k: v for k, v in cached.items() if k != "inputs"}
        except ValueError:
            pass
    report = None
    if REPORT in names:
        try:
            report = json.loads((package / REPORT).read_text())
        except ValueError:
            report = None
    with tempfile.TemporaryDirectory(prefix="topeye-esmini-check-") as scratch:
        # esmini reads the XOSC from the package folder (a road file next to it, if any, is not part of it)
        result = check_files(package / "original.xosc", (package / CSV).read_bytes(), report, engine, scratch)
    try:
        path.parent.mkdir(exist_ok=True)  # parents=False: never recreate a scenario deleted meanwhile
        temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        write_json(temporary, {**result, "inputs": inputs})
        os.replace(temporary, path)
    except FileNotFoundError as exc:
        raise ScenarioError("NOT_FOUND", "Kịch bản đã bị xoá") from exc
    return result


if __name__ == "__main__" and len(sys.argv) == 6 and sys.argv[1] == "--child":
    sys.exit(_child(*sys.argv[2:]))
