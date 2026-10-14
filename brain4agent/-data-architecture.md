# Master Data Architecture & Flow

Tài liệu thiết kế về cấu trúc dữ liệu, cơ chế lưu trữ bền vững (Persistence Layer) và luồng luân chuyển dữ liệu đa tầng.

## 0. Scenario Studio — lưu trữ (desktop v0.4.0 → web localhost 0.15.0)

0.15.0: Electron main thay bằng `frontend/server/local-server.mjs` (127.0.0.1, token mỗi lần chạy) ↔ cùng Python worker JSONL stdio. Settings/log vẫn ở `~/Library/Application Support/Topeye/`; workspace/bundle/run/import layout không đổi. Map context xuất = trình duyệt tải về; `.xosc` nạp bằng upload (≤2 MiB) thay vì đọc đường dẫn.

Nguồn nuScenes chỉ đọc → extractor giữ instance/timestamp, đổi global về origin ego chung → Scenario schema1 → XOSC/XODR/reference/manifest → esmini thực chạy → timestampedposes/report → biến thể có reference riêng. Không dùng tọa độ GTBox3D trong LIDAR như tọa độ world; ego_pose không phải sensor_pose.
Lưu project ở workspace người dùng chọn, không ở dataset; settings/log dưới userData của app. Hoàn tất bundle/run bằng manifest atomic ghi cuối, giữ provenance/hash/engineversion. Electron main ↔ Python worker bằng private stdioJSONL, không mở cổng mạng. Preview GUI không được dùng làm bằng chứng replay. Run lưu thêm engine-info.json (ABI/box centers) và report.json (clearance hộp 2D lấy mẫu). Recovery chỉ sửa marker thuộc project xác thực, bỏ qua malformed JSON, symlink và dataset lồng trong workspace. Contract: [01-CONTRACTS](../planning/04_2026-10-09_scenario-desktop/specs/01-CONTRACTS.md).
Source pipelineBlender/cũ vẫn giữ; generatedoutputs vàtools đãchuyển sangmacOSTrash2026-10-09. Trongbackend/data chỉcòn layout.json vàground_drivable.png của scene0061 đểtesthồiquy. Các mô tảoutput dưới làlịch sử, không còn tồn tạiởpathcũ. DatasetnuScenesgốc ngoàiworkspace không đổi.

## 1. Các Tầng Lưu Trữ (Data Persistence Stores)
- **Input (chỉ đọc):** nuScenes v1.0-mini tại `~/cvat-day2/tools/traffic_pipeline/data/nuscenes`:
  - JSON metadata, LiDAR `.pcd.bin`, ảnh 6 camera.
  - Raster `maps/*.png` (`semantic_prior`, 0,1 m/px, vùng đi được).
  - Chưa có map expansion (vector làn).
- **Bố cục sim:** `backend/data/sim/<scene>/` (gitignore) gồm `layout.json`, `ground.ply`, `static.ply`, `ground_paint.png`, `ground_drivable.png`. Run lưu thêm engine-info.json (ABI/box centers) và report.json (clearance hộp 2D lấy mẫu). Recovery chỉ sửa marker thuộc project xác thực, bỏ qua malformed JSON, symlink và dataset lồng trong workspace. Contract: [01-CONTRACTS](../planning/02_2026-10-05_blender-real2sim/specs/01-CONTRACTS.md).
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

Viewport3D đọc cùng Scenario/Replay; không đổi schema/IPC/backend. Trước replay dùng reference, sau replay dùng observed theo id/time, maxgap0.075s. WorldXYZ→Three(X,Z,-Y); transforms/camera không ghi ngược vào dữ liệu. Timeline actual dừng tại last common engine sample; không ngoại suy dưới nhãn ESMINI.

## Source scene v0.5.0
`sourceScene` IPC → private worker → raw annotation/ego poses + bundled map expansion + masked keyframe LiDAR → ephemeral display payload. Coordinates share the first ego origin; static structures are estimates. No source payload is admitted to export/replay cache or written to dataset. Missing LiDAR produces warnings/complete=false while preserving actors/map.


## Map-bound import v0.9.0
Source snapshot + app-owned map context → validate restricted XOSC → atomic import package → isolated esmini normalized trajectory → measured center poses → 3D/map/LiDAR shared timeline. Imported storage separate from nuScenes bundles; original XML immutable, normalized XML hashed and replayed; geometric-center/reference-point trajectories separate. Map ID hashes geometry/frame/limits with cross-language numeric normalization. Reopen revalidates against fresh map and rebinds dataset_root from app adapter, never trusts stored path. Source data and visual environment preserved; estimated building collision hulls separate from renderer geometry. Chatbot not integrated.

## v0.23.0 — Access/catalog storage and AV2
Local userData stores local-account.json (schemaVersion1, username/salt/hash only, 0600), dataset-catalog.json (schemaVersion1, entries), and existing scenario-settings.json. Session tokens remain RAM-only for 8h. Catalog uses inspected canonical dataset roots and SHA256-derived IDs; failed imports preserve settings. Auth must be rechecked after await before writes. AV2 raw Feather/map stays immutable; ArgoverseAdapter builds compatible internal tables in memory. AV2 ego coordinates → city pose once; ns → µs with source timestamp retained. Dataset factory selects nuScenes or AV2, then existing source/LiDAR/runner pipeline. See docs/scenario.md and plan34 SPEC-P03.

### Saved-run deletion0.26.1
New authenticated deleteImportedRun/worker delete_imported_run accepts scenario_id+run_id (32hex). Only selected `<workspace>/<scenario>/runs/<run>` moves by rename into `.trash/run-<scenario>-<run>-<timestamp>` after user confirmation. Import package, siblings and metrics cache remain. Running/missing/linked targets rejected. UI reloads saved history, clears current scenario replay to avoid displaying deleted results; no schema change.
