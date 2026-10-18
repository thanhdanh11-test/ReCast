#!/usr/bin/env python3
"""Record one CARLA town as a raw scene for Recast (plan56, 01-CONTRACTS "Raw bundle").

Runs next to a CARLA 0.9.15 server (e.g. inside the carla-env client container):
    python carla_record_scene.py --town Town10HD_Opt --out /work/output/topeye/town10hd

Writes <out>/raw.json (map lanes, crosswalks, ego and actor tracks, all in the OpenDRIVE frame:
CARLA/Unreal y and yaw change sign) and <out>/lidar/<tick>.npy (float32 N x 4: x forward, y left, z up,
intensity 0-255, sensor frame). Traffic is driven by the Traffic Manager with a fixed seed.
"""
import argparse
import itertools
import json
import math
import queue
import random
from pathlib import Path

import numpy as np

DT = 0.05
LIDAR_HEIGHT = 1.84  # m, nuScenes LIDAR_TOP height above ground
NEAR_M = 120.0  # actors recorded within this distance of the ego


def odr_xy(loc):
    """Unreal/CARLA location -> OpenDRIVE (right-handed) x, y."""
    return [round(loc.x, 3), round(-loc.y, 3)]


def odr_yaw(rotation):
    return -math.radians(rotation.yaw)


def category_of(actor):
    base = actor.attributes.get("base_type", "").lower()
    if base == "bus" or "fusorosa" in actor.type_id:
        return "vehicle.bus.rigid"
    if base in ("truck", "van") or any(k in actor.type_id for k in ("carlacola", "firetruck", "european_hgv", "sprinter", "ambulance")):
        return "vehicle.truck"
    if base == "motorcycle" or any(k in actor.type_id for k in ("yamaha", "kawasaki", "harley", "vespa")):
        return "vehicle.motorcycle"
    if base == "bicycle" or any(k in actor.type_id for k in ("century", "crossbike", "omafiets")):
        return "vehicle.bicycle"
    return "vehicle.car"


