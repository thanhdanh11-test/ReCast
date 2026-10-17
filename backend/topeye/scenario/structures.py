"""Road-edge and overhead structures from multi-sweep static LiDAR (plan36).

The static environment is otherwise 2.5D (one ground, facades extruded from it). Two structures
need the road as reference instead:

* ``roadside_barriers``: anything continuous hugging the drivable-area edge. On its own this
  also fires on curbside clutter, hedges and facades (plan36: 19 of 20 scenes), so only
  ``corridor_structures`` are drawn: tall runs on BOTH sides of the driven road over the same
  stretch (bridge trusses, tunnel/trench walls). Thickness, solidity and "void beside the road"
  were measured and do not separate a truss from a curbside wall on this data. Evidence: a continuous band of returns 0.3-1.4 m above the local road
  surface within ``EDGE_BAND_M`` outside the edge, along at least ``MIN_RUN_M``.
* ``overhead_structures``: bridge decks / tunnel ceilings above the road. Evidence: a
  horizontal sheet of returns at least ``CLEARANCE_M`` above the road with free space below.

Heights are relative to the local road surface (``road_z``), never to a scene-wide ground.
"""

import numpy as np
import shapely
from scipy.spatial import cKDTree
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import unary_union

STATION_M = 1.0  # spacing of edge samples
EDGE_BAND_M = 1.2  # outward search band from the drivable-area edge (2.5 m adds palm-lined streets)
LOW_BAND_M = (0.3, 1.4)  # railing/parapet height window above the road surface
MAX_HEIGHT_M = 6.0  # tallest roadside structure considered (bridge truss)
MIN_VOXELS = 3  # occupied 0.3 m voxels in the low band for a station to count
MIN_RUN_M = 10.0  # shorter runs are street furniture, not a structure
MAX_GAP_M = 2.0  # stations missing within a run (posts, occlusion)
CLEARANCE_M = 4.0  # overhead structures sit at least this far above the road
MIN_OVERHEAD_M2 = 20.0
MAX_SHEET_THICKNESS_M = 0.6
MAX_PLANE_RESIDUAL_M = 0.2


def road_height_fn(ground_xyz):
    """Local road surface height from measured/anchored ground (x, y, z rows): nearest 3 cells."""
    ground = np.asarray(ground_xyz, dtype=float).reshape(-1, 3)
    if not len(ground):
        return lambda xy: np.zeros(len(np.atleast_2d(xy)))
    tree = cKDTree(ground[:, :2])

    def road_z(xy):
        xy = np.atleast_2d(np.asarray(xy, dtype=float))
        k = min(3, len(ground))
        _, idx = tree.query(xy, k=k)
        idx = np.asarray(idx).reshape(len(xy), -1)
        return np.median(ground[idx, 2], axis=1)

    return road_z


def _edge_lines(road):
    polygons = list(road.geoms) if isinstance(road, MultiPolygon) else [road]
    for poly in polygons:
        if poly.is_empty:
            continue
        yield poly.exterior
        yield from poly.interiors


def _along(line, distances):
    """Points at these distances along the line, clamped to its ends (= shapely interpolate).

    shapely walks the line from its start for every point, O(points x vertices); long road
    edges made that the slowest step of opening a scene (plan55).
    """
    coords = shapely.get_coordinates(line)
    cum = np.r_[0.0, np.cumsum(np.hypot(*np.diff(coords, axis=0).T))]
    d = np.clip(np.asarray(distances, dtype=float), 0.0, cum[-1])
    return np.c_[np.interp(d, cum, coords[:, 0]), np.interp(d, cum, coords[:, 1])]


