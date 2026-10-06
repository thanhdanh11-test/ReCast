"""Precompute read-only viewer caches."""

import argparse
import logging
from pathlib import Path

from topeye.config import load_config
from topeye.core.adapters.base import DatasetError
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.cache import prepare_scene


def main(argv=None):
    parser = argparse.ArgumentParser()
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--scene")
    selection.add_argument("--all", action="store_true")
    parser.add_argument("--no-bev", action="store_true")
    parser.add_argument("--no-atlas", action="store_true")
    parser.add_argument("--no-dense", action="store_true")
    parser.add_argument("--no-pano", action="store_true")
    parser.add_argument("--window", type=int, default=5)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--cache-root", type=Path)
    parser.add_argument("--config", default="config.toml")
    args = parser.parse_args(argv)
    try:
        if args.workers < 1 or args.window < 0:
            raise ValueError("workers must be positive and window nonnegative")
        config = load_config(args.config)
        adapter = NuScenesAdapter(config.nusc_root)
        scenes = adapter.scenes() if args.all else [args.scene]
        if any(scene not in adapter.scenes() for scene in scenes):
            raise ValueError("Unknown scene")
        failed = False
        for scene in scenes:
            meta = prepare_scene(
                adapter,
                scene,
                args.cache_root or config.cache_root,
                config,
                args.workers,
                window=args.window,
                no_bev=args.no_bev,
                no_atlas=args.no_atlas,
                no_dense=args.no_dense,
                no_pano=args.no_pano,
            )
            failed |= bool(meta["failures"])
        return int(failed)
    except (OSError, ValueError, DatasetError) as exc:
        logging.getLogger(__name__).error("Prepare configuration/dataset error: %s", exc)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
