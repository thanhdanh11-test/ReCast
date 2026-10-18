# 📅 Nhật Ký Làm Việc Ngày 2026-10-17 (Session Memory Log)
> Cập nhật lúc: `2026-10-17T20:10:00+07:00` | Phiên bản: `v0.40.0`
---
## 2026-10-16T20:23:50+07:00 — Plan48 kiểm chứng lại
- Luồng 5 bước: chọn xe → tình huống → tham số → so sánh → lưu/xuất; click ego mở 20 template, xe giao thông có 4 kind. Hai API cùng event sinh hai gói baseline/pilot thật, phát cạnh nhau cùng đồng hồ; tự lưu được nói rõ. Chọn sẵn hướng/thời lượng khả thi theo xe; khóa chuyển bước khi đang chạy. 66/66 test, typecheck/build exit0; Chrome 8 bước/10 gói/0 lỗi, quỹ đạo ego khác nhau. Chưa phát hành, chờ duyệt hình thức.
- Evidence: `planning/48_2026-10-15_unified-scenario-demo/evidence/guided/`. App localhost5180, phiên bản0.35.0; không commit/push.

## 2026-10-16T20:37:00+07:00 — Plan48 P03
- Có hướng dẫn mặc định: chọn ý định → gợi ý xe có ego theo sau → preset hợp lệ và thời điểm → hai kết quả thật → xuất. Chuyên sâu giữ 20 mẫu/tham số; engine/API không đổi. 70/70 tests, typecheck/build exit0, Chrome 9 bước/12 gói/0 lỗi, HTTP200. Chờ duyệt trải nghiệm; preview trên0.35.0.
- Evidence: `planning/48_2026-10-15_unified-scenario-demo/evidence/beginner/`. Browser test waits for final library row; previous count11 was a UI refresh race in harness. No commit/push.

## 2026-10-16T20:50:23+07:00 — Mainweb0.36.0
- v0.36.0 mainweb: Có hướng dẫn trên thanh công cụ, dùng cảnh đang chọn; quay về không gian làm việc. 71/71 focused tests, typecheck/build exit0; Chrome từ root URL 11 bước/12 gói/0 lỗi. Engine/API không đổi. Toàn bộ tương tác ego cùng làn chưa triển khai.
- Server5180 restarted preserving account/workspace settings; no push/commit/remote deploy. Evidence `planning/48_2026-10-15_unified-scenario-demo/evidence/mainweb/`.

## 2026-10-16T21:40:31+07:00 — Main default demo buttons
- v0.36.1: chọn dataset trên web chính mở thẳng cùng component/bộ nút demo (Có hướng dẫn/Chuyên sâu/thanh5bước). AccessApp initialGuided=true, chờ source load trước khi gọi API. Back trả công cụ cũ.72tests/typecheck/build pass;Chrome12bước12gói0lỗi.
- Evidence `planning/48_2026-10-15_unified-scenario-demo/evidence/main-default/`. Server5180 restarted, auth/workspace persisted, no commit/push.

## 2026-10-17T00:06:42+07:00 — Plan49 audit complete / repair spec ready
- Plan49 audit: 11 findings +5 risks; FE524/525 (missing EN), server43/43, BE819/819;20scene map preflight18pass/0103+0655invalid; build/typecheck0. One Scenario tab spec ready; no production code changed.
- Scope: audit+plan only; no commit/push/mainserver restart. Evidence summary: planning/49_2026-10-16_scenario-unify/evidence/audit/summary.json.

## 2026-10-17T00:58:44+07:00 — Plan49 implementation
Owner “oke sửa đi” authorized fixes. Implemented one workspace and durable group metadata, resource/boot/map gates, retry/cancel generation, advanced feature adapters and honest metrics. FE538/server51/BE819 pass; typecheck/build0. Independent H01 found aggregate metadata overflow; red6/7 then green7/7, byte-preservation review approved. Browser found readonly BUSY and reload same-dataset/metrics conflict; both fixed, no raw writes. Browser/local rollout acceptance in progress. No commit/push/remote deploy.

2026-10-17T01:04:51+07:00 — Plan49 local technical sign-off: FE538/server51/BE819,0skip; typecheck/build/diff0. Browser11steps/13packages/5durablegroups/reload/4kinds/template+XOSC+directory import0errors;16-step source/library E2E,13raw metadata hashes unchanged/0workers;20scene18supported+2explicitinvalid. EN/light1440/1050/390 no overflow. Mainweb5180 v0.37.0 restarted,3production account/config/catalog hashes unchanged;rootlatestbuild200/unauth401. Ego implementation taskspace2 finished. R01 independent review✅. Owner UX remains pending; no commit/push/remote deploy. Summary Plan49/evidence/acceptance/summary.json.

