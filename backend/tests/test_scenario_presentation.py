import copy
from types import SimpleNamespace

import numpy as np
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from topeye.scenario.presentation import build_presentation, estimate_ground


def test_measured_ground_plane_rejects_vertical_sparse_and_bad_input():
    xy = np.array([(x, y) for x in np.arange(0, 6, 0.2) for y in np.arange(0, 6, 0.2)])
    xyz = np.c_[xy, 0.04 * xy[:, 0] + 0.03 * xy[:, 1] - 0.5]
    assert estimate_ground(xyz, np.zeros(len(xyz), dtype=int)) == []
    ground = estimate_ground(xyz, np.arange(len(xyz)) % 2)
    assert len(ground) >= 4
    assert all(
        abs(z - (0.04 * x + 0.03 * y - 0.5)) < 0.01 and n >= 8 and residual <= 0.15
        for x, y, z, n, residual in ground
    )
    assert estimate_ground(xyz[:4]) == []
    assert estimate_ground(np.c_[np.zeros(100), np.arange(100) / 10, np.arange(100) / 5]) == []
    assert estimate_ground([[0, 0, float("nan")]]) == []


def test_cosmetic_trim_keeps_holes_gaps_and_inputs_immutable():
    env = {
        "polygons": [
            {
                "kind": "drivable_area",
                "outer": [[0, 0], [4, 0], [4, 4], [0, 4]],
                "holes": [[[1, 1], [2, 1], [2, 2], [1, 2]]],
            }
        ],
        "buildings": [{"polygon": [[0, 0], [6, 0], [6, 6], [0, 6]], "base_z": -0.5, "height": 8}],
    }
    actor = {
        "category": "vehicle.car",
        "length_m": 2,
        "width_m": 1,
        "samples": [
            {"x_m": 5, "y_m": 1, "yaw_rad": 0, "t_s": 0},
            {"x_m": 5, "y_m": 5, "yaw_rad": 0, "t_s": 4},
        ],
    }
    before = copy.deepcopy((env, actor))
    result = build_presentation(
        env, [actor], [0, 0, 7, 7], [[0.5, 0.5, -0.5, 20, 0.01], [20, 20, 9, 20, 0.01]]
    )
    assert (env, actor) == before
    assert len(result["surfaces"][0]["holes"]) == 1
    assert len(result["ground"]["samples"]) == 1
    fragments = [Polygon(b["polygon"], b["holes"]) for b in result["buildings"]]
    assert (
        sum(
            p.intersection(Polygon(env["polygons"][0]["outer"], env["polygons"][0]["holes"])).area
            for p in fragments
        )
        < 1e-8
    )
    # A four-second missing interval must not create a fabricated swept corridor; samples sit
    # 4 m apart so the unswept wall gap stays wider than the 0.45 m box margins and 0.5 m² sliver filter.
    assert (
        sum(
            p.intersection(Polygon([[4.5, 2.9], [5.5, 2.9], [5.5, 3.1], [4.5, 3.1]])).area
            for p in fragments
        )
        > 0.01
    )


def test_source_presentation_integration_is_optional_and_raw_fields_unchanged(
    tmp_path, monkeypatch
):
    from topeye.scenario import source_scene as module

    ego = np.array([[0, 10, 20, 0, 0], [0.5, 11, 20, 0, 0], [1, 12, 20, 0, 0]])
    adapter = SimpleNamespace(
        version="v1.0-mini",
        _samples={"s": [{"timestamp": 1000000}]},
        _scene=lambda scene: [{"token": "s"}],
        _path=lambda path: tmp_path / path,
        scene_map=lambda scene: None,
        tables={"sample_annotation": {}},
    )
    monkeypatch.setattr(module, "raw_scene", lambda *args, **kwargs: (0, ego, {}))
    monkeypatch.setattr(
        module, "static_environment", lambda *args: ([], [], [], {"ground_samples": []})
    )
    result = module.source_scene(adapter, "scene")
    assert result["environment"]["presentation"]["schema_version"] == 1
    assert result["actors"][0]["samples"][0]["z_m"] == 0
    assert result["environment"]["buildings"] == []


