"""S12 environment placement and exclusion contracts (no Blender dependency)."""
import math
import re
from itertools import pairwise
from pathlib import PurePosixPath

import numpy as np

LABEL_NAMES = re.compile(r"(?:^|[^a-z])(?:car|vehicle|bus|truck|person|people|human|bike|bicycle|motor\w*|cone|barrier|pedestrian|trailer)(?:$|[^a-z])", re.IGNORECASE)
REQUIRED = {'asset_id', 'kind', 'file', 'native_size', 'source_url', 'license', 'author',
            'contains_label_classes', 'forward_axis', 'up_axis', 'polycount'}


def label_name(name):
    # Imported meshes commonly use CamelCase names such as CarBody.
    return LABEL_NAMES.search(re.sub(r'([a-z])([A-Z])', r'\1_\2', name))


def validate_asset(entry, names=()):
    """Reject incomplete, unlicensed, unsafe or label-bearing environment models."""
    if not isinstance(entry, dict):
        raise TypeError('environment entry must be a dictionary')
    if not REQUIRED <= entry.keys():
        raise ValueError('incomplete environment manifest')
    if not isinstance(entry['asset_id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]+', entry['asset_id']):
        raise ValueError('invalid asset_id')
    if entry['kind'] not in ('building', 'tree', 'lamp', 'sign', 'prop'):
        raise ValueError('invalid environment kind')
    if entry['contains_label_classes'] != [] or any(label_name(n) for n in names):
        raise ValueError('environment contains label classes')
    path = PurePosixPath(entry['file'])
    if path.is_absolute() or '..' in path.parts or not path.parts or '\\' in entry['file']:
        raise ValueError('unsafe environment path')
    if entry['license'] not in ('CC0', 'CC-BY', 'CC-BY-4.0') or not entry['source_url'] or not entry['author']:
        raise ValueError('environment license/attribution required')
    size = np.asarray(entry['native_size'], float)
    if size.shape != (3,) or not np.isfinite(size).all() or (size <= 0).any():
        raise ValueError('invalid native_size')
    if entry['forward_axis'] != '+X' or entry['up_axis'] != '+Z':
        raise ValueError('environment must be normalized +X/+Z')
    if isinstance(entry['polycount'], bool) or not isinstance(entry['polycount'], int) or entry['polycount'] <= 0:
        raise ValueError('invalid polycount')
    if 'collision_parts' in entry or 'canopy_min_z' in entry:
        parts = entry.get('collision_parts')
        if entry['kind'] != 'tree' or not isinstance(parts, list) or not parts:
            raise ValueError('invalid tree collision metadata')
        for part in parts:
            box = np.asarray([part['min'], part['max']], float)
            if (box.shape != (2, 3) or not np.isfinite(box).all()
                    or np.any(box[1] < box[0]) or box[0, 2] < -.01
                    or box[1, 2] > size[2] + .01
                    or np.any(np.abs(box[:, :2]) > size[:2] / 2 + .01)):
                raise ValueError('invalid collision bounds')
        canopy = entry.get('canopy_min_z')
        if not isinstance(canopy, (int, float)) or not math.isfinite(canopy) or not 0 <= canopy <= size[2]:
            raise ValueError('invalid canopy_min_z')
    return entry


def collision_geometry(triangles):
    """Conservative 0.5 m horizontal slabs; every triangle is represented.

    XY bounds include the entire triangle intersecting a slab, deliberately
    overestimating long faces. No material/name/opacity can omit geometry.
    """
    triangles = np.asarray(triangles, float)
    if triangles.ndim != 3 or triangles.shape[1:] != (3, 3) or not len(triangles) or not np.isfinite(triangles).all():
        raise ValueError('invalid collision triangles')
    low, high = triangles.min(1), triangles.max(1)
    bottom, top = float(low[:, 2].min()), float(high[:, 2].max())
    parts = []
    for z in np.arange(bottom, top, .5):
        end = min(z + .5, top)
        selected = (low[:, 2] <= end) & (high[:, 2] >= z)
        if selected.any():
            a, b = low[selected].min(0), high[selected].max(0)
            a[2], b[2] = max(z, a[2]), min(end, b[2])
            parts.append({'min': a.tolist(), 'max': b.tolist()})
    if not parts:
        raise ValueError('tree has no vertical extent')
    span = high.max(0) - low.min(0)
    # Descriptive only. Actual clearance uses each slab's measured bottom.
    canopy = min(p['min'][2] for p in parts
                 if np.any(np.subtract(p['max'][:2], p['min'][:2]) >= span[:2] * .5))
    return {'collision_parts': parts, 'canopy_min_z': canopy}


def tree_clearance(placement, entry, drivable, bounds, actors, ground_z):
    """Height-aware guard only for geometry-derived, builder-verified slabs."""
    c, s = math.cos(placement['yaw']), math.sin(placement['yaw'])
    rotation = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    origin = np.array([placement[k] for k in ('x', 'y', 'z')])
    for part in entry['collision_parts']:
        a, b = part['min'], part['max']
        corners = np.array([[x, y, z] for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])])
        world = (corners * placement['scale']) @ rotation.T + origin
        low, high = world.min(0) - .2, world.max(0) + .2
        if len(actors) and np.any(np.all(high > actors[:, 0], axis=1) & np.all(low < actors[:, 1], axis=1)):
            return False
        if world[:, 2].min() - ground_z < 4.5:
            if not clearance(low[:2], high[:2], drivable, bounds, []):
                return False
        else:
            boundary = _bounds(bounds)
            if np.any(low[:2] < boundary[:2]) or np.any(high[:2] > boundary[2:]):
                return False
    return True


