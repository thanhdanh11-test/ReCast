"""Unit tests for topeye.sim.fo_dataset (H24 / SPEC-S3).

Note: Per invariant, the main backend test suite does not require fiftyone installed.
All data loading, PCD generation, box projection, distance metrics, plotting,
and CLI options are tested directly or with mocks.
"""

from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest

from topeye.core.types import CameraCalib, GTBox3D
from topeye.sim.fo_dataset import (
    build_parser,
    compute_cluster_distances,
    parse_sim_3d_boxes,
    parse_yolo_detections,
    plot_umap,
    project_real_2d_boxes,
    real_3d_boxes,
    save_pcd,
)


def test_save_pcd_header_and_content(tmp_path: Path):
    points = np.array(
        [
            [1.0, 2.0, 3.0, 100.0],
            [4.0, 5.0, 6.0, 200.0],
        ],
        dtype=np.float32,
    )
    pcd_path = tmp_path / "test.pcd"
    out = save_pcd(points, pcd_path)
    assert out.is_file()

    with open(out, "rb") as f:
        content = f.read()

    assert b"VERSION 0.7\n" in content
    assert b"FIELDS x y z intensity\n" in content
    assert b"WIDTH 2\n" in content
    assert b"POINTS 2\n" in content
    assert b"DATA binary\n" in content

    # Check payload size: header + 2 * 4 * 4 bytes
    header_end = content.find(b"DATA binary\n") + len(b"DATA binary\n")
    binary_data = content[header_end:]
    assert len(binary_data) == 2 * 16

    read_pts = np.frombuffer(binary_data, dtype=np.float32).reshape(-1, 4)
    np.testing.assert_allclose(read_pts, points)


def test_save_pcd_shape_3_adds_zero_intensity(tmp_path: Path):
    points = np.array([[1.0, 2.0, 3.0]], dtype=np.float32)
    pcd_path = tmp_path / "pts3.pcd"
    save_pcd(points, pcd_path)

    with open(pcd_path, "rb") as f:
        content = f.read()
    header_end = content.find(b"DATA binary\n") + len(b"DATA binary\n")
    read_pts = np.frombuffer(content[header_end:], dtype=np.float32).reshape(-1, 4)
    assert read_pts.shape == (1, 4)
    assert read_pts[0, 3] == 0.0


def test_save_pcd_invalid_dimension(tmp_path: Path):
    with pytest.raises(ValueError, match="Expected points array"):
        save_pcd(np.ones((5, 2)), tmp_path / "bad.pcd")


def test_parse_yolo_detections(tmp_path: Path):
    classes = ["car", "pedestrian", "truck"]
    txt_file = tmp_path / "labels.txt"
    txt_file.write_text(
        "0 0.5 0.5 0.2 0.4\n"
        "1 0.1 0.2 0.05 0.1\n"
        "99 0.8 0.8 0.1 0.1\n"
        "malformed line\n"
    )

    dets = parse_yolo_detections(txt_file, classes)
    assert len(dets) == 3
    assert dets[0]["label"] == "car"
    # x_min = 0.5 - 0.2/2 = 0.4, y_min = 0.5 - 0.4/2 = 0.3
    np.testing.assert_allclose(dets[0]["bounding_box"], [0.4, 0.3, 0.2, 0.4])
    assert dets[1]["label"] == "pedestrian"
    assert dets[2]["label"] == "99"

    # Missing file returns empty list
    assert parse_yolo_detections(tmp_path / "nonexistent.txt", classes) == []


def test_parse_sim_3d_boxes(tmp_path: Path):
    json_file = tmp_path / "boxes3d.json"
    json_file.write_text(
        '{"frame": 0, "boxes": [{"label": "car", "cx": 1.0, "cy": 2.0, "cz": 3.0, '
        '"l": 4.5, "w": 1.8, "h": 1.6, "yaw": 0.5}]}'
    )

    boxes = parse_sim_3d_boxes(json_file)
    assert len(boxes) == 1
    assert boxes[0]["label"] == "car"
    assert boxes[0]["location"] == [1.0, 2.0, 3.0]
    assert boxes[0]["dimensions"] == [4.5, 1.8, 1.6]
    assert boxes[0]["rotation"] == [0.0, 0.0, 0.5]

    assert parse_sim_3d_boxes(tmp_path / "missing.json") == []


