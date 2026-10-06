from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from topeye.core.box_texture import build_box_atlas, face_corners, face_texture, pack_textures
from topeye.core.types import CameraCalib, FrameInfo, GTBox3D


@pytest.fixture
def fixture():
    # Camera at +x, looking along -x: image right is +y, image down is -z.
    matrix = np.eye(4)
    matrix[:3, :3] = [[0, 1, 0], [0, 0, -1], [-1, 0, 0]]
    matrix[:3, 3] = [0, 0, 6]
    calib = CameraCalib("front", np.array([[100., 0, 100], [0, 100, 100], [0, 0, 1]]),
                        matrix, 200, 200)
    frame = FrameInfo("f", "s", 0, Path("unused"), 0, np.eye(4),
                      {"front": (Path("unused"), 0, calib, np.linalg.inv(matrix))})
    box = GTBox3D(0, 0, 0, 2, 2, 2, 0, "car", "ann", "instance")
    y, x = np.indices((200, 200))
    image = np.dstack((x, y, ((x // 10 + y // 10) % 2) * 255)).astype(np.uint8)
    return frame, box, {"front": image}, {"front": np.full((50, 50), np.inf)}


@pytest.mark.parametrize("yaw", [0, 0.73, -1.2])
def test_face_normals_and_corner_contract(fixture, yaw):
    _, box, _, _ = fixture
    box = replace(box, yaw=yaw)
    faces = face_corners(box)
    for vertices in faces.values():
        normal = np.cross(vertices[1] - vertices[0], vertices[3] - vertices[0])
        assert np.dot(normal, vertices.mean(axis=0)) > 0
    if yaw == 0:
        np.testing.assert_array_equal(faces["front"],
                                      [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]])
        np.testing.assert_array_equal(faces["top"],
                                      [[-1, 1, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1]])


def test_checker_warp_under_two_pixels(fixture):
    frame, box, images, depths = fixture
    rgb, cam = face_texture(face_corners(box)["front"], frame, images, depths)
    assert cam == "front" and rgb.shape == (80, 80, 3)
    # Independent pinhole expectation: face projects to x,y in [80,120].
    y, x = np.indices((80, 80))
    expected_x, expected_y = 80 + x * 40 / 79, 80 + y * 40 / 79
    assert np.max(np.abs(rgb[:, :, 2] - expected_x)) < 2
    assert np.max(np.abs(rgb[:, :, 1] - expected_y)) < 2
    interior = (np.minimum(expected_x % 10, 10 - expected_x % 10) > 1) & (
        np.minimum(expected_y % 10, 10 - expected_y % 10) > 1)
    expected = ((expected_x // 10 + expected_y // 10) % 2) * 255
    np.testing.assert_array_equal(rgb[:, :, 0][interior], expected[interior])


def test_area_selection_then_occlusion_fallback(fixture):
    frame, box, images, depths = fixture
    path, ts, calib, pose = frame.cameras["front"]
    larger = replace(calib, K=np.array([[150., 0, 100], [0, 150, 100], [0, 0, 1]]))
    frame.cameras["larger"] = (path, ts, larger, pose)
    images["larger"] = images["front"]
    depths["larger"] = np.full((50, 50), np.inf)
    corners = face_corners(box)["front"]
    assert face_texture(corners, frame, images, depths)[1] == "larger"
    depths["larger"][:] = 4
    assert face_texture(corners, frame, images, depths)[1] == "front"
    depths["front"][:] = 4
    assert face_texture(corners, frame, images, depths) == (None, None)
    depths["front"][:] = 4.5  # exactly tolerance: not occluded
    assert face_texture(corners, frame, images, depths)[1] == "front"


def test_atlas_uv_fallback_and_outside(fixture):
    frame, box, images, depths = fixture
    atlas, meta = build_box_atlas(frame, [box, replace(box, cy=1000, annotation_token="off")],
                                  images, depths)
    assert set(meta["boxes"]) == {"gt:ann"}
    assert atlas.shape == (meta["atlas_h"], 2048, 4)
    faces = meta["boxes"]["gt:ann"]["faces"]
    rectangles = []
    for name, face in faces.items():
        x0, y0, x1, y1 = face["uv"]
        assert 2 <= x0 < x1 <= 2046 and 2 <= y0 < y1 <= len(atlas) - 2
        assert face["seen"] == (name == "front")
        assert np.all(atlas[y0:y1, x0:x1, 3] == 255)
        for a, b, c, d in rectangles:
            assert x1 <= a or c <= x0 or y1 <= b or d <= y0
        rectangles.append((x0, y0, x1, y1))
    x0, y0, x1, y1 = faces["front"]["uv"]
    average = atlas[y0:y1, x0:x1, :3].mean(axis=(0, 1)).astype(np.uint8)
    x, y, _, _ = faces["top"]["uv"]
    np.testing.assert_array_equal(atlas[y, x, :3], average)
    depths["front"][:] = 1
    atlas, meta = build_box_atlas(frame, [box], images, depths)
    assert all(not f["seen"] for f in meta["boxes"]["gt:ann"]["faces"].values())
    assert np.all(atlas[atlas[:, :, 3] > 0, :3] == 128)


def test_overflow_uniform_scale_and_padding():
    tiles = [np.full((256, 256, 3), 123, np.uint8)] * 200
    atlas, uvs = pack_textures(tiles)
    assert atlas.shape[0] <= 4096
    assert len({(c - a, d - b) for a, b, c, d in uvs}) == 1
    assert uvs[0][2] - uvs[0][0] < 256
    occupied = np.zeros(atlas.shape[:2], bool)
    for a, b, c, d in uvs:
        assert not occupied[b - 2:d + 2, a - 2:c + 2].any()
        occupied[b - 2:d + 2, a - 2:c + 2] = True
        assert np.all(atlas[b - 2:d + 2, a - 2:c + 2, :3] == 123)


def test_multiframe_rigid_sources_and_nonrigid(fixture, tmp_path):
    from topeye.core.box_texture import MultiFrameTextures

    frame, box, images, depth = fixture
    path = tmp_path / 'image.jpg'
    path.touch()
    frames, boxes, depths = [], {}, {}
    for i, yaw in enumerate((0, np.pi / 2, np.pi)):
        # Moving box and camera together retains a known relative viewing axis.
        calib = replace(frame.cameras['front'][2], T_lidar_cam=frame.cameras['front'][2]
                        .T_lidar_cam.copy())
        calib.T_lidar_cam[2, 3] += i
        frames.append(replace(frame, frame_id=f'f{i}', index=i,
                              cameras={'front': (path, 0, calib, np.eye(4))}))
        boxes[i] = {'instance': replace(box, cx=i, yaw=yaw, annotation_token=f'ann{i}')}
        depths[i] = depth
    sources = MultiFrameTextures(frames, boxes, depths, lambda i, n: (images[n], None),
                                 {'front': 1})
    _, meta = build_box_atlas(frames[1], [boxes[1]['instance']], images, depth, sources)
    faces = meta['boxes']['gt:ann1']['faces']
    assert {k: (v['src_frame'], v['src_dt']) for k, v in faces.items() if v['seen']} == {
        'front': ('f0', -1), 'right': ('f1', 0), 'back': ('f2', 1)}
    pedestrian = replace(boxes[1]['instance'], label='pedestrian')
    _, meta = build_box_atlas(frames[1], [pedestrian], images, depth, sources)
    assert [v['src_frame'] for v in meta['boxes']['gt:ann1']['faces'].values()
            if v['seen']] == ['f1']
    # Wrong source depth must veto f0 independently of current-frame depth.
    blocked = {**depths, 0: {'front': np.zeros((50, 50))}}
    sources = MultiFrameTextures(frames, boxes, blocked, lambda i, n: (images[n], None),
                                 {'front': 1})
    _, meta = build_box_atlas(frames[1], [boxes[1]['instance']], images, depth, sources)
    assert not meta['boxes']['gt:ann1']['faces']['front']['seen']


def test_multiframe_current_bias_and_target_dimensions(fixture, tmp_path):
    from topeye.core.box_texture import MultiFrameTextures

    frame, box, images, depth = fixture
    path = tmp_path / 'image.jpg'
    path.touch()
    calib = frame.cameras['front'][2]
    frames = [replace(frame, index=i, frame_id=f'f{i}',
                      cameras={'front': (path, 0, calib, np.eye(4))}) for i in range(12)]
    boxes = {i: {'instance': replace(box, annotation_token=f'a{i}', l=20 if i else 2)}
             for i in range(12)}
    depths = {i: depth for i in range(12)}
    sources = MultiFrameTextures(frames, boxes, depths, lambda i, n: (images[n], None),
                                 {'front': 1})
    current = sources.select(frames[0], box, 'front', face_corners(box)['front'])
    assert current[2:] == ('f0', 0)  # source l=20 must not push face behind camera
    depths[0] = {'front': np.zeros((50, 50))}
    sources.candidate.cache_clear()
    assert sources.select(frames[0], box, 'front', face_corners(box)['front'])[2] == 'f1'
    for i in range(11):
        depths[i] = {'front': np.zeros((50, 50))}
    sources.candidate.cache_clear()
    assert sources.select(frames[0], box, 'front', face_corners(box)['front'])[0] is None


@pytest.mark.parametrize('ratio, expected', [(1.1, 'f0'), (1.2, 'f0'), (1.3, 'f1')])
def test_multiframe_twenty_percent_bias(fixture, tmp_path, ratio, expected):
    from topeye.core.box_texture import MultiFrameTextures

    frame, box, images, depth = fixture
    path = tmp_path / 'image.jpg'
    path.touch()
    frames = [replace(frame, index=i, frame_id=f'f{i}') for i in range(2)]
    boxes = {i: {'instance': box} for i in range(2)}
    source = MultiFrameTextures(frames, boxes, {0: depth, 1: depth},
                                lambda i, n: (images[n], None), {'front': 1})
    # Isolate the exact tie/bias rule from float32 projected-area rounding.
    uv = np.float32([[80, 120], [120, 120], [120, 80], [80, 80]])
    source.candidate = lambda i, *args: (100 * (ratio if i else 1), 'front', uv)
    assert source.select(frames[0], box, 'front', face_corners(box)['front'])[2] == expected
