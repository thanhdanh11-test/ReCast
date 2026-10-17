"""Reactive scenarios (plan45 P01): a real vehicle ahead slows down or stops; the vehicles behind it react
like human drivers. Everything the event does not affect replays its `pilot` motion (the ego: its
recording), so an empty event reproduces the scene exactly, by construction.

Ported from replay-forge (phanhieunghia353) @ d36205b, real2sim/abstraction.py (pilot), real2sim/behavior.py
(SceneModel, simulate, enhanced_idm), real2sim/events.py (candidates, assess) and real2sim/safety.py (boxes,
gap, TTC, braking_avoids). Design: replay-forge docs/thiet-ke-kich-ban-hanh-vi.md section 4, with the
measured adjustments of 4.9-4.10 kept. Input is a topeye `source_scene()` (nuScenes or AV2), in the app frame.

Per vehicle, on a DT time grid:
  nominal   replays its nominal motion
  waiting   saw its leader deviate; still nominal during the reaction time
  driving   enhanced IDM car following on its own path; desired speed = the nominal speed at its plan
            clock tau; the stops of its nominal motion are virtual obstacles it waits at for the recorded time
  late      back on its nominal motion, delayed: s(t) = s_nominal(t - delta)
  event     the event vehicle: jerk-limited braking to a stop or to half its speed, optional dwell, then driving
Updates use one common state per step, so the order of the agents does not matter.

Known caveat (replay-forge 4.9.12): the pilot speed profile (a knot every 2 s) shortens recorded stops;
a 3 s stop keeps ~1.55 s below 0.3 m/s. Not corrected in this round.
"""

import copy
import math
from dataclasses import dataclass, field, replace

import numpy as np
from scipy.interpolate import PchipInterpolator, make_smoothing_spline

from topeye.scenario.models import ScenarioError, finite, require
from topeye.scenario.reactive_map import STOP_COMFORT_DECEL

REACTIVE_VERSION = "topeye-reactive-v1"

# ---------------------------------------------------------------- behaviour (replay-forge behavior.py)
DT = 0.05  # s, the esmini step
REACTION = 1.0  # s, from seeing the leader deviate to acting
IDM_A = 1.5  # m/s^2, IDM maximum (comfortable) acceleration
IDM_B = 2.0  # m/s^2, IDM comfortable deceleration
MAX_DECEL = 8.0  # m/s^2, emergency braking limit of a car
HEAVY_MAX_DECEL = 5.0  # m/s^2, ... of trucks and buses
HEAVY_CATEGORIES = ("vehicle.bus.bendy", "vehicle.bus.rigid", "vehicle.truck", "vehicle.construction", "vehicle.trailer")
JERK_BRAKE = 10.0  # m/s^3, how fast braking may build up
JERK_NORMAL = 3.0  # m/s^3, how fast acceleration may build up / braking may ease
T_DEFAULT, T_RANGE = 1.2, (0.6, 2.5)  # s, desired time gap
S0_DEFAULT, S0_RANGE = 2.0, (1.0, 3.0)  # m, standstill gap
MIN_V0 = 1.0  # m/s, lowest IDM desired speed (stops are handled as virtual obstacles)
LOOKAHEAD = 60.0  # m, leader search distance (front bumper to rear bumper)
CORRIDOR_MARGIN = 0.5  # m, lateral slack of the path corridor
HEADING_TOL = math.radians(30.0)  # a moving leader must travel within this of the path direction
LEADER_HOLD = 2.0  # m, keep the previous leader unless another is closer by more than this
FOLLOW_MIN_TIME = 1.0  # s, a following relation counts after this long
DEV_SPEED = 0.3  # m/s, a leader slower than its nominal motion by this has deviated
DEV_LAG = 0.2  # m, ... or lagging its nominal position by this
STOP_SPEED = 0.3  # m/s, below this the nominal motion is stopped
STOP_MIN = 1.0  # s, a nominal stop lasts at least this long
STOP_REACH = 0.6  # m, close enough to a nominal stop point to wait there
REJOIN_SPEED = 0.05  # m/s, back on the plan when speed matches it this well ...
REJOIN_TIME = 1.0  # s, ... for this long, without a leader interaction
REJOIN_INTERACTION = 0.05  # IDM interaction term below which the leader no longer matters
STATIC_SPEED = 0.5  # m/s, a vehicle slower than this is a static obstacle (heading not checked)
ALONGSIDE_GAP = 0.0  # m, a vehicle whose nearest point is not ahead of the front bumper is beside, not ahead
WATCH_AHEAD = 2  # a driver notices a deviation of any of the nearest this many vehicles ahead (brake lights)
TRACK_GAIN = 1.0  # 1/s, speed feedback when following the plan freely
COOLNESS = 0.99  # enhanced IDM coolness factor (Kesting et al. 2010)
STOP_S0 = 0.3  # m, how close to a nominal stop point a driver pulls up

# ---------------------------------------------------------------- pilot (replay-forge abstraction.py)
PILOT_DT = 0.1  # s, vertex spacing of the pilot reconstruction
KNOT_SPACING = 2.0  # s, pilot speed profile
MIN_SPLINE_POINTS = 5  # make_smoothing_spline needs at least 5 samples
MIN_HEADING_SPEED = 0.5  # m/s, below this the heading comes from the box yaw, not the motion
STATIONARY_EXTENT = 1.0  # m, every pose this close to the mean: not moving ...
STATIONARY_LENGTH_RATIO = 0.25  # ... or within this share of its length (long boxes jitter more)

# ---------------------------------------------------------------- ego box (replay-forge tracks.py)
# The source ego samples are the ego pose (nuScenes ego_pose / AV2 city_SE3_egovehicle), whose origin is the rear
# axle. The engine's geometry (leader, gap, collisions, TTC, braking) uses the real box: centre EGO_BBOX_CENTER_X
# ahead along the heading, size EGO_SIZE (Renault Zoe, assumption in replay-forge). AV2 has no ego size or axle
# offset in this repo, so the nuScenes values are assumed for it too. The package keeps the app's poses and size.
EGO_SIZE = (4.084, 1.730, 1.562)  # m, length, width, height
EGO_BBOX_CENTER_X = 1.39  # m, box centre ahead of the ego pose

# ---------------------------------------------------------------- candidates (replay-forge events.py)
EVENT_SPEED = 3.0  # m/s, the event vehicle must move at least this fast at t0
AFTER_EVENT = 4.0  # s of scene left after the event ends
FOLLOW_WINDOW = (-0.5, 3.0)  # s around t0 in which someone must be following the event vehicle
ACTOR_DATA_AFTER = 4.0  # s of recorded data the event vehicle must still have after t0
WINDOW_STEP = 0.5  # s between selectable start times
TARGETS = ("stop", "half")
DWELL_RANGE = (0.0, 10.0)  # s
REACTION_RANGE = (0.3, 3.0)  # s
WINDOW_DECELS = (2.0, 4.0, 6.0, 8.0)  # m/s^2, the braking levels whose start-time windows are listed (plan46 C1)
WINDOW_EVENTS = (("stop", 0.0), ("stop", 3.0), ("half", 0.0))  # (target, dwell), as the replay-forge grid
SENSITIVITY_REACTIONS = (0.7, 1.0, 1.5)  # s, replay-forge "Thử độ nhạy"

# ---------------------------------------------------------------- validity
MAX_ACCEL = 4.0  # m/s^2, simulated acceleration
DECEL_SLACK = 0.2  # m/s^2, allowed over a vehicle's emergency braking limit
LABEL_REACH = 5.0  # m, a physics violation this close to one in the recorded motion is a label error
SPEED_LIMIT = 40.0  # m/s
PHYSICS_SMOOTH = 4  # grid steps (0.2 s) of speed averaging before differentiating
TAILGATE_GAP = 0.5  # m, bumper gap ...
TAILGATE_SPEED = 3.0  # m/s, ... while moving faster than this ...
TAILGATE_TIME = 0.5  # s, ... for longer than this
EXEMPT_ALONG = 1.5  # m, an overlap is excused when the recording has one of the same pair this close along ...
EXEMPT_ACROSS = 0.75  # m, ... and across ...
EXEMPT_DEPTH = 0.1  # m, ... and when not deeper than there by more than this
APPEAR_WINDOW = 2.0  # s, a collision this soon after one of the pair entered the data is an appearing problem
MERGE_LOOKBACK = 3.0  # s, heading difference > HEADING_TOL in this time before contact: merging, not following

# ---------------------------------------------------------------- rare cases
CLOSE_GAP = 1.0  # m, only for a vehicle on the ego's path
CLOSE_TTC = 1.5  # s, any side
COMFORT_DECEL = 3.4  # m/s^2
NEW_MARGIN = 0.1  # m or s: closer than the same pair in the recording by at least this to count as new
DECEL_GRID = np.round(np.arange(0.2, 8.0 + 1e-9, 0.2), 1)
GROUPS = ("collision", "hard", "close", "mild", "far")

# ---------------------------------------------------------------- safety (replay-forge safety.py)
GRID_DT = 0.1  # s
TTC_HORIZON = 5.0  # s
TTC_STEP = 0.1  # s

REASONS = {
    "unsupported_interaction": "[unsupported] Nhập làn, cắt ngang hoặc chạm người đi bộ/vật thể phát lại (chưa hỗ trợ)",
    "unsupported_appearing": "[unsupported] Xe vừa xuất hiện ngay chỗ tình huống (chưa hỗ trợ)",
    "label_error": "[label_error] Nhãn gốc sai vật lý tại cùng chỗ",
    "collision": "[collision] Hai xe khác đâm nhau",
    "tailgating": "[tailgating] Bám đuôi < 0,5 m khi > 3 m/s quá 0,5 s",
    "physics": "[physics] Vượt giới hạn tốc độ/gia tốc/phanh",
}

NOMINAL, WAITING, DRIVING, LATE, EVENT = range(5)

VEHICLE_CLASS = {
    "vehicle.car": "car",
    "vehicle.emergency.police": "car",
    "vehicle.emergency.ambulance": "car",
    "vehicle.truck": "truck",
    "vehicle.construction": "truck",
    "vehicle.trailer": "truck",
    "vehicle.bus.bendy": "bus",
    "vehicle.bus.rigid": "bus",
    "vehicle.motorcycle": "motorcycle",
    "vehicle.bicycle": "bicycle",
}


def entity_class(category):
    """C4 name class: car | truck | bus | motorcycle | bicycle | pedestrian | object."""
    if category in VEHICLE_CLASS:
        return VEHICLE_CLASS[category]
    if category.startswith("vehicle."):
        return "car"
    if category.startswith("human.pedestrian"):
        return "pedestrian"
    return "object"


def entity_kind(category):
    """vehicle | pedestrian | misc. Unknown categories (e.g. AV2 `av2.*`) are objects that replay."""
    if category.startswith("vehicle."):
        return "vehicle"
    if category.startswith(("human.", "animal")):
        return "pedestrian"
    return "misc"


def _wrap(angle):
    return (angle + np.pi) % (2 * np.pi) - np.pi


# ---------------------------------------------------------------------------- tracks and pilot
@dataclass
class Track:
    name: str
    actor_id: str
    category: str
    t: np.ndarray  # (N,) s
    xy: np.ndarray  # (N, 2) box centre, app frame
    yaw: np.ndarray  # (N,) rad
    size: tuple  # length, width, height
    parked: bool = False

    @property
    def kind(self):
        return entity_kind(self.category)

    @property
    def is_static(self):
        return len(self.t) < 2 or bool(np.all(self.xy == self.xy[0]))

    @property
    def is_stationary(self):
        limit = max(STATIONARY_EXTENT, STATIONARY_LENGTH_RATIO * self.size[0])
        return bool(np.hypot(*(self.xy - self.xy.mean(axis=0)).T).max() < limit)

    def with_poses(self, t, xy, yaw):
        return Track(self.name, self.actor_id, self.category, np.asarray(t, float),
                     np.asarray(xy, float).reshape(-1, 2), np.asarray(yaw, float), self.size, self.parked)


def source_tracks(source):
    """Ego first, then every other actor with a sample, named per C4 (`<cls>_<NNN>` in source order)."""
    require(isinstance(source, dict) and isinstance(source.get("actors"), list), "Invalid source scene")
    tracks, number = [], 0
    for actor in source["actors"]:
        rows = sorted((r for r in actor.get("samples") or [] if all(finite(r.get(k)) for k in ("t_s", "x_m", "y_m", "yaw_rad"))),
                      key=lambda r: r["t_s"])
        kept = [r for i, r in enumerate(rows) if i == 0 or r["t_s"] > rows[i - 1]["t_s"] + 1e-9]
        ego = actor.get("role") == "ego"
        if not ego:
            number += 1  # numbering follows source order whether or not the actor has samples
        if not kept:
            continue
        category = actor.get("category") if isinstance(actor.get("category"), str) else "movable_object.obstacle"
        attributes = actor.get("attributes") or []
        track = Track(
            "ego" if ego else f"{entity_class(category)}_{number:03d}",
            str(actor.get("id")),
            category,
            np.array([r["t_s"] for r in kept], float),
            np.array([[r["x_m"], r["y_m"]] for r in kept], float),
            np.array([r["yaw_rad"] for r in kept], float),
            (float(actor["length_m"]), float(actor["width_m"]), float(actor.get("height_m") or 1.5)),
            # source_scene keeps the set of attributes over the track, not per-sample counts: "parked
            # dominates" is read as parked and never labelled moving
            parked=not ego and "vehicle.parked" in attributes and "vehicle.moving" not in attributes,
        )
        tracks.insert(0, track) if ego else tracks.append(track)
    require(tracks and tracks[0].name == "ego", "Source scene has no ego", "INVALID_INPUT")
    return tracks


def _dense_times(t):
    return np.append(np.arange(t[0], t[-1], PILOT_DT), t[-1])


def drive_along(t_out, s_out, s, xy, yaw):
    """Poses at arc lengths s_out along a path sampled at arc lengths s (non-decreasing)."""
    keep = np.concatenate([[True], np.diff(s) > 1e-6])
    s, xy, yaw = s[keep], xy[keep], np.unwrap(yaw)[keep]
    if len(s) == 1:
        return t_out, np.tile(xy[0], (len(t_out), 1)), np.full(len(t_out), yaw[0])
    pos = np.column_stack([np.interp(s_out, s, xy[:, k]) for k in (0, 1)])
    return t_out, pos, np.interp(s_out, s, yaw)


