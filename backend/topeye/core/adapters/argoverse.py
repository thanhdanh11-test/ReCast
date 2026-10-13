"""Native Argoverse 2 Sensor logs; shared scenario tables live in memory only.

Feather point clouds and cuboids are in the ego frame, not either physical LiDAR frame.
See https://argoverse.github.io/user-guide/datasets/sensor.html.
"""

import json
import re
import uuid
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation

from topeye.core.adapters.base import DatasetError
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.geometry import quaternion_to_matrix

LOG_ID = re.compile(r"^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$")
CATEGORY = {
    "REGULAR_VEHICLE": "vehicle.car",
    "LARGE_VEHICLE": "vehicle.truck",
    "TRUCK": "vehicle.truck",
    "TRUCK_CAB": "vehicle.truck",
    "BOX_TRUCK": "vehicle.truck",
    "BUS": "vehicle.bus.rigid",
    "ARTICULATED_BUS": "vehicle.bus.bendy",
    "SCHOOL_BUS": "vehicle.bus.rigid",
    "VEHICULAR_TRAILER": "vehicle.trailer",
    "MOTORCYCLE": "vehicle.motorcycle",
    "BICYCLE": "vehicle.bicycle",
    "PEDESTRIAN": "human.pedestrian.adult",
    "BICYCLIST": "vehicle.bicycle",
    "MOTORCYCLIST": "vehicle.motorcycle",
    "WHEELCHAIR": "human.wheelchair",
    "CONSTRUCTION_CONE": "movable_object.trafficcone",
}


def log_directories(root):
    root = Path(root)
    if LOG_ID.fullmatch(root.name):
        return [root]
    return sorted(p for p in root.iterdir() if p.is_dir() and LOG_ID.fullmatch(p.name))


def _token(*parts):
    return uuid.uuid5(uuid.NAMESPACE_URL, "av2/" + "/".join(map(str, parts))).hex


def _rotation(row):
    q = np.array([row[k] for k in ("qw", "qx", "qy", "qz")], dtype=float)
    quaternion_to_matrix(q)  # Validate before scipy normalizes it.
    return q


def _translation(row):
    t = np.array([row[k] for k in ("tx_m", "ty_m", "tz_m")], dtype=float)
    if not np.isfinite(t).all():
        raise DatasetError("AV2 pose contains non-finite translation")
    return t


def _chain(rows):
    for i, row in enumerate(rows):
        row.update(
            prev=rows[i - 1]["token"] if i else "",
            next=rows[i + 1]["token"] if i + 1 < len(rows) else "",
        )