def extract_map(carla, cmap, step=1.0):
    """Lanes (driving + neighbours such as sidewalks) as left/right edge polylines, and crosswalk polygons."""
    lanes = {}

    def add(wp):
        key = (wp.road_id, wp.section_id, wp.lane_id)
        lane = lanes.setdefault(key, {"id": "{}_{}_{}".format(*key), "type": str(wp.lane_type), "junction": wp.is_junction,
                                      "marking_left": str(wp.left_lane_marking.type), "pts": {}})
        s = round(wp.s, 1)
        if s in lane["pts"]:
            return
        c, r, h = wp.transform.location, wp.transform.get_right_vector(), wp.lane_width / 2
        left = carla.Location(c.x - r.x * h, c.y - r.y * h, c.z)
        right = carla.Location(c.x + r.x * h, c.y + r.y * h, c.z)
        lane["pts"][s] = (odr_xy(left), odr_xy(right), round(c.z, 3))

    for wp in cmap.generate_waypoints(step):
        add(wp)
        side = wp.get_right_lane()
        for _ in range(4):  # sidewalks, shoulders, parking next to the driving lane
            if side is None or side.lane_type == carla.LaneType.Driving:
                break
            add(side)
            side = side.get_right_lane()
    out = []
    for lane in lanes.values():
        pts = [lane["pts"][s] for s in sorted(lane["pts"])]
        if len(pts) < 2:
            continue
        out.append({"id": lane["id"], "type": lane["type"], "junction": lane["junction"],
                    "marking_left": lane["marking_left"],
                    "left": [p[0] for p in pts], "right": [p[1] for p in pts], "z": [p[2] for p in pts]})
    crosswalks, ring = [], []
    for loc in cmap.get_crosswalks():
        p = odr_xy(loc)
        if ring and abs(p[0] - ring[0][0]) < 1e-3 and abs(p[1] - ring[0][1]) < 1e-3 and len(ring) >= 3:
            crosswalks.append(ring)
            ring = []
        else:
            ring.append(p)
    return {"lanes": out, "crosswalks": crosswalks}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=2000)
    ap.add_argument("--town", default="Town10HD_Opt")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--warmup", type=float, default=4.0)
    ap.add_argument("--vehicles", type=int, default=45)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--attempts", type=int, default=5)
    ap.add_argument("--min-travel", type=float, default=120.0, help="m the ego must drive straight in the clip")
    ap.add_argument("--max-turn", type=float, default=15.0, help="deg the ego heading may drift over that distance")
    ap.add_argument("--ego-mps", type=float, default=7.0, help="constant ego speed along its lane (m/s)")
    args = ap.parse_args(argv)

    import carla

    out = Path(args.out)
    (out / "lidar").mkdir(parents=True, exist_ok=True)
    random.seed(args.seed)
    client = carla.Client(args.host, args.port)
    client.set_timeout(180.0)
    world = client.get_world()
    if not world.get_map().name.endswith(args.town):
        world = client.load_world(args.town)
    original = world.get_settings()
    settings = world.get_settings()
    settings.synchronous_mode = True
    settings.fixed_delta_seconds = DT
    world.apply_settings(settings)
    tm = client.get_trafficmanager(8000)
    tm.set_synchronous_mode(True)
    tm.set_random_device_seed(args.seed)
    cmap = world.get_map()
    print("Extracting map…")
    raw = {"town": args.town, "dt": DT, "keyframe_every": 10, "lidar": {"height_m": LIDAR_HEIGHT, "x_m": 0.0},
           "map": extract_map(carla, cmap)}
    print(f"  {len(raw['map']['lanes'])} lanes, {len(raw['map']['crosswalks'])} crosswalks")

    lib = world.get_blueprint_library()
    spawns = cmap.get_spawn_points()

    def straight_run(tf):
        """Metres the spawn point's lane keeps going straight: a clear road for authoring."""
        wp, run = cmap.get_waypoint(tf.location), 0.0
        heading = wp.transform.rotation.yaw
        while run < 200:
            nxt = wp.next(5.0)
            if not nxt or abs((nxt[0].transform.rotation.yaw - heading + 180) % 360 - 180) > 25:
                break
            wp, run = nxt[0], run + 5.0
        return run

    candidates = [s for s in sorted(spawns, key=straight_run, reverse=True) if straight_run(s) >= args.min_travel][: args.attempts]
    for attempt, ego_tf in enumerate(candidates, 1):
        print(f"Attempt {attempt}: ego spawn ({ego_tf.location.x:.0f}, {ego_tf.location.y:.0f}), straight {straight_run(ego_tf):.0f} m")
        result = record(carla, client, world, tm, lib, spawns, ego_tf, out, args)
        if result is None:
            continue
        raw.update(result)
        straight = straight_travel(raw["ego"], args.max_turn)
        print(f"  recorded {raw['ticks']} ticks, {len(raw['actors'])} vehicles, ego drove {straight:.0f} m straight")
        if straight >= args.min_travel:
            (out / "raw.json").write_text(json.dumps(raw))
            print(f"Saved -> {out}")
            break
    else:
        raise SystemExit(f"No attempt drove the ego {args.min_travel} m straight")
    tm.set_synchronous_mode(False)
    world.apply_settings(original)


def straight_travel(ego_rows, max_turn_deg):
    """Metres the ego drives before its heading drifts more than max_turn_deg from the start (templates need a straight road)."""
    start, dist = ego_rows[0][4], 0.0
    for a, b in itertools.pairwise(ego_rows):
        if abs((b[4] - start + math.pi) % (2 * math.pi) - math.pi) > math.radians(max_turn_deg):
            break
        dist += math.hypot(b[1] - a[1], b[2] - a[2])
    return dist


def lane_path(cmap, start, length, step=0.5):
    """Points (x, y, z, yaw_deg in Unreal) along the lane from `start`, taking the straightest successor at forks."""
    wp, pts = cmap.get_waypoint(start.location), []
    while len(pts) * step < length:
        loc, rot = wp.transform.location, wp.transform.rotation
        pts.append((loc.x, loc.y, loc.z, rot.yaw))
        nxt = wp.next(step)
        if not nxt:
            break
        wp = min(nxt, key=lambda w: abs((w.transform.rotation.yaw - rot.yaw + 180) % 360 - 180))
    return np.array(pts), step


