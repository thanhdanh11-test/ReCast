"""Team `real2sim` replay packages (plan43): a separate, replay-only admission path.

Authored scenarios keep the strict `validate_xosc` + `check_map` gate. Recorded traffic legitimately leaves that
gate's surfaces (parked cars, barriers), so here map and dynamics findings are notes, never rejections. Only
replay behaviour is understood; any other action is refused by name instead of being silently ignored.
"""

import copy
import csv
import hashlib
import io
import itertools
import json
import math
import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path

import numpy as np
from lxml import etree as E
from shapely.ops import unary_union
from shapely.prepared import prep

from topeye.scenario.map_context import (
    DRIVABLE,
    centered_samples,
    footprint,
    verify_context,
)
from topeye.scenario.map_context import (
    LIMITS as APP_LIMITS,
)
from topeye.scenario.models import ScenarioError, finite, guard_output, require, sha256, write_json

KIND = "real2sim"
PROFILE = "real2sim-replay-v1"
LIMITS = {
    "max_xosc_bytes": 4 * 1024 * 1024,
    "max_report_bytes": 256 * 1024,
    "max_csv_bytes": 1536 * 1024,
    "max_actors": 256,
    "max_vertices": 200_000,
    "max_duration_s": 120,
}
REPORT, CSV = "report.json", "trajectories.csv"
CSV_HEADER = ["scene", "time_s", "object_id", "category", "x_m", "y_m", "yaw_rad", "length_m", "width_m", "height_m"]
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}")
CATEGORY = re.compile(r"(vehicle|human|movable_object|static_object|animal)(\.[a-z_]+)+")
VEHICLE = {
    "car": "vehicle.car",
    "van": "vehicle.car",
    "truck": "vehicle.truck",
    "bus": "vehicle.bus.rigid",
    "motorbike": "vehicle.motorcycle",
    "bicycle": "vehicle.bicycle",
}
STATIC = ("movable_object.", "static_object.")
EPS = 1e-6


def fail(code, message):
    raise ScenarioError(code, message)


# ---------------------------------------------------------------- XML
def parse_xml(data):
    require(len(data) <= LIMITS["max_xosc_bytes"], "XOSC real2sim tối đa 4 MiB", "RESOURCE_LIMIT")
    upper = data.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        fail("UNSUPPORTED_XOSC", "DTD/entities forbidden")
    parser = E.XMLParser(
        resolve_entities=False, no_network=True, load_dtd=False, remove_comments=True, huge_tree=False
    )
    try:
        root = E.fromstring(data, parser)
    except E.XMLSyntaxError as exc:
        fail("INVALID_XML", str(exc))
    if root.getroottree().docinfo.doctype or root.getroottree().xpath("//processing-instruction()"):
        fail("UNSUPPORTED_XOSC", "DTD and processing instructions forbidden")
    for count, element in enumerate(root.iter(), 1):
        require(
            count <= 200_000 and len(list(element.iterancestors())) < 32,
            "XML complexity exceeded",
            "RESOURCE_LIMIT",
        )
        require(isinstance(element.tag, str), "Unsupported XML node", "UNSUPPORTED_XOSC")
        if any("$" in v for v in element.attrib.values()):
            fail("UNSUPPORTED_XOSC", "Parameter references forbidden")
    require(root.tag == "OpenSCENARIO", "Not an OpenSCENARIO file", "UNSUPPORTED_XOSC")
    header = root.find("FileHeader")
    require(
        header is not None and header.get("revMajor") == "1" and header.get("revMinor") in {"0", "1", "2"},
        "Only OpenSCENARIO XML 1.0–1.2 supported",
        "UNSUPPORTED_XOSC",
    )
    return root


def number(element, key, default=None):
    raw = element.get(key)
    if raw is None and default is not None:
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        fail("INVALID_TRAJECTORY", f"Invalid {element.tag}.{key}")
    require(math.isfinite(value), f"Nonfinite {element.tag}.{key}", "INVALID_TRAJECTORY")
    return value


def only(element, tag):
    require(
        len(element) == 1 and element[0].tag == tag,
        f"Unsupported content in {element.tag}: {[c.tag for c in element]}",
        "UNSUPPORTED_XOSC",
    )
    return element[0]


