"""topeye-sim-layout / topeye-sim-render entry points (01-CONTRACTS §11 exit codes)."""

import argparse
import json
import logging
import math
import os
import re
import shutil
import subprocess
import tomllib
from pathlib import Path

from topeye.config import load_config
from topeye.core.adapters.base import DatasetError
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.cache import write_json
from topeye.sim.labels import write_labels
from topeye.sim.layout import MIN_EGO_ON_DRIVABLE, build_layout
from topeye.sim.traffic import TRAFFIC_DEFAULTS, generate_traffic, validate_params

BUILD_SCENE = Path(__file__).parent / "blender" / "build_scene.py"
DEFAULT_BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
SCENARIO_KEYS = {
    "": {"name", "seed", "engine", "samples", "frames", "cameras", "resolution_scale",
         "weather", "traffic"},
    "weather": {"preset", "fog_density", "wetness", "paint_fade", "rain_drop_rate"},
    "traffic": set(TRAFFIC_DEFAULTS) | {"color_randomization"},
}
WEATHER_RANGES_V2 = {"cloudiness": (0, 100), "precipitation": (0, 100),
    "precipitation_deposits": (0, 100), "wind_intensity": (0, 100),
    "sun_azimuth_angle": (0, 360), "sun_altitude_angle": (-90, 90),
    "fog_density": (0, 100), "fog_distance": (0, math.inf),
    "wetness": (0, 100), "paint_fade": (0, 1)}
LIDAR_RANGES = {"atmosphere_attenuation_rate": (0, math.inf),
    "dropoff_general_rate": (0, 1), "dropoff_intensity_limit": (0, 1),
    "dropoff_zero_intensity": (0, 1), "noise_stddev": (0, math.inf)}

BLENDER_TIMEOUT_S = 7200
logger = logging.getLogger(__name__)


class InputError(ValueError):
    """Caller input violates the contract (exit 2)."""


def sim_root(config_path):
    return Path(config_path).expanduser().resolve().parent / "data" / "sim"


def scene_dir(root, scene):
    path = (root / scene).resolve()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", scene) or not path.is_relative_to(root.resolve()):
        raise InputError(f"Invalid scene name: {scene}")
    return path


def check_scenario(path):
    """Structural check before Blender starts; Blender re-validates value ranges."""
    try:
        data = tomllib.loads(Path(path).read_text())
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise InputError(f"Cannot read scenario {path}: {exc}") from exc
    schema = data.get("schema", 1)
    if type(schema) is not int or schema not in (1, 2):
        raise InputError("schema must be 1 or 2")
    sections = {key: set(value) for key, value in SCENARIO_KEYS.items()}
    sections[""].add("schema")
    if schema == 2:
        sections[""].add("lidar")
        sections["weather"] = set(WEATHER_RANGES_V2) | {"preset"}
        sections["lidar"] = set(LIDAR_RANGES)
    for section, allowed in sections.items():
        table = data if not section else data.get(section, {})
        if not isinstance(table, dict):
            raise InputError(f"Scenario [{section}] must be a table")
        unknown = set(table) - allowed
        if unknown:
            raise InputError(f"Unknown scenario keys in [{section or 'root'}]: {sorted(unknown)}")
    if (not isinstance(data.get("name"), str)
            or not re.fullmatch(r"[a-z0-9_-]+", data["name"])):
        raise InputError("Scenario name must match [a-z0-9_-]+")
    if schema == 2:
        for key in ("seed", "samples"):
            if key in data and type(data[key]) is not int:
                raise InputError(f"{key} must be int")
        if not 1 <= data.get("samples", 16) <= 4096:
            raise InputError("samples must be in [1, 4096]")
        if data.get("engine", "eevee") not in ("eevee", "cycles"):
            raise InputError("engine must be eevee or cycles")
        scale = data.get("resolution_scale", 1)
        if (isinstance(scale, bool) or not isinstance(scale, (int, float))
                or not math.isfinite(scale) or not 0 < scale <= 1):
            raise InputError("resolution_scale must be finite in (0, 1]")
        for key, kind in (("frames", int), ("cameras", str)):
            items = data.get(key, [])
            if not isinstance(items, list) or any(type(item) is not kind for item in items):
                raise InputError(f"{key} must be a list of {kind.__name__}")
        weather = data.get("weather", {})
        if weather.get("preset", "day") not in ("day", "night", "rain", "fog", "dusk"):
            raise InputError("Unknown weather preset")
        for section, ranges in (("weather", WEATHER_RANGES_V2), ("lidar", LIDAR_RANGES)):
            for key, value in data.get(section, {}).items():
                if key == "preset":
                    continue
                low, high = ranges[key]
                if (isinstance(value, bool) or not isinstance(value, (int, float))
                        or not math.isfinite(value) or not low <= value <= high):
                    raise InputError(f"{section}.{key} must be finite in [{low}, {high}]")
    traffic = dict(data.get("traffic", {}))
    color = traffic.pop("color_randomization", True)
    if type(color) is not bool:
        raise InputError("traffic.color_randomization must be bool")
    try:
        validate_params(traffic)
    except ValueError as exc:
        raise InputError(str(exc)) from exc
    return data