def arc_length(xy):
    return np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])


def smooth_path(track):
    """Dense smoothed poses; heading follows the motion above MIN_HEADING_SPEED, else the smoothed box yaw."""
    td = _dense_times(track.t)
    yaw_unwrapped = np.unwrap(track.yaw)
    if len(track.t) < MIN_SPLINE_POINTS:
        xy = np.column_stack([np.interp(td, track.t, track.xy[:, k]) for k in (0, 1)])
        return td, xy, np.interp(td, track.t, yaw_unwrapped)
    sx, sy = (make_smoothing_spline(track.t, track.xy[:, k]) for k in (0, 1))
    box_yaw = make_smoothing_spline(track.t, yaw_unwrapped)(td)
    vx, vy = sx.derivative()(td), sy.derivative()(td)
    motion = np.arctan2(vy, vx)
    reverse = np.abs(_wrap(motion - box_yaw)) > math.pi / 2
    motion = np.where(reverse, motion + math.pi, motion)
    heading = np.where(np.hypot(vx, vy) > MIN_HEADING_SPEED, motion, box_yaw)
    heading = box_yaw + _wrap(heading - box_yaw)
    return td, np.column_stack([sx(td), sy(td)]), heading


def pilot(track):
    """Stationary (or parked) objects pinned to their mean pose; otherwise a smoothed path driven with a
    speed profile that has a knot every KNOT_SPACING seconds (PCHIP: continuous, never negative)."""
    if track.is_stationary or track.parked:
        centre = track.xy.mean(axis=0)
        yaw = math.atan2(np.sin(track.yaw).mean(), np.cos(track.yaw).mean())
        t = track.t[[0, -1]] if len(track.t) > 1 else track.t[:1]
        return track.with_poses(t, np.tile(centre, (len(t), 1)), np.full(len(t), yaw))
    td, xy, yaw = smooth_path(track)
    s = arc_length(xy)
    knots = np.append(np.arange(td[0], td[-1], KNOT_SPACING), td[-1])
    s_out = PchipInterpolator(knots, np.interp(knots, td, s))(td)
    return track.with_poses(*drive_along(td, s_out, s, xy, yaw))


# ---------------------------------------------------------------------------- paths and agents
class Path:
    """A polyline parametrised by arc length s, with a heading along it."""

    RES = 0.5  # m, spacing of the samples used for projection

    def __init__(self, xy, heading):
        xy = np.asarray(xy, float).reshape(-1, 2)
        heading = np.unwrap(np.asarray(heading, float).reshape(-1))
        step = np.hypot(*np.diff(xy, axis=0).T) if len(xy) > 1 else np.zeros(0)
        keep = np.concatenate([[True], step > 1e-6])
        self.xy, self.h = xy[keep], heading[keep]
        self.s = np.concatenate([[0.0], np.cumsum(step[step > 1e-6])])
        self.length = float(self.s[-1])
        n = max(2, math.ceil(self.length / self.RES) + 1)
        self.ds = np.linspace(0.0, self.length, n)
        self.dxy = self.pos(self.ds)
        self.dh = self.heading(self.ds)

    def pos(self, s):
        s = np.clip(np.asarray(s, float), 0.0, self.length)
        if len(self.s) == 1:
            return np.broadcast_to(self.xy[0], (*s.shape, 2)).copy()
        return np.stack([np.interp(s, self.s, self.xy[:, k]) for k in (0, 1)], axis=-1)

    def heading(self, s):
        s = np.clip(np.asarray(s, float), 0.0, self.length)
        return np.interp(s, self.s, self.h) if len(self.s) > 1 else np.full(s.shape, self.h[0])

    def project_many(self, points, s_lo, s_hi):
        """(arc length, signed lateral offset, path heading) of each point, searched in [s_lo, s_hi] only."""
        i0 = int(np.searchsorted(self.ds, max(s_lo, 0.0), "left"))
        i1 = int(np.searchsorted(self.ds, min(s_hi, self.length), "right"))
        if i1 <= i0:
            return None
        d = points[:, None, :] - self.dxy[None, i0:i1, :]
        k = i0 + np.argmin(np.einsum("pij,pij->pi", d, d), axis=1)
        c, s = np.cos(self.dh[k]), np.sin(self.dh[k])
        rx, ry = points[:, 0] - self.dxy[k, 0], points[:, 1] - self.dxy[k, 1]
        return self.ds[k] + rx * c + ry * s, c * ry - s * rx, self.dh[k]


@dataclass
class Agent:
    name: str
    actor_id: str
    category: str
    kind: str
    is_ego: bool
    static: bool
    length: float
    width: float
    centre_x: float  # box centre ahead of the reference point (the ego pose; 0 for annotated boxes)
    path: Path
    k0: int  # first grid step present
    k1: int  # last grid step present
    s_nom: np.ndarray  # (K,) progress along the path, nan when absent
    v_nom: np.ndarray  # (K,) nominal speed, nan when absent
    stops: list = field(default_factory=list)  # (s_star, k_start, k_end) of nominal stops
    T: float = T_DEFAULT
    s0: float = S0_DEFAULT
    max_decel: float = MAX_DECEL
    T_measured: bool = False
    s0_measured: bool = False

    @property
    def vehicle(self):
        return self.kind == "vehicle"

    @property
    def front(self):
        """Front bumper ahead of the reference point."""
        return self.centre_x + self.length / 2

    def centre(self, s):
        ref = self.path.pos(s)
        h = float(self.path.heading(s))
        return float(ref[0]) + self.centre_x * math.cos(h), float(ref[1]) + self.centre_x * math.sin(h), h


class SceneModel:
    """Nominal motion of every object on the DT grid, the nominal leader of every vehicle, and each vehicle's
    following parameters measured on its own recording."""

    def __init__(self, name, duration, tracks, map_data=None):
        self.name = name
        self.duration = float(duration)
        self.K = math.floor(self.duration / DT + 1e-9) + 1
        self.t = np.arange(self.K) * DT
        self.tracks = tracks
        self.map_data = map_data
        self.nominal = [tr if tr.name == "ego" else pilot(tr) for tr in tracks]
        self.agents = [self._agent(raw, nom) for raw, nom in zip(tracks, self.nominal)]
        self.index = {a.name: i for i, a in enumerate(self.agents)}
        self.by_actor = {a.actor_id: i for i, a in enumerate(self.agents)}
        n = len(self.agents)
        self.S = np.full((self.K, n), np.nan)
        self.V = np.full((self.K, n), np.nan)
        self.X = np.full((self.K, n), np.nan)
        self.Y = np.full((self.K, n), np.nan)
        self.H = np.full((self.K, n), np.nan)
        for i, a in enumerate(self.agents):
            k = slice(a.k0, a.k1 + 1)
            self.S[k, i], self.V[k, i] = a.s_nom[k], a.v_nom[k]
            ref = a.path.pos(a.s_nom[k])
            h = a.path.heading(a.s_nom[k])
            self.X[k, i] = ref[:, 0] + a.centre_x * np.cos(h)
            self.Y[k, i] = ref[:, 1] + a.centre_x * np.sin(h)
            self.H[k, i] = h
        self.present = ~np.isnan(self.S)
        self.vehicles = np.array([a.vehicle for a in self.agents])
        self.movers = np.array([a.vehicle and not a.static for a in self.agents])
        self.half_length = np.array([a.length / 2 for a in self.agents])
        self.half_diag = np.array([math.hypot(a.length, a.width) / 2 for a in self.agents])
        self.outlines = [outline(0.0, 0.0, 0.0, a.length, a.width) for a in self.agents]
        self._overlap_cache = {}
        self.leader, self.gap = self._nominal_leaders()
        self._calibrate()

    def _agent(self, raw, nominal):
        static = raw.name != "ego" and (raw.is_stationary or raw.parked or nominal.is_static)
        t0, t1 = float(raw.t[0]), float(raw.t[-1])
        k0 = min(self.K - 1, max(0, math.ceil(t0 / DT - 1e-6)))
        k1 = min(self.K - 1, max(k0, math.floor(t1 / DT + 1e-6)))
        s_nom = np.full(self.K, np.nan)
        v_nom = np.full(self.K, np.nan)
        ego = raw.name == "ego"
        length, width, _ = EGO_SIZE if ego else raw.size
        if static:
            path = Path(nominal.xy[:1], nominal.yaw[:1])
            s_nom[k0:k1 + 1] = 0.0
            v_nom[k0:k1 + 1] = 0.0
        else:
            path = Path(nominal.xy, nominal.yaw)
            s_track = np.maximum.accumulate(arc_length(nominal.xy))
            tk = self.t[k0:k1 + 1]
            s_nom[k0:k1 + 1] = np.clip(np.interp(tk, nominal.t, s_track), 0.0, path.length)
            v_nom[k0:k1 + 1] = np.gradient(s_nom[k0:k1 + 1], DT) if k1 > k0 else 0.0
        agent = Agent(raw.name, raw.actor_id, raw.category, raw.kind, ego, static, float(length), float(width),
                      EGO_BBOX_CENTER_X if ego else 0.0, path, k0, k1, s_nom, v_nom,
                      max_decel=HEAVY_MAX_DECEL if raw.category in HEAVY_CATEGORIES else MAX_DECEL)
        if not static:
            agent.stops = self._stops(agent)
        return agent

    def _stops(self, a):
        """Nominal stops: at least STOP_MIN slower than STOP_SPEED, then moving again."""
        v = a.v_nom[a.k0:a.k1 + 1]
        slow = v < STOP_SPEED
        stops, k = [], 0
        while k < len(v):
            if not slow[k]:
                k += 1
                continue
            j = k
            while j + 1 < len(v) and slow[j + 1]:
                j += 1
            if (j - k + 1) * DT >= STOP_MIN and j + 1 < len(v) and v[j + 1:].max() > 1.0:
                stops.append((float(a.s_nom[a.k0 + k]), a.k0 + k, a.k0 + j))
            k = j + 1
        return stops

    def _nominal_leaders(self):
        n = len(self.agents)
        leader = np.full((self.K, n), -1, int)
        gap = np.full((self.K, n), np.nan)
        for i, a in enumerate(self.agents):
            if not self.movers[i]:
                continue
            prev = -1
            for k in range(a.k0, a.k1 + 1):
                j, g = find_leader(self, i, a.s_nom[k], self.X[k], self.Y[k], self.H[k], self.V[k], self.present[k], prev)
                leader[k, i], gap[k, i] = j, g
                prev = j
        return leader, gap

    def _calibrate(self):
        """T: median time gap while steadily following above 3 m/s; s0: smallest gap with both stopped."""
        hold = round(FOLLOW_MIN_TIME / DT)
        for i, a in enumerate(self.agents):
            if not self.movers[i]:
                continue
            lead, g, v = self.leader[:, i], self.gap[:, i], self.V[:, i]
            steady = np.zeros(self.K, bool)
            run = 0
            for k in range(self.K):
                run = run + 1 if lead[k] >= 0 and k > 0 and lead[k] == lead[k - 1] else (1 if lead[k] >= 0 else 0)
                steady[k] = run >= hold
            following = steady & (v > 3.0) & (g > 0)
            if following.sum() >= hold:
                a.T = float(np.clip(np.median(g[following] / v[following]), *T_RANGE))
                a.T_measured = True
            lead_v = np.array([self.V[k, lead[k]] if lead[k] >= 0 else np.nan for k in range(self.K)])
            stopped = steady & (v < STOP_SPEED) & (lead_v < STOP_SPEED) & (g > 0)
            if stopped.any():
                a.s0 = float(np.clip(g[stopped].min(), *S0_RANGE))
                a.s0_measured = True

    def tau_of_s(self, i, s):
        """Earliest nominal time at which agent i reaches progress s."""
        a = self.agents[i]
        sn = a.s_nom[a.k0:a.k1 + 1]
        k = int(np.searchsorted(sn, s - 1e-9, "left"))
        if k <= 0:
            return float(self.t[a.k0])
        if k >= len(sn):
            return float(self.t[a.k1])
        s_lo, s_hi = sn[k - 1], sn[k]
        frac = 0.0 if s_hi <= s_lo else (s - s_lo) / (s_hi - s_lo)
        return float(self.t[a.k0 + k - 1] + frac * DT)

    def nominal_at(self, i, tau):
        """(progress, speed) of agent i's nominal motion at time tau (clamped to its span)."""
        a = self.agents[i]
        tk = self.t[a.k0:a.k1 + 1]
        return float(np.interp(tau, tk, a.s_nom[a.k0:a.k1 + 1])), float(np.interp(tau, tk, a.v_nom[a.k0:a.k1 + 1]))

    def nominal_accel(self, i, tau):
        a = self.agents[i]
        if a.k1 <= a.k0:
            return 0.0
        tk = self.t[a.k0:a.k1 + 1]
        return float(np.interp(tau, tk, np.gradient(a.v_nom[a.k0:a.k1 + 1], DT)))


def outline(cx, cy, h, length, width, step=1.0):
    """Points on a box outline, at most `step` apart."""
    c, s = math.cos(h), math.sin(h)
    lx, ly = length / 2, width / 2
    corners_ = [(-lx, -ly), (lx, -ly), (lx, ly), (-lx, ly)]
    pts = []
    for (x0, y0), (x1, y1) in zip(corners_, corners_[1:] + corners_[:1]):
        n = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / step))
        u = np.arange(n) / n
        px, py = x0 + u * (x1 - x0), y0 + u * (y1 - y0)
        pts.append(np.column_stack([cx + px * c - py * s, cy + px * s + py * c]))
    return np.vstack(pts)


def find_leader(model, i, s_i, cx, cy, ch, cv, present, prev=-1):
    """Closest vehicle ahead whose box reaches into i's path corridor: (index, bumper gap), or (-1, nan)."""
    ahead = vehicles_ahead(model, i, s_i, cx, cy, ch, cv, present)
    if not ahead:
        return -1, float("nan")
    best_gap, best = ahead[0]
    for g, j in ahead:
        if j == prev and g <= best_gap + LEADER_HOLD:
            return j, g
    return best, best_gap


