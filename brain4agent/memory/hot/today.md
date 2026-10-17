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
- 10:33 v0.25.0 plan35: trang Cài đặt riêng đủ 10 mục + góp ý nhà sản xuất + tiếng Anh; 7 mutation đỏ.

## 2026-10-13T10:53:19+07:00 — Plan36 runner timeline
- Owner approved isolated prototype; implemented2:1 player/sidebar, XOSC vertex timeline, three tabs, fixed create button; history aggregates saved runs. Existing settings/i18n/source preserved.
-371FE/37server/build pass; real15-step E2E, ratio2.000036, footer stays900px,13metadata unchanged,0workers. Independent review caught obsolete CSS override and bubbled key causing1.1s seek; fixed, mutation tests verify.
- Runtime localhost5180 restarted, version0.26.0; owner relogin needed. No commit/push. Evidence planning/36_2026-10-13_runner-timeline/evidence.

## 2026-10-13T11:12:46+07:00 — Plan37 v0.26.1
- Owner screenshot: camera floated70px, dense diamonds masked motion. Fixed bottom12px, separate sparse marker rail/full data retained, no footer. Added per-run confirmed trash deletion.
-673BE/374FE/38server/build/lint; independent guard/mutation/4attacks; real16step E2E camera12px/footer0/historycancel+confirm+preservation passed. Fixed pending metrics leave/return discovered by E2E, regression+mutation measured.
- Restarted5180; owner relogin. No owner history deleted; temp workspace only. No commit/push. Evidence plan37/evidence.

## 2026-10-13T11:59:23+07:00 — Plan38 P01 tạo kịch bản (template + AI)
- Chủ dự án yêu cầu template mẫu + tạo bằng AI, làm UI trước; bổ sung: chọn loại kịch bản (vd dừng khẩn cấp) và đề xuất thêm. Chốt 20 loại/5 nhóm.
- ScenarioCreator thay dialog plan30 (giữ tải map/.xosc). Mock AI luật từ khoá. "Tạo từ template" disabled tới P02.
- Test catalog đỏ thật 2 preset (stop_and_go, cut_out vượt thời lượng) → đã sửa. 412FE/38server/build/tsc/diff-check exit0; Chrome 6 ảnh 0 lỗi (workspace tạm). Không bump version, không commit.
- 12:20 vòng duyệt 1: bỏ tiêu đề/"Đã có file?", header không khung, tab AI thành chatbot (text + lựa chọn, tin sau chỉnh tiếp). 416FE/38server/build pass; Chrome 7 ảnh 0 lỗi.
- 13:19 v0.27.0 plan39: cầu giàn hiện đúng (hành lang hai bên), trần chỉ khi ego đi dưới; không tải thêm, chưa commit (chủ dự án yêu cầu). Phiên song song đang làm plan36–38.

## 2026-10-13T14:04:01+07:00 — Plan38 P02 v0.28.0 tạo kịch bản từ template
- Worker import_template (biên dịch → validate_xosc → lưu gói). Đặt dọc quỹ đạo ego nguồn; đo thật lần đầu 0/40 → thêm auto vị trí + lật trái/phải; cuối 44/100 trên 5 cảnh × 20 loại.
- Gotcha: phiên song song (plan39) dùng 0.27.0 cùng lúc; đợt này lên 0.28.0. Không commit/push.
- 700BE/420FE/39server/build/diff-check exit0; ảnh tạo cut-in scene-1077 + từ chối scene-0916 trong evidence/p02.


## 2026-10-13T14:25:00+07:00 · Haulix preview only (plan40)
Owner requested an isolated Haulix prototype, then rejected the design and explicitly requested deletion. 2026-10-13T14:26:26+07:00: removed the entire prototype directory and stopped preview server :5191. App source/runtime unchanged. No integration or redesign continuation; owner will revisit later.

## 2026-10-13T14:27:33+07:00 — Plan38 v0.29.0 gợi ý map khi chọn loại
- Worker template_fit (cổng thật, chỉ đọc, worker chỉ số, cache) + UI MapFit. Thật: Dừng khẩn cấp 3/10 map, Xe cắt làn 2/10. Sửa lỗi báo "0/10" khi chưa kiểm.
- 701BE/421FE/40server/build/diff exit0. Phiên song song đã mở plan40 (haulix-preview), chưa bump; đợt này 0.29.0. Không commit.

