"""Export P05 cache atlas/debug grids and summarize measured preparation timings."""

import argparse
import json
import re
import shutil
from pathlib import Path

import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=Path("data/cache"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    measurements = []
    for index in (0, 10):
        frame = f"scene-0061_{index:06d}"
        root = args.cache / "scene-0061" / "frames" / frame
        atlas = cv2.imread(str(root / "box_atlas.png"), cv2.IMREAD_UNCHANGED)
        meta = json.loads((root / "box_atlas.json").read_text())
        boxes = sorted(json.loads((root / "gt.json").read_text()),
                       key=lambda box: box["cx"] ** 2 + box["cy"] ** 2 + box["cz"] ** 2)[:12]
        canvas = np.full((6 * 250, 4 * 260, 3), 24, np.uint8)
        for i, box in enumerate(boxes):
            identity = f'gt:{box["annotation_token"]}'
            for side, name in enumerate(("front", "left")):
                col, row = (i % 2) * 2 + side, i // 2
                x, y = col * 260, row * 250
                record = meta["boxes"].get(identity, {}).get("faces", {}).get(name)
                caption = "omitted" if record is None else str(record["cam"] or "mean / unseen")
                if record:
                    a, b, c, d = record["uv"]
                    tile = atlas[b:d, a:c, :3]
                    scale = min(240 / tile.shape[1], 180 / tile.shape[0])
                    tile = cv2.resize(tile, (round(tile.shape[1] * scale),
                                             round(tile.shape[0] * scale)))
                    canvas[y + 60:y + 60 + tile.shape[0], x + 10:x + 10 + tile.shape[1]] = tile
                cv2.putText(canvas, f'{i + 1} {name} {identity[3:11]}', (x + 8, y + 20),
                            cv2.FONT_HERSHEY_SIMPLEX, .43, (230, 230, 230), 1)
                cv2.putText(canvas, caption, (x + 8, y + 43),
                            cv2.FONT_HERSHEY_SIMPLEX, .43, (140, 220, 140), 1)
        assert cv2.imwrite(str(args.out / f"debug-{frame}.png"), canvas)
        shutil.copyfile(root / "box_atlas.png", args.out / f"atlas-{frame}.png")
        shutil.copyfile(root / "box_atlas.json", args.out / f"atlas-{frame}.json")
        measurements.append({"frame": frame, "atlas_boxes": len(meta["boxes"]),
                             "ground_z": meta["ground_z"], "debug_boxes": len(boxes),
                             "atlas_shape": list(atlas.shape)})
    log = (args.out / "prepare-all.txt").read_text()
    times = [(name, float(value)) for name, value in re.findall(
        r"atlas=(\S+) seconds=([\d.]+)", log)]
    metas = [json.loads(path.read_text()) for path in args.cache.glob("*/meta.json")]
    summary = {"scenes": len(metas), "frames": sum(len(meta["frames"]) for meta in metas),
               "failures": sum(len(meta["failures"]) for meta in metas),
               "cache_versions": sorted({meta["cache_version"] for meta in metas}),
               "atlas_frames_measured": len(times), "atlas_seconds_max": max(t for _, t in times),
               "atlas_seconds_mean": float(np.mean([t for _, t in times])),
               "total_seconds": float(re.search(r"total_seconds=([\d.]+)", log)[1]),
               "frames_exported": measurements}
    assert summary["atlas_frames_measured"] == summary["frames"]
    assert summary["failures"] == 0 and summary["atlas_seconds_max"] <= 5
    (args.out / "timing.txt").write_text(json.dumps(summary, indent=2) + "\n" +
                                        "\n".join(f"{f} {t:.6f}" for f, t in times) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
