"""plan46 WP3: esmini check of real2sim / reactive packages (SPEC-WP3 tests 1-3)."""

import json
import shutil
from pathlib import Path

import numpy as np
import pytest
from test_scenario_reactive import NUSC, service  # noqa: F401  (fixture)

from topeye.scenario import esmini_check as ec
from topeye.scenario.models import ScenarioError

ENGINE = Path(__file__).resolve().parents[1] / ".tools/esmini/build/EnvironmentSimulator/Libraries/esminiLib/libesminiLib.dylib"
SAMPLE = Path.home() / "Downloads/car_013_t01.0_stop_d3_a8"
needs_engine = pytest.mark.skipif(not ENGINE.is_file(), reason="bundled esmini library not built on this machine")


def _import(api, params, scene_actor, **event):
    source = api.call("source_scene", params)
    found = api.call("reactive_candidates", {**params, "source_id": source["id"]})
    car = next(c for c in found["candidates"] if c["name"] == scene_actor)
    ev = {"actor_id": car["actor_id"], "t0_s": 2.0, "decel_mps2": 4.0, "target": "stop", "dwell_s": 3.0,
          "react": True, "reaction_s": 1.0, **event}
    return api.call("import_reactive", {**params, "source_id": source["id"], "event": ev})


@needs_engine
def test_reactive_package_passes_and_is_cached(service, monkeypatch):  # noqa: F811
    """3: the check is cached next to the package (outside its manifest) and read back without esmini."""
    api, params = service
    scenario = _import(api, params, "car_001")
    check = api.call("esmini_check", {**params, "scenario_id": scenario["id"], "engine": str(ENGINE)})
    assert check["version"] == "esmini-check-v1" and check["exit"] == 0 and check["esmini_version"] == "3.9.0"
    assert check["passed"] is True and check["missing"] == [] and check["edge_skip_s"] == 0.2
    assert check["skipped_reason"] is None
    assert set(check["replay_error_m"]) == {"ego", "car_001", "car_002", "pedestrian_003"}
    assert check["max_error_m"] <= 0.01
    # the hardest braking of the simulation (car_002 reacting: 5.02 m/s²) as esmini replays it
    assert check["accel_max_mps2"] == pytest.approx(max(scenario["report"]["max_decel_used"].values()), abs=0.3)
    project = Path(params["workspace"]) / scenario["id"]
    cached = project / "metrics/esmini-check-v1.json"
    stored = json.loads(cached.read_text())
    assert stored.pop("inputs") == ec.fingerprint(project / "import", ENGINE) and stored == check
    assert "metrics" not in json.loads((project / "import/manifest.json").read_text())["files"]
    real_run = ec.run
    monkeypatch.setattr(ec, "run", lambda *a, **k: pytest.fail("esmini ran a second time"))
    assert api.call("esmini_check", {**params, "scenario_id": scenario["id"], "engine": str(ENGINE)}) == check

    # H07: another engine file (same library, other path / mtime) is measured again, not served from the cache
    other = Path(params["workspace"]) / ENGINE.name
    shutil.copy(ENGINE, other)
    runs = []
    monkeypatch.setattr(ec, "run", lambda *a, **k: runs.append(1) or real_run(*a, **k))
    again = api.call("esmini_check", {**params, "scenario_id": scenario["id"], "engine": str(other)})
    assert runs == [1] and again["passed"] is True
    assert json.loads(cached.read_text())["inputs"]["engine"]["path"] == str(other.resolve())

    # H07: one byte of the package changed after the cache was written: HASH_MISMATCH, never the old result
    csv_path = project / "import/trajectories.csv"
    data = bytearray(csv_path.read_bytes())
    data[-2] = ord("0") if data[-2] != ord("0") else ord("1")
    csv_path.write_bytes(bytes(data))
    with pytest.raises(ScenarioError) as exc:
        api.call("esmini_check", {**params, "scenario_id": scenario["id"], "engine": str(other)})
    assert exc.value.code == "HASH_MISMATCH" and runs == [1]


def test_presence_is_a_span_with_margin():
    """H07 (plan45 C4 / SPEC-WP3): presence is the CSV span within ±0.1 s, not every timestamp. A log starting at
    1.05 s for an object added at 1.00 s is present; one starting at 1.15 s, or with a step missing, is not."""
    tracks = {"late": np.array([[1.0, 0.0, 0.0, 0.0], [3.0, 10.0, 0.0, 0.0]])}

    def log(times):
        return {"late": np.array([[t, 10.0 * (t - 1.0) / 2.0, 0.0, 0.0, 0.0, 0.0] for t in times])}

    ok = np.round(np.arange(1.05, 3.0 + 1e-9, 0.05), 6)
    assert ec.compare(0, log(ok), tracks, None, "3.9.0")["missing"] == []
    assert ec.compare(0, log(ok), tracks, None, "3.9.0")["passed"] is True
    assert ec.compare(0, log(ok[2:]), tracks, None, "3.9.0")["missing"] == ["late"]  # starts at 1.15 s
    assert ec.compare(0, log(ok[:-3]), tracks, None, "3.9.0")["missing"] == ["late"]  # ends at 2.85 s
    assert ec.compare(0, log(np.delete(ok, 10)), tracks, None, "3.9.0")["missing"] == ["late"]  # a gap
    assert ec.compare(0, {}, tracks, None, "3.9.0")["missing"] == ["late"]