## 2026-10-17T14:25:05+07:00 — v0.37.1 map picker greying
Owner: cảnh lỗi map phải mờ trong nút chọn scene. v0.37.1 PATCH: bộ chọn Map trong Tạo kịch bản làm mờ (option disabled + lý do ở tooltip) các cảnh có map bị cổng `build_map_context` từ chối (mini: 0103, 0655). Worker chỉ số `map_status` = `validate_source_polygons` dùng chung với cổng thật trên vector map, không dựng LiDAR (~1 s/10 cảnh, cache theo dataset). Probe lỗi ⇒ không làm mờ; cổng thật vẫn chặn. FE540/server51/BE820 0skip; typecheck/build0; E2E chính + workspace PASS. Server5180 restarted; no commit/push.
Owner clarified (screenshot): grey out in the top Cảnh nguồn picker of Kịch bản. Done in ScenarioApp via same mapStatus probe; Chrome E2E asserts greyed == real gate rejects (nuScenes 0103/0655, AV2 none). FE541. Server5180 restarted.

## 2026-10-17T15:15+07:00 — Plan50 SPEC ready
Owner asked to declutter Kịch bản with a 3-column studio, analysis page, CARLA/.xosc export and Exports page. SPEC package planning/50_2026-10-17_scenario-studio (8 files); CARLA package mirrors ~/Downloads/car_013_t01.0_stop_d3_a8, .xodr ported from replay-forge real2sim/xodr.py@d36205b. Open defaults D1 left scene list, D2 'có sẵn'=templates/.xosc/real2sim, D5 no CARLA for AV2. No product code.

## 2026-10-17T16:19:03+07:00 — Plan50 implemented (v0.38.0)
Owner 'làm đi' with defaults D1 left scene list, D2 có sẵn = templates/.xosc/real2sim, D5 no CARLA for AV2. Trang Kịch bản = Scenario Studio 3 cột: danh sách cảnh (cảnh lỗi map mờ) + nút Tạo kịch bản (menu Có sẵn: 20 mẫu/.xosc/real2sim · Tự tạo: luồng phản ứng) · viewer 2D/3D, 2D vẽ baseline nét đứt + pilot nét liền cùng map, timeline mỗi xe một màu + mốc Tình huống/Phản ứng · lịch sử Sửa/Xoá/Phân tích/Lưu. Phân tích = trang chia mục (chỉ mục có số). Lưu = popup Xuất cho CARLA (.xosc OSC1.1 + <scene>_map.xodr port replay-forge map_roads + trajectories.csv + report.json nếu có + manifest.json) / Chỉ .xosc; trang Đã xuất: hàng đợi Node, mỗi job một tiến trình Python, tiến độ thật 0–100 %, tải zip, xoá vào .trash. CARLA chỉ nuScenes (AV2 mờ + worker CARLA_UNSUPPORTED). Đo: .xodr scene-1077 khớp gói mẫu team 170/170 road, lệch 0 m; esmini chạy gói CARLA thật exit 0 (155 đối tượng); BE827/FE553/server55 0 skip; typecheck/ruff/build 0; E2E local-web 15 bước, workspace (20 cảnh 18 hợp lệ, CARLA→zip→esmini, AV2, EN/sáng, 1440/1050/390), unified (4 loại phản ứng, mẫu, .xosc, reload nhóm, Phân tích 6 mục, real2sim), access PASS; mutation đỏ trên mọi bộ đo mới. Server5180 not yet restarted at this line; no commit/push.
2026-10-17T16:33:42+07:00 — Owner: chưa tạo kịch bản thì Phát cảnh gốc không chạy. Root cause: timeline/playback bound to opened scenario only while viewer fell back to source. Fixed with one `displayed` source of truth; FE554 pass; real Chrome 0→2.5 s, 0 page errors.
2026-10-17T16:49:22+07:00 — Independent review 🔁 F1–F7 fixed with red→green regressions; BE830/FE554/server58; E2E workspace CARLA→esmini PASS; server5180 restarted (no auto-open). No commit/push.

