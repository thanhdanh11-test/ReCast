"""Geometry-only procedural environment extraction (SPEC-S11 §1).

Run separately before rendering: python -m topeye.sim.procedural_layout --scene SCENE.
The existing layout and its camera/actor contracts remain untouched.
"""

import argparse
import json
import zlib
from time import perf_counter

import cv2
import numpy as np
from scipy.ndimage import binary_closing
from scipy.ndimage import label as components
from scipy.spatial import cKDTree

from topeye.core.cache import write_json


def _xyz(xyz):
    points = np.asarray(xyz, dtype=float)
    if points.ndim != 2 or points.shape[1] != 3 or not np.isfinite(points).all():
        raise ValueError("xyz must be finite Nx3")
    return points


def _bounds(bounds):
    values = np.asarray([bounds[k] for k in ('xmin', 'ymin', 'xmax', 'ymax')]
                        if isinstance(bounds, dict) else bounds, float)
    if values.shape != (4,) or not np.isfinite(values).all() or (values[2:] <= values[:2]).any():
        raise ValueError("bounds must be finite xmin,ymin,xmax,ymax with positive extent")
    return values


def classify_static(xyz, sweep_index):
    """0 other, 1 vertical facade, 2 scattered canopy, 3 slender upright.

    PCA is evaluated on 25 cm occupied cells to avoid sweep-density bias.
    Neighbours span 1.5 m; sparse cells and horizontal planes stay unclassified.
    """
    points = _xyz(xyz)
    sweeps = np.asarray(sweep_index)
    if sweeps.shape != (len(points),) or not np.issubdtype(sweeps.dtype, np.integer):
        raise ValueError("sweep_index must contain one integer per point")
    result = np.zeros(len(points), np.uint8)
    if len(points) < 8:
        return result
    cells, inverse = np.unique(np.floor(points / 0.25).astype(np.int64),
                               axis=0, return_inverse=True)
    centers = (cells + 0.5) * 0.25
    tree = cKDTree(centers)
    distance, indices = tree.query(centers, k=min(24, len(centers)), distance_upper_bound=1.5)
    base = float(np.quantile(points[:, 2], 0.03))
    cell_labels = np.zeros(len(cells), np.uint8)
    for start in range(0, len(cells), 4096):
        idx, dist = indices[start:start + 4096], distance[start:start + 4096]
        valid = np.isfinite(dist)
        neighbours = centers[np.minimum(idx, len(centers) - 1)]
        count = valid.sum(axis=1)
        mean = (neighbours * valid[..., None]).sum(axis=1) / np.maximum(count[:, None], 1)
        centered = (neighbours - mean[:, None]) * valid[..., None]
        covariance = np.einsum('nki,nkj->nij', centered, centered) / np.maximum(count[:, None, None], 1)
        eigen, vectors = np.linalg.eigh(covariance)
        denom = np.maximum(eigen[:, 2], 1e-10)
        planar = (eigen[:, 1] - eigen[:, 0]) / denom
        linear = (eigen[:, 2] - eigen[:, 1]) / denom
        scattered = eigen[:, 0] / denom
        heights = centers[start:start + len(idx), 2] - base
        enough = count >= 8
        building = enough & (planar > 0.45) & (np.abs(vectors[:, 2, 0]) < 0.3) & (heights > 2.5)
        canopy = enough & (scattered > 0.08) & (heights > 2) & (heights < 20)
        pole = enough & (linear > 0.7) & (np.abs(vectors[:, 2, 2]) > 0.9) & (heights > 1)
        local = cell_labels[start:start + len(idx)]
        local[building], local[canopy], local[pole] = 1, 2, 3
    return cell_labels[inverse]


def _selected(xyz, labels, kind):
    points = _xyz(xyz)
    labels = np.asarray(labels)
    if labels.shape != (len(points),):
        raise ValueError("labels must contain one label per point")
    return points[labels == kind]


def _groups(points, resolution, close=0):
    if not len(points):
        return []
    padding = max(close, 1)
    low = np.floor(points[:, :2].min(axis=0) / resolution).astype(int) - padding
    cells = np.floor(points[:, :2] / resolution).astype(int) - low
    shape = cells.max(axis=0) + padding + 1
    if np.prod(shape) > 4_000_000:
        raise ValueError("point extent exceeds procedural occupancy budget")
    occupied = np.zeros(tuple(shape[::-1]), bool)
    occupied[cells[:, 1], cells[:, 0]] = True
    if close:
        occupied = binary_closing(occupied, structure=np.ones((close, close)))
    regions, count = components(occupied, np.ones((3, 3)))
    membership = regions[cells[:, 1], cells[:, 0]]
    return [(points[membership == i], (regions == i).astype(np.uint8), low)
            for i in range(1, count + 1) if np.count_nonzero(membership == i) >= 8]


