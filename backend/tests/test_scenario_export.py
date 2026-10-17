"""plan50 P04: CARLA / .xosc export jobs and the nuScenes → OpenDRIVE road network."""

import hashlib
import json
import xml.etree.ElementTree as ET
import zipfile
from types import SimpleNamespace

import pytest

from topeye.scenario import export_job as ex
from topeye.scenario.models import ScenarioError
from topeye.scenario.xodr import arcline_primitives, map_lanes, map_roads

SID = "a" * 32
XOSC = (b'<?xml version="1.0" encoding="utf-8"?>\n<OpenSCENARIO><FileHeader description="d"/>'
        b"<CatalogLocations/><RoadNetwork/><Entities/><Storyboard/></OpenSCENARIO>\n")


def expansion():
    """Two straight 20 m lanes (one inside the box, one 1 km away) with a 3 m-wide polygon."""
    nodes = [{"token": f"n{i}", "x": x, "y": y} for i, (x, y) in enumerate([(100, 98.5), (120, 98.5), (120, 101.5), (100, 101.5)])]
    return {
        "node": nodes,
        "polygon": [{"token": "p1", "exterior_node_tokens": ["n0", "n1", "n2", "n3"], "holes": []}],
        "lane": [{"token": "near", "polygon_token": "p1"}, {"token": "far", "polygon_token": "missing"}],
        "lane_connector": [],
        "arcline_path_3": {
            "near": [{"start_pose": [100, 100, 0], "end_pose": [120, 100, 0], "shape": "LSR", "radius": 999,
                      "segment_length": [0, 20, 0]}],
            "far": [{"start_pose": [2000, 2000, 0], "end_pose": [2020, 2000, 0], "shape": "LSR", "radius": 999,
                     "segment_length": [0, 20, 0]}],
        },
    }


def adapter(tmp_path, data=None):
    (tmp_path / "ds/maps/expansion").mkdir(parents=True)
    (tmp_path / "ds/maps/expansion/town.json").write_text(json.dumps(data or expansion()))
    return SimpleNamespace(root=tmp_path / "ds", scene_map=lambda scene: ("town",))


def package(workspace, kind="imported", extra=None, name="Dừng khẩn cấp.xosc"):
    folder = workspace / SID / "import"
    folder.mkdir(parents=True)
    scenario = {"source": {"scene": "scene-1", "origin_global_m": [100, 100, 0]}, "actors": [
        {"id": "ego", "category": "vehicle.car", "length_m": 4.5, "width_m": 1.8, "height_m": 1.5,
         "reference_samples": [{"t_s": t, "x_m": 2.0 * t, "y_m": 0.0, "yaw_rad": 0.0} for t in range(5)]}]}
    files = {"original.xosc": XOSC, "scenario.json": json.dumps(scenario).encode(), **(extra or {})}
    for n, b in files.items():
        (folder / n).write_bytes(b)
    (folder / "manifest.json").write_text(json.dumps({"schema_version": 1, "kind": kind, "scenario_id": SID,
        "files": {n: hashlib.sha256(b).hexdigest() for n, b in files.items()}, "display_name": name}))
    return folder


def test_arcline_and_lane_box_and_polygon_width():
    lanes = map_lanes(expansion(), (90, 90, 130, 110))
    assert [lane.token for lane in lanes] == ["near"]
    assert lanes[0].length == pytest.approx(20) and lanes[0].width == pytest.approx(3.0)
    # Left arc of radius 10 for a quarter turn ends 10 m ahead and 10 m left.
    (prim,) = arcline_primitives([{"start_pose": [0, 0, 0], "shape": "LSR", "radius": 10,
                                   "segment_length": [3.14159265 * 5, 0, 0]}])
    assert prim.curvature == pytest.approx(0.1)
    root = ET.fromstring(map_roads(lanes, (100, 100), "n"))
    geometry = root.find("road/planView/geometry")
    assert (float(geometry.get("x")), float(geometry.get("y"))) == (0.0, 0.0)  # shifted into the app frame
    assert root.find("road/lanes/laneSection/right/lane/width").get("a") == "3.000"


def test_carla_export_has_every_file_hashes_and_road_reference(tmp_path):
    ws = tmp_path / "ws"
    package(ws)
    job = ex.create_job(ws, SID, "carla", adapter(tmp_path))
    assert job["status"] == "queued" and job["progress"] == 0 and job["name"] == "Dừng khẩn cấp.xosc"
    seen = []
    real_write = ex.write_job
    ex.write_job = lambda folder, j: (seen.append(j["progress"]), real_write(folder, j))[1]
    try:
        done = ex.run_job(ws, job["id"], adapter_for(tmp_path))
    finally:
        ex.write_job = real_write
    assert done["status"] == "done" and done["progress"] == 100, done["error"]
    assert seen == sorted(seen) and seen[-1] == 100  # progress only grows
    names = {f["name"] for f in done["files"]}
    assert names == {"Dung_khan_cap.xosc", "scene-1_map.xodr", "trajectories.csv", "manifest.json"}
    assert done["notes"] == [ex.NO_REPORT]  # never an invented report
    files = ws / "exports" / job["id"] / "files"
    for f in done["files"]:
        assert hashlib.sha256((files / f["name"]).read_bytes()).hexdigest() == f["sha256"]
    xosc = ET.fromstring((files / "Dung_khan_cap.xosc").read_bytes())
    assert xosc.find("RoadNetwork/LogicFile").get("filepath") == "scene-1_map.xodr"
    assert (files / "trajectories.csv").read_text().splitlines()[1].startswith("scene-1,0.0000,ego,vehicle.car")
    with zipfile.ZipFile(ws / "exports" / job["id"] / "Dung_khan_cap.zip") as z:
        assert sorted(z.namelist()) == sorted(f"Dung_khan_cap/{n}" for n in names)
    assert (ws / SID / "import" / "original.xosc").read_bytes() == XOSC  # source untouched


