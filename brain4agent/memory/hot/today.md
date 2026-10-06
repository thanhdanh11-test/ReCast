# 📅 Nhật Ký Làm Việc Ngày 2026-10-03 (Session Memory Log)

> Cập nhật lúc: `2026-10-03T07:13:06.060Z` | Phiên bản: `v1.0.0`

---

## 🏁 Phiên 2026-10-03 — Khởi tạo cấu trúc dự án

## 🎯 Thành Tựu Khởi Tạo:
- Khởi tạo thành công cấu trúc dự án và bộ nhớ Đa Tầng brain4agent V5.2.

## 🧠 Phiên 2026-10-03 — Đánh giá ý tưởng & bật brain4agent
- Tranh luận đa agent về `PROJECT_BRIEF.md`: Claude (ủng hộ/phản biện/thực dụng), Codex (`codex exec`), Gemini (qua `agy`, vì `gemini` CLI lỗi tier). Kết quả ghi `REVIEW.md`: KHẢ THI CÓ ĐIỀU KIỆN.
- Bật brain4agent v1.13.0 (template 1.7.1), điền project-intro, roadmap, gotchas, data-architecture, kernel.
- Đang chờ người dùng: Q1–Q4 + Q7 trong brief/REVIEW.

## 🤖 Phiên 2026-10-03 — Đợt 1 kế hoạch 01 (Orca run `run_67c689b759bc`)
- Chia việc: Codex = `backend/**`, Antigravity (Gemini) = `frontend/**`, Claude = điều phối + duyệt 🔴.
- WP1 (Codex) ✅: package `topeye`, adapter nuScenes JSON, 16 test (khớp 18364 box GT devkit; test bỏ bù ego lệch 65,79 px). Đo lại: pytest 16/0/0, ruff 0.
- WP7 (Antigravity) ✅: viewer React/three.js trên mock. Đo lại: typecheck 0, vitest 7/7, build 0.
- Contract bổ sung theo câu hỏi Codex: `project()` trả (uv, depth), uv=NaN khi depth<=0; ID sweep `<scene>_sweep_<ts>`.
- Gotcha: Codex CLI bị chặn ở màn hình hỏi cập nhật khi Orca khởi động → cập nhật Codex rồi `worker-start --retry-of`.

## 🤖 Đợt 2 kế hoạch 01 (Orca run `run_aac3f28a4d65`)
- Codex WP2/3/5/6 ✅ (R03): calib ok (dt_max ≤ 47,8 ms), tô màu 58,05%, prepare 1,38 s → 0,42 s (idempotent), API + chặn path traversal + 425.
- Antigravity H04 ✅ (R04): fallback khi thiếu bev, kiểm byteLength, công cụ đo hiệu năng (phím P).
- Lỗi tích hợp do contract thiếu `id` cho box → sửa 01 §5 + H05/H06 ✅ (cache_version 2, vitest 36/36, pytest 29/0/0).
- Còn: WP4 (top view mosaic, 🔴) → Gate G1.

## 🤖 Đợt 3 (Orca run `run_d2e75e479e89`)
- H08 error boundary ✅ (vitest 44/44).
- WP4 ❌ lần 1 (R07): mặt đường rõ vạch nhưng có vệt nan quạt, chưa kiểm tra che khuất.
- WP4b ❌ lần 2 (R09): thêm depth buffer, chỉ tô ô có mặt đất thật, bù cửa sổ, cache v5. Vệt giảm nhưng còn vì LiDAR 32 tia thưa. coverage_on_ground đạt 3/8. Chờ người dùng chọn hướng.
- WP4c (R10): lấp depth giữa các tia + giới hạn 25 m, cache v6. Sạch nhất bằng mắt; coverage_20m đạt 4/8. GIỮ theo thoả thuận lần cuối. Đo G1 trên trình duyệt: p90 179 ms, fps trung bình 31,2, thấp nhất 19,5. G1 chờ người dùng duyệt bằng mắt và kiểm tra chọn box.
- H11 (Antigravity, R11): nhãn box chỉ còn tên ngắn; top view chỉ in chữ cho box đang chọn hoặc đang rê chuột; id chỉ ở tooltip và ô thông tin. Đo lại: vitest 56/56, build 0, trình duyệt thật không còn chuỗi `gt:` trên màn hình.

## 🐦 P05 Bird view (Orca run `run_8f3f5caeb945`)
- Người dùng chọn hướng 2: bird view nghiêng, box dán ảnh camera (SPEC-P05).
- WP12 Codex ✅ (R12): atlas 5 mặt, cache v7, pytest 59, 126/126 id khớp, texture duyệt mắt đúng chiều.
- WP13 Antigravity ✅ (R13): BirdView three.js, vitest 71. Chờ người dùng xem bằng mắt trên Chrome thật.