def vehicles_ahead(model, i, s_i, cx, cy, ch, cv, present):
    """Every vehicle ahead in agent i's path corridor, as (bumper gap, index), closest first."""
    a = model.agents[i]
    hx, hy = a.centre(s_i)[:2]
    dx, dy = cx - hx, cy - hy
    h_i = float(a.path.heading(s_i))
    reach = model.half_length
    with np.errstate(invalid="ignore"):
        ahead = dx * math.cos(h_i) + dy * math.sin(h_i) > -a.length / 2 - reach
        near = present & model.vehicles & ahead & (np.hypot(dx, dy) < LOOKAHEAD + a.length + reach + 5.0)
    near[i] = False
    half = a.width / 2 + CORRIDOR_MARGIN
    window = (s_i, s_i + a.front + LOOKAHEAD + 1.0)
    cand = np.flatnonzero(near)
    if not len(cand):
        return []
    centre = a.path.project_many(np.column_stack([cx[cand], cy[cand]]), *window)
    if centre is None:
        return []
    cand = cand[np.abs(centre[1]) <= half + model.half_diag[cand]]
    if not len(cand):
        return []
    c, s = np.cos(ch[cand]), np.sin(ch[cand])
    sizes = np.array([len(model.outlines[j]) for j in cand])
    owner = np.repeat(np.arange(len(cand)), sizes)
    local = np.vstack([model.outlines[j] for j in cand])
    pts = np.column_stack([cx[cand][owner] + local[:, 0] * c[owner] - local[:, 1] * s[owner],
                           cy[cand][owner] + local[:, 0] * s[owner] + local[:, 1] * c[owner]])
    along, lateral, h_path = a.path.project_many(pts, *window)
    inside = (np.abs(lateral) < half) & (along > s_i)
    nearest = np.where(inside, along, np.inf)
    starts = np.concatenate([[0], np.cumsum(sizes)[:-1]])
    first = np.minimum.reduceat(nearest, starts)
    found = []
    for n, j in enumerate(cand):
        if not np.isfinite(first[n]):
            continue
        if cv[j] > STATIC_SPEED:  # a moving vehicle must travel along the path, not across it
            k = starts[n] + int(np.argmin(nearest[starts[n]:starts[n] + sizes[n]]))
            if abs(_wrap(ch[j] - h_path[k])) > HEADING_TOL:
                continue
        g = float(first[n]) - s_i - a.front
        if g < ALONGSIDE_GAP or g > LOOKAHEAD:
            continue
        found.append((g, int(j)))
    return sorted(found)


# ---------------------------------------------------------------------------- simulation
@dataclass(frozen=True)
class Event:
    actor: str  # agent name
    t0: float  # s, braking starts
    decel: float = 0.0  # m/s^2, brake only
    target: str = "stop"  # "stop" | "half", brake only
    dwell: float = 0.0  # s standing still, for target "stop"
    kind: str = "brake"
    target_mps: float = 0.0
    accel_mps2: float = 0.0
    direction: str = ""
    duration_s: float = 0.0
    stopline: dict | None = None


@dataclass
class Outcome:
    event: Event | None
    react: bool
    S: np.ndarray  # (K, N) progress (nominal where unchanged)
    V: np.ndarray  # (K, N) speed
    A: np.ndarray  # (K, N) commanded acceleration (0 where nominal)
    changed: np.ndarray  # (N,) motion differs from nominal at some time
    stimulus: dict  # agent -> time it saw its leader deviate
    driving_from: dict  # agent -> time it started driving itself
    event_phases: dict
    entered: dict = field(default_factory=dict)
    mode: np.ndarray | None = None
    leader: np.ndarray | None = None
    gap: np.ndarray | None = None
    reaction: float = REACTION
    path_override: object | None = None
    kind_detail: dict = field(default_factory=dict)


def enhanced_idm(v, v0, gap, v_l, a_l, s0, T):
    """(interaction term (s*/gap)^2, acceleration) of the enhanced IDM (Kesting, Treiber, Helbing 2010): the
    IDM blended with the constant-acceleration heuristic where the IDM brakes harder than needed."""
    g = max(gap, 0.05)
    dv = v - v_l
    s_star = s0 + max(0.0, v * T + v * dv / (2 * math.sqrt(IDM_A * IDM_B)))
    term = (s_star / g) ** 2
    a_idm = IDM_A * (1.0 - (v / v0) ** 4 - term)
    a_l = min(a_l, IDM_A)
    denom = v_l * v_l - 2 * g * a_l
    if v_l * dv <= -2 * g * a_l and denom > 1e-9:
        a_cah = v * v * a_l / denom
    else:
        a_cah = a_l - max(dv, 0.0) ** 2 / (2 * g)
    if a_idm >= a_cah:
        return term, a_idm
    return term, (1 - COOLNESS) * a_idm + COOLNESS * (a_cah + IDM_B * math.tanh((a_idm - a_cah) / IDM_B))


def _accel_of(model, j, k, t, mode, changed, A, delta):
    if changed[j] and mode[j] in (DRIVING, EVENT):
        return float(A[k, j])
    if changed[j]:
        return model.nominal_accel(j, t - delta[j])
    return model.nominal_accel(j, t)


def integrate(s, v, a, dt=DT):
    """One step at constant acceleration; a stop inside the step ends exactly at standstill."""
    v1 = v + a * dt
    if v1 < 0.0:
        return (s + v * v / (-2.0 * a) if a < 0 else s), 0.0
    return s + v * dt + 0.5 * a * dt * dt, v1


def jerk_limited(a_prev, a_target, brake_jerk=JERK_BRAKE):
    """Acceleration after one step towards a_target. Braking while accelerating: throttle off at once, then
    braking builds up from zero."""
    if a_target < a_prev:
        if a_target < 0.0 < a_prev:
            a_prev = 0.0
        return max(a_target, a_prev - brake_jerk * DT)
    return min(a_target, a_prev + JERK_NORMAL * DT)


KIND_ACCELS = (1.0, 2.0, 3.0)
KIND_DWELLS = (0.0, 3.0, 10.0)
KIND_DURATIONS = (3.0, 4.0, 6.0)
KIND_TARGET_DELTAS = (3.0, 6.0)
KIND_MAX_TARGET_MPS = 25.0
KIND_TARGET_MIN_DELTA = 0.5
KIND_LANE_SAMPLE_S = 0.5
KIND_TARGET_FOLLOW_SAMPLE_S = 0.1
KIND_TARGET_FOLLOW_LATERAL_SLACK = 0.5
MOBIL_B_SAFE = 4.0
STOP_SETTLE_SPEED = 0.03
STOP_SETTLE_GAP = 0.1


class ShiftedPath(Path):
    """Adjacent-lane centre as a function of longitudinal progress and event time."""

    def __init__(self, base, s0, s1, sample_s, target_offsets, t0, duration, route_xy=None):
        self.base, self.s0, self.s1 = base, s0, s1
        self.sample_s = np.asarray(sample_s, float)
        self.target_offsets = np.asarray(target_offsets, float)
        self.t0, self.duration = t0, duration
        self.route_start_s = s1
        if route_xy is not None:
            gradient = np.gradient(route_xy, axis=0)
            self.route = Path(route_xy, np.arctan2(gradient[:, 1], gradient[:, 0]))
        else:
            self.route = None
        self.length = base.length
        self.ds = base.ds
        self.set_time(t0, 0.0)

    def _raw_pos(self, s, t):
        s = np.asarray(s, float)
        u = np.clip((t - self.t0) / self.duration, 0.0, 1.0)
        ease = (1 - np.cos(np.pi * u)) / 2
        target = np.interp(s, self.sample_s, self.target_offsets)
        xy = self.base.pos(s)
        h = self.base.heading(s)
        shifted = xy + np.stack([-np.sin(h) * target * ease, np.cos(h) * target * ease], axis=-1)
        if self.route is not None and t >= self.t0 + self.duration:
            after = s > self.route_start_s
            if np.any(after):
                routed = self.route.pos(np.maximum(s - self.route_start_s, 0.0))
                shifted = np.where(np.expand_dims(after, -1), routed, shifted)
        return shifted

    def join_route(self, s, map_data, direction):
        """Anchor the successor route at the actual end position after IDM changes progress."""
        xy = self._raw_pos(s, self.t0 + self.duration - 1e-9)
        prior = self._raw_pos(min(s + 0.1, self.length), self.t0 + self.duration - 1e-9)
        heading = math.atan2(float(prior[1] - xy[1]), float(prior[0] - xy[0]))
        side = map_data.nearest_side(self.base.pos(s), float(self.base.heading(s)), direction)
        if side is None:
            return
        route_xy = map_data.follow_route(side[2], xy, self.length - s, heading)
        if route_xy is not None:
            self.route_start_s = float(s)
            gradient = np.gradient(route_xy, axis=0)
            self.route = Path(route_xy, np.arctan2(gradient[:, 1], gradient[:, 0]))

    def progress_for_speed(self, s, t, distance):
        """Convert world travel distance to progress on a moving lateral path."""
        start = self._raw_pos(s, t)
        lo, hi = float(s), min(float(s) + max(2 * distance, 0.5), self.length)
        for _ in range(18):
            mid = (lo + hi) / 2
            if np.linalg.norm(self._raw_pos(mid, t + DT) - start) < distance:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    def set_time(self, t, speed):
        self.current_time = float(t)
        self.current_speed = max(float(speed), 0.0) if np.isfinite(speed) else 0.0
        self.dxy = self._raw_pos(self.ds, self.current_time)
        next_s = np.clip(self.ds + max(self.current_speed, 0.1) * DT, 0, self.length)
        next_xy = self._raw_pos(next_s, self.current_time + DT)
        delta = next_xy - self.dxy
        base_h = self.base.heading(self.ds)
        self.dh = np.unwrap(np.where(np.hypot(delta[:, 0], delta[:, 1]) > 1e-8,
                                     np.arctan2(delta[:, 1], delta[:, 0]), base_h))

    def pos(self, s):
        return self._raw_pos(s, self.current_time)

    def heading(self, s):
        return np.interp(np.clip(np.asarray(s, float), 0, self.length), self.ds, self.dh)

    def pose(self, s, t, speed):
        """World pose at a clock time; time, not distance travelled, completes the half-cosine."""
        xy = self._raw_pos(s, t)
        ahead = self._raw_pos(min(s + max(float(speed), 0.1) * DT, self.length), t + DT)
        delta = ahead - xy
        h = (math.atan2(float(delta[1]), float(delta[0])) if np.hypot(*delta) > 1e-8
             else float(self.base.heading(s)))
        return xy, h


def lane_plan(model, index, t0, direction, duration):
    """Validate the adjacent, same-direction lane throughout the manoeuvre and make its path."""
    cache = getattr(model, "_lane_plan_cache", None)
    key = (index, t0, direction, duration)
    if cache is not None and key in cache:
        return cache[key]
    if model.map_data is None or duration <= 0:
        return None
    a = model.agents[index]
    times = np.arange(t0, t0 + duration + 1e-6, KIND_LANE_SAMPLE_S)
    if not len(times) or times[-1] < t0 + duration - 1e-6:
        times = np.append(times, t0 + duration)
    sample_s, offsets = [], []
    previous_lane = None
    for t in times:
        k = round(t / DT)
        if k >= model.K or not np.isfinite(a.s_nom[k]):
            return None
        s = float(a.s_nom[k])
        xy = a.path.pos(s)
        h = float(a.path.heading(s))
        side = model.map_data.nearest_side(xy, h, direction)
        if side is None or (previous_lane is not None and not model.map_data.connected(previous_lane, side[2])):
            return None
        previous_lane = side[2]
        sample_s.append(s)
        offsets.append(side[1])
    if sample_s[-1] - sample_s[0] < 1.0:
        return None
    endpoint_h = float(a.path.heading(sample_s[-1]))
    endpoint = a.path.pos(sample_s[-1]) + offsets[-1] * np.array([-math.sin(endpoint_h), math.cos(endpoint_h)])
    route_xy = model.map_data.follow_route(previous_lane, endpoint, a.path.length - sample_s[-1])
    # Preserve one value per progress sample for np.interp, including a slow final segment.
    keep = np.r_[True, np.diff(sample_s) > 1e-6]
    path = ShiftedPath(a.path, sample_s[0], sample_s[-1], np.asarray(sample_s)[keep],
                       np.asarray(offsets)[keep], t0, duration, route_xy)
    if cache is None:
        model._lane_plan_cache = {}
        cache = model._lane_plan_cache
    cache[key] = path
    return path


