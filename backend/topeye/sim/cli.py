"""topeye-sim-layout / topeye-sim-render entry points (01-CONTRACTS §11 exit codes)."""

import argparse
import logging
import os
import re
import shutil
import subprocess
import tomllib
from pathlib import Path

from topeye.config import load_config
from topeye.core.adapters.base import DatasetError
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.sim.labels import write_labels
from topeye.sim.layout import MIN_EGO_ON_DRIVABLE, build_layout

BUILD_SCENE = Path(__file__).parent / "blender" / "build_scene.py"
DEFAULT_BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
SCENARIO_KEYS = {
    "": {"name", "seed", "engine", "samples", "frames", "cameras", "resolution_scale",
         "weather", "traffic"},
    "weather": {"preset", "fog_density", "wetness", "paint_fade", "rain_drop_rate"},
    "traffic": {"mode", "color_randomization"},
}
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
    for section, allowed in SCENARIO_KEYS.items():
        table = data if not section else data.get(section, {})
        if not isinstance(table, dict):
            raise InputError(f"Scenario [{section}] must be a table")
        unknown = set(table) - allowed
        if unknown:
            raise InputError(f"Unknown scenario keys in [{section or 'root'}]: {sorted(unknown)}")
    if not re.fullmatch(r"[a-z0-9_-]+", str(data.get("name", ""))):
        raise InputError("Scenario name must match [a-z0-9_-]+")
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
