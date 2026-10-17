"""Fixed-grid scene metric 2.

Ported from replay-forge (phanhieunghia353) @ d36205b, real2sim/events.py and
real2sim/pipeline.py. The sweep deliberately omits the separate esmini check.
"""

import time

import numpy as np

from topeye.scenario import reactive as r
from topeye.scenario.models import require

VERSION = "reactive-metrics-v1"
EVENT_STEP = 2.0
DECELS = (2.0, 4.0, 6.0, 8.0)
TARGETS = (("stop", 0.0), ("stop", 3.0), ("half", 0.0))
REASONS = ("collision", "appearing", "merge", "label_error", "tailgating", "physics")
REASON_MAP = {"collision": "collision", "unsupported_appearing": "appearing",
              "unsupported_interaction": "merge", "label_error": "label_error",
              "tailgating": "tailgating", "physics": "physics"}


def _can_start(model, index, t0):
    """Port of events.can_start, using only plan45's public model and constants."""
    agent = model.agents[index]
    if agent.is_ego or not model.movers[index]:
        return False
    k0 = round(t0 / r.DT)
    if k0 >= model.K or np.isnan(model.V[k0, index]) or model.V[k0, index] < r.EVENT_SPEED:
        return False
    if model.t[agent.k1] < t0 + r.ACTOR_DATA_AFTER:
        return False
    lo = max(0, k0 + int(r.FOLLOW_WINDOW[0] / r.DT))
    hi = min(model.K, k0 + int(r.FOLLOW_WINDOW[1] / r.DT) + 1)
    hold = round(r.FOLLOW_MIN_TIME / r.DT)
    return bool((model.leader[lo:hi] == index).sum(axis=0).max() >= hold)


def _fits(model, event):
    index = model.index[event.actor]
    speed = model.V[round(event.t0 / r.DT), index]
    finish = event.t0 + (speed if event.target == "stop" else speed / 2) / event.decel
    finish += event.dwell + speed / r.IDM_A
    return bool(finish + r.AFTER_EVENT <= model.duration)


def grid_candidates(model):
    """The same ordered variants as replay-forge events.candidates."""
    out = []
    for i in np.flatnonzero(model.movers):
        agent = model.agents[i]
        for t0 in np.arange(EVENT_STEP / 2, model.duration, EVENT_STEP):
            if not _can_start(model, int(i), float(t0)):
                continue
            for decel in DECELS:
                if decel > agent.max_decel + 1e-9:
                    continue
                for target, dwell in TARGETS:
                    event = r.Event(agent.name, round(float(t0), 2), decel, target, dwell)
                    if _fits(model, event):
                        out.append(event)
    return out


def _encounter(event):
    if event.kind != "brake":
        return f"{event.actor}@{event.t0:.0f}s_{event.kind}"
    return f"{event.actor}@{event.t0:.0f}s_{event.target}"


def _counts(rows):
    valid = [row for row in rows if row["valid"]]
    rare = [row for row in valid if row["group"] in ("hard", "close")]
    reasons = {name: 0 for name in REASONS}
    for row in rows:
        for reason in row["reasons"]:
            reasons[REASON_MAP[reason]] += 1
    return {
        "valid": len(valid),
        "encounters_valid": len({_encounter(row["event"]) for row in valid}),
        "rare": len(rare),
        "rare_encounters": len({_encounter(row["event"]) for row in rare}),
        "groups": {group: sum(row["group"] == group for row in valid) for group in r.GROUPS},
        "reasons": reasons,
    }


def _row(event, assessment):
    return {"event": event, "valid": assessment.valid, "group": assessment.group if assessment.valid else None,
            "reasons": assessment.reasons, "ego": assessment.ego}


