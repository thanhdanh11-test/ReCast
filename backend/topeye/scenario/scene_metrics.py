"""Automatic scene metrics: ReCast replay (esmini) vs a constant-velocity baseline (plan33).

Definitions live in planning/33_2026-10-13_scene-metrics/specs/00-SPEC.md §1; keep them in sync.
"""

import json
import math
import os
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from topeye.scenario.export import node, position, trigger
from topeye.scenario.map_context import DRIVABLE
from topeye.scenario.models import ScenarioError, write_json

VERSION = "scene-metrics-v3"
STEP = 0.05
MAX_GAP = 1.0
MOVING_PATH_M = 2.0
MOVING_SPEED = 0.5
SPEED_FACTORS = (0.8, 0.9, 1.1, 1.2)
OFFSETS_M = (-4.0, -2.0, 2.0, 4.0)
MIN_SUPPORT_S = 2.0
MAX_SPEED = 55.0
MAX_ACCEL = 12.0
PASS_ADE = 0.25
PASS_MAX = 0.5
RARE_TTC_S = 1.5
RARE_EGO_SPEED = 5.0
LANE_HALF_M = 1.5
CHUNK = 150


# ---------------------------------------------------------------- ground truth & grids
def rows(actor):
    return np.array(
        [[s["t_s"], s["x_m"], s["y_m"], s["z_m"], s["yaw_rad"]] for s in actor["samples"]], float
    )


def is_moving(data):
    if len(data) < 2:
        return False
    seg = np.hypot(np.diff(data[:, 1]), np.diff(data[:, 2]))
    dt = np.diff(data[:, 0])
    speed = seg / np.maximum(dt, 1e-9)
    return bool(seg.sum() >= MOVING_PATH_M and speed.max() >= MOVING_SPEED)


def grid(data, max_gap=MAX_GAP):
    """Global 20 Hz ticks inside the labelled support, skipping label gaps > 1 s."""
    ticks = (
        np.arange(math.ceil(data[0, 0] / STEP - 1e-9), math.floor(data[-1, 0] / STEP + 1e-9) + 1)
        * STEP
    )
    if not len(ticks):
        return ticks
    idx = np.clip(np.searchsorted(data[:, 0], ticks, side="right") - 1, 0, len(data) - 2)
    gap = data[idx + 1, 0] - data[idx, 0]
    # A tick on a label is always comparable, even when the next label is far away.
    on_label = (
        np.abs(data[np.clip(np.searchsorted(data[:, 0], ticks), 0, len(data) - 1), 0] - ticks)
        < 1e-6
    )
    return ticks[(gap <= max_gap + 1e-9) | on_label]


def truth(data, t):
    """Linear position, shortest-arc yaw between labels (the documented interpolation)."""
    t = np.asarray(t, float)
    x = np.interp(t, data[:, 0], data[:, 1])
    y = np.interp(t, data[:, 0], data[:, 2])
    yaw = np.interp(t, data[:, 0], np.unwrap(data[:, 4]))
    return np.stack([x, y], axis=1), yaw


def baseline(data, t):
    dt = max(data[1, 0] - data[0, 0], 1e-9)
    v = (data[1, 1:3] - data[0, 1:3]) / dt
    return data[0, 1:3] + np.outer(np.asarray(t) - data[0, 0], v)


def lon_lat(model_xy, truth_xy, truth_yaw):
    d = model_xy - truth_xy
    c, s = np.cos(truth_yaw), np.sin(truth_yaw)
    return np.stack([d[:, 0] * c + d[:, 1] * s, -d[:, 0] * s + d[:, 1] * c], axis=1)


