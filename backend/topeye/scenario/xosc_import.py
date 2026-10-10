"""Bounded, non-executable OpenSCENARIO trajectory-only profile admission."""

import copy
import hashlib
import math
import re
import uuid
from pathlib import Path

import numpy as np
from lxml import etree as E

from topeye.scenario.map_context import LIMITS, PROFILE, centered_samples, check_map, verify_context
from topeye.scenario.models import ScenarioError, finite, require

# Exhaustive local profile attributes. XSD additionally enforces required/type constraints.
ATTRS = {
    "OpenSCENARIO": (),
    "FileHeader": ("revMajor", "revMinor", "date", "description", "author"),
    "ParameterDeclarations": (),
    "CatalogLocations": (),
    "RoadNetwork": (),
    "Entities": (),
    "ScenarioObject": ("name",),
    "Vehicle": ("name", "vehicleCategory"),
    "Pedestrian": ("name", "model", "mass", "pedestrianCategory"),
    "BoundingBox": (),
    "Center": ("x", "y", "z"),
    "Dimensions": ("length", "width", "height"),
    "Performance": ("maxSpeed", "maxAcceleration", "maxDeceleration"),
    "Axles": (),
    "FrontAxle": ("maxSteering", "wheelDiameter", "trackWidth", "positionX", "positionZ"),
    "RearAxle": ("maxSteering", "wheelDiameter", "trackWidth", "positionX", "positionZ"),
    "Properties": (),
    "Property": ("name", "value"),
    "Storyboard": (),
    "Init": (),
    "Actions": (),
    "Private": ("entityRef",),
    "PrivateAction": (),
    "TeleportAction": (),
    "Position": (),
    "WorldPosition": ("x", "y", "z", "h", "p", "r"),
    "Story": ("name",),
    "Act": ("name",),
    "ManeuverGroup": ("name", "maximumExecutionCount"),
    "Actors": ("selectTriggeringEntities",),
    "EntityRef": ("entityRef",),
    "Maneuver": ("name",),
    "Event": ("name", "priority", "maximumExecutionCount"),
    "Action": ("name",),
    "RoutingAction": (),
    "FollowTrajectoryAction": (),
    "Trajectory": ("name", "closed"),
    "Shape": (),
    "Polyline": (),
    "Vertex": ("time",),
    "TimeReference": (),
    "Timing": ("domainAbsoluteRelative", "scale", "offset"),
    "TrajectoryFollowingMode": ("followingMode",),
    "StartTrigger": (),
    "StopTrigger": (),
    "ConditionGroup": (),
    "Condition": ("name", "delay", "conditionEdge"),
    "ByValueCondition": (),
    "SimulationTimeCondition": ("value", "rule"),
}


def fail(code, message, actor=None, vertex=None):
    exc = ScenarioError(code, message)
    exc.diagnostics = [
        {
            "code": code,
            "message": message,
            **({"actor_id": actor} if actor else {}),
            **({"vertex_index": vertex} if vertex is not None else {}),
        }
    ]
    raise exc


def shape(element, required, optional=()):
    tags = [c.tag for c in element]
    if (
        any(tags.count(t) != 1 for t in required)
        or any(tags.count(t) > 1 for t in optional)
        or set(tags) - set(required) - set(optional)
    ):
        fail("UNSUPPORTED_XOSC", f"Unexpected structure in {element.tag}: {tags}")
    return element


def one(element, tag):
    if len(element) != 1 or element[0].tag != tag:
        fail("UNSUPPORTED_XOSC", f"Expected only {tag} inside {element.tag}")
    return element[0]


def number(element, key):
    try:
        v = float(element.attrib[key])
    except (ValueError, KeyError):
        fail("INVALID_TRAJECTORY", f"Invalid {element.tag}.{key}")
    if not finite(v):
        fail("INVALID_TRAJECTORY", f"Nonfinite {element.tag}.{key}")
    return v