def test_annotation_anchors_are_explicit_repeated_and_measured_ground_has_priority():
    env = {
        "polygons": [
            {"kind": "drivable_area", "outer": [[0, 0], [12, 0], [12, 12], [0, 12]], "holes": []}
        ],
        "buildings": [],
    }
    actor = {
        "category": "vehicle.car",
        "role": "traffic",
        "length_m": 4,
        "width_m": 2,
        "height_m": 2,
        "samples": [
            {"x_m": 5, "y_m": 5, "z_m": 1.2, "yaw_rad": 0, "t_s": 0},
            {"x_m": 5.1, "y_m": 5, "z_m": 1.2, "yaw_rad": 0, "t_s": 0.5},
        ],
    }
    assert (
        build_presentation(env, [{**actor, "samples": actor["samples"][:1]}], [0, 0, 12, 12], [])[
            "ground"
        ]["samples"]
        == []
    )
    inferred = build_presentation(env, [actor], [0, 0, 12, 12], [])["ground"]["samples"]
    assert len(inferred) == 1 and inferred[0][3] == 2 and inferred[0][5] == 1
    assert build_presentation(env, [actor], [0, 0, 12, 12], [[5, 5, 0.1, 20, 0.01]])["ground"][
        "samples"
    ] == [[5, 5, 0.1, 20, 0.01]]


def test_background_and_road_do_not_overlap_but_cover_the_display_envelope():
    env = {
        "polygons": [
            {
                "kind": "drivable_area",
                "outer": [[1, 1], [5, 1], [5, 5], [1, 5]],
                "holes": [[[2, 2], [3, 2], [3, 3], [2, 3]]],
            }
        ],
        "buildings": [],
    }
    result = build_presentation(env, [], [0, 0, 6, 6], [])
    road = next(
        Polygon(p["outer"], p["holes"]) for p in result["surfaces"] if p["kind"] == "drivable_area"
    )
    background = [
        Polygon(p["outer"], p["holes"]) for p in result["surfaces"] if p["kind"] == "background"
    ]
    assert sum(p.intersection(road).area for p in background) < 1e-8
    assert abs(road.area + sum(p.area for p in background) - 36) < 1e-8


def test_estimated_buildings_are_trimmed_from_observed_vehicle_corridors():
    env = {
        "polygons": [],
        "buildings": [
            {"polygon": [[-12, -12], [12, -12], [12, 12], [-12, 12]], "base_z": 0, "height": 6}
        ],
    }
    samples = [
        {"x_m": 0, "y_m": 0, "yaw_rad": 0, "t_s": 0},
        # 6 m in 0.5 s: boxes do not overlap, only the <=1 s swept bridge clears the gap.
        {"x_m": 6, "y_m": 0, "yaw_rad": 0, "t_s": 0.5},
        # 4.5 s later and 9 m away: no fabricated corridor across the missing interval.
        {"x_m": 6, "y_m": 9, "yaw_rad": 0, "t_s": 5},
    ]
    actor = {"category": "vehicle.car", "length_m": 4, "width_m": 2, "samples": samples}
    result = build_presentation(env, [actor], [-12, -12, 12, 12], [])
    fragments = unary_union([Polygon(b["polygon"], b["holes"]) for b in result["buildings"]])

    def footprint(pose, margin):
        half_l, half_w = 2 + margin, 1 + margin
        return box(
            pose["x_m"] - half_l, pose["y_m"] - half_w, pose["x_m"] + half_l, pose["y_m"] + half_w
        )

    # Every observed pose, including the bounded display margin, is wall-free.
    for pose in samples:
        assert fragments.intersection(footprint(pose, 0.4)).area <= 1e-6
    # The <=1 s gap between the first two poses is swept clear.
    assert fragments.intersection(box(2.6, -0.5, 3.4, 0.5)).area <= 1e-6
    # The 4.5 s gap keeps the estimated wall between the poses.
    assert fragments.intersection(box(5.5, 3.5, 6.5, 5.5)).area > 0.5
    assert any("Trimmed 1 estimated buildings" in d for d in result["diagnostics"])


def test_isolated_or_slope_inconsistent_measured_ground_cells_are_rejected():
    env = {
        "polygons": [
            {
                "kind": "drivable_area",
                "outer": [[-60, -60], [60, -60], [60, 60], [-60, 60]],
                "holes": [],
            }
        ],
        "buildings": [],
    }
    flat = [[x, y, 0.1, 20, 0.02] for x in range(-6, 7, 3) for y in range(-6, 7, 3)]
    slope_spike = [1.5, 1.5, 10.0, 20, 0.02]  # roof/deck cell amid road cells
    isolated_spike = [50.0, 50.0, 12.0, 20, 0.02]  # nothing within 20 m, 12 m above the scene
    isolated_plausible = [-50.0, -50.0, 1.0, 20, 0.02]  # lone cell at plausible height stays
    result = build_presentation(
        env, [], [-60, -60, 60, 60], flat + [slope_spike, isolated_spike, isolated_plausible]
    )
    kept = {tuple(r[:3]) for r in result["ground"]["samples"]}
    assert tuple(slope_spike[:3]) not in kept
    assert tuple(isolated_spike[:3]) not in kept
    assert tuple(isolated_plausible[:3]) in kept
    assert len(kept) == len(flat) + 1
    assert any("Rejected 2 measured ground cells" in d for d in result["diagnostics"])


