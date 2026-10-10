import json
from typing import ClassVar

import numpy as np

from topeye.scenario.extract import raw_scene
from topeye.scenario.source_scene import vector_map


def test_missing_lidar_preserves_source_actors_with_incomplete_warning(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from topeye.core.adapters.base import DatasetError
    from topeye.scenario import source_scene as module

    ego = np.array([[0, 10, 20, 0, 0], [0.5, 11, 20, 0, 0], [1, 12, 20, 0, 0]])
    adapter = SimpleNamespace(
        version="v1.0-mini", _samples={"s": [{"timestamp": 1000000}]},
        _scene=lambda scene: [{"token": "s"}],
        _path=lambda path: tmp_path / path,
        scene_map=lambda scene: None,
        tables={"sample_annotation": {}},
    )
    monkeypatch.setattr(module, "raw_scene", lambda *args, **kwargs: (0, ego, {}))

    def unavailable(*args):
        raise DatasetError("Cannot load LiDAR: missing binary")

    monkeypatch.setattr(module, "static_environment", unavailable)
    result = module.source_scene(adapter, "scene")
    assert len(result["actors"]) == 1
    assert result["environment"]["buildings"] == []
    assert any("LiDAR" in warning for warning in result["environment"]["warnings"])
    assert result["environment"]["stats"]["complete"] is False


def test_map_origin_holes_and_far_features(tmp_path):
    nodes = [
        {"token": str(i), "x": x, "y": y}
        for i, (x, y) in enumerate(
            [
                (100, 200),
                (110, 200),
                (110, 210),
                (100, 210),
                (102, 202),
                (103, 202),
                (103, 203),
                (1000, 1000),
                (1010, 1010),
            ]
        )
    ]
    data = {
        "node": nodes,
        "polygon": [
            {
                "token": "p",
                "exterior_node_tokens": ["0", "1", "2", "3"],
                "holes": [{"node_tokens": ["4", "5", "6"]}],
            }
        ],
        "line": [
            {"token": "l", "node_tokens": ["0", "1"]},
            {"token": "far", "node_tokens": ["7", "8"]},
        ],
        "walkway": [{"polygon_token": "p"}],
        "road_divider": [{"line_token": "l"}, {"line_token": "far"}],
    }
    p = tmp_path / "map.json"
    p.write_text(json.dumps(data))
    polygons, lines = vector_map(p, np.array([100, 200, 3]), [-1, -1, 20, 20])
    assert polygons[0]["outer"][0] == [0, 0]
    assert polygons[0]["holes"][0][0] == [2, 2]
    assert len(lines) == 1
    assert lines[0]["points"] == [[0, 0], [10, 0]]


def test_raw_source_does_not_filter_pedestrians():
    # Minimal tables also prove the legacy simulator filter stays intact.
    class Adapter:
        tables: ClassVar = {
            "scene": {"s": {"name": "scene", "token": "s"}},
            "sample": {},
            "sample_annotation": {},
            "instance": {},
            "category": {},
            "sample_data": {},
            "calibrated_sensor": {"c": {"sensor_token": "l"}},
            "sensor": {"l": {"channel": "LIDAR_TOP"}},
            "ego_pose": {},
        }

    a = Adapter()
    for i in range(3):
        key = str(i)
        a.tables["sample"][key] = {"token": key, "scene_token": "s", "timestamp": i * 500000}
        a.tables["ego_pose"][key] = {
            "timestamp": i * 500000,
            "translation": [i, 0, 0],
            "rotation": [1, 0, 0, 0],
        }
        a.tables["sample_data"][key] = {
            "sample_token": key,
            "calibrated_sensor_token": "c",
            "ego_pose_token": key,
        }
    a.tables["category"]["p"] = {"name": "human.pedestrian.adult"}
    a.tables["instance"]["p"] = {"category_token": "p"}
    a.tables["sample_annotation"]["a"] = {
        "sample_token": "1",
        "instance_token": "p",
        "translation": [2, 3, 4],
        "size": [0.5, 0.6, 1.7],
        "rotation": [1, 0, 0, 0],
    }
    assert not raw_scene(a, "scene")[2]
    tracks = raw_scene(a, "scene", True)[2]
    assert tracks["p"]["rows"].tolist() == [[0.5, 2, 3, 4, 0]]
