#!/usr/bin/env python3
"""S11 Pilot: Compare 4 visual sources and evaluate KID and Recognition metrics.

Sources compared against real imagery:
1. Real split-in-half (frames 0..19 vs 20..38) — baseline floor
2. Procedural day (day_proc) — pilot candidate (PBR CC0 assets + procedural shaders)
3. Blender voxel (day_v2) — voxel baseline
4. 3D Gaussian Splatting (15-min mpsplat run) — splat baseline

Outputs:
- KID table ± standard deviation across subsets
- Object recognition metrics by class (S6 §6 / Faster R-CNN)
- 4-column comparison images: evidence/s11/compare_<cam>.jpg
- Procedural views: evidence/s11/procedural_day_<cam>.jpg, etc.
- JSON metrics report: evidence/s11/kid_metrics.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

# Add backend directory to sys.path
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from eval.kid import InceptionFeatureExtractor, compute_kid

CAMERAS = [
    "CAM_FRONT",
    "CAM_FRONT_LEFT",
    "CAM_FRONT_RIGHT",
    "CAM_BACK",
    "CAM_BACK_LEFT",
    "CAM_BACK_RIGHT",
]


def load_real_keyframe_images(scene_cache_dir: Path, num_frames: int = 39) -> list[tuple[int, str, Path]]:
    """Collect real camera keyframe images from cache."""
    results = []
    frames_dir = scene_cache_dir / "frames"
    for frame_idx in range(num_frames):
        frame_dir = frames_dir / f"scene-0061_{frame_idx:06d}" / "cams"
        if not frame_dir.is_dir():
            continue
        for cam in CAMERAS:
            img_path = frame_dir / f"{cam}.jpg"
            if img_path.is_file():
                results.append((frame_idx, cam, img_path))
    return results


def load_sim_run_images(run_dir: Path, num_frames: int = 39) -> list[tuple[int, str, Path]]:
    """Collect simulated camera images from runs/<scenario>/images."""
    results = []
    for frame_idx in range(num_frames):
        for cam in CAMERAS:
            img_path = run_dir / "images" / cam / f"{frame_idx:06d}.png"
            if img_path.is_file():
                results.append((frame_idx, cam, img_path))
    return results


def load_splat_renders(
    build_run_dir: Path,
    gs_dirs: list[Path],
) -> list[tuple[str, str, Path, Path]]:
    """Match splat renders in build_runs/<hash>/renders with real source images."""
    render_dir = build_run_dir / "renders"
    if not render_dir.is_dir():
        return []

    matched = []
    for r_path in sorted(render_dir.glob("*.jpg")):
        parts = r_path.stem.split("_")
        if len(parts) < 3:
            continue
        cam = "_".join(parts[1:-1])
        ts = parts[-1]

        real_img = None
        for gs_dir in gs_dirs:
            candidate = gs_dir / "images" / cam / f"{ts}.jpg"
            if candidate.is_file():
                real_img = candidate
                break

        if real_img:
            matched.append((cam, ts, r_path, real_img))

    return matched


def create_4col_comparison(
    real_path: Path,
    voxel_path: Path | None,
    splat_path: Path | None,
    proc_path: Path | None,
    out_path: Path,
    camera_name: str,
    frame_idx: int = 0,
) -> None:
    """Create a 4-column side-by-side comparison image: Real | Voxel | Splat | Procedural."""
    col_w, col_h = 400, 225
    header_h = 50

    titles = [
        "1. Real Ground Truth",
        "2. Voxel (EEVEE)",
        "3. Splat (15m 3DGS)",
        "4. Procedural PBR (EEVEE)",
    ]

    images: list[Image.Image] = []
    for p in [real_path, voxel_path, splat_path, proc_path]:
        if p and Path(p).is_file():
            im = Image.open(p).convert("RGB")
            im = im.resize((col_w, col_h), Image.Resampling.BILINEAR)
        else:
            im = Image.new("RGB", (col_w, col_h), (30, 30, 30))
            d = ImageDraw.Draw(im)
            d.text((col_w // 2 - 40, col_h // 2 - 10), "N/A", fill=(180, 180, 180))
        images.append(im)

    total_w = col_w * 4
    total_h = col_h + header_h

    canvas = Image.new("RGB", (total_w, total_h), (20, 20, 22))
    draw = ImageDraw.Draw(canvas)

    # Main header
    banner_text = f"SPEC-S11 Real-to-Sim Pilot: {camera_name} (Keyframe {frame_idx})"
    draw.text((15, 12), banner_text, fill=(255, 255, 255))

    for col_i, (title, img) in enumerate(zip(titles, images)):
        x_offset = col_i * col_w
        canvas.paste(img, (x_offset, header_h))
        # Column title background
        draw.rectangle([x_offset, header_h - 22, x_offset + col_w, header_h], fill=(35, 38, 44))
        draw.text((x_offset + 10, header_h - 18), title, fill=(220, 230, 242))
        # Column separator line
        if col_i > 0:
            draw.line([(x_offset, header_h - 22), (x_offset, total_h)], fill=(60, 64, 72), width=1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, quality=90)


def evaluate_recognition(scene: str, run: str, out_dir: Path) -> dict[str, Any] | None:
    """Run object detector evaluation on the procedural run."""
    try:
        manifest_script = BACKEND_DIR / "scripts" / "recognize_manifest.py"
        manifest_json = out_dir / f"recognize_manifest_{run}.json"

        # Generate manifest using backend venv
        py_bin = BACKEND_DIR / ".venv" / "bin" / "python"
        if not py_bin.is_file():
            py_bin = Path(sys.executable)

        cmd = [str(py_bin), str(manifest_script), "--scene", scene, "--run", run, "--out", str(manifest_json)]
        subprocess.run(cmd, check=True, capture_output=True, text=True)

        # Run evaluate using eval venv
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Run S11 procedural real-to-sim pilot evaluation.")
    parser.add_argument("--scene", type=str, default="scene-0061")
    parser.add_argument("--run-proc", type=str, default="day_proc")
    parser.add_argument("--run-voxel", type=str, default="day_v2")
    parser.add_argument(
        "--evidence-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "planning" / "02_2026-10-05_blender-real2sim" / "evidence" / "s11",
    )
    parser.add_argument("--subsets", type=int, default=50)
    parser.add_argument("--subset-size", type=int, default=50)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    args.evidence_dir.mkdir(parents=True, exist_ok=True)

    data_dir = BACKEND_DIR / "data"
    scene_sim_dir = data_dir / "sim" / args.scene
    scene_cache_dir = data_dir / "cache" / args.scene

    print(f"=== S11 Procedural Real-to-Sim Pilot Evaluation: {args.scene} ===")

    # 1. Load Real Ground Truth Images
    real_items = load_real_keyframe_images(scene_cache_dir)
    print(f"Loaded {len(real_items)} real keyframe images (frames 0..38 across 6 cameras)")

    # 2. Load Procedural Day Images
    proc_dir = scene_sim_dir / "runs" / args.run_proc
    proc_items = load_sim_run_images(proc_dir)
    print(f"Loaded {len(proc_items)} procedural day images ({args.run_proc})")

    # 3. Load Voxel Images
    voxel_dir = scene_sim_dir / "runs" / args.run_voxel
    voxel_items = load_sim_run_images(voxel_dir)
    print(f"Loaded {len(voxel_items)} voxel images ({args.run_voxel})")

    # 4. Load Splat Renders
    build_run_dir = scene_sim_dir / "build_runs" / "3ed55aa2c8144a099f7d980556628aec"
    gs_dirs = [scene_sim_dir / "gs12", scene_sim_dir / "gs"]
    splat_matches = load_splat_renders(build_run_dir, gs_dirs)
    print(f"Loaded {len(splat_matches)} 3D Gaussian Splatting matched test views")

    # Initialize Feature Extractor
    print("\nInitializing Inception-v3 pool3 feature extractor...")
    extractor = InceptionFeatureExtractor()

    # Extract Real Features
    print(f"Extracting features for Real reference ({len(real_items)} images)...")
    real_paths = [item[2] for item in real_items]
    t0 = time.perf_counter()
    real_features = extractor.extract_features(real_paths, batch_size=32)
    print(f"Real features: {real_features.shape} in {time.perf_counter() - t0:.2f}s")

    # -------------------------------------------------------------
    # Metric 1: Real Split-in-Half Baseline (Floor)
    # -------------------------------------------------------------
    print("\n[1/4] Computing Real Split-in-Half KID (Floor Baseline)...")
    half1_paths = [item[2] for item in real_items if item[0] < 20]
    half2_paths = [item[2] for item in real_items if item[0] >= 20]

    half1_feat = extractor.extract_features(half1_paths, batch_size=32)
    half2_feat = extractor.extract_features(half2_paths, batch_size=32)

    kid_floor_mean, kid_floor_std = compute_kid(
        half1_feat,
        half2_feat,
        subset_size=min(len(half1_feat), len(half2_feat), args.subset_size),
        num_subsets=args.subsets,
        seed=args.seed,
    )
    print(f"  Real Split-in-Half KID: {kid_floor_mean:.6f} ± {kid_floor_std:.6f} (x1000: {kid_floor_mean*1000:.3f})")

    # -------------------------------------------------------------
    # Metric 2: Procedural Day (day_proc) vs Real Reference
    # -------------------------------------------------------------
    print("\n[2/4] Computing Procedural Day (day_proc) vs Real KID...")
    proc_paths = [item[2] for item in proc_items]
    proc_features = extractor.extract_features(proc_paths, batch_size=32)

    kid_proc_mean, kid_proc_std = compute_kid(
        proc_features,
        real_features,
        subset_size=min(len(proc_features), len(real_features), args.subset_size),
        num_subsets=args.subsets,
        seed=args.seed,
    )
    print(f"  Procedural Day KID: {kid_proc_mean:.6f} ± {kid_proc_std:.6f} (x1000: {kid_proc_mean*1000:.3f})")

    # -------------------------------------------------------------
    # Metric 3: Blender Voxel (day_v2) vs Real Reference
    # -------------------------------------------------------------
    print("\n[3/4] Computing Blender Voxel (day_v2) vs Real KID...")
    voxel_paths = [item[2] for item in voxel_items]
    voxel_features = extractor.extract_features(voxel_paths, batch_size=32)

    # For voxel, evaluate against real images corresponding to matching frames
    matching_real_paths = [
        item[2] for item in real_items if (item[0], item[1]) in {(v[0], v[1]) for v in voxel_items}
    ]
    matching_real_feat = extractor.extract_features(matching_real_paths, batch_size=32)

    voxel_subset_size = min(len(voxel_features), len(matching_real_feat), args.subset_size)
    if voxel_subset_size >= 2:
        kid_voxel_mean, kid_voxel_std = compute_kid(
            voxel_features,
            matching_real_feat,
            subset_size=voxel_subset_size,
            num_subsets=args.subsets,
            seed=args.seed,
        )
    else:
        kid_voxel_mean, kid_voxel_std = 0.0, 0.0
    print(f"  Blender Voxel KID: {kid_voxel_mean:.6f} ± {kid_voxel_std:.6f} (x1000: {kid_voxel_mean*1000:.3f})")

    # -------------------------------------------------------------
    # Metric 4: 3D Gaussian Splatting (15-min) vs Real Reference
    # -------------------------------------------------------------
    print("\n[4/4] Computing 3D Gaussian Splatting (15-min) vs Real KID...")
    splat_rendered_paths = [m[2] for m in splat_matches]
    splat_real_paths = [m[3] for m in splat_matches]

    splat_rendered_feat = extractor.extract_features(splat_rendered_paths, batch_size=32)
    splat_real_feat = extractor.extract_features(splat_real_paths, batch_size=32)

    splat_subset_size = min(len(splat_rendered_feat), len(splat_real_feat), args.subset_size)
    kid_splat_mean, kid_splat_std = compute_kid(
        splat_rendered_feat,
        splat_real_feat,
        subset_size=splat_subset_size,
        num_subsets=args.subsets,
        seed=args.seed,
    )
    print(f"  3DGS Splat (15-min) KID: {kid_splat_mean:.6f} ± {kid_splat_std:.6f} (x1000: {kid_splat_mean*1000:.3f})")

    # -------------------------------------------------------------
    # 5. Side-by-side Visual Comparisons (evidence/s11/compare_<cam>.jpg)
    # -------------------------------------------------------------
    print("\nGenerating 4-column side-by-side comparisons...")
    frame_0_real = {item[1]: item[2] for item in real_items if item[0] == 0}
    frame_0_proc = {item[1]: item[2] for item in proc_items if item[0] == 0}
    frame_0_voxel = {item[1]: item[2] for item in voxel_items if item[0] == 0}

    # Find splat renders closest to frame 0
    splat_by_cam: dict[str, Path] = {}
    for cam, ts, r_path, _ in splat_matches:
        if cam not in splat_by_cam:
            splat_by_cam[cam] = r_path

    for cam in CAMERAS:
        out_comp = args.evidence_dir / f"compare_{cam}.jpg"
        create_4col_comparison(
            real_path=frame_0_real.get(cam),
            voxel_path=frame_0_voxel.get(cam),
            splat_path=splat_by_cam.get(cam),
            proc_path=frame_0_proc.get(cam),
            out_path=out_comp,
            camera_name=cam,
            frame_idx=0,
        )
        print(f"  Saved comparison: {out_comp}")

        # Also save individual procedural views
        if cam in frame_0_proc:
            proc_img = Image.open(frame_0_proc[cam]).convert("RGB")
            proc_img.save(args.evidence_dir / f"procedural_day_{cam}.jpg", quality=90)

    # Copy / save night or rain views if available
    night_dir = scene_sim_dir / "runs" / "night_proc"
    if night_dir.is_dir():
        for cam in CAMERAS:
            p = night_dir / "images" / cam / "000000.png"
            if p.is_file():
                Image.open(p).convert("RGB").save(args.evidence_dir / f"procedural_night_{cam}.jpg", quality=90)

    rain_dir = scene_sim_dir / "runs" / "rain_proc"
    if rain_dir.is_dir():
        for cam in CAMERAS:
            p = rain_dir / "images" / cam / "000000.png"
            if p.is_file():
                Image.open(p).convert("RGB").save(args.evidence_dir / f"procedural_rain_{cam}.jpg", quality=90)

    # -------------------------------------------------------------
    # 6. Object Recognition Evaluation (S6 §6)
    # -------------------------------------------------------------
    print("\nRunning Object Detection / Recognition gate on procedural day...")
    rec_metrics = evaluate_recognition(args.scene, args.run_proc, args.evidence_dir)

    # Compile Final Report
    pilot_metrics = {
        "scene": args.scene,
        "kid": {
            "real_split_floor": {
                "mean": kid_floor_mean,
                "std": kid_floor_std,
                "mean_x1000": kid_floor_mean * 1000.0,
                "std_x1000": kid_floor_std * 1000.0,
                "samples": f"{len(half1_feat)} vs {len(half2_feat)}",
            },
            "procedural_day": {
                "mean": kid_proc_mean,
                "std": kid_proc_std,
                "mean_x1000": kid_proc_mean * 1000.0,
                "std_x1000": kid_proc_std * 1000.0,
                "samples": f"{len(proc_features)} vs {len(real_features)}",
            },
            "blender_voxel": {
                "mean": kid_voxel_mean,
                "std": kid_voxel_std,
                "mean_x1000": kid_voxel_mean * 1000.0,
                "std_x1000": kid_voxel_std * 1000.0,
                "samples": f"{len(voxel_features)} vs {len(matching_real_feat)}",
            },
            "splat_15min": {
                "mean": kid_splat_mean,
                "std": kid_splat_std,
                "mean_x1000": kid_splat_mean * 1000.0,
                "std_x1000": kid_splat_std * 1000.0,
                "samples": f"{len(splat_rendered_feat)} vs {len(splat_real_feat)}",
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
    print("S11 PILOT METRICS SUMMARY TABLE")
    print("=" * 70)
    print(f"{'Source':<26} | {'KID (mean ± std)':<22} | {'KID × 1000':<12} | {'Samples'}")
    print("-" * 70)
    print(
        f"{'1. Real Floor (split)':<26} | {kid_floor_mean:8.5f} ± {kid_floor_std:7.5f} | {kid_floor_mean*1000:10.3f} | {pilot_metrics['kid']['real_split_floor']['samples']}"
    )
    print(
        f"{'2. Procedural Day':<26} | {kid_proc_mean:8.5f} ± {kid_proc_std:7.5f} | {kid_proc_mean*1000:10.3f} | {pilot_metrics['kid']['procedural_day']['samples']}"
    )
    print(
        f"{'3. Blender Voxel':<26} | {kid_voxel_mean:8.5f} ± {kid_voxel_std:7.5f} | {kid_voxel_mean*1000:10.3f} | {pilot_metrics['kid']['blender_voxel']['samples']}"
    )
    print(
        f"{'4. Splat (15 min)':<26} | {kid_splat_mean:8.5f} ± {kid_splat_std:7.5f} | {kid_splat_mean*1000:10.3f} | {pilot_metrics['kid']['splat_15min']['samples']}"
    )
    print("=" * 70)

    # Check stopping condition: KID procedural better than voxel
    diff = kid_voxel_mean - kid_proc_mean
    significance = diff / max(kid_proc_std, 1e-6)
    print(f"\nProcedural vs Voxel: ΔKID = {diff:.6f} ({significance:.2f} std deviations)")
    if kid_proc_mean < kid_voxel_mean:
        print("=> PROCEDURAL OUTPERFORMS VOXEL: Gate PASSED!")
    else:
        print("=> PROCEDURAL DOES NOT OUTPERFORM VOXEL: Gate FAILED!")

    return 0


if __name__ == "__main__":
    sys.exit(main())