## 2026-10-17T17:38:15+07:00 — Plan51 (v0.39.0)
Owner: bỏ timeline ở cảnh gốc, timeline chỉ xe liên quan; ego va chạm = không hợp lệ + hướng dẫn; “dừng hẳn” mà xe đi tiếp là sai. “Dừng hẳn” = mục tiêu phanh mới `hold`: phanh tới dừng rồi đứng yên đến hết cảnh (trước đây nhãn này gắn `stop`+0 của replay-forge nên xe dừng 0 s rồi đi tiếp); 4 lựa chọn: Dừng hẳn · Dừng 3 s rồi đi tiếp · Dừng rồi đi ngay (=stop+0, giữ cho ô chỉ số) · Chậm lại 50%. Pilot (kịch bản người dùng tạo) mà ego chạm bất kỳ đối tượng nào ⇒ `ego_collision`, không hợp lệ, câu tóm tắt có “Cách sửa”; baseline + chỉ số cảnh giữ luật replay-forge. Mẫu/.xosc ego va chạm ⇒ ghi chú EGO_COLLISION, lưu nhưng đánh dấu không hợp lệ (từ chối sẽ mất 10/19 lần đặt mẫu). Studio: chip “Không hợp lệ”, băng đỏ + cách sửa + nút Sửa; timeline chỉ khi có kịch bản, chỉ ego + xe sự kiện + xe phản ứng (mẫu/.xosc: mọi đối tượng tác giả đặt). Đo: thật scene-0061 car_154 hold v sau dừng 0,0 (stop+0 chạy lại 3,67 m/s); mẫu Dừng khẩn cấp scene-1077 ⇒ EGO_COLLISION + băng/chip; BE834/FE557/server58 0 skip; typecheck/ruff/build 0; E2E local-web/workspace/unified PASS (timeline 2 hàng/kịch bản); mutation đỏ trên mọi bộ đo mới. Server5180 restarted (no auto-open). No commit/push.

## 2026-10-17T19:36:25+07:00 — Plan52 (v0.40.0)
Owner: sửa hết đánh giá, chỉ nuScenes, giảm chờ. Sửa toàn bộ đánh giá tạo kịch bản: ego mẫu tự phanh IDM (dùng được 18→48/160, va chạm 28→5); lỗi hiện trong hộp thoại, khoá tạo khi map ✗, thẻ mẫu ✓/✗, ẩn tab AI giả, nút phụ vào Thêm; HTTP 400 cho lỗi người dùng; Tự tạo 3 bước, kiểm hợp lệ trước + chọn preset hợp lệ, mặc định phanh Vừa ≥2 s, hướng dẫn khi trống; tên dễ đọc; 2D tự khung. Chỉ nuScenes (AV2 ẩn, tệp chưa xoá). Nhanh hơn: mở 9,3→5,3 s, bật lại 3D 2,5→0,03 s, mở lại kịch bản 4,6→0,04 s, tạo xong→3D 9,9→6,7 s. BE836/FE558/server60 0 skip; typecheck/ruff/build 0; E2E local-web/workspace/unified/access PASS. AV2 files (31 GB intake incl. unused 20 GB nuScenes copy) NOT deleted — awaiting owner. Server5180 restarted. No commit/push.
Chủ xác nhận “xoá cả thư mục intake” 2026-10-17T19:43:46+07:00: đã xoá `backend/data/dataset-intake-20261013/` (31 GB: AV2 11 GB + bản sao nuScenes không dùng 20 GB + script tải). App vẫn đọc nuScenes ở ~/cvat-day2/…; gỡ test dùng dữ liệu AV2 thật (test_structures 8→7); BE835 (836−1) 0 skip; E2E access PASS; app 200.

## 2026-10-17T22:37:24+07:00 — Plan53 (v0.41.0) Phân tích dạng báo cáo
- Chủ hỏi trình bày Phân tích dễ hiểu/khoa học hơn ⇒ tab đánh số Kết luận/Diễn biến/Kiểm định/Từng xe; thang 5 bậc B/P; bảng chỉ số + ngưỡng từ report; giả định. FE564, E2E unified PASS.
- Commit trước: c073512 (v0.38–0.40). Script rotate_memory ở hub xoay ngược (archive phiên mới) — đã sửa tay, chưa sửa hub.

## 2026-10-17T22:54:05+07:00 — Plan54 (v0.41.1) báo cáo chỉ xe liên quan
- Chủ: báo cáo đầy đủ rối ⇒ lọc theo ego + xe liên quan, đếm phần ẩn + “Hiện tất cả”, bỏ khối trùng tab. 70 ghi chú map không liên quan ẩn, còn 1. FE568, E2E PASS. Chưa commit (v0.41.0 + v0.41.1).

## 2026-10-17T23:45:48+07:00 — Plan55 (v0.41.2) tăng tốc mở cảnh
- Đo bằng CPU profile + trace worker: màn ẩn dựng 3D (3,3 s), reactive_candidates chặn hàng đợi (2,8 s), shapely interpolate. Sửa ⇒ bấm cảnh 1–2 s, mở lại 0,1 s. Chủ duyệt “xoá 1 2 3” ⇒ đã xoá ~1,3 GB (tmp test, expansion.zip, dist/preview plan40/42); dự án 2,8 GB.