def simulate(model, event, react=True, reaction=REACTION):
    """Run one event (None: nothing happens, everyone replays). react=False: only the event vehicle changes."""
    kind = event.kind if event is not None else "brake"
    if kind == "accelerate":
        e0 = model.index[event.actor]
        if event.target_mps <= model.V[round(event.t0 / DT), e0] + 1e-9:
            return simulate(model, None, react, reaction)
    if kind == "lane_change" and event.duration_s == 0:
        return simulate(model, None, react, reaction)
    original_model = model
    path_override = None
    if kind == "lane_change":
        index = model.index[event.actor]
        path_override = lane_plan(model, index, event.t0, event.direction, event.duration_s)
        require(path_override is not None, "Không có làn kề cùng chiều suốt thời gian chuyển", "EVENT_NOT_ALLOWED")
        path_override = copy.copy(path_override)
        model = copy.copy(model)
        model.agents = list(original_model.agents)
        model.agents[index] = replace(original_model.agents[index], path=path_override)
    n, K = len(model.agents), model.K
    mode_hist = np.zeros((K, n), np.int8)
    leader_hist = np.full((K, n), -1, int)
    gap_hist = np.full((K, n), np.nan)
    S, V = model.S.copy(), model.V.copy()
    A = np.zeros((K, n))
    mode = np.full(n, NOMINAL)
    changed = np.zeros(n, bool)
    tau = np.full(n, np.nan)
    drive_at = np.full(n, np.inf)
    delta = np.zeros(n)
    rejoin = np.zeros(n)
    dwelling = np.full(n, -1)
    done_stops = [set() for _ in range(n)]
    stimulus, driving_from, phases, entered = {}, {}, {}, {}
    e = model.index[event.actor] if event is not None else -1
    k_event = round(event.t0 / DT) if event is not None else -1
    phase, v_target, dwell_until = None, 0.0, None
    present = model.present.copy()

    for k in range(K - 1):
        t = k * DT
        if path_override is not None and k == round((event.t0 + event.duration_s) / DT) \
                and np.isfinite(S[k, e]):
            path_override.join_route(S[k, e], model.map_data, event.direction)
        if path_override is not None and k_event <= k <= round((event.t0 + event.duration_s) / DT):
            path_override.set_time(t, V[k, e])
        cx, cy, ch = model.X[k].copy(), model.Y[k].copy(), model.H[k].copy()
        cv = V[k].copy()
        for i in np.flatnonzero(changed):
            if present[k, i]:
                cx[i], cy[i], ch[i] = model.agents[i].centre(S[k, i])
        pres = present[k]

        if k == k_event and pres[e] and mode[e] == NOMINAL:
            mode[e], changed[e] = EVENT, True
            if kind == "brake":
                phase = "brake"
                v_target = 0.0 if event.target == "stop" else 0.5 * V[k, e]
                phases["brake_start"] = t
            else:
                phase = kind
                phases["event_start"] = t

        live = np.flatnonzero(changed & pres)
        if react and len(live):
            watchers = model.movers & pres & ((mode == NOMINAL) | (mode == LATE))
            d = np.hypot(cx[:, None] - cx[live][None, :], cy[:, None] - cy[live][None, :])
            watchers &= np.nanmin(np.where(np.isnan(d), np.inf, d), axis=1) < LOOKAHEAD + 30.0
            for i in np.flatnonzero(watchers):
                deviates = False
                for g, j in vehicles_ahead(model, i, S[k, i], cx, cy, ch, cv, pres)[:WATCH_AHEAD]:
                    if not changed[j]:
                        continue
                    if mode[i] == NOMINAL:
                        deviates = V[k, j] < model.V[k, j] - DEV_SPEED or model.S[k, j] - S[k, j] > DEV_LAG \
                            or np.isnan(model.S[k, j])
                        if not deviates and kind != "brake":
                            deviates = (abs(V[k, j] - model.V[k, j]) > DEV_SPEED
                                        or abs(S[k, j] - model.S[k, j]) > DEV_LAG
                                        or (kind == "lane_change" and j == e
                                            and math.hypot(cx[j] - model.X[k, j], cy[j] - model.Y[k, j])
                                            > DEV_LAG))
                    else:  # late: react when a vehicle ahead is still being driven and too close
                        a_i = model.agents[i]
                        deviates = mode[j] in (DRIVING, EVENT) and g < a_i.s0 + V[k, i] * a_i.T
                    if deviates:
                        break
                if deviates and mode[i] == NOMINAL and k == model.agents[i].k0:
                    # it only now enters the recorded data, behind a situation that had already changed
                    mode[i], changed[i] = DRIVING, True
                    tau[i] = t
                    A[k, i] = model.nominal_accel(i, t)
                    entered.setdefault(model.agents[i].name, t)
                    driving_from.setdefault(model.agents[i].name, t)
                    continue
                if deviates:
                    if mode[i] == LATE:
                        changed[i] = True
                    mode[i], drive_at[i] = WAITING, t + reaction
                    stimulus.setdefault(model.agents[i].name, t)
            for i in np.flatnonzero(mode == WAITING):
                if t + 1e-9 >= drive_at[i] and not np.isnan(S[k, i]):
                    tau[i] = min(model.tau_of_s(i, S[k, i]), t)
                    if not changed[i]:
                        A[k, i] = model.nominal_accel(i, tau[i])
                    mode[i], changed[i] = DRIVING, True
                    driving_from.setdefault(model.agents[i].name, t)
                    rejoin[i] = 0.0

        for i in range(n):
            if not changed[i] or not pres[i] or np.isnan(S[k, i]):
                continue
            a_i = model.agents[i]
            s, v, a_prev = S[k, i], V[k, i], A[k, i]
            if mode[i] in (LATE, WAITING):
                s1, v1 = model.nominal_at(i, t + DT - delta[i])
                S[k + 1, i], V[k + 1, i] = s1, v1
                continue
            if mode[i] == EVENT:
                if kind == "accelerate":
                    a_target = event.accel_mps2 if v < event.target_mps else 0.0
                    j, g = find_leader(model, i, s, cx, cy, ch, cv, pres)
                    leader_hist[k, i], gap_hist[k, i] = j, g
                    if j >= 0:
                        term, a_idm = enhanced_idm(v, max(event.target_mps, MIN_V0), g, cv[j],
                                                    _accel_of(model, j, k, t, mode, changed, A, delta), a_i.s0, a_i.T)
                        if term >= REJOIN_INTERACTION:
                            a_target = min(a_target, a_idm)
                    a_cmd = jerk_limited(a_prev, float(np.clip(a_target, -a_i.max_decel, event.accel_mps2)),
                                         JERK_NORMAL)
                    s1, v1 = integrate(s, v, a_cmd)
                    if v1 > event.target_mps:
                        v1 = event.target_mps
                        s1 = s + (v + v1) * DT / 2
                elif kind == "stopline":
                    stop_s = event.stopline["s"] - STOP_S0
                    gap_stop = stop_s - s
                    if phase == "dwell":
                        a_cmd, s1, v1 = 0.0, s, 0.0
                        if t + DT + 1e-9 >= dwell_until:
                            phases["dwell_end"] = t + DT
                            mode[i], phase = DRIVING, "done"
                            tau[i] = min(model.tau_of_s(i, s), t + DT)
                            driving_from.setdefault(a_i.name, t + DT)
                    else:
                        a_target = -min(STOP_COMFORT_DECEL, v * v / max(2 * gap_stop, STOP_SETTLE_GAP))
                        a_cmd = jerk_limited(a_prev, a_target)
                        s1, v1 = integrate(s, v, a_cmd)
                        if s1 >= stop_s or (v1 <= STOP_SETTLE_SPEED and stop_s - s1 <= STOP_SETTLE_GAP):
                            s1, v1 = min(s1, stop_s), 0.0
                            phases["target_reached"] = t + DT
                            phase, dwell_until = "dwell", t + DT + event.dwell
                elif kind == "lane_change":
                    v_plan = model.nominal_at(i, t)[1]
                    a_target = float(np.clip(model.nominal_accel(i, t) + TRACK_GAIN * (v_plan - v), -IDM_B, IDM_A))
                    # Anticipate the leader in the destination lane before the boxes overlap laterally.
                    path_override.set_time(event.t0 + event.duration_s, v)
                    j, g = find_leader(model, i, s, cx, cy, ch, cv, pres)
                    path_override.set_time(t, v)
                    leader_hist[k, i], gap_hist[k, i] = j, g
                    if j >= 0:
                        term, a_idm = enhanced_idm(v, max(v_plan, MIN_V0), g, cv[j],
                                                    _accel_of(model, j, k, t, mode, changed, A, delta), a_i.s0, a_i.T)
                        if term >= REJOIN_INTERACTION:
                            a_target = min(a_target, a_idm)
                    a_cmd = jerk_limited(a_prev, float(np.clip(a_target, -a_i.max_decel, IDM_A)))
                    s1, v1 = integrate(s, v, a_cmd)
                    s1 = path_override.progress_for_speed(s, t, (v + v1) * DT / 2)
                    if t + DT >= event.t0 + event.duration_s:
                        phases["lane_arrived"] = t + DT
                        mode[i], phase = DRIVING, "done"
                        tau[i] = min(model.tau_of_s(i, s1), t + DT)
                elif phase == "brake":
                    a_cmd = jerk_limited(a_prev, -event.decel)
                    s1, v1 = integrate(s, v, a_cmd)
                    if v1 <= v_target + 1e-9:
                        phases["target_reached"] = t + DT
                        if event.target == "stop":
                            v1, phase, dwell_until = 0.0, "dwell", t + DT + event.dwell
                        else:
                            v1 = v_target
                            mode[i], phase = DRIVING, "done"
                            tau[i] = min(model.tau_of_s(i, s1), t + DT)
                            driving_from.setdefault(a_i.name, t + DT)
                elif phase == "dwell":
                    a_cmd, s1, v1 = 0.0, s, 0.0
                    if t + DT + 1e-9 >= dwell_until:
                        phases["dwell_end"] = t + DT
                        mode[i], phase = DRIVING, "done"
                        tau[i] = min(model.tau_of_s(i, s), t + DT)
                        driving_from.setdefault(a_i.name, t + DT)
                if s1 >= a_i.path.length - 1e-6 and a_i.path.length > 0:  # end of its recorded path: gone
                    S[k + 1:, i], V[k + 1:, i] = np.nan, np.nan
                    present[k + 1:, i] = False
                    continue
                S[k + 1, i], V[k + 1, i], A[k + 1, i] = s1, v1, a_cmd
                continue
            stop = dwelling[i]
            if stop >= 0:
                _, ks, ke = a_i.stops[stop]
                tau[i] = min(tau[i] + DT, t + DT)
                if tau[i] >= model.t[ke]:
                    done_stops[i].add(stop)
                    dwelling[i] = -1
                S[k + 1, i], V[k + 1, i], A[k + 1, i] = s, 0.0, 0.0
                continue
            obstacles = []  # (gap, speed, acceleration, s0, T) of the leader and of a nominal stop ahead
            j, g = find_leader(model, i, s, cx, cy, ch, cv, pres)
            leader_hist[k, i], gap_hist[k, i] = j, g
            if j >= 0:
                along = math.cos(_wrap(ch[j] - float(a_i.path.heading(s))))
                obstacles.append((g, cv[j] * along, _accel_of(model, j, k, t, mode, changed, A, delta) * along, a_i.s0, a_i.T))
            for idx, (s_stop, ks, ke) in enumerate(a_i.stops):
                if idx in done_stops[i] or s_stop < s - STOP_REACH or model.t[ke] <= tau[i]:
                    continue
                g_stop = s_stop - s
                if abs(g_stop) < STOP_REACH and v < 0.1:
                    dwelling[i] = idx
                    tau[i] = max(tau[i], model.t[ks])
                    break
                if g_stop < LOOKAHEAD:
                    obstacles.append((g_stop, 0.0, 0.0, STOP_S0, 0.0))
                break
            if dwelling[i] >= 0:
                S[k + 1, i], V[k + 1, i], A[k + 1, i] = s, 0.0, 0.0
                continue
            v_plan = model.nominal_at(i, tau[i])[1]
            if kind == "accelerate" and i != e:
                v_plan = max(v_plan, event.target_mps)
            a_free = float(np.clip(model.nominal_accel(i, tau[i]) + TRACK_GAIN * (v_plan - v), -IDM_B, IDM_A))
            a_target, interaction = a_free, 0.0
            v0 = max(v_plan, MIN_V0)
            for gap_o, v_l, a_l, s0_o, T_o in obstacles:
                term, a_o = enhanced_idm(v, v0, gap_o, v_l, a_l, s0_o, T_o)
                interaction = max(interaction, term)
                if term >= REJOIN_INTERACTION:
                    a_target = min(a_target, a_o)
            a_cmd = jerk_limited(a_prev, float(np.clip(a_target, -a_i.max_decel, IDM_A)))
            s1, v1 = integrate(s, v, a_cmd)
            if s1 >= a_i.path.length - 1e-6 and a_i.path.length > 0:
                S[k + 1:, i], V[k + 1:, i] = np.nan, np.nan
                present[k + 1:, i] = False
                continue
            S[k + 1, i], V[k + 1, i], A[k + 1, i] = s1, v1, a_cmd
            tau[i] = min(max(tau[i], model.tau_of_s(i, s1)), t + DT)
            if abs(v1 - model.nominal_at(i, tau[i])[1]) < REJOIN_SPEED and interaction < REJOIN_INTERACTION:
                rejoin[i] += DT
                if rejoin[i] >= REJOIN_TIME:
                    mode[i], delta[i] = LATE, t + DT - tau[i]
            else:
                rejoin[i] = 0.0
        mode_hist[k] = mode
        for i in np.flatnonzero(changed & ((mode == LATE) | (mode == WAITING))):
            a_i = model.agents[i]
            if t + DT - delta[i] > model.t[a_i.k1] + 1e-9:
                S[k + 1:, i], V[k + 1:, i] = np.nan, np.nan
                present[k + 1:, i] = False
            else:
                present[k + 1, i] = True
        for i in np.flatnonzero(changed & ((mode == DRIVING) | (mode == EVENT))):
            if not np.isnan(S[k + 1, i]):
                present[k + 1, i] = True
    mode_hist[K - 1] = mode
    if path_override is not None:
        path_override.set_time(event.t0 + event.duration_s, V[min(K - 1, round((event.t0 + event.duration_s) / DT)), e])
    result = Outcome(event, react, S, V, A, changed, stimulus, driving_from, phases, entered, mode_hist, leader_hist,
                     gap_hist, reaction, path_override)
    if kind == "stopline":
        result.kind_detail["stopline"] = {key: event.stopline[key] for key in ("id", "x_m", "y_m", "type")}
    if kind == "lane_change":
        path_times = np.linspace(event.t0, event.t0 + event.duration_s, 32)
        path_s = np.interp(path_times, model.t, np.nan_to_num(S[:, e], nan=0.0))
        result.kind_detail["path"] = [[round(float(x), 3), round(float(y), 3)]
                                      for (x, y) in (path_override.pose(s, t, 0.0)[0]
                                                     for s, t in zip(path_s, path_times))]
        followers = [j for j in _target_followers(original_model, e, event.t0, path_override)
                     if original_model.present[k_event, j]]
        if followers:
            s0 = float(original_model.S[k_event, e])
            h0 = float(original_model.H[k_event, e])
            target_offset = float(np.interp(s0, path_override.sample_s, path_override.target_offsets))
            target_xy = np.array([original_model.X[k_event, e], original_model.Y[k_event, e]]) \
                + np.array([-math.sin(h0), math.cos(h0)]) * target_offset
            def gap_for(j):
                delta = target_xy - np.array([original_model.X[k_event, j], original_model.Y[k_event, j]])
                return (float(delta[0] * math.cos(h0) + delta[1] * math.sin(h0))
                        - (original_model.agents[e].length + original_model.agents[j].length) / 2)
            j = min(followers, key=gap_for)
            follower = original_model.agents[j]
            gap = gap_for(j)
            v0 = max(float(original_model.V[k_event, j]), MIN_V0)
            _, accel = enhanced_idm(float(V[k_event, j]), v0, gap, float(V[k_event, e]),
                                    float(A[k_event, e]), follower.s0, follower.T)
            required = max(0.0, -accel)
            result.kind_detail["mobil"] = {"new_follower": follower.name,
                                            "required_decel_mps2": round(float(required), 3),
                                            "safe": bool(required <= MOBIL_B_SAFE)}
        result.kind_detail.setdefault("mobil", {"new_follower": None, "required_decel_mps2": None, "safe": None})
    return result