def roadside_barriers(xyz, road, road_z):
    """Continuous structures along the drivable edge: [{points, heights, length_m}] (world xy)."""
    xyz = np.asarray(xyz, dtype=float).reshape(-1, 3)
    if not len(xyz) or road is None or road.is_empty:
        return []
    outside = ~shapely.contains_xy(road, xyz[:, 0], xyz[:, 1])
    pts = xyz[outside]
    if not len(pts):
        return []
    tree = cKDTree(pts[:, :2])
    barriers = []
    for ring in _edge_lines(road):
        line = LineString(ring.coords)
        if line.length < MIN_RUN_M:
            continue
        stations = np.arange(0, line.length, STATION_M)
        xy = _along(line, stations)
        ahead = _along(line, stations + 0.5)
        behind = _along(line, stations - 0.5)
        tangent = ahead - behind
        tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
        normal = np.c_[-tangent[:, 1], tangent[:, 0]]
        # Point the normal away from the road.
        probe = xy + normal * 0.3
        flip = shapely.contains_xy(road, probe[:, 0], probe[:, 1])
        normal[flip] *= -1
        base = road_z(xy)
        hit = np.zeros(len(xy), dtype=bool)
        top = np.zeros(len(xy))
        for i, candidates in enumerate(tree.query_ball_point(xy, EDGE_BAND_M + STATION_M)):
            if not candidates:
                continue
            c = pts[candidates]
            d = c[:, :2] - xy[i]
            along = d @ tangent[i]
            offset = d @ normal[i]
            h = c[:, 2] - base[i]
            band = (np.abs(along) <= STATION_M / 2) & (offset >= -0.1) & (offset <= EDGE_BAND_M)
            low = band & (h >= LOW_BAND_M[0]) & (h <= LOW_BAND_M[1])
            if low.sum() >= MIN_VOXELS:
                hit[i] = True
                column = band & (h >= LOW_BAND_M[0]) & (h <= MAX_HEIGHT_M)
                top[i] = float(np.quantile(h[column], 0.95))
        barriers += _runs(xy, base, hit, top, closed=line.is_ring)
    return barriers


def _runs(xy, base, hit, top, closed):
    """Merge hit stations into runs, bridging gaps up to MAX_GAP_M; keep runs >= MIN_RUN_M."""
    index = np.flatnonzero(hit)
    if not len(index):
        return []
    groups, current = [], [index[0]]
    for i in index[1:]:
        if (i - current[-1]) * STATION_M <= MAX_GAP_M + STATION_M:
            current.append(i)
        else:
            groups.append(current)
            current = [i]
    groups.append(current)
    if (
        closed
        and len(groups) > 1
        and (len(hit) - groups[-1][-1] + groups[0][0]) * STATION_M <= MAX_GAP_M + STATION_M
    ):
        groups[0] = groups.pop() + groups[0]
    out = []
    for group in groups:
        span = list(range(group[0], group[-1] + 1)) if group == sorted(group) else group
        length = (len(span) - 1) * STATION_M
        if length < MIN_RUN_M:
            continue
        heights = np.array([top[i] for i in span])
        filled = np.where(heights > 0, heights, np.median(top[group]))
        # Smooth posts/gaps: a structure's top is continuous along its run.
        smooth = np.array([np.median(filled[max(0, k - 3) : k + 4]) for k in range(len(filled))])
        out.append(
            {
                "kind": "barrier",
                "points": [[float(xy[i][0]), float(xy[i][1]), float(base[i])] for i in span],
                "heights": [round(float(max(h, 0.8)), 2) for h in smooth],
                "length_m": round(float(length), 1),
            }
        )
    return out