## 2026-10-13T15:02:16+07:00 — v0.29.1 phanh gấp gắn đúng ego
- Chủ dự án báo ego không phanh trong "Người đi bộ băng qua". Đọc gói thật: sự kiện gắn cho ped. Sửa mặc định ego, cấm hard_brake cho người đi bộ, sơ đồ ghi tên. Chrome: ego 11,1→0 m/s. 702BE/423FE/40server.

## 2026-10-13T15:24:38+07:00 — Map shape pilot
Owner requested one simple monochrome environment scene, classes untouched. Local preview http://127.0.0.1:5181:scene0061,8 OSM footprints,source road/sidewalk/LiDAR trees. Overpass endpoints failed406/timeouts;BBBike Singapore78,270,194-byte XML download succeeded;filtered248ways/1relation.5 heights inferred from levels,3 fallbacks;no bridge.331.785m² overlap with source drivable polygons unresolved:visual pilot only.10 tests,tsc/Ruff/Vite exit0,0 browser errors;before/after+3 cameras checked. Evidence plan40/evidence. Product/runtime5180 unchanged;no version bump/commit.

## 2026-10-13T15:26:50+07:00 — v0.30.0 sửa kịch bản bằng form template
- Chủ dự án: Sửa không hiện code. template.json cạnh gói; Sửa mở ScenarioCreator; lưu = gói mới + gói cũ vào .trash. Bắt thêm bẫy: đổi tham số chính xoá phanh tự thêm → giữ phần manual. Chrome đạt; 702BE/425FE/40server.

2026-10-13T15:34:43+07:00 Plan40 pastel: inspected owner AVIF via avifdec (sips failed; Pillow unavailable). Applied cream/gray/ivory/sage palette, no facade windows, elevated narrow-FOV overview. tsc/build pass. Browser previously handed to user; did not reclaim or create another session; visual refresh pending.

## 2026-10-13T15:46:53+07:00 — v0.30.1 không hiện code khi gói thiếu template
- Ảnh chủ dự án: gói Dừng_khẩn_cấp tạo 15:23 (trước server 0.30.0 ~15:27) nên thiếu template.json. Sửa: dialog "Tạo lại bằng template" + XML chỉ ở "nâng cao". 3 gói của chủ dự án (15:09/15:19/15:23) cần tạo lại. E2E thật PASS.

2026-10-13T15:54:04+07:00 Complete-map request:expandedscene0061 to420×420m fromcachedOSMcity+nuScenes expansion;30OSM footprints→34displaycomponents after0.4m road clearance;raw1288.488m²/display0m² overlap,1499.406m² removeddisclosed.536polygons/57lines/49landscapeislands/147trees/33poles;127originalactorsat5s.13tests,mutation3/3detected,tsc/Ruff/Vite/actualThreegeometrypass. Browser is user-owned;no takeover or alternate browser. User should reload5181;visualgatepending. Product5180/classes/source unchanged.


### Pilot road depth patch — 2026-10-13T16:03:47+07:00
Owner screenshot shows distant pavement breakup. Pilot camera now adapts near plane to orbit distance (clamp distance/50 to0.25–25m), retaining far2500m. 24-bit depth quantization check:2538samples, old near0.1 produced1365collisions for4cm layers; adaptive near produces0. Road vertices below floor(-0.2m):0/168474. tsc/Three geometry/Vite exit0; evidence:`planning/40_2026-10-13_map-shape-pilot/evidence/depth-checks.txt`. This proves precision improvement, not GPU visual acceptance; owner refresh pending. No geometry/class/product/version changes.

2026-10-13T16:11:41+07:00 — Plan41 3D display: owner authorizes Agy research of distinct lightweight model per source class (nuScenes/AV2), visual/license/complexity shortlist. Implementation must await owner model approval. H01 prepared; dispatch pending.

Plan41 H01 delivered to Agy terminal term_fddbd3d0-a474-4588-9d06-8b0cc15ab85c; accepted=true, turn-start observation unsupported. User lightweight requirement included. Implementation awaits owner model selections.

2026-10-13 — Owner requested Agy auto-accept. Restarted exact conversation0797369c-f1ba-445f-b8c8-1b4a44425b5e with --dangerously-skip-permissions; previous terminal confirmed ptyKilled. New terminal term_48539c6c-0c4e-4517-a1be-8e65b9803122; continuation input accepted. Research scope unchanged; model selection and implementation still require owner approval.