def centres(model, outcome):
    """Box centres and headings of every agent on the grid (K, N), nan when absent."""
    X, Y, H = model.X.copy(), model.Y.copy(), model.H.copy()
    for i in np.flatnonzero(outcome.changed):
        a = model.agents[i]
        path = outcome.path_override if outcome.event and outcome.event.kind == "lane_change" \
            and a.name == outcome.event.actor else a.path
        s = outcome.S[:, i]
        ok = ~np.isnan(s)
        X[:, i] = Y[:, i] = H[:, i] = np.nan
        if ok.any():
            if path is a.path:
                ref = path.pos(s[ok])
                h = path.heading(s[ok])
                X[ok, i] = ref[:, 0] + a.centre_x * np.cos(h)
                Y[ok, i] = ref[:, 1] + a.centre_x * np.sin(h)
                H[ok, i] = h
            else:
                for k in np.flatnonzero(ok):
                    if model.t[k] < outcome.event.t0:
                        X[k, i], Y[k, i], H[k, i] = model.X[k, i], model.Y[k, i], model.H[k, i]
                        continue
                    ref, h = path.pose(s[k], model.t[k], outcome.V[k, i])
                    X[k, i] = ref[0] + a.centre_x * math.cos(h)
                    Y[k, i] = ref[1] + a.centre_x * math.sin(h)
                    H[k, i] = h
    return X, Y, H


# ---------------------------------------------------------------------------- safety geometry
@dataclass
class BoxTrack:
    t: np.ndarray
    centre: np.ndarray  # (N, 2)
    heading: np.ndarray  # (N,)
    velocity: np.ndarray  # (N, 2)
    length: float
    width: float


def box_track(t, centre, heading, length, width):
    t, centre, heading = np.asarray(t, float), np.asarray(centre, float), np.asarray(heading, float)
    velocity = np.column_stack([np.gradient(centre[:, k], t) for k in (0, 1)]) if len(t) > 1 else np.zeros_like(centre)
    return BoxTrack(t, centre, heading, velocity, float(length), float(width))


def corners(centre, heading, length, width):
    """(..., 4, 2) corners, counter-clockwise from rear-right."""
    c, s = np.cos(heading)[..., None], np.sin(heading)[..., None]
    lx = np.array([-1, 1, 1, -1]) * length / 2
    ly = np.array([-1, -1, 1, 1]) * width / 2
    x = centre[..., 0:1] + c * lx - s * ly
    y = centre[..., 1:2] + s * lx + c * ly
    return np.stack([x, y], axis=-1)


def _axes(box):
    edges = np.stack([box[..., 1, :] - box[..., 0, :], box[..., 3, :] - box[..., 0, :]], axis=-2)
    return edges / np.linalg.norm(edges, axis=-1, keepdims=True)


def overlap(a, b):
    """Separating-axis test for two arrays of rectangles (..., 4, 2) -> bool (...)."""
    axes = np.concatenate([_axes(a), _axes(b)], axis=-2)
    pa = np.einsum("...ck,...ak->...ac", a, axes)
    pb = np.einsum("...ck,...ak->...ac", b, axes)
    separated = (pa.max(-1) < pb.min(-1)) | (pb.max(-1) < pa.min(-1))
    return ~separated.any(-1)


def _point_segment(points, start, end):
    d = (end - start)[..., None, :, :]
    w = points[..., :, None, :] - start[..., None, :, :]
    u = np.clip((w * d).sum(-1) / np.maximum((d * d).sum(-1), 1e-12), 0, 1)
    return np.linalg.norm(w - u[..., None] * d, axis=-1)


def box_gap(a, b):
    """Smallest distance between rectangle outlines (..., 4, 2); 0 where they overlap."""
    a_end, b_end = np.roll(a, -1, axis=-2), np.roll(b, -1, axis=-2)
    dist = np.minimum(_point_segment(a, b, b_end).min((-1, -2)), _point_segment(b, a, a_end).min((-1, -2)))
    return np.where(overlap(a, b), 0.0, dist)


def resample(box, t):
    interp = lambda v: np.interp(t, box.t, v)
    centre = np.column_stack([interp(box.centre[:, 0]), interp(box.centre[:, 1])])
    velocity = np.column_stack([interp(box.velocity[:, 0]), interp(box.velocity[:, 1])])
    return BoxTrack(t, centre, interp(np.unwrap(box.heading)), velocity, box.length, box.width)


def pair_measures(a, b):
    """Overlap, gap and TTC (constant velocity) over the time both objects are present."""
    t0, t1 = max(a.t[0], b.t[0]), min(a.t[-1], b.t[-1])
    t = np.arange(t0, t1 + 1e-9, GRID_DT) if t1 >= t0 else np.empty(0)
    if len(t) == 0:
        return {"t": t, "overlap": np.zeros(0, bool), "gap": np.zeros(0), "ttc": np.zeros(0)}
    ra, rb = resample(a, t), resample(b, t)
    ca = corners(ra.centre, ra.heading, a.length, a.width)
    cb = corners(rb.centre, rb.heading, b.length, b.width)
    now = overlap(ca, cb)
    horizon = np.arange(TTC_STEP, TTC_HORIZON + 1e-9, TTC_STEP)
    pa = ra.centre[:, None, :] + ra.velocity[:, None, :] * horizon[None, :, None]
    pb = rb.centre[:, None, :] + rb.velocity[:, None, :] * horizon[None, :, None]
    ha = np.broadcast_to(ra.heading[:, None], pa.shape[:2])
    hb = np.broadcast_to(rb.heading[:, None], pb.shape[:2])
    future = overlap(corners(pa, ha, a.length, a.width), corners(pb, hb, b.length, b.width))
    first = np.where(future.any(1), horizon[np.argmax(future, axis=1)], np.inf)
    return {"t": t, "overlap": now, "gap": box_gap(ca, cb), "ttc": np.where(now, 0.0, first)}


def braked_poses(box, t_brake, decels):
    """Box centres (A, N, 2) and headings (A, N) when the object keeps its path but, from t_brake on, drives at
    v(t) = min(v_rec(t), v_rec(t_brake) - a (t - t_brake)), never below 0; one row per deceleration."""
    t = box.t
    step = np.hypot(*np.diff(box.centre, axis=0).T)
    s = np.concatenate([[0.0], np.cumsum(step)])
    v_rec = np.gradient(s, t) if len(t) > 1 else np.zeros_like(t)
    k0 = int(np.searchsorted(t, t_brake - 1e-9))
    decels = np.asarray(decels, float)
    out_s = np.tile(s, (len(decels), 1))
    if k0 < len(t):
        v = np.clip(np.minimum(v_rec[None, k0:], v_rec[k0] - decels[:, None] * (t[None, k0:] - t[k0])), 0.0, None)
        travelled = np.concatenate([np.zeros((len(decels), 1)),
                                    np.cumsum(0.5 * (v[:, 1:] + v[:, :-1]) * np.diff(t[k0:]), axis=1)], axis=1)
        out_s[:, k0:] = np.minimum(s[k0] + travelled, s[None, k0:])
    keep = np.concatenate([[True], step > 1e-6])
    sk, heading = s[keep], np.unwrap(box.heading)[keep]
    if len(sk) == 1:
        return np.broadcast_to(box.centre[0], (*out_s.shape, 2)).copy(), np.full(out_s.shape, heading[0])
    centre = np.stack([np.interp(out_s, sk, box.centre[keep, k]) for k in (0, 1)], axis=-1)
    return centre, np.interp(out_s, sk, heading)


def braking_avoids(ego, actor, t_brake, decels):
    """For each deceleration: True when the braking ego's box overlaps the actor's at no time from t_brake on."""
    centre, heading = braked_poses(ego, t_brake, decels)
    mask = (ego.t >= t_brake - 1e-9) & (ego.t >= actor.t[0] - 1e-9) & (ego.t <= actor.t[-1] + 1e-9)
    if not mask.any():
        return np.ones(len(decels), bool)
    t = ego.t[mask]
    other = resample(actor, t)
    cb = corners(other.centre, other.heading, actor.length, actor.width)
    ca = corners(centre[:, mask], heading[:, mask], ego.length, ego.width)
    return ~overlap(ca, np.broadcast_to(cb, ca.shape)).any(axis=1)


# ---------------------------------------------------------------------------- candidates
def can_start(model, e, t0):
    """Vehicle e moves fast enough at t0, its data outlasts t0 by ACTOR_DATA_AFTER, and some vehicle follows it
    for FOLLOW_MIN_TIME within FOLLOW_WINDOW around t0."""
    a = model.agents[e]
    if a.is_ego or not model.movers[e]:
        return False
    k0 = round(t0 / DT)
    if k0 >= model.K or np.isnan(model.V[k0, e]) or model.V[k0, e] < EVENT_SPEED:
        return False
    if model.t[a.k1] < t0 + ACTOR_DATA_AFTER:
        return False
    return bool(len(_followers(model, e, t0)))


def _followers(model, e, t0):
    k0 = round(t0 / DT)
    lo = max(0, k0 + int(FOLLOW_WINDOW[0] / DT))
    hi = min(model.K, k0 + int(FOLLOW_WINDOW[1] / DT) + 1)
    hold = round(FOLLOW_MIN_TIME / DT)
    return np.flatnonzero((model.leader[lo:hi] == e).sum(axis=0) >= hold)


def fits(model, event):
    """The event (braking, dwell, getting back to speed) ends AFTER_EVENT before the scene does."""
    e = model.index[event.actor]
    if event.kind == "accelerate":
        speed = model.V[round(event.t0 / DT), e]
        return bool(event.t0 + max(0.0, event.target_mps - speed) / event.accel_mps2 + AFTER_EVENT
                    <= model.duration)
    if event.kind == "stopline":
        return bool(event.stopline is not None and event.stopline["t_reach_s"] + event.dwell + AFTER_EVENT
                    <= model.duration)
    if event.kind == "lane_change":
        return bool(event.t0 + event.duration_s + AFTER_EVENT <= model.duration)
    v0 = model.V[round(event.t0 / DT), e]
    ends = event.t0 + (v0 if event.target == "stop" else v0 / 2) / event.decel + event.dwell + v0 / IDM_A
    return bool(ends + AFTER_EVENT <= model.duration)


def stopline_viable(model, e, t0, line):
    """Use the event controller's own 1D steps to reject a stop that would need an instant speed jump."""
    k = round(t0 / DT)
    if k >= model.K or not all(np.isfinite(value) for value in (model.S[k, e], model.V[k, e])):
        return False
    stop_s = line["s"] - STOP_S0
    s, v, a = float(model.S[k, e]), float(model.V[k, e]), float(model.nominal_accel(e, t0))
    for _ in range(max(0, round((model.duration - t0) / DT))):
        gap = stop_s - s
        if gap <= 0:
            return False
        a_target = -min(STOP_COMFORT_DECEL, v * v / max(2 * gap, STOP_SETTLE_GAP))
        a = jerk_limited(a, a_target)
        s1, v1 = integrate(s, v, a)
        if s1 >= stop_s:
            # The controller snaps the final step to zero at the line. Bound that snap by this actor's
            # braking capability; a larger residual would create a physically invalid velocity jump.
            return v1 <= model.agents[e].max_decel * DT
        if v1 <= STOP_SETTLE_SPEED and stop_s - s1 <= STOP_SETTLE_GAP:
            return True
        s, v = s1, v1
    return False


def _label_spans(model):
    """Moving vehicles whose own recorded motion breaks the physics limits: name -> [[from, to], ...]."""
    out = {}
    for i in np.flatnonzero(model.movers):
        bad = _physics_violations(model.X, model.Y, i, model.agents[i].max_decel)
        if not len(bad):
            continue
        spans, start, prev = [], bad[0], bad[0]
        for k in bad[1:]:
            if (k - prev) * DT > 0.5:
                spans.append([round(float(model.t[start]), 2), round(float(model.t[prev]), 2)])
                start = k
            prev = k
        spans.append([round(float(model.t[start]), 2), round(float(model.t[prev]), 2)])
        out[model.agents[i].name] = spans
    return out


def _candidate_times(model, e):
    a = model.agents[e]
    times = []
    for t0 in np.arange(0.0, model.duration, WINDOW_STEP):
        t0 = round(float(t0), 2)
        # the lightest event (half speed at the vehicle's hardest braking, no dwell) must still fit
        if can_start(model, e, t0) and fits(model, Event(a.name, t0, a.max_decel, "half")):
            times.append(t0)
    return times


def _base_candidate_times(model, e):
    """Start times with a follower, before a particular kind's duration and parameters are applied."""
    return [t for raw in np.arange(0.0, model.duration, WINDOW_STEP)
            if can_start(model, e, (t := round(float(raw), 2)))]


def _max_target(model):
    return min(float(np.nanmax(model.V)) * 1.5, KIND_MAX_TARGET_MPS)


def _target_followers(model, e, t0, path):
    """Vehicles following the insertion point on the adjacent lane during the C2 window."""
    a = model.agents[e]
    result = []
    for j in np.flatnonzero(model.movers):
        if j == e:
            continue
        seen = 0
        for t in np.arange(max(0.0, t0 + FOLLOW_WINDOW[0]), min(model.duration, t0 + FOLLOW_WINDOW[1]) + 1e-9,
                           KIND_TARGET_FOLLOW_SAMPLE_S):
            k = round(t / DT)
            if k >= model.K or not model.present[k, e] or not model.present[k, j]:
                continue
            s = a.s_nom[k]
            base = a.path.pos(s)
            h = float(a.path.heading(s))
            target_offset = float(np.interp(s, path.sample_s, path.target_offsets))
            target = base + np.array([-math.sin(h), math.cos(h)]) * target_offset
            delta = target - np.array([model.X[k, j], model.Y[k, j]])
            along = delta[0] * math.cos(h) + delta[1] * math.sin(h)
            lateral = -delta[0] * math.sin(h) + delta[1] * math.cos(h)
            seen = (seen + 1 if 0 < along < LOOKAHEAD
                    and abs(lateral) < model.agents[j].width + KIND_TARGET_FOLLOW_LATERAL_SLACK else 0)
            if seen * KIND_TARGET_FOLLOW_SAMPLE_S >= FOLLOW_MIN_TIME - 1e-9:
                result.append(int(j))
                break
    return result