# ---------------------------------------------------------------- esmini (roadless, many entities)
def metrics_xosc(entities, duration):
    """Entities: [{id, category, length_m, width_m, height_m, vertices: [(t,x,y,z,yaw)]}]."""
    root = ET.Element("OpenSCENARIO")
    node(
        root,
        "FileHeader",
        revMajor=1,
        revMinor=0,
        date="2026-10-13T00:00:00",
        description="ReCast scene metrics",
        author="ReCast",
    )
    node(root, "ParameterDeclarations")
    node(root, "CatalogLocations")
    node(root, "RoadNetwork")
    ents = node(root, "Entities")
    for e in entities:
        obj = node(ents, "ScenarioObject", name=e["id"])
        if e["category"].startswith("human."):
            model = node(
                obj, "Pedestrian", name=e["id"], model="", mass=70, pedestrianCategory="pedestrian"
            )
        else:
            model = node(obj, "Vehicle", name=e["category"], vehicleCategory="car")
        node(model, "ParameterDeclarations")
        box = node(model, "BoundingBox")
        node(box, "Center", x=0, y=0, z=e["height_m"] / 2)
        node(box, "Dimensions", width=e["width_m"], length=e["length_m"], height=e["height_m"])
        if not e["category"].startswith("human."):
            node(model, "Performance", maxSpeed=70, maxAcceleration=20, maxDeceleration=20)
            axles = node(model, "Axles")
            for name, x in [("FrontAxle", e["length_m"] * 0.3), ("RearAxle", 0)]:
                node(
                    axles,
                    name,
                    maxSteering=0.5,
                    wheelDiameter=0.6,
                    trackWidth=1.5,
                    positionX=x,
                    positionZ=0.3,
                )
        node(model, "Properties")
    board = node(root, "Storyboard")
    actions = node(node(board, "Init"), "Actions")

    def pose(v):
        return {"t_s": v[0], "x_m": v[1], "y_m": v[2], "z_m": v[3], "yaw_rad": v[4]}

    for e in entities:
        private = node(actions, "Private", entityRef=e["id"])
        position(node(node(private, "PrivateAction"), "TeleportAction"), pose(e["vertices"][0]))
    story = node(board, "Story", name="metrics")
    node(story, "ParameterDeclarations")
    act = node(story, "Act", name="replay")
    for e in entities:
        group = node(act, "ManeuverGroup", name=e["id"], maximumExecutionCount=1)
        node(
            node(group, "Actors", selectTriggeringEntities="false"), "EntityRef", entityRef=e["id"]
        )
        maneuver = node(group, "Maneuver", name="trajectory")
        node(maneuver, "ParameterDeclarations")
        event = node(maneuver, "Event", name="follow", priority="overwrite")
        follow = node(
            node(node(node(event, "Action", name="path"), "PrivateAction"), "RoutingAction"),
            "FollowTrajectoryAction",
        )
        trajectory = node(follow, "Trajectory", name=e["id"], closed="false")
        node(trajectory, "ParameterDeclarations")
        poly = node(node(trajectory, "Shape"), "Polyline")
        for v in e["vertices"]:
            position(node(poly, "Vertex", time=v[0]), pose(v))
        node(
            node(follow, "TimeReference"),
            "Timing",
            domainAbsoluteRelative="absolute",
            scale=1,
            offset=0,
        )
        node(follow, "TrajectoryFollowingMode", followingMode="position")
        trigger(event, "StartTrigger", 0)
    trigger(act, "StartTrigger", 0)
    node(act, "StopTrigger")
    trigger(board, "StopTrigger", duration + 0.1)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def run_esmini(entities, duration, engine, workdir, cancel=None):
    """Runs the existing isolated engine child; returns {id: array[[t, x, y, yaw]]}."""
    bundle = Path(tempfile.mkdtemp(prefix="metrics-", dir=workdir))
    (bundle / "normalized.xosc").write_bytes(metrics_xosc(entities, duration))
    write_json(
        bundle / "scenario.json",
        {
            "interval_s": [0, duration],
            "actors": [
                {k: e[k] for k in ("id", "category", "length_m", "width_m", "height_m")}
                | {"center_offset_m": [0, 0, e["height_m"] / 2]}
                for e in entities
            ],
        },
    )
    return run_engine(bundle, engine, duration, bundle / "run", cancel)