def blender_bin(config_path):
    return os.environ.get("TOPEYE_BLENDER") or load_config(config_path).blender_bin or DEFAULT_BLENDER


def run_blender(binary, *args):
    if not Path(binary).is_file():
        raise FileNotFoundError(binary)
    command = [binary, "-b", "--factory-startup", "-P", str(BUILD_SCENE), "--", *map(str, args)]
    code = subprocess.run(command, timeout=BLENDER_TIMEOUT_S, check=False).returncode
    return code if code in (0, 1, 2) else 3  # signals/crashes: Blender unavailable


def layout_main(argv=None):
    parser = argparse.ArgumentParser(description="Export a real scene layout for Blender")
    parser.add_argument("--scene", required=True)
    parser.add_argument("--frames", type=int, nargs="*")
    parser.add_argument("--config", default="config.toml")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        config = load_config(args.config)
        adapter = NuScenesAdapter(config.nusc_root)
        if args.scene not in adapter.scenes():
            raise InputError(f"Unknown scene: {args.scene}")
        out = scene_dir(sim_root(args.config), args.scene)
        layout = build_layout(adapter, args.scene, out, args.frames)
    except (InputError, ValueError) as exc:
        logger.error("%s", exc)
        return 2
    except DatasetError as exc:
        logger.error("%s", exc)
        return 2
    checks = layout["checks"]
    logger.info("layout %s: %d frames, %d actors, checks %s", args.scene,
                 len(layout["frames"]), len(layout["actors"]), checks)
    if checks["ego_on_drivable"] < MIN_EGO_ON_DRIVABLE or checks["skipped_sweeps"]:
        logger.error("Layout checks failed: %s", checks)
        return 1
    return 0


