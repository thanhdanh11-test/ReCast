"""FiftyOne visualizer and real vs sim dataset evaluation (H24 / SPEC-S3).

Builds a grouped dataset containing 6 surround cameras + LIDAR_TOP (.pcd)
for both real nuScenes data and sim runs, computes local embeddings and UMAP,
calculates domain distances, and persists the dataset locally.
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import cv2
import numpy as np

# Ensure telemetry is completely disabled per invariant
os.environ["FIFTYONE_DO_NOT_TRACK"] = "true"

logger = logging.getLogger(__name__)

CAMERAS = [
    "CAM_FRONT",
    "CAM_FRONT_LEFT",
    "CAM_FRONT_RIGHT",
    "CAM_BACK",
    "CAM_BACK_LEFT",
    "CAM_BACK_RIGHT",
]
ALL_SLICES = CAMERAS + ["LIDAR_TOP"]
DEFAULT_RUNS = ["day_proc", "day_vn", "night_proc", "rain_proc", "day_assets"]


def save_pcd(points: np.ndarray, out_path: Path | str) -> Path:
    """Save point cloud as binary PCD (v0.7). points: Nx3 or Nx4 (x, y, z, intensity)."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if points.ndim != 2 or points.shape[1] < 3:
        raise ValueError(f"Expected points array of shape (N, >=3), got {points.shape}")

    n = len(points)
    if points.shape[1] == 3:
        intensity = np.zeros((n, 1), dtype=np.float32)
        pts4 = np.hstack([points[:, :3].astype(np.float32), intensity])
    else:
        pts4 = points[:, :4].astype(np.float32)

    header = (
        "VERSION 0.7\n"
        "FIELDS x y z intensity\n"
        "SIZE 4 4 4 4\n"
        "TYPE F F F F\n"
        "COUNT 1 1 1 1\n"
        f"WIDTH {n}\n"
        "HEIGHT 1\n"
        "VIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {n}\n"
        "DATA binary\n"
    )
    with open(out_path, "wb") as f:
        f.write(header.encode("ascii"))
        f.write(pts4.tobytes())
    return out_path


def parse_yolo_detections(label_file: Path | str, classes: list[str]) -> list[dict]:
    """Parse YOLO detections text file into bounding box dicts."""
    label_path = Path(label_file)
    if not label_path.is_file():
        return []
    records = []
    for line in label_path.read_text().splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        try:
            cls_id = int(parts[0])
            cx, cy, w, h = map(float, parts[1:5])
        except ValueError:
            continue
        cls_name = classes[cls_id] if 0 <= cls_id < len(classes) else str(cls_id)
        x_min = max(0.0, cx - w / 2.0)
        y_min = max(0.0, cy - h / 2.0)
        box_w = min(1.0 - x_min, w)
        box_h = min(1.0 - y_min, h)
        records.append({
            "label": cls_name,
            "bounding_box": [float(x_min), float(y_min), float(box_w), float(box_h)],
        })
    return records


def parse_sim_3d_boxes(label3d_file: Path | str) -> list[dict]:
    """Parse sim 3D detections json file into 3D box dicts."""
    label_path = Path(label3d_file)
    if not label_path.is_file():
        return []
    try:
        data = json.loads(label_path.read_text())
        boxes = data.get("boxes", [])
    except (json.JSONDecodeError, OSError):
        return []
    records = []
    for b in boxes:
        records.append({
            "label": str(b.get("label", "unknown")),
            "location": [float(b["cx"]), float(b["cy"]), float(b["cz"])],
            "dimensions": [float(b["l"]), float(b["w"]), float(b["h"])],
            "rotation": [0.0, 0.0, float(b["yaw"])],
        })
    return records


def project_real_2d_boxes(boxes: list, calib) -> list[dict]:
    """Project real 3D GT boxes into camera view to create 2D detections."""
    from topeye.core.bev import box_mask

    records = []
    for box in boxes:
        mask = box_mask([box], calib, pad=0.0)
        if not mask.any():
            continue
        x, y, w, h = cv2.boundingRect(mask)
        if w < 4 or h < 4:
            continue
        x_min = max(0.0, x / float(calib.width))
        y_min = max(0.0, y / float(calib.height))
        box_w = min(1.0 - x_min, w / float(calib.width))
        box_h = min(1.0 - y_min, h / float(calib.height))
        records.append({
            "label": box.label,
            "bounding_box": [float(x_min), float(y_min), float(box_w), float(box_h)],
        })
    return records


