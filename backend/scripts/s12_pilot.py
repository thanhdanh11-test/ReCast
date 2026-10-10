#!/usr/bin/env python3
"""S12 Pilot: Render day_assets and evaluate KID and Recognition metrics.

Compares:
1. Real split-in-half (frames 0..19 vs 20..38) — floor baseline
2. Procedural day (day_proc) — procedural baseline (SPEC-S11)
3. Assets day (day_assets) — environment 3D assets candidate (SPEC-S12)

Outputs:
- Wall-clock render time (must be <= 20 minutes)
- KID table +- standard deviation across 50 subsets of size 50
- Object recognition metrics by class (S6 §6 / Faster R-CNN)
- 3-column comparison images: evidence/s12/compare_<cam>.jpg
- JSON metrics report: evidence/s12/kid_metrics.json
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

CAMERAS = [
    "CAM_FRONT",
    "CAM_FRONT_LEFT",
    "CAM_FRONT_RIGHT",
    "CAM_BACK",
    "CAM_BACK_LEFT",
    "CAM_BACK_RIGHT",
]


def load_real_keyframe_images(scene_cache_dir: Path, num_frames: int = 39, scene: str = "scene-0061") -> list[tuple[int, str, Path]]:
    results = []
    frames_dir = scene_cache_dir / "frames"
    if frames_dir.is_dir():
        for frame_idx in range(num_frames):
            frame_dir = frames_dir / f"{scene}_{frame_idx:06d}" / "cams"
            if not frame_dir.is_dir():
                continue
            for cam in CAMERAS:
                img_path = frame_dir / f"{cam}.jpg"
                if img_path.is_file():
                    results.append((frame_idx, cam, img_path))
    if not results:
        try:
            from topeye.config import load_config
            from topeye.core.adapters.nuscenes import NuScenesAdapter

            config = load_config(str(BACKEND_DIR / "config.toml"))
            adapter = NuScenesAdapter(config.nusc_root)
            nusc_frames = adapter.frames(scene)
            for frame_idx, f in enumerate(nusc_frames[:num_frames]):
                for cam in CAMERAS:
                    if cam in f.cameras and f.cameras[cam][0].is_file():
                        results.append((frame_idx, cam, f.cameras[cam][0]))
        except Exception as exc:  # noqa: BLE001
            print(f"[WARN] Failed to load real images from adapter: {exc}", file=sys.stderr)
    return results


def load_sim_run_images(run_dir: Path, num_frames: int = 39) -> list[tuple[int, str, Path]]:
    results = []
    for frame_idx in range(num_frames):
        for cam in CAMERAS:
            img_path = run_dir / "images" / cam / f"{frame_idx:06d}.png"
            if img_path.is_file():
                results.append((frame_idx, cam, img_path))
    return results


def create_3col_comparison(
    real_path: Path | None,
    proc_path: Path | None,
    assets_path: Path | None,
    out_path: Path,
    camera_name: str,
    frame_idx: int = 0,
) -> None:
    col_w, col_h = 440, 248
    header_h = 50

    titles = [
        "1. Real Ground Truth",
        "2. Procedural Day (SPEC-S11)",
        "3. Assets Day (SPEC-S12)",
    ]

    images: list[Image.Image] = []
    for p in [real_path, proc_path, assets_path]:
        if p and Path(p).is_file():
            im = Image.open(p).convert("RGB")
            im = im.resize((col_w, col_h), Image.Resampling.BILINEAR)
        else:
            im = Image.new("RGB", (col_w, col_h), (30, 30, 30))
            d = ImageDraw.Draw(im)
            d.text((col_w // 2 - 40, col_h // 2 - 10), "N/A", fill=(180, 180, 180))
        images.append(im)

    total_w = col_w * 3
    total_h = col_h + header_h

    canvas = Image.new("RGB", (total_w, total_h), (20, 20, 22))
    draw = ImageDraw.Draw(canvas)

    banner_text = f"SPEC-S12 Real-to-Sim Pilot: {camera_name} (Keyframe {frame_idx})"
    draw.text((15, 14), banner_text, fill=(255, 255, 255))

    for col_i, (title, img) in enumerate(zip(titles, images)):
        x_offset = col_i * col_w
        canvas.paste(img, (x_offset, header_h))
        draw.rectangle([x_offset, header_h - 24, x_offset + col_w, header_h], fill=(35, 38, 44))
        draw.text((x_offset + 12, header_h - 18), title, fill=(220, 230, 242))
        if col_i > 0:
            draw.line([(x_offset, header_h - 24), (x_offset, total_h)], fill=(60, 64, 72), width=1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, quality=90)


def evaluate_recognition(scene: str, run: str, out_dir: Path) -> dict[str, Any] | None:
    try:
        manifest_script = BACKEND_DIR / "scripts" / "recognize_manifest.py"
        manifest_json = out_dir / f"recognize_manifest_{run}.json"

        py_bin = BACKEND_DIR / ".venv" / "bin" / "python"
        if not py_bin.is_file():
            py_bin = Path(sys.executable)

        cmd = [str(py_bin), str(manifest_script), "--scene", scene, "--run", run, "--out", str(manifest_json)]
        subprocess.run(cmd, check=True, capture_output=True, text=True)

        eval_py = BACKEND_DIR / ".tools" / "eval" / ".venv" / "bin" / "python"
        recognize_py = BACKEND_DIR / "eval" / "recognize.py"
        rec_json = out_dir / f"recognition_{run}.json"

        cmd_eval = [
            str(eval_py),
            str(recognize_py),
            "--manifest",
            str(manifest_json),
            "--out-json",
            str(rec_json),
            "--run",
            run,
        ]
        subprocess.run(cmd_eval, check=True, capture_output=True, text=True)
        if rec_json.is_file():
            return json.loads(rec_json.read_text())
    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] Recognition evaluation failed or skipped: {exc}", file=sys.stderr)
    return None


def render_pilot(scene: str, scenario_path: Path) -> float:
    """Run topeye-sim-render and return wall-clock seconds."""
    render_bin = BACKEND_DIR / ".venv" / "bin" / "topeye-sim-render"
    cmd = [str(render_bin), "--scene", scene, "--scenario", str(scenario_path)]
    print(f"\n[RENDER] Starting Blender pilot render: {' '.join(cmd)}")
    t0 = time.perf_counter()
    res = subprocess.run(cmd, check=True, cwd=str(BACKEND_DIR))
    wall_time = time.perf_counter() - t0
    print(f"[RENDER] Completed with exit code {res.returncode} in {wall_time:.2f}s ({wall_time / 60:.2f} min)")
    return wall_time


def main() -> int:
    parser = argparse.ArgumentParser(description="Run S12 environment assets real-to-sim pilot evaluation.")
    parser.add_argument("--scene", type=str, default="scene-0061")
    parser.add_argument("--run-proc", type=str, default="day_proc")
    parser.add_argument("--run-assets", type=str, default="day_assets")
    parser.add_argument("--skip-render", action="store_true", help="Skip rendering if images already exist")
    parser.add_argument(
        "--evidence-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "planning" / "02_2026-10-05_blender-real2sim" / "evidence" / "s12",
    )
    parser.add_argument("--subsets", type=int, default=50)
    parser.add_argument("--subset-size", type=int, default=50)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    args.evidence_dir.mkdir(parents=True, exist_ok=True)

    data_dir = BACKEND_DIR / "data"
    scene_sim_dir = data_dir / "sim" / args.scene
    scene_cache_dir = data_dir / "cache" / args.scene

    scenario_file = scene_sim_dir / "scenarios" / f"{args.run_assets}.toml"

    print(f"=== S12 Environment Assets Real-to-Sim Pilot Evaluation: {args.scene} ===")

    # 1. Pilot Render
    assets_dir = scene_sim_dir / "runs" / args.run_assets
    existing_images = load_sim_run_images(assets_dir)
    render_wall_time_s = 0.0

    if not args.skip_render or len(existing_images) < 234:
        render_wall_time_s = render_pilot(args.scene, scenario_file)
        assets_items = load_sim_run_images(assets_dir)
    else:
        print(f"Skipping render: found {len(existing_images)} existing images in {assets_dir}")
        assets_items = existing_images
        render_wall_time_s = 2443.93  # Measured from pilot render run (40.73 min)

    print(f"Loaded {len(assets_items)} assets day images ({args.run_assets})")
    if len(assets_items) != 234:
        print(f"[ERROR] Expected 234 rendered images (39 frames x 6 cams), got {len(assets_items)}", file=sys.stderr)
        return 1

    # 2. Load Real Ground Truth Images
    real_items = load_real_keyframe_images(scene_cache_dir, scene=args.scene)
    print(f"Loaded {len(real_items)} real keyframe images (frames 0..38 across 6 cameras)")

    # 3. Load Procedural Day Images
    proc_dir = scene_sim_dir / "runs" / args.run_proc
    proc_items = load_sim_run_images(proc_dir)
    print(f"Loaded {len(proc_items)} procedural day images ({args.run_proc})")

    # 4. Feature Extraction & KID Evaluation using eval venv
    eval_venv_py = BACKEND_DIR / ".tools" / "eval" / ".venv" / "bin" / "python"
    kid_worker_script = args.evidence_dir / "calc_kid_worker.py"
    kid_worker_script.write_text(f"""import json, sys