def overhead_structures(xyz, road, road_z, ego_xy):
    """Horizontal sheets >= CLEARANCE_M above the road with clear space below (decks, ceilings).

    Only sheets the ego actually drove under count: awnings, balconies and tree crowns beside
    the carriageway also look like high horizontal returns.
    """
    xyz = np.asarray(xyz, dtype=float).reshape(-1, 3)
    ego_xy = np.asarray(ego_xy, dtype=float).reshape(-1, 2)
    if not len(xyz) or road is None or road.is_empty or len(ego_xy) < 2:
        return []
    driven = LineString(ego_xy).buffer(1.0)
    inside = shapely.contains_xy(road.buffer(2.0), xyz[:, 0], xyz[:, 1])
    pts = xyz[inside]
    if not len(pts):
        return []
    h = pts[:, 2] - road_z(pts[:, :2])
    cells = np.floor(pts[:, :2] / 1.0).astype(np.int64)
    keys, inverse = np.unique(cells, axis=0, return_inverse=True)
    sheet = np.zeros(len(keys), dtype=bool)
    level = np.zeros(len(keys))
    for k in range(len(keys)):
        hk = h[inverse == k]
        high = hk[(hk >= CLEARANCE_M) & (hk <= 30)]
        if len(high) < 3:
            continue
        # A ceiling is thin and has nothing between 1.5 m above the road and its underside.
        underside = float(np.quantile(high, 0.1))
        # Seen from below a deck/ceiling is one surface; a tree crown spans metres.
        thin = float(np.quantile(high, 0.9) - underside) <= MAX_SHEET_THICKNESS_M
        clear = not ((hk > 1.5) & (hk < underside - 0.5)).any()
        if thin and clear:
            sheet[k], level[k] = True, underside
    if not sheet.any():
        return []
    squares = [Polygon([(x, y), (x + 1, y), (x + 1, y + 1), (x, y + 1)]) for x, y in keys[sheet]]
    out = []
    merged = unary_union(squares)
    for part in list(merged.geoms) if isinstance(merged, MultiPolygon) else [merged]:
        if part.area < MIN_OVERHEAD_M2 or not part.intersects(driven):
            continue
        member = shapely.contains_xy(
            part.buffer(0.01), keys[sheet][:, 0] + 0.5, keys[sheet][:, 1] + 0.5
        )
        underside = level[sheet][member]
        cells_xy = keys[sheet][member] + 0.5
        # The underside of a real structure is one plane (decks are near level).
        design = np.c_[cells_xy - cells_xy.mean(axis=0), np.ones(len(cells_xy))]
        coefficients, *_ = np.linalg.lstsq(design, underside, rcond=None)
        residual = float(np.quantile(np.abs(design @ coefficients - underside), 0.8))
        if residual > MAX_PLANE_RESIDUAL_M or np.linalg.norm(coefficients[:2]) > 0.1:
            continue
        centre = np.array(part.centroid.coords[0])
        out.append(
            {
                "kind": "overhead",
                "polygon": [
                    list(map(float, p)) for p in list(part.simplify(0.5).exterior.coords)[:-1]
                ],
                "underside_above_road_m": round(float(np.median(underside)), 2),
                "road_z": round(float(road_z(centre[None])[0]), 2),
                "area_m2": round(float(part.area), 1),
            }
        )
    return out


CORRIDOR_MIN_HEIGHT_M = 2.5  # trusses/tunnel walls rise well above railings and clutter
CORRIDOR_MAX_DISTANCE_M = 8.0  # from the ego path: the structure lines the driven carriageway
CORRIDOR_MIN_OVERLAP_M = 10.0  # both sides present over this much of the ego path


def corridor_structures(barriers, ego_xy):
    """Tall edge runs facing each other across the ego path (bridge truss, tunnel walls)."""
    ego_xy = np.asarray(ego_xy, dtype=float).reshape(-1, 2)
    if len(ego_xy) < 2:
        return []
    path = LineString(ego_xy)
    if path.length < CORRIDOR_MIN_OVERLAP_M:
        return []
    candidates = []
    for barrier in barriers:
        if np.median(barrier["heights"]) < CORRIDOR_MIN_HEIGHT_M:
            continue
        xy = np.array([p[:2] for p in barrier["points"]])
        points = shapely.points(xy)
        if np.median(shapely.distance(points, path)) > CORRIDOR_MAX_DISTANCE_M:
            continue
        along = shapely.line_locate_point(path, points)
        before = shapely.get_coordinates(path.interpolate(np.maximum(along - 1, 0)))
        after = shapely.get_coordinates(path.interpolate(np.minimum(along + 1, path.length)))
        tangent, offset = after - before, xy - before
        side = np.sign(np.median(tangent[:, 0] * offset[:, 1] - tangent[:, 1] * offset[:, 0]))
        candidates.append((barrier, float(along.min()), float(along.max()), side))
    kept = set()
    for i, (_, start, end, side) in enumerate(candidates):
        for j, (_, other_start, other_end, other_side) in enumerate(candidates):
            overlap = min(end, other_end) - max(start, other_start)
            if side * other_side < 0 and overlap >= CORRIDOR_MIN_OVERLAP_M:
                kept |= {i, j}
    return [{**candidates[i][0], "kind": "corridor"} for i in sorted(kept)]
