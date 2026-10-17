"""Write one reactive outcome as a real2sim package (plan45 C4): `<name>.xosc` + report.json + trajectories.csv.

The XOSC writer is ported from replay-forge (phanhieunghia353) @ d36205b, real2sim/xosc.py: every moving object
replays a FollowTrajectoryAction (Polyline, absolute timing, position following) started at its first vertex;
static objects are only placed; an object present for part of the scene is added / removed PRESENCE_MARGIN
before / after its data. Vehicles whose motion changed get a vertex every DT; everything else keeps its source
timestamps (pilot poses there; the ego: its recording). The package is admitted by `real2sim.parse_package`.
"""

import csv
import io
import json
import math
import subprocess
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from topeye.scenario.models import require
from topeye.scenario.reactive import (
    DT,
    REACTIVE_VERSION,
    REASONS,
    TAILGATE_GAP,
    _vn,
    _wrap,
    centres,
    checks,
    find_leader,
    thresholds,
    variant_outcome,
)
from topeye.scenario.real2sim import CSV_HEADER, LIMITS

SubElement = ET.SubElement
PRESENCE_MARGIN = 0.1  # s
DETAIL_VERSION = "topeye-reactive-v2"
SERIES_STEP = 2  # grid steps (0.1 s) between chart points, as replay-forge app/api.py
SERIES_STEP_LARGE = 4  # 0.2 s, used when report.json would exceed its 256 KiB limit (plan46 C2)
TTC_CLAMP = 99.0  # s
MODE_NAMES = ("nominal", "waiting", "driving", "late", "event")  # reactive.NOMINAL..EVENT
TRIGGER_NOTE = ("Kích hoạt theo thời gian. File xuất ra dùng quỹ đạo tính sẵn: nếu xe tự lái của bạn chạy khác "
                "người lái mẫu, các xe khác không phản ứng lại.")
VEHICLE_CATEGORY = {
    "vehicle.truck": "truck",
    "vehicle.construction": "truck",
    "vehicle.trailer": "trailer",
    "vehicle.bus.bendy": "bus",
    "vehicle.bus.rigid": "bus",
    "vehicle.motorcycle": "motorbike",
    "vehicle.bicycle": "bicycle",
}


def file_stem(event):
    """`<name>_t<t0>_<target>_a<decel>`: the package's display name and XOSC file name."""
    if event.kind != "brake":
        suffix = ({"accelerate": f"v{event.target_mps:g}_a{event.accel_mps2:g}",
                   "stopline": f"d{event.dwell:g}",
                   "lane_change": f"{event.direction}_d{event.duration_s:g}"})[event.kind]
        return f"{event.actor}_t{event.t0:.1f}_{event.kind}_{suffix}"
    return f"{event.actor}_t{event.t0:.1f}_{event.target}_a{event.decel:g}"


def _num(value):
    return f"{value:.4f}"


def actor_poses(model, outcome, i):
    """(t, xy, yaw) the package replays for agent i."""
    a = model.agents[i]
    if outcome.changed[i]:
        s = outcome.S[:, i]
        ok = ~np.isnan(s)
        path = (outcome.path_override if outcome.event and outcome.event.kind == "lane_change"
                and a.name == outcome.event.actor else a.path)
        if path is a.path:
            xy, yaw = path.pos(s[ok]), path.heading(s[ok])
        else:
            poses = [(a.path.pos(sk), float(a.path.heading(sk))) if tk < outcome.event.t0
                     else path.pose(sk, tk, vk) for sk, tk, vk in zip(s[ok], model.t[ok], outcome.V[ok, i])]
            xy = np.asarray([p[0] for p in poses], float)
            yaw = np.asarray([p[1] for p in poses], float)
        return model.t[ok], xy, yaw
    nominal = model.nominal[i]
    if a.is_ego or len(nominal.t) <= 2:  # the recording itself / a pinned pose at first and last time
        return nominal.t, nominal.xy, nominal.yaw
    raw_t = model.tracks[i].t  # pilot poses at the source timestamps
    yaw = np.unwrap(nominal.yaw)
    xy = np.column_stack([np.interp(raw_t, nominal.t, nominal.xy[:, k]) for k in (0, 1)])
    return raw_t, xy, np.interp(raw_t, nominal.t, yaw)