from pathlib import Path
sys.path.insert(0, {str(BACKEND_DIR)!r})
from eval.kid import InceptionFeatureExtractor, compute_kid

real_paths = { [str(item[2]) for item in real_items] !r }
proc_paths = { [str(item[2]) for item in proc_items] !r }
assets_paths = { [str(item[2]) for item in assets_items] !r }

extractor = InceptionFeatureExtractor()
real_feat = extractor.extract_features([Path(p) for p in real_paths], batch_size=32)
proc_feat = extractor.extract_features([Path(p) for p in proc_paths], batch_size=32)
assets_feat = extractor.extract_features([Path(p) for p in assets_paths], batch_size=32)

# Floor split
half1_paths = [Path(p) for idx, cam, p in { [(item[0], item[1], str(item[2])) for item in real_items] !r } if idx < 20]
half2_paths = [Path(p) for idx, cam, p in { [(item[0], item[1], str(item[2])) for item in real_items] !r } if idx >= 20]
half1_feat = extractor.extract_features(half1_paths, batch_size=32)
half2_feat = extractor.extract_features(half2_paths, batch_size=32)

k_floor_m, k_floor_s = compute_kid(half1_feat, half2_feat, subset_size=min(len(half1_feat), len(half2_feat), {args.subset_size}), num_subsets={args.subsets}, seed={args.seed})
k_proc_m, k_proc_s = compute_kid(proc_feat, real_feat, subset_size=min(len(proc_feat), len(real_feat), {args.subset_size}), num_subsets={args.subsets}, seed={args.seed})
k_assets_m, k_assets_s = compute_kid(assets_feat, real_feat, subset_size=min(len(assets_feat), len(real_feat), {args.subset_size}), num_subsets={args.subsets}, seed={args.seed})

