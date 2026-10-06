# Master Data Architecture & Flow

Tài liệu thiết kế về cấu trúc dữ liệu, cơ chế lưu trữ bền vững (Persistence Layer) và luồng luân chuyển dữ liệu đa tầng.

## 1. Các Tầng Lưu Trữ (Data Persistence Stores)
- **Input (chỉ đọc):** nuScenes v1.0-mini tại `~/cvat-day2/tools/traffic_pipeline/data/nuscenes`:
  - JSON metadata, LiDAR `.pcd.bin`, ảnh 6 camera.
  - Raster `maps/*.png` (`semantic_prior`, 0,1 m/px, vùng đi được).
  - Chưa có map expansion (vector làn).
- **Bố cục sim:** `backend/data/sim/<scene>/` (gitignore) gồm `layout.json`, `ground.ply`, `static.ply`, `ground_paint.png`, `ground_drivable.png`. Contract: [01-CONTRACTS](../planning/02_2026-10-05_blender-real2sim/specs/01-CONTRACTS.md).
- **Dataset sinh ra:** `backend/data/sim/<scene>/runs/<scenario>/` gồm:
  - `images/<CAM>/*.png`
  - `lidar/*.bin` (5 cột float32 trong hệ LIDAR, giống nuScenes)
  - `labels/yolo/<CAM>/*.txt`, `labels3d/*.json`
  - `visibility/*.json`
  - `run.json` (chỉ ghi sau cùng; có file này nghĩa là run đã hoàn tất)
- **Cũ (kế hoạch 01):** `backend/data/cache/` (cache viewer, `CACHE_VERSION` 10), SQLite nhãn (chưa dùng).

## 2. Schema & Data Flow
```text
nuScenes ─► NuScenesAdapter (core) ─► topeye.sim.layout ─► layout.json + PLY + raster
                                                              │
                     scenario.toml ─► Blender build_scene.py ─┤ (headless, bpy)
                                                              ▼
                         images + lidar.bin + visibility ─► topeye.sim.labels ─► YOLO/3D labels
                                                              ▼
                                         (đợt sau) train YOLO real vs real+sim ─► gate G-sim
```
- **Hệ toạ độ:** `world` = global nuScenes − `origin` (ego ở keyframe đầu), Z hướng lên, đơn vị mét. Blender dùng đúng hệ này.
- **Camera:** OpenCV sang Blender qua `matrix_world = T_world_cam · diag(1, −1, −1, 1)`, `lens = fx·36/W`, `shift_x = (W/2 − cx)/W`, `shift_y = (cy − H/2)/W`.
- **Ranh giới hai tiến trình:** Python 3.12 (`topeye`) ↔ Python 3.13 (Blender) **chỉ qua file**. Script Blender không import `topeye`.