@needs_engine
def test_failing_esmini_is_a_result_not_an_error(tmp_path):
    """ESMINI_FAILED: exit != 0 gives passed=false with the real exit code; absent objects are listed."""
    xosc = tmp_path / "original.xosc"
    xosc.write_text('<?xml version="1.0"?><OpenSCENARIO><FileHeader/></OpenSCENARIO>')
    csv = b"scene,time_s,object_id,category,x_m,y_m,yaw_rad,length_m,width_m,height_m\ns,0,ego,car,0,0,0,4,2,1.5\n"
    check = ec.check_files(xosc, csv, None, ENGINE, tmp_path)
    assert check["exit"] != 0 and check["passed"] is False and check["missing"] == ["ego"]
    assert check["skipped_reason"] is None  # no road referenced: a real failure


def test_unsupported_kind_missing_engine_and_tamper(tmp_path):
    """3: a non-real2sim scenario -> UNSUPPORTED_KIND; no esmini -> ESMINI_MISSING (nothing cached);
    a package whose files no longer match its manifest -> HASH_MISMATCH."""
    scenario_id = "a" * 32
    package = tmp_path / scenario_id / "import"
    package.mkdir(parents=True)
    (package / "manifest.json").write_text(json.dumps({"kind": "imported", "files": {}}))
    with pytest.raises(ScenarioError) as exc:
        ec.esmini_check(tmp_path, scenario_id, str(ENGINE))
    assert exc.value.code == "UNSUPPORTED_KIND"
    (package / "original.xosc").write_bytes(b"<OpenSCENARIO/>")
    (package / "trajectories.csv").write_bytes(b"scene,time_s,object_id,category,x_m,y_m,yaw_rad,length_m,width_m,height_m\n")
    import hashlib

    files = {n: hashlib.sha256((package / n).read_bytes()).hexdigest() for n in ("original.xosc", "trajectories.csv")}
    (package / "manifest.json").write_text(json.dumps({"kind": "real2sim", "files": files}))
    with pytest.raises(ScenarioError) as exc:
        ec.esmini_check(tmp_path, scenario_id, str(tmp_path / "no-esmini.dylib"))
    assert exc.value.code == "ESMINI_MISSING" and not (tmp_path / scenario_id / "metrics").exists()
    (package / "original.xosc").write_bytes(b"<OpenSCENARIO></OpenSCENARIO>")
    with pytest.raises(ScenarioError) as exc:
        ec.esmini_check(tmp_path, scenario_id, str(ENGINE))
    assert exc.value.code == "HASH_MISMATCH"
    with pytest.raises(ScenarioError) as exc:
        ec.esmini_check(tmp_path, "../" + scenario_id, str(ENGINE))
    assert exc.value.code == "INVALID_INPUT"


@needs_engine
@pytest.mark.skipif(not (NUSC / "v1.0-mini").is_dir(), reason="nuScenes v1.0-mini not on this machine (TOPEYE_NUSC_ROOT)")
def test_scene_0061_car_154_half(tmp_path):
    """1: the reactive package of scene-0061 car_154@0 half/4 passes, esmini within 0.01 m of the package."""
    from topeye.scenario.worker import Service

    api = Service()
    params = {"dataset": str(NUSC), "dataset_version": "v1.0-mini", "workspace": str(tmp_path / "ws"),
              "scene": "scene-0061"}
    scenario = _import(api, params, "car_154", t0_s=0.0, target="half", dwell_s=0.0)
    check = api.call("esmini_check", {**params, "scenario_id": scenario["id"], "engine": str(ENGINE)})
    assert check["passed"] is True and check["exit"] == 0 and check["missing"] == []
    assert check["max_error_m"] <= 0.01 and len(check["replay_error_m"]) == len(scenario["actors"])


