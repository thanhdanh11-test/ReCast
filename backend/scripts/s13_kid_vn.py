"""Local-only SPEC-S13 KID comparison; private reference pixels never leave memory."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def center_crop(image):
    width, height = image.size
    return image.crop((round(width * 0.2), round(height * 0.2), round(width * 0.8), round(height * 0.8)))


def extract(paths, extractor, calibration=None, front_image="image_0.jpg"):
    import cv2
    import numpy as np
    from PIL import Image

    features = []
    for start in range(0, len(paths), 8):
        images = []
        for path in paths[start:start + 8]:
            with Image.open(path) as source:
                image = source.convert("RGB")
            if calibration is not None and path.name == front_image:
                image = Image.fromarray(cv2.undistort(np.asarray(image), np.asarray(calibration["K"], dtype=float), np.asarray(calibration["dist"], dtype=float)))
            images.append(center_crop(image))
        features.append(extractor.extract_features(images, batch_size=8))
        print(f"FEATURES {min(start + 8, len(paths))}/{len(paths)}", flush=True)
    if not features:
        raise ValueError("Image set is empty")
    return np.concatenate(features)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real-root", type=Path, required=True)
    parser.add_argument("--calibration", type=Path, required=True)
    parser.add_argument("--sim-vn", type=Path, required=True)
    parser.add_argument("--sim-sg", type=Path, required=True)
    parser.add_argument("--sim-sg-extra", type=Path, help="Optional historical SG run; excluded from the primary gate")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--front-image", default="image_0.jpg")
    args = parser.parse_args()
    if not args.real_root.is_absolute() or not args.calibration.is_absolute():
        parser.error("Private references must use absolute local paths")
    output = args.out.resolve()
    if (output.is_relative_to(args.real_root.resolve())
            or output.is_relative_to(args.calibration.parent.resolve())):
        parser.error("Output must be outside the read-only private reference directories")
    try:
        vn_run = json.loads((args.sim_vn / "run.json").read_text())
        sg_run = json.loads((args.sim_sg / "run.json").read_text())
    except (OSError, ValueError) as exc:
        parser.error(f"Cannot read simulation run metadata: {exc}")
    for field in ("samples", "engine", "environment", "resolution_scale", "weather"):
        if vn_run["scenario"].get(field) != sg_run["scenario"].get(field):
            parser.error(f"Primary VN/SG comparison requires identical {field}")
    if vn_run["frames"] != sg_run["frames"] or vn_run["cameras"] != sg_run["cameras"]:
        parser.error("Primary VN/SG comparison requires identical frames and cameras")
    if vn_run["status"] != "ok" or sg_run["status"] != "ok":
        parser.error("Primary comparison requires successful renders")
    from eval.kid import InceptionFeatureExtractor, compute_kid

    frames = sorted((args.real_root / "related_images").glob("*_pcd"))
    real = [path for frame in frames for path in sorted(frame.glob("image_*.jpg"))]
    split = sum(len(list(frame.glob("image_*.jpg"))) for frame in frames[:len(frames) // 2])
    vn = sorted((args.sim_vn / "images").glob("*/*.png"))
    sg = sorted((args.sim_sg / "images").glob("*/*.png"))
    calibration = json.loads(args.calibration.read_text())["cameras"]["CAM_P_F"]
    extractor = InceptionFeatureExtractor()
    real_features = extract(real, extractor, calibration, args.front_image)
    vn_features = extract(vn, extractor)
    sg_features = extract(sg, extractor)
    scores = {}
    comparisons = [("vn_real_floor", real_features[:split], real_features[split:]),
                       ("sim_vn_vs_vn_real", vn_features, real_features),
                       ("sim_sg_vs_vn_real", sg_features, real_features)]
    if args.sim_sg_extra is not None:
        extra = sorted((args.sim_sg_extra / "images").glob("*/*.png"))
        comparisons.append(("sim_sg_extra_vs_vn_real", extract(extra, extractor), real_features))
    for name, a, b in comparisons:
        mean, std = compute_kid(a, b, seed=42)
        scores[name] = {"mean": mean, "std": std, "n_x": len(a), "n_y": len(b)}
    gap = scores["sim_sg_vs_vn_real"]["mean"] - scores["sim_vn_vs_vn_real"]["mean"]
    uncertainty = max(scores["sim_sg_vs_vn_real"]["std"], scores["sim_vn_vs_vn_real"]["std"])
    result = {"scores": scores, "gate": gap >= uncertainty and gap > 0, "gap": gap,
              "required_gap": uncertainty, "crop_fraction": 0.6, "front_image": args.front_image,
              "real_frames": len(frames), "device": str(extractor.device),
              "primary_samples": vn_run["scenario"]["samples"],
              "primary_environment": vn_run["scenario"].get("environment", "voxel"),
              "primary_frames": len(vn_run["frames"]), "primary_cameras": vn_run["cameras"]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, allow_nan=False))
    print(json.dumps(result), flush=True)
    return 0 if result["gate"] else 1


if __name__ == "__main__":
    sys.exit(main())