def render_main(argv=None):
    parser = argparse.ArgumentParser(description="Render a scenario in Blender and write labels")
    parser.add_argument("--scene", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--scenario", type=Path)
    mode.add_argument("--selftest", action="store_true")
    parser.add_argument("--save-blend", type=Path)
    parser.add_argument("--config", default="config.toml")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        root = sim_root(args.config)
        directory = scene_dir(root, args.scene)
        layout = directory / "layout.json"
        if not layout.is_file():
            raise InputError(f"Missing {layout}; run topeye-sim-layout first")
        scenario = None if args.selftest else check_scenario(args.scenario)
        binary = blender_bin(args.config)
        code = run_blender(binary, "--layout", layout, "--out", directory / "selftest",
                           "--selftest")
        if code != 0 or scenario is None:
            return code
        run_dir = directory / "runs" / scenario["name"]
        if run_dir.exists():
            shutil.rmtree(run_dir)
        extra = ["--save-blend", args.save_blend.resolve()] if args.save_blend else []
        traffic = {key: value for key, value in scenario.get("traffic", {}).items()
                   if key != "color_randomization"}
        if traffic.get("mode", "replay") == "generated":
            actors = generate_traffic(json.loads(layout.read_text()), traffic, scene_dir=directory)
            actor_path = run_dir / "actors.json"
            write_json(actor_path, actors)
            extra += ["--actors", actor_path]
        code = run_blender(binary, "--layout", layout, "--scenario", args.scenario.resolve(),
                           "--out", run_dir, *extra)
        if code not in (0, 1):
            return code
        summary = write_labels(directory, run_dir)
        logger.info("labels: %s", summary)
        return max(code, 1 if summary["missing_visibility"] else 0)
    except ValueError as exc:
        logger.error("%s", exc)
        return 2
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        logger.error("Blender unavailable: %s", exc)
        return 3


def build_main(argv=None):
    """Build static layout, camera supervision and splats within a wall-clock budget."""
    from time import monotonic
    from uuid import uuid4

    from topeye.sim.gs_data import export_gs_dataset

    parser = argparse.ArgumentParser(description="Build a local scene within 15 minutes")
    parser.add_argument("--scene", required=True)
    parser.add_argument("--budget-s", type=float, default=900)
    parser.add_argument("--splat-budget-s", type=float, default=600)
    parser.add_argument("--hz", type=float, default=12)
    parser.add_argument("--config", default="config.toml")
    args = parser.parse_args(argv)
    started = monotonic()
    steps = {"layout_s": 0.0, "gs_data_s": 0.0, "splat_s": 0.0}
    report = {"steps": steps, "psnr_test_masked": None, "gaussians": 0,
              "iters_done": 0, "budget_ok": False}
    directory = None
    active = "preflight"
    code = 1
    try:
        for name in ("budget_s", "splat_budget_s", "hz"):
            value = getattr(args, name)
            if not math.isfinite(value) or value <= 0:
                raise InputError(f"{name} must be finite and positive")
        if args.splat_budget_s >= args.budget_s:
            raise InputError("splat-budget-s must be less than budget-s")
        directory = scene_dir(sim_root(args.config), args.scene)
        try:
            config = load_config(args.config)
        except OSError as exc:
            raise InputError(f"Cannot read config: {exc}") from exc
        backend = Path(__file__).resolve().parents[2]
        python = backend / ".tools/mpsplat/.venv/bin/python"
        if not python.is_file() or not Path(blender_bin(args.config)).is_file():
            code = 3
            raise RuntimeError("Missing Blender or mpsplat Python")
        adapter = NuScenesAdapter(config.nusc_root)
        if args.scene not in adapter.scenes():
            raise InputError(f"Unknown scene: {args.scene}")
        for active, action in (
            ("layout_s", lambda: build_layout(adapter, args.scene, directory)),
            ("gs_data_s", lambda: export_gs_dataset(
                adapter, args.scene, directory / f"gs{args.hz:g}", max_hz=args.hz)),
        ):
            step_started = monotonic()
            try:
                result = action()
            finally:
                steps[active] = monotonic() - step_started
            if active == "layout_s" and (
                result["checks"]["ego_on_drivable"] < MIN_EGO_ON_DRIVABLE
                or result["checks"]["skipped_sweeps"]
            ):
                raise RuntimeError("Layout checks failed")
            if monotonic() - started >= args.budget_s:
                raise RuntimeError(f"Budget exceeded during {active}")
        active = "splat_s"
        step_started = monotonic()
        output = directory / "build_runs" / uuid4().hex
        remaining = args.budget_s - (monotonic() - started)
        command = [str(python), str(backend / "splat/train_bg.py"),
                   "--data", str(directory / f"gs{args.hz:g}"), "--out", str(output),
                   "--iters", "1000000", "--time-budget-s",
                   str(min(args.splat_budget_s, remaining)), "--sky-model"]
        if (directory / "gs/cameras.json").is_file():
            command += ["--eval-data", str(directory / "gs")]
        try:
            completed = subprocess.run(command, timeout=remaining, check=False)
        finally:
            steps[active] = monotonic() - step_started
        if completed.returncode:
            raise RuntimeError(f"Trainer exited {completed.returncode}")
        metrics = json.loads((output / "metrics.json").read_text())
        report.update(psnr_test_masked=metrics["psnr_test_masked"],
                      gaussians=metrics["gaussians"], iters_done=metrics["iters"])
        if monotonic() - started >= args.budget_s:
            raise RuntimeError("Budget exceeded during splat_s")
        # Only publish a successful complete run, preserving the previous scene on failure.
        temporary = directory / "trained_splat.ply.tmp"
        shutil.copyfile(output / "point_cloud.ply", temporary)
        temporary.replace(directory / "trained_splat.ply")
        layout = json.loads((directory / "layout.json").read_text())
        layout.setdefault("photo", {})["trained_splat"] = "trained_splat.ply"
        write_json(directory / "layout.json", layout)
        code = 0
    except (ValueError, DatasetError) as exc:
        report["error"] = str(exc)
        code = 2 if active == "preflight" else 1
        report["failed_step"] = active
        logger.error("Build failed: %s", exc)
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
        report["error"] = str(exc)
        report["failed_step"] = active
        logger.error("Build failed: %s", exc)
    finally:
        steps["total_s"] = monotonic() - started
        report["budget_ok"] = code == 0 and steps["total_s"] <= args.budget_s
        if code == 0 and not report["budget_ok"]:
            code = 1
            report["failed_step"] = active
        if directory is not None:
            write_json(directory / "build.json", report)
    return code
