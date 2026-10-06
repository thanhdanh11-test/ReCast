"""CARLA-style boundary compatibility, stochastic returns and vehicle dynamics."""
import ast
import json
import math
import threading
import tomllib
from types import SimpleNamespace
from urllib.request import Request, urlopen

import cv2
import numpy as np
import pytest

from topeye.sim import cli, traffic, view


@pytest.fixture(scope="module")
def blender():
    tree = ast.parse(cli.BUILD_SCENE.read_text())
    tree.body = [n for n in tree.body if not (
        isinstance(n, ast.Import) and any(a.name == "bpy" for a in n.names)
        or isinstance(n, ast.ImportFrom) and n.module.startswith(("bpy", "mathutils"))
        or isinstance(n, ast.If))]
    namespace = {"__name__": "contract_test"}
    exec(compile(tree, str(cli.BUILD_SCENE), "exec"), namespace)  # noqa: S102 - trusted repo AST
    return SimpleNamespace(**namespace)


def scenario(tmp_path, data):
    path = tmp_path / "scenario.toml"
    path.write_text(view.scenario_toml({"name": "test", **data}))
    return path


def layout():
    return {"frames": [{"index": 0, "cameras": {"CAM_FRONT": {}}}]}


@pytest.mark.parametrize("preset", ["day", "night", "rain", "fog"])
def test_schema_one_unchanged(blender, preset):
    path = cli.BUILD_SCENE.parent / "scenarios" / f"{preset}.toml"
    raw = cli.check_scenario(path)
    loaded = blender.load_scenario(path, layout())
    assert "schema" not in loaded and "lidar" not in loaded
    for key in ("wetness", "fog_density"):
        assert loaded["weather"][key] == raw["weather"].get(key, blender.PRESETS[preset][key])


@pytest.mark.parametrize("preset", ["day", "night", "rain", "fog", "dusk", "night_traffic"])
def test_shipped_v2(blender, preset):
    path = cli.BUILD_SCENE.parent / "scenarios" / f"{preset}_v2.toml"
    raw = cli.check_scenario(path)
    loaded = blender.load_scenario(path, layout())
    assert raw["schema"] == loaded["schema"] == 2
    assert set(raw["weather"]) == set(cli.WEATHER_RANGES_V2) | {"preset"}
    assert loaded["lidar"] == blender.LIDAR_DEFAULTS
    assert loaded["weather"]["fog_density"] == pytest.approx(raw["weather"]["fog_density"]*.001)


@pytest.mark.parametrize("section,key,bounds", [
    (section, key, bounds) for section, ranges in (("weather", cli.WEATHER_RANGES_V2),
    ("lidar", cli.LIDAR_RANGES)) for key, bounds in ranges.items()])
def test_ranges_at_both_boundaries(blender, tmp_path, section, key, bounds):
    low, high = bounds
    values = [low-1, True, float("nan"), float("inf")]
    if math.isfinite(high):
        values.append(high+1)
    for value in values:
        path = tmp_path / "bad.toml"
        path.write_text(f'name="test"\nschema=2\n[{section}]\n{key}={str(value).lower()}\n')
        with pytest.raises(cli.InputError):
            cli.check_scenario(path)
        with pytest.raises(blender.InputError):
            blender.load_scenario(path, layout())
    for value in (low, high if math.isfinite(high) else 200):
        path = scenario(tmp_path, {"schema": 2, section: {key: value}})
        cli.check_scenario(path)
        blender.load_scenario(path, layout())


@pytest.mark.parametrize("data", [{"schema": 0}, {"schema": 3}, {"schema": True}, {"schema": 2.0},
    {"schema": 2, "weather": {"rain_drop_rate": .1}}, {"schema": 2, "weather": {"preset": "snow"}},
    {"schema": 2, "lidar": {"extra": 0}}, {"schema": 1, "lidar": {"noise_stddev": 0}},
    {"schema": 2, "weather": 3}, {"schema": 2, "lidar": []},
    {"schema": 2, "name": 123}, {"schema": 2, "seed": True},
    {"schema": 2, "samples": 0}, {"schema": 2, "samples": 4.5},
    {"schema": 2, "engine": "invalid"}, {"schema": 2, "resolution_scale": 0},
    {"schema": 2, "resolution_scale": True}, {"schema": 2, "frames": [True]},
    {"schema": 2, "cameras": [1]}])