def _ground_env(size=80):
    return {
        "polygons": [
            {
                "kind": "drivable_area",
                "outer": [[-size, -size], [size, -size], [size, size], [-size, size]],
                "holes": [],
            }
        ],
        "buildings": [],
    }


def _kept(samples):
    result = build_presentation(_ground_env(), [], [-80, -80, 80, 80], samples)
    return {tuple(r[:3]) for r in result["ground"]["samples"]}


def test_spike_filter_uses_local_neighbours_not_distant_tolerance():
    road = [[x, y, 0.1, 20, 0.02] for x in range(-45, 46, 3) for y in range(-45, 46, 3)]
    # 5.4 m above road cells 3.6 m away (≈150 % slope): distant cells must not vouch for it.
    near_spike = [22.6, 2.0, 5.5, 20, 0.02]
    # 3 m bump: only the 8 m kernel neighbourhood rejects it (cells > 7.7 m away would agree).
    low_spike = [-22.4, -20.6, 3.1, 20, 0.02]
    # Two self-consistent 9 m roof cells amid road cells: the local majority rejects both.
    roof = [[1.4, 1.6, 9.0, 20, 0.02], [4.4, 1.6, 9.0, 20, 0.02]]
    # Plausible far cell: 15 m from the grid edge, 3.5 m up (≈23 % slope) — kept via nearest rule.
    far_plausible = [60.0, 0.0, 3.5, 20, 0.02]
    kept = _kept(road + [near_spike, low_spike, far_plausible] + roof)
    assert tuple(near_spike[:3]) not in kept
    assert tuple(low_spike[:3]) not in kept
    assert not any(tuple(r[:3]) in kept for r in roof)
    assert tuple(far_plausible[:3]) in kept
    assert all(tuple(r[:3]) in kept for r in road)


def test_spike_filter_keeps_real_continuous_slopes():
    for grade in (0.1, 0.2, 0.3):
        slope = [[x, y, grade * x, 20, 0.02] for x in range(-30, 31, 3) for y in range(-9, 10, 3)]
        assert len(_kept(slope)) == len(slope), grade


def test_spike_filter_also_checks_measured_cells_against_annotation_anchors():
    car = {
        "category": "vehicle.car",
        "length_m": 4,
        "width_m": 2,
        "height_m": 1.5,
        "samples": [
            {"x_m": float(i), "y_m": 0.0, "z_m": 0.75, "yaw_rad": 0, "t_s": i * 0.5}
            for i in range(31)
        ],
    }
    spike = [15.0, 3.0, 4.5, 20, 0.02]  # lone LiDAR cell 4.5 m above repeated car-foot ground
    result = build_presentation(_ground_env(), [car], [-80, -80, 80, 80], [spike])
    rows = result["ground"]["samples"]
    assert any(len(r) > 5 and r[5] == 1 for r in rows)
    assert tuple(spike[:3]) not in {tuple(r[:3]) for r in rows}


def test_trees_and_poles_on_the_road_or_vehicle_paths_are_presentation_filtered():
    env = {
        "polygons": [
            {"kind": "drivable_area", "outer": [[0, 0], [20, 0], [20, 10], [0, 10]], "holes": []}
        ],
        "buildings": [],
        "trees": [
            {"x": 10, "y": 5, "z": 0, "height": 6, "crown_radius": 2},  # mid-road trunk
            {"x": 10, "y": 9.85, "z": 0, "height": 6, "crown_radius": 2},  # 0.15 m inside kerb
            {"x": 10, "y": 14, "z": 0, "height": 6, "crown_radius": 2},  # off road
            {"x": 30, "y": 5, "z": 0, "height": 6, "crown_radius": 2},  # on parked-car footprint
        ],
        "poles": [
            {"x": 5, "y": 5, "z": 0, "height": 8},  # mid-road
            {"x": 5, "y": 9.7, "z": 0, "height": 8},  # kerb pole
        ],
    }
    parked = {
        "category": "vehicle.car",
        "length_m": 4,
        "width_m": 2,
        "samples": [{"x_m": 30, "y_m": 5, "yaw_rad": 0, "t_s": 0}],
    }
    before = copy.deepcopy(env)
    result = build_presentation(env, [parked], [-5, -5, 40, 20], [])
    assert env == before
    assert [(t["x"], t["y"]) for t in result["trees"]] == [(10, 9.85), (10, 14)]
    assert [(p["x"], p["y"]) for p in result["poles"]] == [(5, 9.7)]
    assert any("Omitted 2 estimated trees and 1 poles" in d for d in result["diagnostics"])


def test_presentation_without_vegetation_inputs_keeps_empty_lists():
    env = {"polygons": [], "buildings": []}
    result = build_presentation(env, [], [0, 0, 1, 1], [])
    assert result["trees"] == [] and result["poles"] == []
