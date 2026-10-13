"""Independent geometry fixtures for native AV2 ingestion."""

import json

import numpy as np
import pyarrow as pa
import pytest
from pyarrow import feather

from topeye.core.adapters.argoverse import ArgoverseAdapter
from topeye.core.adapters.base import DatasetError
from topeye.scenario.dataset import inspect_dataset
from topeye.scenario.extract import raw_scene
from topeye.scenario.lidar_frame import lidar_frame

LOG = "00000000-0000-0000-0000-000000000001"


def write_rows(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    feather.write_feather(pa.Table.from_pylist(rows), path)


@pytest.fixture
def av2(tmp_path):
    log = tmp_path / LOG
    times = [1_000_000_123 + i * 100_000_000 for i in range(3)]
    poses, annotations = [], []
    for i, t in enumerate(times):
        # Ego facing north; an object 2m ahead must end up at world (100+i, 202, 3).
        poses.append(
            {
                "timestamp_ns": t,
                "qw": 2**-0.5,
                "qx": 0.0,
                "qy": 0.0,
                "qz": 2**-0.5,
                "tx_m": 100.0 + i,
                "ty_m": 200.0,
                "tz_m": 3.0,
            }
        )
        annotations.append(
            {
                "timestamp_ns": t,
                "track_uuid": "object-1",
                "category": "REGULAR_VEHICLE",
                "length_m": 4.0,
                "width_m": 2.0,
                "height_m": 1.5,
                "qw": 1.0,
                "qx": 0.0,
                "qy": 0.0,
                "qz": 0.0,
                "tx_m": 2.0,
                "ty_m": 0.0,
                "tz_m": 0.0,
                "num_interior_pts": 1,
            }
        )
        write_rows(
            log / f"sensors/lidar/{t}.feather", [{"x": 1.0, "y": 0.0, "z": 0.0, "intensity": 12}]
        )
    write_rows(log / "city_SE3_egovehicle.feather", poses)
    write_rows(log / "annotations.feather", annotations)

    def pts(*xy):
        return [{"x": x, "y": y, "z": 3.0} for x, y in xy]

    mapping = {
        "lane_segments": {
            "1": {
                "left_lane_boundary": pts((99, 198), (99, 205)),
                "right_lane_boundary": pts((103, 198), (103, 205)),
                "left_lane_mark_type": "SOLID_WHITE",
                "right_lane_mark_type": "NONE",
            }
        },
        "drivable_areas": {
            "1": {"area_boundary": pts((98, 197), (104, 197), (104, 206), (98, 206))}
        },
        "pedestrian_crossings": {
            "1": {"edge1": pts((99, 201), (103, 201)), "edge2": pts((99, 202), (103, 202))}
        },
    }
    (log / "map").mkdir()
    (log / "map/log_map_archive_fixture____PIT_city.json").write_text(json.dumps(mapping))
    return tmp_path, log, times


def test_ego_transform_once_dimensions_and_ns_precision(av2):
    root, _, times = av2
    adapter = ArgoverseAdapter(root)
    scene = adapter.scenes()[0]
    frame = adapter.frames(scene)[0]
    point = adapter.load_points(frame)[0, :3]
    assert np.allclose(point, [1, 0, 0])
    assert np.allclose(frame.T_world_lidar[:3, :3] @ point + frame.T_world_lidar[:3, 3], [0, 1, 0])
    box = adapter.gt_boxes(frame)[0]
    assert np.allclose([box.cx, box.cy, box.cz], [2, 0, 0])
    assert np.allclose([box.l, box.w, box.h, box.yaw], [4, 2, 1.5, 0])
    t0, ego, tracks = raw_scene(adapter, scene)
    assert t0 == times[0] // 1000
    assert 0 <= times[0] - t0 * 1000 < 1000
    track = next(iter(tracks.values()))
    assert np.allclose(track["rows"][0, 1:4], [100, 202, 3])
    assert np.isclose(track["rows"][0, 4], np.pi / 2)
    assert np.allclose(ego[:, 0], [0, 0.1, 0.2])
    cloud = lidar_frame(adapter, scene, 0.15)
    assert cloud["count"] > 0 and abs(cloud["offset_s"]) <= 0.1


def test_native_map_uses_local_origin_and_only_actual_markings(av2):
    adapter = ArgoverseAdapter(av2[0])
    polygons, lines = adapter.vector_map(
        adapter.scenes()[0], np.array([100, 200, 3]), [-20, -20, 20, 20]
    )
    assert {p["kind"] for p in polygons} == {"lane", "drivable_area", "ped_crossing"}
    assert len(lines) == 1
    assert lines[0]["points"] == [[-1, -2], [-1, 5]]
    lane = next(p for p in polygons if p["kind"] == "lane")
    assert lane["outer"] == [[-1, -2], [-1, 5], [3, 5], [3, -2]]


def test_detection_and_inspection_keep_av2_identity(av2):
    result = inspect_dataset(av2[0])
    assert result["version"] == "av2-sensor"
    assert len(result["scenes"]) == 1
    assert result["regions"] == ["PIT"]
    assert result["scenes"][0]["scene"] == "av2-" + LOG
    assert not (av2[0] / "v1.0-mini").exists()


def test_missing_exact_pose_rejected_no_nearest_substitution(av2):
    root, log, _ = av2
    path = log / "city_SE3_egovehicle.feather"
    table = feather.read_table(path)
    feather.write_feather(table.slice(1), path)
    with pytest.raises(DatasetError, match="exact ego pose"):
        ArgoverseAdapter(root)


def test_incomplete_timeline_and_missing_map_rejected(av2):
    root, log, times = av2
    (log / f"sensors/lidar/{times[1]}.feather").unlink()
    with pytest.raises(DatasetError, match="timeline incomplete"):
        ArgoverseAdapter(root)


def test_nonfinite_cloud_rejected(av2):
    root, log, times = av2
    write_rows(
        log / f"sensors/lidar/{times[0]}.feather",
        [{"x": float("nan"), "y": 0.0, "z": 0.0, "intensity": 1}],
    )
    adapter = ArgoverseAdapter(root)
    with pytest.raises(DatasetError, match="non-finite"):
        adapter.load_points(adapter.frames(adapter.scenes()[0])[0])


def test_symlink_cloud_cannot_escape_dataset(av2, tmp_path):
    root, log, times = av2
    path = log / f"sensors/lidar/{times[0]}.feather"
    outside = root.parent / (root.name + "-outside.feather")
    outside.write_bytes(path.read_bytes())
    path.unlink()
    path.symlink_to(outside)
    try:
        with pytest.raises(DatasetError, match="escapes root"):
            ArgoverseAdapter(root)
    finally:
        outside.unlink()