def _vertices(t, xy, yaw):
    """Rows rounded as written, keeping strictly increasing times."""
    rows, last = [], None
    for ti, (x, y), h in zip(t, xy, yaw):
        if last is not None and round(float(ti), 4) <= last:
            continue
        last = round(float(ti), 4)
        rows.append((float(ti), float(x), float(y), float(h)))
    return rows


def _position(parent, x, y, h):
    SubElement(SubElement(parent, "Position"), "WorldPosition", x=_num(x), y=_num(y), h=_num(h))


def _trigger(parent, tag, name, value, rule="greaterOrEqual"):
    condition = SubElement(SubElement(SubElement(parent, tag), "ConditionGroup"), "Condition", name=name, delay="0",
                           conditionEdge="none")
    SubElement(SubElement(condition, "ByValueCondition"), "SimulationTimeCondition", value=_num(value), rule=rule)


def _entity(entities, agent, size):
    length, width, height = size  # the app's size: the ego's engine box (EGO_SIZE) is not written
    obj = SubElement(entities, "ScenarioObject", name=agent.name)
    if agent.kind == "vehicle":
        node = SubElement(obj, "Vehicle", name=agent.name,
                          vehicleCategory=VEHICLE_CATEGORY.get(agent.category, "car"))
    elif agent.kind == "pedestrian":
        node = SubElement(obj, "Pedestrian", name=agent.name, mass="80", model="pedestrian",
                          pedestrianCategory="pedestrian")
    else:
        node = SubElement(obj, "MiscObject", name=agent.name, mass="100", miscObjectCategory="obstacle")
    SubElement(node, "ParameterDeclarations")
    box = SubElement(node, "BoundingBox")
    SubElement(box, "Center", x="0", y="0", z=_num(height / 2))  # app samples are box centres (B4)
    SubElement(box, "Dimensions", width=_num(width), length=_num(length), height=_num(height))
    if agent.kind == "vehicle":
        SubElement(node, "Performance", maxSpeed="70", maxAcceleration="10", maxDeceleration="10")
        axles = SubElement(node, "Axles")
        for tag, x in (("FrontAxle", 0.6 * length), ("RearAxle", 0.0)):
            SubElement(axles, tag, maxSteering="0.5", wheelDiameter="0.6", trackWidth=_num(width * 0.85),
                       positionX=_num(x), positionZ="0.3")
    SubElement(SubElement(node, "Properties"), "Property", name="nuscenes_category", value=agent.category)


def _entity_action(parent, name, pose=None):
    action = SubElement(SubElement(parent, "GlobalAction"), "EntityAction", entityRef=name)
    if pose is None:
        SubElement(action, "DeleteEntityAction")
    else:
        _position(SubElement(action, "AddEntityAction"), *pose)