class ArgoverseAdapter(NuScenesAdapter):
    def __init__(self, root, version="av2-sensor"):
        try:
            from pyarrow import feather
        except ImportError as exc:
            raise DatasetError('AV2 cần pyarrow: pip install -e "backend[av2]"') from exc
        self._feather = feather
        self._maps = {}
        root = Path(root).expanduser().resolve()
        self.root = root
        tables = {
            name: []
            for name in (
                "scene",
                "sample",
                "sample_data",
                "calibrated_sensor",
                "ego_pose",
                "sample_annotation",
                "instance",
                "category",
                "sensor",
            )
        }
        tables["sensor"].append({"token": "av2-lidar", "channel": "LIDAR_TOP", "modality": "lidar"})
        # AV2 publishes motion-compensated point clouds directly in the ego frame.
        tables["calibrated_sensor"].append(
            {
                "token": "av2-ego",
                "sensor_token": "av2-lidar",
                "translation": [0, 0, 0],
                "rotation": [1, 0, 0, 0],
            }
        )
        categories = {}
        try:
            logs = log_directories(root)
            if not logs:
                raise DatasetError("No AV2 Sensor logs found")
            for log in logs:
                self._read_log(log, tables, categories)
            tables["category"] = [
                {
                    "token": token,
                    "name": CATEGORY.get(name, "av2." + name.lower()),
                    "original_category": name,
                }
                for name, token in categories.items()
            ]
            super().__init__(root, version, tables=tables)
        except (OSError, ValueError, KeyError, TypeError, IndexError) as exc:
            raise DatasetError(f"Invalid AV2 Sensor dataset: {exc}") from exc

    def _read_log(self, log, tables, categories):
        scene_token = _token(log.name)
        scene_name = "av2-" + log.name
        maps = sorted(log.glob("map/log_map_archive*.json"))
        if len(maps) != 1:
            raise DatasetError(f"Missing or ambiguous AV2 map: {log.name}")
        map_path = self._path(str(maps[0]))
        map_data = json.loads(map_path.read_text())
        if not map_data.get("lane_segments") or not map_data.get("drivable_areas"):
            raise DatasetError(f"Incomplete AV2 map: {log.name}")
        self._maps[scene_name] = map_path
        pose_rows = self._feather.read_table(
            self._path(str(log / "city_SE3_egovehicle.feather"))
        ).to_pylist()
        poses = {r["timestamp_ns"]: r for r in pose_rows}
        if len(poses) != len(pose_rows):
            raise DatasetError("Duplicate AV2 pose timestamp")
        annotations = self._feather.read_table(
            self._path(str(log / "annotations.feather"))
        ).to_pylist()
        by_time = defaultdict(list)
        for row in annotations:
            by_time[row["timestamp_ns"]].append(row)
        clouds = sorted(log.glob("sensors/lidar/*.feather"), key=lambda p: int(p.stem))
        if len(clouds) < 3 or {int(p.stem) for p in clouds} != set(by_time):
            raise DatasetError(f"AV2 LiDAR/annotation timeline incomplete: {log.name}")
        samples, data, tracks = [], [], defaultdict(list)
        for path in clouds:
            path = self._path(str(path))
            ns = int(path.stem)
            if ns not in poses or not path.stat().st_size:
                raise DatasetError(f"AV2 exact ego pose or cloud missing: {ns}")
            pose = poses[ns]
            q, t = _rotation(pose), _translation(pose)
            matrix = quaternion_to_matrix(q)
            sample_id, pose_id = _token(log.name, ns), _token(log.name, ns, "pose")
            tables["ego_pose"].append(
                {
                    "token": pose_id,
                    "timestamp": ns // 1000,
                    "source_timestamp_ns": ns,
                    "translation": t.tolist(),
                    "rotation": q.tolist(),
                }
            )
            samples.append(
                {
                    "token": sample_id,
                    "scene_token": scene_token,
                    "timestamp": ns // 1000,
                    "source_timestamp_ns": ns,
                }
            )
            data.append(
                {
                    "token": _token(log.name, ns, "lidar"),
                    "sample_token": sample_id,
                    "ego_pose_token": pose_id,
                    "calibrated_sensor_token": "av2-ego",
                    "filename": str(path.relative_to(self.root)),
                    "timestamp": ns // 1000,
                    "is_key_frame": True,
                }
            )
            seen = set()
            for a in by_time[ns]:
                track = _token(log.name, a["track_uuid"])
                if track in seen:
                    raise DatasetError("Duplicate AV2 track at a timestamp")
                seen.add(track)
                category = a["category"]
                categories.setdefault(category, _token(category))
                size = [a[k] for k in ("width_m", "length_m", "height_m")]
                if not np.isfinite(size).all() or min(size) <= 0:
                    raise DatasetError("Invalid AV2 cuboid dimensions")
                rot = (
                    Rotation.from_matrix(matrix @ quaternion_to_matrix(_rotation(a)))
                    .as_quat(scalar_first=True)
                    .tolist()
                )
                annotation = {
                    "token": _token(log.name, ns, track),
                    "sample_token": sample_id,
                    "instance_token": track,
                    "translation": (matrix @ _translation(a) + t).tolist(),
                    "rotation": rot,
                    "size": size,
                    "original_category": category,
                    "attribute_tokens": [],
                    "num_lidar_pts": a["num_interior_pts"],
                }
                tracks[track].append(annotation)
                tables["sample_annotation"].append(annotation)
        _chain(samples)
        _chain(data)
        for track, rows in tracks.items():
            if len({r["original_category"] for r in rows}) != 1:
                raise DatasetError("AV2 track changes category")
            _chain(rows)
            tables["instance"].append(
                {
                    "token": track,
                    "category_token": categories[rows[0]["original_category"]],
                    "first_annotation_token": rows[0]["token"],
                    "last_annotation_token": rows[-1]["token"],
                    "nbr_annotations": len(rows),
                }
            )
        tables["scene"].append(
            {
                "token": scene_token,
                "name": scene_name,
                "description": f"Argoverse 2 Sensor · {log.name}",
                "first_sample_token": samples[0]["token"],
                "last_sample_token": samples[-1]["token"],
                "nbr_samples": len(samples),
            }
        )
        tables["sample"].extend(samples)
        tables["sample_data"].extend(data)

    def load_points(self, frame):
        try:
            data = self._feather.read_table(
                self._path(str(frame.lidar_path)), columns=["x", "y", "z", "intensity"]
            )
            points = np.column_stack([data[k].to_numpy() for k in data.column_names]).astype(
                np.float32
            )
            if not len(points) or not np.isfinite(points).all():
                raise ValueError("Empty or non-finite point cloud")
            return points
        except (OSError, ValueError, KeyError) as exc:
            raise DatasetError(f"Cannot read AV2 LiDAR: {exc}") from exc

    def scene_map(self, scene):
        path = self._maps.get(scene)
        return (scene, path) if path and path.is_file() else None

    def vector_map(self, scene, origin, bounds):
        data = json.loads(self._maps[scene].read_text())
        polygons, lines = [], []
        low, high = np.asarray(bounds[:2]), np.asarray(bounds[2:])

        def coordinates(rows):
            points = np.asarray([[r["x"], r["y"]] for r in rows], dtype=float) - origin[:2]
            if not np.isfinite(points).all():
                raise DatasetError("AV2 map has non-finite coordinates")
            return points

        def visible(points):
            return (
                len(points) >= 2
                and (points.max(axis=0) >= low).all()
                and (points.min(axis=0) <= high).all()
            )

        def polygon(kind, rows):
            points = coordinates(rows)
            if len(points) >= 3 and visible(points):
                polygons.append({"kind": kind, "outer": points.tolist(), "holes": []})

        for area in data["drivable_areas"].values():
            polygon("drivable_area", area["area_boundary"])
        for lane in data["lane_segments"].values():
            left, right = lane["left_lane_boundary"], lane["right_lane_boundary"]
            polygon("lane", left + list(reversed(right)))
            for side in ("left", "right"):
                if lane[f"{side}_lane_mark_type"] in {"NONE", "UNKNOWN"}:
                    continue
                points = coordinates(lane[f"{side}_lane_boundary"])
                if visible(points):
                    lines.append({"kind": "lane_divider", "points": points.tolist()})
        for crossing in data.get("pedestrian_crossings", {}).values():
            polygon("ped_crossing", crossing["edge1"] + list(reversed(crossing["edge2"])))
        return polygons, lines
