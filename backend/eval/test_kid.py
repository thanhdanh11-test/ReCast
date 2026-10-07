"""Unit tests for Kernel Inception Distance module (backend/eval/kid.py).

Verifies mathematical kernel properties, unbiased MMD calculation,
and KID behavior: identical / same-distribution datasets yield KID ≈ 0,
while different datasets yield significantly larger values.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

# Ensure backend/eval is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from kid import (
    InceptionFeatureExtractor,
    compute_kid,
    evaluate_kid,
    polynomial_kernel,
    polynomial_mmd,
)


def test_polynomial_kernel_shape_and_values():
    """Verify polynomial kernel calculation and dimensions."""
    x = np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float64)
    y = np.array([[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]], dtype=np.float64)
    # gamma = 0.5, coef0 = 1.0, degree = 2
    # K[0, 0] = (0.5 * (1*1 + 2*0) + 1)^2 = (0.5 + 1)^2 = 2.25
    k = polynomial_kernel(x, y, degree=2, gamma=0.5, coef0=1.0)
    assert k.shape == (2, 3)
    assert pytest.approx(k[0, 0], abs=1e-5) == 2.25


def test_polynomial_mmd_identical_pointer():
    """When x and y are the exact same object, polynomial_mmd should be 0.0."""
    x = np.random.randn(50, 128)
    assert polynomial_mmd(x, x) == 0.0


def test_polynomial_mmd_same_distribution_near_zero():
    """Two independent samples from the same distribution should have MMD^2 ≈ 0."""
    rng = np.random.RandomState(42)
    # 2048-dim features from same normal distribution
    x = rng.randn(100, 2048)
    y = rng.randn(100, 2048)

    mmd = polynomial_mmd(x, y)
    assert abs(mmd) < 0.05


def test_polynomial_mmd_different_distribution_large():
    """Samples from distinctly different distributions must yield large positive MMD^2."""
    rng = np.random.RandomState(42)
    x = rng.randn(100, 2048)
    y = rng.randn(100, 2048) + 3.0  # Significant mean shift

    mmd_same = polynomial_mmd(x, rng.randn(100, 2048))
    mmd_diff = polynomial_mmd(x, y)

    assert mmd_diff > 10.0
    assert mmd_diff > mmd_same * 100


def test_compute_kid_identical_input():
    """KID of an array against itself should be exactly 0.0 ± 0.0."""
    features = np.random.randn(80, 2048)
    mean, std = compute_kid(features, features, subset_size=40, num_subsets=20)
    assert mean == 0.0
    assert std == 0.0


def test_compute_kid_same_vs_different():
    """KID: hai tập giống nhau cho giá trị ≈ 0, hai tập khác hẳn cho giá trị lớn."""
    rng = np.random.RandomState(1337)

    # Dataset A & B from same distribution (zero mean, unit variance)
    data_a = rng.randn(150, 2048)
    data_b = rng.randn(150, 2048)

    # Dataset C from different distribution (shifted mean)
    data_c = rng.randn(150, 2048) + 2.5

    kid_same_mean, kid_same_std = compute_kid(data_a, data_b, subset_size=50, num_subsets=30, seed=123)
    kid_diff_mean, _kid_diff_std = compute_kid(data_a, data_c, subset_size=50, num_subsets=30, seed=123)

    # Same distribution: mean is close to 0
    assert abs(kid_same_mean) < 0.02
    assert kid_same_std >= 0.0

    # Different distribution: mean is large
    assert kid_diff_mean > 20.0
    assert kid_diff_mean > abs(kid_same_mean) * 50


def test_feature_extractor_on_synthetic_images():
    """Test feature extractor runs and produces (N, 2048) output vectors."""
    extractor = InceptionFeatureExtractor()
    img_red = Image.new("RGB", (320, 240), color=(255, 0, 0))
    img_blue = Image.new("RGB", (320, 240), color=(0, 0, 255))

    features = extractor.extract_features([img_red, img_blue], batch_size=2)
    assert features.shape == (2, 2048)
    assert features.dtype == np.float32
    # Red and blue images should have different feature representations
    diff = np.linalg.norm(features[0] - features[1])
    assert diff > 1.0


def test_evaluate_kid_end_to_end(tmp_path: Path):
    """Integration test: evaluate_kid with image inputs."""
    extractor = InceptionFeatureExtractor()

    # Create two sets of images
    # Set 1: reddish variations
    dir_a = tmp_path / "set_a"
    dir_a.mkdir()
    for i in range(6):
        img = Image.new("RGB", (100, 100), color=(200 + i * 5, 20, 20))
        img.save(dir_a / f"img_{i}.png")

    # Set 2: greenish variations
    dir_b = tmp_path / "set_b"
    dir_b.mkdir()
    for i in range(6):
        img = Image.new("RGB", (100, 100), color=(20, 200 + i * 5, 20))
        img.save(dir_b / f"img_{i}.png")

    files_a = sorted(dir_a.glob("*.png"))
    files_b = sorted(dir_b.glob("*.png"))

    res = evaluate_kid(
        files_a,
        files_b,
        extractor=extractor,
        subset_size=4,
        num_subsets=10,
        batch_size=4,
    )

    assert "kid_mean" in res
    assert "kid_std" in res
    assert res["samples_x"] == 6
    assert res["samples_y"] == 6
    assert res["kid_mean"] > 0