def real_3d_boxes(boxes: list) -> list[dict]:
    """Convert NuScenes GTBox3D list into 3D box dicts."""
    records = []
    for b in boxes:
        records.append({
            "label": b.label,
            "location": [float(b.cx), float(b.cy), float(b.cz)],
            "dimensions": [float(b.l), float(b.w), float(b.h)],
            "rotation": [0.0, 0.0, float(b.yaw)],
        })
    return records


def compute_cluster_distances(
    embeddings_by_source: dict[str, np.ndarray],
) -> dict[str, dict[str, float]]:
    """Compute centroid L2 distance, cosine distance, and average sample distance to real."""
    if "real" not in embeddings_by_source or len(embeddings_by_source["real"]) == 0:
        raise ValueError("Embeddings must contain non-empty 'real' source")

    real_embs = embeddings_by_source["real"]
    real_centroid = np.mean(real_embs, axis=0)
    real_norm = np.linalg.norm(real_centroid) + 1e-12

    distances = {}
    for source, embs in embeddings_by_source.items():
        if len(embs) == 0:
            continue
        centroid = np.mean(embs, axis=0)
        c_norm = np.linalg.norm(centroid) + 1e-12
        l2_dist = float(np.linalg.norm(centroid - real_centroid))
        cos_sim = float(np.dot(centroid, real_centroid) / (c_norm * real_norm))
        cos_dist = float(1.0 - cos_sim)
        sample_dists = np.linalg.norm(embs - real_centroid, axis=1)
        avg_sample_dist = float(np.mean(sample_dists))

        distances[source] = {
            "centroid_l2_dist": round(l2_dist, 4),
            "cosine_distance": round(cos_dist, 4),
            "avg_sample_l2_dist": round(avg_sample_dist, 4),
            "sample_count": len(embs),
        }
    return distances