def build_xosc(model, tracks, event, description):
    """tracks: [(agent, rows)] with rows (t, x, y, yaw)."""
    root = ET.Element("OpenSCENARIO")
    SubElement(root, "FileHeader", revMajor="1", revMinor="1", date=datetime.now(UTC).replace(microsecond=0).isoformat(),
               description=description, author="topeye-reactive")
    # traceability only (replay-forge 4.8): changing these values does not change the motion
    params = SubElement(root, "ParameterDeclarations")
    for name, kind, value in (("event_actor", "string", event.actor), ("event_t0", "double", _num(event.t0)),
                              ("event_decel", "double", _num(event.decel)), ("event_target", "string", event.target),
                              ("event_dwell", "double", _num(event.dwell))):
        SubElement(params, "ParameterDeclaration", name=name, parameterType=kind, value=value)
    SubElement(root, "CatalogLocations")
    SubElement(root, "RoadNetwork")
    entities = SubElement(root, "Entities")
    for agent, _ in tracks:
        _entity(entities, agent, model.tracks[model.index[agent.name]].size)
    storyboard = SubElement(root, "Storyboard")
    actions = SubElement(SubElement(storyboard, "Init"), "Actions")
    spans = {}
    for agent, rows in tracks:
        appear, vanish = rows[0][0] - PRESENCE_MARGIN, rows[-1][0] + PRESENCE_MARGIN
        spans[agent.name] = (appear if appear > 0 else None, vanish if vanish < model.duration else None)
    for agent, _ in tracks:
        if spans[agent.name][0] is not None:
            _entity_action(actions, agent.name)
    for agent, rows in tracks:
        private = SubElement(actions, "Private", entityRef=agent.name)
        _position(SubElement(SubElement(private, "PrivateAction"), "TeleportAction"), *rows[0][1:])
    movers = [(a, rows) for a, rows in tracks if len({r[1:] for r in rows}) > 1]
    timed = [(a, rows) for a, rows in tracks if spans[a.name] != (None, None)]
    act = SubElement(SubElement(storyboard, "Story", name="replay"), "Act", name="replay")
    if timed:
        group = SubElement(act, "ManeuverGroup", maximumExecutionCount="1", name="presence")
        SubElement(group, "Actors", selectTriggeringEntities="false")
        maneuver = SubElement(group, "Maneuver", name="presence")
        for agent, rows in timed:
            for kind, at, pose in (("appear", spans[agent.name][0], rows[0][1:]), ("vanish", spans[agent.name][1], None)):
                if at is None:
                    continue
                ev = SubElement(maneuver, "Event", name=f"{kind}_{agent.name}", priority="parallel",
                                maximumExecutionCount="1")
                _entity_action(SubElement(ev, "Action", name=f"{kind}_{agent.name}"), agent.name, pose)
                _trigger(ev, "StartTrigger", f"{kind}_{agent.name}_at", at)
    for agent, rows in movers:
        group = SubElement(act, "ManeuverGroup", maximumExecutionCount="1", name=f"group_{agent.name}")
        SubElement(SubElement(group, "Actors", selectTriggeringEntities="false"), "EntityRef", entityRef=agent.name)
        maneuver = SubElement(group, "Maneuver", name=f"maneuver_{agent.name}")
        ev = SubElement(maneuver, "Event", name=f"replay_{agent.name}", priority="overwrite", maximumExecutionCount="1")
        follow = SubElement(SubElement(SubElement(SubElement(ev, "Action", name=f"follow_{agent.name}"), "PrivateAction"),
                                       "RoutingAction"), "FollowTrajectoryAction")
        trajectory = SubElement(SubElement(follow, "TrajectoryRef"), "Trajectory", name=f"traj_{agent.name}", closed="false")
        SubElement(trajectory, "ParameterDeclarations")
        polyline = SubElement(SubElement(trajectory, "Shape"), "Polyline")
        for t, x, y, h in rows:
            _position(SubElement(polyline, "Vertex", time=_num(t)), x, y, h)
        SubElement(SubElement(follow, "TimeReference"), "Timing", domainAbsoluteRelative="absolute", scale="1", offset="0")
        SubElement(follow, "TrajectoryFollowingMode", followingMode="position")
        _trigger(ev, "StartTrigger", f"start_{agent.name}", rows[0][0])
    _trigger(act, "StartTrigger", "act_start", 0.0)
    _trigger(storyboard, "StopTrigger", "end", model.duration + 0.5, "greaterThan")
    return b'<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(root, encoding="utf-8")


def build_csv(model, tracks):
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(CSV_HEADER)
    for agent, rows in tracks:
        length, width, height = model.tracks[model.index[agent.name]].size
        for t, x, y, h in rows:
            writer.writerow([model.name, f"{t:.4f}", agent.name, agent.category, f"{x:.4f}", f"{y:.4f}", f"{h:.4f}",
                             f"{length:.3f}", f"{width:.3f}", f"{height:.3f}"])
    return out.getvalue().encode()


def code_version():
    """{commit, dirty} of the topeye checkout; nulls when git is unavailable (never fails the op)."""
    repo = Path(__file__).resolve().parents[3]
    try:
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=repo, capture_output=True, text=True,
                                timeout=2, check=True).stdout.strip() or None
        status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo, capture_output=True,
                                text=True, timeout=2, check=True).stdout
        return {"commit": commit, "dirty": bool(status.strip())}
    except (OSError, subprocess.SubprocessError):
        return {"commit": None, "dirty": None}


