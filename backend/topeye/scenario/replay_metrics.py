"""Scene metric 1: exact, constant-speed baseline and pilot replay error.

Ported from replay-forge (phanhieunghia353) @ d36205b,
real2sim/abstraction.py, real2sim/metrics.py, real2sim/holdout.py and
real2sim/pipeline.py. Esmini runs in the existing isolated ReCast child.
"""

import tempfile
import time
from pathlib import Path

import numpy as np
from scipy.interpolate import PchipInterpolator, make_smoothing_spline

from topeye.scenario import reactive as r
from topeye.scenario.models import ScenarioError, require
from topeye.scenario.scene_metrics import run_esmini

VERSION = "replay-error-metrics-v1"
METHODS = ("exact", "baseline", "pilot")
GROUPS = ("all", "moving", "static", "vehicle", "pedestrian", "obstacle")
SMOOTH_DT = 0.05
MIN_KEYFRAMES = 5


def _wrap(angle):
    return (angle + np.pi) % (2 * np.pi) - np.pi


def _dense_times(times):
    return np.append(np.arange(times[0], times[-1], r.PILOT_DT), times[-1])


def _arc_length(xy):
    return np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(xy, axis=0).T))])


def _drive_along(times, progress, arc, xy, yaw):
    keep = np.concatenate([[True], np.diff(arc) > 1e-6])
    arc, xy, yaw = arc[keep], xy[keep], np.unwrap(yaw)[keep]
    if len(arc) == 1:
        return times, np.tile(xy[0], (len(times), 1)), np.full(len(times), yaw[0])
    positions = np.column_stack([np.interp(progress, arc, xy[:, k]) for k in (0, 1)])
    return times, positions, np.interp(progress, arc, yaw)


def _smooth_path(track):
    times = _dense_times(track.t)
    yaw = np.unwrap(track.yaw)
    if len(track.t) < r.MIN_SPLINE_POINTS:
        xy = np.column_stack([np.interp(times, track.t, track.xy[:, k]) for k in (0, 1)])
        return times, xy, np.interp(times, track.t, yaw)
    sx, sy = (make_smoothing_spline(track.t, track.xy[:, k]) for k in (0, 1))
    box_yaw = make_smoothing_spline(track.t, yaw)(times)
    vx, vy = sx.derivative()(times), sy.derivative()(times)
    motion = np.arctan2(vy, vx)
    reverse = np.abs(_wrap(motion - box_yaw)) > np.pi / 2
    motion = np.where(reverse, motion + np.pi, motion)
    heading = np.where(np.hypot(vx, vy) > r.MIN_HEADING_SPEED, motion, box_yaw)
    heading = box_yaw + _wrap(heading - box_yaw)
    return times, np.column_stack([sx(times), sy(times)]), heading


def _baseline(track):
    if track.is_static:
        return track
    arc = _arc_length(track.xy)
    td = _dense_times(track.t)
    progress = arc[-1] * (td - track.t[0]) / (track.t[-1] - track.t[0])
    return track.with_poses(*_drive_along(td, progress, arc, track.xy, track.yaw))


def _reconstruct(track, method):
    if method == "exact":
        return track
    if method == "baseline":
        return _baseline(track)
    # replay-forge abstraction.pilot pins only geometrically stationary tracks.
    if track.is_stationary:
        centre = track.xy.mean(axis=0)
        yaw = np.arctan2(np.sin(track.yaw).mean(), np.cos(track.yaw).mean())
        times = track.t[[0, -1]] if len(track.t) > 1 else track.t[:1]
        return track.with_poses(times, np.tile(centre, (len(times), 1)), np.full(len(times), yaw))
    td, xy, yaw = _smooth_path(track)
    arc = _arc_length(xy)
    knots = np.append(np.arange(td[0], td[-1], r.KNOT_SPACING), td[-1])
    progress = PchipInterpolator(knots, np.interp(knots, td, arc))(td)
    return track.with_poses(*_drive_along(td, progress, arc, xy, yaw))


def _group(track):
    if track.kind == "vehicle":
        return "vehicle"
    if track.kind == "pedestrian":
        return "pedestrian"
    return "obstacle"


def _row(track, sampled):
    t = track.t
    x = np.interp(t, sampled[:, 0], sampled[:, 1])
    y = np.interp(t, sampled[:, 0], sampled[:, 2])
    heading = np.interp(t, sampled[:, 0], np.unwrap(sampled[:, 3]))
    distance = np.hypot(x - track.xy[:, 0], y - track.xy[:, 1])
    yaw = np.abs(_wrap(heading - track.yaw))
    speed_rmse = None
    if len(t) > 1:
        dt = np.diff(t)
        truth_speed = np.hypot(*np.diff(track.xy, axis=0).T) / dt
        # The child reports positions at 20 Hz. Midpoint speed is derived from the same replay.
        sim_speed = np.hypot(np.diff(sampled[:, 1]), np.diff(sampled[:, 2])) / np.diff(sampled[:, 0])
        midpoints = (sampled[:-1, 0] + sampled[1:, 0]) / 2
        observed_speed = np.interp(t[:-1] + dt / 2, midpoints, sim_speed)
        speed_rmse = float(np.sqrt(np.mean((observed_speed - truth_speed) ** 2)))
    return {"ade": float(distance.mean()), "fde": float(distance[-1]),
            "max": float(distance.max()), "yaw_deg": float(np.degrees(yaw).mean()),
            "v_rmse": speed_rmse}