def test_invalid_structure(blender, tmp_path, data):
    path = scenario(tmp_path, data)
    with pytest.raises(cli.InputError):
        cli.check_scenario(path)
    with pytest.raises(blender.InputError):
        blender.load_scenario(path, layout())


def test_overrides(blender, tmp_path):
    path = scenario(tmp_path, {"schema": 2, "weather": {"preset": "day", "sun_altitude_angle": -1,
        "fog_density": 37, "wetness": 10, "precipitation": 70}, "lidar": {"dropoff_general_rate": .45}})
    loaded = blender.load_scenario(path, layout())
    assert blender.is_night(loaded)
    assert loaded["weather"]["fog_density"] == pytest.approx(.037)
    assert loaded["weather"]["wetness"] == .7
    assert loaded["weather"]["rain_drop_rate"] == .105
    assert loaded["lidar"]["dropoff_general_rate"] == .45
    loaded["weather"].update(preset="night", sun_altitude_angle=1)
    assert not blender.is_night(loaded)


@pytest.mark.parametrize("reflectivity,drop", [(0.3, .45), (0, .4), (1, 0)])
def test_dropoff_binomial_three_sigma(blender, reflectivity, drop):
    rng = np.random.default_rng(481)
    lidar = {**blender.LIDAR_DEFAULTS, "dropoff_general_rate": .45, "atmosphere_attenuation_rate": 0}
    weather = blender.normalize_weather({"preset": "day"})
    count = 30000
    dropped = sum(blender.lidar_return(reflectivity, 20, lidar, weather, rng) is None for _ in range(count))
    assert abs(dropped-count*drop) <= 3*np.sqrt(count*drop*(1-drop))


def test_intensity_noise_and_weather(blender):
    lidar = {**blender.LIDAR_DEFAULTS, "dropoff_general_rate": 0}
    weather = blender.normalize_weather({"wetness": 80})
    distance, intensity = blender.lidar_return(.3, 20, lidar, weather, np.random.default_rng(0), ground=True)
    assert distance == 20 and intensity == pytest.approx(255*.3*np.exp(-.004*20)*.6)
    assert blender.lidar_return(.3, 20, lidar, weather, np.random.default_rng(0))[1] == pytest.approx(255*.3*np.exp(-.004*20))
    lidar["noise_stddev"] = .2
    rng = np.random.default_rng(0)
    distances = [blender.lidar_return(.3, 20, lidar, weather, rng)[0] for _ in range(10000)]
    assert abs(np.mean(distances)-20) < .01 and .19 < np.std(distances) < .21
    weather = blender.normalize_weather({"precipitation": 100, "fog_density": 5})
    lidar["dropoff_general_rate"] = .2
    count, probability = 30000, .8*.85*np.exp(-2*.005*20)*.2
    rng = np.random.default_rng(91)
    kept = sum(blender.lidar_return(.3, 20, lidar, weather, rng, puddle=True) is not None for _ in range(count))
    assert abs(kept-count*probability) <= 3*np.sqrt(count*probability*(1-probability))


@pytest.mark.parametrize("coverage", [.1, .4, .8])
def test_puddle_area(blender, coverage):
    points = np.linspace(0, 2*np.pi, 1000)
    values = (np.sin(points)[:, None]*np.sin(points)[None, :]+1)/2
    assert np.mean(values < blender.puddle_threshold(coverage)) == pytest.approx(coverage, abs=.005)


@pytest.mark.parametrize("key", ["distance_to_leading", "speed_difference_percent", "random_lanechange_percent",
                                  "max_accel", "max_decel", "max_lateral_accel"])