def plot_umap(
    points_2d: np.ndarray,
    sources: list[str],
    out_file: Path | str,
    title: str = "FiftyOne UMAP Real vs Sim Domain Embeddings",
) -> Path:
    """Plot 2D UMAP scatter colored by source and save as PNG."""
    out_file = Path(out_file)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    try:
        import matplotlib.pyplot as plt

        unique_sources = sorted(set(sources))
        colors = plt.cm.tab10(np.linspace(0, 1, max(10, len(unique_sources))))

        fig, ax = plt.subplots(figsize=(10, 8), dpi=150)
        for idx, src in enumerate(unique_sources):
            mask = [s == src for s in sources]
            pts = points_2d[mask]
            marker = "o" if src == "real" else "^"
            size = 60 if src == "real" else 45
            alpha = 0.85 if src == "real" else 0.75
            ax.scatter(
                pts[:, 0],
                pts[:, 1],
                label=src,
                color=colors[idx],
                marker=marker,
                s=size,
                alpha=alpha,
                edgecolors="k",
                linewidths=0.5,
            )

        ax.set_title(title, fontsize=14, fontweight="bold", pad=12)
        ax.set_xlabel("UMAP Dimension 1", fontsize=11)
        ax.set_ylabel("UMAP Dimension 2", fontsize=11)
        ax.grid(True, linestyle="--", alpha=0.5)
        ax.legend(title="Source", bbox_to_anchor=(1.02, 1), loc="upper left", frameon=True)
        plt.tight_layout()
        fig.savefig(out_file, bbox_inches="tight")
        plt.close(fig)
        return out_file
    except ImportError:
        # Fallback to OpenCV renderer when matplotlib is not in the environment
        w, h = 1000, 800
        canvas = np.full((h, w, 3), 255, dtype=np.uint8)
        p_min = points_2d.min(axis=0) if len(points_2d) else np.array([-1.0, -1.0])
        p_max = points_2d.max(axis=0) if len(points_2d) else np.array([1.0, 1.0])
        span = np.maximum(p_max - p_min, 1e-6)

        color_palette = [
            (50, 120, 220),
            (60, 180, 75),
            (230, 25, 75),
            (245, 130, 48),
            (145, 30, 180),
            (70, 240, 240),
            (240, 50, 230),
        ]
        unique_sources = sorted(set(sources))
        cv2.putText(canvas, title, (50, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (20, 20, 20), 2)
        for idx, src in enumerate(unique_sources):
            col = color_palette[idx % len(color_palette)]
            mask = [s == src for s in sources]
            pts = points_2d[mask]
            norm_pts = (pts - p_min) / span
            px = (100 + norm_pts[:, 0] * 650).astype(int)
            py = (h - 100 - norm_pts[:, 1] * 600).astype(int)
            for x, y in zip(px, py, strict=False):
                cv2.circle(canvas, (int(x), int(y)), 5, col, -1)
            cv2.putText(
                canvas,
                src,
                (780, 100 + idx * 28),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                col,
                2,
            )
        cv2.imwrite(str(out_file), canvas)
        return out_file


def build_fo_dataset(
    scene: str,
    runs: list[str],
    dataset_name: str,
    config_path: Path | str,
    cache_dir: Path | str,
    evidence_dir: Path | str | None = None,
):
    """Build persistent grouped dataset in FiftyOne, compute embeddings & UMAP."""
    import fiftyone as fo
    import fiftyone.brain as fob

    from topeye.config import load_config
    from topeye.core.adapters.nuscenes import NuScenesAdapter
    from topeye.sim.layout import CLASSES

    config = load_config(config_path)
    adapter = NuScenesAdapter(config.nusc_root)
    cache_path = Path(cache_dir).resolve()
    pcd_cache = cache_path / "fo_cache" / "pcd"

    # Reset dataset if exists
    if fo.dataset_exists(dataset_name):
        logger.info("Overwriting existing FiftyOne dataset %s", dataset_name)
        fo.delete_dataset(dataset_name)

    dataset = fo.Dataset(dataset_name, persistent=True)
    dataset.add_group_field("group", default="CAM_FRONT")

    samples_to_add = []
    front_image_paths = []
    front_sources = []

    # 1. Real nuScenes keyframes
    logger.info("Processing real nuScenes keyframes for scene %s...", scene)
    real_frames = adapter.frames(scene)
    for frame in real_frames:
        group = fo.Group()
        idx = frame.index
        # LiDAR PCD
        pts = adapter.load_points(frame)
        pcd_file = pcd_cache / "real" / f"{idx:06d}.pcd"
        save_pcd(pts, pcd_file)

        gt_3d = real_3d_boxes(adapter.gt_boxes(frame) or [])
        d3d = [
            fo.Detection(
                label=b["label"],
                location=b["location"],
                dimensions=b["dimensions"],
                rotation=b["rotation"],
            )
            for b in gt_3d
        ]
        s_lidar = fo.Sample(
            filepath=str(pcd_file.resolve()),
            group=group.element("LIDAR_TOP"),
            source="real",
            frame=idx,
            scene=scene,
            ground_truth=fo.Detections(detections=d3d),
        )
        samples_to_add.append(s_lidar)

        # 6 Cameras
        gt_boxes = adapter.gt_boxes(frame) or []
        for cam_name in CAMERAS:
            cam_data = frame.cameras.get(cam_name)
            if not cam_data:
                continue
            img_path, _, calib, _ = cam_data
            d2d_records = project_real_2d_boxes(gt_boxes, calib)
            d2d = [
                fo.Detection(label=r["label"], bounding_box=r["bounding_box"])
                for r in d2d_records
            ]
            s_cam = fo.Sample(
                filepath=str(img_path.resolve()),
                group=group.element(cam_name),
                source="real",
                frame=idx,
                scene=scene,
                ground_truth=fo.Detections(detections=d2d),
            )
            samples_to_add.append(s_cam)
            if cam_name == "CAM_FRONT":
                front_image_paths.append(str(img_path.resolve()))
                front_sources.append("real")

    # 2. Sim runs
    sim_base = cache_path / scene / "runs"
    for run in runs:
        run_dir = sim_base / run
        if not run_dir.is_dir():
            logger.warning("Sim run directory not found: %s", run_dir)
            continue
        classes_path = run_dir / "labels" / "classes.txt"
        classes = classes_path.read_text().splitlines() if classes_path.is_file() else CLASSES

        # Detect frames present in run
        cam_front_dir = run_dir / "images" / "CAM_FRONT"
        if not cam_front_dir.is_dir():
            logger.warning("No CAM_FRONT directory in run %s", run)
            continue
        frame_files = sorted(cam_front_dir.glob("*.png"))
        logger.info("Processing sim run %s with %d frames...", run, len(frame_files))

        for f_path in frame_files:
            try:
                frame_idx = int(f_path.stem)
            except ValueError:
                continue

            group = fo.Group()
            # LiDAR PCD
            bin_path = run_dir / "lidar" / f"{frame_idx:06d}.bin"
            pcd_file = pcd_cache / run / f"{frame_idx:06d}.pcd"
            if bin_path.is_file():
                raw = np.fromfile(bin_path, dtype="<f4")
                pts_sim = raw.reshape(-1, 5)[:, :4] if raw.size % 5 == 0 else raw.reshape(-1, 4)
                save_pcd(pts_sim, pcd_file)
            else:
                pts_sim = np.zeros((0, 4), dtype=np.float32)
                save_pcd(pts_sim, pcd_file)

            boxes_3d = parse_sim_3d_boxes(run_dir / "labels3d" / f"{frame_idx:06d}.json")
            d3d = [
                fo.Detection(
                    label=b["label"],
                    location=b["location"],
                    dimensions=b["dimensions"],
                    rotation=b["rotation"],
                )
                for b in boxes_3d
            ]
            s_lidar = fo.Sample(
                filepath=str(pcd_file.resolve()),
                group=group.element("LIDAR_TOP"),
                source=run,
                frame=frame_idx,
                scene=scene,
                ground_truth=fo.Detections(detections=d3d),
            )
            samples_to_add.append(s_lidar)

            # 6 Cameras
            for cam_name in CAMERAS:
                c_img = run_dir / "images" / cam_name / f"{frame_idx:06d}.png"
                if not c_img.is_file():
                    continue
                yolo_file = run_dir / "labels" / "yolo" / cam_name / f"{frame_idx:06d}.txt"
                yolo_records = parse_yolo_detections(yolo_file, classes)
                d2d = [
                    fo.Detection(label=r["label"], bounding_box=r["bounding_box"])
                    for r in yolo_records
                ]
                s_cam = fo.Sample(
                    filepath=str(c_img.resolve()),
                    group=group.element(cam_name),
                    source=run,
                    frame=frame_idx,
                    scene=scene,
                    ground_truth=fo.Detections(detections=d2d),
                )
                samples_to_add.append(s_cam)
                if cam_name == "CAM_FRONT":
                    front_image_paths.append(str(c_img.resolve()))
                    front_sources.append(run)

    logger.info("Adding %d samples to FiftyOne dataset %s...", len(samples_to_add), dataset_name)
    dataset.add_samples(samples_to_add)

    # 3. Compute Embeddings and UMAP on CAM_FRONT slice
    logger.info("Computing embeddings on CAM_FRONT slice...")
    import fiftyone.zoo as foz
    import umap

    model = foz.load_zoo_model("resnet18-imagenet-torch")
    front_view = dataset.select_group_slices("CAM_FRONT")
    embeddings = front_view.compute_embeddings(model)

    # Compute distances between real centroid and run centroids
    embs_by_source = {}
    for src in sorted(set(front_sources)):
        indices = [i for i, s in enumerate(front_sources) if s == src]
        embs_by_source[src] = embeddings[indices]

    distances = compute_cluster_distances(embs_by_source)
    logger.info("Cluster distances to real: %s", distances)

    # Compute UMAP (n_neighbors scaled to sample count)
    n_samples = len(embeddings)
    n_neighbors = min(15, max(2, n_samples - 1))
    reducer = umap.UMAP(n_neighbors=n_neighbors, min_dist=0.1, random_state=42)
    umap_points = reducer.fit_transform(embeddings)

    # Save visualization to FiftyOne Brain
    try:
        fob.compute_visualization(
            front_view,
            embeddings=embeddings,
            points=umap_points,
            brain_key="umap_source",
            num_dims=2,
        )
    except (RuntimeError, ValueError, TypeError, KeyError, AttributeError, OSError) as exc:
        logger.warning("FiftyOne brain compute_visualization note: %s", exc)

    # Save Evidence artifacts if evidence_dir provided
    if evidence_dir:
        ev_path = Path(evidence_dir).resolve()
        ev_path.mkdir(parents=True, exist_ok=True)

        plot_umap(umap_points, front_sources, ev_path / "umap_source.png")
        (ev_path / "embedding_distances.json").write_text(
            json.dumps(distances, indent=2) + "\n"
        )

        summary = {
            "dataset_name": dataset_name,
            "scene": scene,
            "total_samples": len(dataset),
            "groups_count": len(dataset.values("group")),
            "group_slices": dataset.group_slices,
            "sources": {
                src: int(np.sum([s == src for s in front_sources]))
                for src in sorted(set(front_sources))
            },
            "distances": distances,
        }
        (ev_path / "fo_summary.json").write_text(
            json.dumps(summary, indent=2) + "\n"
        )
        logger.info("Saved evidence artifacts to %s", ev_path)

    return dataset, distances


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="FiftyOne visualizer and dataset inspector for TopEye real vs sim."
    )
    parser.add_argument("--scene", default="scene-0061", help="Scene name (e.g. scene-0061)")
    parser.add_argument(
        "--runs",
        default=",".join(DEFAULT_RUNS),
        help="Comma-separated sim run names to include",
    )
    parser.add_argument("--port", type=int, default=5151, help="FiftyOne web app port (default 5151)")
    parser.add_argument("--config", default="config.toml", help="Path to config.toml")
    parser.add_argument(
        "--data-dir",
        default="data/sim",
        help="Base directory containing sim scenes (default data/sim)",
    )
    parser.add_argument(
        "--evidence-dir",
        default=None,
        help="Directory to save evidence figures and metrics",
    )
    parser.add_argument(
        "--dataset-name",
        default=None,
        help="Custom FiftyOne dataset name (defaults to topeye-<scene>)",
    )
    parser.add_argument(
        "--no-app",
        action="store_true",
        help="Build dataset and compute embeddings without opening interactive UI",
    )
    return parser


