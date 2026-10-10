"""Seeded traffic on observed paths, with whole-track safety rejection (SPEC-S5)."""

from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d

TRAFFIC_DEFAULTS = {"mode": "replay", "density": 1.0, "speed_scale": 1.0,
                    "speed_jitter": 0.15, "lane_change_rate": 0.2, "aggressiveness": 0.3,
                    "pedestrians": 1.0, "keep_parked": True, "seed": 0,
                    "distance_to_leading": 2.5, "speed_difference_percent": 0.0,
                    "random_lanechange_percent": 0.0, "max_accel": 3.0,
                    "max_decel": 6.0, "max_lateral_accel": 4.0, "preset": "default"}
VN_CLASS_MIX = {"motorcycle": 0.75, "car": 0.15, "bicycle": 0.04, "truck": 0.03, "bus": 0.03}
VN_SIZES = {"motorcycle": (0.70, 1.96, 1.71), "bicycle": (0.69, 1.77, 1.71),
            "car": (1.94, 4.61, 1.64), "truck": (2.29, 5.91, 2.56), "bus": (2.91, 12.09, 3.61)}
VEHICLES = {"car", "truck", "bus", "trailer", "construction_vehicle", "motorcycle", "bicycle"}
RANGES = {"density": (0, 3), "speed_scale": (0.5, 2), "speed_jitter": (0, 0.5),
          "lane_change_rate": (0, 1), "aggressiveness": (0, 1), "pedestrians": (0, 3),
          "distance_to_leading": (0.5, 10), "speed_difference_percent": (-50, 80),
          "random_lanechange_percent": (0, 100), "max_accel": (0.5, 6),
          "max_decel": (1, 9), "max_lateral_accel": (1, 8)}


