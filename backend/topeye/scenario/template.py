"""Compile a scenario template (`topeye-scenario-template-v1`, plan38) into profile XOSC.

The template is untrusted input from the browser: every field is re-checked here. Template coordinates use a
curvilinear ego frame laid along the measured source ego path (x = distance along it, y = left of it), so presets
follow the real road. The result always goes through `validate_xosc`, the same gate as a hand-written file.
"""

import math
import re
from itertools import pairwise

import numpy as np

from topeye.scenario.map_context import LIMITS
from topeye.scenario.models import ScenarioError, finite, matrix, require

TEMPLATE_PROFILE = "topeye-scenario-template-v1"
CATEGORY = {
    "car": "vehicle.car",
    "truck": "vehicle.truck",
    "bus": "vehicle.bus",
    "motorcycle": "vehicle.motorbike",
    "bicycle": "vehicle.bicycle",
    "pedestrian": "human.pedestrian",
}
EVENT_PARAMS = {
    "hard_brake": {"decel_mps2": (0.5, 12)},
    "lane_change": {"lateral_m": (-7, 7), "duration_s": (0.5, 10)},
    "stop": {"decel_mps2": (0.5, 12)},
    "accelerate": {"target_mps": (0, 55), "accel_mps2": (0.1, 12)},
}
# Speed change rate when the template gives none (accel 0) but the speed must change, e.g. after a start delay.
RAMP_MPS2 = {"vehicle": 3.0, "pedestrian": 1.5}
ID = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,31}")
STEP_S = 0.01
MAX_ROUTE_POINTS = 50
MAX_EVENTS = 64
JERK_BRAKE = 10.0
JERK_NORMAL = 3.0
SPEED_GAIN = 1.0
MAX_BRAKE_MPS2 = {CATEGORY["bus"]: 5.0, CATEGORY["truck"]: 5.0}
DEFAULT_MAX_BRAKE_MPS2 = 8.0


def bad(message):
    raise ScenarioError("INVALID_TEMPLATE", message)


def num(value, label, lo=-1e4, hi=1e4):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not finite(value):
        bad(f"{label}: phải là số")
    if not lo <= value <= hi:
        bad(f"{label}: phải trong {lo}–{hi}")
    return float(value)


def point(value, label):
    if not isinstance(value, dict):
        bad(f"{label}: thiếu toạ độ")
    return num(value.get("x_m"), f"{label}.x_m", -500, 500), num(value.get("y_m"), f"{label}.y_m", -500, 500)


