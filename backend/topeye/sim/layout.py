"""Real scene -> Blender-ready layout: static map, ground, rasters, actors (SPEC-S1)."""

import logging
import struct
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np

from topeye.core.adapters.base import DatasetError
from topeye.core.bev import transform
from topeye.core.cache import atomic_write, write_json
from topeye.core.geometry import project
from topeye.core.ground import cell_quantile, ground_mask
from topeye.sim.camera import blender_camera
from topeye.sim.ground_surface import ground_surface
from topeye.sim.static_map import static_points, static_voxels

logger = logging.getLogger(__name__)

LAYOUT_VERSION = 1
CLASSES = ["car", "truck", "bus", "trailer", "construction_vehicle", "pedestrian",
           "motorcycle", "bicycle", "barrier", "traffic_cone"]
LIDAR = {"rings": 32, "elev_min_deg": -30.67, "elev_max_deg": 10.67,
         "azimuth_steps": 1080, "max_range_m": 70.0}
GROUND_RES_M, TEX_RES_M, MAP_RES_M = 0.5, 0.1, 0.2
VOXEL_M, MIN_SWEEPS = 0.2, 3
EGO_RADIUS_M, TRAJECTORY_MARGIN_M = 2.5, 80.0
PAINT_WINDOW_M = 3.0
# Ground points must lie in this height band below the sensor and within this range:
# segmentation labels overpass ceilings as ground on some sweeps (scene-0061: 49 m spikes).
GROUND_MIN_Z_LIDAR, GROUND_MAX_Z_LIDAR, GROUND_RANGE_M = -4.0, -1.0, 40.0
MIN_EGO_ON_DRIVABLE = 0.9


def world_yaw(T_world_lidar, yaw):
    return float(yaw + np.arctan2(T_world_lidar[1, 0], T_world_lidar[0, 0]))


def box_to_world(box, T_world_lidar):
    center = transform(np.array([[box.cx, box.cy, box.cz]]), T_world_lidar)[0]
    return center.tolist(), world_yaw(T_world_lidar, box.yaw)


def write_ply(path, vertices, faces, colors=None):
    """Binary little-endian PLY (01-CONTRACTS §4); faces are index rows of equal length."""
    vertices = np.asarray(vertices, np.float64).reshape(-1, 3)
    faces = np.asarray(faces, np.int64).reshape(len(faces), -1)
    fields = [("x", "<f4"), ("y", "<f4"), ("z", "<f4")]
    header = ["ply", "format binary_little_endian 1.0", f"element vertex {len(vertices)}",
              "property float x", "property float y", "property float z"]
    if colors is not None:
        fields += [("red", "u1"), ("green", "u1"), ("blue", "u1")]
        header += ["property uchar red", "property uchar green", "property uchar blue"]
    header += [f"element face {len(faces)}", "property list uchar int vertex_indices",
               "end_header"]
    vertex = np.empty(len(vertices), fields)
    vertex["x"], vertex["y"], vertex["z"] = vertices.T
    if colors is not None:
        colors = np.asarray(colors).reshape(-1, 3)
        vertex["red"], vertex["green"], vertex["blue"] = colors.T
    corners = faces.shape[1] if len(faces) else 3
    face = np.empty(len(faces), [("n", "u1"), ("idx", "<i4", (corners,))])
    face["n"] = corners
    face["idx"] = faces
    data = ("\n".join(header) + "\n").encode() + vertex.tobytes() + face.tobytes()
    atomic_write(path, data)


def read_ply(path):
    """(vertices Nx3 float64, faces MxK int64, colors Nx3 uint8 | None) from write_ply output."""
    data = Path(path).read_bytes()
    end = data.index(b"end_header\n") + len(b"end_header\n")
    header = data[:end].decode().splitlines()
    count = {line.split()[1]: int(line.split()[2]) for line in header
             if line.startswith("element")}
    has_color = "property uchar red" in header
    fields = [("x", "<f4"), ("y", "<f4"), ("z", "<f4")]
    if has_color:
        fields += [("red", "u1"), ("green", "u1"), ("blue", "u1")]
    vertex = np.frombuffer(data, fields, count["vertex"], end)
    offset = end + vertex.nbytes
    corners = data[offset] if count["face"] else 3
    face = np.frombuffer(data, [("n", "u1"), ("idx", "<i4", (corners,))], count["face"], offset)
    vertices = np.column_stack((vertex["x"], vertex["y"], vertex["z"])).astype(np.float64)
    colors = (np.column_stack((vertex["red"], vertex["green"], vertex["blue"]))
              if has_color else None)
    return vertices, face["idx"].astype(np.int64), colors