def world(position):
    w = only(position, "WorldPosition")
    for key in ("p", "r"):
        require(number(w, key, 0.0) == 0, "WorldPosition requires p=r=0", "UNSUPPORTED_XOSC")
    return {
        "x_m": number(w, "x"),
        "y_m": number(w, "y"),
        "z_m": number(w, "z", 0.0),
        "yaw_rad": number(w, "h", 0.0),
    }


def sim_time(trigger):
    """Start time of a trigger that is exactly one zero-delay SimulationTimeCondition."""
    condition = only(only(trigger, "ConditionGroup"), "Condition")
    sim = only(only(condition, "ByValueCondition"), "SimulationTimeCondition")
    require(
        number(condition, "delay", 0.0) == 0
        and sim.get("rule") in {"greaterThan", "greaterOrEqual", "equalTo"},
        "Only zero-delay simulation-time triggers supported",
        "UNSUPPORTED_XOSC",
    )
    value = number(sim, "value")
    require(0 <= value <= LIMITS["max_duration_s"] + 1, "Trigger time out of range", "INVALID_TRAJECTORY")
    return value


def actor_model(obj):
    name = obj.get("name", "")
    require(NAME.fullmatch(name), f"Invalid actor ID: {name!r}", "INVALID_TRAJECTORY")
    require(len(obj) == 1, f"{name}: one inline model required", "UNSUPPORTED_XOSC")
    model = obj[0]
    require(
        model.tag in {"Vehicle", "MiscObject", "Pedestrian"},
        f"{name}: unsupported entity {model.tag}",
        "UNSUPPORTED_XOSC",
    )
    props = {
        p.get("name"): p.get("value")
        for p in model.iterfind("Properties/Property")
        if isinstance(p.get("name"), str) and isinstance(p.get("value"), str)
    }
    tagged = props.get("nuscenes_category", "")
    if tagged == "vehicle.ego":
        category = "vehicle.car"
    elif CATEGORY.fullmatch(tagged) and len(tagged) <= 64:
        category = tagged
    elif model.tag == "Vehicle":
        category = VEHICLE.get(model.get("vehicleCategory"), "vehicle.car")
    elif model.tag == "Pedestrian":
        category = "human.pedestrian.adult"
    else:
        misc = re.sub(r"[^a-z_]", "", (model.get("miscObjectCategory") or "obstacle").lower())[:32]
        category = f"movable_object.{misc or 'obstacle'}"
    bbox = model.find("BoundingBox")
    require(bbox is not None, f"{name}: missing BoundingBox", "INVALID_TRAJECTORY")
    center, dims = bbox.find("Center"), bbox.find("Dimensions")
    require(center is not None and dims is not None, f"{name}: incomplete BoundingBox", "INVALID_TRAJECTORY")
    size = {f"{k}_m": number(dims, k) for k in ("length", "width", "height")}
    offset = [number(center, k, 0.0) for k in ("x", "y", "z")]
    require(
        all(0 < v <= 30 for v in size.values()) and all(abs(v) <= 30 for v in offset),
        f"{name}: invalid/unbounded bbox",
        "INVALID_TRAJECTORY",
    )
    ego = name == "ego" or tagged == "vehicle.ego"
    return {
        "id": name,
        "role": "ego" if ego else "traffic",
        "category": category,
        **size,
        "center_offset_m": offset,
    }


def entity_action(global_action):
    """(entity, 'add', pose) | (entity, 'delete', None) from a GlobalAction/EntityAction."""
    entity = only(global_action, "EntityAction")
    ref = entity.get("entityRef", "")
    require(len(entity) == 1, "EntityAction needs exactly one action", "UNSUPPORTED_XOSC")
    action = entity[0]
    if action.tag == "DeleteEntityAction":
        require(not len(action), "DeleteEntityAction must be empty", "UNSUPPORTED_XOSC")
        return ref, "delete", None
    require(action.tag == "AddEntityAction", f"Unsupported entity action {action.tag}", "UNSUPPORTED_XOSC")
    return ref, "add", world(only(action, "Position"))


