"""plan56: a CARLA town recording becomes a nuScenes-format dataset the app reads unchanged."""

import json
import math

import numpy as np
import pytest

from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.scenario.dataset import inspect_dataset
from topeye.scenario.extract import raw_scene
from topeye.scenario.map_context import validate_source_polygons
from topeye.scenario.models import ScenarioError
from topeye.scenario.source_scene import scene_origin, scene_vector_map


def _lane(lane_id, y0, y1, kind="Driving", marking="Broken", length=120.0):
    xs = np.linspace(-20.0, length, 30)
    return {"id": lane_id, "type": kind, "junction": False, "marking_left": marking,
            "left": [[float(x), y1] for x in xs], "right": [[float(x), y0] for x in xs], "z": [0.0] * len(xs)}


@pytest.fixture
def raw_dir(tmp_path):
    """A straight 2-lane road with a sidewalk and a crosswalk; the ego drives 30 m in 3 s past one car."""
    raw = tmp_path / "raw"
    (raw / "lidar").mkdir(parents=True)
    ticks = 61
    ego = [[round(i * 0.05, 3), i * 0.5, -1.75, 0.0, 0.0] for i in range(ticks)]
    car = {"category": "vehicle.car", "size": [1.9, 4.6, 1.5],
           "rows": [[round(i * 0.05, 3), 15.0 + i * 0.4, -1.75, 0.75, 0.0] for i in range(ticks)]}
    data = {"town": "Town10HD_Opt", "dt": 0.05, "ticks": ticks, "keyframe_every": 10,
            "lidar": {"height_m": 1.84, "x_m": 0.0}, "ego": ego, "actors": {"101": car},
            "map": {"lanes": [_lane("1_0_-1", -3.5, 0.0), _lane("1_0_1", 0.0, 3.5, marking="SolidSolid"),
                              _lane("1_0_-2", -5.5, -3.5, kind="Sidewalk", marking="NONE")],
                    "crosswalks": [[[60.0, -3.5], [64.0, -3.5], [64.0, 3.5], [60.0, 3.5]]]}}
    (raw / "raw.json").write_text(json.dumps(data))
    rng = np.random.default_rng(0)
    for t in range(ticks):
        pts = rng.normal(size=(500, 4)).astype(np.float32)
        pts[:, 2] = -1.84
        pts[:, 3] = 40.0
        np.save(raw / "lidar" / f"{t:04d}.npy", pts)
    return raw


def test_built_dataset_reads_like_nuscenes(raw_dir, tmp_path):
    from topeye.scenario.carla_town import build_dataset

    root = build_dataset(raw_dir, tmp_path / "carla-town10hd", "carla-town10hd")
    result = inspect_dataset(str(root))
    assert result["version"] == "v1.0-mini"
    assert [s["scene"] for s in result["scenes"]] == ["carla-town10hd"]
    assert result["regions"] == ["carla-Town10HD_Opt"]

    adapter = NuScenesAdapter(root, "v1.0-mini")
    assert adapter.scene_map("carla-town10hd")[0] == "carla-Town10HD_Opt"
    assert len(adapter.frames("carla-town10hd")) == 7  # keyframes every 0.5 s over 3 s
    assert len(adapter.sweep_frames("carla-town10hd")) == 61
    pts = adapter.load_points(adapter.frames("carla-town10hd")[0])
    assert pts.shape == (500, 4) and np.allclose(pts[:, 2], -1.84)

    _, ego, tracks = raw_scene(adapter, "carla-town10hd")
    assert ego.shape == (61, 5) and np.isclose(ego[-1, 1], 30.0) and np.isclose(ego[0, 2], -1.75)
    (track,) = tracks.values()
    assert track["category"] == "vehicle.car" and len(track["rows"]) == 7
    assert np.allclose(track["rows"][1, 1:4], [19.0, -1.75, 0.75])
    assert np.allclose(track["sizes"][0], [1.9, 4.6, 1.5])

    _, polygons, lines, label = scene_vector_map(adapter, "carla-town10hd", ego, scene_origin(ego))
    kinds = {p["kind"] for p in polygons}
    assert {"drivable_area", "lane", "walkway", "ped_crossing"} <= kinds
    validate_source_polygons(polygons)  # the app's map admission accepts every polygon
    assert {line["kind"] for line in lines} == {"lane_divider", "road_divider"}
    assert label == "nuScenes expansion: carla-Town10HD_Opt"


def test_yaw_becomes_a_unit_quaternion_about_z(raw_dir, tmp_path):
    from topeye.scenario.carla_town import build_dataset

    data = json.loads((raw_dir / "raw.json").read_text())
    for row in data["ego"]:
        row[4] = math.pi / 2
    (raw_dir / "raw.json").write_text(json.dumps(data))
    root = build_dataset(raw_dir, tmp_path / "out", "carla-town10hd")
    _, ego, _ = raw_scene(NuScenesAdapter(root, "v1.0-mini"), "carla-town10hd")
    assert np.allclose(ego[:, 4], math.pi / 2)


def test_rejects_an_incomplete_recording(raw_dir, tmp_path):
    from topeye.scenario.carla_town import build_dataset

    (raw_dir / "lidar" / "0003.npy").unlink()
    with pytest.raises(ScenarioError, match="DATASET_INVALID|LiDAR"):
        build_dataset(raw_dir, tmp_path / "out", "carla-town10hd")


def test_tracks_split_at_gaps_and_cut_where_the_simulator_breaks_the_app_physics():
    """plan56 D7: a vehicle leaving and re-entering the recorded radius becomes two tracks; keyframes where
    CARLA's Traffic Manager accelerates or brakes beyond the app's physics limits are cut (like label errors)."""
    from topeye.scenario.carla_town import clean_tracks

    dt = 0.05
    smooth = [[round(i * dt, 3), 10.0 + i * 0.5, 0.0, 0.7, 0.0] for i in range(41)]  # 10 m/s, 2 s
    gap = smooth[:10] + smooth[30:]  # gone between 0.45 s and 1.5 s
    slam = [[round(i * dt, 3), 50 + (i * 0.5 if i <= 20 else 10 + (i - 20) * 0.05), 0.0, 0.7, 0.0] for i in range(41)]
    tracks = clean_tracks({"a": {"category": "vehicle.car", "size": [2, 4, 1.5], "rows": smooth},
                           "b": {"category": "vehicle.car", "size": [2, 4, 1.5], "rows": gap},
                           "c": {"category": "vehicle.car", "size": [2, 4, 1.5], "rows": slam}}, dt)
    assert len(tracks["a"]["rows"]) == 41
    assert sorted(k for k in tracks if k.startswith("b")) == ["b", "b~1"]
    assert [len(tracks[k]["rows"]) for k in ("b", "b~1")] == [10, 11]
    c_rows = [r for k, t in tracks.items() if k.startswith("c") for r in t["rows"]]
    assert all(abs(r[0] - 1.0) > 0.3 for r in c_rows)  # 10 m/s -> 1 m/s within a tick: cut around t = 1 s
