#!/usr/bin/env python3
"""Replay a Topeye CARLA package in CARLA 0.9.x, with the exact timing of trajectories.csv.

Why not only the .xosc: CARLA scenario_runner supports FollowTrajectoryAction "only Polylines
without temporal constraints" (scenario_runner Docs/openscenario_support.md), so the timed event
(e.g. a brake at 3 s) would not happen at the right moment. This script:
  1. builds the road from the package's .xodr (client.generate_opendrive_world),
  2. spawns every object of trajectories.csv with a blueprint for its nuScenes category,
  3. moves them each tick (synchronous mode, physics off) to the interpolated recorded/simulated pose,
  4. spawns an object at its first sample and removes it after its last (like AddEntity/DeleteEntity).

Usage (on the CARLA machine, CARLA server already running):
  python carla_replay.py <package.zip | package folder> [--host 127.0.0.1] [--port 2000] [--loop] [--record out.log]
  Headless server (no screen): add --video replay.mp4 [--view chase|driver] (needs ffmpeg).
"""
import argparse
import csv
import io
import math
import queue
import subprocess
import sys
import time
import zipfile
from bisect import bisect_right
from pathlib import Path

DT = 0.05  # s, same step as the Topeye simulation
VIEWS = ("chase", "driver")
# Driver eye relative to the ego origin (CARLA: x forward, y right, z up): left seat, behind the windscreen.
DRIVER_EYE = (0.1, -0.38, 1.25)

# nuScenes category prefix -> CARLA blueprint candidates (first available wins).
BLUEPRINTS = [
    ("ego", ["vehicle.lincoln.mkz_2020", "vehicle.lincoln.mkz_2017", "vehicle.tesla.model3"]),
    ("vehicle.bus", ["vehicle.mitsubishi.fusorosa", "vehicle.carlamotors.carlacola"]),
    ("vehicle.truck", ["vehicle.carlamotors.carlacola", "vehicle.carlamotors.european_hgv"]),
    ("vehicle.trailer", ["vehicle.carlamotors.carlacola"]),
    ("vehicle.construction", ["vehicle.carlamotors.carlacola"]),
    ("vehicle.emergency", ["vehicle.ford.ambulance", "vehicle.carlamotors.firetruck"]),
    ("vehicle.motorcycle", ["vehicle.yamaha.yzf", "vehicle.kawasaki.ninja"]),
    ("vehicle.bicycle", ["vehicle.diamondback.century", "vehicle.bh.crossbike"]),
    ("vehicle", ["vehicle.tesla.model3", "vehicle.audi.a2"]),
    ("human", ["walker.pedestrian.0001"]),
    ("movable_object.trafficcone", ["static.prop.trafficcone01", "static.prop.constructioncone"]),
    ("movable_object", ["static.prop.streetbarrier", "static.prop.constructioncone"]),
    ("", ["static.prop.box01"]),
]


def read_package(path):
    """(xodr text or None, csv text, package name, CARLA town or None) from a Topeye export .zip or folder.

    A scene recorded in a CARLA town (manifest "carla_town") has no .xodr: the town itself is loaded.
    """
    path = Path(path)
    if path.is_file() and path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            contents = {n: z.read(n).decode() for n in z.namelist() if not n.endswith("/")}
        name = path.stem
    else:
        contents = {str(f): f.read_text() for f in path.rglob("*") if f.is_file()}
        name = path.name
    read = lambda suffix: next((text for n, text in contents.items() if n.endswith(suffix)), None)
    import json
    manifest = json.loads(read("manifest.json") or "{}")
    town = (manifest.get("carla_town") or {}).get("town")
    return (None if town else read(".xodr")), read("trajectories.csv"), name, town


