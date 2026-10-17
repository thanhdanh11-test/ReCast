"""Map facts used only by reactive events; source_scene's display contract is untouched.

NuScenes expansion arclines and AV2 lane boundaries are expressed in the same app
frame as source_scene. Missing or incomplete map data simply offers no map event.
"""

import json
import math
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Polygon

from topeye.scenario.source_scene import map_directory

LANE_SAMPLE_M = 0.5
LANE_ROUTE_JOIN_M = 2.0
SIDE_MIN_M = 1.5
SIDE_MAX_M = 6.0
SIDE_HEADING_RAD = math.radians(30)
SIDE_AHEAD_M = 1.0
STOP_PATH_MARGIN_M = 0.5
STOP_HORIZON_S = 20.0
STOP_COMFORT_DECEL = 2.0


@dataclass
class Lane:
    id: str
    xy: np.ndarray
    heading: np.ndarray
    incoming: tuple = ()
    outgoing: tuple = ()


@dataclass
class StopLine:
    id: str
    xy: np.ndarray
    type: str | None


class ReactiveMap:
    def __init__(self, lanes=(), stoplines=()):
        self.lanes = list(lanes)
        self.stoplines = list(stoplines)
        self._stop_cache = {}
        self._by_lane = {lane.id: lane for lane in self.lanes}
        self._points = np.vstack([lane.xy for lane in self.lanes]) if self.lanes else np.empty((0, 2))
        self._heading = np.concatenate([lane.heading for lane in self.lanes]) if self.lanes else np.empty(0)
        self._lane_ids = np.concatenate([np.full(len(lane.xy), lane.id, object) for lane in self.lanes]) \
            if self.lanes else np.empty(0, object)
        self._tree = cKDTree(self._points) if len(self._points) else None

    def nearest_side(self, xy, heading, direction):
        """Closest parallel centreline on the commanded side: (point, signed offset, lane id)."""
        normal = np.array([-math.sin(heading), math.cos(heading)])
        sign = 1 if direction == "left" else -1
        if self._tree is None:
            return None
        ids = self._tree.query_ball_point(xy, SIDE_MAX_M + SIDE_AHEAD_M)
        if not ids:
            return None
        delta = self._points[ids] - xy
        lateral = delta @ normal
        ahead = delta @ np.array([math.cos(heading), math.sin(heading)])
        aligned = np.abs((self._heading[ids] - heading + math.pi) % (2 * math.pi) - math.pi) <= SIDE_HEADING_RAD
        ok = aligned & (sign * lateral >= SIDE_MIN_M) & (sign * lateral <= SIDE_MAX_M) \
            & (np.abs(ahead) <= SIDE_AHEAD_M)
        if not ok.any():
            return None
        index = int(np.argmin(np.where(ok, np.hypot(lateral, ahead), np.inf)))
        return self._points[ids[index]], float(lateral[index]), str(self._lane_ids[ids[index]])

    def connected(self, from_id, to_id):
        """A change of lane segment must follow native successor/predecessor links."""
        if from_id == to_id:
            return True
        before, after = self._by_lane.get(from_id), self._by_lane.get(to_id)
        return bool(before and after and (to_id in before.outgoing or from_id in after.incoming))

    def follow_route(self, lane_id, start, needed_m, start_heading=None):
        """Continue on native successor centrelines from the lane-change endpoint."""
        lane = self._by_lane.get(lane_id)
        if lane is None:
            return None
        start = np.asarray(start, float)
        nearest = int(np.argmin(np.linalg.norm(lane.xy - start, axis=1)))
        if start_heading is None:
            points = [start, *lane.xy[nearest + 1:]]
        else:
            join = min(nearest + max(1, round(LANE_ROUTE_JOIN_M / LANE_SAMPLE_M)), len(lane.xy) - 1)
            finish = lane.xy[join]
            span = float(np.linalg.norm(finish - start))
            tangent0 = span * np.array([math.cos(start_heading), math.sin(start_heading)])
            tangent1 = span * np.array([math.cos(lane.heading[join]), math.sin(lane.heading[join])])
            points = []
            for u in np.linspace(0.0, 1.0, max(3, math.ceil(span / LANE_SAMPLE_M) + 1)):
                points.append((2*u**3 - 3*u**2 + 1)*start + (u**3 - 2*u**2 + u)*tangent0
                              + (-2*u**3 + 3*u**2)*finish + (u**3 - u**2)*tangent1)
            points.extend(lane.xy[join + 1:])
        visited = {lane_id}
        while _length(points) < needed_m and lane.outgoing:
            choices = [self._by_lane[token] for token in lane.outgoing if token in self._by_lane
                       and token not in visited]
            if not choices:
                break
            heading = lane.heading[-1]
            lane = min(choices, key=lambda item: abs((item.heading[0] - heading + math.pi) % (2 * math.pi) - math.pi))
            visited.add(lane.id)
            points.extend(lane.xy[1:])
        if len(points) < 2:
            return None
        if _length(points) < needed_m:
            delta = points[-1] - points[-2]
            unit = delta / max(np.linalg.norm(delta), 1e-9)
            points.append(points[-1] + unit * (needed_m - _length(points) + 1.0))
        return np.asarray(points, float)

    def next_stopline(self, model, index, t0):
        """First typed line crossed by the event vehicle's recorded path within 20 s."""
        agent = model.agents[index]
        k = round(t0 / model_step(model))
        if k >= model.K or not np.isfinite(model.S[k, index]):
            return None
        s0 = float(model.S[k, index])
        key = (id(model), index)
        if key not in self._stop_cache:
            line = LineString(agent.path.dxy)
            mapped = []
            for stop in self.stoplines:
                poly = Polygon(stop.xy)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if poly.is_empty or not line.intersects(poly.buffer(STOP_PATH_MARGIN_M)):
                    continue
                crossing = line.intersection(poly.buffer(STOP_PATH_MARGIN_M))
                point = np.asarray(crossing.centroid.coords[0], float).reshape(1, 2)
                projection = agent.path.project_many(point, 0.0, agent.path.length)
                if projection is None or abs(float(projection[1][0])) > STOP_PATH_MARGIN_M + 1.0:
                    continue
                s = float(projection[0][0])
                mapped.append((s, stop, model.tau_of_s(index, s), point[0]))
            self._stop_cache[key] = sorted(mapped, key=lambda row: row[0])
        found = []
        for s, stop, reach, point in self._stop_cache[key]:
            if reach <= t0 + 1e-6 or reach > t0 + STOP_HORIZON_S:
                continue
            distance = s - s0
            speed = float(model.V[k, index])
            if distance < speed * speed / (2 * STOP_COMFORT_DECEL):
                continue
            found.append((s, stop, reach, point))
        if not found:
            return None
        s, stop, reach, point = min(found, key=lambda row: row[0])
        return {"id": stop.id, "x_m": float(point[0]), "y_m": float(point[1]),
                "type": stop.type, "s": s, "t_reach_s": reach}