def private_action(private):
    """('teleport', pose) | ('trajectory', rows) from a PrivateAction."""
    require(len(private) == 1, "PrivateAction needs exactly one action", "UNSUPPORTED_XOSC")
    action = private[0]
    if action.tag == "TeleportAction":
        return "teleport", world(only(action, "Position"))
    require(action.tag == "RoutingAction", f"Unsupported private action {action.tag}", "UNSUPPORTED_XOSC")
    follow = only(action, "FollowTrajectoryAction")
    tags = [c.tag for c in follow]
    require(
        sorted(tags) in (
            ["TimeReference", "Trajectory", "TrajectoryFollowingMode"],
            ["TimeReference", "TrajectoryFollowingMode", "TrajectoryRef"],
        ),
        f"Unsupported FollowTrajectoryAction content: {tags}",
        "UNSUPPORTED_XOSC",
    )
    trajectory = follow.find("Trajectory")
    if trajectory is None:
        trajectory = only(follow.find("TrajectoryRef"), "Trajectory")
    require(
        follow.find("TrajectoryFollowingMode").get("followingMode") == "position",
        "Only position trajectory following supported",
        "UNSUPPORTED_XOSC",
    )
    timing = only(follow.find("TimeReference"), "Timing")
    require(
        timing.get("domainAbsoluteRelative") == "absolute"
        and number(timing, "scale", 1.0) == 1
        and number(timing, "offset", 0.0) == 0,
        "Only absolute unscaled trajectory timing supported",
        "UNSUPPORTED_XOSC",
    )
    require(trajectory.get("closed", "false") == "false", "Closed trajectory unsupported", "UNSUPPORTED_XOSC")
    shape = trajectory.find("Shape")
    require(shape is not None, "Trajectory shape missing", "UNSUPPORTED_XOSC")
    poly = only(shape, "Polyline")
    rows = []
    for vertex in poly:
        require(vertex.tag == "Vertex", "Only polyline vertices supported", "UNSUPPORTED_XOSC")
        rows.append({"t_s": number(vertex, "time"), **world(only(vertex, "Position"))})
    require(rows, "Empty trajectory", "INVALID_TRAJECTORY")
    require(
        all(b["t_s"] > a["t_s"] for a, b in itertools.pairwise(rows)),
        "Trajectory time must increase",
        "INVALID_TRAJECTORY",
    )
    return "trajectory", rows