def record(carla, client, world, tm, lib, spawns, ego_tf, out, args):
    """One clip from this ego spawn: (dict with ego/actors/ticks) or None when the ego cannot spawn."""
    ego_bp = lib.find("vehicle.lincoln.mkz_2020")
    ego_bp.set_attribute("role_name", "hero")
    ego = world.try_spawn_actor(ego_bp, ego_tf)
    if ego is None:
        return None
    actors = [ego]
    # Traffic around the ego but not right in front of it, so the ego keeps driving.
    near = sorted((s for s in spawns if s.location.distance(ego_tf.location) > 35), key=lambda s: s.location.distance(ego_tf.location))
    cars = [b for b in lib.filter("vehicle.*") if int(b.get_attribute("number_of_wheels")) >= 2]
    for tf in near[: args.vehicles]:
        bp = random.choice(cars)
        if bp.has_attribute("color"):
            bp.set_attribute("color", random.choice(bp.get_attribute("color").recommended_values))
        v = world.try_spawn_actor(bp, tf)
        if v is not None:
            actors.append(v)
    for v in actors[1:]:
        v.set_autopilot(True, tm.get_port())
    # The ego is moved kinematically at a constant speed along its lane, straight at every junction: Traffic Manager
    # jerks its cars (8.5 m/s^2 measured), which the app's physics checks reject as label errors (plan56 D7).
    ego.set_simulate_physics(False)
    path, step = lane_path(world.get_map(), ego_tf, args.ego_mps * (args.warmup + args.seconds) + 20)
    clock = [0]

    def drive():
        s = min(args.ego_mps * clock[0] * DT / step, len(path) - 1.001)
        i, f = int(s), s - int(s)
        p = path[i] * (1 - f) + path[i + 1] * f
        dyaw = (path[i + 1][3] - path[i][3] + 180) % 360 - 180
        ego.set_transform(carla.Transform(carla.Location(float(p[0]), float(p[1]), float(p[2])),
                                          carla.Rotation(yaw=float(path[i][3] + f * dyaw))))
        clock[0] += 1
    lidar_bp = lib.find("sensor.lidar.ray_cast")
    for k, v in {"channels": "32", "range": "70", "rotation_frequency": str(round(1 / DT)), "points_per_second": "600000",
                 "upper_fov": "10", "lower_fov": "-30", "dropoff_general_rate": "0.0", "noise_stddev": "0.01"}.items():
        lidar_bp.set_attribute(k, v)
    lidar = world.spawn_actor(lidar_bp, carla.Transform(carla.Location(z=LIDAR_HEIGHT)), attach_to=ego)
    frames = queue.Queue()
    lidar.listen(frames.put)
    try:
        for _ in range(int(args.warmup / DT)):
            drive()
            world.tick()
        while not frames.empty():
            frames.get_nowait()
        ego_rows, tracks = [], {}
        ticks = round(args.seconds / DT) + 1
        for tick in range(ticks):
            drive()
            frame_id = world.tick()
            t = round(tick * DT, 3)
            e = ego.get_transform()
            ego_rows.append([t, *odr_xy(e.location), round(e.location.z, 3), round(odr_yaw(e.rotation), 5)])
            for v in world.get_actors().filter("vehicle.*"):
                if v.id == ego.id or v.get_location().distance(e.location) > NEAR_M:
                    continue
                tf, bb = v.get_transform(), v.bounding_box
                c = tf.transform(bb.location)
                tr = tracks.setdefault(str(v.id), {"category": category_of(v),
                                                   "size": [round(2 * bb.extent.y, 3), round(2 * bb.extent.x, 3), round(2 * bb.extent.z, 3)],
                                                   "rows": []})
                tr["rows"].append([t, *odr_xy(c), round(c.z, 3), round(odr_yaw(tf.rotation), 5)])
            # The sensor stream is asynchronous: wait for the scan of exactly this simulation frame.
            scan = frames.get(timeout=10.0)
            while scan.frame < frame_id:
                scan = frames.get(timeout=10.0)
            pts = np.frombuffer(scan.raw_data, dtype=np.float32).reshape(-1, 4).copy()
            pts[:, 1] *= -1  # Unreal y right -> y left
            pts[:, 3] = np.clip(pts[:, 3] * 255.0, 0, 255)
            np.save(out / "lidar" / f"{tick:04d}.npy", pts)
        return {"ego": ego_rows, "actors": tracks, "ticks": ticks}
    finally:
        lidar.stop()
        lidar.destroy()
        for v in actors[1:]:
            v.set_autopilot(False, tm.get_port())
        client.apply_batch_sync([carla.command.DestroyActor(v) for v in actors], True)
        world.tick()


if __name__ == "__main__":
    main()