def _bounds(bounds):
    b = np.asarray([bounds[k] for k in ('xmin', 'ymin', 'xmax', 'ymax')]
                   if isinstance(bounds, dict) else bounds, float)
    if b.shape != (4,) or not np.isfinite(b).all() or np.any(b[2:] <= b[:2]):
        raise ValueError('invalid bounds')
    return b


def footprint(placement, native_size):
    size = np.asarray(native_size)[:2] * np.asarray(placement['scale'])[:2]
    c, s = math.cos(placement['yaw']), math.sin(placement['yaw'])
    corners = np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]]) * size / 2
    xy = corners @ np.array([[c, s], [-s, c]]) + [placement['x'], placement['y']]
    # S12 explicitly requires the XY bounding box, expanded by 20 cm.
    low, high = xy.min(0) - .2, xy.max(0) + .2
    return low, high


def actor_sweeps(actors, *, dimensions=2):
    result = []
    for actor in actors:
        # Circumscribed radius also bounds intermediate yaw between keyframes.
        size = np.asarray(actor['size'], float)
        if size.shape != (3,) or not np.isfinite(size).all() or np.any(size <= 0):
            raise ValueError('invalid actor size')
        radius = np.linalg.norm(size[:2]) / 2
        keys = actor['keys']
        for key in keys:
            center = np.asarray(key['center'], float)
            if center.shape != (3,) or not np.isfinite(center).all() or not math.isfinite(key['yaw']):
                raise ValueError('invalid actor key')
        for a, b in zip(keys, keys[1:] or keys):
            points = np.asarray([a['center'][:dimensions], b['center'][:dimensions]], float)
            extent = radius if dimensions == 2 else np.array([radius, radius, size[2] / 2])
            result.append((points.min(0) - extent, points.max(0) + extent))
    return result