def check_template(t):
    """Normalized copy of the parts the compiler needs; raises INVALID_TEMPLATE in Vietnamese."""
    if not isinstance(t, dict) or t.get("profile") != TEMPLATE_PROFILE:
        bad("Không phải template topeye-scenario-template-v1")
    name = t.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 120:
        bad("Tên phải có 1–120 ký tự")
    m = t.get("map") if isinstance(t.get("map"), dict) else bad("Thiếu phần map")
    duration = num(m.get("duration_s"), "Thời lượng", LIMITS["min_duration_s"], LIMITS["max_duration_s"])
    hz = num(m.get("sample_hz"), "Tần số mẫu", 1, 20)
    require(hz == int(hz), "Tần số mẫu phải là số nguyên", "INVALID_TEMPLATE")
    placement = m.get("placement") or {}
    if not isinstance(placement, dict):
        bad("Vị trí đặt không hợp lệ")
    start_m = num(placement.get("start_m", 0), "Điểm bắt đầu trên quỹ đạo nguồn", -200, 500)
    lateral_m = num(placement.get("lateral_m", 0), "Lệch ngang", -10, 10)
    auto, mirror = placement.get("auto", False), placement.get("mirror", False)
    if not isinstance(auto, bool) or not isinstance(mirror, bool):
        bad("Tự tìm vị trí / lật trái-phải phải là true/false")
    # plan52: the ego brakes for whatever blocks its lane (IDM) instead of driving through it; false = scripted path.
    ego_react = m.get("ego_react", True)
    if not isinstance(ego_react, bool):
        bad("Ego tự phanh phải là true/false")
    actors = t.get("actors")
    if not isinstance(actors, list) or not 1 <= len(actors) <= LIMITS["max_actors"]:
        bad(f"Số đối tượng phải trong 1–{LIMITS['max_actors']}")
    out, ids = [], set()
    for i, a in enumerate(actors):
        if not isinstance(a, dict):
            bad(f"Đối tượng {i + 1} không hợp lệ")
        aid = a.get("id")
        if not isinstance(aid, str) or not ID.fullmatch(aid) or aid in ids:
            bad(f"ID đối tượng {i + 1} phải bắt đầu bằng chữ, gồm chữ/số/_/-, không trùng")
        ids.add(aid)
        kind = a.get("kind")
        role = a.get("role")
        if kind not in CATEGORY or role not in {"ego", "traffic"}:
            bad(f"{aid}: loại/vai trò không hợp lệ")
        if role == "ego" and kind == "pedestrian":
            bad("Ego phải là phương tiện")
        walker = kind == "pedestrian"
        group = "pedestrian" if walker else "vehicle"
        v_max, a_max = LIMITS["max_speed_mps"][group], LIMITS["max_acceleration_mps2"][group]
        speed = a.get("speed") if isinstance(a.get("speed"), dict) else bad(f"{aid}: thiếu vận tốc")
        route = a.get("route")
        if not isinstance(route, list) or len(route) > MAX_ROUTE_POINTS:
            bad(f"{aid}: lộ trình tối đa {MAX_ROUTE_POINTS} điểm")
        start = a.get("start") if isinstance(a.get("start"), dict) else bad(f"{aid}: thiếu điểm xuất phát")
        entry = {
            "id": aid,
            "role": role,
            "kind": kind,
            "category": CATEGORY[kind],
            **{k: num(a.get(k), f"{aid}.{k}", 0.1, 20) for k in ("length_m", "width_m", "height_m")},
            "start": point(start, f"{aid}.start"),
            "yaw_rad": math.radians(num(start.get("yaw_deg"), f"{aid}.yaw_deg", -720, 720)),
            "route": [point(p, f"{aid}.route[{j}]") for j, p in enumerate(route)],
            "initial_mps": num(speed.get("initial_mps"), f"{aid}: vận tốc đầu", 0, v_max),
            "target_mps": num(speed.get("target_mps"), f"{aid}: vận tốc đích", 0, v_max),
            "accel_mps2": num(speed.get("accel_mps2"), f"{aid}: gia tốc", 0, a_max),
            "delay_s": num(a.get("start_delay_s", 0), f"{aid}: thời điểm xuất phát", 0, duration),
            "events": [],
        }
        if not entry["route"] and max(entry["initial_mps"], entry["target_mps"]) > 0:
            bad(f"{aid}: đang di chuyển nhưng chưa có điểm lộ trình")
        out.append(entry)
    if sum(a["role"] == "ego" for a in out) != 1:
        bad("Cần đúng một xe ego")
    events = t.get("events", [])
    if not isinstance(events, list) or len(events) > MAX_EVENTS:
        bad(f"Tối đa {MAX_EVENTS} tình huống")
    by_id = {a["id"]: a for a in out}
    for i, e in enumerate(events):
        if not isinstance(e, dict) or e.get("type") not in EVENT_PARAMS or e.get("actor") not in by_id:
            bad(f"Tình huống {i + 1}: loại hoặc đối tượng không hợp lệ")
        params = e.get("params") if isinstance(e.get("params"), dict) else {}
        checked = {
            k: num(params.get(k), f"Tình huống {i + 1}: {k}", lo, hi)
            for k, (lo, hi) in EVENT_PARAMS[e["type"]].items()
        }
        group = "pedestrian" if by_id[e["actor"]]["kind"] == "pedestrian" else "vehicle"
        if group == "pedestrian" and e["type"] == "hard_brake":
            bad(f"Tình huống {i + 1}: người đi bộ không “phanh gấp”, hãy dùng “Dừng”")
        for k in ("decel_mps2", "accel_mps2"):
            if k in checked and checked[k] > LIMITS["max_acceleration_mps2"][group]:
                bad(f"Tình huống {i + 1}: {k} vượt giới hạn {LIMITS['max_acceleration_mps2'][group]}")
        if checked.get("target_mps", 0) > LIMITS["max_speed_mps"][group]:
            bad(f"Tình huống {i + 1}: target_mps vượt giới hạn {LIMITS['max_speed_mps'][group]}")
        at = num(e.get("at_s"), f"Tình huống {i + 1}: thời điểm", 0, duration)
        by_id[e["actor"]]["events"].append({"type": e["type"], "at_s": at, **checked})
    for a in out:
        a["events"].sort(key=lambda e: e["at_s"])
    return {
        "name": name.strip(),
        "duration_s": duration,
        "sample_hz": int(hz),
        "start_m": start_m,
        "lateral_m": lateral_m,
        "auto": auto,
        "mirror": mirror,
        "ego_react": ego_react,
        "actors": out,
    }