def model_step(model):
    return float(model.t[1] - model.t[0]) if model.K > 1 else 0.05


def _length(points):
    xy = np.asarray(points, float)
    return float(np.hypot(*np.diff(xy, axis=0).T).sum()) if len(xy) > 1 else 0.0


def _arcline(rows, origin):
    points = []
    for row in rows:
        x, y, h = row["start_pose"]
        for shape, length in zip(row["shape"], row["segment_length"]):
            steps = max(1, math.ceil(length / LANE_SAMPLE_M))
            curvature = (1 if shape == "L" else -1 if shape == "R" else 0) / max(float(row["radius"]), 1e-6)
            for _ in range(steps):
                points.append((x - origin[0], y - origin[1], h))
                ds = length / steps
                h_next = h + curvature * ds
                if curvature:
                    x += (math.sin(h_next) - math.sin(h)) / curvature
                    y += (math.cos(h) - math.cos(h_next)) / curvature
                else:
                    x += ds * math.cos(h)
                    y += ds * math.sin(h)
                h = h_next
        points.append((x - origin[0], y - origin[1], h))
    return np.asarray(points, float)


def _in_bounds(xy, low, high):
    return bool(len(xy) and (xy.max(axis=0) >= low).all() and (xy.min(axis=0) <= high).all())


