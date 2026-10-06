# Giới Thiệu Dự Án (Project Overview)

## 1. Mục tiêu (Goals & Objectives)
- **topeye (từ 2026-10-05) là pipeline real-to-sim miễn phí cho xe tự lái.**
  - Từ một scene thật (LiDAR + 6–8 camera surround + calib + ego pose + box/track), dựng môi trường 3D trong **Blender** theo kiểu "digital cousin": bố cục và hình học lấy từ LiDAR thật, vẻ ngoài tự dựng.
  - Từ môi trường đó, sinh dữ liệu train mới: ảnh từng camera, LiDAR mô phỏng, label YOLO 2D và label 3D. Có biến số thời tiết (ngày, đêm, mưa, sương, vạch mờ) và giao thông.
- **Model đích:** kiểu [YOLO-LiDAR-Fusion](https://github.com/TimKie/YOLO-LiDAR-Fusion). YOLO 2D là phần được train; lấy điểm LiDAR trong box rồi dựng box 3D bằng hình học.
- **Vòng lặp:** đo model trên ảnh **thật** (gồm các scene đêm/mưa), thấy điểm yếu thì thêm biến số kịch bản, sinh thêm dữ liệu.
- **Lịch sử:** từ 2026-10-03 đến 2026-10-05, dự án là web app hỗ trợ gán nhãn 3D (top view, bird view, surround), kế hoạch 01, nay đã dừng (hồ sơ đã xoá 2026-10-06). Lõi xử lý `backend/topeye/core` vẫn được dùng lại.
- Nguồn ý tưởng gốc: [`PROJECT_BRIEF.md`](../PROJECT_BRIEF.md), [`REVIEW.md`](../REVIEW.md). Kế hoạch hiện hành: [kế hoạch 02](../planning/02_2026-10-05_blender-real2sim/plan.md).

## 2. Công nghệ cốt lõi (Tech Stack)
- **Ràng buộc nền: 100% miễn phí.** Không dịch vụ trả phí, không thuê GPU. Máy là Mac M3 Pro 18 GB, không có CUDA.
- **Lõi xử lý:** Python 3.12 (`backend/topeye`), numpy, scipy, OpenCV, Patchwork++. Đọc nuScenes trực tiếp từ JSON, không dùng devkit.
- **Dựng cảnh và render:** **Blender 5.2.2 LTS** chạy headless (`bpy`, Python 3.13 riêng của Blender), EEVEE (Cycles tuỳ chọn). Script `backend/topeye/sim/blender/build_scene.py` không import `topeye`, chỉ giao tiếp qua file.
- **Dữ liệu mẫu:** nuScenes v1.0-mini, chỉ đọc. Có 3 scene đêm/sau mưa (`scene-1077`, `scene-1094`, `scene-1100`) làm tập đo thật.
- **Cũ (kế hoạch 01, giữ trong repo):** FastAPI + React/TS/Vite/three.js viewer (`frontend/`). Có thể dùng để xem output, nhưng không còn là sản phẩm chính.

## 3. Triết lý thiết kế
- **Hình học lấy từ LiDAR thật, vẻ ngoài tự dựng.** Không dán texture ảnh chụp, vì ảnh đã nướng sẵn ánh sáng ban ngày.
- **Label đúng theo cách dựng:** box 3D và 2D sinh từ chính các actor đặt vào cảnh. Vật bị che hoặc chìm trong sương thì bỏ label.
- **Đo trước, tin sau:** dữ liệu sim chỉ có giá trị khi model train bằng real+sim tốt hơn real-only trên ảnh thật (gate G-sim).
- Hình học kiểm thử phía Python; Blender chỉ áp giá trị đã tính sẵn (selftest camera < 0,5 px).