def main(argv=None):
    """Entry point for topeye-sim-fo."""
    # If fiftyone is not installed in the current environment, check for .tools/fo/.venv
    try:
        import fiftyone  # noqa: F401
    except ImportError:
        repo_root = Path(__file__).resolve().parents[3]
        fo_venv_python = repo_root / "backend" / ".tools" / "fo" / ".venv" / "bin" / "python"
        if fo_venv_python.is_file():
            os.environ["FIFTYONE_DO_NOT_TRACK"] = "true"
            args = sys.argv[1:] if argv is None else argv
            os.execv(
                str(fo_venv_python),
                [str(fo_venv_python), "-m", "topeye.sim.fo_dataset", *args],
            )
        sys.stderr.write(
            "Error: fiftyone is not installed. Install with `pip install .[fiftyone]` "
            "or set up backend/.tools/fo/.venv\n"
        )
        return 1

    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    runs = [r.strip() for r in args.runs.split(",") if r.strip()]
    ds_name = args.dataset_name or f"topeye-{args.scene}"

    # Default evidence dir if not provided
    if args.evidence_dir:
        evidence_path = Path(args.evidence_dir)
    else:
        repo_root = Path(__file__).resolve().parents[3]
        evidence_path = (
            repo_root / "planning" / "02_2026-10-05_blender-real2sim" / "evidence" / "fo"
        )

    # Locate config
    cfg_file = Path(args.config)
    if not cfg_file.is_file():
        repo_root = Path(__file__).resolve().parents[3]
        cand = repo_root / "backend" / "config.toml"
        if cand.is_file():
            cfg_file = cand

    # Locate data dir
    data_path = Path(args.data_dir)
    if not data_path.is_dir():
        repo_root = Path(__file__).resolve().parents[3]
        cand_data = repo_root / "backend" / "data" / "sim"
        if cand_data.is_dir():
            data_path = cand_data

    logger.info("Building FiftyOne dataset: %s", ds_name)
    import fiftyone as fo

    dataset, distances = build_fo_dataset(
        scene=args.scene,
        runs=runs,
        dataset_name=ds_name,
        config_path=cfg_file,
        cache_dir=data_path,
        evidence_dir=evidence_path,
    )

    print("\n" + "=" * 60)
    print(f"FiftyOne Dataset: {dataset.name}")
    print(f"Total samples: {len(dataset)}")
    print(f"Group slices: {dataset.group_slices}")
    print("=" * 60)
    print("Domain Embedding Distances to Real nuScenes (Centroid):")
    print(f"{'Source':<15} | {'Centroid L2':<12} | {'Cosine Dist':<12} | {'Avg Sample L2':<14} | {'Count':<5}")
    print("-" * 68)
    for src, m in distances.items():
        print(f"{src:<15} | {m['centroid_l2_dist']:<12.4f} | {m['cosine_distance']:<12.4f} | {m['avg_sample_l2_dist']:<14.4f} | {m['sample_count']:<5}")
    print("=" * 60 + "\n")

    if not args.no_app:
        print(f"Launching FiftyOne App at http://localhost:{args.port}...")
        session = fo.launch_app(dataset, port=args.port, auto=False)
        print(f"App is running at {session.url}. Press Ctrl+C to exit.")
        try:
            session.wait()
        except KeyboardInterrupt:
            pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