def read_tracks(text):
    """{object_id: {"category", "t": [...], "x", "y", "yaw" (unwrapped)}} sorted by time."""
    tracks = {}
    for row in csv.DictReader(io.StringIO(text)):
        tr = tracks.setdefault(row["object_id"], {"category": row["category"], "t": [], "x": [], "y": [], "yaw": []})
        tr["t"].append(float(row["time_s"]))
        tr["x"].append(float(row["x_m"]))
        tr["y"].append(float(row["y_m"]))
        tr["yaw"].append(float(row["yaw_rad"]))
    for tr in tracks.values():
        order = sorted(range(len(tr["t"])), key=tr["t"].__getitem__)
        for key in ("t", "x", "y", "yaw"):
            tr[key] = [tr[key][i] for i in order]
        for i in range(1, len(tr["yaw"])):  # unwrap so interpolation never spins through ±pi
            d = tr["yaw"][i] - tr["yaw"][i - 1]
            tr["yaw"][i] -= round(d / (2 * math.pi)) * 2 * math.pi
    return tracks


def pose_at(tr, t):
    """Linear interpolation of (x, y, yaw) at time t, or None outside the object's time span."""
    ts = tr["t"]
    if t < ts[0] - 1e-9 or t > ts[-1] + 1e-9:
        return None
    i = min(max(bisect_right(ts, t) - 1, 0), len(ts) - 2) if len(ts) > 1 else 0
    if len(ts) == 1:
        return tr["x"][0], tr["y"][0], tr["yaw"][0]
    a = (t - ts[i]) / max(ts[i + 1] - ts[i], 1e-9)
    a = min(max(a, 0.0), 1.0)
    lerp = lambda k: tr[k][i] + a * (tr[k][i + 1] - tr[k][i])
    return lerp("x"), lerp("y"), lerp("yaw")


def to_carla(carla, x, y, yaw, z=0.0):
    """OpenDRIVE / OpenSCENARIO frame (right-handed) -> CARLA (left-handed): y and yaw change sign."""
    return carla.Transform(carla.Location(x=x, y=-y, z=z), carla.Rotation(yaw=-math.degrees(yaw)))


