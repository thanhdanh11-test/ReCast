# Changelog & Semantic Releases

Tất cả các quyết định kiến trúc và lịch sử nâng cấp phiên bản của dự án.

## [Unreleased] - 2026-10-06: Đổi mục tiêu sang Real-to-Sim (dự kiến v2.0.0, MAJOR)
### Decided
- Dự án đổi mục tiêu: từ web app hỗ trợ gán nhãn sang **real-to-sim miễn phí bằng Blender** ("digital cousin"). Kế hoạch 01 ⏸ dừng; kế hoạch 02 `planning/02_2026-10-05_blender-real2sim/`.
- Model đích là kiểu YOLO-LiDAR-Fusion (YOLO 2D được train, phần 3D là hình học).
- Ràng buộc 100% miễn phí: loại World Labs Marble API và thuê GPU. 3DGS chỉ còn là nhánh thử trên Colab/Kaggle miễn phí (Idea Vault).
- Ranh giới `topeye` (Python 3.12) ↔ Blender (bpy, Python 3.13) chỉ qua file; không dùng BlenderProc và compositor pass.
### Added
- `backend/topeye/sim/` gồm `camera.py`, `layout.py`, `labels.py`, `cli.py` (`topeye-sim-layout`, `topeye-sim-render`), `blender/build_scene.py` và 4 scenario (day, night, rain, fog).
- `NuScenesAdapter.scene_origin()` và `scene_map()`; `bev.box_mask(pad=0.3)`; `Config.blender_bin`; `scripts/sim_evidence.py`; `docs/sim.md`.
- S11 pilot procedural (2026-10-07):
  - Môi trường dựng thủ tục theo bố cục LiDAR thật (17 nhà, 305 cây, 78 cột), dùng asset PBR CC0 (Poly Haven, ambientCG); bầu trời camera dùng Sky shader, HDRI chỉ để chiếu sáng.
  - Ngày 6×39 dựng + render 1043 giây.
  - KID 65,3 (voxel 79,8; splat 185,7; mức sàn 27,8); nhận diện 0,54 (xe con 0,39).
- S6–S10 (2026-10-06):
  - Splat train trên Mac (mpsplat; đã chặn lỗi NaN) dừng ở 17,87 dB.
  - `topeye-sim-build` dựng môi trường ≤ 15 phút (đo 784 giây; splat theo đồng hồ, ảnh 12 Hz, mô hình bầu trời; 19,31 dB).
  - Tham số scenario schema 2 chuẩn CARLA (thời tiết, LiDAR dropoff 0,13, xe kinematic).
  - Xe/người dùng mẫu thư viện CC0/CC-BY (25 mẫu), màu thật đo từ ảnh, gắn cờ `appearance: library`.
  - Cổng nhận diện `backend/eval/recognize.py`: ngày xe con 0,50, người 0,50 (cổng 0,8 chưa đạt).
  - POC mesh dán ảnh bị loại (9,1 dB).
- S5: `sim/traffic.py` (giao thông sinh có seed, IDM, chuyển làn, kiểm OBB/ego/đường), `sim/map_photo.py` (splat 3DGS cho Spark, orthophoto mặt đường), web viewer chỉnh môi trường/giao thông/render qua API localhost.
- S4 nâng chất lượng map: `sim/static_map.py` (đủ sweep, box nội suy, voxel 0,2 m, lọc ≥ 3 sweep) và `sim/ground_surface.py` (mặt đất kín vùng đường). PLY chuyển sang nhị phân. Chamfer 0,173 m.
- `topeye-sim-view`: web viewer map 3D (three.js, localhost:8770).
- POC scene-0061: selftest camera 0,00027 px; Chamfer LiDAR 0,242 m; pytest 108; chờ người dùng duyệt bằng mắt.

## [Unreleased] - 2026-10-03: Đánh giá khả thi (bị thay một phần bởi mục 2026-10-06)
### Decided
- **(2026-10-03, thay thế quyết định hướng C bên dưới) Hướng triển khai: APP RIÊNG** — người dùng chốt: không làm trên CVAT, xây app riêng vì sẽ thêm nhiều tính năng khác. Hệ quả chấp nhận: app phải tự lo hiển thị + (nếu có) sửa box/track; quan hệ với CVAT (thay thế hay xuất/nhập) còn chờ chốt.
- Phạm vi app: **web, thay CVAT hoàn toàn**, port tính năng CVAT (MIT) khi cần. Spec: `planning/01_2026-10-03_topeye-web-mvp/`.
### Quyết định bị thay thế
- Kết luận tranh luận đa agent (Claude ×3, Codex, Gemini): **KHẢ THI CÓ ĐIỀU KIỆN** — xem `REVIEW.md`.
- **Hướng triển khai: C — pipeline offline nạp vào CVAT tự host** (PCD/ảnh top view/ảnh có box chiếu sẵn → context image + annotation import). Không fork CVAT, không app riêng ở giai đoạn này; chọn lại A (fork CVAT) / D (Xtreme1) chỉ sau gate A/B. B (app riêng có sửa box) là phương án cuối.
- Loại bowl view; calib & sync checker làm đầu tiên; auto-label đưa lên trước viewer; viewer tương tác chỉ làm sau gate A/B.

## [v1.0.0] - 2026-10-03: Initial Project Scaffolding
### Added
- Khởi tạo kiến trúc dự án và thiết lập hệ thống Bộ Nhớ Não Bộ `brain4agent/` Đa Tầng thế hệ mới.