def pose(position):
    world = one(position, "WorldPosition")
    if (
        set(world.attrib) != set(ATTRS["WorldPosition"])
        or number(world, "p") != 0
        or number(world, "r") != 0
    ):
        fail("UNSUPPORTED_XOSC", "WorldPosition requires x/y/z/h and p=r=0")
    return {
        k: number(world, v) for k, v in [("x_m", "x"), ("y_m", "y"), ("z_m", "z"), ("yaw_rad", "h")]
    }


def trigger(element, value):
    group = one(element, "ConditionGroup")
    condition = one(group, "Condition")
    sim = one(one(condition, "ByValueCondition"), "SimulationTimeCondition")
    if (
        number(condition, "delay") != 0
        or condition.get("conditionEdge") != "none"
        or sim.get("rule") != "greaterThan"
        or abs(number(sim, "value") - value) > 1e-9
    ):
        fail("UNSUPPORTED_XOSC", "Only zero-delay absolute simulation-time triggers supported")


def parse_xml(xml_bytes):
    require(isinstance(xml_bytes, bytes), "XML must be bytes")
    require(len(xml_bytes) <= LIMITS["max_xml_bytes"], "XML exceeds 2MiB", "RESOURCE_LIMIT")
    if b"<!DOCTYPE" in xml_bytes.upper() or b"<!ENTITY" in xml_bytes.upper():
        fail("UNSUPPORTED_XOSC", "DTD/entities forbidden")
    parser = E.XMLParser(
        resolve_entities=False,
        no_network=True,
        load_dtd=False,
        remove_comments=True,
        remove_blank_text=True,
        huge_tree=False,
    )
    try:
        root = E.fromstring(xml_bytes, parser)
    except E.XMLSyntaxError as exc:
        fail("INVALID_XML", str(exc))
    tree = root.getroottree()
    if (
        tree.docinfo.doctype
        or tree.xpath("//processing-instruction()")
        or root.getprevious() is not None
        or root.getnext() is not None
    ):
        fail("UNSUPPORTED_XOSC", "DTD and processing instructions forbidden")
    for count, element in enumerate(root.iter(), 1):
        require(
            count <= 200000 and len(list(element.iterancestors())) < 32,
            "XML complexity exceeded",
            "RESOURCE_LIMIT",
        )
        if element.tag not in ATTRS or set(element.attrib) - set(ATTRS[element.tag]):
            fail(
                "UNSUPPORTED_XOSC",
                f"Unsupported element/attribute: {element.tag} {dict(element.attrib)}",
            )
        if element.text and element.text.strip() or element.tail and element.tail.strip():
            fail("UNSUPPORTED_XOSC", "Element text unsupported")
        if any("$" in v for v in element.attrib.values()):
            fail("UNSUPPORTED_XOSC", "Parameter references forbidden")
    schema = E.XMLSchema(E.parse(str(Path(__file__).parent / "schemas/OpenSCENARIO.xsd"), parser))
    try:
        schema.assertValid(root)
    except E.DocumentInvalid as exc:
        fail("XOSC_SCHEMA_ERROR", str(exc))
    return root


