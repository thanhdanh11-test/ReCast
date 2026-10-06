"""Five outward-wound box faces, camera rectification and padded RGBA shelves."""

from dataclasses import replace
from functools import lru_cache

import cv2
import numpy as np

from topeye.core.geometry import project
from topeye.core.object_accum import track_sources


def face_corners(box):
    """c0 bottom-left through c3 top-left, viewed from outside (P05 §2)."""
    signs = {
        "front": [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)],
        "back": [(-1, 1, -1), (-1, -1, -1), (-1, -1, 1), (-1, 1, 1)],
        "left": [(1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1)],
        "right": [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)],
        "top": [(-1, 1, 1), (-1, -1, 1), (1, -1, 1), (1, 1, 1)],
    }
    c, s = np.cos(box.yaw), np.sin(box.yaw)
    rotation = np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])
    return {
        name: (np.array(vertices) * [box.l / 2, box.w / 2, box.h / 2]) @ rotation
        + [box.cx, box.cy, box.cz]
        for name, vertices in signs.items()
    }


def texture_size(corners):
    return tuple(int(np.clip(round(np.linalg.norm(corners[i] - corners[0]) * 40), 8, 256))
                 for i in (1, 3))


def inside(uv, z, image):
    return ((z > 0.5) & np.isfinite(uv).all(axis=1)
            & (uv[:, 0] >= 0) & (uv[:, 0] < image.shape[1])
            & (uv[:, 1] >= 0) & (uv[:, 1] < image.shape[0]))


def face_candidate(corners, frame, images, depth, angular=False):
    normal = np.cross(corners[1] - corners[0], corners[3] - corners[0])
    center = corners.mean(axis=0)
    samples = np.array([corners[0] + u * (corners[1] - corners[0])
                        + v * (corners[3] - corners[0])
                        for u in (0.25, 0.5, 0.75) for v in (0.25, 0.5, 0.75)])
    candidates = []
    for name, (_, _, calib, _) in frame.cameras.items():
        image = images.get(name)
        if image is None:
            continue
        camera_center = -calib.T_lidar_cam[:3, :3].T @ calib.T_lidar_cam[:3, 3]
        if np.dot(normal, camera_center - center) <= 0:
            continue
        uv, z = project(corners, calib.K, calib.T_lidar_cam)
        if not (z > 0.5).all() or not np.isfinite(uv).all():
            continue
        area = abs(cv2.contourArea(uv.astype(np.float32)))
        if area < 1e-6 or not inside(uv, z, image).any():
            continue
        sample_uv, sample_z = project(samples, calib.K, calib.T_lidar_cam)
        valid = inside(sample_uv, sample_z, image)
        pixels = (sample_uv[valid] / 4).astype(int)
        buffer = depth.get(name)
        if buffer is None:
            continue
        blocked = buffer[pixels[:, 1], pixels[:, 0]] < sample_z[valid] - 0.5
        if np.count_nonzero(blocked) > len(samples) / 2:
            continue
        cosine = np.dot(normal, camera_center - center) / (
            np.linalg.norm(normal) * np.linalg.norm(camera_center - center))
        candidates.append((area * cosine if angular else area, name, uv))
    return max(candidates, key=lambda candidate: candidate[0]) if candidates else None


def warp_face(corners, image, uv):
    width, height = texture_size(corners)
    target = np.float32([[0, height - 1], [width - 1, height - 1],
                         [width - 1, 0], [0, 0]])
    matrix = cv2.getPerspectiveTransform(uv.astype(np.float32), target)
    bgr = cv2.warpPerspective(image, matrix, (width, height),
                              borderMode=cv2.BORDER_REPLICATE)
    return bgr[:, :, ::-1]


def face_texture(corners, frame, images, depth):
    candidate = face_candidate(corners, frame, images, depth)
    if candidate is None:
        return None, None
    _, name, uv = candidate
    return warp_face(corners, images[name], uv), name