## 🔎 Nghiên cứu bird view (Orca run `run_6532828dda34`)
- R14 (Codex, 12 repo) + R15 (Gemini, 21 bài) → research/SYNTHESIS.md. Đồng thuận: gộp LiDAR theo track là hướng đúng hình học nhất; diffusion bị loại; OmniRe cần GPU. R14 bắt lỗi: pitch 90° với camera perspective chưa phải ortho metric.

## 🐦 P06 Bird view v2 (Orca run `run_a98e90403b62`)
- WP14 Codex ✅: A1 texture nhiều frame (mặt seen 246→293/504), A2 điểm gộp theo vật (11,5→316 điểm/vật), cache v8.
- WP15 Antigravity ✅: ortho ở ≥89,5° kèm thước mét, layer dense, dòng nguồn texture. vitest 90.
- Chờ người dùng duyệt trên Chrome.

## 🧪 Feed-forward 3DGS (Orca run `run_a5c2ee49cb4b`, 2026-10-04)
- Người dùng loại hướng train 3DGS riêng từng scene. Thử DrivingForward (Codex) và STORM (Antigravity): cả hai chạy MPS ~1,8 s nhưng KHÔNG cho bird view dùng được. STORM bị loại vì license. Chờ người dùng chọn hướng.

## 🌐 Surround 3D (Orca run `run_aa85a05e9da3`)
- Panorama 360° màu + độ sâu từ LiDAR (cache v9), SurroundView bát thích ứng. Đo lại đạt cả hai phía. Chờ người dùng duyệt trên Chrome.
- Surround sửa lần 1 (người dùng báo vỡ): thêm cầu nền 60 m, mặt đất bev dưới bát, làm mượt depth phía trên chân trời (cạnh bị loại −27%). Chờ duyệt lần 2.

## 🔄 2026-10-05/06 — Đổi mục tiêu sang Real-to-Sim (kế hoạch 02)
- Người dùng đổi hướng: bỏ web app gán nhãn, chuyển sang real-to-sim. Model đích kiểu YOLO-LiDAR-Fusion; **100% miễn phí** (loại Marble API, loại thuê GPU); dựng bằng **Blender 5.2.2** đã cài, theo kiểu "digital cousin".
- Đã xét các repo người dùng đưa: YOLO-LiDAR-Fusion (chọn làm model đích), Spark (chỉ là renderer splat, không dựng được cảnh), worldlabs-mcp (wrapper cho Marble trả phí, loại).
- Kế hoạch 02: viết đủ bộ SPEC; viết `backend/topeye/sim/` (camera, layout, labels, cli, blender/build_scene.py, 4 scenario); `docs/sim.md`.
- Đo POC scene-0061: layout 9,2 s · selftest 0,00027 px · EEVEE 0,2–0,6 s/ảnh · Chamfer LiDAR 0,242 m · pytest 108/0/0 · ruff 0.
- Lỗi gặp và đã sửa: gai mặt đất 49 m do trần cầu vượt · vạch sơn bắt nhầm mảng bê tông · World volume EEVEE ra ảnh đen · label vật đã chìm trong sương.
- Chờ: người dùng duyệt `planning/02_.../evidence/s3/compare_*.jpg` → bump v2.0.0. Chưa commit (toàn repo vẫn untracked).
- 2026-10-06 S4 (Orca `run_89d456daffb6`, Codex ×2 song song): Q1 static_map + Q2 ground_surface ✅. Người điều phối đo lại: pytest 135, Chamfer 0,173 m, phủ vùng đường 1,0. Còn yếu: màu tối (67/255), dạng khối, nhà bị cụt, static.ply 32 MB.
- 2026-10-06 S5 (Orca run_b69ee72875c5, Codex ×3): traffic/web/map ✅; sửa xe đỗ biến mất (tổng quãng đường do box rung → độ dịch chuyển thực). pytest 216. Viewer có bảng môi trường và giao thông.
- 2026-10-06 tối:
  - M0 splat dừng (17,87 dB).
  - S10: dựng ≤ 15 phút đạt (784 giây, 19,31 dB, vẫn mờ).
  - S8: mẫu thư viện đạt nhận diện ngày 0,50 (car/ped), chưa đạt 0,8.
  - S9 mesh dán ảnh bị loại (9,1 dB).
  - Codex chạm giới hạn 5 giờ lúc 20:30 rồi được nối lại; Orca restart 2 lần.
  - Người dùng muốn: không train lâu, ≤ 15 phút, xe/người dùng mẫu thư viện, không upload.
