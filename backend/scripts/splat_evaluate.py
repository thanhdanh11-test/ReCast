"""Measure held-out RGB renders; retain full-image and static-mask scores separately."""
import json
import sys
from pathlib import Path

import cv2
import numpy as np


def scores(reference, rendered, mask=None):
    if reference.shape != rendered.shape or reference.ndim != 3 or reference.shape[2] != 3:
        raise ValueError("Expected matching HxWx3 RGB images")
    a, b = reference.astype(np.float64) / 255, rendered.astype(np.float64) / 255
    valid = np.ones(a.shape[:2], bool) if mask is None else mask > 0
    if not valid.any():
        raise ValueError("Empty evaluation mask")
    mse = float(np.mean((a[valid] - b[valid]) ** 2))
    psnr = float(-10 * np.log10(max(mse, 1e-16)))

    def blur(x):
        return cv2.GaussianBlur(x, (11, 11), 1.5)

    mu_a, mu_b = blur(a), blur(b)
    var_a, var_b = blur(a*a) - mu_a*mu_a, blur(b*b) - mu_b*mu_b
    covariance = blur(a*b) - mu_a*mu_b
    ssim_map = (((2*mu_a*mu_b + .01**2) * (2*covariance + .03**2))
                / ((mu_a*mu_a + mu_b*mu_b + .01**2) * (var_a + var_b + .03**2)))
    # Exclude border padding and any window crossing a dynamic mask.
    valid_ssim = cv2.erode(valid.astype(np.uint8), np.ones((11, 11), np.uint8)) > 0
    valid_ssim[:5] = valid_ssim[-5:] = False
    valid_ssim[:, :5] = valid_ssim[:, -5:] = False
    if not valid_ssim.any():
        raise ValueError("No valid 11x11 SSIM windows")
    return {"psnr_db": psnr, "ssim": float(ssim_map[valid_ssim].mean()),
            "pixels": int(valid.sum())}


def evaluate(scene, render_dir="training/eval_6000"):
    root = Path("data/splat") / scene
    evidence = Path("../planning/01_2026-10-03_topeye-web-mvp/evidence/p07/backend")
    records = json.loads((root / "transforms_test.json").read_text())["frames"]
    rows, comparisons = [], []
    for i, record in enumerate(records):
        reference = cv2.imread(str(root / record["file_path"]))
        rendered = cv2.imread(str(root / render_dir / Path(record["file_path"]).name))
        mask = cv2.imread(str(root / record["mask_path"]), cv2.IMREAD_GRAYSCALE)
        if reference is None or rendered is None or mask is None:
            raise ValueError(f"Missing held-out image/render/mask: {record['file_path']}")
        rows.append({"view": record["file_path"], "full": scores(reference, rendered),
                     "static": scores(reference, rendered, mask)})
        if i in {0, len(records)//3, 2*len(records)//3, len(records)-1}:
            pair = np.concatenate([reference, rendered], axis=1)
            cv2.putText(pair, f"GT | Brush: {Path(record['file_path']).stem}", (12, 24),
                        cv2.FONT_HERSHEY_SIMPLEX, .5, (0, 255, 255), 1)
            comparisons.append(pair)
    summary = {"scene": scene, "heldout_views": len(rows), "views": rows,
               "full_mean_psnr_db": float(np.mean([r["full"]["psnr_db"] for r in rows])),
               "full_mean_ssim": float(np.mean([r["full"]["ssim"] for r in rows])),
               "static_mean_psnr_db": float(np.mean([r["static"]["psnr_db"] for r in rows])),
               "static_mean_ssim": float(np.mean([r["static"]["ssim"] for r in rows])),
               "metric": "8-bit RGB, PSNR per view then mean, SSIM 11x11 sigma1.5 valid windows"}
    summary["stop_P07_0_c"] = summary["full_mean_psnr_db"] < 20
    (evidence / "evaluation.txt").write_text(json.dumps(summary, indent=2))
    if not cv2.imwrite(str(evidence / "heldout-four-views.png"), np.concatenate(comparisons)):
        raise OSError("Cannot write comparison image")
    print(json.dumps({key: value for key, value in summary.items() if key != "views"}, indent=2))
    return 2 if summary["stop_P07_0_c"] else 0


if __name__ == "__main__":
    raise SystemExit(evaluate(*sys.argv[1:3]))