def read_xosc(data):
    """Actors with lifetime and reference samples, plus the scenario stop time."""
    root = parse_xml(data)
    entities = root.find("Entities")
    require(entities is not None and len(entities), "No entities", "INVALID_TRAJECTORY")
    require(len(entities) <= LIMITS["max_actors"], "Quá nhiều đối tượng (tối đa 256)", "RESOURCE_LIMIT")
    actors = {}
    for obj in entities:
        require(obj.tag == "ScenarioObject", f"Unsupported entity {obj.tag}", "UNSUPPORTED_XOSC")
        actor = actor_model(obj)
        require(actor["id"] not in actors, f"Duplicate actor ID {actor['id']}", "INVALID_TRAJECTORY")
        actors[actor["id"]] = {**actor, "_pose": None, "_rows": None, "_add": None, "_del": [], "_hidden": False}
    require(sum(a["role"] == "ego" for a in actors.values()) == 1, "Exactly one ego required", "INVALID_TRAJECTORY")

    def known(ref):
        require(ref in actors, f"Unknown entity {ref!r}", "INVALID_TRAJECTORY")
        return actors[ref]

    board = root.find("Storyboard")
    require(board is not None, "Storyboard missing", "UNSUPPORTED_XOSC")
    init = board.find("Init/Actions")
    for action in [] if init is None else init:
        if action.tag == "Private":
            actor = known(action.get("entityRef"))
            for pa in action:
                require(pa.tag == "PrivateAction", f"Unsupported Init {pa.tag}", "UNSUPPORTED_XOSC")
                kind, value = private_action(pa)
                require(kind == "teleport", "Init trajectories unsupported", "UNSUPPORTED_XOSC")
                actor["_pose"] = value
        elif action.tag == "GlobalAction":
            ref, kind, _ = entity_action(action)
            require(kind == "delete", "Init AddEntityAction unsupported", "UNSUPPORTED_XOSC")
            known(ref)["_hidden"] = True
        else:
            fail("UNSUPPORTED_XOSC", f"Unsupported Init action {action.tag}")
    for story in board.findall("Story"):
        for act in story:
            if act.tag == "ParameterDeclarations":
                require(not len(act), "Story parameters forbidden", "UNSUPPORTED_XOSC")
                continue
            require(act.tag == "Act", f"Unsupported Story child {act.tag}", "UNSUPPORTED_XOSC")
            for child in act:
                if child.tag == "StartTrigger":
                    require(sim_time(child) == 0, "Act must start at t=0", "UNSUPPORTED_XOSC")
                    continue
                if child.tag == "StopTrigger":
                    require(not len(child), "Act stop trigger unsupported", "UNSUPPORTED_XOSC")
                    continue
                require(child.tag == "ManeuverGroup", f"Unsupported Act child {child.tag}", "UNSUPPORTED_XOSC")
                refs = [e.get("entityRef") for e in child.iterfind("Actors/EntityRef")]
                for maneuver in child.findall("Maneuver"):
                    for event in maneuver:
                        if event.tag == "ParameterDeclarations":
                            require(not len(event), "Maneuver parameters forbidden", "UNSUPPORTED_XOSC")
                            continue
                        require(event.tag == "Event", f"Unsupported Maneuver child {event.tag}", "UNSUPPORTED_XOSC")
                        trigger = event.find("StartTrigger")
                        require(trigger is not None, "Event without StartTrigger", "UNSUPPORTED_XOSC")
                        at = sim_time(trigger)
                        for action in event.findall("Action"):
                            require(len(action) == 1, "Action needs exactly one child", "UNSUPPORTED_XOSC")
                            inner = action[0]
                            if inner.tag == "GlobalAction":
                                ref, kind, pose = entity_action(inner)
                                actor = known(ref)
                                if kind == "add":
                                    require(actor["_add"] is None, f"{ref}: added twice", "UNSUPPORTED_XOSC")
                                    actor["_add"] = (at, pose)
                                else:
                                    actor["_del"].append(at)
                                continue
                            require(inner.tag == "PrivateAction", f"Unsupported action {inner.tag}", "UNSUPPORTED_XOSC")
                            require(len(refs) == 1, "Private action needs one actor", "UNSUPPORTED_XOSC")
                            actor = known(refs[0])
                            kind, value = private_action(inner)
                            if kind == "teleport":
                                require(at == 0 and actor["_pose"] is None, "Teleport only at t=0", "UNSUPPORTED_XOSC")
                                actor["_pose"] = value
                            else:
                                # Absolute timing: vertex times are scenario times whatever the event start.
                                require(at <= value[0]["t_s"] + 0.2, f"{actor['id']}: trajectory starts after its first vertex", "UNSUPPORTED_XOSC")
                                require(actor["_rows"] is None, f"{actor['id']}: two trajectories", "UNSUPPORTED_XOSC")
                                actor["_rows"] = value
    stop = board.find("StopTrigger")
    end = sim_time(stop) if stop is not None and len(stop) else None
    return actors, end


def lifetimes(actors, end):
    total = 0
    result = []
    horizon = end
    for a in actors.values():
        rows = a["_rows"]
        if a["_hidden"]:
            if a["_add"] is None:
                continue  # never shown
            start, pose = a["_add"]
        else:
            start, pose = 0.0, a["_pose"]
        later = sorted(t for t in a["_del"] if t >= start - EPS)
        stop = later[0] if later else None
        if rows:
            last = stop if stop is not None else rows[-1]["t_s"]
            kept = [r for r in rows if start - 0.2 <= r["t_s"] <= last + EPS]
            require(kept, f"{a['id']}: no trajectory inside its lifetime", "INVALID_TRAJECTORY")
        else:
            require(pose is not None, f"{a['id']}: no position", "INVALID_TRAJECTORY")
            last = stop if stop is not None else horizon
            require(last is not None and last > start, f"{a['id']}: static actor without lifetime", "INVALID_TRAJECTORY")
            kept = [{"t_s": start, **pose}, {"t_s": last, **pose}]
        total += len(kept)
        require(total <= LIMITS["max_vertices"], "Quá nhiều đỉnh quỹ đạo", "RESOURCE_LIMIT")
        reference = [{**r, "observed": False} for r in kept]
        actor = {k: v for k, v in a.items() if not k.startswith("_")}
        actor["reference_samples"] = reference
        actor["samples"] = centered_samples(reference, actor["center_offset_m"])
        result.append(actor)
    require(any(a["role"] == "ego" for a in result), "Ego never appears", "INVALID_TRAJECTORY")
    duration = max(a["reference_samples"][-1]["t_s"] for a in result)
    require(0 < duration <= LIMITS["max_duration_s"], "Thời lượng phải trong 0–120 s", "INVALID_TRAJECTORY")
    return result, duration