def blueprint_for(library, object_id, category):
    key = "ego" if object_id == "ego" else category
    for prefix, names in BLUEPRINTS:
        if key.startswith(prefix):
            for name in names:
                found = library.filter(name)
                if found:
                    return found[0]
    return library.filter("vehicle.*")[0]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("package")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=2000)
    ap.add_argument("--loop", action="store_true", help="replay again and again until Ctrl+C")
    ap.add_argument("--record", help="CARLA recorder file (server side), e.g. topeye.log")
    ap.add_argument("--speed", type=float, default=1.0, help="playback speed factor (wall clock)")
    ap.add_argument("--video", help="write an MP4 of a chase camera behind the ego (needs ffmpeg); runs as fast as possible")
    ap.add_argument("--size", default="1280x720", help="video size WxH")
    ap.add_argument("--view", choices=VIEWS, default="chase", help="chase: behind and above the ego; driver: from the driver seat")
    ap.add_argument("--weather", default="ClearNoon", help="carla.WeatherParameters preset (a generated .xodr world starts at dusk)")
    args = ap.parse_args(argv)

    import carla

    xodr, csv_text, name, town = read_package(args.package)
    tracks = read_tracks(csv_text)
    end = max(tr["t"][-1] for tr in tracks.values())
    print(f"{name}: {len(tracks)} objects, {end:.1f} s")

    client = carla.Client(args.host, args.port)
    client.set_timeout(60.0)
    if town:
        print(f"Loading CARLA town {town} (buildings, trees, traffic lights included)…")
        world = client.get_world()
        if not world.get_map().name.endswith(town):
            world = client.load_world(town)
    else:
        print("Building the road from the .xodr (generate_opendrive_world)…")
        world = client.generate_opendrive_world(xodr, carla.OpendriveGenerationParameters(
            vertex_distance=2.0, max_road_length=50.0, wall_height=0.0, additional_width=0.6,
            smooth_junctions=True, enable_mesh_visibility=True))
    preset = getattr(carla.WeatherParameters, args.weather, None)
    if preset is not None:
        world.set_weather(preset)
    original = world.get_settings()
    settings = world.get_settings()
    settings.synchronous_mode = True
    settings.fixed_delta_seconds = DT
    world.apply_settings(settings)
    library = world.get_blueprint_library()
    cmap = world.get_map()

    def ground(x, y):
        """Road height under (x, y) in a CARLA town (its roads are not flat); 0 for a generated .xodr world."""
        if not town:
            return 0.0
        wp = cmap.get_waypoint(carla.Location(x=x, y=-y), project_to_road=True, lane_type=carla.LaneType.Any)
        return wp.transform.location.z if wp is not None else 0.0
    spectator = world.get_spectator()
    if args.record:
        client.start_recorder(args.record)
    actors = {}
    camera = frames = encoder = None
    if args.video:
        width, height = (int(v) for v in args.size.split("x"))
        cam_bp = library.find("sensor.camera.rgb")
        cam_bp.set_attribute("image_size_x", str(width))
        cam_bp.set_attribute("image_size_y", str(height))
        cam_bp.set_attribute("fov", "90")
        frames = queue.Queue()
        encoder = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra",
                                    "-s", f"{width}x{height}", "-r", str(round(1 / DT)), "-i", "-",
                                    "-pix_fmt", "yuv420p", "-c:v", "libx264", args.video], stdin=subprocess.PIPE)
        args.speed = float("inf")  # offline rendering: no need to wait for the wall clock
    try:
        while True:
            t = 0.0
            started = time.time()
            while t <= end + 1e-9:
                for oid, tr in tracks.items():
                    pose = pose_at(tr, t)
                    actor = actors.get(oid)
                    if pose is None:
                        if actor is not None:
                            actor.destroy()
                            del actors[oid]
                        continue
                    transform = to_carla(carla, *pose, z=ground(pose[0], pose[1]) + 0.05)
                    if actor is None:
                        bp = blueprint_for(library, oid, tr["category"])
                        if bp.has_attribute("role_name"):
                            bp.set_attribute("role_name", "hero" if oid == "ego" else oid)
                        if oid == "ego" and bp.has_attribute("color"):
                            bp.set_attribute("color", "200,30,30")
                        # Spawn high above first (no overlap refusal), then teleport into place.
                        lifted = to_carla(carla, *pose, z=200.0 + 4.0 * len(actors))
                        actor = world.try_spawn_actor(bp, lifted)
                        if actor is None:
                            print(f"  ! could not spawn {oid} ({bp.id})")
                            continue
                        actor.set_simulate_physics(False)
                        actors[oid] = actor
                    actor.set_transform(transform)
                ego = actors.get("ego")
                if ego is not None:
                    e = ego.get_transform()
                    back = e.get_forward_vector()
                    view = carla.Transform(
                        carla.Location(x=e.location.x - 12 * back.x, y=e.location.y - 12 * back.y, z=e.location.z + 7),
                        carla.Rotation(pitch=-22, yaw=e.rotation.yaw))
                    spectator.set_transform(view)
                    if args.video and camera is None:
                        if args.view == "driver":  # rides with the ego: no per-tick move
                            eye = carla.Transform(carla.Location(*DRIVER_EYE), carla.Rotation(pitch=-3))
                            camera = world.spawn_actor(cam_bp, eye, attach_to=ego)
                        else:
                            camera = world.spawn_actor(cam_bp, view)
                        camera.listen(frames.put)
                    if camera is not None and args.view == "chase":
                        camera.set_transform(view)
                world.tick()
                if camera is not None:
                    try:
                        encoder.stdin.write(bytes(frames.get(timeout=10.0).raw_data))
                    except queue.Empty:
                        print("  ! camera frame missing")
                t += DT
                lag = started + t / args.speed - time.time()
                if lag > 0:
                    time.sleep(lag)
            print(f"Replayed {end:.1f} s with {len(tracks)} objects.")
            for actor in actors.values():
                actor.destroy()
            actors.clear()
            if not args.loop:
                break
    except KeyboardInterrupt:
        pass
    finally:
        if camera is not None:
            camera.stop()
            camera.destroy()
        if encoder is not None:
            encoder.stdin.close()
            encoder.wait()
            print(f"Video: {args.video}")
        if args.record:
            client.stop_recorder()
        for actor in actors.values():
            actor.destroy()
        world.apply_settings(original)
    return 0


if __name__ == "__main__":
    sys.exit(main())
