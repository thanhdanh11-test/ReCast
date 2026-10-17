"""OpenDRIVE road network of a nuScenes scene for the CARLA export package (plan50 P04 §1).

Ported from replay-forge @ d36205b (`real2sim/nuscenes_map.py`, `real2sim/xodr.py::map_roads`):
one OpenDRIVE road per map-expansion lane / lane connector whose arcline centreline touches the
scene box; a single driving lane of the polygon-estimated width. No junction/routing links: the
file is road surface and lane geometry for replay, like the team's packages.
"""

import json
import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import numpy as np

from topeye.scenario.models import ScenarioError

CURVATURE_SIGN = {"L": 1.0, "S": 0.0, "R": -1.0}
MIN_SEGMENT = 1e-4  # m, shorter segments are dropped
MIN_LANE_WIDTH, MAX_LANE_WIDTH = 2.5, 5.0  # m, clamp for widths estimated from polygons
DEFAULT_LANE_WIDTH = 3.5  # m, when the lane polygon is missing
MAP_MARGIN = 30.0  # m of map lanes around the scene's tracks (replay-forge sources.MAP_MARGIN)


@dataclass
class Primitive:
    x: float
    y: float
    hdg: float
    length: float
    curvature: float


@dataclass
class MapLane:
    token: str
    kind: str  # "lane" or "lane_connector"
    primitives: list
    width: float

    @property
    def length(self):
        return sum(p.length for p in self.primitives)


def advance(x, y, hdg, length, curvature):
    """End pose after driving `length` with constant `curvature` from (x, y, hdg)."""
    if abs(curvature) < 1e-12:
        return x + length * math.cos(hdg), y + length * math.sin(hdg), hdg
    end = hdg + curvature * length
    return (x + (math.sin(end) - math.sin(hdg)) / curvature,
            y - (math.cos(end) - math.cos(hdg)) / curvature, end)


def arcline_primitives(path):
    out = []
    for element in path:
        x, y, hdg = element["start_pose"]
        for letter, length in zip(element["shape"], element["segment_length"]):
            curvature = CURVATURE_SIGN[letter] / element["radius"]
            if length >= MIN_SEGMENT:
                out.append(Primitive(x, y, hdg, length, curvature))
            x, y, hdg = advance(x, y, hdg, length, curvature)
    return out


def polygon_area(points):
    x, y = points[:, 0], points[:, 1]
    return 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def map_lanes(data, box):
    """Lanes and lane connectors with a centreline pose inside box = (xmin, ymin, xmax, ymax), global frame."""
    xmin, ymin, xmax, ymax = box
    nodes = {r["token"]: (r["x"], r["y"]) for r in data["node"]}
    polygons = {r["token"]: r for r in data["polygon"]}
    arclines = data.get("arcline_path_3") or {}
    out = []
    for kind in ("lane", "lane_connector"):
        for row in data.get(kind, []):
            path = arclines.get(row["token"])
            if not path:
                continue
            poses = np.array([p for e in path for p in (e["start_pose"], e["end_pose"])], dtype=float)
            inside = (poses[:, 0] >= xmin) & (poses[:, 0] <= xmax) & (poses[:, 1] >= ymin) & (poses[:, 1] <= ymax)
            if not inside.any():
                continue
            primitives = arcline_primitives(path)
            if not primitives:
                continue
            lane = MapLane(row["token"], kind, primitives, DEFAULT_LANE_WIDTH)
            if row.get("polygon_token") in polygons and lane.length > 0:
                exterior = np.array([nodes[n] for n in polygons[row["polygon_token"]]["exterior_node_tokens"]], dtype=float)
                lane.width = float(np.clip(polygon_area(exterior) / lane.length, MIN_LANE_WIDTH, MAX_LANE_WIDTH))
            out.append(lane)
    return out


def map_roads(lanes, origin_xy, name):
    """OpenDRIVE 1.5 bytes; reference lines shifted into the scene-local frame (global - origin_xy)."""
    ox, oy = origin_xy
    sub = ET.SubElement
    root = ET.Element("OpenDRIVE")
    sub(root, "header", revMajor="1", revMinor="5", name=name, version="1.00")
    for road_id, lane in enumerate(lanes, start=1):
        road = sub(root, "road", name=lane.token, length=f"{lane.length:.6f}", id=str(road_id), junction="-1")
        sub(road, "link")
        plan = sub(road, "planView")
        s = 0.0
        for prim in lane.primitives:
            geometry = sub(plan, "geometry", s=f"{s:.6f}", x=f"{prim.x - ox:.6f}", y=f"{prim.y - oy:.6f}",
                           hdg=f"{prim.hdg:.9f}", length=f"{prim.length:.6f}")
            if abs(prim.curvature) < 1e-12:
                sub(geometry, "line")
            else:
                sub(geometry, "arc", curvature=f"{prim.curvature:.9f}")
            s += prim.length
        sub(road, "elevationProfile")
        sub(road, "lateralProfile")
        lanes_el = sub(road, "lanes")
        sub(lanes_el, "laneOffset", s="0", a=f"{lane.width / 2:.3f}", b="0", c="0", d="0")
        section = sub(lanes_el, "laneSection", s="0")
        # Lane connectors overlap inside intersections, where real roads carry no lane markings.
        marked = lane.kind == "lane"
        center = sub(sub(section, "center"), "lane", id="0", type="none", level="false")
        sub(center, "link")
        sub(center, "roadMark", sOffset="0", type="broken" if marked else "none", weight="standard",
            color="white", width="0.12")
        right = sub(sub(section, "right"), "lane", id="-1", type="driving", level="false")
        sub(right, "link")
        sub(right, "width", sOffset="0", a=f"{lane.width:.3f}", b="0", c="0", d="0")
        sub(right, "roadMark", sOffset="0", type="solid" if marked else "none", weight="standard",
            color="white", width="0.12")
    tree = ET.ElementTree(root)
    ET.indent(tree)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"


def scene_xodr(adapter, scene, origin_global, points_local):
    """(file name, bytes) of `scene`'s road network. points_local: (N, 2) actor xy in the app frame
    (global - origin_global); the lane box is their extent + MAP_MARGIN, like replay-forge."""
    from topeye.scenario.source_scene import map_directory

    map_info = adapter.scene_map(scene) if hasattr(adapter, "scene_map") else None
    if not map_info or hasattr(adapter, "vector_map"):
        raise ScenarioError("CARLA_UNSUPPORTED", "Xuất CARLA chỉ hỗ trợ dataset nuScenes có map expansion")
    candidates = [adapter.root / "maps/expansion" / f"{map_info[0]}.json", map_directory() / f"{map_info[0]}.json"]
    path = next((p for p in candidates if p.is_file()), None)
    if path is None:
        raise ScenarioError("CARLA_UNSUPPORTED", f"Thiếu map expansion {map_info[0]}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not data.get("arcline_path_3"):
        raise ScenarioError("CARLA_UNSUPPORTED", f"Map {map_info[0]} không có tâm làn (arcline_path_3)")
    ox, oy = float(origin_global[0]), float(origin_global[1])
    xy = np.asarray(points_local, dtype=float)[:, :2] + (ox, oy)
    lo, hi = xy.min(axis=0) - MAP_MARGIN, xy.max(axis=0) + MAP_MARGIN
    lanes = map_lanes(data, (lo[0], lo[1], hi[0], hi[1]))
    if not lanes:
        raise ScenarioError("CARLA_UNSUPPORTED", "Không có làn đường nào quanh kịch bản")
    return f"{scene}_map.xodr", map_roads(lanes, (ox, oy), f"nuscenes_{scene}")
