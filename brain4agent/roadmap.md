# Roadmap & Active Tasks

File này chứa danh sách các tính năng, mục tiêu sắp tới và tình trạng công việc hiện tại. Từ 2026-10-05, mục tiêu dự án là **real-to-sim miễn phí bằng Blender** ([kế hoạch 02](../planning/02_2026-10-05_blender-real2sim/plan.md)).

## Mục tiêu hiện tại (Active)
- [ ] **Kế hoạch 02 – POC real-to-sim 1 scene** (`planning/02_2026-10-05_blender-real2sim/`):
  - WP-A, WP-S1, WP-S2, WP-S3 và WP-E đã ✅ (2026-10-06).
  - G-POC: đo bằng máy đã ✅ local, **chờ người dùng duyệt bằng mắt** các ảnh `evidence/s3/compare_*.jpg`.
  - Sau duyệt: bump v2.0.0.
- [ ] **Gate G-sim (đợt sau):** sinh dữ liệu nhiều scene × nhiều preset, train YOLO theo 2 nhánh real vs real+sim, đo trên ảnh thật đêm/mưa (`scene-1077`, `scene-1094`, `scene-1100`). Đạt khi tập đêm tăng ≥ +3 mAP và tập ngày không tụt quá 1 điểm.
- [ ] **Giao thông dày hơn:** `density` đang nhân theo số xe chạy thật trong scene (scene-0061 chỉ có 2 xe), nên mật độ 3 mới ra 6 xe. Cần đổi sang mật độ tuyệt đối (xe/100 m làn).
- [ ] Đưa giờ trong ngày (hướng mặt trời) vào contract scenario và Blender.
- [ ] Pipeline fusion kiểu YOLO-LiDAR-Fusion trên adapter của ta (baseline đo mAP 3D).

## Tương lai (Upcoming)
- [ ] Chạy layout và render cho đủ 10 scene nuScenes-mini, ở tất cả các frame.
- [ ] Dữ liệu thật 8 cam của team: viết adapter mới. Nếu không có map làn thì tự dò làn từ intensity LiDAR.

## 💡 Kho Ý Tưởng & Backlog (Idea Vault)
*Nơi lưu trữ các ý tưởng hay, kiến trúc mở rộng chưa ưu tiên làm ngay nhưng cần giữ lại để tham khảo.*
- [ ] **nuScenes map expansion** (vector làn, miễn phí, cần đăng nhập để tải): dùng cho vạch kẻ chính xác và kịch bản giao thông theo làn.
- [ ] Thư viện xe 3D **CC0** thay cho xe thủ tục low-poly; dùng vật liệu PBR tốt hơn.
- [ ] Bề mặt vật tĩnh: thay voxel 0,2 m bằng Poisson hoặc TSDF (open3d), để bớt dạng khối và giảm `static.ply` (hiện 32 MB).
- [ ] Màu vật tĩnh tối (67/255): chọn màu từ camera nhìn rõ nhất hoặc phân vị cao hơn thay cho trung vị; cân sáng giữa các camera.
- [ ] Tầng trên của nhà (LiDAR chỉ thấy tới khoảng 6 m ở 20 m): đùn khối theo chân tường, hoặc dùng depth từ ảnh.
- [ ] Mưa: vệt mưa trong ảnh và vũng nước phản chiếu. LiDAR: dùng mô hình vật lý (fog sim Hahner 2021, LISA) thay cho mô hình xấp xỉ thống kê.
- [ ] Render bằng Cycles (Metal) cho ảnh thật hơn; domain randomization ánh sáng.
- [ ] 3DGS (DriveStudio/OmniRe) trên **Colab/Kaggle GPU miễn phí** để làm lớp nền xa thật hơn, hiển thị bằng Spark (MIT). Đây là nhánh thử, không thuộc đường chính.
- [ ] Đổi YOLOv8 (AGPL) sang YOLOX/RT-DETR (Apache) nếu cần đóng mã thương mại.
- [ ] Viewer three.js cũ (`frontend/`) dùng để xem output sim: layout, LiDAR mô phỏng, box.
- [x] ~~Web app gán nhãn thay CVAT (kế hoạch 01)~~: dừng 2026-10-05, đổi mục tiêu.
- [x] ~~World Labs Marble API, thuê GPU~~: loại vì trả phí (2026-10-05).
- [x] ~~Bowl view / adaptive bowl~~: đã loại (REVIEW.md).

## Đã hoàn thành (Done)
- [x] **S6–S10 (2026-10-06):** dựng môi trường ≤ 15 phút (784 giây, splat 19,31 dB nhưng mờ); mẫu thư viện xe/người (nhận diện ngày 0,50); tham số chuẩn CARLA; cổng nhận diện. Còn mở: nhận diện ≥ 0,8 (cần mẫu chi tiết hơn); ghép nền splat vào render Blender.
- [x] **S5 web + giao thông + map đẹp (2026-10-06, Codex ×3 qua Orca):** bộ sinh giao thông có seed (0 va chạm), web chỉnh môi trường/giao thông/render, splat Spark 618k, ảnh mặt đường thật 75%. pytest 216.
- [x] **Nâng chất lượng map S4 (2026-10-06, Codex ×2 qua Orca):** đủ 382 sweep, voxel 0,2 m, mặt đất phủ 100% vùng đường, Chamfer 0,242 → 0,173 m.
- [x] **POC real-to-sim scene-0061 (2026-10-06):**
  - Layout 9,2 s; selftest camera 0,00027 px.
  - 4 preset × 6 camera render bằng EEVEE 0,2–0,6 s/ảnh.
  - LiDAR mô phỏng: Chamfer 0,242 m, tỷ lệ điểm 1,17.
  - pytest 108.
  - Còn chờ người dùng duyệt bằng mắt.
- [x] **Kế hoạch 01 (dừng giữa chừng, 2026-10-03 → 10-05):** WP1–7, WP12–15, WP20–21 (viewer, top view, bird view, surround). 3DGS (WP16, WP18/19) thất bại trên Mac.
- [x] **Khởi tạo Bộ Nhớ Não Bộ Chuẩn (v1.0.0):** Thiết lập cấu trúc Đa Tầng brain4agent V5.2 và quy chuẩn quản trị AGENTS.md.
- [x] **Đánh giá khả thi đa agent (2026-10-03):** Claude ×3 (ủng hộ / phản biện / thực dụng), Codex, Gemini (qua `agy`). Kết luận: KHẢ THI CÓ ĐIỀU KIỆN. Chi tiết ở [`REVIEW.md`](../REVIEW.md).
