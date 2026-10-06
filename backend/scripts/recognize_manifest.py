"""Generate manifest JSON for recognition evaluation gate (SPEC-S6 §6)."""

import argparse
import json
import sys
from pathlib import Path

from topeye.config import load_config
from topeye.core.adapters.nuscenes import NuScenesAdapter

ROOT = Path(__file__).resolve().parents[1]
ORDER = [
    "CAM_FRONT",
    "CAM_FRONT_LEFT",
    "CAM_FRONT_RIGHT",
    "CAM_BACK",
    "CAM_BACK_LEFT",
    "CAM_BACK_RIGHT",
]


def generate_manifest(scene: str, run: str, frames: list[int] | None = None) -> list[dict]:
    """Build recognition manifest mapping real images, rendered images, labels and classes."""
    run_dir = ROOT / "data" / "sim" / scene / "runs" / run
    if not run_dir.is_dir():
        raise FileNotFoundError(f"Run directory not found: {run_dir}")

    classes_path = run_dir / "labels" / "classes.txt"
    if not classes_path.is_file():
        raise FileNotFoundError(f"Classes file not found: {classes_path}")

    # Determine frame indices
    if frames is None or len(frames) == 0:
        frame_set = set()
        for cam in ORDER:
            cam_dir = run_dir / "images" / cam
            if cam_dir.is_dir():
                for p in cam_dir.glob("*.png"):
                    try:
                        frame_set.add(int(p.stem))
                    except ValueError:
                        pass
        frame_indices = sorted(frame_set) if frame_set else [0]
    else:
        frame_indices = sorted(frames)

    cfg = load_config(ROOT / "config.toml")
    adapter = NuScenesAdapter(cfg.nusc_root)
    scene_frames = adapter.frames(scene)

    manifest = []
    for idx in frame_indices:
        if idx >= len(scene_frames):
            continue
        scene_frame = scene_frames[idx]
        for cam in ORDER:
            if cam not in scene_frame.cameras:
                continue
            real_img = scene_frame.cameras[cam][0]
            render_img = run_dir / "images" / cam / f"{idx:06d}.png"
            labels_path = run_dir / "labels" / "yolo" / cam / f"{idx:06d}.txt"

            if not real_img.is_file() or not render_img.is_file():
                continue

            item = {
                "scene": scene,
                "run": run,
                "camera": cam,
                "frame": idx,
                "real": str(real_img.resolve()),
                "render": str(render_img.resolve()),
                "labels": str(labels_path.resolve()),
                "classes": str(classes_path.resolve()),
            }
            manifest.append(item)

    return manifest


def main():
    parser = argparse.ArgumentParser(description="Generate recognition manifest JSON.")
    parser.add_argument("--scene", required=True, help="Scene name (e.g. scene-0061)")
    parser.add_argument("--run", required=True, help="Run name (e.g. day, night_traffic)")
    parser.add_argument(
        "--frames", type=int, nargs="*", default=None, help="Frame indices to evaluate"
    )
    parser.add_argument("--out", type=Path, default=None, help="Output JSON path")

    args = parser.parse_args()
    manifest = generate_manifest(args.scene, args.run, args.frames)

    payload = json.dumps(manifest, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload + "\n")
        print(f"Wrote {len(manifest)} items to {args.out}", file=sys.stderr)
    else:
        print(payload)


if __name__ == "__main__":
    main()
