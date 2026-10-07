"""Kernel Inception Distance (KID) evaluation metric (SPEC-S11 §4).

Computes unbiased squared Maximum Mean Discrepancy (MMD^2) with a polynomial
kernel on Inception-v3 pool3 features (2048-D) between real reference images
and simulated rendered images.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


class InceptionFeatureExtractor:
    """Extracts 2048-dimensional pool3 features using torchvision Inception-v3."""

    def __init__(self, device: str | None = None) -> None:
        import torch
        from torchvision import transforms
        from torchvision.models import Inception_V3_Weights, inception_v3

        if device is None:
            if torch.backends.mps.is_available():
                self.device = torch.device("mps")
            else:
                self.device = torch.device("cpu")
        else:
            self.device = torch.device(device)

        self.weights = Inception_V3_Weights.DEFAULT
        self.model = inception_v3(weights=self.weights)
        self.model.fc = torch.nn.Identity()
        self.model.dropout = torch.nn.Identity()

        try:
            self.model.to(self.device)
        except Exception:  # noqa: BLE001
            self.device = torch.device("cpu")
            self.model.to(self.device)

        self.model.eval()

        # Inception-v3 expects 299x299 RGB images normalized with ImageNet statistics
        self.transform = transforms.Compose(
            [
                transforms.Resize((299, 299), interpolation=transforms.InterpolationMode.BILINEAR),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ]
        )

    def extract_features(
        self,
        images: Sequence[Image.Image | Path | str | np.ndarray],
        batch_size: int = 32,
    ) -> np.ndarray:
        """Extract 2048-D feature vectors for a list of images."""
        import torch

        if not images:
            return np.empty((0, 2048), dtype=np.float32)

        features_list: list[np.ndarray] = []

        for i in range(0, len(images), batch_size):
            batch_items = images[i : i + batch_size]
            tensors: list[torch.Tensor] = []
            for item in batch_items:
                if isinstance(item, (str, Path)):
                    img = Image.open(item).convert("RGB")
                elif isinstance(item, np.ndarray):
                    img = Image.fromarray(item).convert("RGB")
                elif isinstance(item, Image.Image):
                    img = item.convert("RGB")
                else:
                    raise TypeError(f"Unsupported image type: {type(item)}")
                tensors.append(self.transform(img))

            batch_tensor = torch.stack(tensors).to(self.device)
            with torch.no_grad():
                try:
                    feat = self.model(batch_tensor)
                except Exception:  # noqa: BLE001
                    self.device = torch.device("cpu")
                    self.model.to(self.device)
                    feat = self.model(batch_tensor.to(self.device))
                features_list.append(feat.cpu().numpy())

        return np.concatenate(features_list, axis=0).astype(np.float32)


def polynomial_kernel(
    x: np.ndarray,
    y: np.ndarray,
    degree: int = 3,
    gamma: float | None = None,
    coef0: float = 1.0,
) -> np.ndarray:
    """Compute polynomial kernel matrix K(x, y) = (gamma * x @ y.T + coef0) ** degree."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    d = x.shape[1]
    if gamma is None:
        gamma = 1.0 / d
    return (gamma * (x @ y.T) + coef0) ** degree