def _kind_events(model, kind):
    """Fixed plan47 grids; no result-dependent threshold or event selection."""
    events = []
    for index in np.flatnonzero(model.movers):
        agent = model.agents[index]
        if agent.is_ego:
            continue
        for t0 in np.arange(EVENT_STEP / 2, model.duration, EVENT_STEP):
            t0 = round(float(t0), 2)
            k = round(t0 / r.DT)
            if k >= model.K or not np.isfinite(model.V[k, index]) or model.V[k, index] < r.EVENT_SPEED \
                    or model.t[agent.k1] < t0 + r.ACTOR_DATA_AFTER:
                continue
            if kind in ("accelerate", "stopline") and not r._followers(model, int(index), t0).size:
                continue
            if kind == "accelerate":
                for accel in r.KIND_ACCELS:
                    for delta in r.KIND_TARGET_DELTAS:
                        target = min(float(model.V[k, index]) + delta, r._max_target(model))
                        if target <= model.V[k, index] + r.KIND_TARGET_MIN_DELTA:
                            continue
                        event = r.Event(agent.name, t0, kind=kind, target_mps=target, accel_mps2=accel)
                        if r.fits(model, event):
                            events.append(event)
            elif kind == "stopline":
                line = model.map_data.next_stopline(model, int(index), t0) if model.map_data else None
                if line is None or not r.stopline_viable(model, int(index), t0, line):
                    continue
                for dwell in r.KIND_DWELLS:
                    event = r.Event(agent.name, t0, dwell=dwell, kind=kind, stopline=line)
                    if r.fits(model, event):
                        events.append(event)
            else:
                for direction in ("left", "right"):
                    for duration in r.KIND_DURATIONS:
                        event = r.Event(agent.name, t0, kind=kind, direction=direction, duration_s=duration)
                        if not r.fits(model, event):
                            continue
                        path = r.lane_plan(model, int(index), t0, direction, duration)
                        if path is not None and (r._followers(model, int(index), t0).size
                                                 or r._target_followers(model, int(index), t0, path)):
                            events.append(event)
    return events


def _kind_params(event):
    if event.kind == "accelerate":
        return {"accel_mps2": event.accel_mps2, "target_mps": round(event.target_mps, 3)}
    if event.kind == "stopline":
        return {"dwell_s": event.dwell}
    return {"direction": event.direction, "duration_s": event.duration_s}


def _kind_metrics(model, reactions, progress, kind):
    started = time.monotonic()
    events = _kind_events(model, kind)
    axes = {"accelerate": [{"name": "accel_mps2", "values": list(r.KIND_ACCELS)},
                           {"name": "target_mps", "values": ["t0+3", "t0+6"]}],
            "stopline": [{"name": "dwell_s", "values": list(r.KIND_DWELLS)}],
            "lane_change": [{"name": "direction", "values": ["left", "right"]},
                            {"name": "duration_s", "values": list(r.KIND_DURATIONS)}]}[kind]
    baseline, pilots = [], {float(reaction): [] for reaction in reactions}
    total = max(1, len(events) * (1 + len(pilots)))
    done = 0
    for event in events:
        baseline.append(_row(event, r.assess(model, r.simulate(model, event, react=False))))
        done += 1
        for reaction, rows in pilots.items():
            rows.append(_row(event, r.assess(model, r.simulate(model, event, react=True, reaction=reaction))))
            done += 1
        if done % 10 == 0 or done == total:
            progress(f"Đang đo {kind} {done}/{total}", done, total)
    if not events:
        progress(f"Không có biến thể {kind}", 1, 1)
    primary = pilots[float(reactions[0])]
    cells, rare = [], []
    for event, base, pilot in zip(events, baseline, primary):
        agent = model.agents[model.index[event.actor]]
        identity = {"actor": event.actor, "actor_id": agent.actor_id, "t0": event.t0,
                    "params": _kind_params(event)}
        cells.append({**identity, "baseline": {"valid": base["valid"], "group": base["group"]},
                      "pilot": {"valid": pilot["valid"], "group": pilot["group"],
                                "min_gap": pilot["ego"].get("min_gap")}})
        if pilot["valid"] and pilot["group"] in ("hard", "close"):
            rare.append({**identity, "group": pilot["group"],
                         "ego_min_gap": pilot["ego"].get("min_gap"),
                         "ego_min_ttc": pilot["ego"].get("min_ttc"),
                         "ego_a_min": pilot["ego"].get("a_min")})
    return {"scene": model.name, "kind": kind, "grid": {"event_step_s": EVENT_STEP, "axes": axes},
            "reaction_s": float(reactions[0]), "tried": len(events),
            "encounters": len({_encounter(event) for event in events}),
            "baseline": _counts(baseline), "pilot": _counts(primary),
            "sensitivity": [{"reaction_s": float(reaction),
                             "pilot_valid": _counts(pilots[float(reaction)])["valid"],
                             "pilot_rare": _counts(pilots[float(reaction)])["rare"]} for reaction in reactions]
            if len(reactions) > 1 else [], "rare": rare, "cells": cells,
            "esmini_checked": False, "runtime_s": round(time.monotonic() - started, 3),
            "engine": "reactive-metrics-v2"}


