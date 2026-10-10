import copy

import pytest

from topeye.scenario.map_context import build_map_context, check_map
from topeye.scenario.models import ScenarioError


def source_fixture():
    return {
        "id": "source",
        "mode": "source",
        "source": {
            "scene": "scene-test",
            "origin_global_m": [123.4, 567.8, 1.2],
            "dataset_version": "v1.0-mini",
            "bounds_m": [-30, -30, 30, 30],
        },
        "actors": [
            {
                "id": "ego",
                "role": "ego",
                "category": "vehicle.car",
                "length_m": 4.5,
                "width_m": 1.8,
                "height_m": 1.6,
                "samples": [{"t_s": 0, "x_m": 0, "y_m": 0, "z_m": 0, "yaw_rad": 0}],
            }
        ],
        "environment": {
            "polygons": [
                {
                    "kind": "drivable_area",
                    "outer": [[-30, -30], [30, -30], [30, 30], [-30, 30]],
                    "holes": [],
                }
            ],
            "buildings": [],
            "trees": [],
            "poles": [],
        },
    }


def test_context_stable_and_source_unchanged():
    source = source_fixture()
    before = copy.deepcopy(source)
    c = build_map_context(source)
    source["id"] = "other"
    assert build_map_context(source)["map_id"] == c["map_id"]
    source["id"] = "source"
    assert source == before
    source["environment"]["polygons"][0]["outer"][0][0] -= 1
    assert build_map_context(source)["map_id"] != c["map_id"]


def test_hole_tunnel_and_corner():
    source = source_fixture()
    source["environment"]["polygons"][0]["holes"] = [
        [[-0.01, -2], [0.01, -2], [0.01, 2], [-0.01, 2]]
    ]
    c = build_map_context(source)
    actor = {
        "id": "car",
        "category": "vehicle.car",
        "length_m": 0.1,
        "width_m": 0.1,
        "samples": [
            {"x_m": -1, "y_m": 0, "z_m": 0, "yaw_rad": 0},
            {"x_m": 1, "y_m": 0, "z_m": 0, "yaw_rad": 0},
        ],
    }
    with pytest.raises(ScenarioError, match="segment"):
        check_map([actor], c)
    actor["samples"] = [{"x_m": 29.99, "y_m": 0, "z_m": 0, "yaw_rad": 0}]
    with pytest.raises(ScenarioError):
        check_map([actor], c)


def test_invalid_map_rejected():
    source = source_fixture()
    source["environment"]["polygons"][0]["outer"] = [[0, 0], [1, 1], [0, 1], [1, 0]]
    with pytest.raises(ScenarioError):
        build_map_context(source)


def test_static_obstacle_and_pedestrian_walkway():
    source = source_fixture()
    source["environment"]["buildings"] = [{"polygon": [[-1, -1], [1, -1], [1, 1], [-1, 1]]}]
    context = build_map_context(source)
    actor = {
        "id": "person",
        "category": "human.pedestrian",
        "length_m": 0.5,
        "width_m": 0.5,
        "samples": [{"x_m": 0, "y_m": 0, "z_m": 0, "yaw_rad": 0}],
    }
    with pytest.raises(ScenarioError) as exc:
        check_map([actor], context)
    assert exc.value.code == "STATIC_OBSTACLE"
    actor["samples"][0]["x_m"] = 5
    assert any(d["code"] == "PEDESTRIAN_ROADWAY" for d in check_map([actor], context))


def test_disconnected_surface_and_rotated_corner():
    source = source_fixture()
    source["environment"]["polygons"] = [
        {"kind": "lane", "outer": [[-5, -5], [-1, -5], [-1, 5], [-5, 5]], "holes": []},
        {"kind": "lane", "outer": [[1, -5], [5, -5], [5, 5], [1, 5]], "holes": []},
    ]
    context = build_map_context(source)
    actor = {
        "id": "car",
        "category": "vehicle.car",
        "length_m": 0.5,
        "width_m": 0.5,
        "samples": [
            {"x_m": -3, "y_m": 0, "z_m": 0, "yaw_rad": 0},
            {"x_m": 3, "y_m": 0, "z_m": 0, "yaw_rad": 0},
        ],
    }
    with pytest.raises(ScenarioError) as exc:
        check_map([actor], context)
    assert exc.value.code == "OUTSIDE_SURFACE"
    actor["length_m"] = 4
    actor["samples"] = [{"x_m": -3, "y_m": 4.5, "z_m": 0, "yaw_rad": 0.785398}]
    with pytest.raises(ScenarioError):
        check_map([actor], context)


def test_estimated_self_intersecting_building_conservative_enclosure():
    source = source_fixture()
    ring = [[-2, -2], [2, 2], [-2, 2], [2, -2]]
    source["environment"]["buildings"] = [{"polygon": ring}]
    original = copy.deepcopy(source)
    context = build_map_context(source)
    assert source == original
    enclosure = context["static_obstacles"][0]["footprint"]
    from shapely.geometry import Point, Polygon

    assert Polygon(enclosure).is_valid
    assert all(Polygon(enclosure).covers(Point(*p)) for p in ring)
    actor = {
        "id": "ego",
        "category": "vehicle.car",
        "length_m": 0.2,
        "width_m": 0.2,
        "samples": [{"x_m": 0, "y_m": 0, "z_m": 0, "yaw_rad": 0}],
    }
    with pytest.raises(ScenarioError) as exc:
        check_map([actor], context)
    assert exc.value.code == "STATIC_OBSTACLE"
    assert "convex enclosure" in context["collision_provenance"][0]


def test_map_context_node_json_roundtrip_digest():
    import json
    import subprocess

    from topeye.scenario.map_context import canonical, verify_context

    source = source_fixture()
    source["source"]["origin_global_m"] = [-0.0, 567.1234567890123, 1.2]
    source["environment"]["polygons"][0]["outer"][0] = [-30.0, -30.0]
    context = build_map_context(source)
    result = subprocess.run(
        [
            "node",
            "-e",
            'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(s))))',
        ],
        input=json.dumps(context),
        text=True,
        capture_output=True,
        check=True,
    )
    transported = json.loads(result.stdout)
    verify_context(transported)
    assert canonical(transported) == canonical(context)
    assert (
        transported["coordinates"]["origin_global_m"][1]
        == context["coordinates"]["origin_global_m"][1]
    )
    assert canonical({"v": True}) != canonical({"v": 1})