class Line:
    """Polyline parameterized by arc length, extended straight past both ends; heading interpolated."""

    def __init__(self, xy, heading=0.0):
        xy = np.asarray(xy, dtype=float)
        keep = [0]
        for i in range(1, len(xy)):
            if np.hypot(*(xy[i] - xy[keep[-1]])) > 0.05:
                keep.append(i)
        xy = xy[keep]
        if len(xy) < 2:
            xy = np.array([xy[0], xy[0] + [math.cos(heading), math.sin(heading)]])
        seg = np.diff(xy, axis=0)
        self.xy = xy
        self.s = np.concatenate([[0], np.cumsum(np.hypot(seg[:, 0], seg[:, 1]))])
        h = np.arctan2(seg[:, 1], seg[:, 0])
        # Vertex headings: average of adjacent segments, so offset points move continuously around corners.
        vh = np.concatenate([[h[0]], h[:-1] + np.remainder(h[1:] - h[:-1] + math.pi, 2 * math.pi) / 2 - math.pi / 2, [h[-1]]])
        self.h = np.unwrap(vh)
        self.h0, self.h1 = h[0], h[-1]

    @property
    def length(self):
        return self.s[-1]

    def at(self, s):
        """(x, y, heading) at arc length s."""
        if s <= 0:
            x, y = self.xy[0] + s * np.array([math.cos(self.h0), math.sin(self.h0)])
            return x, y, self.h0
        if s >= self.length:
            x, y = self.xy[-1] + (s - self.length) * np.array([math.cos(self.h1), math.sin(self.h1)])
            return x, y, self.h1
        x = np.interp(s, self.s, self.xy[:, 0])
        y = np.interp(s, self.s, self.xy[:, 1])
        return x, y, float(np.interp(s, self.s, self.h))

    def offset(self, s, d):
        x, y, h = self.at(s)
        return x - d * math.sin(h), y + d * math.cos(h), h


def chaikin(points, rounds=5):
    """Corner cutting keeps both ends and makes heading change gradually (no infinite acceleration at corners)."""
    p = np.asarray(points, dtype=float)
    for _ in range(rounds if len(p) > 2 else 0):
        q = [p[0]]
        for a, b in pairwise(p):
            q += [0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b]
        q.append(p[-1])
        p = np.array(q)
    return p


def smooth_step(f):
    f = min(1.0, max(0.0, f))
    return (1 - math.cos(math.pi * f)) / 2