def _bounds(source):
    xy = np.array([[sample["x_m"], sample["y_m"]] for actor in source["actors"]
                   for sample in actor.get("samples", [])], float)
    if not len(xy):
        return np.array([-1e4, -1e4]), np.array([1e4, 1e4])
    return xy.min(axis=0) - 40.0, xy.max(axis=0) + 40.0


def _nuscenes(data, origin, low, high):
    lanes = []
    links = data.get("connectivity", {})
    for token, rows in data.get("arcline_path_3", {}).items():
        if not rows:
            continue
        samples = _arcline(rows, origin)
        if not _in_bounds(samples[:, :2], low, high):
            continue
        link = links.get(token, {})
        lanes.append(Lane(token, samples[:, :2], samples[:, 2], tuple(link.get("incoming", ())),
                          tuple(link.get("outgoing", ()))))
    nodes = {row["token"]: np.array([row["x"], row["y"]]) - origin for row in data.get("node", [])}
    polygons = {row["token"]: row for row in data.get("polygon", [])}
    stops = []
    for row in data.get("stop_line", []):
        polygon = polygons.get(row.get("polygon_token"))
        if polygon is None:
            continue
        try:
            xy = np.array([nodes[token] for token in polygon["exterior_node_tokens"]], float)
        except KeyError:
            continue
        if len(xy) >= 3 and _in_bounds(xy, low, high):
            stops.append(StopLine(row["token"], xy, row.get("stop_line_type")))
    return ReactiveMap(lanes, stops)


def _av2(data, origin, low, high):
    lanes = []
    for token, row in data.get("lane_segments", {}).items():
        left = np.array([[p["x"], p["y"]] for p in row["left_lane_boundary"]], float) - origin
        right = np.array([[p["x"], p["y"]] for p in row["right_lane_boundary"]], float) - origin
        if min(len(left), len(right)) < 2:
            continue
        left_s = np.linspace(0, 1, len(left))
        right_s = np.linspace(0, 1, len(right))
        samples = np.linspace(0, 1, max(len(left), len(right), 12))
        xy = (np.column_stack([np.interp(samples, left_s, left[:, k]) for k in (0, 1)])
              + np.column_stack([np.interp(samples, right_s, right[:, k]) for k in (0, 1)])) / 2
        if not _in_bounds(xy, low, high):
            continue
        tangent = np.gradient(xy, axis=0)
        heading = np.arctan2(tangent[:, 1], tangent[:, 0])
        lanes.append(Lane(str(token), xy, heading, tuple(map(str, row.get("predecessors") or ())),
                          tuple(map(str, row.get("successors") or ()))))
    return ReactiveMap(lanes)


def load_map(adapter, source):
    """Read native map records without changing source_scene's output or the source cache."""
    scene = (source.get("source") or {}).get("scene")
    if not scene:
        return ReactiveMap()
    info = adapter.scene_map(scene)
    if not info:
        return ReactiveMap()
    origin = np.asarray(source["source"]["origin_global_m"][:2], float)
    low, high = _bounds(source)
    try:
        if getattr(adapter, "version", None) == "av2-sensor":
            return _av2(json.loads(info[1].read_text()), origin, low, high)
        path = map_directory() / f"{info[0]}.json"
        return _nuscenes(json.loads(path.read_text()), origin, low, high) if path.is_file() else ReactiveMap()
    except (OSError, ValueError, KeyError, TypeError):
        return ReactiveMap()
