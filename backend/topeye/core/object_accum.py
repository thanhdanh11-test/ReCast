"""Measured keyframe points aligned through each tracked object's local pose."""

import numpy as np

RIGID_LABELS = frozenset({"car", "truck", "bus", "trailer", "construction_vehicle",
                          "barrier", "traffic_cone"})


def rotation(box):
    c, s = np.cos(box.yaw), np.sin(box.yaw)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def crop_local(points, box):
    local = (points[:, :3] - [box.cx, box.cy, box.cz]) @ rotation(box)
    keep = ((np.abs(local[:, 0]) <= (box.l + .2) / 2)
            & (np.abs(local[:, 1]) <= (box.w + .2) / 2)
            & (local[:, 2] >= -box.h / 2 + .15) & (local[:, 2] <= box.h / 2))
    result = points[keep].copy()
    result[:, :3] = local[keep]
    return result


def track_sources(frames, boxes_by_frame, frame, box):
    for source in frames:
        if abs(source.index - frame.index) > 10:
            continue
        if source.index != frame.index and (box.label not in RIGID_LABELS
                                             or not box.instance_token):
            continue
        match = boxes_by_frame.get(source.index, {}).get(box.instance_token)
        if match is not None:
            yield source, match


def build_objects_dense(frame, boxes, frames, boxes_by_frame, points_by_frame):
    chunks, records, start = [], [], 0
    for box in boxes:
        candidates, distances, n_frames = [], [], 0
        for source, match in track_sources(frames, boxes_by_frame, frame, box):
            points = crop_local(points_by_frame[source.index], match)
            if not len(points):
                continue
            n_frames += 1
            candidates.append(points)
            distances.extend([abs(source.index - frame.index)] * len(points))
        if candidates:
            points = np.concatenate(candidates)
            order = np.lexsort((np.asarray(distances), points[:, 4] < 0))
            points = points[order]
            voxels = np.floor(points[:, :3] / .05).astype(np.int64)
            _, selected = np.unique(voxels, axis=0, return_index=True)
            points = points[np.sort(selected)]
            points[:, :3] = points[:, :3] @ rotation(box).T + [box.cx, box.cy, box.cz]
        else:
            points = np.empty((0, 7), dtype=np.float32)
        chunks.append(points)
        records.append({"id": f"gt:{box.annotation_token}", "track_key": box.instance_token,
                        "start": start, "count": len(points), "n_frames": n_frames,
                        "rigid": box.label in RIGID_LABELS})
        start += len(points)
    return (np.concatenate(chunks).astype("<f4") if chunks else np.empty((0, 7), "<f4"),
            {"objects": records})