def simulate(actor, duration):
    """Fine-step (s, lateral) states of one actor along its own local route.

    Jerk limiting ported from replay-forge (phanhieunghia353) @ d36205b,
    real2sim/behavior.py::_jerk_limited.
    """
    group = "pedestrian" if actor["kind"] == "pedestrian" else "vehicle"
    v = actor["initial_mps"] if actor["delay_s"] == 0 else 0.0
    desired, rate = actor["target_mps"], actor["accel_mps2"] or RAMP_MPS2[group]
    pending = list(actor["events"])
    shifts = [e for e in pending if e["type"] == "lane_change"]
    s, states = 0.0, []
    a = 0.0
    braking = False
    for k in range(round(duration / STEP_S) + 1):
        t = k * STEP_S
        while pending and pending[0]["at_s"] <= t + 1e-9:
            e = pending.pop(0)
            if e["type"] in {"hard_brake", "stop"}:
                braking = True
                desired, rate = 0.0, e["decel_mps2"]
                if group != "pedestrian":
                    rate = min(rate, MAX_BRAKE_MPS2.get(actor["category"], DEFAULT_MAX_BRAKE_MPS2))
            elif e["type"] == "accelerate":
                braking = False
                desired, rate = e["target_mps"], e["accel_mps2"]
        lateral = sum(e["lateral_m"] * smooth_step((t - e["at_s"]) / e["duration_s"]) for e in shifts)
        states.append((t, s, lateral, v))
        if t >= actor["delay_s"]:
            error = desired - v
            a_target = -rate if braking and v > 0 else max(-rate, min(rate, SPEED_GAIN * error))
            if a_target < a:
                if a_target < 0 < a:
                    a = 0.0
                a = max(a_target, a - JERK_BRAKE * STEP_S)
            else:
                a = min(a_target, a + JERK_NORMAL * STEP_S)
            next_v = v + a * STEP_S
            if next_v <= 0:
                v, a = 0.0, 0.0
            elif error != 0 and error * (desired - next_v) <= 0:
                v, a = desired, 0.0
            else:
                v = next_v
            s += v * STEP_S
    return states


def compile_actor(actor, duration, hz, frame, mirror=False):
    """World samples (box center at ground) for one actor."""
    local_start = np.array(actor["start"])
    if actor["route"]:
        local = Line(chaikin([local_start, *actor["route"]]))
        states = simulate(actor, duration)
    else:
        local = None
        states = [(k / hz, 0.0, 0.0, 0.0) for k in range(round(duration * hz) + 1)]

    def world(s, lateral):
        x, y = (local.offset(s, lateral)[:2]) if local else local_start
        return frame(x, y)

    rows, step = [], (1 if not local else round(1 / (hz * STEP_S)))
    yaw = None
    for t, s, lateral, v in states[::step]:
        x, y, ref_h = world(s, lateral)
        if local is None:
            heading = ref_h + (-actor["yaw_rad"] if mirror else actor["yaw_rad"])
        else:
            # Heading of the travelled curve (path + lane-change offset), held when standing still.
            i = round(t / STEP_S)
            a, b = states[max(0, i - 5)], states[min(len(states) - 1, i + 5)]
            p0, p1 = world(a[1], a[2]), world(b[1], b[2])
            if math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1e-3:
                heading = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
            elif yaw is not None:
                heading = yaw
            else:
                ahead = world(s + 0.5, lateral)
                heading = math.atan2(ahead[1] - y, ahead[0] - x)
        if yaw is not None:
            heading = yaw + math.remainder(heading - yaw, 2 * math.pi)
        yaw = heading
        rows.append({"t_s": round(t, 6), "x_m": float(x), "y_m": float(y), "z_m": 0.0, "yaw_rad": float(heading)})
    rows[-1]["t_s"] = duration
    return rows