def clearance(low, high, drivable, bounds, sweeps):
    """Exact overlap with occupied raster cells; image row zero is north."""
    if any(np.all(high > a) and np.all(low < b) for a, b in sweeps):
        return False
    b = _bounds(bounds)
    if np.any(low < b[:2]) or np.any(high > b[2:]):
        return False
    raster = np.asarray(drivable)
    if raster.ndim != 2 or not raster.size or not np.isfinite(raster).all():
        raise ValueError('invalid drivable raster')
    h, w = raster.shape
    step = (b[2:] - b[:2]) / [w, h]
    x0, y0 = np.floor((low - b[:2]) / step).astype(int)
    x1, y1 = np.ceil((high - b[:2]) / step).astype(int)
    xs = b[0] + np.arange(x0, min(x1, w)) * step[0]
    ys = b[1] + np.arange(y0, min(y1, h)) * step[1]
    dx = np.maximum(0, np.minimum(xs + step[0], high[0]) - np.maximum(xs, low[0]))
    dy = np.maximum(0, np.minimum(ys + step[1], high[1]) - np.maximum(ys, low[1]))
    occupied = raster[h - min(y1, h):h - y0, x0:min(x1, w)][::-1] > 0
    area = float((occupied * dy[:, None] * dx).sum())
    return area <= .02 * float(np.prod(high - low))


def complete_facade(building, center, width, depth, angle, entries, road_points, drivable, bounds, sweeps):
    """Keep the observed road-facing wall, complete only its unobserved back."""
    if not len(road_points):
        return None
    center = np.asarray(center)
    tangent = np.array([math.cos(angle), math.sin(angle)])
    normal = np.array([-tangent[1], tangent[0]])
    nearest = road_points[np.argmin(np.linalg.norm(road_points - center, axis=1))]
    if np.dot(normal, center - nearest) < 0:
        normal = -normal
    facade = center - normal * depth / 2
    endpoints = [facade - tangent * width / 2, facade + tangent * width / 2]
    candidates = []
    for entry in entries:
        if entry['kind'] != 'building':
            continue
        native = np.asarray(entry['native_size'])
        for quarter in (0, 1):
            front, back = (0, 1) if quarter == 0 else (1, 0)
            base = width / native[front]
            # Preserve measured minimum height, but do not squash taller assets.
            height_scale = max(base, building['height'] / native[2])
            for completion_depth in np.arange(4., 12.01, .5):
                if completion_depth < depth:
                    continue
                scale = np.full(3, base)
                scale[back], scale[2] = completion_depth / native[back], height_scale
                distortion = scale.max() / scale.min()
                if distortion > 1.4 or scale.min() < .5 or scale.max() > 2:
                    continue
                xy = facade + normal * completion_depth / 2
                p = {'asset_id': entry['asset_id'], 'kind': 'building',
                     'x': float(xy[0]), 'y': float(xy[1]), 'z': building['base_z'],
                     'yaw': angle + quarter * math.pi / 2, 'scale': scale.tolist(),
                     'source': 'building', 'geometry_source': 'facade_completed',
                     'observed_facade': np.asarray(endpoints).tolist(),
                     'completion_depth_m': float(completion_depth)}
                if clearance(*footprint(p, native), drivable, bounds, sweeps):
                    candidates.append((completion_depth, distortion, entry['asset_id'], quarter, p))
    return min(candidates, key=lambda x: x[:4])[-1] if candidates else None