## 2026-10-18T00:26:41+07:00 — Thử gói CARLA (không có CARLA trên Mac arm64)
- Xuất gói carla scene-1077 car_051 half (job f6d8d360…): esmini exit 0, lệch 0 m; xe cách tâm làn .xodr trung vị 0,51 m (cùng hệ toạ độ).
- scenario_runner: FollowTrajectoryAction chỉ Polyline KHÔNG thời gian ⇒ .xosc chạy sai thời điểm trên CARLA. Viết `~/Downloads/topeye-carla-test/carla_replay.py` (generate_opendrive_world + set_transform theo trajectories.csv, sync 0,05 s), kiểm bằng carla giả lập: 73 spawn/destroy, 400 tick, toạ độ y/yaw đổi dấu đúng. Chờ chủ chạy trên máy CARLA thuê.

## 2026-10-18T01:03:14+07:00 — CARLA thật PASS (Brev L4)
- Máy Brev `extreme-bronze-lion` (L4 24 GB, Ubuntu 22.04) có sẵn `~/carla-env` (docker compose CARLA 0.9.15 headless + image client py3.10 có carla/ScenarioRunner/ffmpeg; `start.sh` tự fix GL/CDI). Brev CLI cài trên Mac, `brev login --email … --skip-browser`, dùng `brev exec/copy` (ssh -host bị chặn cổng).
- `carla_replay.py` trên CARLA thật: generate_opendrive_world từ .xodr + 73 đối tượng, 20 s, không lỗi spawn; video 1280×720 400 khung `~/Downloads/topeye-carla-test/ketqua/replay.mp4`. Đã `stop.sh` + `brev stop` để không tốn tiền.

## 2026-10-18T02:13:05+07:00 — Plan56 (v0.42.0) Town10HD là cảnh trong app
- CARLA ghi Town10HD (ego 74 m, 43 xe, LiDAR) → bộ dữ liệu nuScenes `~/Documents/Topeye Datasets/carla-town10hd`; seed “CARLA Town10HD”. E2E test-carla-town PASS (mở 3,7 s, Tự tạo phanh hợp lệ, xuất LogicFile Town10HD_Opt). Chưa commit.

## 2026-10-18T15:28:18+07:00 — Plan57 (v0.43.0) Xem trên CARLA
- Chủ tạo “Trẻ em lao ra sau xe đỗ” trên carla-town10hd → xuất + dựng trên Town10HD thật, video `~/Downloads/topeye-carla-test/ketqua/tre_em_lao_ra.mp4`.
- Nút Xem trên CARLA ở Đã xuất (Brev tự bật/tắt, góc sau xe/trong xe). Ghi lại cảnh Town10HD (ego kinematic + clean_tracks) CHƯA xong: VM treo 2 lần.

## 2026-10-18T15:46:58+07:00 — Audit báo không hợp lệ
- Đọc luồng template/XOSC/reactive → report → library → Studio; rà 17 gói hiện có, 4 invalid (3 pilot Town10HD label_error, 1 baseline scene-1100 collision). Tái chạy 2 pilot bus_038 hold/2 @5/@9: cùng label_error do quỹ đạo ego nguồn; ghi chi tiết trong known-gotchas. Không sửa code, dữ liệu nguồn hay gói đã lưu.
- Verification: backend `.venv/bin/python -m pytest -q` exit0, 841 passed/0 failed/0 skipped (271,79 s); frontend `npm test -- --run` exit0, 572 passed; `npm run test:server` exit0, 65 passed/0 skipped; `npm run build` exit0 (tsc + Vite); `git diff --check` exit0. Không chạy browser E2E/CARLA/remote.

## 2026-10-18T16:07:35+07:00 — Plan58 / v0.43.1 validation presentation
- `assessmentOf` + `AssessmentDetails` thống nhất lịch sử/Studio/analysis/pre-check/Real2simReport; đủ mọi lý do, giữ mã lạ, nguồn chỉ là heuristic. Mẫu nói rõ kiểm tham số. Library summary thêm reasons/react; không ghi lại gói.
- Regression red4/4 trước triển khai; green578FE/44BE focused,0skip; build/ruff/diff exit0. Browser bản sao 17gói/97payload0mismatch; 2 lý do source+physics hiện trên Studio/analysis. Evidence: planning/58_2026-10-18_validity-labels/evidence/.
- Main5180 đã restart SAU khi export/CARLA không còn running/queued; HTTP200,3config hashes unchanged. Preview riêng đã tắt, ego task finished. Không chạy remote/commit/push; không sửa quỹ đạo nguồn hay luật valid.
- 10 file sửa ngoài phiên (15:52–16:02, nghi Antigravity: diễn giải kiểm định, AssessmentDetails) → commit riêng b31e1cc theo yêu cầu chủ; v0.42.0+v0.43.0 commit riêng. Gates: BE 842, FE 578, server 67.