def build_report(model, outcome, result, stem):
    event = outcome.event
    vehicles = [a for i, a in enumerate(model.agents) if model.movers[i]]
    report = {
        "id": stem,
        "scene": model.name,
        "source": REACTIVE_VERSION,
        "valid": result.valid,
        "reasons": [REASONS[r] for r in result.reasons],
        "group": result.group,
        "event": {"actor": event.actor, "t0": event.t0, "decel": event.decel, "target": event.target,
                  "dwell": event.dwell},
        "drivers": {
            "react": outcome.react,
            "reaction_s": outcome.reaction,
            "thresholds": thresholds(event.kind),
            "per_vehicle": {a.name: {"T": round(a.T, 3), "s0": round(a.s0, 3), "max_decel": a.max_decel} for a in vehicles},
        },
        "ego": result.ego,
        "reacted": result.reacted,
        "max_decel_used": result.max_decel_used,
        "checks": {"physics": result.physics, "gaps": result.gaps},
        "collisions": [{"a": a, "b": b, "t": t, "kind": kind} for a, b, t, kind in result.collisions],
        "esmini": None,
        "run": {"created": datetime.now(UTC).replace(microsecond=0).isoformat(), "code": code_version(),
                "config": {"dt": DT, "road": "none"}},
    }
    if event.kind != "brake":
        report["event"] = {"actor": event.actor, "t0": event.t0, "kind": event.kind}
        if event.kind == "accelerate":
            report["event"].update(target_mps=event.target_mps, accel_mps2=event.accel_mps2)
        elif event.kind == "stopline":
            report["event"].update(dwell_s=event.dwell, stopline=outcome.kind_detail.get("stopline"))
        else:
            report["event"].update(direction=event.direction, duration_s=event.duration_s)
    return report


# ---------------------------------------------------------------------------- report.json["topeye"] (plan46 C2)
def _series(values, digits=2):
    return [None if not np.isfinite(v) else round(float(v), digits) for v in values]


def _segments(t, values):
    """Runs of equal values as [start time, end time, value], runs of None dropped (replay-forge app/api.py)."""
    out = []
    for k, value in enumerate(values):
        if out and out[-1][2] == value:
            out[-1][1] = round(float(t[k]), 2)
        else:
            out.append([round(float(t[k]), 2), round(float(t[k]), 2), value])
    return [s for s in out if s[2] is not None]


def _ego_gap_ttc(model, outcome, step):
    """The ego's bumper gap and TTC (TTC_CLAMP at most) to the vehicle ahead, on the simulated positions."""
    X, Y, H = centres(model, outcome)
    e = model.index["ego"]
    gap, ttc = np.full(model.K, np.nan), np.full(model.K, np.nan)
    pres = ~np.isnan(X)
    for k in range(0, model.K, step):
        if not pres[k, e]:
            continue
        j, g = find_leader(model, e, outcome.S[k, e], X[k], Y[k], H[k], outcome.V[k], pres[k])
        if j >= 0:
            gap[k] = g
            closing = outcome.V[k, e] - outcome.V[k, j] * math.cos(_wrap(H[k, j] - H[k, e]))
            ttc[k] = g / closing if closing > 0.05 else np.nan
    return gap, np.minimum(ttc, TTC_CLAMP)


def _markers(model, outcome, result, gap):
    """Event phases, reactions, the ego's closest moment and collisions, in time order (replay-forge simulate_event).
    target_reached becomes `stopped` (stop) or `resume` (half: back to driving); `brake_full` is when the commanded
    braking first reaches the event's level (jerk-limited build-up), absent when the target came first."""
    event = outcome.event
    e = model.index[event.actor]
    phase = {"brake_start": "brake_start", "event_start": "event_start",
             "target_reached": "stopped" if event.target == "stop" else "resume",
             "dwell_end": "resume", "lane_arrived": "lane_arrived"}
    markers = [{"t": round(float(v), 2), "kind": phase[key], "agent": event.actor}
               for key, v in outcome.event_phases.items() if key in phase]
    full = np.flatnonzero(outcome.A[:, e] <= -event.decel + 1e-6) if event.kind == "brake" else []
    if len(full):
        markers.append({"t": round(float(model.t[full[0]]), 2), "kind": "brake_full", "agent": event.actor,
                        "value": round(float(event.decel), 2)})
    markers += [{"t": round(float(v), 2), "kind": "reacts", "agent": who}
                for who, v in outcome.driving_from.items() if who != event.actor]
    if np.isfinite(gap).any():
        k = int(np.nanargmin(gap))
        markers.append({"t": round(float(model.t[k]), 2), "kind": "closest", "agent": "ego", "value": round(float(gap[k]), 2)})
    markers += [{"t": t, "kind": "collision", "agent": a, "other": b} for a, b, t, _ in result.collisions]
    return sorted(markers, key=lambda m: m["t"])