def validate_params(params):
    """Validate the public traffic table, before consuming random numbers."""
    if not isinstance(params, dict):
        raise ValueError("traffic must be a table")  # noqa: TRY004 - public contract
    unknown = params.keys() - TRAFFIC_DEFAULTS.keys()
    if unknown:
        raise ValueError(f"Unknown traffic keys: {sorted(unknown)}")
    result = {**TRAFFIC_DEFAULTS, **params}
    for key, (lo, hi) in RANGES.items():
        value = result[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not lo <= value <= hi:
            raise ValueError(f"traffic.{key} must be in [{lo}, {hi}]")
    if result["preset"] not in ("default", "vn"):
        raise ValueError("traffic.preset must be default or vn")
    if result["mode"] not in ("replay", "generated"):
        raise ValueError("traffic.mode must be replay or generated")
    if type(result["keep_parked"]) is not bool:
        raise ValueError("traffic.keep_parked must be bool")
    if type(result["seed"]) is not int:
        raise ValueError("traffic.seed must be int")
    return result


def _distance(actor):
    """Net displacement (max distance from the median position), immune to GT box jitter.

    Summed path length is not: scene-0061's parked truck jitters 1.24 m in total while
    never moving more than 0.39 m from its spot.
    """
    points = np.asarray([k["center"] for k in actor["keys"]], dtype=float).reshape(-1, 3)
    if not len(points):
        return 0.0
    return float(np.linalg.norm(points[:, :2] - np.median(points[:, :2], axis=0), axis=1).max())


def _road(layout, scene_dir=None):
    root = Path(__file__).resolve().parents[2] / "data" / "sim"
    directory = Path(scene_dir) if scene_dir is not None else root / layout["scene"]
    if scene_dir is None and not directory.resolve().is_relative_to(root.resolve()):
        raise ValueError("Invalid traffic scene directory")
    relative = Path(layout["ground"]["drivable"])
    path = directory / relative
    if relative.is_absolute() or not path.resolve().is_relative_to(directory.resolve()):
        raise ValueError("ground.drivable must be relative to the scene directory")
    image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError(f"Cannot read ground.drivable: {path}")
    return image


def _on_road(layout, image, points):
    points = np.asarray(points).reshape(-1, 3)
    b = layout["bounds"]
    u = np.floor((points[:, 0] - b["xmin"]) / layout["ground"].get("tex_res_m", 0.1)).astype(int)
    v = np.floor((b["ymax"] - points[:, 1]) / layout["ground"].get("tex_res_m", 0.1)).astype(int)
    valid = (u >= 0) & (v >= 0) & (u < image.shape[1]) & (v < image.shape[0])
    result = np.zeros(len(points), bool)
    result[valid] = image[v[valid], u[valid]] > 0
    return result


def _rectangle(center, yaw, size):
    axes = np.array([[np.cos(yaw), np.sin(yaw)], [-np.sin(yaw), np.cos(yaw)]])
    corners = np.array([[1, 1], [1, -1], [-1, -1], [-1, 1]]) * np.asarray(size[:2]) / 2
    return np.asarray(center[:2]) + corners @ axes, axes


def _box_distance(a, b):
    """Exact convex rectangle distance; SAT for overlap, vertex/edge distances otherwise."""
    ca, aa = _rectangle(*a[:3])
    cb, ab = _rectangle(*b[:3])
    axes = np.vstack((aa, ab))
    pa, pb = ca @ axes.T, cb @ axes.T
    if np.all((pa.max(0) > pb.min(0)) & (pb.max(0) > pa.min(0))):
        return -1.0
    distances = []
    for points, polygon in ((ca, cb), (cb, ca)):
        edges = np.roll(polygon, -1, axis=0) - polygon
        delta = points[:, None, :] - polygon
        t = np.clip(np.sum(delta * edges, axis=2) / np.sum(edges * edges, axis=1), 0, 1)
        distances.append(np.linalg.norm(delta - t[..., None] * edges, axis=2).min())
    return float(min(distances))


def _vehicle_records(actors):
    records = {}
    for actor in actors:
        if actor["label"] in VEHICLES:
            for key in actor["keys"]:
                records.setdefault(key["frame"], []).append(
                    (key["center"], key["yaw"], actor["size"],
                     str(actor["track"]).startswith("gen:")))
    return records


def _ego(frame):
    transform = np.asarray(frame["T_world_lidar"])
    return transform[:3, 3], np.arctan2(transform[1, 0], transform[0, 0]), [4.0, 1.8, 1.5]


def motion_metrics(layout, actors):
    """Finite differences on actual timestamps for moving or generated vehicles.

    Recorded parked boxes retain annotation jitter; it is not simulated motion.
    Acceleration is decomposed in the vehicle's measured travel direction.
    """
    timestamps = {f["index"]: f["timestamp_us"] / 1e6 for f in layout["frames"]}
    result = {"max_long_accel": 0.0, "max_lat_accel": 0.0, "max_jerk": 0.0}
    for actor in actors:
        if actor["label"] not in VEHICLES:
            continue
        if not str(actor["track"]).startswith("gen:") and _distance(actor) < 1:
            continue
        keys = actor["keys"]
        if len(keys) < 3:
            continue
        times = np.array([timestamps[k["frame"]] for k in keys])
        dt = np.diff(times)
        if (dt <= 0).any():
            raise ValueError("Traffic keyframe timestamps must increase")
        points = np.array([k["center"][:2] for k in keys])
        velocity = np.diff(points, axis=0) / dt[:, None]
        vt = (times[:-1] + times[1:]) / 2
        acceleration = np.diff(velocity, axis=0) / np.diff(vt)[:, None]
        tangent = (velocity[:-1] + velocity[1:]) / 2
        tangent /= np.maximum(np.linalg.norm(tangent, axis=1, keepdims=True), 1e-9)
        long = np.sum(acceleration * tangent, axis=1)
        lat = acceleration[:, 0] * tangent[:, 1] - acceleration[:, 1] * tangent[:, 0]
        result["max_long_accel"] = max(result["max_long_accel"], float(np.abs(long).max()))
        result["max_lat_accel"] = max(result["max_lat_accel"], float(np.abs(lat).max()))
        if len(acceleration) > 1:
            at = (vt[:-1] + vt[1:]) / 2
            jerk = np.diff(acceleration, axis=0) / np.diff(at)[:, None]
            result["max_jerk"] = max(result["max_jerk"], float(np.linalg.norm(jerk, axis=1).max()))
    return result


def check_traffic(layout: dict, actors: list[dict]) -> dict:
    """Count unsafe vehicle keyframes and report the fraction of centers outside the road."""
    road = _road(layout)
    records = _vehicle_records(actors)
    overlaps = ego_conflicts = offroad = total = 0
    for frame in layout["frames"]:
        boxes = records.get(frame["index"], [])
        ego = _ego(frame)
        for index, box in enumerate(boxes):
            ego_conflicts += bool(box[3]) and _box_distance(box, ego) < 1.0
            for other in boxes[:index]:
                # Broad phase avoids SAT for distant vehicles.
                radius = (np.linalg.norm(box[2][:2]) + np.linalg.norm(other[2][:2])) / 2
                if np.linalg.norm(np.asarray(box[0][:2]) - other[0][:2]) <= radius:
                    overlaps += _box_distance(box, other) < 0
        generated = [box for box in boxes if box[3]]
        if generated:
            offroad += int((~_on_road(layout, road, [box[0] for box in generated])).sum())
            total += len(generated)
    return {"overlaps": int(overlaps), "ego_conflicts": int(ego_conflicts),
            "off_road_ratio": offroad / total if total else 0.0,
            "moving_vehicles": sum(a["label"] in VEHICLES and _distance(a) >= 1 for a in actors),
            **motion_metrics(layout, actors)}


@dataclass
class _Path:
    points: np.ndarray
    distance: np.ndarray
    yaw: np.ndarray
    speed: float
    family: int
    offset: float

    def sample(self, distance):
        center = np.array([np.interp(distance, self.distance, self.points[:, i]) for i in range(3)])
        return center, float(np.interp(distance, self.distance, self.yaw))


def _paths(layout, road):
    timestamps = {f["index"]: f["timestamp_us"] / 1e6 for f in layout["frames"]}
    sources = []
    for actor in layout["actors"]:
        if actor["label"] in VEHICLES and _distance(actor) >= 5:
            sources.append((np.asarray([k["center"] for k in actor["keys"]]),
                            np.asarray([timestamps[k["frame"]] for k in actor["keys"]])))
    sources.append((np.asarray([np.asarray(f["T_world_lidar"])[:3, 3] for f in layout["frames"]]),
                    np.asarray([timestamps[f["index"]] for f in layout["frames"]])))
    result = []
    for family, (points, times) in enumerate(sources):
        step = np.linalg.norm(np.diff(points[:, :2], axis=0), axis=1)
        valid = np.r_[True, step > 1e-4]
        if valid.sum() < 2:
            continue
        speeds = step / np.maximum(np.diff(times), 1e-6)
        speed = float(np.median(speeds))
        points = gaussian_filter1d(points[valid].astype(float), 0.7, axis=0, mode="nearest")
        distance = np.r_[0, np.cumsum(np.linalg.norm(np.diff(points[:, :2], axis=0), axis=1))]
        if distance[-1] < 0.5:
            continue
        # Endpoint spacing is <= 0.5 m; all interior samples have exactly 0.5 m spacing.
        samples = np.r_[np.arange(0, distance[-1], 0.5), distance[-1]]
        points = np.array([np.interp(samples, distance, points[:, i]) for i in range(3)]).T
        tangent = np.gradient(points[:, :2], axis=0)
        yaw = np.unwrap(np.arctan2(tangent[:, 1], tangent[:, 0]))
        normal = np.c_[-np.sin(yaw), np.cos(yaw), np.zeros(len(yaw))]
        for offset in (0.0, -3.5, 3.5):
            shifted = points + offset * normal
            if offset and _on_road(layout, road, shifted).mean() < 0.9:
                continue
            result.append(_Path(shifted, samples, yaw, max(speed, 0.1), family, offset))
    return result


def _safe_actor(layout, road, actor, occupied, frames, minimum_gap=0.0):
    if not actor["keys"]:
        return False
    if _on_road(layout, road, [k["center"] for k in actor["keys"]]).mean() < 0.95:
        return False
    for key in actor["keys"]:
        box = key["center"], key["yaw"], actor["size"]
        if _box_distance(box, _ego(frames[key["frame"]])) < 1.0:
            return False
        for other in occupied.get(key["frame"], []):
            radius = (np.linalg.norm(box[2][:2]) + np.linalg.norm(other[2][:2])) / 2
            if (np.linalg.norm(np.asarray(box[0][:2]) - other[0][:2]) <= radius + minimum_gap
                    and _box_distance(box, other) < minimum_gap):
                return False
    return True


def bicycle_step(center, yaw, speed, steering, dt, wheelbase, max_lateral_accel):
    """Rear-axle kinematic bicycle, exact constant-steering arc over one step."""
    limit = min(np.radians(35), np.arctan(max_lateral_accel * wheelbase / max(speed**2, 1e-9)))
    steering = float(np.clip(steering, -limit, limit))
    rate = speed * np.tan(steering) / wheelbase
    angle = yaw + rate * dt
    result = np.array(center, dtype=float, copy=True)
    if abs(rate) < 1e-9:
        result[:2] += speed * dt * np.array([np.cos(yaw), np.sin(yaw)])
    else:
        result[:2] += speed / rate * np.array([np.sin(angle) - np.sin(yaw),
                                               np.cos(yaw) - np.cos(angle)])
    return result, angle


def generate_traffic(layout: dict, params: dict, *, scene_dir: Path | None = None) -> list[dict]:
    """Return actors in layout schema. Replay returns the original actor list unchanged."""
    params = validate_params(params)
    if params["mode"] == "replay":
        for actor in layout["actors"]:
            actor.setdefault("origin", "recorded")
        return layout["actors"]
    vn = params["preset"] == "vn"
    rng = np.random.default_rng(params["seed"] % (1 << 64))
    road = _road(layout, scene_dir)
    frames = {f["index"]: f for f in layout["frames"]}
    actors = [a for a in layout["actors"] if a["label"] not in VEHICLES | {"pedestrian"}]
    occupied = {}
    if params["keep_parked"]:
        for actor in layout["actors"]:
            # Real parked vehicles are kept as recorded (curbside ones may sit off the
            # drivable raster); only generated vehicles must satisfy the road rule.
            if actor["label"] in VEHICLES and _distance(actor) < 1:
                actors.append(actor)
                for key in actor["keys"]:
                    occupied.setdefault(key["frame"], []).append(
                        (key["center"], key["yaw"], actor["size"]))
    paths = _paths(layout, road)
    moving = [a for a in layout["actors"] if a["label"] in VEHICLES and _distance(a) >= 1]
    count = round(params["density"] * len(moving) * (3 if vn else 1))
    classes = rng.choice(list(VN_CLASS_MIX), count, p=list(VN_CLASS_MIX.values())) if vn else []
    completed_slots = set()
    times = np.array([f["timestamp_us"] for f in layout["frames"]], dtype=float) / 1e6
    times -= times[0]
    history = []
    for index in range(count * 20 if paths and moving else 0):
        if len(history) >= count:
            break
        if vn and index // 20 in completed_slots:
            continue
        path = paths[int(rng.integers(len(paths)))]
        template = moving[int(rng.integers(len(moving)))]
        ground_z = template["keys"][0]["center"][2] - template["size"][2] / 2
        lateral = amplitude = 0.0
        wavelength = 30.0
        if vn:
            label = str(classes[index // 20])
            w, length, height = VN_SIZES[label]
            size = np.array([length, w, height]) * rng.uniform(0.92, 1.08, 3)
            template = {"label": label, "size": size.tolist(), "keys": template["keys"]}
            if label in ("motorcycle", "bicycle"):
                lateral = float(rng.uniform(-1.4, 1.4))
                amplitude = float(rng.uniform(0, 0.8))
                wavelength = float(rng.uniform(20, 40))
        s = float(rng.uniform(0, path.distance[-1]))
        speed = target = path.speed * params["speed_scale"] * rng.uniform(
            1 - params["speed_jitter"], 1 + params["speed_jitter"]) * (1 - params["speed_difference_percent"] / 100)
        parallels = [p for p in paths if p.family == path.family and abs(p.offset - path.offset) == 3.5]
        destination = parallels[int(rng.integers(len(parallels)))] if parallels else None
        change = destination is not None and rng.random() < max(params["lane_change_rate"], params["random_lanechange_percent"] / 100)
        start = float(rng.uniform(0, max(0.1, times[-1] / 2)))
        # Quintic lane shift: max acceleration = 5.774 * width / duration².
        duration = max(3 - 1.5 * params["aggressiveness"],
                       np.sqrt(5.774 * 3.5 / params["max_lateral_accel"]) * 1.2)
        headway = 1.5 - 0.9 * params["aggressiveness"]
        two_wheeler = vn and template["label"] in ("motorcycle", "bicycle")
        following_gap = 1.0 if vn and template["label"] == "motorcycle" else params["distance_to_leading"]
        if vn and template["label"] == "motorcycle":
            headway = 0.8
        keys, samples, lateral_samples = [], [], []
        clock = 0.0
        blend = 0.0
        pose, heading = path.sample(s)
        if two_wheeler:
            pose += lateral * np.array([-np.sin(heading), np.cos(heading), 0])
        for frame, time in zip(layout["frames"], times, strict=True):
            while clock < time - 1e-8:
                dt = min(0.1, time - clock)
                gap = np.inf
                leader_speed = speed
                for record in history:
                    old_path, old_samples, old_size = record[:3]
                    overlap = abs(old_path.offset - path.offset) < 0.1
                    if vn and template["label"] == "motorcycle":
                        old_lateral = np.interp(clock, times[:len(old_samples)], record[3])
                        path_center, path_yaw = path.sample(s)
                        normal = np.array([-np.sin(path_yaw), np.cos(path_yaw)])
                        current_lateral = float(np.dot(pose[:2] - path_center[:2], normal))
                        overlap = (abs(old_path.offset + old_lateral - path.offset - current_lateral)
                                   < (template["size"][1] + old_size[1]) / 2 + 0.3)
                    if old_path.family == path.family and overlap:
                        position = np.interp(clock, times[:len(old_samples)], old_samples)
                        clearance = position - s - (template["size"][0] + old_size[0]) / 2
                        if 0 < clearance < gap:
                            gap = clearance
                            leader_speed = old_path.speed
                desired_gap = following_gap + max(0, speed * headway + speed * (speed - leader_speed) / 4)
                acceleration = 2 * (1 - (speed / max(target, 0.1)) ** 4 - (desired_gap / gap) ** 2)
                speed = max(0.0, speed + np.clip(acceleration, -params["max_decel"], params["max_accel"]) * dt)
                s += speed * dt
                clock += dt
                if change and clock >= start:
                    # Target-lane clearance is checked during the entire lateral transition.
                    safe = True
                    for record in history:
                        old_path, old_samples, old_size = record[:3]
                        if old_path.family == path.family and old_path.offset == destination.offset:
                            position = np.interp(clock, times[:len(old_samples)], old_samples)
                            safe &= abs(position - s) > (template["size"][0] + old_size[0]) / 2 + params["distance_to_leading"] + speed * headway
                    if safe:
                        blend = min(1.0, blend + dt / duration)
                # The path is a steering target; actual positions follow bicycle dynamics.
                lookahead = max(2.0, speed * 0.8)
                goal, _ = path.sample(min(s + lookahead, path.distance[-1]))
                if change:
                    other, _ = destination.sample(min(s + lookahead, path.distance[-1]))
                    goal += blend ** 3 * (10 - 15 * blend + 6 * blend ** 2) * (other - goal)
                if two_wheeler:
                    _, goal_yaw = path.sample(min(s + lookahead, path.distance[-1]))
                    offset = lateral + amplitude * np.sin(2 * np.pi * s / wavelength)
                    goal += offset * np.array([-np.sin(goal_yaw), np.cos(goal_yaw), 0])
                delta = goal[:2] - pose[:2]
                bearing = np.arctan2(delta[1], delta[0]) - heading
                steering = np.arctan2(2 * 0.6 * template["size"][0] * np.sin(bearing),
                                     max(np.linalg.norm(delta), 0.1))
                pose, heading = bicycle_step(pose, heading, speed, steering, dt,
                                             0.6 * template["size"][0], params["max_lateral_accel"])
            if s >= path.distance[-1]:
                break
            center, yaw = pose.copy(), heading
            center[2] = template["keys"][0]["center"][2]
            if vn:
                center[2] = ground_z + template["size"][2] / 2
            keys.append({"frame": frame["index"], "center": center.tolist(), "yaw": yaw})
            samples.append(s)
            if vn:
                path_center, path_yaw = path.sample(s)
                lateral_samples.append(float(np.dot(pose[:2] - path_center[:2],
                                                      [-np.sin(path_yaw), np.cos(path_yaw)])))
        actor = {"track": f"gen:{params['seed']}:{index}", "origin": "generated", "label": template["label"],
                 "size": list(template["size"]), "keys": keys}
        if vn:
            actor["rider"] = two_wheeler
        metrics = motion_metrics(layout, [actor])
        physical = (metrics["max_long_accel"] <= min(params["max_accel"], params["max_decel"])
                    and metrics["max_lat_accel"] <= params["max_lateral_accel"])
        if len(keys) > 1:
            dt = np.diff([frames[k["frame"]]["timestamp_us"] / 1e6 for k in keys])
            distance = np.linalg.norm(np.diff([k["center"][:2] for k in keys], axis=0), axis=1)
            dyaw = np.diff(np.unwrap([k["yaw"] for k in keys]))
            steering = np.arctan(0.6 * actor["size"][0] * dyaw / np.maximum(distance, 1e-9))
            physical &= bool((np.abs(steering) <= np.radians(35)).all() and (dt > 0).all())
        if (_distance(actor) >= 1 and physical
                and (not vn or _on_road(layout, road, [k["center"] for k in keys]).all())
                and _safe_actor(layout, road, actor, occupied, frames, 0.001 if two_wheeler else params["distance_to_leading"])):
            actors.append(actor)
            history.append((path, samples, template["size"], lateral_samples) if vn else (path, samples, template["size"]))
            if vn:
                completed_slots.add(index // 20)
            for key in keys:
                occupied.setdefault(key["frame"], []).append((key["center"], key["yaw"], actor["size"]))
    pedestrians = [a for a in layout["actors"] if a["label"] == "pedestrian"]
    for index in range(round(params["pedestrians"] * len(pedestrians))):
        if index < len(pedestrians):
            actors.append(pedestrians[index])
        else:
            actor = deepcopy(pedestrians[int(rng.integers(len(pedestrians)))])
            actor["track"] = f"gen:{params['seed']}:{count + index}"
            actor["origin"] = "generated"
            angle, shift = rng.uniform(-np.pi, np.pi), rng.uniform(0.5, 1.5)
            for key in actor["keys"]:
                key["center"][0] += shift * np.cos(angle)
                key["center"][1] += shift * np.sin(angle)
            actors.append(actor)
    for actor in actors:
        actor.setdefault("origin", "recorded")
    return actors