def reactive_metrics(model, reactions=(1.0,), progress=lambda *args: None, kinds=None):
    """Return the TS ReactiveMetrics contract for one source SceneModel, with no writes."""
    require(isinstance(reactions, (list, tuple)) and 1 <= len(reactions) <= 3
            and all(isinstance(x, (int, float)) and not isinstance(x, bool)
                    and np.isfinite(x) and 0.3 <= x <= 3 for x in reactions),
            "reactions phải có 1–3 số trong [0,3; 3]", "INVALID_INPUT")
    if kinds is not None:
        require(isinstance(kinds, (list, tuple)) and 1 <= len(kinds) <= 4
                and all(isinstance(kind, str) and kind in ("brake", "accelerate", "stopline", "lane_change")
                        for kind in kinds) and len(kinds) == len(set(kinds)),
                "kinds không hợp lệ", "INVALID_INPUT")
        return {kind: (reactive_metrics(model, reactions, progress) if kind == "brake"
                       else _kind_metrics(model, reactions, progress, kind)) for kind in kinds}
    started = time.monotonic()
    events = grid_candidates(model)
    baseline = []
    pilots = {float(reaction): [] for reaction in reactions}
    total = max(1, len(events) * (1 + len(pilots)))
    done = 0
    for event in events:
        baseline.append(_row(event, r.assess(model, r.simulate(model, event, react=False))))
        done += 1
        for reaction, rows in pilots.items():
            rows.append(_row(event, r.assess(model, r.simulate(model, event, react=True, reaction=reaction))))
            done += 1
        if done % 10 == 0 or done == total:
            progress(f"Đang đo phản ứng {done}/{total}", done, total)
    if not events:
        progress("Không có biến thể phản ứng", 1, 1)
    primary = pilots[float(reactions[0])]
    cells, rare = [], []
    for event, base, pilot in zip(events, baseline, primary):
        agent = model.agents[model.index[event.actor]]
        identity = {"actor": event.actor, "actor_id": agent.actor_id, "t0": event.t0,
                    "decel": event.decel, "target": event.target, "dwell": event.dwell}
        cells.append({**identity, "baseline": {"valid": base["valid"], "group": base["group"]},
                      "pilot": {"valid": pilot["valid"], "group": pilot["group"],
                                "min_gap": pilot["ego"].get("min_gap")}})
        if pilot["valid"] and pilot["group"] in ("hard", "close"):
            rare.append({**identity, "group": pilot["group"],
                         "ego_min_gap": pilot["ego"].get("min_gap"),
                         "ego_min_ttc": pilot["ego"].get("min_ttc"),
                         "ego_a_min": pilot["ego"].get("a_min")})
    rare.sort(key=lambda row: (0 if row["group"] == "hard" else 1,
                               float("inf") if row["ego_min_gap"] is None else row["ego_min_gap"],
                               row["actor"], row["t0"], row["decel"], row["dwell"]))
    return {"scene": model.name, "grid": {"event_step_s": EVENT_STEP, "decels": list(DECELS),
            "targets": [list(item) for item in TARGETS]}, "reaction_s": float(reactions[0]),
            "tried": len(events), "encounters": len({_encounter(e) for e in events}),
            "baseline": _counts(baseline), "pilot": _counts(primary),
            "sensitivity": [{"reaction_s": float(reaction), "pilot_valid": _counts(pilots[float(reaction)])["valid"],
                             "pilot_rare": _counts(pilots[float(reaction)])["rare"]} for reaction in reactions]
            if len(reactions) > 1 else [], "rare": rare, "cells": cells,
            "esmini_checked": False, "runtime_s": round(time.monotonic() - started, 3),
            "engine": VERSION}
