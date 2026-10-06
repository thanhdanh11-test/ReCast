"""Recognition evaluation gate for real-to-sim pipeline (SPEC-S6 §6).

Evaluates whether simulated camera renders are realistic enough that an
off-the-shelf object detector (Faster R-CNN ResNet-50 FPN v2) can recognize
the same actors (cars, pedestrians, etc.) as in the real reference images.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

# Mapping from topeye classes to COCO categories
TOPEYE_TO_COCO: dict[str, str] = {
    "car": "car",
    "truck": "truck",
    "trailer": "truck",
    "construction_vehicle": "truck",
    "bus": "bus",
    "pedestrian": "person",
    "motorcycle": "motorcycle",
    "bicycle": "bicycle",
}

IGNORED_CLASSES: set[str] = {"barrier", "traffic_cone"}


def map_topeye_class(cls_name: str) -> str | None:
    """Map a topeye dataset class name to its corresponding COCO class name.

    Returns None if the class is ignored or unrecognized.
    """
    if cls_name in IGNORED_CLASSES:
        return None
    return TOPEYE_TO_COCO.get(cls_name)


def box_iou(
    box_a: tuple[float, float, float, float],
    box_b: tuple[float, float, float, float],
) -> float:
    """Calculate Intersection over Union (IoU) of two bounding boxes.

    Boxes are in (x1, y1, x2, y2) format.
    """
    xa1, ya1, xa2, ya2 = box_a
    xb1, yb1, xb2, yb2 = box_b

    inter_x1 = max(xa1, xb1)
    inter_y1 = max(ya1, yb1)
    inter_x2 = min(xa2, xb2)
    inter_y2 = min(ya2, yb2)

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = max(0.0, xa2 - xa1) * max(0.0, ya2 - ya1)
    area_b = max(0.0, xb2 - xb1) * max(0.0, yb2 - yb1)

    union_area = area_a + area_b - inter_area
    if union_area <= 0.0:
        return 0.0
    return inter_area / union_area


@dataclass
class LabelBox:
    """Ground truth bounding box from YOLO labels."""

    cls_id: int
    topeye_cls: str
    coco_cls: str
    cx: float
    cy: float
    w: float
    h: float
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def xyxy(self) -> tuple[float, float, float, float]:
        return (self.x1, self.y1, self.x2, self.y2)


@dataclass
class Detection:
    """Model detection output."""

    coco_cls: str
    score: float
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def xyxy(self) -> tuple[float, float, float, float]:
        return (self.x1, self.y1, self.x2, self.y2)


@dataclass
class BoxEvalRecord:
    """Evaluation outcome for a single ground truth label box."""

    camera: str
    frame: int
    topeye_cls: str
    coco_cls: str
    bbox_xyxy: tuple[float, float, float, float]
    recognized_real: bool
    recognized_render: bool
    real_match_score: float | None = None
    real_match_iou: float | None = None
    render_match_score: float | None = None
    render_match_iou: float | None = None


def parse_classes(classes_path: Path | str) -> list[str]:
    """Parse class names from classes.txt."""
    path = Path(classes_path)
    if not path.is_file():
        raise FileNotFoundError(f"Classes file not found: {path}")
    return [line.strip() for line in path.read_text().splitlines() if line.strip()]


def load_yolo_labels(
    labels_path: Path | str,
    classes: list[str],
    img_width: int,
    img_height: int,
) -> list[LabelBox]:
    """Load and parse YOLO format labels, filtering out ignored classes."""
    path = Path(labels_path)
    if not path.is_file():
        return []

    boxes: list[LabelBox] = []
    for line in path.read_text().splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        try:
            cls_id = int(parts[0])
            cx, cy, w, h = (float(v) for v in parts[1:5])
        except ValueError:
            continue

        if cls_id < 0 or cls_id >= len(classes):
            continue

        topeye_cls = classes[cls_id]
        coco_cls = map_topeye_class(topeye_cls)
        if coco_cls is None:
            continue

        x1 = (cx - w / 2.0) * img_width
        y1 = (cy - h / 2.0) * img_height
        x2 = (cx + w / 2.0) * img_width
        y2 = (cy + h / 2.0) * img_height

        boxes.append(
            LabelBox(
                cls_id=cls_id,
                topeye_cls=topeye_cls,
                coco_cls=coco_cls,
                cx=cx,
                cy=cy,
                w=w,
                h=h,
                x1=x1,
                y1=y1,
                x2=x2,
                y2=y2,
            )
        )
    return boxes


def match_box_to_detections(
    label: LabelBox,
    detections: list[Detection],
    iou_thresh: float = 0.5,
) -> tuple[bool, float | None, float | None]:
    """Determine if a label box is recognized by any detection of matching COCO class."""
    best_iou = -1.0
    best_score = None
    matched = False

    for det in detections:
        if det.coco_cls != label.coco_cls:
            continue
        iou = box_iou(label.xyxy, det.xyxy)
        if iou >= iou_thresh and iou > best_iou:
            best_iou = iou
            best_score = det.score
            matched = True

    return matched, best_score, (best_iou if matched else None)


def compute_metrics(records: list[BoxEvalRecord]) -> dict[str, Any]:
    """Calculate recall_real, recall_render, and recognizability overall and per class."""
    by_class: dict[str, dict[str, Any]] = {}
    classes_seen = sorted({r.topeye_cls for r in records})

    for cls_name in classes_seen:
        cls_records = [r for r in records if r.topeye_cls == cls_name]
        total = len(cls_records)
        real_rec = sum(1 for r in cls_records if r.recognized_real)
        render_rec = sum(1 for r in cls_records if r.recognized_render)
        both_rec = sum(1 for r in cls_records if r.recognized_real and r.recognized_render)

        recall_real = round(real_rec / total, 4) if total > 0 else 0.0
        recall_render = round(render_rec / total, 4) if total > 0 else 0.0
        recognizability = round(both_rec / real_rec, 4) if real_rec > 0 else 0.0

        by_class[cls_name] = {
            "total_boxes": total,
            "real_recognized": real_rec,
            "render_recognized": render_rec,
            "both_recognized": both_rec,
            "recall_real": recall_real,
            "recall_render": recall_render,
            "recognizability": recognizability,
        }

    total_all = len(records)
    real_all = sum(1 for r in records if r.recognized_real)
    render_all = sum(1 for r in records if r.recognized_render)
    both_all = sum(1 for r in records if r.recognized_real and r.recognized_render)

    recall_real_all = round(real_all / total_all, 4) if total_all > 0 else 0.0
    recall_render_all = round(render_all / total_all, 4) if total_all > 0 else 0.0
    recognizability_all = round(both_all / real_all, 4) if real_all > 0 else 0.0

    return {
        "summary": {
            "total_boxes": total_all,
            "real_recognized": real_all,
            "render_recognized": render_all,
            "both_recognized": both_all,
            "recall_real": recall_real_all,
            "recall_render": recall_render_all,
            "recognizability": recognizability_all,
        },
        "by_class": by_class,
    }


class FasterRCNNDetector:
    """Wrapper for Faster R-CNN detection on MPS with CPU fallback."""

    def __init__(self, score_thresh: float = 0.5):
        import torch
        from torchvision.models.detection import (
            FasterRCNN_ResNet50_FPN_V2_Weights,
            fasterrcnn_resnet50_fpn_v2,
        )

        self.score_thresh = score_thresh
        self.device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

        self.weights = FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT
        self.categories = self.weights.meta["categories"]
        self.model = fasterrcnn_resnet50_fpn_v2(weights=self.weights)
        try:
            self.model.to(self.device)
        except Exception:  # noqa: BLE001
            self.device = torch.device("cpu")
            self.model.to(self.device)

        self.model.eval()
        self.transforms = self.weights.transforms()

    def detect(self, img: Image.Image) -> list[Detection]:
        """Run object detection on a PIL Image."""
        import torch

        tensor = self.transforms(img.convert("RGB")).unsqueeze(0).to(self.device)

        try:
            with torch.no_grad():
                preds = self.model(tensor)[0]
        except Exception:  # noqa: BLE001
            # Fallback to CPU if MPS encounters an execution error
            self.device = torch.device("cpu")
            self.model.to(self.device)
            with torch.no_grad():
                preds = self.model(tensor.to(self.device))[0]

        boxes = preds["boxes"].cpu().numpy()
        labels = preds["labels"].cpu().numpy()
        scores = preds["scores"].cpu().numpy()

        detections: list[Detection] = []
        for b, l, s in zip(boxes, labels, scores):
            if s >= self.score_thresh:
                cat_name = self.categories[l] if l < len(self.categories) else f"cls_{l}"
                detections.append(
                    Detection(
                        coco_cls=cat_name,
                        score=float(s),
                        x1=float(b[0]),
                        y1=float(b[1]),
                        x2=float(b[2]),
                        y2=float(b[3]),
                    )
                )
        return detections


def render_overlay(
    real_img: Image.Image,
    render_img: Image.Image,
    labels: list[LabelBox],
    dets_real: list[Detection],
    dets_render: list[Detection],
    records: list[BoxEvalRecord],
    camera_name: str,
    frame_idx: int,
) -> Image.Image:
    """Create a side-by-side comparison image visualizing GT boxes and detections."""
    w, h = real_img.size
    render_resized = render_img.resize((w, h))

    real_draw_img = real_img.copy()
    render_draw_img = render_resized.copy()

    draw_real = ImageDraw.Draw(real_draw_img)
    draw_render = ImageDraw.Draw(render_draw_img)

    font = ImageFont.load_default()

    # Draw detections on real (thin dashed/light blue)
    for det in dets_real:
        draw_real.rectangle([det.x1, det.y1, det.x2, det.y2], outline="#00e5ff", width=2)
        txt = f"{det.coco_cls} {det.score:.2f}"
        draw_real.text((det.x1, max(0.0, det.y1 - 12)), txt, fill="#00e5ff", font=font)

    # Draw detections on render (thin cyan)
    for det in dets_render:
        draw_render.rectangle([det.x1, det.y1, det.x2, det.y2], outline="#00e5ff", width=2)
        txt = f"{det.coco_cls} {det.score:.2f}"
        draw_render.text((det.x1, max(0.0, det.y1 - 12)), txt, fill="#00e5ff", font=font)

    # Draw GT labels with recognition status
    for rec in records:
        bx1, by1, bx2, by2 = rec.bbox_xyxy

        # Real overlay
        color_real = "#00e676" if rec.recognized_real else "#ff9100"  # green if hit, orange if miss
        draw_real.rectangle([bx1, by1, bx2, by2], outline=color_real, width=3)
        tag_real = "HIT" if rec.recognized_real else "MISS"
        txt_real = f"GT: {rec.topeye_cls} [{tag_real}]"
        draw_real.text((bx1, min(h - 15.0, by2 + 2)), txt_real, fill=color_real, font=font)

        # Render overlay
        color_render = "#00e676" if rec.recognized_render else "#ff1744"  # green if hit, red if miss
        draw_render.rectangle([bx1, by1, bx2, by2], outline=color_render, width=3)
        tag_render = "HIT" if rec.recognized_render else "MISS"
        txt_render = f"GT: {rec.topeye_cls} [{tag_render}]"
        draw_render.text((bx1, min(h - 15.0, by2 + 2)), txt_render, fill=color_render, font=font)

    # Header banner
    banner_height = 40
    combined = Image.new("RGB", (w * 2, h + banner_height), color=(20, 20, 20))
    combined.paste(real_draw_img, (0, banner_height))
    combined.paste(render_draw_img, (w, banner_height))

    draw_banner = ImageDraw.Draw(combined)
    rec_real_cnt = sum(1 for r in records if r.recognized_real)
    rec_render_cnt = sum(1 for r in records if r.recognized_render)
    total_cnt = len(records)

    title_left = f"REAL {camera_name} (frame {frame_idx:06d}) | GT: {total_cnt}, Rec: {rec_real_cnt}"
    title_right = f"SIM {camera_name} (frame {frame_idx:06d}) | GT: {total_cnt}, Rec: {rec_render_cnt}"

    draw_banner.text((20, 12), title_left, fill="#ffffff", font=font)
    draw_banner.text((w + 20, 12), title_right, fill="#ffffff", font=font)

    return combined


def print_summary_table(metrics: dict[str, Any], title: str = "RECOGNITION EVALUATION") -> None:
    """Print formatted summary table to stdout."""
    summary = metrics["summary"]
    by_class = metrics["by_class"]

    print("=" * 82)
    print(f" {title}")
    print("=" * 82)
    print(
        f"{'Class':<22} {'Total':>6} {'Real_Rec':>9} {'Rndr_Rec':>9} "
        f"{'Both_Rec':>9} {'Recall_Real':>11} {'Recall_Rndr':>11} {'Recognizability':>16}"
    )
    print("-" * 82)

    for cls_name, stat in by_class.items():
        print(
            f"{cls_name:<22} {stat['total_boxes']:>6} {stat['real_recognized']:>9} "
            f"{stat['render_recognized']:>9} {stat['both_recognized']:>9} "
            f"{stat['recall_real']:>11.3f} {stat['recall_render']:>11.3f} "
            f"{stat['recognizability']:>16.3f}"
        )

    print("-" * 82)
    print(
        f"{'OVERALL':<22} {summary['total_boxes']:>6} {summary['real_recognized']:>9} "
        f"{summary['render_recognized']:>9} {summary['both_recognized']:>9} "
        f"{summary['recall_real']:>11.3f} {summary['recall_render']:>11.3f} "
        f"{summary['recognizability']:>16.3f}"
    )
    print("=" * 82)


def evaluate_manifest_items(
    manifest: list[dict[str, Any]],
    score_thresh: float = 0.5,
    iou_thresh: float = 0.5,
    out_dir: Path | None = None,
    run_name: str | None = None,
) -> dict[str, Any]:
    """Evaluate all items in a manifest."""
    detector = FasterRCNNDetector(score_thresh=score_thresh)

    all_records: list[BoxEvalRecord] = []
    overlays: list[str] = []
    view_details: list[dict[str, Any]] = []

    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)

    for item in manifest:
        real_path = Path(item["real"])
        render_path = Path(item["render"])
        labels_path = Path(item["labels"])
        classes_path = Path(item["classes"])
        camera_name = item.get("camera", "CAM")
        frame_idx = item.get("frame", 0)

        real_img = Image.open(real_path).convert("RGB")
        render_img = Image.open(render_path).convert("RGB")
        w, h = real_img.size

        classes = parse_classes(classes_path)
        labels = load_yolo_labels(labels_path, classes, w, h)

        dets_real = detector.detect(real_img)
        dets_render = detector.detect(render_img)

        item_records: list[BoxEvalRecord] = []
        for lbl in labels:
            hit_real, r_score, r_iou = match_box_to_detections(lbl, dets_real, iou_thresh)
            hit_render, sim_score, sim_iou = match_box_to_detections(lbl, dets_render, iou_thresh)

            rec = BoxEvalRecord(
                camera=camera_name,
                frame=frame_idx,
                topeye_cls=lbl.topeye_cls,
                coco_cls=lbl.coco_cls,
                bbox_xyxy=lbl.xyxy,
                recognized_real=hit_real,
                recognized_render=hit_render,
                real_match_score=r_score,
                real_match_iou=r_iou,
                render_match_score=sim_score,
                render_match_iou=sim_iou,
            )
            item_records.append(rec)
            all_records.append(rec)

        # Generate overlay if out_dir requested
        if out_dir:
            run_prefix = f"{run_name}_" if run_name else ""
            overlay_name = f"overlay_{run_prefix}{camera_name}_{frame_idx:06d}.jpg"
            overlay_path = out_dir / overlay_name
            overlay_img = render_overlay(
                real_img,
                render_img,
                labels,
                dets_real,
                dets_render,
                item_records,
                camera_name,
                frame_idx,
            )
            overlay_img.save(overlay_path, quality=85)
            overlays.append(str(overlay_path.resolve()))

        view_details.append(
            {
                "camera": camera_name,
                "frame": frame_idx,
                "total_boxes": len(item_records),
                "real_recognized": sum(1 for r in item_records if r.recognized_real),
                "render_recognized": sum(1 for r in item_records if r.recognized_render),
                "both_recognized": sum(
                    1 for r in item_records if r.recognized_real and r.recognized_render
                ),
            }
        )

    # If 6 surround cameras were processed, generate a composite overview sheet
    if out_dir and len(manifest) >= 6:
        cam_overlays = {}
        run_prefix = f"{run_name}_" if run_name else ""
        for item in manifest:
            c = item.get("camera")
            f = item.get("frame", 0)
            p = out_dir / f"overlay_{run_prefix}{c}_{f:06d}.jpg"
            if p.is_file():
                cam_overlays[c] = p

        order_top = ["CAM_FRONT_LEFT", "CAM_FRONT", "CAM_FRONT_RIGHT"]
        order_bot = ["CAM_BACK_LEFT", "CAM_BACK", "CAM_BACK_RIGHT"]
        if all(c in cam_overlays for c in order_top + order_bot):
            sheet_rows = []
            for cam_group in (order_top, order_bot):
                imgs = [Image.open(cam_overlays[c]) for c in cam_group]
                # Resize each image to 0.4 scale for compact overview
                imgs_resized = [
                    img.resize((int(img.width * 0.4), int(img.height * 0.4)), Image.Resampling.LANCZOS)
                    for img in imgs
                ]
                row_w = sum(img.width for img in imgs_resized)
                row_h = max(img.height for img in imgs_resized)
                row_img = Image.new("RGB", (row_w, row_h))
                cur_x = 0
                for img in imgs_resized:
                    row_img.paste(img, (cur_x, 0))
                    cur_x += img.width
                sheet_rows.append(row_img)

            full_w = max(r.width for r in sheet_rows)
            full_h = sum(r.height for r in sheet_rows)
            sheet_img = Image.new("RGB", (full_w, full_h))
            cur_y = 0
            for r in sheet_rows:
                sheet_img.paste(r, (0, cur_y))
                cur_y += r.height

            sheet_path = out_dir / f"overlay_{run_prefix}sheet.jpg"
            sheet_img.save(sheet_path, quality=85)
            overlays.append(str(sheet_path.resolve()))

    metrics = compute_metrics(all_records)
    metrics["views"] = view_details
    metrics["overlays"] = overlays
    metrics["records"] = [asdict(r) for r in all_records]
    metrics["score_threshold"] = score_thresh
    metrics["iou_threshold"] = iou_thresh
    metrics["model"] = "torchvision.models.detection.fasterrcnn_resnet50_fpn_v2"
    return metrics


def main():
    parser = argparse.ArgumentParser(description="Recognition gate evaluation.")
    parser.add_argument("--manifest", required=True, type=Path, help="Path to manifest JSON")
    parser.add_argument("--out-json", type=Path, default=None, help="Path to save output JSON")
    parser.add_argument("--out-dir", type=Path, default=None, help="Directory to save overlays")
    parser.add_argument("--run", type=str, default=None, help="Run name (for labeling)")
    parser.add_argument("--score-thresh", type=float, default=0.5, help="Score threshold (0.5)")
    parser.add_argument("--iou-thresh", type=float, default=0.5, help="IoU threshold (0.5)")

    args = parser.parse_args()

    manifest_data = json.loads(args.manifest.read_text())
    run_name = args.run or (manifest_data[0].get("run") if manifest_data else None)

    metrics = evaluate_manifest_items(
        manifest_data,
        score_thresh=args.score_thresh,
        iou_thresh=args.iou_thresh,
        out_dir=args.out_dir,
        run_name=run_name,
    )

    title = f"RECOGNITION EVALUATION: run={run_name or 'unknown'}"
    print_summary_table(metrics, title=title)

    if args.out_json:
        args.out_json.parent.mkdir(parents=True, exist_ok=True)
        # Avoid saving gigantic records array in summary json if not needed, or include everything
        args.out_json.write_text(json.dumps(metrics, indent=2) + "\n")
        print(f"Metrics saved to {args.out_json}")


if __name__ == "__main__":
    main()