def run_engine(bundle, engine, duration, out, cancel=None):
    """Runs the isolated imported-engine child on a bundle (normalized.xosc + scenario.json).

    Returns {id: array[[t, x, y, yaw]]} of the reference point, the frame XOSC trajectories use."""
    out.mkdir(parents=True)
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[2])}
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "topeye.scenario.worker",
            "--engine-child-imported",
            str(bundle),
            str(engine),
            str(out),
        ],
        cwd=bundle,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )
    deadline = time.monotonic() + 120 + duration * 10
    while process.poll() is None:
        if (cancel and cancel()) or time.monotonic() > deadline:
            process.kill()
            process.wait()
            raise ScenarioError(
                "CANCELLED" if cancel and cancel() else "TIMEOUT", "Metrics engine run stopped"
            )
        time.sleep(0.05)
    if process.returncode != 0:
        raise ScenarioError("ENGINE_FAILED", "esmini metrics run failed")
    observed = json.loads((out / "observed.json").read_text())
    result = {}
    for r in observed:
        result.setdefault(r["id"], []).append(
            [r["t_s"], r["reference_x_m"], r["reference_y_m"], r["yaw_rad"]]
        )
    return {k: np.array(v) for k, v in result.items()}


def sample_at(track, t):
    """esmini 20 Hz samples at grid ticks (nearest within 1 ms; ticks are shared)."""
    idx = np.clip(np.searchsorted(track[:, 0], t - 1e-3), 0, len(track) - 1)
    ok = np.abs(track[idx, 0] - t) <= 1e-3
    return track[idx, 1:3], ok


# ---------------------------------------------------------------- variants
def arc(data):
    seg = np.hypot(np.diff(data[:, 1]), np.diff(data[:, 2]))
    return np.concatenate([[0.0], np.cumsum(seg)])


def along(data, cum, s):
    """Point and heading at arc length s on the label polyline."""
    x = np.interp(s, cum, data[:, 1])
    y = np.interp(s, cum, data[:, 2])
    i = np.clip(np.searchsorted(cum, s, side="right") - 1, 0, len(cum) - 2)
    yaw = np.arctan2(data[i + 1, 2] - data[i, 2], data[i + 1, 1] - data[i, 1])
    return np.stack([x, y], 1), yaw


def kinematics_ok(t, xy):
    if len(t) < 3:
        return False
    v = np.diff(xy, axis=0) / np.diff(t)[:, None]
    speed = np.linalg.norm(v, axis=1)
    # Accelerations on the 2 Hz label structure are piecewise; judge over 0.5 s windows like the importer.
    k = max(1, round(0.5 / STEP))
    vs = v[::k]
    acc = np.linalg.norm(np.diff(vs, axis=0), axis=1) / (k * STEP) if len(vs) > 1 else np.zeros(1)
    return bool(speed.max() <= MAX_SPEED and acc.max() <= MAX_ACCEL)


def box(x, y, yaw, length, width):
    c, s = math.cos(yaw), math.sin(yaw)
    hl, hw = length / 2, width / 2
    return Polygon(
        [
            (x + c * a - s * b, y + s * a + c * b)
            for a, b in ((hl, hw), (hl, -hw), (-hl, -hw), (-hl, hw))
        ]
    )