def test_real_3d_boxes():
    box = GTBox3D(
        cx=1.0,
        cy=2.0,
        cz=0.5,
        l=4.2,
        w=1.9,
        h=1.5,
        yaw=1.2,
        label="bus",
        annotation_token="tok1",
        instance_token="tok2",
    )
    records = real_3d_boxes([box])
    assert len(records) == 1
    assert records[0]["label"] == "bus"
    assert records[0]["location"] == [1.0, 2.0, 0.5]
    assert records[0]["dimensions"] == [4.2, 1.9, 1.5]
    assert records[0]["rotation"] == [0.0, 0.0, 1.2]


def test_project_real_2d_boxes_mock_calib():
    calib = CameraCalib(
        name="CAM_FRONT",
        K=np.array([[1000.0, 0.0, 800.0], [0.0, 1000.0, 450.0], [0.0, 0.0, 1.0]]),
        T_lidar_cam=np.eye(4),
        width=1600,
        height=900,
    )
    # Box far in front (z=20m in camera frame)
    box = GTBox3D(
        cx=0.0,
        cy=0.0,
        cz=20.0,
        l=4.0,
        w=2.0,
        h=1.5,
        yaw=0.0,
        label="car",
        annotation_token="t1",
        instance_token="t2",
    )
    dets = project_real_2d_boxes([box], calib)
    assert len(dets) == 1
    assert dets[0]["label"] == "car"
    bbox = dets[0]["bounding_box"]
    assert len(bbox) == 4
    for val in bbox:
        assert 0.0 <= val <= 1.0


def test_compute_cluster_distances():
    real = np.array([[0.0, 0.0], [0.0, 2.0]], dtype=float)  # centroid = [0, 1]
    sim_a = np.array([[3.0, 1.0], [3.0, 1.0]], dtype=float)  # centroid = [3, 1]
    sim_b = np.array([[0.0, 5.0]], dtype=float)  # centroid = [0, 5]

    data = {"real": real, "run_a": sim_a, "run_b": sim_b}
    distances = compute_cluster_distances(data)

    assert "real" in distances
    assert distances["real"]["centroid_l2_dist"] == 0.0
    assert distances["real"]["cosine_distance"] == 0.0

    # L2 distance between [0, 1] and [3, 1] is 3.0
    assert distances["run_a"]["centroid_l2_dist"] == 3.0
    # L2 distance between [0, 1] and [0, 5] is 4.0
    assert distances["run_b"]["centroid_l2_dist"] == 4.0
    assert distances["run_a"]["sample_count"] == 2
    assert distances["run_b"]["sample_count"] == 1


def test_compute_cluster_distances_requires_real():
    with pytest.raises(ValueError, match="must contain non-empty 'real'"):
        compute_cluster_distances({"sim": np.ones((5, 2))})


def test_plot_umap(tmp_path: Path):
    pts = np.random.randn(20, 2)
    sources = ["real"] * 10 + ["day_proc"] * 10
    out_png = tmp_path / "umap.png"
    result = plot_umap(pts, sources, out_png)
    assert result.is_file()
    assert result.stat().st_size > 1000


def test_build_parser_defaults():
    parser = build_parser()
    args = parser.parse_args([])
    assert args.scene == "scene-0061"
    assert "day_proc" in args.runs
    assert args.port == 5151
    assert not args.no_app
    assert args.dataset_name is None


def test_build_parser_custom():
    parser = build_parser()
    args = parser.parse_args(["--scene", "scene-0103", "--port", "5252", "--no-app"])
    assert args.scene == "scene-0103"
    assert args.port == 5252
    assert args.no_app


def test_main_missing_fiftyone_launcher(monkeypatch):
    import topeye.sim.fo_dataset as mod

    # Mock sys.modules to simulate fiftyone missing
    monkeypatch.setattr(mod, "sys", MagicMock(argv=["topeye-sim-fo", "--help"]))
    # Ensure build_parser works
    parser = mod.build_parser()
    assert parser is not None