def pack_textures(textures):
    """Uniformly shrink on overflow; borders are replicated, UV excludes padding."""
    scale = 1.0
    while True:
        x = y = row_height = 0
        placements = []
        for texture in textures:
            height, width = texture.shape[:2]
            width, height = max(1, int(width * scale)), max(1, int(height * scale))
            if x + width + 4 > 2048:
                x, y, row_height = 0, y + row_height, 0
            placements.append((x + 2, y + 2, width, height))
            x += width + 4
            row_height = max(row_height, height + 4)
        total_height = max(1, y + row_height)
        if total_height <= 4096:
            break
        if all(width == height == 1 for _, _, width, height in placements):
            raise ValueError("Too many box faces for atlas")
        scale *= min(0.9, np.sqrt(4096 / total_height) * 0.95)
    atlas = np.zeros((total_height, 2048, 4), np.uint8)
    uvs = []
    for texture, (x, y, width, height) in zip(textures, placements, strict=True):
        rgb = cv2.resize(texture, (width, height), interpolation=cv2.INTER_AREA)
        rgba = np.dstack((rgb, np.full((height, width), 255, np.uint8)))
        atlas[y - 2:y + height + 2, x - 2:x + width + 2] = cv2.copyMakeBorder(
            rgba, 2, 2, 2, 2, cv2.BORDER_REPLICATE)
        uvs.append([x, y, x + width, y + height])
    return atlas, uvs


class MultiFrameTextures:
    """Scene-local candidate cache; no target-time depth or annotation-ID joins."""

    def __init__(self, frames, boxes_by_frame, depths, camera, gains):
        self.frames = frames
        self.boxes = boxes_by_frame
        self.depths = depths
        self.camera = camera
        self.gains = gains
        self.candidate = lru_cache(maxsize=None)(self._candidate)

    def _candidate(self, index, track, dimensions, face):
        frame = self.frames[index]
        box = replace(self.boxes[index][track], l=dimensions[0], w=dimensions[1], h=dimensions[2])
        # Selection needs image bounds, not decoded pixels; decode only the winning source.
        images = {name: np.broadcast_to(np.uint8(0), (cam[2].height, cam[2].width, 3))
                  for name, cam in frame.cameras.items() if cam[0].is_file()}
        return face_candidate(face_corners(box)[face], frame, images,
                              self.depths.get(index, {}), angular=True)

    def select(self, frame, box, face, corners):
        choices = []
        for source, _ in track_sources(self.frames, self.boxes, frame, box):
            candidate = self.candidate(source.index, box.instance_token,
                                       (box.l, box.w, box.h), face)
            if candidate is not None:
                score, name, uv = candidate
                choices.append((score * (1.2 if source.index == frame.index else 1),
                                source, name, uv))
        for _, source, name, uv in sorted(choices, key=lambda item: (item[0],
                                              item[1].index == frame.index), reverse=True):
            image = self.camera(source.index, name)[0]
            if image is None:
                continue
            corrected = cv2.convertScaleAbs(image, alpha=float(self.gains[name]))
            rgb = warp_face(corners, corrected, uv)
            return rgb, name, source.frame_id, source.index - frame.index
        return None, None, None, None


def build_box_atlas(frame, boxes, images, depth, sources=None):
    """Images are BGR with scene gains already applied; depths are WP4c 4px bins.

    Metadata ground_z is attached by the cache owner from BEVScene's height grid.
    GTBox3D identities use exactly the same namespace as the boxes API.
    """
    records, textures, references = {}, [], []
    for box in boxes:
        corners = face_corners(box)
        all_corners = np.concatenate(list(corners.values()))
        if not any(inside(*project(all_corners, camera[2].K, camera[2].T_lidar_cam),
                          images[name]).any()
                   for name, camera in frame.cameras.items() if name in images):
            continue
        sides = {name: (sources.select(frame, box, name, vertices) if sources else
                        (*face_texture(vertices, frame, images, depth), frame.frame_id, 0))
                 for name, vertices in corners.items() if name != "top"}
        seen = [value[0] for value in sides.values() if value[0] is not None]
        average = (np.concatenate([rgb.reshape(-1, 3) for rgb in seen]).mean(axis=0)
                   if seen else np.array([128, 128, 128]))
        faces = {}
        for name, vertices in corners.items():
            rgb, camera, src_frame, src_dt = sides.get(name, (None, None, None, None))
            visible = rgb is not None
            if rgb is None:
                width, height = texture_size(vertices)
                rgb = np.broadcast_to(average.astype(np.uint8), (height, width, 3)).copy()
            face = {"cam": camera, "seen": visible,
                    "src_frame": src_frame if visible else None,
                    "src_dt": src_dt if visible else None}
            faces[name] = face
            textures.append(rgb)
            references.append(face)
        records[f"gt:{box.annotation_token}"] = {"faces": faces}
    atlas, uvs = pack_textures(textures)
    for face, uv in zip(references, uvs, strict=True):
        face["uv"] = uv
    return atlas, {"atlas_w": atlas.shape[1], "atlas_h": atlas.shape[0], "boxes": records}
