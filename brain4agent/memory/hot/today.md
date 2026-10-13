# 📅 Nhật Ký Làm Việc Ngày 2026-10-09 (Session Memory Log)
> Cập nhật lúc: `2026-10-09T16:30:18+07:00` | Phiên bản: `v0.8.0` (local desktop verified)
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

## Scenario 3D v0.4.0 — 2026-10-09T10:37:02+07:00
- Hoàn thành plan05; cài và mở `/Users/macos/Applications/Topeye.app`.
- Renderer Three.js dùng pose thật, hỗ trợ camera bám xe/toàn cảnh/tự do; đường tổng hợp có nhãn, không thêm traffic giả.
- Frontend143pass, typecheck/package exit0; installed WebGL2, seek, camera, actual esmini, cancel/process teardown và metadata integrity đạt. `planning/05_2026-10-09_scenario-3d/evidence`.
- Review6/6; package LICENSE-three + codesign/SHA đã kiểm. Chờ người dùng nhận xét hình ảnh; chưa commit/push.

## v0.5.0 — Original scene — 2026-10-09T11:03:13+07:00
- Toàn bộ annotation trong cảnh gốc; bản đồ nuScenes offline, nhà/cây/cột đơn sắc ước lượng từ LiDAR, kiểu actor theo nguồn, đèn sau đỏ không suy trạng thái phanh.
- Sửa lỗ polygon lớp sọc qua đường; thiếu LiDAR giữ actors/map và cảnh báo; source ID không được export/replay.
- Sửa đóng gói symlink Python qua cả hai bước copy; 113 liên kết tương đối nằm trong app, SHA ZIP và codesign strict đạt.
- Backend565/frontend145 pass,0fail/skip; lint/typecheck/build/package đạt. Independent probes11/11 và packaging8/8; regression RED→GREEN lưu đầy đủ.
- Installed source/seek/cameras + esmini baseline/variant + cancel/process teardown +13metadata hashes đạt. Bản cài ~/Applications/Topeye 0.5.app; giữ app0.4 và zip rollback.
- Evidence: planning/06_2026-10-09_original-scene/evidence. Chưa nghiệm thu thẩm mỹ bởi người dùng, chưa notarize/public release, chưa commit/push.
- 09:22 v0.23.1: AV2 mở nhanh hơn (adapter vector hoá, worker giữ adapter đã kiểm tra, quét LiDAR song song); bỏ phương án lấy mẫu 2 Hz vì mất chi tiết.
- 09:30 v0.23.2: thanh icon bỏ Cảnh báo + Dữ liệu, thêm Cài đặt (chủ dự án yêu cầu); cảnh báo vẫn ở chip 3D.
- 09:41 v0.24.0: bỏ Môi trường khỏi thanh icon; Cài đặt có giao diện sáng/tối/hệ thống + chất lượng đồ hoạ (nhớ theo trình duyệt).

### 2026-10-13T21:31:34+07:00 — cabin bonnet
Owner wants visible hood in driver view.24triangle camera-attached red bonnet, lowerquarter, onlyvalid cabin.17scopedtests passed. Mainweb5180 rebuild/restart/HTTPverified 2026-10-13T21:33:11+07:00; no browser takeover.