def reference_line(source):
    """Measured source ego path, resampled every 2 m and corner-rounded so offset lanes stay smooth."""
    ego = next(a for a in source["actors"] if a["role"] == "ego")
    values = matrix(ego)
    xy = values[:, 1:3]
    seg = np.hypot(*np.diff(xy, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    if s[-1] > 4:
        grid = np.append(np.arange(0, s[-1], 2.0), s[-1])
        xy = chaikin(np.column_stack([np.interp(grid, s, xy[:, 0]), np.interp(grid, s, xy[:, 1])]), 3)
    return Line(xy, heading=float(values[0, 4]))


def reference_frame(source, start_m, lateral_m, line=None, mirror=False):
    """Map ego-frame (x along, y left) onto the measured source ego path; `mirror` swaps left and right
    (presets assume right-hand traffic; left-hand traffic such as Singapore needs the mirror)."""
    line = line or reference_line(source)
    sign = -1.0 if mirror else 1.0

    def frame(x, y):
        return line.offset(start_m + x, lateral_m + sign * y)

    return frame


# Rejections that another placement on the same map can fix.
RELOCATABLE = {"OUTSIDE_MAP", "OUTSIDE_SURFACE", "STATIC_OBSTACLE", "DYNAMIC_LIMIT"}
SEARCH_STEP_M = 5.0
MAX_CANDIDATES = 40


class Precheck:
    """Cheap per-sample screen (no swept segments) so automatic placement only runs the full gate on likely fits."""

    def __init__(self, context):
        from shapely.geometry import box
        from shapely.ops import unary_union
        from shapely.prepared import prep

        from topeye.scenario.map_context import DRIVABLE, verify_context

        surfaces, obstacles = verify_context(context)
        self.drive = prep(unary_union([p for k, p in surfaces if k in DRIVABLE]))
        self.walk = prep(unary_union([p for k, p in surfaces if k in DRIVABLE | {"walkway", "ped_crossing"}]))
        self.obstacles = prep(unary_union(obstacles)) if obstacles else None
        self.envelope = prep(box(*context["bounds_m"]))

    def ok(self, actors, hz):
        from topeye.scenario.map_context import footprint

        for a in actors:
            walker = a["category"].startswith("human.")
            group = "pedestrian" if walker else "vehicle"
            xy = np.array([[r["x_m"], r["y_m"]] for r in a["samples"]])
            v = np.diff(xy, axis=0) * hz
            if len(v) > 1 and np.max(np.linalg.norm(np.diff(v, axis=0), axis=1) * hz) > LIMITS["max_acceleration_mps2"][group] * 0.98:
                return False
            surface = self.walk if walker else self.drive
            for row in a["samples"][:: max(1, hz // 2)]:
                p = footprint(a, row)
                if not self.envelope.covers(p) or not surface.covers(p) or (self.obstacles and self.obstacles.intersects(p)):
                    return False
        return True


def build(t, frame, mirror=False):
    actors = [
        {
            **{k: a[k] for k in ("id", "role", "category", "length_m", "width_m", "height_m")},
            "samples": compile_actor(a, t["duration_s"], t["sample_hz"], frame, mirror),
        }
        for a in t["actors"]
    ]
    if t.get("ego_react", True):
        ego = next(a for a in actors if a["role"] == "ego")
        ego["samples"] = react_ego(ego, [a for a in actors if a is not ego], t["duration_s"], t["sample_hz"])
    return actors


# plan52 ego reaction: IDM on the ego's own planned path (same model family as the reactive engine).
REACT_DT = 0.05  # s
IDM_ACCEL, IDM_COMFORT, IDM_MAX_BRAKE = 2.0, 3.0, 8.0  # m/s²
IDM_S0, IDM_T = 2.0, 1.2  # m standstill gap, s headway
LANE_MARGIN_M = 0.3  # lateral clearance that still counts as "in my lane"


def _path_projection(path, cum, points):
    """(s along path, |lateral|) of each point on the polyline `path` (N×2) with cumulative length `cum`."""
    a, b = path[:-1], path[1:]
    seg = b - a
    seg_len2 = np.maximum((seg ** 2).sum(axis=1), 1e-12)
    rel = points[:, None, :] - a[None, :, :]
    f = np.clip((rel * seg[None]).sum(axis=2) / seg_len2[None], 0.0, 1.0)
    closest = a[None] + f[..., None] * seg[None]
    dist = np.linalg.norm(points[:, None, :] - closest, axis=2)
    k = dist.argmin(axis=1)
    rows = np.arange(len(points))
    return cum[k] + f[rows, k] * np.sqrt(seg_len2[k]), dist[rows, k]


def react_ego(ego, others, duration, hz):
    """Ego samples re-timed along the same path so it keeps an IDM gap to anything inside its lane ahead.
    Unchanged when nothing blocks it; never leaves its path, never reverses."""
    rows = ego["samples"]
    xy = np.array([[r["x_m"], r["y_m"]] for r in rows])
    t_rows = np.array([r["t_s"] for r in rows])
    step = np.linalg.norm(np.diff(xy, axis=0), axis=1)
    planned_s = np.concatenate([[0.0], np.cumsum(step)])
    keep = np.concatenate([[True], step > 1e-6])
    path, cum = xy[keep], planned_s[keep]
    if len(path) < 2 or not others:
        return rows
    grid = np.arange(0.0, duration + 1e-9, REACT_DT)
    planned = np.interp(grid, t_rows, planned_s)
    v_plan = np.gradient(planned, REACT_DT)
    blockers = []
    for o in others:
        ot = np.array([r["t_s"] for r in o["samples"]])
        ox = np.interp(grid, ot, [r["x_m"] for r in o["samples"]], left=np.nan, right=np.nan)
        oy = np.interp(grid, ot, [r["y_m"] for r in o["samples"]], left=np.nan, right=np.nan)
        pts = np.column_stack([np.nan_to_num(ox, nan=1e9), np.nan_to_num(oy, nan=1e9)])
        s_o, d_o = _path_projection(path, cum, pts)
        inside = np.isfinite(ox) & (d_o <= (ego["width_m"] + o["width_m"]) / 2 + LANE_MARGIN_M)
        blockers.append((s_o, inside, (ego["length_m"] + o["length_m"]) / 2, np.gradient(s_o, REACT_DT)))
    s, v = 0.0, float(v_plan[0])
    out = np.empty_like(grid)
    for k in range(len(grid)):
        out[k] = s
        nxt = float(planned[min(k + 1, len(grid) - 1)])
        plan_v, lag = max(float(v_plan[k]), 0.0), max(float(planned[k]) - s, 0.0)
        # Free: track the planned position (its own brakes and ramps), closing any lag at ≤ IDM_ACCEL and a
        # comfortable braking curve, never ahead of the plan, never braking harder than IDM_MAX_BRAKE.
        v_free = max(min(v + IDM_ACCEL * REACT_DT, plan_v + math.sqrt(2 * IDM_COMFORT * lag)), v - IDM_MAX_BRAKE * REACT_DT)
        s_next = min(nxt, s + max(v_free, 0.0) * REACT_DT)
        for s_o, inside, half, v_o in blockers:
            if not inside[k] or s_o[k] <= s:
                continue
            gap = max(s_o[k] - s - half, 0.01)
            dv = v - max(float(v_o[k]), 0.0)
            star = IDM_S0 + max(0.0, v * IDM_T + v * dv / (2 * math.sqrt(IDM_ACCEL * IDM_COMFORT)))
            a = max(-IDM_MAX_BRAKE, IDM_ACCEL * (1 - (v / max(plan_v, 0.1)) ** 4 - (star / gap) ** 2))
            s_next = min(s_next, s + max(0.0, v + a * REACT_DT) * REACT_DT)
        s_next = min(max(s_next, s), float(cum[-1]))
        v = (s_next - s) / REACT_DT
        s = s_next
    if np.allclose(out, planned, atol=1e-3):
        return rows
    new_s = np.interp(t_rows, grid, out)
    x = np.interp(new_s, cum, path[:, 0])
    y = np.interp(new_s, cum, path[:, 1])
    yaw = np.interp(new_s, planned_s, np.unwrap([r["yaw_rad"] for r in rows]))
    return [{**r, "x_m": float(x[i]), "y_m": float(y[i]), "yaw_rad": float(yaw[i])} for i, r in enumerate(rows)]


def compile_template(template, source, context):
    """(XOSC bytes, display file name, placement used). Raises ScenarioError with a Vietnamese hint.

    With `placement.auto`, a rejection that depends on where the scenario sits (map/obstacle/dynamics) makes the
    compiler try other start points along the source ego path, nearest to the requested one first.
    """
    from topeye.scenario.xosc_import import profile_xml, validate_xosc

    t = check_template(template)
    line = reference_line(source)
    candidates = [(t["start_m"], t["mirror"])]
    if t["auto"]:
        grid = np.arange(-20, line.length + SEARCH_STEP_M, SEARCH_STEP_M)
        starts = [t["start_m"], *sorted((float(s) for s in grid if abs(s - t["start_m"]) > 1e-6), key=lambda s: abs(s - t["start_m"]))[:MAX_CANDIDATES]]
        # Nearest start first; at each start the requested side, then the mirrored one.
        candidates = [(s, m) for s in starts for m in (t["mirror"], not t["mirror"])][1:]
        candidates.insert(0, (t["start_m"], t["mirror"]))
    precheck = Precheck(context) if len(candidates) > 1 else None
    first = None
    for index, (start, mirror) in enumerate(candidates):
        actors = build(t, reference_frame(source, start, t["lateral_m"], line, mirror), mirror)
        # The requested placement always gets the full gate, so its precise error can be reported.
        if index and not precheck.ok(actors, t["sample_hz"]):
            continue
        xml = profile_xml(actors, t["duration_s"], context["map_id"])
        try:
            validate_xosc(xml, context)
        except ScenarioError as exc:
            if not t["auto"] or exc.code not in RELOCATABLE:
                raise ScenarioError(exc.code, explain(exc, t["sample_hz"])) from exc
            first = first or exc
            continue
        safe = re.sub(r"[^\w.-]+", "_", t["name"]).strip("._") or "scenario"
        return xml, f"{safe[:100]}.xosc", {"start_m": start, "lateral_m": t["lateral_m"], "auto": t["auto"], "mirror": mirror}
    raise ScenarioError(
        first.code,
        f"Không tìm được vị trí phù hợp trên cảnh này (đã thử {len(candidates)} vị trí, cả hai phía, dọc quỹ đạo xe nguồn dài "
        f"{line.length:.0f} m). Ở vị trí bạn chọn: {explain(first, t['sample_hz'])} Thử cảnh khác, giảm vận tốc hoặc thời lượng.",
    )


def explain(exc, hz=None):
    """Vietnamese hint for map/dynamic rejections, keeping the original message for diagnosis."""
    message = str(exc)
    m = re.match(r"(\S+) (?:vertex|segment) \d+.*? at t=([\d.]+)s", message)
    where = f"“{m.group(1)}” lúc {float(m.group(2)):.1f} s" if m else "Kịch bản"
    hint = {
        "OUTSIDE_MAP": f"{where} ra ngoài vùng map của cảnh (quá 60 m quanh quỹ đạo xe nguồn). Giảm vận tốc/thời lượng hoặc đổi điểm bắt đầu.",
        "OUTSIDE_SURFACE": f"{where} đi ra ngoài mặt đường (người đi bộ: ngoài đường/vỉa hè). Chỉnh lệch ngang, làn (y) hoặc điểm bắt đầu.",
        "STATIC_OBSTACLE": f"{where} chạm vật cản tĩnh ước lượng (nhà/cây/cột). Chỉnh vị trí hoặc lộ trình.",
        "DYNAMIC_LIMIT": f"{where}: vượt giới hạn vận tốc/gia tốc của profile. Giảm vận tốc hoặc làm lộ trình bớt gấp khúc.",
    }.get(exc.code)
    return f"{hint} ({message})" if hint else message