def plan_environment(procedural: dict, env_manifest: list, drivable, bounds, actors, seed) -> dict:
    _bounds(bounds)
    completion = procedural.get('facade_completion', False)
    if type(completion) is not bool:
        raise ValueError('facade_completion must be boolean')
    raster = np.asarray(drivable)
    if raster.ndim != 2 or not raster.size or not np.isfinite(raster).all():
        raise ValueError('invalid drivable raster')
    for kind in ('buildings', 'vegetation', 'poles'):
        for item in procedural.get(kind, []):
            if kind == 'buildings':
                polygon = np.asarray(item['polygon'], float)
                if polygon.ndim != 2 or polygon.shape[1] != 2 or len(polygon) < 3 or not np.isfinite(polygon).all():
                    raise ValueError('invalid building polygon')
                values = [item['base_z'], item['height']]
            else:
                values = [item[k] for k in ('x', 'y', 'z', 'height')]
                if kind == 'vegetation':
                    values.append(item['crown_radius'])
            if not np.isfinite(values).all() or item['height'] <= 0:
                raise ValueError('invalid procedural geometry')
            if kind == 'vegetation' and item['crown_radius'] <= 0:
                raise ValueError('invalid crown_radius')
    for edge in procedural.get('road_edges', []):
        points = np.asarray(edge, float)
        if points.ndim != 2 or points.shape[1] != 2 or len(points) < 2 or not np.isfinite(points).all():
            raise ValueError('invalid road edge')
    rng = np.random.default_rng(seed)
    rejected, valid, placements, fallback = [], [], [], []
    for entry in env_manifest:
        if not isinstance(entry, dict):
            rejected.append({'asset_id': None, 'reason': 'environment entry must be a dictionary'})
            continue
        try:
            validate_asset(entry, entry.get('mesh_names', []) + entry.get('material_names', []))
            if any(a['asset_id'] == entry['asset_id'] for a in valid):
                raise ValueError('duplicate asset_id')
            valid.append(entry)
        except (ValueError, TypeError, KeyError) as exc:
            if 'collision_parts' in entry or 'canopy_min_z' in entry:
                raise ValueError(f'invalid collision metadata: {entry.get("asset_id")}') from exc
            rejected.append({'asset_id': entry.get('asset_id'), 'reason': str(exc)})
    valid.sort(key=lambda e: e['asset_id'])
    sweeps = actor_sweeps(actors)
    sweeps_xyz = np.asarray(actor_sweeps(actors, dimensions=3))
    edges = [np.asarray(edge, float) for edge in procedural.get('road_edges', [])]
    # The observed road raster supplies a direction even where edge traces end.
    rows, cols = np.nonzero(raster)
    b = _bounds(bounds)
    road_points = np.column_stack((b[0] + (cols + .5) * (b[2] - b[0]) / raster.shape[1],
                                   b[3] - (rows + .5) * (b[3] - b[1]) / raster.shape[0]))

    def place(kind, source, x, y, z, yaw, target, original=None):
        candidates = [e for e in valid if e['kind'] == kind]
        if kind == 'building':
            candidates.sort(key=lambda e: abs(math.log((e['native_size'][0] / e['native_size'][1]) / (target[0] / target[1]))))
        elif kind == 'tree':
            candidates.sort(key=lambda e: abs(math.log(e['native_size'][2] / target[2])) +
                            abs(math.log(max(e['native_size'][:2]) / max(target[:2]))))
        if not candidates:
            rejected.append({'source': source, 'reason': 'no compatible asset'})
            if original is not None:
                fallback.append(original)
            return
        entry = candidates[0]
        scale = np.asarray(target) / entry['native_size']
        if kind == 'tree':
            scale[:] = target[2] / entry['native_size'][2]
        if kind == 'building' and scale.max() / scale.min() > 1.4:
            rejected.append({'asset_id': entry['asset_id'], 'source': source, 'reason': 'distortion > 1.4; procedural fallback'})
            fallback.append(original)
            return
        p = {'asset_id': entry['asset_id'], 'kind': kind, 'x': float(x), 'y': float(y), 'z': float(z),
             'yaw': float(yaw), 'scale': scale.tolist(), 'source': source}
        origin = np.array([x, y], float)
        normals = []
        nearest = None
        for edge in edges:
            for a, b in pairwise(edge):
                delta = b - a
                length = np.linalg.norm(delta)
                if length == 0:
                    continue
                point = a + np.clip(np.dot(origin-a, delta) / length**2, 0, 1) * delta
                distance = np.linalg.norm(point - origin)
                if nearest is None or distance < nearest[0]:
                    nearest = (distance, np.array([-delta[1], delta[0]]) / length)
        if nearest:
            normals = [nearest[1], -nearest[1]]
        for offset in [np.zeros(2)] + [normal * d for d in (.25, .5, .75, 1, 1.25, 1.5) for normal in normals]:
            p['x'], p['y'] = map(float, origin + offset)
            low, high = footprint(p, entry['native_size'])
            safe = (tree_clearance(p, entry, drivable, bounds, sweeps_xyz, z)
                    if kind == 'tree' and 'collision_parts' in entry
                    else clearance(low, high, drivable, bounds, sweeps))
            if safe:
                placements.append(p.copy())
                return
        rejected.append({'asset_id': entry['asset_id'], 'source': source, 'reason': 'physical overlap; relocation <= 1.5m exhausted'})

    for building in procedural.get('buildings', []):
        polygon = np.asarray(building['polygon'], float)
        rectangles = []
        for a, b in zip(polygon, np.roll(polygon, -1, axis=0)):
            angle = math.atan2(*(b-a)[::-1])
            c, s = math.cos(angle), math.sin(angle)
            rotation = np.array([[c, -s], [s, c]])
            local = polygon @ rotation
            low, high = local.min(0), local.max(0)
            size = high-low
            center = ((low+high)/2) @ rotation.T
            rectangles.append((float(np.prod(size)), center, size, angle))
        _, (x, y), (w, h), angle = min(rectangles, key=lambda r: r[0])
        if w < h:
            w, h, angle = h, w, angle + math.pi/2
        if completion:
            completed = complete_facade(building, [x, y], w, h, angle, valid,
                                        road_points, drivable, bounds, sweeps)
            if completed is not None:
                placements.append(completed)
                continue
        place('building', 'building', x, y, building['base_z'], angle,
              [w, h, building['height']], building)
    for tree in procedural.get('vegetation', []):
        place('tree', 'tree', tree['x'], tree['y'], tree['z'], rng.uniform(-math.pi, math.pi),
              [2*tree['crown_radius'], 2*tree['crown_radius'], tree['height']])
    for pole in procedural.get('poles', []):
        if pole['height'] <= 4 or pole['height'] > 6:
            kind = 'sign' if pole['height'] <= 4 else 'lamp'
            entry = next((e for e in valid if e['kind'] == kind), None)
            if entry:
                target = np.asarray(entry['native_size']) * pole['height'] / entry['native_size'][2]
                place(kind, 'pole', pole['x'], pole['y'], pole['z'], 0, target)
    density = procedural.get('props_density', .02)
    if not math.isfinite(density) or density < 0:
        raise ValueError('invalid props_density')
    props = [e for e in valid if e['kind'] == 'prop']
    if props and density:
        for edge in edges:
            carry = 0.0
            for a, b in pairwise(edge):
                delta, length = b-a, np.linalg.norm(b-a)
                if length == 0:
                    continue
                normal = np.array([-delta[1], delta[0]]) / length
                for d in np.arange(1/density-carry, length, 1/density):
                    x, y = a + delta*d/length + normal*.8
                    entry = props[int(rng.integers(len(props)))]
                    # Select the sampled prop through a temporary stable ordering.
                    others = valid[:]
                    valid[:] = [entry] + [e for e in valid if e is not entry]
                    place('prop', 'prop', x, y, procedural.get('ground_z', 0), math.atan2(delta[1], delta[0]), entry['native_size'])
                    valid[:] = others
                carry = (carry + length) % (1/density)
    # Fallback buildings obey the same physical exclusion rule.
    safe_fallback = []
    for b in fallback:
        xy = np.asarray(b['polygon'])
        if clearance(xy.min(0)-.2, xy.max(0)+.2, drivable, bounds, sweeps):
            safe_fallback.append(b)
        else:
            rejected.append({'source': 'building', 'reason': 'procedural fallback overlaps'})
    return {'placements': placements, 'rejected': rejected, 'fallback_buildings': safe_fallback}
