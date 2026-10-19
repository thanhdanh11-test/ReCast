import math
import os
import sys
from pathlib import Path

import numpy as np
import pytest
from test_scenario_import_service import service  # noqa: F401 — shared fixture
from test_scenario_xosc_import import fixture_xml

from topeye.scenario import scene_metrics as sm
from topeye.scenario.worker import Service

ENGINE = (
    Path(__file__).resolve().parents[1]
    / (".tools/esmini/build/EnvironmentSimulator/Libraries/esminiLib/libesminiLib" + (".dylib" if sys.platform == "darwin" else ".so"))
)
DATA = Path.home() / "cvat-day2/tools/traffic_pipeline/data"


def actor(aid, pts, role="traffic", category="vehicle.car", dt=0.5, length=4.0, width=1.8):
    samples = []
    for i, (x, y) in enumerate(pts):
        nxt = pts[min(i + 1, len(pts) - 1)]
        prv = pts[max(i - 1, 0)]
        yaw = math.atan2(nxt[1] - prv[1], nxt[0] - prv[0]) if nxt != prv else 0.0
        samples.append(
            {"t_s": i * dt, "x_m": x, "y_m": y, "z_m": 0.0, "yaw_rad": yaw, "observed": True}
        )
    return {
        "id": aid,
        "role": role,
        "category": category,
        "length_m": length,
        "width_m": width,
        "height_m": 1.5,
        "samples": samples,
    }


def test_moving_needs_distance_and_speed():
    jitter = sm.rows(actor("p", [(0, 0), (0.3, 0), (0.0, 0), (0.3, 0), (0.0, 0), (0.3, 0)]))
    assert not sm.is_moving(
        jitter
    )  # 1.5 m of label noise but never truly travels 2 m? path counts jitter
    slow = sm.rows(actor("s", [(i * 0.2, 0) for i in range(20)]))  # 3.8 m at 0.4 m/s
    assert not sm.is_moving(slow)
    car = sm.rows(actor("c", [(i * 3.0, 0) for i in range(5)]))
    assert sm.is_moving(car)


def test_grid_skips_label_gaps_and_baseline_is_constant_velocity():
    a = actor("c", [(0, 0), (5, 0), (10, 0)])
    a["samples"][2]["t_s"] = 3.0  # 2.5 s gap between the 2nd and 3rd label
    data = sm.rows(a)
    t = sm.grid(data)
    assert (
        t.min() == 0 and math.isclose(t[t <= 0.5].max(), 0.5) and not ((t > 0.5) & (t < 3.0)).any()
    )
    np.testing.assert_allclose(sm.baseline(data, [0, 1, 2]), [[0, 0], [10, 0], [20, 0]])


def test_lon_lat_signs():
    d = sm.lon_lat(np.array([[-2.0, 1.0]]), np.array([[0.0, 0.0]]), np.array([0.0]))
    assert d.tolist() == [[-2.0, 1.0]]  # behind (negative) and to the left (positive)
    d = sm.lon_lat(np.array([[0.0, 3.0]]), np.array([[0.0, 0.0]]), np.array([math.pi / 2]))
    np.testing.assert_allclose(d, [[3.0, 0.0]], atol=1e-12)


def test_pilot_variant_follows_the_path_while_baseline_goes_straight():
    # Quarter circle of radius 20 m: a shift along the path stays on the arc, the straight one leaves it.
    pts = [(20 * math.sin(a), 20 - 20 * math.cos(a)) for a in np.linspace(0, math.pi / 2, 9)]
    data = sm.rows(actor("c", pts))
    cum = sm.arc(data)
    xy, _ = sm.along(data, cum, np.array([cum[-1] * 0.75]))
    assert abs(math.hypot(xy[0, 0], xy[0, 1] - 20) - 20) < 0.5
    straight = data[0, 1:3] + cum[-1] * 0.75 * np.array(
        [math.cos(data[0, 4]), math.sin(data[0, 4])]
    )
    assert abs(math.hypot(straight[0], straight[1] - 20) - 20) > 3