def validate_xosc(xml_bytes, context):
    verify_context(context)
    root = parse_xml(xml_bytes)
    shape(
        root,
        ("FileHeader", "Entities", "Storyboard"),
        ("ParameterDeclarations", "CatalogLocations", "RoadNetwork"),
    )
    header = root.find("FileHeader")
    if header.get("revMajor") != "1" or header.get("revMinor") != "0":
        fail("UNSUPPORTED_XOSC", "Only OpenSCENARIO XML1.0 supported")
    for tag in ("ParameterDeclarations", "CatalogLocations", "RoadNetwork"):
        e = root.find(tag)
        if e is not None and len(e):
            fail("UNSUPPORTED_XOSC", f"{tag} must be empty")
    entities = root.find("Entities")
    require(1 <= len(entities) <= LIMITS["max_actors"], "Actor limit exceeded", "RESOURCE_LIMIT")
    actors = []
    ids = set()
    for obj in entities:
        require(obj.tag == "ScenarioObject", "Unsupported entity", "UNSUPPORTED_XOSC")
        name = obj.get("name", "")
        require(
            re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", name) and name not in ids,
            "Invalid/duplicate actor ID",
        )
        ids.add(name)
        model = obj[0] if len(obj) == 1 else None
        require(
            model is not None and model.tag in {"Vehicle", "Pedestrian"},
            "Only inline vehicle/pedestrian entities",
            "UNSUPPORTED_XOSC",
        )
        pedestrian = model.tag == "Pedestrian"
        shape(
            model,
            ("BoundingBox", "Properties")
            if pedestrian
            else ("BoundingBox", "Performance", "Axles", "Properties"),
            ("ParameterDeclarations",),
        )
        pd = model.find("ParameterDeclarations")
        require(pd is None or len(pd) == 0, "Parameters forbidden", "UNSUPPORTED_XOSC")
        if pedestrian:
            require(
                model.get("pedestrianCategory") == "pedestrian"
                and model.get("model") == ""
                and number(model, "mass") > 0,
                "External pedestrian model forbidden",
                "UNSUPPORTED_XOSC",
            )
            category = "human.pedestrian"
        else:
            vc = model.get("vehicleCategory")
            require(
                vc in {"car", "truck", "bus", "motorbike", "bicycle"},
                "Unsupported vehicle category",
                "UNSUPPORTED_XOSC",
            )
            category = "vehicle." + vc
            perf = model.find("Performance")
            require(all(number(perf, k) > 0 for k in ATTRS["Performance"]), "Invalid performance")
            axles = shape(model.find("Axles"), ("FrontAxle", "RearAxle"))
            for axle in axles:
                require(all(finite(number(axle, k)) for k in ATTRS[axle.tag]), "Invalid axle")
        bbox = shape(model.find("BoundingBox"), ("Center", "Dimensions"))
        center = [number(bbox.find("Center"), k) for k in ("x", "y", "z")]
        dimensions = {
            f"{k}_m": number(bbox.find("Dimensions"), k) for k in ("length", "width", "height")
        }
        require(
            all(0 < v <= 30 for v in dimensions.values()) and all(abs(v) <= 30 for v in center),
            "Invalid/unbounded bbox",
        )
        properties = {}
        for prop in model.find("Properties"):
            key = prop.get("name")
            require(
                prop.tag == "Property"
                and key in {"topeye.map_id", "topeye.profile", "topeye.role"}
                and key not in properties,
                "Unknown/duplicate property",
                "UNSUPPORTED_XOSC",
            )
            properties[key] = prop.get("value")
        require(
            set(properties) == {"topeye.map_id", "topeye.profile", "topeye.role"},
            "Missing map/profile/role property",
        )
        require(
            properties["topeye.map_id"] == context["map_id"]
            and properties["topeye.profile"] == PROFILE,
            "Map/profile mismatch",
            "MAP_MISMATCH",
        )
        require(properties["topeye.role"] in {"ego", "traffic"}, "Invalid actor role")
        actors.append(
            {
                "id": name,
                "role": properties["topeye.role"],
                "category": category,
                **dimensions,
                "center_offset_m": center,
                "reference_samples": [],
                "samples": [],
            }
        )
    require(sum(a["role"] == "ego" for a in actors) == 1, "Exactly one ego required")
    by_id = {a["id"]: a for a in actors}
    board = shape(root.find("Storyboard"), ("Init", "Story", "StopTrigger"))
    actions = one(board.find("Init"), "Actions")
    teleports = {}
    for private in actions:
        require(
            private.tag == "Private"
            and private.get("entityRef") in ids
            and private.get("entityRef") not in teleports,
            "Invalid/duplicate Init actor",
            "UNSUPPORTED_XOSC",
        )
        teleports[private.get("entityRef")] = pose(
            one(one(one(private, "PrivateAction"), "TeleportAction"), "Position")
        )
    require(set(teleports) == ids, "Missing Init teleport")
    story = shape(board.find("Story"), ("Act",), ("ParameterDeclarations",))
    pd = story.find("ParameterDeclarations")
    require(pd is None or not len(pd), "Story parameters forbidden", "UNSUPPORTED_XOSC")
    act = story.find("Act")
    require(
        all(c.tag in {"ManeuverGroup", "StartTrigger", "StopTrigger"} for c in act)
        and len(act.findall("StartTrigger")) == 1
        and len(act.findall("StopTrigger")) <= 1,
        "Unsupported Act structure",
        "UNSUPPORTED_XOSC",
    )
    trigger(act.find("StartTrigger"), 0)
    stop = act.find("StopTrigger")
    require(stop is None or not len(stop), "Act stop must be empty", "UNSUPPORTED_XOSC")
    seen = set()
    duration = None
    for group in act.findall("ManeuverGroup"):
        shape(group, ("Actors", "Maneuver"))
        require(
            group.get("maximumExecutionCount") == "1",
            "Repeated maneuver forbidden",
            "UNSUPPORTED_XOSC",
        )
        ref = one(group.find("Actors"), "EntityRef").get("entityRef")
        require(
            ref in ids
            and ref not in seen
            and group.find("Actors").get("selectTriggeringEntities") == "false",
            "Invalid maneuver actor",
            "UNSUPPORTED_XOSC",
        )
        seen.add(ref)
        maneuver = shape(group.find("Maneuver"), ("Event",), ("ParameterDeclarations",))
        pd = maneuver.find("ParameterDeclarations")
        require(pd is None or not len(pd), "Maneuver parameters forbidden", "UNSUPPORTED_XOSC")
        event = shape(maneuver.find("Event"), ("Action", "StartTrigger"))
        require(
            event.get("priority") == "overwrite" and event.get("maximumExecutionCount", "1") == "1",
            "Unsupported event",
            "UNSUPPORTED_XOSC",
        )
        trigger(event.find("StartTrigger"), 0)
        follow = one(
            one(one(event.find("Action"), "PrivateAction"), "RoutingAction"),
            "FollowTrajectoryAction",
        )
        shape(follow, ("Trajectory", "TimeReference", "TrajectoryFollowingMode"))
        require(
            follow.find("TrajectoryFollowingMode").get("followingMode") == "position",
            "Only position following",
            "UNSUPPORTED_XOSC",
        )
        timing = one(follow.find("TimeReference"), "Timing")
        require(
            timing.get("domainAbsoluteRelative") == "absolute"
            and number(timing, "scale") == 1
            and number(timing, "offset") == 0,
            "Only absolute unscaled timing",
            "UNSUPPORTED_XOSC",
        )
        trajectory = shape(follow.find("Trajectory"), ("Shape",), ("ParameterDeclarations",))
        require(
            trajectory.get("closed") == "false", "Closed trajectory unsupported", "UNSUPPORTED_XOSC"
        )
        pd = trajectory.find("ParameterDeclarations")
        require(pd is None or not len(pd), "Trajectory parameters forbidden", "UNSUPPORTED_XOSC")
        poly = one(trajectory.find("Shape"), "Polyline")
        require(
            3 <= len(poly) <= LIMITS["max_vertices_per_actor"], "Vertex limit", "RESOURCE_LIMIT"
        )
        rows = []
        for vertex in poly:
            require(vertex.tag == "Vertex", "Only polyline vertices", "UNSUPPORTED_XOSC")
            rows.append(
                {"t_s": number(vertex, "time"), **pose(one(vertex, "Position")), "observed": False}
            )
        values = np.array([[r[k] for k in ("t_s", "x_m", "y_m", "z_m", "yaw_rad")] for r in rows])
        dt = np.diff(values[:, 0])
        require(
            rows[0]["t_s"] == 0 and np.all(dt > 0) and np.all(dt <= 1.000000001),
            "Nonmonotone/gapped trajectory",
            "INVALID_TRAJECTORY",
        )
        d = rows[-1]["t_s"]
        require(
            2 <= d <= 60 and (duration is None or abs(duration - d) <= 1e-9),
            "Invalid common duration",
            "INVALID_TRAJECTORY",
        )
        duration = d
        require(
            all(abs(teleports[ref][k] - rows[0][k]) <= 1e-6 for k in teleports[ref]),
            "Teleport differs from first vertex",
            "INVALID_TRAJECTORY",
        )
        a = by_id[ref]
        velocity = np.diff(values[:, 1:4], axis=0) / dt[:, None]
        kind = "pedestrian" if a["category"].startswith("human.") else "vehicle"
        require(
            np.max(np.linalg.norm(velocity, axis=1)) <= LIMITS["max_speed_mps"][kind],
            f"{ref}: speed limit",
            "DYNAMIC_LIMIT",
        )
        # Segment velocity changes measured over adjacent segment midpoint separation.
        acceleration = np.linalg.norm(np.diff(velocity, axis=0), axis=1) / ((dt[:-1] + dt[1:]) / 2)
        require(
            not len(acceleration) or np.max(acceleration) <= LIMITS["max_acceleration_mps2"][kind],
            f"{ref}: acceleration limit",
            "DYNAMIC_LIMIT",
        )
        cx, cy, cz = a["center_offset_m"]
        radius = math.hypot(cx, cy)
        omega = (
            np.array([math.remainder(delta, 2 * math.pi) for delta in np.diff(values[:, 4])]) / dt
        )
        speed_bound = np.linalg.norm(velocity, axis=1) + np.abs(omega) * radius
        require(
            np.max(speed_bound) <= LIMITS["max_speed_mps"][kind],
            f"{ref}: geometric-center speed limit",
            "DYNAMIC_LIMIT",
        )
        # Centripetal acceleration inside each segment, plus midpoint finite differences at knots.
        require(
            np.max(omega**2 * radius) <= LIMITS["max_acceleration_mps2"][kind],
            f"{ref}: geometric-center rotational acceleration limit",
            "DYNAMIC_LIMIT",
        )
        center_values = values[:, 1:4].copy()
        center_values[:, 0] += cx * np.cos(values[:, 4]) - cy * np.sin(values[:, 4])
        center_values[:, 1] += cx * np.sin(values[:, 4]) + cy * np.cos(values[:, 4])
        center_values[:, 2] += cz
        center_velocity = np.diff(center_values, axis=0) / dt[:, None]
        center_acceleration = np.linalg.norm(np.diff(center_velocity, axis=0), axis=1) / (
            (dt[:-1] + dt[1:]) / 2
        )
        angular_acceleration = np.abs(np.diff(omega)) / ((dt[:-1] + dt[1:]) / 2)
        acceleration_bound = (
            acceleration
            + angular_acceleration * radius
            + np.maximum(omega[:-1] ** 2, omega[1:] ** 2) * radius
        )
        require(
            np.max(np.linalg.norm(center_velocity, axis=1)) <= LIMITS["max_speed_mps"][kind]
            and (
                not len(center_acceleration)
                or np.max(center_acceleration) <= LIMITS["max_acceleration_mps2"][kind]
            )
            and (
                not len(acceleration_bound)
                or np.max(acceleration_bound) <= LIMITS["max_acceleration_mps2"][kind]
            ),
            f"{ref}: geometric-center acceleration/speed limit",
            "DYNAMIC_LIMIT",
        )
        a["reference_samples"] = rows
        a["samples"] = centered_samples(rows, a["center_offset_m"])
    require(seen == ids, "Missing maneuver", "INVALID_TRAJECTORY")
    trigger(board.find("StopTrigger"), duration)
    diagnostics = check_map(actors, context)
    return {
        "schema_version": 1,
        "id": uuid.uuid4().hex,
        "mode": "imported",
        "profile": PROFILE,
        "map_id": context["map_id"],
        "source": {
            "scene": context["scene"],
            "origin_global_m": copy.deepcopy(context["coordinates"]["origin_global_m"]),
        },
        "interval_s": [0, duration],
        "actors": actors,
        "import": {"sha256": hashlib.sha256(xml_bytes).hexdigest(), "diagnostics": diagnostics},
        "environment": {
            "polygons": copy.deepcopy(context["polygons"]),
            "lines": [],
            "buildings": [],
            "trees": [],
            "poles": [],
            "warnings": [d["message"] for d in diagnostics],
            "provenance": ["Bound source map snapshot"],
        },
    }