def _windows(times):
    windows = []
    for t in times:
        if windows and t - windows[-1][1] <= WINDOW_STEP + 1e-6:
            windows[-1][1] = t
        else:
            windows.append([t, t])
    return windows


# ---------------------------------------------------------------------------- assessment
def penetration(a, b):
    """Overlap depth of two rectangles (4, 2): smallest projection overlap on the 4 edge axes (0 if apart)."""
    depth = np.inf
    for box in (a, b):
        for edge in (box[1] - box[0], box[3] - box[0]):
            ax = edge / np.linalg.norm(edge)
            pa, pb = a @ ax, b @ ax
            d = min(pa.max(), pb.max()) - max(pa.min(), pb.min())
            if d <= 0:
                return 0.0
            depth = min(depth, d)
    return float(depth)


def _box(model, X, Y, H, k, i):
    a = model.agents[i]
    return corners(np.array([X[k, i], Y[k, i]]), np.array(H[k, i]), a.length, a.width)


@dataclass
class Assessment:
    valid: bool
    reasons: list
    collisions: list  # (agent, other, time, kind) kind = following | crossing | ego | appearing
    group: str
    ego: dict
    reacted: list
    max_decel_used: dict
    physics: dict
    gaps: dict
    excused: list = field(default_factory=list)  # (agent, other, time) recorded overlaps not counted, first per pair
    tailgate: dict = field(default_factory=dict)  # worst bumper gap of the tailgating check (_tailgate_measure)


def assess(model, outcome):
    """Validity (physics, overlaps, tailgating, unsupported cases) and the ego's rare-case group."""
    X, Y, H = centres(model, outcome)
    ego = model.index["ego"]
    changed = np.flatnonzero(outcome.changed)
    reasons, collisions = [], []

    physics = {}
    for i in changed:
        physics[model.agents[i].name] = _dynamics_extremes(model, X, Y, i)
        bad = _physics_violations(X, Y, i, model.agents[i].max_decel)
        if not len(bad):
            continue
        recorded = _physics_violations(model.X, model.Y, i, model.agents[i].max_decel)
        s_bad, s_rec = outcome.S[bad, i], model.S[recorded, i]
        label = len(s_rec) > 0 and all(np.abs(s_rec - s).min() <= LABEL_REACH for s in s_bad)
        reasons.append("label_error" if label else "physics")

    seen, excused = set(), []
    Xm, Ym = (X[:-1] + X[1:]) / 2, (Y[:-1] + Y[1:]) / 2
    Hm = H[:-1] + _wrap(H[1:] - H[:-1]) / 2
    frames = [(X, Y, H, 0.0), (Xm, Ym, Hm, DT / 2)]
    diag = model.half_diag
    for i in changed:
        for j in range(len(model.agents)):
            if j == i or (j in changed and j < i) or (i, j) in seen:
                continue
            for Xf, Yf, Hf, shift in frames:
                with np.errstate(invalid="ignore"):
                    close = np.flatnonzero(np.hypot(Xf[:, i] - Xf[:, j], Yf[:, i] - Yf[:, j]) < diag[i] + diag[j])
                hit = None
                for k in close:
                    depth = penetration(_box(model, Xf, Yf, Hf, k, i), _box(model, Xf, Yf, Hf, k, j))
                    if depth <= 0:
                        continue
                    if _excused(model, Xf, Yf, Hf, k, i, j, depth):
                        if len(excused) < 20 and (i, j) not in {(e[3], e[4]) for e in excused}:
                            excused.append((model.agents[i].name, model.agents[j].name,
                                            round(float(model.t[k] + shift), 2), i, j))
                        continue
                    hit = k
                    break
                if hit is not None:
                    t = model.t[hit] + shift
                    other = j if i == ego else i
                    appeared = max(model.t[model.agents[i].k0], model.t[model.agents[j].k0])
                    cut_in = (outcome.event is not None and outcome.event.kind == "lane_change"
                              and outcome.event.actor in (model.agents[i].name, model.agents[j].name)
                              and model.vehicles[i] and model.vehicles[j])
                    if cut_in:
                        kind = "following"
                    elif t - appeared < APPEAR_WINDOW and appeared > 0:
                        kind = "appearing"
                    elif ego in (i, j) and outcome.changed[other] and model.vehicles[other]:
                        kind = "ego"
                    elif ego in (i, j) or not (model.vehicles[i] and model.vehicles[j]):
                        kind = "crossing"
                    else:
                        kind = "crossing" if _merging(Hf, hit, i, j) else "following"
                    collisions.append((model.agents[i].name, model.agents[j].name, round(float(t), 3), kind))
                    seen.update({(i, j), (j, i)})
                    break
    kinds = {c[3] for c in collisions}
    if "crossing" in kinds:
        reasons.append("unsupported_interaction")
    if "appearing" in kinds:
        reasons.append("unsupported_appearing")
    if "following" in kinds:
        reasons.append("collision")
    tailgate = _tailgate_measure(model, outcome, X, Y, H, changed)
    if tailgate["found"]:
        reasons.append("tailgating")

    ego_info = _ego(model, outcome, X, Y, H, changed, collisions)
    reasons = sorted(set(reasons))
    used = {model.agents[i].name: round(float(-np.nanmin(np.minimum(outcome.A[:, i], 0))), 2) for i in changed}
    return Assessment(not reasons, reasons, collisions, ego_info.pop("group"), ego_info, sorted(outcome.driving_from),
                      used, physics, _closest_gaps(model, outcome), [e[:3] for e in excused], tailgate)


def _speed_accel(X, Y, i):
    idx = np.flatnonzero(~np.isnan(X[:, i]))
    if len(idx) < 2 * PHYSICS_SMOOTH:
        return idx, None, None
    step = np.hypot(np.diff(X[idx, i]), np.diff(Y[idx, i]))
    v = np.convolve(np.concatenate([[step[0]], step]) / DT, np.ones(PHYSICS_SMOOTH) / PHYSICS_SMOOTH, mode="valid")
    return idx, v, np.gradient(v, DT)