def test_overlap_and_ego_events_in_a_small_scene():
    ego = actor("ego", [(i * 2.0, 0) for i in range(11)], role="ego", category="vehicle.ego")
    lead = actor("lead", [(15 + i * 2.0, 0) for i in range(11)])  # 15 m ahead, same speed
    scene = {
        "source": {"scene": "t"},
        "interval_s": [0, 5.0],
        "actors": [ego, lead],
        "environment": {"polygons": []},
    }
    m = sm.scene_metrics(scene, engine=None)
    assert m["objects"] == {"total": 2, "moving": 2}
    assert m["rare"]["original"] == 0 and m["rare"]["pilot"] is None
    assert m["variants"]["total"] == 16 and m["variants"]["map_checked"] is False
    assert (
        m["replay"]["pilot"] is None and m["replay"]["baseline"]["ade_m"] < 1e-9
    )  # straight constant speed
    assert any("esmini" in n for n in m["notes"])


@pytest.mark.skipif(not ENGINE.is_file(), reason="esmini engine not built")
def test_esmini_replays_labels_closer_than_the_baseline(tmp_path):
    turn = [(20 * math.sin(a), 20 - 20 * math.cos(a)) for a in np.linspace(0, math.pi / 2, 9)]
    scene = {
        "source": {"scene": "t"},
        "interval_s": [0, 4.0],
        "environment": {"polygons": []},
        "actors": [
            actor("ego", turn, role="ego", category="vehicle.ego"),
            actor(
                "ped",
                [(30, i * 0.8) for i in range(9)],
                category="human.pedestrian.adult",
                length=0.6,
                width=0.6,
            ),
        ],
    }
    m = sm.scene_metrics(scene, engine=ENGINE, cache_dir=tmp_path)
    assert m["engine"] == "esmini 3.9.0"
    assert m["replay"]["pilot"]["max_m"] < 0.05
    assert m["replay"]["baseline"]["ade_m"] > 1.0
    ego = m["per_object"]["ego"]
    assert len(ego["pilot_err"]) == len(ego["grid_t"]) == len(ego["baseline_lon_lat"])


@pytest.mark.skipif(
    not (ENGINE.is_file() and (DATA / "nuscenes").is_dir()), reason="dataset or engine missing"
)
def test_real_scene_0061():
    from topeye.core.adapters.nuscenes import NuScenesAdapter
    from topeye.scenario.source_scene import source_scene

    adapter = NuScenesAdapter(Path(os.environ.get("TOPEYE_NUSC_ROOT", DATA / "nuscenes")))
    m = sm.scene_metrics(source_scene(adapter, "scene-0061"), engine=ENGINE)
    assert m["objects"]["total"] == 228 and 30 < m["objects"]["moving"] < 80
    assert m["replay"]["pilot"]["ade_m"] < 0.01 < m["replay"]["baseline"]["ade_m"]
    assert 0 < m["variants"]["pilot_valid"] <= m["variants"]["total"]


def test_rare_event_is_same_lane_ttc_not_adjacent_lane_passing():
    ego = actor(
        "ego", [(i * 5.0, 0) for i in range(9)], role="ego", category="vehicle.ego"
    )  # 10 m/s
    slow_lead = actor(
        "lead", [(25 + i * 0.5, 0) for i in range(9)]
    )  # 1 m/s, same lane, closing at 9 m/s
    passing = actor(
        "side", [(40 - i * 5.0, 3.5) for i in range(9)]
    )  # opposite direction, next lane
    scene = {
        "source": {"scene": "t"},
        "interval_s": [0, 4.0],
        "actors": [ego, slow_lead, passing],
        "environment": {"polygons": []},
    }
    assert sm.scene_metrics(scene, engine=None)["rare"]["original"] == 1
    scene["actors"] = [ego, passing]
    assert sm.scene_metrics(scene, engine=None)["rare"]["original"] == 0