def _vehicles(model, outcome, result, watch):
    names = [a.name for a in model.agents]
    out = {}
    for i in watch:
        a = model.agents[i]
        present = ~np.isnan(outcome.S[:, i])
        modes = [MODE_NAMES[m] if p else None for m, p in zip(outcome.mode[:, i], present)]
        leaders = [names[j] if j >= 0 else None for j in outcome.leader[:, i]]
        gap = result.gaps.get(a.name)
        out[a.name] = {
            "role": "ego" if a.is_ego else "event" if a.name == outcome.event.actor else "reacted",
            "modes": _segments(model.t, modes), "leaders": _segments(model.t, leaders),
            "T": round(a.T, 3), "s0": round(a.s0, 3),
            "T_source": "measured" if a.T_measured else "default",
            "s0_source": "measured" if a.s0_measured else "default",
            "max_decel": a.max_decel, "decel_used": result.max_decel_used.get(a.name),
            "min_gap": gap["gap"] if gap else None,
        }
    return out


def summary(model, outcome, result):
    """One plain Vietnamese sentence (replay-forge thiet-ke-giao-dien.md §4): verdict, key number, hint if not usable."""
    if outcome.event.kind != "brake":
        label = {"accelerate": "tăng tốc", "stopline": "dừng ở vạch", "lane_change": "chuyển làn"}[outcome.event.kind]
        if result.valid:
            return f"Dùng được · xe {outcome.event.actor} {label}; xe của bạn thuộc nhóm {result.group}."
        return f"Không dùng được · xe {outcome.event.actor} {label}: {REASONS[result.reasons[0]]}."
    e = result.ego
    if result.valid:
        gap = f"{_vn(e['min_gap'])} m" if e.get("min_gap") is not None else None
        if result.group == "collision":
            hit = next((c for c in result.collisions if c[3] == "ego"), None)
            other = (hit[1] if hit[0] == "ego" else hit[0]) if hit else "xe khác"
            when = f" lúc {_vn(hit[2])} s" if hit else ""
            return f"Dùng được · xe của bạn đâm vào {other}{when} vì không ai phản ứng, kể cả xe của bạn."
        if result.group == "close":
            used = f"phanh {_vn(e['a_used'])} m/s²" if e.get("a_used") else "không phải phanh"
            return f"Dùng được · suýt chạm. Xe của bạn {used}, gần nhất {gap or '–'}."
        if result.group == "hard":
            need = f"cần phanh ít nhất {_vn(e['a_min'])} m/s²" if e.get("a_min") is not None else "không phanh kịp"
            return f"Dùng được · phải phanh gấp. Xe của bạn {need}, gần nhất {gap or '–'}."
        if result.group == "mild":
            used = f"phanh {_vn(e['a_used'])} m/s²" if e.get("a_used") else f"chỉ cần phanh {_vn(e['a_min'] or 0)} m/s²"
            return f"Dùng được · phanh nhẹ là đủ (xe của bạn {used})."
        return f"Dùng được · không ảnh hưởng (xe của bạn giữ khoảng cách từ {gap} trở lên)." if gap \
            else "Dùng được · không ảnh hưởng tới xe của bạn."
    reason = result.reasons[0]
    if reason == "collision":
        a, b, t, _ = next(c for c in result.collisions if c[3] == "following")
        actor = outcome.event.actor
        if actor in (a, b):
            behind = b if a == actor else a
        else:  # of two reacting vehicles, the one that started driving later hit the other
            behind = a if outcome.driving_from.get(a, 0.0) >= outcome.driving_from.get(b, 0.0) else b
        front = b if behind == a else a
        used = result.max_decel_used.get(behind)
        braking = f" dù đã phanh {_vn(used)} m/s²" if used else ""
        return f"{behind} đâm vào {front} lúc {_vn(t)} s{braking}. Thử phanh nhẹ hơn hoặc chọn lúc khác."
    text = {
        "unsupported_interaction": "Chưa mô phỏng được: có xe nhập làn, cắt ngang hoặc chạm người đi bộ/vật thể. "
                                   "Thử lúc khác hoặc xe khác.",
        "unsupported_appearing": "Chưa mô phỏng được: một xe vừa vào khung hình đúng chỗ tình huống. "
                                 "Thử lúc khác hoặc xe khác.",
        "label_error": "Không dùng được: nhãn gốc của dữ liệu lỗi ở đoạn này. Chọn xe khác hoặc lúc khác.",
        "physics": "Không dùng được: có xe tăng tốc hoặc phanh vượt giới hạn vật lý. Thử phanh nhẹ hơn.",
        "tailgating": f"Không dùng được: có xe bám sát xe trước dưới {_vn(TAILGATE_GAP)} m khi đang chạy. "
                      "Thử phanh nhẹ hơn hoặc chọn lúc khác.",
    }
    return text[reason]