@needs_engine
@pytest.mark.skipif(not SAMPLE.is_dir(), reason="owner's team sample package not present on this machine")
def test_team_sample_package(tmp_path):
    """2: the team sample runs next to its road file; stored in topeye (XOSC only, no .xodr), esmini cannot load
    the road it references: not checked (passed null, skipped_reason no_road, exit 2 kept), never a made-up road."""
    report = json.loads((SAMPLE / "report.json").read_text())
    csv = (SAMPLE / "trajectories.csv").read_bytes()
    check = ec.check_files(SAMPLE / "car_013_t01.0_stop_d3_a8.xosc", csv, report, ENGINE, tmp_path)
    assert check["passed"] is True and check["exit"] == 0 and check["missing"] == []
    assert check["skipped_reason"] is None
    assert check["replay_error_m"]["ego"]["max"] <= 0.01 and check["replay_error_m"]["car_013"]["max"] <= 0.01
    assert check["accel_max_mps2"] == pytest.approx(report["esmini"]["dynamics"]["esmini_raw"], abs=0.05)
    alone = tmp_path / "alone"
    alone.mkdir()
    shutil.copy(SAMPLE / "car_013_t01.0_stop_d3_a8.xosc", alone / "original.xosc")
    check = ec.check_files(alone / "original.xosc", csv, report, ENGINE, tmp_path)
    assert (check["exit"], check["passed"], check["skipped_reason"]) == (2, None, "no_road")
    assert len(check["missing"]) == 73


@needs_engine
def test_missing_road_is_skipped_not_failed(tmp_path):
    """Bổ sung 2026-10-15: an XOSC whose referenced .xodr is absent and that esmini cannot run -> passed null,
    skipped_reason no_road; with the road file present the same reference does not skip; an old v1 cache without
    skipped_reason is measured again."""
    xosc = tmp_path / "original.xosc"
    xosc.write_text('<?xml version="1.0"?><OpenSCENARIO><FileHeader/><RoadNetwork>'
                    '<LogicFile filepath="scene_map.xodr"/></RoadNetwork></OpenSCENARIO>')
    csv = b"scene,time_s,object_id,category,x_m,y_m,yaw_rad,length_m,width_m,height_m\ns,0,ego,car,0,0,0,4,2,1.5\n"
    check = ec.check_files(xosc, csv, None, ENGINE, tmp_path)
    assert check["exit"] != 0 and (check["passed"], check["skipped_reason"]) == (None, "no_road")
    assert ec.missing_road(xosc) == "scene_map.xodr"
    (tmp_path / "scene_map.xodr").write_text("<OpenDRIVE/>")
    assert ec.missing_road(xosc) is None


def test_cached_no_road_is_invalidated_when_road_appears(tmp_path, monkeypatch):
    """A road file outside the manifest changes whether esmini can check the package."""
    import hashlib

    scenario_id = "b" * 32
    package = tmp_path / scenario_id / "import"
    package.mkdir(parents=True)
    xosc = package / "original.xosc"
    xosc.write_text('<OpenSCENARIO><RoadNetwork><LogicFile filepath="scene_map.xodr"/></RoadNetwork></OpenSCENARIO>')
    csv = package / "trajectories.csv"
    csv.write_text("test")
    files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (xosc, csv)}
    (package / "manifest.json").write_text(json.dumps({"kind": "real2sim", "files": files}))
    engine = tmp_path / "esmini.dylib"
    engine.write_text("test")
    runs = []

    def check_files(xosc, *_args):
        runs.append(1)
        missing = ec.missing_road(xosc) is not None
        return {"version": ec.VERSION, "passed": None if missing else True,
                "skipped_reason": "no_road" if missing else None}

    monkeypatch.setattr(ec, "check_files", check_files)
    assert ec.esmini_check(tmp_path, scenario_id, engine)["skipped_reason"] == "no_road"
    (package / "scene_map.xodr").write_text("road")
    assert ec.esmini_check(tmp_path, scenario_id, engine)["passed"] is True
    assert len(runs) == 2


def test_manifest_cannot_hash_files_outside_package(tmp_path):
    """The esmini check must reject the same unsafe payload names as the package loader."""
    import hashlib

    package = tmp_path / "import"
    package.mkdir()
    (package / "original.xosc").write_text("<OpenSCENARIO/>")
    (package / "trajectories.csv").write_text("test")
    (tmp_path / "secret.txt").write_text("private")
    names = ("original.xosc", "trajectories.csv", "../secret.txt")
    files = {name: hashlib.sha256((package / name).read_bytes()).hexdigest() for name in names}
    (package / "manifest.json").write_text(json.dumps({"kind": "real2sim", "files": files}))
    with pytest.raises(ScenarioError) as exc:
        ec._verified(package)
    assert exc.value.code == "HASH_MISMATCH"


def test_old_cache_without_skipped_reason_is_ignored(tmp_path, monkeypatch):
    scenario_id = "b" * 32
    (tmp_path / scenario_id / "import").mkdir(parents=True)
    (tmp_path / scenario_id / "import/manifest.json").write_text(json.dumps({"kind": "imported", "files": {}}))
    (tmp_path / scenario_id / "metrics").mkdir()
    (tmp_path / scenario_id / "metrics/esmini-check-v1.json").write_text(json.dumps({"version": "esmini-check-v1"}))
    with pytest.raises(ScenarioError) as exc:  # not served from the stale cache: the package is examined again
        ec.esmini_check(tmp_path, scenario_id, str(ENGINE))
    assert exc.value.code == "UNSUPPORTED_KIND"