# Outward quads per axis direction, as corner offsets of a unit voxel (counter-clockwise).
_FACES = {
    (1, 0, 0): [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
    (-1, 0, 0): [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
    (0, 1, 0): [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
    (0, -1, 0): [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
    (0, 0, 1): [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
    (0, 0, -1): [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
}


def voxel_mesh(keys, colors, voxel_m=VOXEL_M):
    """Exposed surface quads of occupied voxels (integer keys); per-face voxel colour."""
    keys, colors = np.asarray(keys, np.int64).reshape(-1, 3), np.asarray(colors).reshape(-1, 3)
    if not len(keys):
        return np.empty((0, 3)), np.empty((0, 4), int), np.empty((0, 3), int)
    occupied = set(map(tuple, keys))
    vertices, faces, face_colors = [], [], []
    for direction, corners in _FACES.items():
        exposed = np.array([tuple(n) not in occupied for n in keys + direction], bool)
        if not exposed.any():
            continue
        base = keys[exposed]
        start = sum(len(v) for v in vertices)
        quad = (base[:, None, :] + np.array(corners)[None]) * voxel_m
        vertices.append(quad.reshape(-1, 3))
        faces.append(start + np.arange(len(base) * 4).reshape(-1, 4))
        face_colors.append(np.repeat(colors[exposed], 4, axis=0))
    return np.concatenate(vertices), np.concatenate(faces), np.concatenate(face_colors)


def heightfield_mesh(grid, bounds, res_m=GROUND_RES_M):
    xmin, ymin = bounds[0], bounds[1]
    valid = np.isfinite(grid)
    ids = np.full(grid.shape, -1, np.int64)
    ids[valid] = np.arange(valid.sum())
    rows, cols = np.nonzero(valid)
    vertices = np.column_stack((xmin + (cols + 0.5) * res_m, ymin + (rows + 0.5) * res_m,
                                grid[valid]))
    a, b = ids[:-1, :-1], ids[:-1, 1:]
    c, d = ids[1:, 1:], ids[1:, :-1]
    quads = np.stack((a, b, c, d), axis=-1).reshape(-1, 4)
    return vertices, quads[(quads >= 0).all(axis=1)]


def raster_shape(bounds, res_m=TEX_RES_M):
    xmin, ymin, xmax, ymax = bounds
    return int(np.ceil((ymax - ymin) / res_m)), int(np.ceil((xmax - xmin) / res_m))


def paint_raster(points, bounds, drivable=None, res_m=TEX_RES_M, window_m=PAINT_WINDOW_M):
    """Road paint: 0.9-quantile ground intensity per 0.1 m cell minus its local mean.

    Markings are local bright stripes, so contrast against a window_m neighbourhood (not a
    scene-wide scale) rejects large bright surfaces; paint is kept only on drivable cells.
    """
    height, width = raster_shape(bounds, res_m)
    u = np.floor((points[:, 0] - bounds[0]) / res_m).astype(int)
    v = np.floor((bounds[3] - points[:, 1]) / res_m).astype(int)
    valid = (u >= 0) & (u < width) & (v >= 0) & (v < height)
    cells = cell_quantile(v[valid] * width + u[valid], points[valid, 3].astype(np.float32),
                          width * height, 0.9).reshape(height, width)
    observed = np.isfinite(cells)
    if not observed.any():
        return np.zeros((height, width), np.uint8)
    size = 2 * round(window_m / res_m / 2) + 1
    weight = cv2.blur(observed.astype(np.float32), (size, size))
    total = cv2.blur(np.where(observed, cells, 0).astype(np.float32), (size, size))
    contrast = np.where(observed, cells - total / np.maximum(weight, 1e-6), 0)
    positive = contrast[contrast > 0]
    scale = np.percentile(positive, 99) if len(positive) else 1.0
    paint = np.clip(contrast / max(scale, 1e-6), 0, 1) * 255
    if drivable is not None:
        paint[drivable == 0] = 0
    return paint.astype(np.uint8)


def drivable_coverage(grid, bounds, drivable, res_m=GROUND_RES_M):
    """Fraction of drivable ground-grid cells (sampled at cell centres) that have a height."""
    rows, cols = np.indices(grid.shape)
    xy = np.column_stack((bounds[0] + (cols.ravel() + 0.5) * res_m,
                          bounds[1] + (rows.ravel() + 0.5) * res_m))
    road = sample_raster(drivable, bounds, xy) > 0
    return round(float(np.isfinite(grid.ravel()[road]).mean()), 4) if road.any() else 1.0


def png_height(path):
    with open(path, "rb") as stream:
        header = stream.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise DatasetError(f"Not a PNG raster: {path}")
    return struct.unpack(">I", header[20:24])[0]


def drivable_raster(map_path, origin, bounds, res_m=TEX_RES_M):
    """Resample the nuScenes semantic_prior raster (0.1 m/px, row 0 at max global y)."""
    full_height_m = png_height(map_path) * 0.1
    image = cv2.imread(str(map_path), cv2.IMREAD_REDUCED_GRAYSCALE_2)
    if image is None:
        raise DatasetError(f"Cannot read map raster {map_path}")
    height, width = raster_shape(bounds, res_m)
    gx = origin[0] + bounds[0] + (np.arange(width) + 0.5) * res_m
    gy = origin[1] + bounds[3] - (np.arange(height) + 0.5) * res_m
    cols = np.floor(gx / MAP_RES_M).astype(int)
    rows = np.floor((full_height_m - gy) / MAP_RES_M).astype(int)
    inside_c = (cols >= 0) & (cols < image.shape[1])
    inside_r = (rows >= 0) & (rows < image.shape[0])
    result = np.zeros((height, width), np.uint8)
    block = image[np.clip(rows, 0, image.shape[0] - 1)][:, np.clip(cols, 0, image.shape[1] - 1)]
    mask = inside_r[:, None] & inside_c[None, :]
    result[mask] = np.where(block[mask] > 0, 255, 0)
    return result


def sample_raster(raster, bounds, xy, res_m=TEX_RES_M):
    u = np.floor((xy[:, 0] - bounds[0]) / res_m).astype(int)
    v = np.floor((bounds[3] - xy[:, 1]) / res_m).astype(int)
    inside = (u >= 0) & (u < raster.shape[1]) & (v >= 0) & (v < raster.shape[0])
    values = np.zeros(len(xy), raster.dtype)
    values[inside] = raster[v[inside], u[inside]]
    return values


def frame_cameras(frame):
    result = {}
    for name, (_, _, calib, world_cam) in sorted(frame.cameras.items()):
        result[name] = {
            "width": calib.width, "height": calib.height, "K": calib.K.tolist(),
            "T_world_cam": world_cam.tolist(),
            "blender": blender_camera(calib.K, calib.width, calib.height, world_cam),
        }
    return result


def selftest_points(frame, static_points, count=50, seed=0):
    """World points visible in CAM_FRONT with their reference projection (01 §2)."""
    name = "CAM_FRONT" if "CAM_FRONT" in frame.cameras else min(frame.cameras)
    _, _, calib, world_cam = frame.cameras[name]
    uv, depth = project(static_points, calib.K, np.linalg.inv(world_cam))
    inside = (depth > 1) & (uv[:, 0] >= 0) & (uv[:, 0] < calib.width) & (uv[:, 1] >= 0) & (
        uv[:, 1] < calib.height)
    indices = np.flatnonzero(inside)
    indices = np.random.default_rng(seed).choice(indices, min(count, len(indices)),
                                                 replace=False)
    return {"camera": name, "frame": frame.index, "points": static_points[indices].tolist(),
            "uv": uv[indices].tolist()}


def collect_actors(adapter, frames):
    actors = {}
    for frame in frames:
        for box in adapter.gt_boxes(frame) or []:
            if box.label not in CLASSES:
                continue
            center, yaw = box_to_world(box, frame.T_world_lidar)
            actor = actors.setdefault(box.instance_token, {
                "track": box.instance_token, "label": box.label,
                "size": [box.l, box.w, box.h], "keys": []})
            actor["keys"].append({"frame": frame.index, "center": center, "yaw": yaw})
    return sorted(actors.values(), key=lambda actor: actor["track"])


def build_layout(adapter, scene, out_dir, frames=None):
    started = perf_counter()
    out_dir = Path(out_dir)
    keyframes = adapter.frames(scene)
    if frames is not None:
        keyframes = [frame for frame in keyframes if frame.index in set(frames)]
    if not keyframes:
        raise ValueError(f"No keyframes selected for {scene}")
    origin = adapter.scene_origin(scene)

    static_xyz, static_rgb, static_sweep = static_points(adapter, scene,
                                                         ego_radius_m=EGO_RADIUS_M)

    ground, skipped = [], 0
    for sweep in adapter.sweep_frames(scene):
        try:
            points = adapter.load_points(sweep)
        except DatasetError as exc:
            logger.warning("Skip sweep %s: %s", sweep.frame_id, exc)
            skipped += 1
            continue
        radius = np.linalg.norm(points[:, :2], axis=1)
        points = points[ground_mask(points) & (radius >= EGO_RADIUS_M) & (radius <= GROUND_RANGE_M)
                        & (points[:, 2] >= GROUND_MIN_Z_LIDAR) & (points[:, 2] <= GROUND_MAX_Z_LIDAR)]
        ground.append(np.column_stack((transform(points, sweep.T_world_lidar), points[:, 3])))
    ground = np.concatenate(ground)

    trajectory = np.array([frame.T_world_lidar[:3, 3] for frame in keyframes])
    low = np.maximum(ground[:, :2].min(axis=0), trajectory[:, :2].min(axis=0) - TRAJECTORY_MARGIN_M)
    high = np.minimum(ground[:, :2].max(axis=0), trajectory[:, :2].max(axis=0) + TRAJECTORY_MARGIN_M)
    bounds = (float(low[0]), float(low[1]), float(high[0]), float(high[1]))

    map_info = adapter.scene_map(scene)
    if map_info is None:
        logger.warning("No semantic_prior raster for %s; drivable = everywhere", scene)
        drivable = np.full(raster_shape(bounds), 255, np.uint8)
    else:
        drivable = drivable_raster(map_info[1], origin, bounds)
    atomic_write(out_dir / "ground_drivable.png", cv2.imencode(".png", drivable)[1].tobytes())
    paint = paint_raster(ground, bounds, drivable)
    atomic_write(out_dir / "ground_paint.png", cv2.imencode(".png", paint)[1].tobytes())

    grid = ground_surface(ground, bounds, drivable, GROUND_RES_M, TEX_RES_M)
    vertices, quads = heightfield_mesh(grid, bounds)
    write_ply(out_dir / "ground.ply", vertices, quads)
    in_bounds = ((static_xyz[:, :2] >= low) & (static_xyz[:, :2] <= high)).all(axis=1)
    keys, colors = static_voxels(static_xyz[in_bounds], static_rgb[in_bounds],
                                 static_sweep[in_bounds], VOXEL_M, MIN_SWEEPS)
    vertices, quads, face_colors = voxel_mesh(keys, colors)
    write_ply(out_dir / "static.ply", vertices, quads, face_colors)
    on_drivable = float(np.mean(sample_raster(drivable, bounds, trajectory[:, :2]) > 0))

    layout = {
        "version": LAYOUT_VERSION,
        "scene": scene,
        "origin_global": origin.tolist(),
        "map": None if map_info is None else {
            "location": map_info[0], "raster": str(map_info[1].relative_to(adapter.root)),
            "res_m": MAP_RES_M},
        "bounds": dict(zip(("xmin", "ymin", "xmax", "ymax"), bounds)),
        "ground": {"mesh": "ground.ply", "res_m": GROUND_RES_M, "paint": "ground_paint.png",
                   "drivable": "ground_drivable.png", "tex_res_m": TEX_RES_M},
        "static": {"mesh": "static.ply", "voxel_m": VOXEL_M, "min_sweeps": MIN_SWEEPS},
        "lidar": LIDAR,
        "frames": [{"index": frame.index, "timestamp_us": frame.lidar_ts_us,
                    "T_world_lidar": frame.T_world_lidar.tolist(),
                    "cameras": frame_cameras(frame)} for frame in keyframes],
        "actors": collect_actors(adapter, keyframes),
        "selftest": selftest_points(keyframes[0], static_xyz),
        "checks": {"ego_on_drivable": on_drivable, "skipped_sweeps": skipped,
                   "static_sweeps_used": len(np.unique(static_sweep)),
                   "static_voxels": len(keys),
                   "ground_drivable_coverage": drivable_coverage(grid, bounds, drivable),
                   "build_s": round(perf_counter() - started, 2)},
    }
    write_json(out_dir / "layout.json", layout)
    return layout