def test_traffic_ranges(key):
    lo, hi = traffic.RANGES[key]
    for value in (lo-1, hi+1, True, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            traffic.validate_params({key: value})
    assert traffic.validate_params({key: lo})[key] == lo
    assert traffic.validate_params({key: hi})[key] == hi


def test_bicycle_bounds_and_exact_arc():
    point, yaw = traffic.bicycle_step([0, 0, 0], 0, 10, np.pi/2, .1, 2.4, 4)
    assert yaw == pytest.approx(.04)
    assert point[:2] == pytest.approx([25*np.sin(.04), 25*(1-np.cos(.04))])
    _, yaw = traffic.bicycle_step([0, 0, 0], 0, 1, np.pi/2, .1, 2.4, 8)
    assert yaw == pytest.approx(np.tan(np.radians(35))/2.4*.1)


def test_metrics_irregular_timestamps():
    times = [0, .4, 1.2, 1.9, 3.1]
    frames = [{"index": i, "timestamp_us": int(t*1e6)} for i, t in enumerate(times)]
    actor = {"track": "gen:0:0", "label": "car", "keys": [
        {"frame": i, "center": [t*t, 0, 0], "yaw": 0} for i, t in enumerate(times)]}
    metrics = traffic.motion_metrics({"frames": frames}, [actor])
    assert metrics["max_long_accel"] == pytest.approx(2)
    assert metrics["max_lat_accel"] == 0 and metrics["max_jerk"] < 1e-12
    actor["track"] = "real-moving"
    assert traffic.motion_metrics({"frames": frames}, [actor])["max_long_accel"] == pytest.approx(2)
    actor["track"] = "real-parked"
    for i, key in enumerate(actor["keys"]):
        key["center"] = [0.1 * (-1)**i, 0, 0]
    assert traffic.motion_metrics({"frames": frames}, [actor])["max_long_accel"] == 0


def test_generated_limits_and_speed_difference(tmp_path, monkeypatch):
    cv2.imwrite(str(tmp_path / "road.png"), np.full((200, 200), 255, np.uint8))
    original = traffic._road
    monkeypatch.setattr(traffic, "_road", lambda scene, scene_dir=None: original(scene, tmp_path))
    frames, keys = [], []
    for i in range(30):
        transform = np.eye(4)
        transform[:3, 3] = [-40+i, 40, 1]
        frames.append({"index": i, "timestamp_us": i*500000, "T_world_lidar": transform.tolist()})
        keys.append({"frame": i, "center": [-80+5*i, 0, 1], "yaw": 0})
    scene = {"scene": "fixture", "bounds": {"xmin": -100, "ymax": 100},
        "ground": {"drivable": "road.png", "tex_res_m": 1}, "frames": frames,
        "actors": [{"track": "real", "label": "car", "size": [4, 2, 1], "keys": keys}]}
    params = {"mode": "generated", "density": 3, "random_lanechange_percent": 100,
              "max_accel": 1, "max_decel": 2, "max_lateral_accel": 1, "seed": 7}
    actors = traffic.generate_traffic(scene, params)
    assert actors
    checks = traffic.check_traffic(scene, actors)
    assert checks["max_long_accel"] <= 1 and checks["max_lat_accel"] <= 1
    assert checks["overlaps"] == checks["ego_conflicts"] == 0
    slower = traffic.generate_traffic(scene, {**params, "speed_difference_percent": 80})
    def mean_speed(actors):
        return np.mean([np.linalg.norm(np.diff([k["center"][:2] for k in a["keys"]], axis=0), axis=1).mean()/.5
                        for a in actors if len(a["keys"]) > 1])
    assert mean_speed(slower) < mean_speed(actors)


def test_viewer_schema_two_http(tmp_path, monkeypatch):
    directory = tmp_path / "scene-0061"
    directory.mkdir()
    (directory / "layout.json").write_text('{"frames":[],"actors":[]}')
    monkeypatch.setattr(view, "render_job", lambda *args: None)
    server = view.make_server(tmp_path, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        data = {"schema": 2, "name": "web-test", "weather": {"sun_altitude_angle": -5,
                "precipitation_deposits": 80}, "traffic": {"max_accel": 2}}
        req = Request(f"http://127.0.0.1:{server.server_port}/api/render",
            data=json.dumps({"scene": "scene-0061", "scenario": data}).encode(),
            headers={"Content-Type": "application/json"})
        with urlopen(req) as response:
            assert response.status == 202
        assert tomllib.loads((directory / "scenarios/web-test.toml").read_text()) == data
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    html = view.VIEWER.read_text()
    assert "{schema:2, name," in html and 'id="hour"' not in html
    for key in cli.WEATHER_RANGES_V2:
        assert f'id="{key}"' in html