def adapter_for(tmp_path):
    return SimpleNamespace(root=tmp_path / "ds", scene_map=lambda scene: ("town",))


def test_real2sim_export_copies_report_and_csv_byte_for_byte(tmp_path):
    ws = tmp_path / "ws"
    report, csv_ = b'{"id": "x"}', b"scene,time_s\n"
    package(ws, "real2sim", {"report.json": report, "trajectories.csv": csv_}, name="car_013_t01.0_stop")
    job = ex.create_job(ws, SID, "carla", adapter(tmp_path))
    done = ex.run_job(ws, job["id"], adapter_for(tmp_path))
    files = ws / "exports" / job["id"] / "files"
    assert done["notes"] == [] and (files / "report.json").read_bytes() == report
    assert (files / "trajectories.csv").read_bytes() == csv_ and (files / "car_013_t01.0_stop.xosc").is_file()


def test_xosc_export_is_byte_identical(tmp_path):
    ws = tmp_path / "ws"
    package(ws)
    job = ex.create_job(ws, SID, "xosc", SimpleNamespace())
    done = ex.run_job(ws, job["id"], SimpleNamespace())
    assert {f["name"] for f in done["files"]} == {"Dung_khan_cap.xosc", "manifest.json"}
    assert (ws / "exports" / job["id"] / "files" / "Dung_khan_cap.xosc").read_bytes() == XOSC


def test_carla_rejected_before_any_job_for_argoverse_or_missing_lanes(tmp_path):
    ws = tmp_path / "ws"
    package(ws)
    av2 = SimpleNamespace(root=tmp_path, scene_map=lambda s: ("x",), vector_map=lambda *a: None)
    with pytest.raises(ScenarioError) as err:
        ex.create_job(ws, SID, "carla", av2)
    assert err.value.code == "CARLA_UNSUPPORTED" and not (ws / "exports").exists()
    data = expansion()
    data["arcline_path_3"] = {}
    job = ex.create_job(ws, SID, "carla", adapter(tmp_path, data))
    failed = ex.run_job(ws, job["id"], adapter_for(tmp_path))
    assert failed["status"] == "failed" and failed["error"]["code"] == "CARLA_UNSUPPORTED"


def test_tampered_or_missing_package_fails_without_partial_files(tmp_path):
    ws = tmp_path / "ws"
    folder = package(ws)
    job = ex.create_job(ws, SID, "xosc", SimpleNamespace())
    (folder / "original.xosc").write_bytes(XOSC + b"<!-- changed -->")
    failed = ex.run_job(ws, job["id"], SimpleNamespace())
    assert failed["error"]["code"] == "HASH_MISMATCH" and not (ws / "exports" / job["id"] / "files").exists()
    with pytest.raises(ScenarioError) as err:
        ex.create_job(ws, "b" * 32, "xosc", SimpleNamespace())
    assert err.value.code == "NOT_FOUND"
    with pytest.raises(ScenarioError):
        ex.create_job(ws, SID, "zip", SimpleNamespace())
    with pytest.raises(ScenarioError):
        ex.job_dir(ws, "../" + "a" * 30)


def test_finished_job_is_not_run_again_and_names_are_safe(tmp_path):
    ws = tmp_path / "ws"
    package(ws, name="../../evil<x>.xosc")
    job = ex.create_job(ws, SID, "xosc", SimpleNamespace())
    done = ex.run_job(ws, job["id"], SimpleNamespace())
    assert {f["name"] for f in done["files"]} == {"evil_x.xosc", "manifest.json"}
    assert ex.run_job(ws, job["id"], SimpleNamespace()) == done
    assert ex.stem_of("car_051_t3.0_half_a4") == "car_051_t3.0_half_a4" and ex.stem_of("...") == "scenario"


def test_package_file_deleted_mid_export_is_not_found(tmp_path):
    ws = tmp_path / "ws"
    folder = package(ws)
    job = ex.create_job(ws, SID, "xosc", SimpleNamespace())
    (folder / "original.xosc").unlink()
    failed = ex.run_job(ws, job["id"], SimpleNamespace())
    assert failed["status"] == "failed" and failed["error"]["code"] == "NOT_FOUND"


def test_a_job_the_server_already_ended_is_never_overwritten(tmp_path, monkeypatch):
    """Review F3: a timed-out / interrupted job must stay failed even if its process keeps running."""
    ws = tmp_path / "ws"
    package(ws)
    job = ex.create_job(ws, SID, "carla", adapter(tmp_path))
    folder = ex.job_dir(ws, job["id"])
    from topeye.scenario import xodr

    real = xodr.scene_xodr

    def server_gives_up(*args):
        ex.write_job(folder, {**ex.read_job(folder), "status": "failed", "error": {"code": "TIMEOUT", "message": "x"}})
        return real(*args)

    monkeypatch.setattr(xodr, "scene_xodr", server_gives_up)
    result = ex.run_job(ws, job["id"], adapter_for(tmp_path))
    assert result["status"] == "failed" and result["error"]["code"] == "TIMEOUT"
    assert ex.read_job(folder)["status"] == "failed" and not (folder / "files").exists()


def test_road_reference_keeps_comments_before_the_root():
    xml = b"<?xml version='1.0'?>\n<!-- authored by team -->\n<OpenSCENARIO><RoadNetwork/></OpenSCENARIO>"
    out = ex.with_road(xml, "m.xodr")
    assert b"<!-- authored by team -->" in out and b'<LogicFile filepath="m.xodr"/>' in out