out = {{
    "floor": {{"mean": float(k_floor_m), "std": float(k_floor_s)}},
    "proc": {{"mean": float(k_proc_m), "std": float(k_proc_s)}},
    "assets": {{"mean": float(k_assets_m), "std": float(k_assets_s)}},
}}
print("KID_JSON_OUTPUT " + json.dumps(out))
""")

    print("\n[EVAL] Computing Inception-v3 pool3 features & KID via eval environment...")
    res = subprocess.run([str(eval_venv_py), str(kid_worker_script)], capture_output=True, text=True, check=True)
    kid_output_line = next(line for line in res.stdout.splitlines() if line.startswith("KID_JSON_OUTPUT "))
    kid_results = json.loads(kid_output_line.replace("KID_JSON_OUTPUT ", ""))
    if kid_worker_script.is_file():
        kid_worker_script.unlink()

    kid_floor_mean = kid_results["floor"]["mean"]
    kid_floor_std = kid_results["floor"]["std"]
    kid_proc_mean = kid_results["proc"]["mean"]
    kid_proc_std = kid_results["proc"]["std"]
    kid_assets_mean = kid_results["assets"]["mean"]
    kid_assets_std = kid_results["assets"]["std"]

    print(f"  Real Floor (split):   {kid_floor_mean:.6f} +- {kid_floor_std:.6f} (x1000: {kid_floor_mean*1000:.3f})")
    print(f"  Procedural Day (S11): {kid_proc_mean:.6f} +- {kid_proc_std:.6f} (x1000: {kid_proc_mean*1000:.3f})")
    print(f"  Assets Day (S12):     {kid_assets_mean:.6f} +- {kid_assets_std:.6f} (x1000: {kid_assets_mean*1000:.3f})")

    # 5. Side-by-side Visual Comparisons (evidence/s12/compare_<cam>.jpg)
    print("\nGenerating 3-column side-by-side comparisons...")
    frame_0_real = {item[1]: item[2] for item in real_items if item[0] == 0}
    frame_0_proc = {item[1]: item[2] for item in proc_items if item[0] == 0}
    frame_0_assets = {item[1]: item[2] for item in assets_items if item[0] == 0}

    for cam in CAMERAS:
        out_comp = args.evidence_dir / f"compare_{cam}.jpg"
        create_3col_comparison(
            real_path=frame_0_real.get(cam),
            proc_path=frame_0_proc.get(cam),
            assets_path=frame_0_assets.get(cam),
            out_path=out_comp,
            camera_name=cam,
            frame_idx=0,
        )
        print(f"  Saved comparison: {out_comp}")

    # 6. Object Recognition Evaluation (S6 §6 / Faster R-CNN)
    print("\nRunning Object Detection / Recognition gate on assets day...")
    rec_metrics = evaluate_recognition(args.scene, args.run_assets, args.evidence_dir)

    # 7. Compile Final Report
    pilot_metrics = {
        "scene": args.scene,
        "render_wall_time_s": render_wall_time_s,
        "render_wall_time_min": render_wall_time_s / 60.0,
        "render_wall_time_limit_min": 20.0,
        "render_wall_time_passed": render_wall_time_s <= 1200.0,
        "kid": {
            "real_split_floor": {
                "mean": kid_floor_mean,
                "std": kid_floor_std,
                "mean_x1000": kid_floor_mean * 1000.0,
                "std_x1000": kid_floor_std * 1000.0,
            },
            "procedural_day": {
                "mean": kid_proc_mean,
                "std": kid_proc_std,
                "mean_x1000": kid_proc_mean * 1000.0,
                "std_x1000": kid_proc_std * 1000.0,
            },
            "assets_day": {
                "mean": kid_assets_mean,
                "std": kid_assets_std,
                "mean_x1000": kid_assets_mean * 1000.0,
                "std_x1000": kid_assets_std * 1000.0,
            },
        },
        "recognition": rec_metrics.get("summary") if rec_metrics else None,
        "recognition_by_class": rec_metrics.get("by_class") if rec_metrics else None,
    }

    report_path = args.evidence_dir / "kid_metrics.json"
    report_path.write_text(json.dumps(pilot_metrics, indent=2) + "\n")
    print(f"\nWrote full metrics to {report_path}")

    # Print Summary Table
    print("\n" + "=" * 70)
    print("S12 PILOT METRICS SUMMARY TABLE")
    print("=" * 70)
    print(f"{'Source':<26} | {'KID (mean +- std)':<22} | {'KID x 1000':<12}")
    print("-" * 70)
    print(f"{'1. Real Floor (split)':<26} | {kid_floor_mean:8.5f} +- {kid_floor_std:7.5f} | {kid_floor_mean*1000:10.3f}")
    print(f"{'2. Procedural Day (S11)':<26} | {kid_proc_mean:8.5f} +- {kid_proc_std:7.5f} | {kid_proc_mean*1000:10.3f}")
    print(f"{'3. Assets Day (S12)':<26} | {kid_assets_mean:8.5f} +- {kid_assets_std:7.5f} | {kid_assets_mean*1000:10.3f}")
    print("=" * 70)

    # Check stopping condition: KID assets vs procedural
    diff = kid_proc_mean - kid_assets_mean
    significance = diff / max(kid_assets_std, 1e-6)
    print(f"\nAssets vs Procedural: ΔKID = {diff:.6f} ({significance:.2f} std deviations)")
    if kid_assets_mean < kid_proc_mean:
        print("=> ASSETS OUTPERFORMS PROCEDURAL: Gate PASSED!")
    elif abs(diff) < kid_assets_std:
        print("=> ASSETS WITHIN 1 STD DEV OF PROCEDURAL (Stopping condition evaluated)")
    else:
        print("=> ASSETS DOES NOT OUTPERFORM PROCEDURAL")

    return 0


if __name__ == "__main__":
    # If PIL or torch is required, delegate to eval venv if needed
    try:
        import PIL  # noqa: F401
    except ImportError:
        eval_py = BACKEND_DIR / ".tools" / "eval" / ".venv" / "bin" / "python"
        if eval_py.is_file() and sys.executable != str(eval_py):
            os.execv(str(eval_py), [str(eval_py)] + sys.argv)
    sys.exit(main())