def building_footprints(xyz, labels, bounds):
    points = _selected(xyz, labels, 1)
    extent = _bounds(bounds)
    points = points[((points[:, :2] >= extent[:2]) & (points[:, :2] <= extent[2:])).all(axis=1)]
    result = []
    ground = float(np.quantile(_xyz(xyz)[:, 2], 0.03)) if len(xyz) else 0
    for group, occupancy, low in _groups(points, 0.5, close=5):
        if len(group) < 32 or np.ptp(group[:, :2], axis=0).max() < 3.2:
            continue
        contours, _ = cv2.findContours(occupancy, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour = max(contours, key=cv2.contourArea)
        polygon = cv2.approxPolyDP(contour, 1.0, True).reshape(-1, 2)
        if len(polygon) < 3 or cv2.contourArea(polygon) < 4:
            # A single observed wall has no area: give it a measured 2 m rear depth.
            rectangle = cv2.minAreaRect(group[:, :2].astype(np.float32))
            (cx, cy), (w, h), angle = rectangle
            polygon = cv2.boxPoints(((cx, cy), (max(w, 2), max(h, 2)), angle))
        else:
            polygon = (polygon + low + 0.5) * 0.5
        polygon = np.clip(polygon, extent[:2], extent[2:])
        top = float(group[:, 2].max())
        seed = zlib.crc32(np.round(polygon, 2).astype('<f8').tobytes())
        extra = int(np.random.default_rng(seed).integers(1, 5)) * 3.2
        result.append({'polygon': polygon.tolist(), 'base_z': ground,
                       'observed_top_z': top, 'height': max(top - ground, 3) + extra,
                       'height_source': 'estimated'})
    return result


def vegetation_instances(xyz, labels):
    points = _selected(xyz, labels, 2)
    ground = float(np.quantile(_xyz(xyz)[:, 2], 0.03)) if len(xyz) else 0
    result = []
    for group, _, _ in _groups(points, 1.5):
        # Split long connected tree lines into crowns at measured occupied cells.
        keys = np.floor(group[:, :2] / 5).astype(int)
        for key in np.unique(keys, axis=0):
            crown = group[(keys == key).all(axis=1)]
            if len(crown) < 12:
                continue
            center = np.median(crown[:, :2], axis=0)
            radius = float(np.clip(np.quantile(np.linalg.norm(crown[:, :2] - center, axis=1), .9), .8, 3.5))
            result.append({'x': float(center[0]), 'y': float(center[1]), 'z': ground,
                           'height': float(np.clip(crown[:, 2].max() - ground, 3, 20)),
                           'crown_radius': radius})
    return result


def pole_instances(xyz, labels):
    points = _selected(xyz, labels, 3)
    ground = float(np.quantile(_xyz(xyz)[:, 2], 0.03)) if len(xyz) else 0
    result = []
    for group, _, _ in _groups(points, .5):
        if np.ptp(group[:, :2], axis=0).max() > 1.2 or np.ptp(group[:, 2]) < 1.5:
            continue
        center = np.median(group[:, :2], axis=0)
        result.append({'x': float(center[0]), 'y': float(center[1]), 'z': ground,
                       'height': max(float(group[:, 2].max() - ground), 3)})
    return result


def road_edges(drivable, bounds):
    raster = np.asarray(drivable)
    extent = _bounds(bounds)
    if raster.ndim != 2 or not raster.size:
        raise ValueError("drivable must be a nonempty 2D raster")
    contours, _ = cv2.findContours((raster > 0).astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    result = []
    scale = (extent[2:] - extent[:2]) / np.array(raster.shape[::-1])
    for contour in contours:
        if cv2.arcLength(contour, True) * min(scale) < 4:
            continue
        poly = cv2.approxPolyDP(contour, .3 / max(scale), True).reshape(-1, 2)
        world = np.column_stack((extent[0] + (poly[:, 0] + .5) * scale[0],
                                 extent[3] - (poly[:, 1] + .5) * scale[1]))
        result.append(np.vstack((world, world[:1])).tolist())
    return result


def main(argv=None):
    from topeye.config import load_config
    from topeye.core.adapters.nuscenes import NuScenesAdapter
    from topeye.sim.cli import scene_dir, sim_root
    from topeye.sim.layout import read_ply
    from topeye.sim.static_map import static_points

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', required=True)
    parser.add_argument('--config', default='config.toml')
    args = parser.parse_args(argv)
    started = perf_counter()
    directory = scene_dir(sim_root(args.config), args.scene)
    layout = json.loads((directory / 'layout.json').read_text())
    config = load_config(args.config)
    points, _, sweep = static_points(NuScenesAdapter(config.nusc_root), args.scene)
    bounds = _bounds(layout['bounds'])
    inside = ((points[:, :2] >= bounds[:2]) & (points[:, :2] <= bounds[2:])).all(axis=1)
    points, sweep = points[inside], sweep[inside]
    ground, _, _ = read_ply(directory / layout["ground"]["mesh"])
    ground_tree = cKDTree(ground[:, :2])
    _, near = ground_tree.query(points[:, :2])
    normalized = points.copy()
    normalized[:, 2] -= ground[near, 2]
    labels = classify_static(normalized, sweep)
    raster = cv2.imread(str(directory / layout['ground']['drivable']), cv2.IMREAD_GRAYSCALE)
    result = {'version': 1, 'scene': args.scene,
              'buildings': building_footprints(points, labels, bounds),
              'vegetation': vegetation_instances(points, labels),
              'poles': pole_instances(points, labels), 'road_edges': road_edges(raster, bounds),
              'checks': {'static_points': len(points),
                         'classes': np.bincount(labels, minlength=4).tolist(),
                         'build_s': round(perf_counter() - started, 3)}}
    for building in result['buildings']:
        center = np.mean(building['polygon'], axis=0)
        _, nearest = ground_tree.query(center)
        base = float(ground[nearest, 2])
        extra = building['height'] - max(building['observed_top_z'] - building['base_z'], 3)
        building['base_z'] = base
        building['height'] = max(building['observed_top_z'] - base, 3) + extra
    for kind in ('vegetation', 'poles'):
        for item in result[kind]:
            _, nearest = ground_tree.query([item['x'], item['y']])
            base = float(ground[nearest, 2])
            item['height'] = max(item['z'] + item['height'] - base, 3)
            item['z'] = base
    result['checks']['build_s'] = round(perf_counter() - started, 3)
    write_json(directory / 'procedural.json', result)
    print(json.dumps({**result['checks'], 'buildings': len(result['buildings']),
                      'trees': len(result['vegetation']), 'poles': len(result['poles'])}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
