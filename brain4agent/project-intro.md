# Giới Thiệu Dự Án (Project Overview)

## 1. Mục tiêu ưu tiên — 2026-10-09
Người dùng chốt đề N3-09B trong ảnh là mục tiêu chính: xuất quỹ đạo nuScenes thành OpenSCENARIO, phát lại, sinh biến thể tốc độ/khoảng cách, đo sai số và số kịch bản hợp lệ. Sản phẩm là app cài trên máy, macOS Apple Silicon trước (suy từ máy hiện tại), Windows chưa nằm trong bản đầu.
v0.4.0 đã triển khai: Electron dùng lại React/TypeScript và Three.js cho viewport3D, Python core chạy worker JSONL qua stdio, esmini là engine đầu tiên. Bộ cài chứa runtime; không yêu cầu Terminal/Python/Node/GPU khi sử dụng. Engine arm64 thật đã đo 4/4 kịch bản đạt; app đóng gói Python/esmini và có kiểm thử cài ngoài repo. Ký ad-hoc local, chưa notarize/phát hành công khai. Bộ SPEC: [kế hoạch04](../planning/04_2026-10-09_scenario-desktop/plan.md). Không yêu cầu tái dựng nhà/cây chân thực, train perception, NuRec hay CARLA trong bản đầu.

Generatedoutputs/isolatedtools của hướng cũ đã chuyển vào macOSTrash theo yêu cầu dọn2026-10-09; giữ source, dataset gốc vàasset dùng bởi test. Các viewer cũ đãdừng. Khôi phục theo cleanup-manifest trongplan04.

## Lịch sử mục tiêu trước 2026-10-09 (được giữ để tham khảo)
- **topeye (từ 2026-10-05) là pipeline real-to-sim cho xe tự lái.**
  - Từ một scene thật (LiDAR + 6–8 camera surround + calib + ego pose + box/track), dựng môi trường 3D trong **Blender** theo kiểu "digital cousin": bố cục và hình học lấy từ LiDAR thật, vẻ ngoài tự dựng.
  - Từ môi trường đó, sinh dữ liệu train mới: ảnh từng camera, LiDAR mô phỏng, label YOLO 2D và label 3D. Có biến số thời tiết (ngày, đêm, mưa, sương, vạch mờ) và giao thông.
- **Model đích:** kiểu [YOLO-LiDAR-Fusion](https://github.com/TimKie/YOLO-LiDAR-Fusion). YOLO 2D là phần được train; lấy điểm LiDAR trong box rồi dựng box 3D bằng hình học.
- **Vòng lặp:** đo model trên ảnh **thật** (gồm các scene đêm/mưa), thấy điểm yếu thì thêm biến số kịch bản, sinh thêm dữ liệu.
- **Lịch sử:** từ 2026-10-03 đến 2026-10-05, dự án là web app hỗ trợ gán nhãn 3D (top view, bird view, surround), kế hoạch 01, nay đã dừng (hồ sơ đã xoá 2026-10-06). Lõi xử lý `backend/topeye/core` vẫn được dùng lại.
- Nguồn ý tưởng gốc: [`PROJECT_BRIEF.md`](../PROJECT_BRIEF.md), [`REVIEW.md`](../REVIEW.md). Kế hoạch hiện hành: [kế hoạch 02](../planning/02_2026-10-05_blender-real2sim/plan.md).

## 2. Công nghệ nền hiện có (desktop bổ sung ở mục 1)
- **Hạ tầng hiện tại (2026-10-08): đã chuyển sang thuê/sử dụng GPU qua Kaggle theo xác nhận của chủ dự án.** Mac M3 Pro 18 GB vẫn dùng phát triển và xử lý local. Quy định cũ không thuê GPU đã được thay thế; loại GPU và ngân sách chưa được ghi nhận trong lần cập nhật này.
- **Lõi xử lý:** Python 3.12 (`backend/topeye`), numpy, scipy, OpenCV, Patchwork++. Đọc nuScenes trực tiếp từ JSON, không dùng devkit.
- **Dựng cảnh và render:** **Blender 5.2.2 LTS** chạy headless (`bpy`, Python 3.13 riêng của Blender), EEVEE (Cycles tuỳ chọn). Script `backend/topeye/sim/blender/build_scene.py` không import `topeye`, chỉ giao tiếp qua file.
- **Dữ liệu mẫu:** nuScenes v1.0-mini, chỉ đọc. Có 3 scene đêm/sau mưa (`scene-1077`, `scene-1094`, `scene-1100`) làm tập đo thật.
- **Cũ (kế hoạch 01, giữ trong repo):** FastAPI + React/TS/Vite/three.js viewer (`frontend/`). Có thể dùng để xem output, nhưng không còn là sản phẩm chính.

## 3. Triết lý thiết kế
- **Hình học lấy từ LiDAR thật, vẻ ngoài tự dựng.** Không dán texture ảnh chụp, vì ảnh đã nướng sẵn ánh sáng ban ngày.
- **Label đúng theo cách dựng:** box 3D và 2D sinh từ chính các actor đặt vào cảnh. Vật bị che hoặc chìm trong sương thì bỏ label.
- **Đo trước, tin sau:** dữ liệu sim chỉ có giá trị khi model train bằng real+sim tốt hơn real-only trên ảnh thật (gate G-sim).
- Hình học kiểm thử phía Python; Blender chỉ áp giá trị đã tính sẵn (selftest camera < 0,5 px).


Scenario Studio v0.9.0 adds local map-bound OpenSCENARIO import for future AI generation: ego/vehicles/pedestrians, timed world-coordinate paths, native context export/import and measured esmini playback. Existing Electron/React/Python JSONL architecture remains; Shapely2.1.2 handles polygon/swept collision envelopes. No AI provider/API or cloud service introduced.