# ---------------------------------------------------------------- report / csv
def text(value, limit=200):
    return value[:limit] if isinstance(value, str) else None


def num(value):
    return float(value) if finite(value) else None


def numbers(value, keys=None):
    if not isinstance(value, dict):
        return {}
    return {k: float(v) for k, v in value.items() if (keys is None or k in keys) and finite(v) and len(k) <= 64}


def per_actor(value, keys):
    if not isinstance(value, dict):
        return {}
    return {
        k: numbers(v, keys) | {f: text(v.get(f), 64) for f in ("leader",) if isinstance(v, dict) and text(v.get(f), 64)}
        for k, v in list(value.items())[: LIMITS["max_actors"]]
        if isinstance(k, str) and len(k) <= 64 and isinstance(v, dict)
    }


def short(value):
    """One display line for an arbitrary JSON value (never raises)."""
    if isinstance(value, str):
        return value[:200]
    return json.dumps(value, ensure_ascii=False, default=str)[:200]


def read_report(data, notes):
    """Filtered `Real2simReport` (plan43 01 §3); bad fields become null plus a REPORT_FIELD note."""
    require(len(data) <= LIMITS["max_report_bytes"], "report.json tối đa 256 KiB", "RESOURCE_LIMIT")
    try:
        raw = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ScenarioError("INVALID_INPUT", "report.json không phải JSON hợp lệ") from exc
    require(isinstance(raw, dict), "report.json phải là object", "INVALID_INPUT")

    def field(key, kind):
        value = raw.get(key)
        if value is not None and not isinstance(value, kind):
            notes.append({"code": "REPORT_FIELD", "message": f"report.json: trường {key} sai kiểu, bỏ qua"})
            return None
        return value

    event = field("event", dict)
    drivers = field("drivers", dict)
    ego = field("ego", dict)
    checks = field("checks", dict) or {}
    esmini = field("esmini", dict)
    run = field("run", dict)
    valid = raw.get("valid")
    return {
        "id": text(raw.get("id")) or "",
        "scene": text(raw.get("scene"), 64) or "",
        "source": text(raw.get("source"), 64) or "",
        "valid": valid if isinstance(valid, bool) else None,
        "reasons": [text(r) for r in (field("reasons", list) or [])[:50] if text(r)],
        "group": text(raw.get("group"), 64),
        "event": {
            "actor": text(event.get("actor"), 64) or "",
            "t0": num(event.get("t0")),
            "decel": num(event.get("decel")),
            "target": text(event.get("target"), 64) or "",
            "dwell": num(event.get("dwell")),
        }
        if event
        else None,
        "drivers": {
            "react": bool(drivers.get("react")),
            "reaction_s": num(drivers.get("reaction_s")),
            "thresholds": numbers(drivers.get("thresholds")),
            "per_vehicle": per_actor(drivers.get("per_vehicle"), {"T", "s0", "max_decel"}),
        }
        if drivers
        else None,
        "ego": {
            **numbers(ego, {"stimulus", "a_min", "a_used", "min_gap", "min_ttc", "recorded_min_gap", "recorded_min_ttc"}),
            **({"conflict_with": text(ego.get("conflict_with"), 64)} if text(ego.get("conflict_with"), 64) else {}),
        }
        if ego
        else None,
        "reacted": [text(r, 64) for r in (field("reacted", list) or [])[: LIMITS["max_actors"]] if text(r, 64)],
        "max_decel_used": numbers(field("max_decel_used", dict)),
        "physics": per_actor(
            checks.get("physics"),
            {"max_speed", "max_accel", "t_accel", "max_decel", "t_decel", "limit_accel", "limit_decel"},
        ),
        "gaps": per_actor(checks.get("gaps"), {"gap", "t", "speed"}),
        "collisions": [short(c) for c in (field("collisions", list) or [])[:50]],
        "esmini": {
            "exit": num(esmini.get("exit")),
            "version": text(esmini.get("version"), 64),
            "problems": [
                short(p) for p in (esmini.get("problems") if isinstance(esmini.get("problems"), list) else [])[:50]
            ],
            "replay_error_m": per_actor(esmini.get("replay_error_m"), {"mean", "max"}),
        }
        if esmini
        else None,
        "run": {
            "created": text(run.get("created"), 64),
            "commit": text((run.get("code") or {}).get("commit"), 64) if isinstance(run.get("code"), dict) else None,
            "dirty": (run.get("code") or {}).get("dirty") if isinstance(run.get("code"), dict)
            and isinstance(run["code"].get("dirty"), bool) else None,
            "esmini_version": text((run.get("esmini") or {}).get("version"), 64)
            if isinstance(run.get("esmini"), dict) else None,
            "dt": num((run.get("config") or {}).get("dt")) if isinstance(run.get("config"), dict) else None,
            "road": text((run.get("config") or {}).get("road"), 64) if isinstance(run.get("config"), dict) else None,
        }
        if run
        else None,
        # plan46 C2: the reactive detail block of a topeye package, forwarded as is (shallow type check only)
        "topeye": raw["topeye"] if isinstance(raw.get("topeye"), dict) else None,
    }


