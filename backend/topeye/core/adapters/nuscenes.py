"""Read nuScenes JSON and binary files without the nuScenes devkit."""

import json
import logging
from collections import defaultdict
from pathlib import Path

import numpy as np

from topeye.core.adapters.base import DatasetError
from topeye.core.geometry import quaternion_to_matrix, transform_matrix
from topeye.core.types import CameraCalib, FrameInfo, GTBox3D

logger = logging.getLogger(__name__)

NUSC_DETECTION_MAP = {
    "human.pedestrian.adult": "pedestrian",
    "human.pedestrian.child": "pedestrian",
    "human.pedestrian.construction_worker": "pedestrian",
    "human.pedestrian.police_officer": "pedestrian",
    "vehicle.car": "car",
    "vehicle.truck": "truck",
    "vehicle.bus.bendy": "bus",
    "vehicle.bus.rigid": "bus",
    "vehicle.construction": "construction_vehicle",
    "vehicle.motorcycle": "motorcycle",
    "vehicle.bicycle": "bicycle",
    "vehicle.trailer": "trailer",
    "movable_object.barrier": "barrier",
    "movable_object.trafficcone": "traffic_cone",
}


class NuScenesAdapter:
    def __init__(self, root: str | Path, version: str = "v1.0-mini"):
        self.root = Path(root).expanduser().resolve()
        self.version = version
        self.tables = {}
        try:
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
            ):
                path = self._path(f"{version}/{name}.json")
                rows = json.loads(path.read_text())
                self.tables[name] = {row["token"]: row for row in rows}
                if len(self.tables[name]) != len(rows):
                    raise ValueError(f"Duplicate token in {name}")
            self._scenes = {row["name"]: row for row in self.tables["scene"].values()}
            self._samples = defaultdict(list)
            for row in self.tables["sample"].values():
                self._samples[row["scene_token"]].append(row)
            for rows in self._samples.values():
                rows.sort(key=lambda row: row["timestamp"])
            self._data = defaultdict(lambda: defaultdict(list))
            self._key_data = defaultdict(dict)
            for row in self.tables["sample_data"].values():
                calib = self.tables["calibrated_sensor"][row["calibrated_sensor_token"]]
                sensor = self.tables["sensor"][calib["sensor_token"]]
                channel = sensor["channel"]
                scene = self.tables["sample"][row["sample_token"]]["scene_token"]
                self._data[scene][channel].append(row)
                if row["is_key_frame"]:
                    self._key_data[row["sample_token"]][channel] = row
            for channels in self._data.values():
                for rows in channels.values():
                    rows.sort(key=lambda row: row["timestamp"])
            self._annotations = defaultdict(list)
            for row in self.tables["sample_annotation"].values():
                self._annotations[row["sample_token"]].append(row)
            self._frame_lidars = {}
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise DatasetError(f"Cannot read nuScenes dataset at {self.root}: {exc}") from exc

    def _path(self, filename: str) -> Path:
        path = (self.root / filename).resolve()
        if not path.is_relative_to(self.root):
            raise DatasetError(f"Dataset path escapes root: {filename}")
        return path

    def scenes(self) -> list[str]:
        return sorted(self._scenes)

    def _scene(self, scene):
        try:
            record = self._scenes[scene]
            samples = self._samples[record["token"]]
            first_lidar = self._key_data[samples[0]["token"]]["LIDAR_TOP"]
            origin = self.tables["ego_pose"][first_lidar["ego_pose_token"]]["translation"]
            return record, samples, np.asarray(origin, dtype=np.float64)
        except (KeyError, IndexError) as exc:
            raise DatasetError(f"Unknown or incomplete scene: {scene}") from exc

    def scene_origin(self, scene: str) -> np.ndarray:
        """Global translation subtracted to form the scene's world frame."""
        return self._scene(scene)[2].copy()

    def scene_map(self, scene: str) -> tuple[str, Path] | None:
        """(location, semantic_prior raster path) or None when the map is unavailable."""
        record = self._scene(scene)[0]
        try:
            version_dir = self._path(f"{self.version}")
            logs = {row["token"]: row for row in json.loads((version_dir / "log.json").read_text())}
            location = logs[record["log_token"]]["location"]
            for row in json.loads((version_dir / "map.json").read_text()):
                if record["log_token"] in row["log_tokens"]:
                    path = self._path(row["filename"])
                    return (location, path) if path.is_file() else None
        except (OSError, ValueError, KeyError, TypeError) as exc:
            logger.warning("No map for %s: %s", scene, exc)
        return None

    def _global_sensor(self, data):
        calib = self.tables["calibrated_sensor"][data["calibrated_sensor_token"]]
        pose = self.tables["ego_pose"][data["ego_pose_token"]]
        return transform_matrix(pose["translation"], pose["rotation"]) @ transform_matrix(
            calib["translation"], calib["rotation"]
        )

    def _frame(self, scene, index, frame_id, lidar, cameras, origin):
        try:
            global_lidar = self._global_sensor(lidar)
            world_lidar = global_lidar.copy()
            world_lidar[:3, 3] -= origin
            camera_info = {}
            for name, data in cameras.items():
                if not name.startswith("CAM_"):
                    continue
                path = self._path(data["filename"])
                if not path.is_file():
                    logger.warning("Missing camera image %s: %s", frame_id, path)
                    continue
                calib = self.tables["calibrated_sensor"][data["calibrated_sensor_token"]]
                global_cam = self._global_sensor(data)
                world_cam = global_cam.copy()
                world_cam[:3, 3] -= origin
                camera_info[name] = (
                    path,
                    data["timestamp"],
                    CameraCalib(
                        name,
                        np.asarray(calib["camera_intrinsic"], dtype=np.float64),
                        np.linalg.inv(global_cam) @ global_lidar,
                        data["width"],
                        data["height"],
                    ),
                    world_cam,
                )
            frame = FrameInfo(
                frame_id,
                scene,
                index,
                self._path(lidar["filename"]),
                lidar["timestamp"],
                world_lidar,
                camera_info,
            )
            self._frame_lidars[frame_id] = lidar
            return frame
        except (KeyError, ValueError, TypeError) as exc:
            raise DatasetError(f"Invalid frame {frame_id}: {exc}") from exc

    def frames(self, scene: str) -> list[FrameInfo]:
        _, samples, origin = self._scene(scene)
        result = []
        for index, sample in enumerate(samples):
            data = self._key_data[sample["token"]]
            if "LIDAR_TOP" not in data:
                raise DatasetError(f"Missing LIDAR_TOP metadata: {sample['token']}")
            result.append(
                self._frame(scene, index, f"{scene}_{index:06d}", data["LIDAR_TOP"], data, origin)
            )
        return result

    def sweep_frames(self, scene: str) -> list[FrameInfo]:
        """All LiDAR sweeps, with closest available camera timestamp per channel."""
        record, _, origin = self._scene(scene)
        keyframes = {f.lidar_ts_us: f for f in self.frames(scene)}
        channels = self._data[record["token"]]
        result = []
        for index, lidar in enumerate(channels["LIDAR_TOP"]):
            timestamp = lidar["timestamp"]
            if timestamp in keyframes:
                result.append(keyframes[timestamp])
                continue
            cameras = {
                name: min(rows, key=lambda row: abs(row["timestamp"] - timestamp))
                for name, rows in channels.items()
                if name.startswith("CAM_") and rows
            }
            result.append(
                self._frame(scene, index, f"{scene}_sweep_{timestamp}", lidar, cameras, origin)
            )
        return result

    def load_points(self, frame: FrameInfo) -> np.ndarray:
        try:
            path = self._path(str(frame.lidar_path))
            if path.stat().st_size % 20:
                raise ValueError("LiDAR binary must contain five float32 values per point")
            raw = np.fromfile(path, dtype="<f4")
            if raw.size % 5:
                raise ValueError("LiDAR binary must contain five float32 values per point")
            points = raw.reshape(-1, 5)[:, :4].copy()
            if not np.isfinite(points).all():
                raise ValueError("LiDAR contains non-finite values")
            return points
        except (OSError, ValueError) as exc:
            raise DatasetError(f"Cannot load LiDAR {frame.frame_id}: {exc}") from exc

    def gt_boxes(self, frame: FrameInfo) -> list[GTBox3D] | None:
        return self._boxes(frame, all_categories=False)

    def mask_boxes(self, frame: FrameInfo) -> list[GTBox3D] | None:
        """All annotations, including classes excluded from the detection API."""
        return self._boxes(frame, all_categories=True)

    def _boxes(self, frame, all_categories):
        try:
            lidar = self._frame_lidars[frame.frame_id]
            if not lidar["is_key_frame"]:
                return None
            lidar_global = np.linalg.inv(self._global_sensor(lidar))
            result = []
            for annotation in self._annotations[lidar["sample_token"]]:
                instance = self.tables["instance"][annotation["instance_token"]]
                category = self.tables["category"][instance["category_token"]]["name"]
                label = NUSC_DETECTION_MAP.get(category, category if all_categories else None)
                if label is None:
                    continue
                center = lidar_global[:3, :3] @ annotation["translation"] + lidar_global[:3, 3]
                rotation = lidar_global[:3, :3] @ quaternion_to_matrix(annotation["rotation"])
                yaw = float(np.arctan2(rotation[1, 0], rotation[0, 0]))
                if yaw <= -np.pi:
                    yaw = float(np.pi)
                w, length, h = annotation["size"]
                result.append(
                    GTBox3D(
                        *map(float, center), float(length), float(w), float(h), yaw, label,
                        annotation_token=annotation["token"],
                        instance_token=annotation["instance_token"],
                    )
                )
            return result
        except (KeyError, ValueError, TypeError) as exc:
            raise DatasetError(f"Cannot load GT for {frame.frame_id}: {exc}") from exc