def normalized_xml(xml_bytes):
    root = parse_xml(xml_bytes)
    for poly in root.findall(".//FollowTrajectoryAction/Trajectory/Shape/Polyline"):
        rows = [{"t_s": number(v, "time"), **pose(one(v, "Position"))} for v in poly]
        dense = centered_samples(rows, [0, 0, 0])
        for vertex in list(poly):
            poly.remove(vertex)
        for row in dense:
            vertex = E.SubElement(poly, "Vertex", time=str(row["t_s"]))
            position = E.SubElement(vertex, "Position")
            E.SubElement(
                position,
                "WorldPosition",
                x=str(row["x_m"]),
                y=str(row["y_m"]),
                z=str(row["z_m"]),
                h=str(row["yaw_rad"]),
                p="0",
                r="0",
            )
    payload = E.tostring(root, encoding="utf-8", xml_declaration=True, pretty_print=True)
    require(
        len(payload) <= LIMITS["max_xml_bytes"],
        "Normalized trajectory exceeds XML resource budget",
        "RESOURCE_LIMIT",
    )
    return payload


def sample_xosc(context, moving=False):
    """Local acceptance fixture, never a substitute for a future generator."""
    import xml.etree.ElementTree as ET

    from shapely.geometry import Point
    from shapely.ops import unary_union

    from topeye.scenario.export import node, scenario_xml
    from topeye.scenario.map_context import DRIVABLE, footprint

    surfaces, obstacles = verify_context(context)
    road = unary_union([p for k, p in surfaces if k in DRIVABLE])
    static = unary_union(obstacles)
    xmin, ymin, xmax, ymax = context["bounds_m"]
    candidates = []
    # Regular grid, anchored to source coordinates, makes fixtures reproducible.
    for x in np.arange(math.ceil(xmin + 5), xmax - 5, 2.0):
        for y in np.arange(math.ceil(ymin + 5), ymax - 5, 2.0):
            actor = {"length_m": 4.5, "width_m": 1.8}
            p = footprint(actor, {"x_m": float(x), "y_m": float(y), "yaw_rad": 0})
            if (
                road.covers(p.buffer(2.1 if moving else 0.1))
                and not static.intersects(p.buffer(2.1 if moving else 0.1))
                and all(Point(x, y).distance(Point(*q)) > 8 for q in candidates)
            ):
                candidates.append((float(x), float(y)))
                if len(candidates) == 3:
                    break
        if len(candidates) == 3:
            break
    require(len(candidates) == 3, "Map lacks space for acceptance fixture", "MAP_UNAVAILABLE")
    actors = []
    for i, (x, y) in enumerate(candidates):
        actors.append(
            {
                "id": ["ego", "car", "person"][i],
                "role": "ego" if i == 0 else "traffic",
                "category": "vehicle.car",
                "length_m": 4.5 if i < 2 else 0.5,
                "width_m": 1.8 if i < 2 else 0.5,
                "height_m": 1.6,
                "samples": [
                    {"t_s": t, "x_m": x + (t if moving else 0), "y_m": y, "z_m": 0, "yaw_rad": 0}
                    for t in (0, 1, 2)
                ],
            }
        )
    root = scenario_xml({"schema_version": 1, "actors": actors, "interval_s": [0, 2]})
    root.find("RoadNetwork").clear()
    root.find(
        "Storyboard/StopTrigger/ConditionGroup/Condition/ByValueCondition/SimulationTimeCondition"
    ).set("value", "2")
    for i, obj in enumerate(root.find("Entities")):
        model = obj[0]
        if i == 2:
            bbox = copy.deepcopy(model.find("BoundingBox"))
            obj.remove(model)
            model = node(
                obj, "Pedestrian", name="person", model="", mass=70, pedestrianCategory="pedestrian"
            )
            node(model, "ParameterDeclarations")
            model.append(bbox)
            node(model, "Properties")
        model.find("BoundingBox/Center").set("z", str(actors[i]["height_m"] / 2))
        for name, value in [
            ("topeye.map_id", context["map_id"]),
            ("topeye.profile", PROFILE),
            ("topeye.role", actors[i]["role"]),
        ]:
            node(model.find("Properties"), "Property", name=name, value=value)
    xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    validate_xosc(xml, context)
    return xml