def build_detail(model, outcome, result, variants, step=SERIES_STEP):
    """`ReactiveDetail` of the package's own outcome; variants: {"baseline": Assessment, "pilot": Assessment}."""
    e = model.index["ego"]
    watch = sorted(set(np.flatnonzero(outcome.changed).tolist()) | {e})
    keep = slice(None, None, step)
    vehicles = {}
    for i in watch:
        v = outcome.V[:, i]
        accel = np.gradient(np.nan_to_num(v, nan=0.0), DT)[keep] * np.where(np.isnan(v[keep]), np.nan, 1.0)
        vehicles[model.agents[i].name] = {"v": _series(v[keep]), "v_rec": _series(model.V[keep, i]), "a": _series(accel)}
    gap, ttc = _ego_gap_ttc(model, outcome, step)
    detail = {
        "version": DETAIL_VERSION,
        "summary": summary(model, outcome, result),
        "comparison": {k: variant_outcome(variants[k]) for k in ("baseline", "pilot")},
        "checks": checks(model, outcome, result),
        "excused": [list(x) for x in result.excused],
        "series": {"t": [round(float(t), 2) for t in model.t[keep]], "vehicles": vehicles,
                   "ego": {"gap": _series(gap[keep]), "ttc": _series(ttc[keep])}},
        "markers": _markers(model, outcome, result, gap),
        "vehicles": _vehicles(model, outcome, result, watch),
        "trigger_note": TRIGGER_NOTE,
    }
    if outcome.event.kind != "brake":
        detail.update(kind=outcome.event.kind, **outcome.kind_detail)
    return detail


def _report_bytes(model, outcome, result, stem, variants, step):
    report = build_report(model, outcome, result, stem)
    report["topeye"] = build_detail(model, outcome, result, variants, step)
    return json.dumps(report, ensure_ascii=False, allow_nan=False).encode()


def build_package(model, outcome, result, variants):
    """{"<stem>.xosc", "report.json", "trajectories.csv"} bytes of one outcome (C4 limits checked).
    variants: {"baseline": Assessment, "pilot": Assessment} of the same event (plan46 C2 comparison)."""
    stem = file_stem(outcome.event)
    tracks = []
    for i, agent in enumerate(model.agents):
        rows = _vertices(*actor_poses(model, outcome, i))
        if rows:
            tracks.append((agent, rows))
    report = _report_bytes(model, outcome, result, stem, variants, SERIES_STEP)
    if len(report) > LIMITS["max_report_bytes"]:  # C2: thin the charts to 0.2 s rather than refuse the scenario
        report = _report_bytes(model, outcome, result, stem, variants, SERIES_STEP_LARGE)
    files = {
        f"{stem}.xosc": build_xosc(model, tracks, outcome.event, f"topeye reactive {stem} on {model.name}"),
        "report.json": report,
        "trajectories.csv": build_csv(model, tracks),
    }
    require(len(files[f"{stem}.xosc"]) <= LIMITS["max_xosc_bytes"], "XOSC kịch bản phản ứng vượt 4 MiB", "RESOURCE_LIMIT")
    require(len(report) <= LIMITS["max_report_bytes"], "report.json vượt 256 KiB", "RESOURCE_LIMIT")
    require(len(files["trajectories.csv"]) <= LIMITS["max_csv_bytes"], "trajectories.csv vượt 1,5 MiB", "RESOURCE_LIMIT")
    return files