@pytest.mark.skipif(not ENGINE.is_file(), reason="esmini engine not built")
def test_scenario_metrics_replays_the_imported_xosc_and_caches(service):  # noqa: F811
    import base64

    from topeye.scenario.models import ScenarioError

    api, params = service
    source = api.call("source_scene", params)
    context = api.call("map_context", {**params, "source_id": source["id"]})
    xml = fixture_xml(context)
    imported = api.call(
        "import_xosc",
        {**params, "source_id": source["id"], "xml_base64": base64.b64encode(xml).decode()},
    )
    args = {**params, "scenario_id": imported["id"], "engine": str(ENGINE)}
    m = Service().call("scenario_metrics", args)  # a fresh worker, like the metrics bridge
    assert m["scenario_id"] == imported["id"] and m["objects"]["total"] == 3
    assert m["replay"]["pilot"]["max_m"] < 0.05
    assert all(o["keyframes"] >= 2 for o in m["per_object"].values())
    project = Path(params["workspace"]) / imported["id"]
    assert (project / "metrics" / f"{sm.VERSION}.json").is_file()
    assert Service().call("scenario_metrics", args)["generated_at"] == m["generated_at"]
    (project / "metrics" / f"{sm.VERSION}.json").unlink()
    (project / "import" / "normalized.xosc").write_bytes(b"<x/>")
    with pytest.raises(ScenarioError, match="mismatch"):
        Service().call("scenario_metrics", args)
    with pytest.raises(ScenarioError):
        Service().call("scenario_metrics", {**args, "scenario_id": "../x"})


@pytest.mark.skipif(not ENGINE.is_file(), reason="esmini engine not built")
def test_scenario_deleted_while_measuring_is_not_found_and_not_recreated(service, monkeypatch):  # noqa: F811
    import base64

    from topeye.scenario.library import delete_imported
    from topeye.scenario.models import ScenarioError

    api, params = service
    source = api.call("source_scene", params)
    context = api.call("map_context", {**params, "source_id": source["id"]})
    imported = api.call(
        "import_xosc",
        {
            **params,
            "source_id": source["id"],
            "xml_base64": base64.b64encode(fixture_xml(context)).decode(),
        },
    )
    real = sm.scene_metrics

    def delete_midway(*args, **kwargs):
        result = real(*args, **kwargs)
        delete_imported(params["workspace"], imported["id"])
        return result

    monkeypatch.setattr(sm, "scene_metrics", delete_midway)
    with pytest.raises(ScenarioError) as error:
        Service().call(
            "scenario_metrics", {**params, "scenario_id": imported["id"], "engine": str(ENGINE)}
        )
    assert error.value.code == "NOT_FOUND"
    assert not (Path(params["workspace"]) / imported["id"]).exists()


@pytest.mark.skipif(not ENGINE.is_file(), reason="esmini engine not built")
def test_scenario_deleted_before_package_load_is_not_found(service, monkeypatch):  # noqa: F811
    """The package can move to trash after scenario.json is read but before load_imported checks its directory."""
    import base64

    from topeye.scenario import imported_replay
    from topeye.scenario.library import delete_imported
    from topeye.scenario.models import ScenarioError

    api, params = service
    source = api.call("source_scene", params)
    context = api.call("map_context", {**params, "source_id": source["id"]})
    imported = api.call("import_xosc", {
        **params, "source_id": source["id"], "xml_base64": base64.b64encode(fixture_xml(context)).decode(),
    })

    def delete_before_load(*_args):
        delete_imported(params["workspace"], imported["id"])
        raise ScenarioError("IO_ERROR", "Import package missing")

    monkeypatch.setattr(imported_replay, "load_imported", delete_before_load)
    with pytest.raises(ScenarioError) as error:
        Service().call("scenario_metrics", {**params, "scenario_id": imported["id"], "engine": str(ENGINE)})
    assert error.value.code == "NOT_FOUND"
