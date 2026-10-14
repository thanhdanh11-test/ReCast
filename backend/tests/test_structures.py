"""Road-edge corridor structures and overhead decks (plan36)."""

from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import LineString, Point, Polygon, box

from topeye.scenario.structures import (
    corridor_structures,
    overhead_structures,
    road_height_fn,
    roadside_barriers,
)

ROAD = box(0, -4, 100, 4)
EGO = np.c_[np.linspace(0, 100, 101), np.zeros(101)]
ROAD_Z = road_height_fn(np.c_[EGO, np.full(len(EGO), 2.0)])  # an elevated, level deck at z = 2


def sheet(y, x0, x1, top, step=0.3):
    """Dense vertical 0.3 m voxel sheet just outside the road edge, from 0.3 m to `top` above the deck."""
    xs, hs = np.meshgrid(np.arange(x0, x1, step), np.arange(0.3, top, step))
    return np.c_[xs.ravel(), np.full(xs.size, y), 2.0 + hs.ravel()]


def corridor(points):
    return corridor_structures(roadside_barriers(points, ROAD, ROAD_Z), EGO)


def test_road_height_is_local_median_of_nearest_ground():
    rz = road_height_fn([[0, 0, 1.0], [1, 0, 1.2], [2, 0, 5.0], [50, 0, 9.0]])
    assert rz([[0.4, 0]])[0] == pytest.approx(1.2)
    assert rz([[50, 0]])[0] == pytest.approx(5.0)


def test_tall_structures_on_both_sides_form_a_corridor_at_the_deck_level():
    runs = corridor(np.r_[sheet(4.5, 20, 60, 4.0), sheet(-4.5, 25, 60, 3.0)])
    assert [r["kind"] for r in runs] == ["corridor", "corridor"]
    for run in runs:
        assert run["length_m"] >= 30
        assert np.median(run["heights"]) >= 2.5
        assert all(p[2] == pytest.approx(2.0) for p in run["points"])  # base on the deck, not z = 0
        xs = [p[0] for p in run["points"]]
        assert 19 <= min(xs) and max(xs) <= 61


def test_one_sided_walls_low_railings_and_clutter_are_not_drawn():
    assert corridor(sheet(4.5, 20, 60, 4.0)) == []  # a facade on one side only
    assert corridor(np.r_[sheet(4.5, 20, 60, 1.1), sheet(-4.5, 20, 60, 1.1)]) == []  # railings
    posts = np.concatenate([sheet(4.5, x, x + 0.3, 1.2) for x in range(10, 90, 6)])
    assert roadside_barriers(posts, ROAD, ROAD_Z) == []  # street furniture: no continuous run


def test_structures_far_from_the_driven_path_are_ignored():
    road = box(0, -4, 100, 30)
    points = np.r_[sheet(30.5, 20, 60, 4.0), sheet(-4.5, 20, 60, 4.0)]
    barriers = roadside_barriers(points, road, ROAD_Z)
    assert len(barriers) == 2
    assert corridor_structures(barriers, EGO) == []


def deck(x0, x1, y0, y1, z0, thickness=0.3):
    xs, ys, zs = np.meshgrid(
        np.arange(x0, x1, 0.3), np.arange(y0, y1, 0.3), np.arange(z0, z0 + thickness, 0.3)
    )
    return np.c_[xs.ravel(), ys.ravel(), zs.ravel()]


def test_overhead_deck_driven_under_is_found_with_its_clearance():
    found = overhead_structures(deck(30, 50, -4, 4, 2.0 + 5.0), ROAD, ROAD_Z, EGO)
    assert len(found) == 1
    assert found[0]["underside_above_road_m"] == pytest.approx(5.0, abs=0.2)
    assert found[0]["area_m2"] >= 100


def test_tree_crowns_awnings_beside_the_path_and_obstructed_space_are_not_decks():
    crowns = deck(30, 50, -4, 4, 2.0 + 4.5, thickness=3.0)  # metres of foliage, not one surface
    assert overhead_structures(crowns, ROAD, ROAD_Z, EGO) == []
    beside = overhead_structures(
        deck(30, 50, -4, 4, 7.0), ROAD, ROAD_Z, EGO[:20]
    )  # not driven under
    assert beside == []
    truck = np.r_[
        deck(30, 50, -4, 4, 7.0), deck(30, 50, -4, 4, 4.0)
    ]  # something between road and sheet
    assert overhead_structures(truck, ROAD, ROAD_Z, EGO) == []


AV2 = Path(__file__).resolve().parents[1] / "data/dataset-intake-20261013/argoverse2"
NUSCENES = Path("/Users/macos/cvat-day2/tools/traffic_pipeline/data/nuscenes")


@pytest.mark.skipif(
    not (AV2 / "02678d04-cc9f-3148-9f95-1ba66347dff9").is_dir(),
    reason="AV2 bridge log not downloaded",
)
def test_real_truss_bridge_gets_two_sided_structure_and_no_towers_beside_the_lane():
    from topeye.scenario.dataset import create_adapter
    from topeye.scenario.source_scene import source_scene

    adapter = create_adapter(AV2, "av2-sensor")
    scene = next(s for s in adapter.scenes() if "02678d04" in s)
    env = source_scene(adapter, scene)["environment"]
    ego = next(a for a in source_scene(adapter, scene)["actors"] if a["role"] == "ego")
    path = LineString([(q["x_m"], q["y_m"]) for q in ego["samples"]])
    runs = env["barriers"]
    assert len(runs) == 2 and all(np.median(r["heights"]) >= 2.5 for r in runs)
    # Both trusses stand on the deck (~3.3 m above the scene start), on opposite sides.
    assert all(np.median([p[2] for p in r["points"]]) > 2.5 for r in runs)
    on_bridge = [
        b
        for b in env["presentation"]["buildings"]
        if Polygon(b["polygon"]).distance(path) < 3
        and path.project(Polygon(b["polygon"]).centroid) > 85
    ]
    assert on_bridge == []
    # No crown rooted on the deck beside the lane (the truss lattice was read as canopy before).
    # Trees growing below the bridge (rooted near z = 0) are real and stay.
    deck_trees = [
        t
        for t in env["presentation"]["trees"]
        if path.distance(Point(t["x"], t["y"])) < 4
        and path.project(Point(t["x"], t["y"])) > 85
        and t["z"] > 2.5
    ]
    assert deck_trees == []
    # Buildings beside the climbing approach stand on the local road level, not the scene's lowest
    # ground (before plan36 all bases were the scene minimum, -0.4 m).
    z_at = {round(path.project(Point(q["x_m"], q["y_m"]))): q["z_m"] for q in ego["samples"]}
    for b in env["presentation"]["buildings"]:
        poly = Polygon(b["polygon"])
        if poly.distance(path) < 6:
            along = round(path.project(poly.centroid))
            road_level = z_at[min(z_at, key=lambda s: abs(s - along))]
            assert b["base_z"] >= road_level - 1.0


@pytest.mark.skipif(not (NUSCENES / "v1.0-mini").is_dir(), reason="nuScenes mini not available")
def test_real_city_street_without_bridge_gets_no_structures():
    from topeye.scenario.dataset import create_adapter
    from topeye.scenario.source_scene import source_scene

    adapter = create_adapter(NUSCENES, "v1.0-mini")
    env = source_scene(adapter, "scene-0103")["environment"]
    assert env["barriers"] == [] and env["overheads"] == []