def polynomial_mmd(
    x: np.ndarray,
    y: np.ndarray,
    degree: int = 3,
    gamma: float | None = None,
    coef0: float = 1.0,
) -> float:
    """Unbiased estimator of squared Maximum Mean Discrepancy (MMD^2).

    Excludes diagonals from K_XX and K_YY to provide an unbiased estimator.
    If x and y are the exact same array instance, returns 0.0.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)

    if x is y:
        return 0.0

    m = len(x)
    n = len(y)
    if m < 2 or n < 2:
        raise ValueError(f"Need at least 2 samples per set to compute unbiased MMD, got m={m}, n={n}")

    k_xx = polynomial_kernel(x, x, degree=degree, gamma=gamma, coef0=coef0)
    k_yy = polynomial_kernel(y, y, degree=degree, gamma=gamma, coef0=coef0)
    k_xy = polynomial_kernel(x, y, degree=degree, gamma=gamma, coef0=coef0)

    sum_xx = (np.sum(k_xx) - np.trace(k_xx)) / (m * (m - 1))
    sum_yy = (np.sum(k_yy) - np.trace(k_yy)) / (n * (n - 1))
    sum_xy = np.sum(k_xy) / (m * n)

    return float(sum_xx + sum_yy - 2.0 * sum_xy)


def compute_kid(
    features_x: np.ndarray,
    features_y: np.ndarray,
    subset_size: int = 100,
    num_subsets: int = 100,
    seed: int = 42,
    degree: int = 3,
) -> tuple[float, float]:
    """Compute Kernel Inception Distance (KID mean and std) over multiple random subsets.

    Returns:
        (kid_mean, kid_std)
    """
    features_x = np.asarray(features_x, dtype=np.float64)
    features_y = np.asarray(features_y, dtype=np.float64)

    if features_x is features_y:
        return 0.0, 0.0

    m, n = len(features_x), len(features_y)
    if m < 2 or n < 2:
        raise ValueError(f"Insufficient samples: len(x)={m}, len(y)={n}")

    s = min(m, n, subset_size)
    if s < 2:
        raise ValueError("Subset size must be at least 2")

    rng = np.random.RandomState(seed)
    scores: list[float] = []

    for _ in range(num_subsets):
        idx_x = rng.choice(m, size=s, replace=s > m)
        idx_y = rng.choice(n, size=s, replace=s > n)
        val = polynomial_mmd(features_x[idx_x], features_y[idx_y], degree=degree)
        scores.append(val)

    kid_mean = float(np.mean(scores))
    kid_std = float(np.std(scores, ddof=1)) if len(scores) > 1 else 0.0
    return kid_mean, kid_std


def evaluate_kid(
    images_x: Sequence[Image.Image | Path | str | np.ndarray],
    images_y: Sequence[Image.Image | Path | str | np.ndarray],
    extractor: InceptionFeatureExtractor | None = None,
    subset_size: int = 50,
    num_subsets: int = 50,
    batch_size: int = 32,
    seed: int = 42,
) -> dict[str, Any]:
    """Extract features and calculate KID between two image collections."""
    if extractor is None:
        extractor = InceptionFeatureExtractor()

    feat_x = extractor.extract_features(images_x, batch_size=batch_size)
    feat_y = extractor.extract_features(images_y, batch_size=batch_size)

    kid_mean, kid_std = compute_kid(
        feat_x,
        feat_y,
        subset_size=subset_size,
        num_subsets=num_subsets,
        seed=seed,
    )

    return {
        "kid_mean": kid_mean,
        "kid_std": kid_std,
        "kid_mean_x1000": kid_mean * 1000.0,
        "kid_std_x1000": kid_std * 1000.0,
        "samples_x": len(images_x),
        "samples_y": len(images_y),
        "subset_size": min(len(images_x), len(images_y), subset_size),
        "num_subsets": num_subsets,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Compute Kernel Inception Distance (KID)")
    parser.add_argument("--dir-x", type=Path, required=True, help="Directory containing reference images")
    parser.add_argument("--dir-y", type=Path, required=True, help="Directory containing generated images")
    parser.add_argument("--pattern-x", type=str, default="*.jpg")
    parser.add_argument("--pattern-y", type=str, default="*.png")
    parser.add_argument("--subsets", type=int, default=50)
    parser.add_argument("--subset-size", type=int, default=50)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    files_x = sorted(args.dir_x.glob(args.pattern_x))
    files_y = sorted(args.dir_y.glob(args.pattern_y))

    if not files_x:
        print(f"No files matching {args.pattern_x} in {args.dir_x}", file=sys.stderr)
        return 1
    if not files_y:
        print(f"No files matching {args.pattern_y} in {args.dir_y}", file=sys.stderr)
        return 1

    print(f"Evaluating KID between {len(files_x)} and {len(files_y)} images...")
    result = evaluate_kid(
        files_x,
        files_y,
        subset_size=args.subset_size,
        num_subsets=args.subsets,
        seed=args.seed,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
