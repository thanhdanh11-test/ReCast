"""Unit tests for recognition evaluation module (backend/eval/recognize.py).

Tests class mapping, IoU calculation, label parsing, detection matching,
and metric computation using synthetic/mock data without requiring neural network models.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure backend/eval is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from recognize import (
    BoxEvalRecord,
    Detection,
    LabelBox,
    box_iou,
    compute_metrics,
    load_yolo_labels,
    map_topeye_class,
    match_box_to_detections,
)


def test_class_mapping_standard_classes():
    """Verify standard topeye classes correctly map to COCO classes."""
    assert map_topeye_class("car") == "car"
    assert map_topeye_class("truck") == "truck"
    assert map_topeye_class("trailer") == "truck"
    assert map_topeye_class("construction_vehicle") == "truck"
    assert map_topeye_class("bus") == "bus"
    assert map_topeye_class("pedestrian") == "person"
    assert map_topeye_class("motorcycle") == "motorcycle"
    assert map_topeye_class("bicycle") == "bicycle"


def test_class_mapping_ignored_and_unknown():
    """Verify barrier, traffic_cone, and unknown classes are ignored (return None)."""
    assert map_topeye_class("barrier") is None
    assert map_topeye_class("traffic_cone") is None
    assert map_topeye_class("unknown_object") is None
    assert map_topeye_class("") is None


def test_box_iou_identical():
    """Identical bounding boxes must have IoU = 1.0."""
    box = (10.0, 20.0, 50.0, 60.0)
    assert pytest.approx(box_iou(box, box), abs=1e-6) == 1.0


def test_box_iou_disjoint():
    """Completely separated boxes must have IoU = 0.0."""
    box_a = (0.0, 0.0, 10.0, 10.0)
    box_b = (20.0, 20.0, 30.0, 30.0)
    assert box_iou(box_a, box_b) == 0.0


def test_box_iou_adjacent():
    """Boxes touching along an edge have intersection area 0, hence IoU = 0.0."""
    box_a = (0.0, 0.0, 10.0, 10.0)
    box_b = (10.0, 0.0, 20.0, 10.0)
    assert box_iou(box_a, box_b) == 0.0


def test_box_iou_overlap_known_fraction():
    """Calculate IoU for a known overlapping geometry."""
    # Box A: 100x100 at (0, 0) -> area = 10000
    # Box B: 100x100 at (50, 0) -> area = 10000
    # Intersection: 50x100 -> area = 5000
    # Union: 10000 + 10000 - 5000 = 15000
    # IoU: 5000 / 15000 = 1/3 ~ 0.333333
    box_a = (0.0, 0.0, 100.0, 100.0)
    box_b = (50.0, 0.0, 150.0, 100.0)
    expected = 5000.0 / 15000.0
    assert pytest.approx(box_iou(box_a, box_b), abs=1e-5) == expected


def test_box_iou_contained():
    """Box B completely inside Box A."""
    box_a = (0.0, 0.0, 100.0, 100.0)  # Area = 10000
    box_b = (25.0, 25.0, 75.0, 75.0)  # Area = 2500
    # Intersection = 2500, Union = 10000
    expected = 2500.0 / 10000.0  # 0.25
    assert pytest.approx(box_iou(box_a, box_b), abs=1e-5) == expected


def test_box_iou_degenerate():
    """Zero-area boxes must return 0.0 without divide-by-zero error."""
    box_a = (0.0, 0.0, 0.0, 0.0)
    box_b = (10.0, 10.0, 20.0, 20.0)
    assert box_iou(box_a, box_b) == 0.0
    assert box_iou(box_a, box_a) == 0.0


def test_load_yolo_labels(tmp_path):
    """Test loading and converting YOLO normalized labels to pixel boxes."""
    classes = [
        "car",
        "truck",
        "bus",
        "trailer",
        "construction_vehicle",
        "pedestrian",
        "motorcycle",
        "bicycle",
        "barrier",
        "traffic_cone",
    ]
    labels_content = (
        "0 0.5 0.5 0.2 0.4\n"  # car (cx=0.5, cy=0.5, w=0.2, h=0.4)
        "8 0.1 0.1 0.1 0.1\n"  # barrier (ignored)
        "9 0.2 0.2 0.1 0.1\n"  # traffic_cone (ignored)
        "5 0.8 0.6 0.1 0.2\n"  # pedestrian -> person
    )
    labels_file = tmp_path / "000000.txt"
    labels_file.write_text(labels_content)

    img_w, img_h = 1000, 500
    boxes = load_yolo_labels(labels_file, classes, img_w, img_h)

    # barrier and traffic_cone are ignored, so exactly 2 boxes should remain
    assert len(boxes) == 2

    # Check first box (car)
    car_box = boxes[0]
    assert car_box.topeye_cls == "car"
    assert car_box.coco_cls == "car"
    # cx=500, cy=250, w=200, h=200 -> x1=400, y1=150, x2=600, y2=350
    assert car_box.x1 == pytest.approx(400.0)
    assert car_box.y1 == pytest.approx(150.0)
    assert car_box.x2 == pytest.approx(600.0)
    assert car_box.y2 == pytest.approx(350.0)

    # Check second box (pedestrian)
    ped_box = boxes[1]
    assert ped_box.topeye_cls == "pedestrian"
    assert ped_box.coco_cls == "person"
    # cx=800, cy=300, w=100, h=100 -> x1=750, y1=250, x2=850, y2=350
    assert ped_box.x1 == pytest.approx(750.0)
    assert ped_box.y1 == pytest.approx(250.0)
    assert ped_box.x2 == pytest.approx(850.0)
    assert ped_box.y2 == pytest.approx(350.0)


def test_match_box_to_detections():
    """Verify detection matching respects both class name and IoU threshold."""
    label = LabelBox(
        cls_id=0,
        topeye_cls="car",
        coco_cls="car",
        cx=0.5,
        cy=0.5,
        w=0.2,
        h=0.2,
        x1=400.0,
        y1=400.0,
        x2=600.0,
        y2=600.0,
    )

    # 1. Matching class, high IoU (0.8) -> MATCH
    det_match = Detection(coco_cls="car", score=0.95, x1=410.0, y1=410.0, x2=610.0, y2=610.0)
    matched, score, iou = match_box_to_detections(label, [det_match], iou_thresh=0.5)
    assert matched is True
    assert score == 0.95
    assert iou is not None and iou >= 0.5

    # 2. Wrong class, identical box -> NO MATCH
    det_wrong_class = Detection(
        coco_cls="truck", score=0.99, x1=400.0, y1=400.0, x2=600.0, y2=600.0
    )
    matched, score, iou = match_box_to_detections(label, [det_wrong_class], iou_thresh=0.5)
    assert matched is False
    assert score is None
    assert iou is None

    # 3. Matching class, low IoU (< 0.5) -> NO MATCH
    # Shifted so overlap is < 0.5
    det_low_iou = Detection(coco_cls="car", score=0.90, x1=550.0, y1=400.0, x2=750.0, y2=600.0)
    matched, score, iou = match_box_to_detections(label, [det_low_iou], iou_thresh=0.5)
    assert matched is False

    # 4. Empty detections -> NO MATCH
    matched, score, iou = match_box_to_detections(label, [], iou_thresh=0.5)
    assert matched is False


def test_compute_metrics():
    """Test metric computation on synthetic BoxEvalRecords."""
    records = [
        # Car 1: recognized on both real and render
        BoxEvalRecord(
            camera="CAM_FRONT",
            frame=0,
            topeye_cls="car",
            coco_cls="car",
            bbox_xyxy=(0, 0, 10, 10),
            recognized_real=True,
            recognized_render=True,
        ),
        # Car 2: recognized on real, missed on render
        BoxEvalRecord(
            camera="CAM_FRONT",
            frame=0,
            topeye_cls="car",
            coco_cls="car",
            bbox_xyxy=(10, 10, 20, 20),
            recognized_real=True,
            recognized_render=False,
        ),
        # Pedestrian 1: missed on real, recognized on render
        BoxEvalRecord(
            camera="CAM_FRONT",
            frame=0,
            topeye_cls="pedestrian",
            coco_cls="person",
            bbox_xyxy=(20, 20, 30, 30),
            recognized_real=False,
            recognized_render=True,
        ),
        # Pedestrian 2: missed on both
        BoxEvalRecord(
            camera="CAM_FRONT",
            frame=0,
            topeye_cls="pedestrian",
            coco_cls="person",
            bbox_xyxy=(30, 30, 40, 40),
            recognized_real=False,
            recognized_render=False,
        ),
    ]

    metrics = compute_metrics(records)
    summary = metrics["summary"]
    by_class = metrics["by_class"]

    # Overall:
    # Total = 4
    # Real = 2 (Car 1, Car 2) -> recall_real = 2/4 = 0.5
    # Render = 2 (Car 1, Pedestrian 1) -> recall_render = 2/4 = 0.5
    # Both = 1 (Car 1) -> recognizability = 1/2 = 0.5
    assert summary["total_boxes"] == 4
    assert summary["real_recognized"] == 2
    assert summary["render_recognized"] == 2
    assert summary["both_recognized"] == 1
    assert summary["recall_real"] == 0.5
    assert summary["recall_render"] == 0.5
    assert summary["recognizability"] == 0.5

    # By class: car
    car_stat = by_class["car"]
    assert car_stat["total_boxes"] == 2
    assert car_stat["real_recognized"] == 2
    assert car_stat["render_recognized"] == 1
    assert car_stat["both_recognized"] == 1
    assert car_stat["recall_real"] == 1.0
    assert car_stat["recall_render"] == 0.5
    assert car_stat["recognizability"] == 0.5

    # By class: pedestrian
    ped_stat = by_class["pedestrian"]
    assert ped_stat["total_boxes"] == 2
    assert ped_stat["real_recognized"] == 0
    assert ped_stat["render_recognized"] == 1
    assert ped_stat["both_recognized"] == 0
    assert ped_stat["recall_real"] == 0.0
    assert ped_stat["recall_render"] == 0.5
    # Since real_recognized is 0, recognizability is 0.0 (safe division)
    assert ped_stat["recognizability"] == 0.0


def test_compute_metrics_empty():
    """Verify compute_metrics handles empty records cleanly."""
    metrics = compute_metrics([])
    assert metrics["summary"]["total_boxes"] == 0
    assert metrics["summary"]["recall_real"] == 0.0
    assert metrics["summary"]["recall_render"] == 0.0
    assert metrics["summary"]["recognizability"] == 0.0
    assert metrics["by_class"] == {}