## Twenty pastel scene maps — 2026-10-13T17:53:59+07:00
Plan42 local preview at http://127.0.0.1:5181 replaces single-scene pilot.20/20 maps (10nuScenes mini+10AV2 Sensor),20OSM-covered regions,2793display building components counted across scenes. Keep existing actors/classes/poses; cancel all plan41 object-model integration. Offline source export122.923s, cached reconstruction about7s;30,522,677bytes JSON total, max3,520,269bytes/scene. Only one selected scene loads; no20map GPU residency.
Sources: cached BBBike Singapore for6scenes;14OpenFreeMap/OpenMapTiles OSM tiles(2,534,936bytes) for14US scenes. AV2 uses official city-origin UTM, nuScenes origin-scaled Mercator; holes preserved,0.4m cosmetic road clearance, measured overlap0m². Tile heights may be inferred; missing heights9.6m explicitly estimated. Supplement uncovered facades with LiDAR estimates. Existing LiDAR structures retained; no invented bridge.
Geometry cleanup at1mm presentation precision removes near-zero union edges/slivers; source polygons/lines and actor arrays preserved.27tests pass,5801rings valid,20Three.js CPU builds pass with0new geometry defects/0terrain fallbacks;3pre-existing invalid source polygons remain disclosed (scene0103:2,0655:1). Independent reviewer remeasured14scopedtests+5801rings+tsc. HTTP20/20 payload hashes match built files. GPU visual/FPS not measured because owner controls browser; not a product release. Evidence: plan42/evidence/{summary.json,geometry.json,rings.txt,tests.txt,http.json}.

### 2026-10-13T18:56:20+07:00 — v0.31.0 pastel mainweb
Owner “map oke đổi ở web đi”, then “tiếp tục”.Integrated20approvedmaps via2.1MBgzip presentation assets and sourcefingerprints;428frontendtests+31backendtests,20fresh extraction matches,40CPUgeometrypasses/0newissues. Browser ownership remains user, noGPU/FPSclaim. Existing model/class work untouched, Agy shortlist remains cancelled. Localhost5180 restarted/HTTPverified 2026-10-13T21:25:29+07:00;40server tests pass;R02 independent review approved.

### 2026-10-13T21:31:34+07:00 — cabin bonnet
Owner wants visible hood in driver view.24triangle camera-attached red bonnet, lowerquarter, onlyvalid cabin.17scopedtests passed. Mainweb5180 rebuild/restart/HTTPverified 2026-10-13T21:33:11+07:00; no browser takeover.

GitHub destination correction: bonnet pushed/verified to P-056 main a451a1a, path source-tool/topeye (v0.15.1 backport).15focusedtests+build passed on target checkout. Prior95ae6fe push to thanh danh test repo remains; no history deletion. Pastel/uncommitted local changes not delivered.

### 2026-10-15 — Plan47 v0.35.0, local technical gates
Hoàn thiện orchestration Claude: ba kind accelerate/stopline/lane_change và workspace Phản ứng theo ảnh chốt. Review độc lập tìm t0 bị giới hạn theo brake và stopline snap vượt giảm tốc; đã tách window theo kind, kiểm tính khả thi 1D, thêm test. Sửa đổi cảnh mất map và aria kind. Backend 819/819, frontend 505/505, server 43/43, Ruff/typecheck/build exit 0; brake 777/225/591/18 DIFF0; kind mới 696/677/532/1, 53/16/36/0, 221/130/132/2. Chrome scene0061↔0103, ba kind tạo được, 0 page/HTTP lỗi. Evidence Plan47 local; chờ chủ dự án duyệt ảnh động/hình thức, chưa commit/push.

### 2026-10-15 — Plan48 unified scenario demo, preview local
Theo yêu cầu người dùng, URL `?unified-demo=1` trong app đã login/dataset, cố định scene-0061. Hai đường `importReactive` (brake/stop thật) và `importXosc` vào một thư viện/mặt xem; xuất `.xosc` qua `readImported`. App mặc định và version 0.35.0 không đổi. Typecheck 0, Vitest 47/47 liên quan, build 0, HTTP 200; Chrome tài khoản/workspace tạm: phản ứng 228 actor tạo/mở lại/xuất `.xosc` có OpenSCENARIO root; file `.xosc` thường từ map nạp vào cùng thư viện; 0 lỗi. Ảnh và JSON Plan48 evidence/local. Chờ chủ dự án xem demo; chưa commit/push.

