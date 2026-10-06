"""Machine-generated coverage, source diagnostics, PNG copies and timings."""

import argparse
import json
import shutil
from pathlib import Path

import cv2
import numpy as np

from topeye.config import load_config
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.bev import BEVScene, source_window, transform
from topeye.core.ground import ground_support, height_grid

parser = argparse.ArgumentParser()
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--cache-root", type=Path, default=Path("data/cache"))
args = parser.parse_args()
adapter = NuScenesAdapter(load_config().nusc_root)
v, u = np.indices((1200, 1200))
circle = (u + 0.5 - 600) ** 2 + (600 - v - 0.5) ** 2 <= 300**2
circle20 = (u + 0.5 - 600) ** 2 + (600 - v - 0.5) ** 2 <= 200**2
args.out.mkdir(parents=True, exist_ok=True)
lines = []
for scene, indices in [("scene-0061", [0, 10, 20, 30, 38]), ("scene-0103", [0, 20, 38])]:
    context = BEVScene(adapter, scene)
    print(scene, "gains", context.gains, flush=True)
    for index in indices:
        index = min(index, len(context.frames) - 1)
        frame = context.frames[index]
        source = args.cache_root / scene / "frames" / frame.frame_id / "bev.png"
        shutil.copyfile(source, args.out / f"{frame.frame_id}.png")
        image = cv2.imread(str(source), -1)
        world = np.concatenate(
            [context.ground[f.index] for f in source_window(context.frames, index, 5)]
        )
        local = transform(world, np.linalg.inv(frame.T_world_lidar))
        grid = height_grid(local, np.ones(len(local), bool))
        valid = np.repeat(np.repeat(np.isfinite(grid[::-1]), 5, 0), 5, 1)
        record = {
            "frame": frame.frame_id,
            "coverage_pct": float((image[:, :, 3][circle] > 0).mean() * 100),
            "height_available_pct": float(valid[circle].mean() * 100),
            "shape": list(image.shape),
        }
        diagnostics = {}
        rebuilt = context.build(index, diagnostics=diagnostics)
        assert np.array_equal(cv2.cvtColor(rebuilt, cv2.COLOR_RGBA2BGRA), image)
        record.update(diagnostics)
        support = ground_support(local)
        colored = image[:, :, 3] > 0
        eligible = support & circle
        eligible20 = support & circle20
        record.update(
            coverage_on_ground_20m_pct=float(
                (colored & eligible20).sum() / eligible20.sum() * 100
            ),
            ground_20m_pixels=int(eligible20.sum()),
            ground_20m_colored_pixels=int((colored & eligible20).sum()),
        )
        painted = colored & circle
        record.update(
            coverage_on_ground_pct=float((colored & eligible).sum() / eligible.sum() * 100),
            streak_pct=float((colored & ~support).sum() / max(1, colored.sum()) * 100),
            ground_pixels=int(eligible.sum()),
            ground_colored_pixels=int((colored & eligible).sum()),
            streak_pixels=int((colored & ~support).sum()),
            streak_denominator_pixels=int(colored.sum()),
            colored_pixels=int(painted.sum()),
            total_pixels=int(circle.sum()),
        )
        before = cv2.imread(str(args.out.parent / "wp4" / f"{frame.frame_id}.png"), -1)
        middle = cv2.imread(str(args.out.parent / "wp4b" / f"{frame.frame_id}.png"), -1)
        assert before is not None and middle is not None
        assert cv2.imwrite(str(args.out / f"compare3-{frame.frame_id}.png"),
                           np.concatenate((before, middle, image), axis=1))
        lines.append(json.dumps(record))
        print(lines[-1], flush=True)
(args.out / "coverage.txt").write_text("\n".join(lines) + "\n")
