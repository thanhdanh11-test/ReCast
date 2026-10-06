from dataclasses import replace
from types import SimpleNamespace

import numpy as np
import pytest

from topeye.core.object_accum import build_objects_dense, crop_local
from topeye.core.types import GTBox3D


def fixture():
    frames = [SimpleNamespace(index=i, frame_id=f'f{i}') for i in range(3)]
    box = GTBox3D(0, 0, 0, 2, 2, 2, 0, 'car', 'ann0', 'track')
    boxes = {i: {'track': replace(box, cx=i*3, cy=-i, yaw=i*np.pi/2,
                                 annotation_token=f'ann{i}')} for i in range(3)}
    points = {}
    for i in range(3):
        local = np.array([[.23 + i*.2, .31, .2, 1, 100+i, 0, 0],
                          [.3, .3, -.86, 1, 0, 0, 0]], dtype=np.float32)
        b = boxes[i]['track']
        if i == 1:
            local[:, :2] = np.column_stack((-local[:, 1], local[:, 0]))
        elif i == 2:
            local[:, :2] *= -1
        local[:, :3] += [b.cx, b.cy, b.cz]
        points[i] = local
    return frames, boxes, points


def test_moving_rotating_track_alignment_bottom_and_ids():
    frames, boxes, points = fixture()
    target = boxes[1]['track']
    dense, meta = build_objects_dense(frames[1], [target], frames, boxes, points)
    expected = np.array([[3-.31, -1+.23+i*.2, .2] for i in range(3)])
    assert len(dense) == 3
    assert max(min(np.linalg.norm(expected-p, axis=1)) for p in dense[:, :3]) < .01
    assert meta['objects'] == [{'id': 'gt:ann1', 'track_key': 'track', 'start': 0,
                               'count': 3, 'n_frames': 3, 'rigid': True}]
    assert dense.dtype == np.dtype('<f4')


@pytest.mark.parametrize('label', ['pedestrian', 'bicycle', 'motorcycle'])
def test_nonrigid_current_only(label):
    frames, boxes, points = fixture()
    dense, meta = build_objects_dense(frames[1], [replace(boxes[1]['track'], label=label)],
                                      frames, boxes, points)
    assert len(dense) == 1 and meta['objects'][0]['n_frames'] == 1
    assert not meta['objects'][0]['rigid']


def test_voxel_color_then_time_priority_and_window():
    frames, boxes, _ = fixture()
    box = boxes[0]['track']
    frames = [SimpleNamespace(index=i, frame_id=f'f{i}') for i in (0, 1, 10, 11)]
    boxes = {i: {'track': box} for i in (0, 1, 10, 11)}
    points = {i: np.array([[.211+i*.001, .211, .211, 1, -1 if i == 0 else i, 0, 0],
                           [.411+i*.001, .211, .211, 1, i, 0, 0]], np.float32)
              for i in (0, 1, 10, 11)}
    dense, meta = build_objects_dense(frames[0], [box], frames, boxes, points)
    assert sorted(dense[:, 4]) == [0, 1]
    assert meta['objects'][0]['n_frames'] == 3
    assert len(dense.tobytes()) == 28 * meta['objects'][0]['count']
    boxes[1] = {'other-track': replace(box, instance_token='other-track')}
    dense, _ = build_objects_dense(frames[0], [box], frames, boxes, points)
    assert sorted(dense[:, 4]) == [0, 10]


def test_crop_expansion_empty_and_contiguous_ranges():
    frames, boxes, points = fixture()
    box = boxes[0]['track']
    probe = np.array([[1.09, 0, 0, 1, 1, 1, 1], [1.11, 0, 0, 1, 1, 1, 1]], np.float32)
    assert len(crop_local(probe, box)) == 1
    other = replace(box, instance_token='absent', annotation_token='empty')
    dense, meta = build_objects_dense(frames[0], [box, other], frames, boxes, points)
    assert meta['objects'][1]['start'] == len(dense)
    assert meta['objects'][1]['count'] == meta['objects'][1]['n_frames'] == 0
    assert build_objects_dense(frames[0], [], frames, boxes, points)[0].shape == (0, 7)