def _mean(rows):
    return {"n": len(rows), **{key: (float(np.mean([row[key] for row in rows if row[key] is not None]))
                                    if any(row[key] is not None for row in rows) else None)
                                for key in ("ade", "fde", "max", "yaw_deg", "v_rmse")}}


def _holdout(tracks):
    eligible = [track for track in tracks if not track.is_stationary and len(track.t) >= MIN_KEYFRAMES]
    errors = {method: [] for method in METHODS}
    smooth = {method: [] for method in METHODS}
    for track in eligible:
        keep = np.zeros(len(track.t), bool)
        keep[::2] = True
        keep[-1] = True
        reduced = track.with_poses(track.t[keep], track.xy[keep], track.yaw[keep])
        hidden = ~keep
        for method in METHODS:
            rec = _reconstruct(reduced, method)
            xy = np.column_stack([np.interp(track.t[hidden], rec.t, rec.xy[:, k]) for k in (0, 1)])
            errors[method].append(float(np.hypot(*(xy - track.xy[hidden]).T).mean()))
            rec = _reconstruct(track, method)
            ticks = np.arange(rec.t[0], rec.t[-1], SMOOTH_DT)
            if len(ticks) < 10:
                continue
            sampled = np.column_stack([np.interp(ticks, rec.t, rec.xy[:, k]) for k in (0, 1)])
            speed = np.hypot(*np.diff(sampled, axis=0).T) / SMOOTH_DT
            smooth[method].append(float(np.percentile(np.abs(np.diff(speed) / SMOOTH_DT), 99)) > 4.0)
    return {"n": len(eligible),
            "ade": {method: float(np.mean(values)) if values else None for method, values in errors.items()},
            "accel_p99_over_4_share": {method: float(np.mean(values)) if values else None
                                       for method, values in smooth.items()}}


def _entities(tracks, duration):
    entities = []
    for track in tracks:
        # The imported esmini child tracks a fixed entity set. A single-pose object is held in place;
        # partial tracks are scored only at their own keyframes.
        poses = track if len(track.t) > 1 else track.with_poses([0.0, duration],
                        np.repeat(track.xy, 2, axis=0), np.repeat(track.yaw, 2))
        entities.append({"id": track.name, "category": track.category,
                         "length_m": track.size[0], "width_m": track.size[1], "height_m": track.size[2],
                         "vertices": [(float(t), float(x), float(y), 0.0, float(yaw))
                                      for t, (x, y), yaw in zip(poses.t, poses.xy, poses.yaw)]})
    return entities


def _label_problem_counts(model):
    """Port of replay-forge events.label_problems: count merged bad-physics spans."""
    result = {}
    for index in np.flatnonzero(model.movers):
        present = np.flatnonzero(~np.isnan(model.X[:, index]))
        if len(present) < 2 * r.PHYSICS_SMOOTH:
            continue
        step = np.hypot(np.diff(model.X[present, index]), np.diff(model.Y[present, index]))
        speed = np.convolve(np.concatenate([[step[0]], step]) / r.DT,
                            np.ones(r.PHYSICS_SMOOTH) / r.PHYSICS_SMOOTH, mode="valid")
        accel = np.gradient(speed, r.DT)
        bad = ((speed > r.SPEED_LIMIT) | (accel > r.MAX_ACCEL)
               | (accel < -(model.agents[index].max_decel + r.DECEL_SLACK)))
        at = present[np.flatnonzero(bad) + r.PHYSICS_SMOOTH // 2]
        if len(at):
            result[model.agents[index].name] = 1 + int(np.count_nonzero(np.diff(at) * r.DT > 0.5))
    return result


def replay_error_metrics(model, engine, progress=lambda *args: None):
    """Return the TS ReplayErrorMetrics contract; no workspace writes or persistent cache."""
    started = time.monotonic()
    require(engine and Path(engine).is_file(), "Thiếu esmini", "ESMINI_MISSING")
    tracks = model.tracks
    results = {}
    methods = {}
    with tempfile.TemporaryDirectory(prefix="topeye-replay-metric-") as scratch:
        for index, method in enumerate(METHODS):
            progress(f"Đang phát lại {method}", index, len(METHODS))
            rec = [_reconstruct(track, method) for track in tracks]
            try:
                observed = run_esmini(_entities(rec, model.duration), model.duration, engine, scratch)
            except ScenarioError as exc:
                raise ScenarioError("ESMINI_FAILED", f"esmini {method}: {exc}") from exc
            groups = {name: [] for name in GROUPS}
            per_object = {}
            for track in tracks:
                if track.name not in observed:
                    raise ScenarioError("ESMINI_FAILED", f"esmini thiếu {track.name}")
                row = _row(track, observed[track.name])
                per_object[track.name] = row
                for name in ("all", "static" if track.is_stationary else "moving", _group(track)):
                    groups[name].append(row)
            methods[method] = {name: _mean(rows) for name, rows in groups.items()}
            results[method] = per_object
    problems = _label_problem_counts(model)
    objects = [{"name": track.name, "category": track.category, "moving": not track.is_stationary,
                "keyframes": len(track.t), "label_problems": problems.get(track.name, 0),
                "ade": {method: results[method][track.name]["ade"] for method in METHODS}}
               for track in tracks]
    progress("Xong", len(METHODS), len(METHODS))
    return {"scene": model.name, "esmini_version": "3.9.0",
            "esmini_exit": {method: 0 for method in METHODS}, "methods": methods,
            "objects": objects, "holdout": _holdout(tracks),
            "runtime_s": round(time.monotonic() - started, 3)}