def check_csv(data, ids):
    require(len(data) <= LIMITS["max_csv_bytes"], "trajectories.csv tối đa 1,5 MiB", "RESOURCE_LIMIT")
    try:
        rows = csv.reader(io.StringIO(data.decode("utf-8")))
        header = next(rows, None)
    except UnicodeDecodeError as exc:
        raise ScenarioError("INVALID_INPUT", "trajectories.csv không phải UTF-8") from exc
    require(header == CSV_HEADER, "trajectories.csv sai tiêu đề cột", "INVALID_INPUT")
    count = 0
    for row in rows:
        count += 1
        require(len(row) == len(CSV_HEADER), f"trajectories.csv dòng {count + 1}: sai số cột", "INVALID_INPUT")
        require(row[2] in ids, f"trajectories.csv: đối tượng lạ {row[2][:64]!r}", "INVALID_INPUT")
        try:
            values = [float(v) for v in row[4:]] + [float(row[1])]
        except ValueError as exc:
            raise ScenarioError("INVALID_INPUT", f"trajectories.csv dòng {count + 1}: số không hợp lệ") from exc
        require(all(math.isfinite(v) for v in values), "trajectories.csv: số không hữu hạn", "INVALID_INPUT")
    return count


# ---------------------------------------------------------------- notes
def map_notes(actors, context):
    """Non-blocking map/dynamics findings: first occurrence per actor and kind."""
    surfaces, obstacles = verify_context(context)
    drive = prep(unary_union([p for k, p in surfaces if k in DRIVABLE]))
    walk = prep(unary_union([p for k, p in surfaces if k in DRIVABLE | {"walkway", "ped_crossing"}]))
    blocked = prep(unary_union(obstacles)) if obstacles else None
    xmin, ymin, xmax, ymax = context["bounds_m"]
    notes = []
    for actor in actors:
        static = actor["category"].startswith(STATIC)
        surface = walk if actor["category"].startswith("human.") else drive
        seen = set()
        for row in actor["samples"][::2]:
            at = f" lúc t={row['t_s']:.2f}s"
            p = footprint(actor, row)
            if "out" not in seen and not (xmin <= row["x_m"] <= xmax and ymin <= row["y_m"] <= ymax):
                seen.add("out")
                notes.append({"code": "MAP_NOTE_OUTSIDE", "actor_id": actor["id"], "t_s": row["t_s"],
                              "message": f"{actor['id']} ra ngoài vùng map{at}"})
            elif not static and "surface" not in seen and not surface.covers(p):
                seen.add("surface")
                notes.append({"code": "MAP_NOTE_SURFACE", "actor_id": actor["id"], "t_s": row["t_s"],
                              "message": f"{actor['id']} ra ngoài mặt đường{at}"})
            if not static and blocked is not None and "obstacle" not in seen and blocked.intersects(p):
                seen.add("obstacle")
                notes.append({"code": "MAP_NOTE_OBSTACLE", "actor_id": actor["id"], "t_s": row["t_s"],
                              "message": f"{actor['id']} chạm vật cản ước lượng{at}"})
            if len(seen) == 3:
                break
        notes.extend(dynamics_note(actor))
    return notes