def _physics_violations(X, Y, i, max_decel):
    """Grid steps where i's motion (from positions, averaged over PHYSICS_SMOOTH steps) breaks a limit."""
    idx, v, acc = _speed_accel(X, Y, i)
    if v is None:
        return idx[:0]
    bad = (v > SPEED_LIMIT) | (acc > MAX_ACCEL) | (acc < -(max_decel + DECEL_SLACK))
    return idx[np.flatnonzero(bad) + PHYSICS_SMOOTH // 2]


def _dynamics_extremes(model, X, Y, i):
    out = {"limit_accel": MAX_ACCEL, "limit_decel": model.agents[i].max_decel + DECEL_SLACK}
    idx, v, acc = _speed_accel(X, Y, i)
    if v is None:
        return out
    at = model.t[idx[np.arange(len(acc)) + PHYSICS_SMOOTH // 2]]
    out.update(max_speed=round(float(v.max()), 2), max_accel=round(float(acc.max()), 2),
               t_accel=round(float(at[np.argmax(acc)]), 2), max_decel=round(float(-acc.min()), 2),
               t_decel=round(float(at[np.argmin(acc)]), 2))
    return out


def _closest_gaps(model, outcome):
    out = {}
    for i in np.flatnonzero(outcome.changed):
        g = outcome.gap[:, i]
        if np.all(np.isnan(g)):
            continue
        k = int(np.nanargmin(g))
        out[model.agents[i].name] = {"gap": round(float(g[k]), 3), "t": round(float(model.t[k]), 2),
                                     "speed": round(float(outcome.V[k, i]), 2),
                                     "leader": model.agents[outcome.leader[k, i]].name}
    return out


def _merging(H, k, i, j):
    lo = max(0, k - round(MERGE_LOOKBACK / DT))
    dh = np.abs(_wrap(H[lo:k + 1, i] - H[lo:k + 1, j]))
    dh = np.minimum(dh, math.pi - dh)
    return bool(np.nanmax(dh, initial=0.0) > HEADING_TOL)


def _relative(X, Y, H, k, i, j):
    h = H[k, j]
    dx, dy = X[k, i] - X[k, j], Y[k, i] - Y[k, j]
    return dx * math.cos(h) + dy * math.sin(h), -dx * math.sin(h) + dy * math.cos(h)


def _recorded_overlaps(model, i, j):
    key = (min(i, j), max(i, j))
    if key not in model._overlap_cache:
        found = []
        with np.errstate(invalid="ignore"):
            near = np.hypot(model.X[:, i] - model.X[:, j], model.Y[:, i] - model.Y[:, j]) < model.half_diag[i] + model.half_diag[j]
        for k in np.flatnonzero(near):
            d = penetration(_box(model, model.X, model.Y, model.H, k, key[0]), _box(model, model.X, model.Y, model.H, k, key[1]))
            if d > 0:
                found.append((*_relative(model.X, model.Y, model.H, k, key[0], key[1]), d))
        model._overlap_cache[key] = found
    return model._overlap_cache[key]


def _excused(model, X, Y, H, k, i, j, depth):
    """The recording has an overlap of the same pair in the same relative position, not much less deep."""
    along, across = _relative(X, Y, H, k, min(i, j), max(i, j))
    return any(abs(along - ra) < EXEMPT_ALONG and abs(across - rc) < EXEMPT_ACROSS and depth <= rd + EXEMPT_DEPTH
               for ra, rc, rd in _recorded_overlaps(model, i, j))


def _tailgating(model, outcome, X, Y, H, changed):
    return _tailgate_measure(model, outcome, X, Y, H, changed)["found"]


def _tailgate_measure(model, outcome, X, Y, H, changed):
    """Tailgating (gap < TAILGATE_GAP above TAILGATE_SPEED for longer than TAILGATE_TIME, not as in the recording)
    and the worst measure behind it: smallest counted gap, its time and pair, longest run (plan46 C2 checks)."""
    need = round(TAILGATE_TIME / DT)
    run = {}
    pres = ~np.isnan(X)
    out = {"found": False, "min_gap": None, "t": None, "pair": None, "longest_s": 0.0}
    for k in range(model.K):
        if not len(changed):
            break
        live = changed[pres[k, changed]]
        if not len(live):
            run.clear()
            continue
        d = np.hypot(X[k][:, None] - X[k, live][None, :], Y[k][:, None] - Y[k, live][None, :])
        near = np.nanmin(np.where(np.isnan(d), np.inf, d), axis=1) < LOOKAHEAD + 20.0
        for i in np.flatnonzero(model.movers & pres[k] & near):
            v = outcome.V[k, i]
            if np.isnan(v) or v <= TAILGATE_SPEED or model.agents[i].is_ego:
                run.pop(i, None)
                continue
            j, g = find_leader(model, i, outcome.S[k, i], X[k], Y[k], H[k], outcome.V[k], pres[k])
            if j < 0 or model.agents[j].is_ego or not (outcome.changed[i] or outcome.changed[j]):
                run.pop(i, None)
                continue
            as_recorded = model.leader[k, i] == j and model.gap[k, i] < TAILGATE_GAP + 0.1
            if not as_recorded and (out["min_gap"] is None or g < out["min_gap"]):
                out.update(min_gap=round(float(g), 3), t=round(float(model.t[k]), 2),
                           pair=(model.agents[i].name, model.agents[j].name))
            if g < TAILGATE_GAP and not as_recorded:
                run[i] = run.get(i, 0) + 1
                out["longest_s"] = max(out["longest_s"], round(run[i] * DT, 2))
                if run[i] > need:
                    out["found"] = True
            else:
                run.pop(i, None)
    return out


def _track_box(model, X, Y, H, i):
    ok = ~np.isnan(X[:, i])
    if ok.sum() < 2:
        return None
    a = model.agents[i]
    return box_track(model.t[ok], np.column_stack([X[ok, i], Y[ok, i]]), H[ok, i], a.length, a.width)


def _on_path(other, ego, t):
    """The other box overlaps the ego's lane strip (in front of or behind it), not beside it."""
    ro, re = resample(other, t), resample(ego, t)
    pts = corners(ro.centre, ro.heading, other.length, other.width)
    d = pts - re.centre[:, None, :]
    lateral = -np.sin(re.heading)[:, None] * d[..., 0] + np.cos(re.heading)[:, None] * d[..., 1]
    half = ego.width / 2
    return (lateral.max(axis=1) > -half) & (lateral.min(axis=1) < half)


def _ego(model, outcome, X, Y, H, changed, collisions):
    """What the event means for the ego (criteria v2 thresholds, on the reacting reference driver)."""
    e = model.index["ego"]
    info = {"stimulus": None, "a_min": None, "a_used": None, "min_gap": None, "min_ttc": None,
            "recorded_min_gap": None, "recorded_min_ttc": None, "conflict_with": None}
    others = [i for i in changed if i != e]
    if not others:
        info["group"] = "far"
        return info
    ego_box = _track_box(model, X, Y, H, e)
    rec_ego = _track_box(model, model.X, model.Y, model.H, e)
    best, new_close = None, False
    for j in others:
        bj = _track_box(model, X, Y, H, j)
        if bj is None or ego_box is None:
            continue
        m = pair_measures(bj, ego_box)
        if not len(m["t"]):
            continue
        on_path = _on_path(bj, ego_box, m["t"])
        gmin, tmin = float(m["gap"].min()), float(m["ttc"].min())
        gpath = float(m["gap"][on_path].min()) if on_path.any() else np.inf
        rj = _track_box(model, model.X, model.Y, model.H, j)
        rec = pair_measures(rj, rec_ego) if rj is not None and rec_ego is not None else None
        rec_ok = rec is not None and len(rec["t"])
        rec_path = _on_path(rj, rec_ego, rec["t"]) if rec_ok else None
        rec_g = float(rec["gap"][rec_path].min()) if rec_ok and rec_path.any() else np.inf
        rec_t = float(rec["ttc"].min()) if rec_ok else np.inf
        by_gap = gpath < CLOSE_GAP and gpath < rec_g - NEW_MARGIN
        by_ttc = tmin < CLOSE_TTC and tmin < rec_t - NEW_MARGIN
        new_close = new_close or by_gap or by_ttc
        key = (not (by_gap or by_ttc), gpath, tmin)
        if best is None or key < best[0]:
            best = (key, j, gmin, tmin, rec_g, rec_t)
    if best is not None:
        _, j, gmin, tmin, rec_g, rec_t = best
        info["conflict_with"] = model.agents[j].name
        info["min_gap"] = round(gmin, 3)
        info["min_ttc"] = None if np.isinf(tmin) else round(tmin, 3)
        info["recorded_min_gap"] = None if np.isinf(rec_g) else round(rec_g, 3)
        info["recorded_min_ttc"] = None if np.isinf(rec_t) else round(rec_t, 3)
    pres = ~np.isnan(X)
    for k in range(model.K):
        if not pres[k, e]:
            continue
        j, _ = find_leader(model, e, outcome.S[k, e], X[k], Y[k], H[k], outcome.V[k], pres[k])
        shifted = (outcome.event is not None and outcome.event.kind == "lane_change" and j >= 0
                   and model.agents[j].name == outcome.event.actor
                   and math.hypot(X[k, j] - model.X[k, j], Y[k, j] - model.Y[k, j]) > DEV_LAG)
        if j >= 0 and outcome.changed[j] and (outcome.V[k, j] < model.V[k, j] - DEV_SPEED
                                               or model.S[k, j] - outcome.S[k, j] > DEV_LAG or shifted):
            info["stimulus"] = round(float(model.t[k]), 3)
            break
    if outcome.changed[e]:
        info["a_used"] = round(float(-min(0.0, np.nanmin(outcome.A[:, e]))), 2)
    exceeds = False
    if info["stimulus"] is not None and rec_ego is not None:
        t_brake = info["stimulus"] + outcome.reaction
        needed = 0.0
        for j in others:
            bj = _track_box(model, X, Y, H, j)
            if bj is None or braking_avoids(rec_ego, bj, t_brake, np.array([0.0]))[0]:
                continue
            ok = braking_avoids(rec_ego, bj, t_brake, DECEL_GRID)
            needed = max(needed, float(DECEL_GRID[np.argmax(ok)]) if ok.any() else np.inf)
        exceeds = bool(np.isinf(needed))
        info["a_min"] = None if exceeds else round(needed, 1)
    if any(c[3] == "ego" or (outcome.event is not None and outcome.event.kind == "lane_change"
                            and "ego" in c[:2] and outcome.event.actor in c[:2]) for c in collisions):
        group = "collision"
    elif exceeds or (info["a_min"] is not None and info["a_min"] > COMFORT_DECEL):
        group = "hard"
    elif new_close:
        group = "close"
    elif info["stimulus"] is not None and (info["a_min"] or 0) > 0:
        group = "mild"
    else:
        group = "far"
    info["group"] = group
    return info


# ---------------------------------------------------------------------------- public contract (C1)
def keyframe_ego(tracks):
    """The ego at the annotation keyframes only (plan46 decision 2026-10-15: engine ego 2 Hz, as every other object
    and as replay-forge tracks.extract_scene, whose keyframe LIDAR_TOP ego pose has the sample's timestamp). The
    source scene keeps the dense (~20 Hz) ego for the viewer; the 4 m/s^2 physics limit was chosen on 2 Hz data.
    Keyframes = the times any other object was annotated; fewer than 2 ego poses on them (another dataset whose
    ego poses are not on the annotation times) keeps the dense ego."""
    ego, others = tracks[0], tracks[1:]
    times = np.unique(np.concatenate([tr.t for tr in others])) if others else np.empty(0)
    if not len(times):
        return tracks
    keep = np.abs(ego.t[:, None] - times[None, :]).min(axis=1) <= 1e-6
    if keep.sum() < 2:
        return tracks
    return [ego.with_poses(ego.t[keep], ego.xy[keep], ego.yaw[keep]), *others]


def scene_model(source, map_data=None):
    """SceneModel of a `source_scene()` output (app frame, ego at the origin at t=0)."""
    tracks = keyframe_ego(source_tracks(source))
    interval = source.get("interval_s") or [0, max(float(tr.t[-1]) for tr in tracks)]
    duration = float(interval[1])
    require(finite(duration) and duration > 0, "Invalid source duration")
    scene = (source.get("source") or {}).get("scene") or ""
    return SceneModel(scene, duration, tracks, map_data)


def candidates(model):
    """Vehicles a user may make brake, with their start-time windows, braking limit and followers."""
    cached = getattr(model, "_candidate_cache", None)
    if cached is not None:
        return cached
    out = []
    for e in np.flatnonzero(model.movers):
        a = model.agents[e]
        if a.is_ego:
            continue
        times = _candidate_times(model, e)
        base_times = _base_candidate_times(model, e)
        kinds = {}
        if times:
            kinds["brake"] = {"windows_by_event": _windows_by_event(model, a, times)}
            max_target = _max_target(model)
            if max_target > EVENT_SPEED + KIND_TARGET_MIN_DELTA:
                by_accel = {}
                for accel in KIND_ACCELS:
                    eligible = []
                    for t in base_times:
                        speed = float(model.V[round(t / DT), e])
                        min_target = math.floor((speed + KIND_TARGET_MIN_DELTA) * 2 + 1) / 2
                        if min_target <= max_target and fits(model, Event(a.name, t, kind="accelerate",
                                                                target_mps=min_target, accel_mps2=accel)):
                            eligible.append(t)
                    if eligible:
                        by_accel[f"{accel:g}"] = _windows(eligible)
                if by_accel:
                    kinds["accelerate"] = {"windows_by_accel": by_accel, "max_target_mps": max_target}
            if model.map_data is not None:
                by_dwell, stoplines = {}, {}
                for dwell in KIND_DWELLS:
                    eligible = []
                    for t in base_times:
                        line = model.map_data.next_stopline(model, e, t)
                        if line is None or not stopline_viable(model, e, t, line) \
                                or not fits(model, Event(a.name, t, dwell=dwell, kind="stopline", stopline=line)):
                            continue
                        eligible.append(t)
                        stoplines[line["id"]] = {k: line[k] for k in ("id", "x_m", "y_m", "type", "t_reach_s")}
                    if eligible:
                        by_dwell[f"{dwell:g}"] = _windows(eligible)
                if by_dwell:
                    kinds["stopline"] = {"windows_by_dwell": by_dwell, "stoplines": list(stoplines.values())}
        if model.map_data is not None:
            by_change = {}
            for direction in ("left", "right"):
                for duration in KIND_DURATIONS:
                    eligible = []
                    for t in np.arange(0.0, model.duration, WINDOW_STEP):
                        t = round(float(t), 2)
                        k = round(t / DT)
                        if k >= model.K or not np.isfinite(model.V[k, e]) or model.V[k, e] < EVENT_SPEED \
                                or model.t[a.k1] < t + ACTOR_DATA_AFTER \
                                or not fits(model, Event(a.name, t, kind="lane_change", direction=direction,
                                                         duration_s=duration)):
                            continue
                        path = lane_plan(model, e, t, direction, duration)
                        if path is not None and (_followers(model, e, t).size > 0
                                                 or _target_followers(model, e, t, path)):
                            eligible.append(t)
                    if eligible:
                        by_change[f"{direction}:{duration:g}"] = _windows(eligible)
            if by_change:
                kinds["lane_change"] = {"windows_by_change": by_change}
        if not kinds:
            continue
        followers = sorted({model.agents[j].name for t0 in base_times for j in _followers(model, e, t0)})
        out.append({"actor_id": a.actor_id, "name": a.name, "category": a.category, "max_decel_mps2": a.max_decel,
                    "windows": _windows(times), "followers": followers,
                    "windows_by_event": _windows_by_event(model, a, times), "kinds": kinds})
    problems = [{"name": name, "t_from": lo, "t_to": hi} for name, spans in _label_spans(model).items() for lo, hi in spans]
    result = {"scene": model.name, "duration_s": model.duration, "candidates": out, "label_problems": problems}
    model._candidate_cache = result
    return result


def _windows_by_event(model, agent, times):
    """plan46 C1: `fits` depends on the event, so per "<target>:<dwell>:<decel>" the start times that also fit it."""
    out = {}
    for decel in WINDOW_DECELS:
        if decel > agent.max_decel + 1e-9:
            continue
        for target, dwell in WINDOW_EVENTS:
            fitting = [t0 for t0 in times if fits(model, Event(agent.name, t0, decel, target, dwell))]
            out[f"{target}:{dwell:g}:{decel:g}"] = _windows(fitting)
    return out


def _number(event, key):
    value = event.get(key)
    require(finite(value), f"event.{key} phải là số hữu hạn", "INVALID_INPUT")
    return float(value)


def parse_event(model, event):
    """C5 checks of a UI event -> (Event, react, reaction_s)."""
    require(isinstance(event, dict), "event phải là object", "INVALID_INPUT")
    kind = event.get("kind", "brake")
    require(kind in ("brake", "accelerate", "stopline", "lane_change"), "event.kind không hợp lệ", "INVALID_INPUT")
    common = {"actor_id", "t0_s", "react", "reaction_s", "kind"}
    per_kind = {"brake": {"decel_mps2", "target", "dwell_s"},
                "accelerate": {"target_mps", "accel_mps2"}, "stopline": {"dwell_s"},
                "lane_change": {"direction", "duration_s"}}
    require(not (set(event) - common - per_kind[kind]), "event có trường không thuộc loại sự kiện", "INVALID_INPUT")
    actor_id = event.get("actor_id")
    require(isinstance(actor_id, str) and actor_id, "event.actor_id phải là chuỗi", "INVALID_INPUT")
    t0, reaction = (_number(event, k) for k in ("t0_s", "reaction_s"))
    react = event.get("react")
    require(isinstance(react, bool), "event.react phải là true/false", "INVALID_INPUT")
    if kind != "brake":
        require(REACTION_RANGE[0] <= reaction <= REACTION_RANGE[1], "Thời gian phản xạ phải trong [0,3; 3] s",
                "EVENT_NOT_ALLOWED")
        e = model.by_actor.get(actor_id)
        require(e is not None and model.movers[e] and not model.agents[e].is_ego,
                "Xe này không gây sự kiện được", "EVENT_NOT_ALLOWED")
        a = model.agents[e]
        require(0 <= t0 < model.duration and round(t0 / DT) < model.K,
                "Thời điểm ngoài cảnh", "EVENT_NOT_ALLOWED")
        k = round(t0 / DT)
        require(np.isfinite(model.V[k, e]) and model.V[k, e] >= EVENT_SPEED
                and model.t[a.k1] >= t0 + ACTOR_DATA_AFTER,
                "Xe này không chạy > 3 m/s hoặc thiếu dữ liệu sau sự kiện", "EVENT_NOT_ALLOWED")
        if kind == "accelerate":
            accel, target_mps = (_number(event, key) for key in ("accel_mps2", "target_mps"))
            require(accel in KIND_ACCELS and model.V[k, e] + KIND_TARGET_MIN_DELTA < target_mps <= _max_target(model),
                    "Tốc độ đích hoặc gia tốc không cho phép", "EVENT_NOT_ALLOWED")
            parsed = Event(a.name, round(t0, 2), kind=kind, target_mps=target_mps, accel_mps2=accel)
        elif kind == "stopline":
            dwell = _number(event, "dwell_s")
            require(dwell in KIND_DWELLS, "Thời gian dừng không cho phép", "EVENT_NOT_ALLOWED")
            line = model.map_data.next_stopline(model, e, t0) if model.map_data is not None else None
            require(line is not None, "Không có vạch dừng phù hợp trên đường đi", "EVENT_NOT_ALLOWED")
            require(stopline_viable(model, e, t0, line), "Không đủ quãng đường để dừng êm trước vạch",
                    "EVENT_NOT_ALLOWED")
            parsed = Event(a.name, round(t0, 2), dwell=dwell, kind=kind, stopline=line)
        else:
            direction = event.get("direction")
            duration = _number(event, "duration_s")
            require(direction in ("left", "right") and duration in KIND_DURATIONS,
                    "Hướng hoặc thời gian chuyển làn không cho phép", "EVENT_NOT_ALLOWED")
            parsed = Event(a.name, round(t0, 2), kind=kind, direction=direction, duration_s=duration)
            path = lane_plan(model, e, t0, direction, duration)
            require(path is not None, "Không có làn kề cùng chiều suốt thời gian chuyển", "EVENT_NOT_ALLOWED")
            require(_followers(model, e, t0).size > 0 or _target_followers(model, e, t0, path),
                    "Không có xe theo sau ở làn cũ hoặc làn đích", "EVENT_NOT_ALLOWED")
        if kind != "lane_change":
            require(_followers(model, e, t0).size > 0, "Không có xe theo sau", "EVENT_NOT_ALLOWED")
        require(fits(model, parsed), "Không đủ thời gian cảnh sau sự kiện", "EVENT_NOT_ALLOWED")
        row = next((item for item in candidates(model)["candidates"] if item["actor_id"] == actor_id), None)
        offer = row["kinds"].get(kind) if row is not None else None
        if kind == "accelerate":
            windows = offer["windows_by_accel"].get(f"{accel:g}", []) if offer else []
        elif kind == "stopline":
            windows = offer["windows_by_dwell"].get(f"{dwell:g}", []) if offer else []
        else:
            windows = offer["windows_by_change"].get(f"{direction}:{duration:g}", []) if offer else []
        require(any(lo - 1e-6 <= t0 <= hi + 1e-6 for lo, hi in windows),
                "Thời điểm ngoài khoảng cho phép của loại sự kiện", "EVENT_NOT_ALLOWED")
        return parsed, react, reaction
    decel, dwell = (_number(event, k) for k in ("decel_mps2", "dwell_s"))
    target = event.get("target")
    require(target in TARGETS, "event.target phải là stop hoặc half", "INVALID_INPUT")
    e = model.by_actor.get(actor_id)
    candidate = e is not None and model.movers[e] and not model.agents[e].is_ego and _candidate_times(model, e)
    if not candidate:
        raise ScenarioError("EVENT_NOT_ALLOWED", "Xe này không gây sự kiện được (không chạy > 3 m/s có xe bám theo)")
    a = model.agents[e]
    windows = _windows(_candidate_times(model, e))
    text = ", ".join(f"{lo:g}–{hi:g} s" for lo, hi in windows)
    require(any(lo - 1e-6 <= t0 <= hi + 1e-6 for lo, hi in windows),
            f"Thời điểm {t0:g} s ngoài khoảng cho phép ({text})", "EVENT_NOT_ALLOWED")
    require(0 < decel <= a.max_decel + 1e-9, f"Mức phanh phải trong (0; {a.max_decel:g}] m/s²", "EVENT_NOT_ALLOWED")
    require(DWELL_RANGE[0] <= dwell <= DWELL_RANGE[1], "Thời gian đứng phải trong [0; 10] s", "EVENT_NOT_ALLOWED")
    require(REACTION_RANGE[0] <= reaction <= REACTION_RANGE[1], "Thời gian phản xạ phải trong [0,3; 3] s",
            "EVENT_NOT_ALLOWED")
    parsed = Event(a.name, round(t0, 2), decel, target, dwell if target == "stop" else 0.0)
    require(fits(model, parsed), "Không đủ 4 s cảnh sau khi sự kiện kết thúc: chọn thời điểm sớm hơn hoặc phanh mạnh hơn",
            "EVENT_NOT_ALLOWED")
    return parsed, react, reaction


def thresholds(kind="brake"):
    """Every fixed threshold (B7), scalar values only."""
    values = {
        "dt_s": DT, "reaction_s": REACTION, "idm_a": IDM_A, "idm_b": IDM_B, "max_decel": MAX_DECEL,
        "heavy_max_decel": HEAVY_MAX_DECEL, "jerk_brake": JERK_BRAKE, "jerk_normal": JERK_NORMAL,
        "T_default": T_DEFAULT, "T_min": T_RANGE[0], "T_max": T_RANGE[1], "s0_default": S0_DEFAULT,
        "s0_min": S0_RANGE[0], "s0_max": S0_RANGE[1], "lookahead_m": LOOKAHEAD, "corridor_margin_m": CORRIDOR_MARGIN,
        "heading_tol_deg": math.degrees(HEADING_TOL), "dev_speed_mps": DEV_SPEED, "dev_lag_m": DEV_LAG,
        "coolness": COOLNESS, "watch_ahead": WATCH_AHEAD, "valid_max_accel": MAX_ACCEL,
        "valid_decel_slack": DECEL_SLACK, "label_reach_m": LABEL_REACH, "tailgate_gap_m": TAILGATE_GAP,
        "tailgate_speed_mps": TAILGATE_SPEED, "tailgate_time_s": TAILGATE_TIME, "exempt_along_m": EXEMPT_ALONG,
        "exempt_across_m": EXEMPT_ACROSS, "exempt_depth_m": EXEMPT_DEPTH, "appear_window_s": APPEAR_WINDOW,
        "merge_lookback_s": MERGE_LOOKBACK, "close_gap_m": CLOSE_GAP, "close_ttc_s": CLOSE_TTC,
        "comfort_decel": COMFORT_DECEL, "new_margin": NEW_MARGIN, "after_event_s": AFTER_EVENT,
        "actor_data_after_s": ACTOR_DATA_AFTER, "event_speed_mps": EVENT_SPEED,
    }
    if kind != "brake":
        from topeye.scenario.reactive_map import (
            LANE_ROUTE_JOIN_M,
            LANE_SAMPLE_M,
            SIDE_AHEAD_M,
            SIDE_HEADING_RAD,
            SIDE_MAX_M,
            SIDE_MIN_M,
            STOP_COMFORT_DECEL,
            STOP_HORIZON_S,
            STOP_PATH_MARGIN_M,
        )

        values.update(kind_max_target_mps=KIND_MAX_TARGET_MPS, stop_s0_m=STOP_S0,
                      stop_comfort_decel_mps2=STOP_COMFORT_DECEL, stop_horizon_s=STOP_HORIZON_S,
                      mobil_b_safe_mps2=MOBIL_B_SAFE, lane_side_min_m=SIDE_MIN_M, lane_side_max_m=SIDE_MAX_M,
                      lane_side_heading_deg=math.degrees(SIDE_HEADING_RAD), lane_side_ahead_m=SIDE_AHEAD_M,
                      lane_map_sample_m=LANE_SAMPLE_M, lane_transition_sample_s=KIND_LANE_SAMPLE_S,
                      lane_route_join_m=LANE_ROUTE_JOIN_M,
                      target_follow_sample_s=KIND_TARGET_FOLLOW_SAMPLE_S,
                      target_follow_lateral_slack_m=KIND_TARGET_FOLLOW_LATERAL_SLACK,
                      stop_path_margin_m=STOP_PATH_MARGIN_M, kind_target_min_delta_mps=KIND_TARGET_MIN_DELTA,
                      stop_settle_speed_mps=STOP_SETTLE_SPEED, stop_settle_gap_m=STOP_SETTLE_GAP,
                      kind_accel_1_mps2=KIND_ACCELS[0], kind_accel_2_mps2=KIND_ACCELS[1],
                      kind_accel_3_mps2=KIND_ACCELS[2], kind_dwell_0_s=KIND_DWELLS[0],
                      kind_dwell_3_s=KIND_DWELLS[1], kind_dwell_10_s=KIND_DWELLS[2],
                      kind_duration_3_s=KIND_DURATIONS[0], kind_duration_4_s=KIND_DURATIONS[1],
                      kind_duration_6_s=KIND_DURATIONS[2],
                      kind_target_delta_1_mps=KIND_TARGET_DELTAS[0],
                      kind_target_delta_2_mps=KIND_TARGET_DELTAS[1])
    return values


EGO_OUTCOME_KEYS = ("min_gap", "min_ttc", "a_min", "a_used", "conflict_with")
CHECK_IDS = ("esmini", "physics", "label", "collision", "tailgate", "merge", "appear")


def variant_outcome(result):
    """plan46 `VariantOutcome`: reasons as codes; like replay-forge, no group for an invalid variant."""
    return {"valid": result.valid, "group": result.group if result.valid else None, "reasons": list(result.reasons),
            "ego": {k: result.ego.get(k) for k in EGO_OUTCOME_KEYS},
            "collisions": [[a, b, t, kind] for a, b, t, kind in result.collisions], "reacted": list(result.reacted)}


def _vn(value, digits=1):
    return f"{value:.{digits}f}".replace(".", ",")


def _round_or_none(value, digits=3):
    return round(float(value), digits) if value is not None and math.isfinite(value) else None


def _check(id_, passed, value=None, threshold=None, unit="", t=None, detail=""):
    return {"id": id_, "passed": passed, "value": _round_or_none(value), "threshold": _round_or_none(threshold),
            "unit": unit, "t": _round_or_none(t, 2), "detail": detail}


def _first(collisions, kind):
    return next((c for c in collisions if c[3] == kind), None)


def checks(model, outcome, result):
    """The 7 validity conditions of replay-forge docs §8.3, in CHECK_IDS order, each with its worst measure.
    `passed` follows the assessment's reasons exactly; esmini is not run here (passed None)."""
    reasons = set(result.reasons)
    X, Y, H = centres(model, outcome)
    changed = np.flatnonzero(outcome.changed)
    out = [_check("esmini", None, detail="Chưa kiểm: esmini chạy sau khi tạo kịch bản")]

    # 2. physics: the measure closest to (or furthest over) its limit, over every changed vehicle
    worst = None
    for name, p in result.physics.items():
        for value, limit, t, what in ((p.get("max_accel"), p["limit_accel"], p.get("t_accel"), "tăng tốc"),
                                      (p.get("max_decel"), p["limit_decel"], p.get("t_decel"), "phanh"),
                                      (p.get("max_speed"), SPEED_LIMIT, None, "tốc độ")):
            if value is not None and (worst is None or value / limit > worst[0]):
                worst = (value / limit, value, limit, t, f"{name} {what}", "m/s" if what == "tốc độ" else "m/s²")
    # over the limit is a failure whatever its cause; one put down to the recorded label also fails condition 3
    physical = not reasons & {"physics", "label_error"}
    if worst is None:
        out.append(_check("physics", physical, detail="Không có xe nào đổi chuyển động"))
    else:
        _, value, limit, t, what, unit = worst
        detail = f"{what} {_vn(value)} {unit} (giới hạn {_vn(limit)})"
        if "label_error" in reasons and value > limit:
            detail += " — do nhãn gốc lỗi (điều kiện 3)"
        out.append(_check("physics", physical and value <= limit, value, limit, unit, t, detail))

    # 3. label: how far (along the path) a violation is from one in the vehicle's own recorded motion
    label = None
    for i in changed:
        bad = _physics_violations(X, Y, i, model.agents[i].max_decel)
        if not len(bad):
            continue
        recorded = _physics_violations(model.X, model.Y, i, model.agents[i].max_decel)
        s_rec = model.S[recorded, i]
        far = max(np.abs(s_rec - s).min() for s in outcome.S[bad, i]) if len(s_rec) else math.inf
        if label is None or far < label[0]:
            label = (far, float(model.t[bad[0]]), model.agents[i].name)
    if label is None:
        out.append(_check("label", "label_error" not in reasons, threshold=LABEL_REACH, unit="m",
                          detail="Không có vi phạm vật lý"))
    else:
        far, t, name = label
        where = "trùng chỗ nhãn gốc lỗi" if far <= LABEL_REACH else "không trùng chỗ nhãn gốc lỗi"
        out.append(_check("label", "label_error" not in reasons, far, LABEL_REACH, "m", t, f"{name}: vi phạm {where}"))

    # 4. collisions between two other vehicles (following): the deepest box overlap of the pairs that hit
    deepest = (0.0, None, "")
    for a, b, _, kind in result.collisions:
        if kind != "following":
            continue
        i, j = model.index[a], model.index[b]
        with np.errstate(invalid="ignore"):
            close = np.flatnonzero(np.hypot(X[:, i] - X[:, j], Y[:, i] - Y[:, j]) < model.half_diag[i] + model.half_diag[j])
        for k in close:
            depth = penetration(_box(model, X, Y, H, k, i), _box(model, X, Y, H, k, j))
            if depth > deepest[0] and not _excused(model, X, Y, H, k, i, j, depth):
                deepest = (depth, float(model.t[k]), f"{a} – {b}")
    notes = [deepest[2]] if deepest[2] else ["Không có xe nào đâm nhau"]
    ego_hit = _first(result.collisions, "ego")
    if ego_hit:
        notes.append(f"xe của bạn chạm {ego_hit[1] if ego_hit[0] == 'ego' else ego_hit[0]} (không tính)")
    if result.excused:
        notes.append(f"{len(result.excused)} chồng hộp có sẵn trong bản ghi được miễn")
    out.append(_check("collision", "collision" not in reasons, deepest[0], 0.0, "m", deepest[1], "; ".join(notes)))

    # 5. tailgating: the smallest counted bumper gap while moving faster than TAILGATE_SPEED
    tg = result.tailgate or {}
    detail = (f"{tg['pair'][0]} sau {tg['pair'][1]}, dưới {_vn(TAILGATE_GAP)} m dài nhất {_vn(tg['longest_s'], 2)} s"
              if tg.get("pair") else "Không có xe nào bám sau xe đổi chuyển động khi > 3 m/s")
    out.append(_check("tailgate", "tailgating" not in reasons, tg.get("min_gap"), TAILGATE_GAP, "m", tg.get("t"), detail))

    # 6. merging, crossing, pedestrians and objects (not simulated): the heading difference before contact
    hit = _first(result.collisions, "crossing")
    if hit is None:
        out.append(_check("merge", "unsupported_interaction" not in reasons, threshold=math.degrees(HEADING_TOL),
                          unit="°", detail="Không có va chạm nhập làn, cắt ngang hay với người đi bộ/vật thể"))
    else:
        i, j = model.index[hit[0]], model.index[hit[1]]
        value = None
        if model.vehicles[i] and model.vehicles[j]:
            k = min(model.K - 1, round(hit[2] / DT))
            lo = max(0, k - round(MERGE_LOOKBACK / DT))
            dh = np.abs(_wrap(H[lo:k + 1, i] - H[lo:k + 1, j]))
            value = math.degrees(float(np.nanmax(np.minimum(dh, math.pi - dh), initial=0.0)))
            what = "lệch hướng trước khi chạm"
        else:
            what = "chạm người đi bộ/vật thể"
        out.append(_check("merge", "unsupported_interaction" not in reasons, value, math.degrees(HEADING_TOL), "°",
                          hit[2], f"{hit[0]} – {hit[1]}: {what}"))

    # 7. a vehicle that has only just entered the data where the changed situation is
    hit = _first(result.collisions, "appearing")
    if hit is None:
        out.append(_check("appear", "unsupported_appearing" not in reasons, threshold=APPEAR_WINDOW, unit="s",
                          detail="Không có va chạm với xe vừa vào khung hình"))
    else:
        i, j = model.index[hit[0]], model.index[hit[1]]
        since = hit[2] - max(model.t[model.agents[i].k0], model.t[model.agents[j].k0])
        out.append(_check("appear", "unsupported_appearing" not in reasons, since, APPEAR_WINDOW, "s", hit[2],
                          f"{hit[0]} – {hit[1]}: chạm {_vn(since)} s sau khi một xe xuất hiện"))
    return out


def sensitivity(model, event):
    """plan46 `ReactiveSensitivity`: the event re-run with every SENSITIVITY_REACTIONS reaction time; nothing saved."""
    parsed, _, _ = parse_event(model, event)
    runs = []
    for reaction in SENSITIVITY_REACTIONS:
        v = variant_outcome(assess(model, simulate(model, parsed, react=True, reaction=reaction)))
        runs.append({"reaction_s": reaction, "valid": v["valid"], "group": v["group"], "reasons": v["reasons"],
                     "ego": v["ego"]})
    return {"runs": runs, "stable": len({(r["valid"], r["group"]) for r in runs}) == 1}


def run_event(model, event):
    """Simulate one UI event, assess it and write its real2sim package (C4). Both variants run on the same event
    (plan46 C2): baseline (nobody reacts) and pilot (reacting drivers); the package holds the one `react` asks for."""
    from topeye.scenario.reactive_package import build_package

    parsed, react, reaction = parse_event(model, event)
    variants = {}
    for variant, flag in (("baseline", False), ("pilot", True)):
        outcome = simulate(model, parsed, react=flag, reaction=reaction)
        variants[variant] = (outcome, assess(model, outcome))
    outcome, result = variants["pilot" if react else "baseline"]
    files = build_package(model, outcome, result, {k: r for k, (_, r) in variants.items()})
    return {"files": files, "valid": result.valid, "group": result.group,
            "reasons": [REASONS[r] for r in result.reasons]}