Người dùng phản hồi thiếu click xe, chuyển làn/tăng tốc và baseline/pilot dễ thấy. Đã bổ sung click ego/xe giao thông trên map, bốn loại sự kiện dùng `eventOf/windowsOf`, HUD baseline/pilot trong khung map/3D. Ego phản ứng trong pilot, không được chọn làm xe gây sự kiện theo engine. Build/typecheck 0, 55/55 test liên quan, HTTP 200; Chrome thật bấm map và tạo bốn kind trên scene-0061, 5 gói (4 real2sim + 1 `.xosc` thường), 0 page/console lỗi. Ảnh `result.png` cho thấy hai biến thể trong viewport 1440×900. Chờ chủ xem; chưa commit/push.

### 2026-10-16 — Plan48 guided demo revision (P02)
Hoàn thành luồng 5 bước theo SPEC-P02 (Chọn xe → Chọn tình huống → Chỉnh tham số → Xem kết quả / so sánh cặp → Lưu/Xuất). Ego mở 20 template kịch bản, xe giao thông chạy 4 kind phản ứng thật (`brake`, `lane_change`, `accelerate`, `stopline`). Đã khắc phục lỗi `lane_change` khi xe (`car_154`) chỉ có cửa sổ sang phải bằng cách tự động chọn hướng/thời lượng khả thi trong `reactionChoice` và đồng bộ UI; sửa cơ chế tương tác slider của template trong test E2E; đảm bảo thư viện đồng bộ trước khi hiện màn kết quả. Typecheck 0, Vitest 61/61 pass, Build 0; kịch bản E2E Playwright thật (`test-unified-demo.mjs`) pass 8/8 bước, tạo và tự lưu 10 gói kịch bản thật (8 reactive snapshots, 1 template, 1 ordinary XOSC), tải và kiểm chứng tệp `.xosc`, 0 lỗi page/console. Ảnh chứng cứ đầy đủ tại `planning/48_2026-10-15_unified-scenario-demo/evidence/guided/`.

### 2026-10-16 — Tái thiết kế khối Số liệu Đo đạc & Đánh giá (2 Chế độ: Cơ bản & Kỹ thuật)
Theo phản hồi người dùng ("trong giao diện cơ mà thử trình bày lại đơn giản dễ hiểu nhưng vẫn có 2 chế độ cơ bản và kỹ thuật"):
- Tạo component mới `ScenarioMetricsView.tsx` thay thế hiển thị `Outcome` sơ sài cũ, hỗ trợ 2 chế độ chuyển đổi linh hoạt:
  + **Cơ bản (Simple, mặc định):** Ngôn ngữ tự nhiên, trực quan, dễ hiểu cho người không chuyên. Banner kết luận tình huống với icon (ShieldCheck, CheckCircle2, AlertTriangle) giải thích rõ tình huống ("Tránh được va chạm an toàn! Nếu không phản ứng (Baseline), xe sẽ đâm va chạm (0,00 m). Khi có phản ứng (Pilot), xe kịp thời phanh và dừng lại cách xe trước 9,86 m."). Hai thẻ so sánh lớn (Baseline: cự ly 0,00 m - đâm va chạm; Pilot: cự ly an toàn 9,86 m, delta +9,86 m xanh ngọc).
  + **Kỹ thuật (Technical):** Bảng đối chiếu 4 cột chi tiết (Thông số đo đạc, Baseline không phản ứng, Pilot có phản ứng, Đánh giá kỹ thuật) hiển thị Min Gap, Min TTC, Gia tốc phanh sử dụng `a_used`, Thời gian phản xạ Reaction (1,00 s IDM), Kiểm định hợp lệ kèm tags màu đạt chuẩn/lỗi.
- Bộ nhớ lựa chọn chế độ độc lập (`topeye.scenario.metrics.mode`), ghi nhớ khi người dùng chuyển đổi.
- Bổ sung CSS dark theme đồng bộ với hệ thống, thiết kế responsive trên màn hình điện thoại di động (không vỡ viền ngang, đạt `overflow <= 1`).
- Viết 4 bài unit test toàn diện cho `ScenarioMetricsView.test.tsx` (kiểm tra render Cơ bản, chuyển Kỹ thuật, kiểm tra điều kiện an toàn / cảnh báo lỗi).
- Kiểm tra Technical Quality Gates: `npm run typecheck` (exit 0), toàn bộ Vitest suite frontend (60 test files, 518/518 tests PASS), `npm run build` (exit 0, dist-local cập nhật), E2E Chrome Playwright (`test-unified-demo.mjs`, pass 8/8 bước).
- Đã xuất và lưu 2 ảnh chụp thực tế từ browser: `metrics-simple.png` và `metrics-technical.png`.


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