DYNAMICS_STEP_S = 0.1
ACCEL_WINDOW_S = 0.5


def dynamics_note(actor):
    """Speed/acceleration vs the app limits on a uniform 0.1 s resampling.

    Finite differences straight on the vertices explode where two vertices are 1 ms apart (seen in real2sim
    output at keyframe joins), so the trajectory is resampled first; findings stay notes, never rejections.
    """
    rows = actor["reference_samples"]
    t = np.array([r["t_s"] for r in rows])
    if t[-1] - t[0] < 3 * DYNAMICS_STEP_S:
        return []
    grid = np.arange(t[0], t[-1] + EPS, DYNAMICS_STEP_S)
    xy = np.stack([np.interp(grid, t, [r[k] for r in rows]) for k in ("x_m", "y_m")], axis=1)
    velocity = np.diff(xy, axis=0) / DYNAMICS_STEP_S
    speed = np.linalg.norm(velocity, axis=1)
    # Over 0.5 s (the nuScenes keyframe spacing): linear interpolation between 2 Hz keyframes kinks the
    # velocity at every keyframe, which a 0.1 s difference would report as a spike.
    lag = round(ACCEL_WINDOW_S / DYNAMICS_STEP_S)
    accel = np.linalg.norm(velocity[lag:] - velocity[:-lag], axis=1) / ACCEL_WINDOW_S
    kind = "pedestrian" if actor["category"].startswith("human.") else "vehicle"
    for values, limit, label, unit in (
        (speed, APP_LIMITS["max_speed_mps"][kind], "tốc độ", "m/s"),
        (accel, APP_LIMITS["max_acceleration_mps2"][kind], "gia tốc", "m/s²"),
    ):
        i = int(np.argmax(values)) if len(values) else 0
        if len(values) and values[i] > limit:
            at = float(grid[min(i + 1, len(grid) - 1)])
            return [{"code": "DYNAMIC_NOTE", "actor_id": actor["id"], "t_s": at,
                     "message": f"{actor['id']} {label} {values[i]:.1f} {unit} lúc t={at:.2f}s vượt ngưỡng app ({limit} {unit})"}]
    return []


# ---------------------------------------------------------------- package
def split_files(files):
    """{name: bytes} → (xosc name, xosc bytes, report bytes | None, csv bytes | None)."""
    require(isinstance(files, dict) and files, "Chưa chọn file nào", "INVALID_INPUT")
    xosc = [n for n in files if n.lower().endswith(".xosc")]
    require(len(xosc) == 1, "Gói phải có đúng 1 file .xosc", "INVALID_INPUT")
    unknown = set(files) - {xosc[0], REPORT, CSV}
    require(not unknown, f"File không thuộc gói real2sim: {sorted(unknown)[:3]}", "INVALID_INPUT")
    return xosc[0], files[xosc[0]], files.get(REPORT), files.get(CSV)


def parse_package(files, context):
    verify_context(context)
    name, xml_bytes, report_bytes, csv_bytes = split_files(files)
    raw_actors, end = read_xosc(xml_bytes)
    actors, duration = lifetimes(raw_actors, end)
    notes = []
    report = read_report(report_bytes, notes) if report_bytes is not None else None
    if report and report["scene"]:
        require(
            report["scene"] == context["scene"],
            f"Gói thuộc cảnh {report['scene']}, đang nạp {context['scene']}",
            "MAP_MISMATCH",
        )
    if csv_bytes is not None:
        check_csv(csv_bytes, set(raw_actors))
    notes += map_notes(actors, context)
    return {
        "schema_version": 1,
        "id": uuid.uuid4().hex,
        "mode": "imported",
        "kind": KIND,
        "profile": PROFILE,
        "map_id": context["map_id"],
        "source": {
            "scene": context["scene"],
            "origin_global_m": copy.deepcopy(context["coordinates"]["origin_global_m"]),
        },
        "interval_s": [0, duration],
        "actors": actors,
        "report": report,
        "import": {
            "sha256": hashlib.sha256(xml_bytes).hexdigest(),
            "file_name": name[:120],
            "diagnostics": notes,
        },
        "environment": {
            "polygons": copy.deepcopy(context["polygons"]),
            "lines": [],
            "buildings": [],
            "trees": [],
            "poles": [],
            "warnings": [],
            "provenance": ["real2sim package on the bound source map"],
        },
    }