# ---------------------------------------------------------------- main
def scene_metrics(
    scene,
    engine,
    cache_dir=None,
    cancel=None,
    progress=lambda *a: None,
    pilot_bundle=None,
    max_gap=MAX_GAP,
):
    """`pilot_bundle`: replay this existing XOSC package as ReCast instead of building one from labels."""
    actors = scene["actors"]
    tracks = {a["id"]: rows(a) for a in actors if len(a["samples"]) >= 2}
    moving = [a for a in actors if a["id"] in tracks and is_moving(tracks[a["id"]])]
    ego = next((a for a in actors if a["role"] == "ego"), None)
    duration = float(scene["interval_s"][1])
    notes = ["Giữa hai mốc, vị trí thật được nội suy thẳng."]
    if max_gap < math.inf:
        notes[0] += " Khoảng trống nhãn > 1 s không so sánh."
    engine = Path(engine).resolve() if engine else None
    use_engine = bool(engine and engine.is_file())
    if not use_engine:
        notes.append(
            "Không có esmini: chưa tính được sai số phát lại của ReCast và biến thể hợp lệ."
        )
    work = Path(cache_dir) if cache_dir else Path(tempfile.gettempdir())
    work.mkdir(parents=True, exist_ok=True)

    # --- replay: pilot (esmini) and baseline (constant velocity)
    progress("Đang phát lại cảnh bằng esmini", 0, 3)
    pilot_tracks = {}
    if use_engine and moving:
        ents = [
            {
                "id": a["id"],
                "category": a["category"],
                "length_m": a["length_m"],
                "width_m": a["width_m"],
                "height_m": a.get("height_m") or 1.5,
                "vertices": [tuple(r) for r in tracks[a["id"]]],
            }
            for a in moving
        ]
        if pilot_bundle:
            out = Path(tempfile.mkdtemp(prefix="metrics-", dir=work)) / "run"
            pilot_tracks = run_engine(Path(pilot_bundle), engine, duration, out, cancel)
        else:
            pilot_tracks = run_esmini(ents, duration, engine, work, cancel)
    per_object, pilot_ades, base_ades, pilot_max, base_max = {}, [], [], 0.0, 0.0
    for a in moving:
        data = tracks[a["id"]]
        t = grid(data, max_gap)
        if len(t) < 2:
            continue
        true_xy, true_yaw = truth(data, t)
        base_xy = baseline(data, t)
        base_err = np.linalg.norm(base_xy - true_xy, axis=1)
        entry = {
            "category": a["category"],
            "role": a["role"],
            "length_m": a["length_m"],
            "width_m": a["width_m"],
            "height_m": a.get("height_m"),
            "keyframes": sum(1 for s in a["samples"] if s.get("observed", True)),
            "span_s": float(data[-1, 0] - data[0, 0]),
            "grid_t": np.round(t, 3).tolist(),
            "baseline_err": np.round(base_err, 3).tolist(),
            "baseline_lon_lat": np.round(lon_lat(base_xy, true_xy, true_yaw), 3).tolist(),
            "baseline_ade_m": float(base_err.mean()),
            "baseline_max_m": float(base_err.max()),
            "pilot_err": None,
            "pilot_lon_lat": None,
            "pilot_ade_m": None,
            "pilot_max_m": None,
        }
        base_ades.append(base_err.mean())
        base_max = max(base_max, float(base_err.max()))
        if a["id"] in pilot_tracks:
            xy, ok = sample_at(pilot_tracks[a["id"]], t)
            err = np.where(ok, np.linalg.norm(xy - true_xy, axis=1), np.nan)
            if np.isfinite(err).any():
                entry.update(
                    pilot_err=[None if not math.isfinite(e) else round(float(e), 3) for e in err],
                    pilot_lon_lat=np.round(
                        np.where(ok[:, None], lon_lat(xy, true_xy, true_yaw), np.nan), 3
                    ).tolist(),
                    pilot_ade_m=float(np.nanmean(err)),
                    pilot_max_m=float(np.nanmax(err)),
                )
                pilot_ades.append(np.nanmean(err))
                pilot_max = max(pilot_max, float(np.nanmax(err)))
        per_object[a["id"]] = entry

    # --- variants
    progress("Đang sinh và kiểm biến thể", 1, 3)
    road = None
    try:
        polys = [
            Polygon(p["outer"], p.get("holes") or []).buffer(0)
            for p in (scene.get("environment") or {}).get("polygons", [])
            if p["kind"] in DRIVABLE
        ]
        road = unary_union(polys) if polys else None
    except Exception:  # noqa: BLE001 — invalid source map: documented as "map not checked"
        road = None
    if road is None:
        notes.append(
            "Cảnh không có map hợp lệ: biến thể không kiểm điều kiện nằm trên vùng lái được."
        )
    centers = {}
    for a in actors:
        if a["id"] not in tracks:
            continue
        data = tracks[a["id"]]
        t = grid(data, max_gap)
        xy, yaw = truth(data, t) if len(t) else (np.zeros((0, 2)), np.zeros(0))
        idx = np.round(t / STEP).astype(int)
        centers[a["id"]] = (idx, xy, yaw, a["length_m"], a["width_m"])

    def others_overlap(actor_id, idx, xy, yaw, length, width):
        for oid, (oidx, oxy, oyaw, ol, ow) in centers.items():
            if oid == actor_id:
                continue
            common, i1, i2 = np.intersect1d(idx, oidx, return_indices=True)
            if not len(common):
                continue
            d = np.linalg.norm(xy[i1] - oxy[i2], axis=1)
            near = np.where(d < (math.hypot(length, width) + math.hypot(ol, ow)) / 2)[0]
            for k in near:
                if box(*xy[i1[k]], yaw[i1[k]], length, width).intersects(
                    box(*oxy[i2[k]], oyaw[i2[k]], ol, ow)
                ):
                    return True
        return False

    def on_road(xy):
        return road is None or all(road.covers(Point(p)) for p in xy[:: max(1, len(xy) // 40)])

    def ego_event(idx, xy, yaw, length, width):
        if ego is None or ego["id"] not in centers:
            return False
        eidx, exy, eyaw, el, _ew = centers[ego["id"]]
        common, i1, i2 = np.intersect1d(idx, eidx, return_indices=True)
        if len(common) < 2:
            return False
        rel = xy[i1] - exy[i2]
        c, s = np.cos(eyaw[i2]), np.sin(eyaw[i2])
        ahead, lateral = rel[:, 0] * c + rel[:, 1] * s, -rel[:, 0] * s + rel[:, 1] * c
        gap_long = ahead - (el + length) / 2
        closing = -np.gradient(ahead, common * STEP)
        # Braking to a stop behind a queue also yields short TTC; only judge while ego is driving.
        ego_speed = np.linalg.norm(np.gradient(exy[i2], common * STEP, axis=0), axis=1)
        ttc = np.where(
            (ahead > 0)
            & (np.abs(lateral) <= LANE_HALF_M)
            & (closing > 0.1)
            & (gap_long > 0)
            & (ego_speed >= RARE_EGO_SPEED),
            gap_long / np.maximum(closing, 1e-9),
            np.inf,
        )
        # Only time-to-collision: a plain distance threshold also flags adjacent-lane passing and stopped queues.
        return bool(ttc.min() < RARE_TTC_S)

    candidates, base_valid, total, original_rare = [], 0, 0, 0
    for a in moving:
        if a["role"] == "ego" or not a["category"].startswith("vehicle."):
            continue
        data = tracks[a["id"]]
        idx0, xy0, yaw0, L0, W0 = centers[a["id"]]
        if ego_event(idx0, xy0, yaw0, L0, W0):
            original_rare += 1
        t = grid(data, max_gap)
        cum = arc(data)
        s_t = np.interp(t, data[:, 0], cum)
        heading0 = data[0, 4]
        u0 = np.array([math.cos(heading0), math.sin(heading0)])
        for f in SPEED_FACTORS:
            for d in OFFSETS_M:
                total += 1
                s_new = f * s_t + d
                keep = (s_new >= 0) & (s_new <= cum[-1])
                if keep.sum() * STEP < MIN_SUPPORT_S:
                    continue
                tt, sn = t[keep], s_new[keep]
                idx = np.round(tt / STEP).astype(int)
                # pilot: along the object's own path
                pxy, pyaw = along(data, cum, sn)
                if (
                    kinematics_ok(tt, pxy)
                    and on_road(pxy)
                    and not others_overlap(a["id"], idx, pxy, pyaw, a["length_m"], a["width_m"])
                ):
                    candidates.append(
                        {"actor": a, "f": f, "d": d, "t": tt, "idx": idx, "xy": pxy, "yaw": pyaw}
                    )
                # baseline: same change, applied straight along the initial heading
                bxy = data[0, 1:3] + np.outer(sn, u0)
                byaw = np.full(len(tt), heading0)
                if (
                    kinematics_ok(tt, bxy)
                    and on_road(bxy)
                    and not others_overlap(a["id"], idx, bxy, byaw, a["length_m"], a["width_m"])
                ):
                    base_valid += 1

    # pilot condition (v): the variant must replay in esmini within the app thresholds
    progress("Đang phát lại biến thể bằng esmini", 2, 3)
    pilot_valid, rare = 0, 0
    if use_engine and candidates:
        for start in range(0, len(candidates), CHUNK):
            chunk = candidates[start : start + CHUNK]
            ents = []
            for k, c in enumerate(chunk):
                verts = [
                    (
                        float(c["t"][i]),
                        float(c["xy"][i, 0]),
                        float(c["xy"][i, 1]),
                        0.0,
                        float(c["yaw"][i]),
                    )
                    for i in range(0, len(c["t"]), 2)
                ]
                if verts[-1][0] != float(c["t"][-1]):
                    verts.append(
                        (
                            float(c["t"][-1]),
                            float(c["xy"][-1, 0]),
                            float(c["xy"][-1, 1]),
                            0.0,
                            float(c["yaw"][-1]),
                        )
                    )
                ents.append(
                    {
                        "id": f"v{start + k}",
                        "category": c["actor"]["category"],
                        "length_m": c["actor"]["length_m"],
                        "width_m": c["actor"]["width_m"],
                        "height_m": c["actor"].get("height_m") or 1.5,
                        "vertices": verts,
                    }
                )
            replayed = run_esmini(ents, duration, engine, work, cancel)
            for k, c in enumerate(chunk):
                track = replayed.get(f"v{start + k}")
                if track is None:
                    continue
                xy, ok = sample_at(track, c["t"])
                if not ok.all():
                    continue
                err = np.linalg.norm(xy - c["xy"], axis=1)
                if err.mean() <= PASS_ADE and err.max() <= PASS_MAX:
                    pilot_valid += 1
                    if ego_event(
                        c["idx"], c["xy"], c["yaw"], c["actor"]["length_m"], c["actor"]["width_m"]
                    ):
                        rare += 1
    progress("Đã tính chỉ số", 3, 3)
    return {
        "version": VERSION,
        "scene": scene["source"]["scene"],
        "generated_at": datetime.now(UTC).isoformat(),
        "engine": "esmini 3.9.0" if use_engine else None,
        "objects": {"total": len(actors), "moving": len(moving)},
        "replay": {
            "pilot": {"ade_m": float(np.mean(pilot_ades)), "max_m": pilot_max}
            if pilot_ades
            else None,
            "baseline": {
                "ade_m": float(np.mean(base_ades)) if base_ades else 0.0,
                "max_m": base_max,
            },
            "objects": len(per_object),
        },
        "variants": {
            "per_object": len(SPEED_FACTORS) * len(OFFSETS_M),
            "total": total,
            "pilot_valid": pilot_valid if use_engine else None,
            "baseline_valid": base_valid,
            "map_checked": road is not None,
        },
        "rare": {"pilot": rare if use_engine else None, "original": original_rare},
        "per_object": per_object,
        "notes": notes,
    }
