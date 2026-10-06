"""S9 geometry, atlas isolation, visibility and binary export regression tests."""

import json
import struct

import numpy as np
import pytest

from topeye.sim.texture_mesh import (
    build_static_mesh,
    export_textured,
    render_mesh,
    texture_mesh,
)


def view(x=0, z=0):
    pose = np.eye(4)
    pose[:3, 3] = [x, 0, z]
    return {"c2w": pose.tolist(), "K": [[40, 0, 32], [0, 40, 32], [0, 0, 1]],
            "width": 64, "height": 64, "split": "train"}


def inputs():
    V = np.array([[-1, -1, 5], [0, 1, 5], [1, -1, 5]], float)
    F = np.array([[0, 1, 2]])
    images = [np.full((64, 64, 3), c, np.uint8) for c in ([255, 0, 0], [0, 255, 0])]
    masks = [np.full((64, 64), 255, np.uint8) for _ in images]
    return V, F, images, masks


def test_best_view_prefers_frontal_plane():
    V, F, images, masks = inputs()
    result = texture_mesh(V, F, [view(2), view()], images, masks, atlas_px=64)
    assert result[4]["chosen_views"] == [1]
    assert result[4]["unseen_ratio"] == 0
    output, coverage, _ = render_mesh(*result[:4], view())
    assert coverage.sum() > 50
    assert (output[coverage] == [0, 255, 0]).all()


def test_occluded_triangle_cannot_take_foreground_view():
    V, F, images, masks = inputs()
    V = np.concatenate((V, V * [1, 1, .5]))
    F = np.array([[0, 1, 2], [3, 4, 5]])
    result = texture_mesh(V, F, [view()], images[:1], masks[:1], atlas_px=64)
    assert result[4]["chosen_views"] == [-1, 0]
    assert result[4]["unseen_ratio"] == .5


def test_patches_do_not_overlap_and_have_two_pixel_margin():
    V, F, images, masks = inputs()
    V = np.concatenate((V, V + [3, 0, 0]))
    F = np.array([[0, 1, 2], [3, 4, 5]])
    result = texture_mesh(V, F, [view()], images[:1], masks[:1], atlas_px=64)
    uv = result[2].reshape(-1, 3, 2)
    size, cell = result[4]["atlas_px"], result[4]["patch_px"]
    pixels = uv * size
    assert pixels[0, :, 0].max() < pixels[1, :, 0].min()
    assert pixels[0, :, 0].min() >= 2
    assert pixels[0, :, 0].max() <= cell - 2


def test_masked_view_and_test_split_are_rejected():
    V, F, images, masks = inputs()
    masks[0][:] = 0
    result = texture_mesh(V, F, [view()], images[:1], masks[:1], atlas_px=64)
    assert result[4]["unseen_ratio"] == 1
    with pytest.raises(ValueError, match="Test images"):
        texture_mesh(V, F, [dict(view(), split="test")], images[:1], masks[:1])


def test_export_glb_embeds_unlit_png(tmp_path):
    V, F, images, masks = inputs()
    result = texture_mesh(V, F, [view()], images[:1], masks[:1], atlas_px=64)
    path = tmp_path / "mesh.glb"
    export_textured(path, *result[:4])
    data = path.read_bytes()
    magic, version, length = struct.unpack("<III", data[:12])
    assert (magic, version, length) == (0x46546C67, 2, len(data))
    length, kind = struct.unpack("<II", data[12:20])
    document = json.loads(data[20:20 + length])
    assert kind == 0x4E4F534A
    assert document["extensionsUsed"] == ["KHR_materials_unlit"]
    assert document["accessors"][0]["count"] == 3
    assert b"\x89PNG" in data


def test_smoothing_keeps_shared_vertices_and_lidar_support():
    xyz = np.array([[0, 0, 0], [.2, 0, 0], [.4, 0, 0]])
    V, F = build_static_mesh(xyz)
    assert len(np.unique(V, axis=0)) == len(V)
    assert F.shape[1] == 3
    from scipy.spatial import cKDTree
    assert (cKDTree(xyz).query(V[F].mean(axis=1))[0] <= .5).all()


def test_near_plane_clipping_does_not_drop_visible_triangle():
    V = np.array([[-.1, -.1, -.1], [.3, -.1, 1], [0, .3, 1]])
    F = np.array([[0, 1, 2]])
    UV = np.full((3, 2), .5)
    output, coverage, _ = render_mesh(V, F, UV, np.full((8, 8, 3), 255, np.uint8), view())
    assert coverage.sum() > 50
    assert (output[coverage] == 255).all()


def test_dynamic_mask_inside_footprint_rejects_view():
    V, F, images, masks = inputs()
    # Lies in the triangle footprint but away from the four point probes.
    masks[0][27, 31] = 0
    result = texture_mesh(V, F, [view()], images[:1], masks[:1], atlas_px=64)
    assert result[4]["chosen_views"] == [-1]


def test_metrics_penalize_uncovered_black_pixels():
    from scripts.s9_evaluate import aggregate, masked_metrics
    target = np.full((16, 16, 3), 128, np.uint8)
    pred = target.copy()
    pred[:, 8:] = 0
    mask = np.ones((16, 16), bool)
    covered = mask.copy()
    covered[:, 8:] = False
    a = aggregate([masked_metrics(pred, target, covered)])
    b = aggregate([masked_metrics(pred, target, mask)])
    assert a["psnr"] == pytest.approx(120)
    assert a["ssim"] == pytest.approx(1)
    assert b["psnr"] < 10
    assert b["ssim"] < a["ssim"]