def semantic(scenario):
    return {
        k: scenario.get(k)
        for k in ("schema_version", "mode", "kind", "profile", "map_id", "interval_s", "actors", "report", "import")
    }


STORED = {"original.xosc": "xosc", REPORT: "report", CSV: "csv"}


def persist_package(imported, files, context, workspace, dataset, display_name=None):
    _, xml_bytes, report_bytes, csv_bytes = split_files(files)
    checked = parse_package(files, context)
    checked["id"] = imported["id"]
    require(semantic(checked) == semantic(imported), "Import does not match package files", "HASH_MISMATCH")
    require(re.fullmatch(r"[a-f0-9]{32}", imported["id"]), "Invalid scenario identity")
    workspace = guard_output(workspace, dataset)
    destination = workspace / imported["id"]
    require(not destination.exists(), "Import already exists")
    workspace.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=".import-", dir=workspace))
    try:
        package = temp / "import"
        package.mkdir()
        (package / "original.xosc").write_bytes(xml_bytes)
        if report_bytes is not None:
            (package / REPORT).write_bytes(report_bytes)
        if csv_bytes is not None:
            (package / CSV).write_bytes(csv_bytes)
        write_json(package / "context.json", context)
        write_json(package / "scenario.json", json.loads(json.dumps(imported)))
        payloads = sorted(p.name for p in package.iterdir())
        write_json(
            package / "manifest.json",
            {
                "schema_version": 1,
                "kind": KIND,
                "scenario_id": imported["id"],
                "map_id": context["map_id"],
                "files": {n: sha256(package / n) for n in payloads},
                **({"display_name": display_name} if display_name else {}),
            },
        )
        os.rename(temp, destination)
        return destination / "import"
    except BaseException:
        shutil.rmtree(temp)
        raise


def is_package(package):
    try:
        manifest = json.loads((Path(package) / "manifest.json").read_text())
    except (OSError, ValueError):
        return False
    return isinstance(manifest, dict) and manifest.get("kind") == KIND


def load_package(package_path, context, dataset):
    raw = Path(package_path)
    require(not raw.is_symlink(), "Package symlink forbidden", "PATH_ESCAPE")
    package = guard_output(raw, dataset)
    require(package.is_dir(), "Import package missing", "IO_ERROR")
    try:
        manifest = json.loads((package / "manifest.json").read_text())
        require(
            isinstance(manifest, dict)
            and manifest.get("schema_version") == 1
            and manifest.get("kind") == KIND
            and isinstance(manifest.get("files"), dict),
            "Invalid import manifest",
            "HASH_MISMATCH",
        )
        names = set(manifest["files"])
        require(
            {"original.xosc", "context.json", "scenario.json"} <= names <= {"original.xosc", "context.json", "scenario.json", REPORT, CSV},
            "Invalid import manifest",
            "HASH_MISMATCH",
        )
        for name in names:
            p = package / name
            require(p.is_file() and not p.is_symlink(), "Missing or linked import payload", "PATH_ESCAPE")
            require(p.stat().st_size <= 32 * 1024 * 1024, "Oversized package payload", "RESOURCE_LIMIT")
            require(sha256(p) == manifest["files"][name], "Import integrity mismatch", "HASH_MISMATCH")
        stored = json.loads((package / "context.json").read_text())
        scenario = json.loads((package / "scenario.json").read_text())
        verify_context(stored)
        require(
            stored["map_id"] == context["map_id"] == manifest["map_id"] == scenario["map_id"],
            "Current map mismatch",
            "MAP_MISMATCH",
        )
        require(scenario["id"] == manifest["scenario_id"], "Import identity mismatch", "HASH_MISMATCH")
        files = {"scenario.xosc": (package / "original.xosc").read_bytes()}
        for name in (REPORT, CSV):
            if name in names:
                files[name] = (package / name).read_bytes()
        checked = parse_package(files, context)
        checked["id"] = scenario["id"]
        checked["import"]["file_name"] = scenario["import"]["file_name"]
        require(semantic(checked) == semantic(scenario), "Stored scenario differs from package", "HASH_MISMATCH")
        return scenario
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, ScenarioError):
            raise
        raise ScenarioError("HASH_MISMATCH", "Malformed import package") from exc
