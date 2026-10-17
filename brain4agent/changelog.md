# Changelog & Semantic Releases

Tất cả các quyết định kiến trúc và lịch sử nâng cấp phiên bản của dự án.

## v0.40.0 — 2026-10-17T19:36:25+07:00 (plan52)
- Sửa toàn bộ đánh giá tạo kịch bản: ego mẫu tự phanh IDM (dùng được 18→48/160, va chạm 28→5); lỗi hiện trong hộp thoại, khoá tạo khi map ✗, thẻ mẫu ✓/✗, ẩn tab AI giả, nút phụ vào Thêm; HTTP 400 cho lỗi người dùng; Tự tạo 3 bước, kiểm hợp lệ trước + chọn preset hợp lệ, mặc định phanh Vừa ≥2 s, hướng dẫn khi trống; tên dễ đọc; 2D tự khung. Chỉ nuScenes (AV2 ẩn, tệp chưa xoá). Nhanh hơn: mở 9,3→5,3 s, bật lại 3D 2,5→0,03 s, mở lại kịch bản 4,6→0,04 s, tạo xong→3D 9,9→6,7 s.
- BE836/FE558/server60 0 skip; typecheck/ruff/build 0; E2E local-web/workspace/unified/access PASS.
- Chủ xác nhận “xoá cả thư mục intake” 2026-10-17T19:43:46+07:00: đã xoá `backend/data/dataset-intake-20261013/` (31 GB: AV2 11 GB + bản sao nuScenes không dùng 20 GB + script tải). App vẫn đọc nuScenes ở ~/cvat-day2/…; gỡ test dùng dữ liệu AV2 thật (test_structures 8→7); BE835 (836−1) 0 skip; E2E access PASS; app 200.

## v0.39.0 — 2026-10-17T17:38:15+07:00 (plan51)
- “Dừng hẳn” = mục tiêu phanh mới `hold`: phanh tới dừng rồi đứng yên đến hết cảnh (trước đây nhãn này gắn `stop`+0 của replay-forge nên xe dừng 0 s rồi đi tiếp); 4 lựa chọn: Dừng hẳn · Dừng 3 s rồi đi tiếp · Dừng rồi đi ngay (=stop+0, giữ cho ô chỉ số) · Chậm lại 50%. Pilot (kịch bản người dùng tạo) mà ego chạm bất kỳ đối tượng nào ⇒ `ego_collision`, không hợp lệ, câu tóm tắt có “Cách sửa”; baseline + chỉ số cảnh giữ luật replay-forge. Mẫu/.xosc ego va chạm ⇒ ghi chú EGO_COLLISION, lưu nhưng đánh dấu không hợp lệ (từ chối sẽ mất 10/19 lần đặt mẫu). Studio: chip “Không hợp lệ”, băng đỏ + cách sửa + nút Sửa; timeline chỉ khi có kịch bản, chỉ ego + xe sự kiện + xe phản ứng (mẫu/.xosc: mọi đối tượng tác giả đặt).
- Đo: thật scene-0061 car_154 hold v sau dừng 0,0 (stop+0 chạy lại 3,67 m/s); mẫu Dừng khẩn cấp scene-1077 ⇒ EGO_COLLISION + băng/chip; BE834/FE557/server58 0 skip; typecheck/ruff/build 0; E2E local-web/workspace/unified PASS (timeline 2 hàng/kịch bản); mutation đỏ trên mọi bộ đo mới.

## v0.38.0 — 2026-10-17T16:19:03+07:00 (plan50, local technical gates)
- Trang Kịch bản = Scenario Studio 3 cột: danh sách cảnh (cảnh lỗi map mờ) + nút Tạo kịch bản (menu Có sẵn: 20 mẫu/.xosc/real2sim · Tự tạo: luồng phản ứng) · viewer 2D/3D, 2D vẽ baseline nét đứt + pilot nét liền cùng map, timeline mỗi xe một màu + mốc Tình huống/Phản ứng · lịch sử Sửa/Xoá/Phân tích/Lưu. Phân tích = trang chia mục (chỉ mục có số). Lưu = popup Xuất cho CARLA (.xosc OSC1.1 + <scene>_map.xodr port replay-forge map_roads + trajectories.csv + report.json nếu có + manifest.json) / Chỉ .xosc; trang Đã xuất: hàng đợi Node, mỗi job một tiến trình Python, tiến độ thật 0–100 %, tải zip, xoá vào .trash. CARLA chỉ nuScenes (AV2 mờ + worker CARLA_UNSUPPORTED).
- Sửa 2026-10-17T16:33:42+07:00 (chủ báo): chưa mở kịch bản thì timeline/nút Phát chạy trên cảnh gốc (`displayed = shown ?? source`), tiêu đề “Cảnh gốc · dữ liệu thật”; trước đó viewer hiện cảnh gốc nhưng Phát bị khoá (duration 0). Test hồi quy đỏ→xanh; Chrome thật scene-0061 Phát 0→2,5 s.
- Thẩm định độc lập 2026-10-17T16:49:22+07:00 🔁 → sửa: tải zip lỗi đọc không còn làm sập server (F1); job vừa tạo không bị đánh INTERRUPTED trước enqueue (F2); tiến trình không ghi đè failed (F3); chặn symlink exports/.trash/zip (F4); file gói mất ⇒ NOT_FOUND (F5); giữ comment XOSC (F7); D11 giữ dấu chấm trong tên gói. BE830/FE554/server58; E2E xuất CARLA lại PASS.
- Quyết định: D8 hàng đợi xuất ở server Node, mỗi job một tiến trình (poll tiến độ không kẹt sau worker JSONL); D9 Chỉ số cảnh nằm trong lớp Tự tạo; ScenarioWorkspace còn dùng ở chế độ nhúng `create`; tab lịch sử chạy esmini + xoá lần chạy bị bỏ khỏi UI (API giữ).
- Đo: .xodr scene-1077 khớp gói mẫu team 170/170 road, lệch 0 m; esmini chạy gói CARLA thật exit 0 (155 đối tượng); BE830/FE554/server58 0 skip; typecheck/ruff/build 0; E2E local-web 15 bước, workspace (20 cảnh 18 hợp lệ, CARLA→zip→esmini, AV2, EN/sáng, 1440/1050/390), unified (4 loại phản ứng, mẫu, .xosc, reload nhóm, Phân tích 6 mục, real2sim), access PASS; mutation đỏ trên mọi bộ đo mới.

## v0.37.1 — 2026-10-17T14:25:05+07:00
v0.37.1 PATCH: ô Cảnh nguồn đầu trang Kịch bản và bộ chọn Map trong Tạo kịch bản làm mờ (option disabled + lý do ở tooltip) các cảnh có map bị cổng `build_map_context` từ chối (mini: 0103, 0655). Worker chỉ số `map_status` = `validate_source_polygons` dùng chung với cổng thật trên vector map, không dựng LiDAR (~1 s/10 cảnh, cache theo dataset). Probe lỗi ⇒ không làm mờ; cổng thật vẫn chặn. FE541/server51/BE820 0skip; typecheck/build0; E2E chính PASS; E2E workspace (Chrome) khẳng định option mờ = đúng cảnh cổng thật từ chối: nuScenes [0103,0655], AV2 [].

## v0.37.0 — 2026-10-17T00:58:44+07:00 (local release verified)
- One Scenario workspace combines guided/detailed reaction,20templates/MapFit, strict XOSC and real2sim import, library/edit/export/trash/history and advanced metrics. Shared source, preferences and guarded jobs; old query is an alias.
- Durable authenticated group sidecar with raw event/hash validation, partial-pilot and link-only retries; no package/hash/parser/physics relaxation.
- Independent resource errors/retry, geometry preflight, boot/empty states, stale/cancel guards, readonly queue and same-dataset reload repair. Report actual ego collisions/reaction and missing values.
- FE538/server51/BE819 pass, no skips; browser13packages/5groups/reload,20scene classification18supported/2invalid,EN/light/mobile and mainweb5180 verified in Plan49. Owner visual acceptance remains separate.

## Audit / repair plan — 2026-10-17T00:06:42+07:00 (no product release)
- Plan49 audit: 11 findings +5 risks; FE524/525 (missing EN), server43/43, BE819/819;20scene map preflight18pass/0103+0655invalid; build/typecheck0. One Scenario tab spec ready; no production code changed.
- Findings reproduced on isolated browser account/workspace; auth/logout and measured source LiDAR work. Navigation consolidation is specified, not deployed.

## v0.36.1 — 2026-10-16T21:40:31+07:00
- v0.36.1: chọn dataset trên web chính mở thẳng cùng component/bộ nút demo (Có hướng dẫn/Chuyên sâu/thanh5bước). AccessApp initialGuided=true, chờ source load trước khi gọi API. Back trả công cụ cũ.72tests/typecheck/build pass;Chrome12bước12gói0lỗi.
- Owner correction: toolbar link alone was insufficient; use actual shared demo screen as default catalog entry. Same engine/API and source workspace return path.

## v0.36.0 — 2026-10-16T20:50:23+07:00 (mainweb local)
- v0.36.0 mainweb: Có hướng dẫn trên thanh công cụ, dùng cảnh đang chọn; quay về không gian làm việc. 71/71 focused tests, typecheck/build exit0; Chrome từ root URL 11 bước/12 gói/0 lỗi. Engine/API không đổi. Toàn bộ tương tác ego cùng làn chưa triển khai.
- Chủ dự án yêu cầu tích hợp web chính; preview query vẫn tương thích. Ba config frontend/package.json, package-lock và backend/pyproject đồng bộ phiên bản; không thay đổi dữ liệu người dùng.

## Preview Có hướng dẫn — 2026-10-16T20:37:00+07:00
- Có hướng dẫn mặc định: chọn ý định → gợi ý xe có ego theo sau → preset hợp lệ và thời điểm → hai kết quả thật → xuất. Chuyên sâu giữ 20 mẫu/tham số; engine/API không đổi. 70/70 tests, typecheck/build exit0, Chrome 9 bước/12 gói/0 lỗi, HTTP200. Chờ duyệt trải nghiệm; preview trên0.35.0.
- P03 replaces default vehicle-first P02; expert retains that flow. No release/version bump or backend changes.

## Preview chưa phát hành — Guided demo — 2026-10-16T20:23:50+07:00
- Luồng 5 bước: chọn xe → tình huống → tham số → so sánh → lưu/xuất; click ego mở 20 template, xe giao thông có 4 kind. Hai API cùng event sinh hai gói baseline/pilot thật, phát cạnh nhau cùng đồng hồ; tự lưu được nói rõ. Chọn sẵn hướng/thời lượng khả thi theo xe; khóa chuyển bước khi đang chạy. 66/66 test, typecheck/build exit0; Chrome 8 bước/10 gói/0 lỗi, quỹ đạo ego khác nhau. Chưa phát hành, chờ duyệt hình thức.
- Thay quyết định preview 2026-10-15 chỉ phát pilot: hiện phát hai gói thật. Template không có baseline/pilot phản ứng. Cặp chỉ liên kết trong phiên; mở gói lẻ sau reload ghi rõ giới hạn.

## Preview chưa phát hành — Unified scenario demo — 2026-10-15
- Theo yêu cầu người dùng, thêm demo một cảnh `scene-0061` tại `?unified-demo=1`: “tạo phản ứng” dùng `importReactive` thật để sinh gói `.xosc` + report; “nạp .xosc” dùng `importXosc` thật; hai nhánh gặp nhau ở thư viện, map/3D, báo cáo và xuất. Parser/cổng kiểm dữ liệu và giao diện mặc định không đổi.
- Chrome workspace/tài khoản tạm: phản ứng `truck_138_t0.0_stop_a4` 228 đối tượng, mở lại được, xuất `.xosc` có OpenSCENARIO root; `.xosc` thường sinh từ đúng map đã nạp qua cổng nghiêm ngặt và hiện cùng thư viện; 0 page/console error. Build/typecheck/47 test liên quan đạt. Chờ người dùng duyệt demo trước khi thiết kế bản hợp nhất chính thức; phiên bản giữ 0.35.0.
- Sau góp ý của người dùng, preview có click ego và xe giao thông trên map; bốn kind phanh/tăng tốc/dừng vạch/chuyển làn dùng contract Plan47. Baseline/pilot hiển thị trên map ngay khi phát lại, lấy số đo thật từ `report.topeye.comparison`; map phát lại pilot. Chrome scene-0061 tạo đủ bốn kind từ `truck_138`, thêm `.xosc` thường thành 5 gói chung thư viện, 0 lỗi; 55/55 test liên quan và build đạt. Ego chỉ là xe phản ứng theo engine hiện hành.

## v0.35.0 — Reactive kinds and workspace — 2026-10-15 (local technical gates)
- Thêm sự kiện `accelerate`, `stopline`, `lane_change` vào engine, API/gói real2sim và chỉ số 2 theo kind; giữ nguyên phép đo brake 10 cảnh 777/225/591/18 (DIFF0).
- Cửa sổ t0 riêng theo kind; từ chối dừng ở vạch nếu không thể giảm tốc hợp lệ. Mỗi ô lưới kind mới điền được cùng contract vào UI.
- Workspace Phản ứng theo ảnh chủ dự án chốt: chọn xe trên bản đồ, timeline, inspector, hai chế độ hiển thị và dock báo cáo/chỉ số. Đổi cảnh tải lại source và loại bỏ lựa chọn cũ.
- Đo local: backend 819, frontend 505, server 43 bài đều đạt; typecheck, build, Ruff đạt. Bảng 10 cảnh: tăng tốc 696/677/532/1, dừng vạch 53/16/36/0, chuyển làn 221/130/132/2 (thử/baseline/pilot/hiếm). Chủ dự án còn duyệt ảnh từng kind/hình thức trước khi đóng Plan47.

## v0.34.0 — Full replay-forge measurement, baselines and glossary — 2026-10-15T19:09:48+07:00
- Nhập nốt phần đo đạc của replay-forge (thành viên nhóm, @ d36205b).
- **Mỗi kịch bản phản ứng** — `report.json["topeye"]`:
  - baseline (không ai phản ứng) và pilot (phản ứng) trên cùng sự kiện;
  - 7 điều kiện hợp lệ có số đo;
  - biểu đồ tốc độ/gia tốc/gap/TTC có bản ghi;
  - mốc sự kiện, trạng thái từng xe;
  - câu kết luận;
  - thử độ nhạy 0,7/1,0/1,5 s.
- **Theo cảnh** (worker chỉ số):
  - **chỉ số 2** `reactive_metrics`: lưới cố định, baseline vs pilot, lần phanh, ca hiếm tìm sẵn, không gian tham số, độ nhạy;
  - **chỉ số 1** `replay_error_metrics`: ADE/FDE/max/yaw/vRMSE exact/baseline/pilot qua esmini + kiểm chéo mốc giấu + dữ liệu gốc từng vật thể.
- **Kiểm bằng esmini** từng gói (`esmini_check`, cache cạnh gói ngoài hash):
  - gói team không kèm `.xodr` ⇒ "không kiểm được", không phải ✗.
- **48 thuật ngữ** có dấu ?: 43 của replay-forge + 5 tên nhóm; một nguồn `help/terms.ts`.
- **Nghiệm thu bằng số đã công bố của replay-forge, 10 cảnh mini:**
  - chỉ số 2: 777/225/591, hiếm 18;
  - độ nhạy: 607/0, 493/41;
  - **0 khác biệt trên 4×777 biến thể**;
  - chỉ số 1: ADE moving 1,771/0,098; holdout 0,091/1,983/0,133.
- **Quyết định:** engine (phản ứng + chỉ số) dùng ego ở mốc nhãn 2 Hz như replay-forge; màn xem nguồn giữ ego dày.
- **Thẩm định đối kháng (Codex)** tìm 3 lỗi chặn, đã sửa:
  - cache esmini trước kiểm hash;
  - vắng mặt theo từng mốc;
  - physics.passed khi vượt ngưỡng.
- **Sửa phụ:**
  - local-server sập khi request tới lúc đóng (`server.address()` null) ⇒ trả 503;
  - server đọc hết thân POST > 8 MiB trước khi trả 400 (tránh treo fetch);
  - xoá gói giữa lúc tính chỉ số ⇒ `NOT_FOUND`.
- **Đo:**
  - backend 792, vitest 471, server 43, tsc/build 0;
  - E2E Chrome scene-0061 (chỉ số 2 → chỉ số 1 → Xem ca hiếm → báo cáo 8 khối → esmini → độ nhạy → dấu ?) PASS;
  - hồi quy PASS.
- **Điều phối Orca:**
  - Claude: WP1/3/4/5/7;
  - Codex: WP2/6/8;
  - WP4 Codex lỗi khởi động ⇒ Claude.
- [Plan46](../planning/46_2026-10-15_reactive-metrics/plan.md).

## v0.33.0 — Reactive scenarios + human-like template motion — 2026-10-15T14:36:09+07:00
- **Kịch bản phản ứng** (học từ repo `replay-forge` của thành viên nhóm, tác giả cho phép, @ d36205b). Tab "Phản ứng" trong Tạo kịch bản:
  - chọn một xe thật đang có xe bám theo, cho nó phanh/dừng/chậm 50%;
  - các xe phía sau (kể cả ego) phản ứng như người lái: IDM cải tiến, phản xạ 1 s, giới hạn độ giật, xe nặng phanh tối đa 5 m/s²;
  - vật thể khác phát lại `pilot`;
  - kiểm hợp lệ (chồng hộp, bám đuôi, nhãn lỗi, chưa hỗ trợ) + nhóm hiếm (collision/hard/close/mild/far).
- **Đầu ra:** gói real2sim, nạp qua đường plan43 (`parse_package`), KHÔNG qua `validate_xosc`. Lý do: cảnh thật > 32 actor; tab Số liệu đọc được ngay.
- **Mã nguồn mới:**
  - `backend/topeye/scenario/reactive.py`, `reactive_package.py`;
  - worker `reactive_candidates`/`import_reactive`;
  - server `reactiveCandidates`/`importReactive`;
  - `authoring/ReactiveForm.tsx`.
- **Template:** gia tốc giới hạn độ giật (phanh 10 / thường 3 m/s³), nhả ga trước khi phanh, bus/truck phanh ≤ 5 m/s². Fit 5 cảnh × 20 loại 44 → 45/100.
- **Đo:**
  - quét 100 sự kiện / 3 cảnh: 39/100 hợp lệ, trùng replay-forge (thẩm định độc lập R04 tìm ra lỗi tâm hộp ego lệch 1,39 m, đã sửa);
  - backend 763, vitest 445, server 42, tsc/build 0;
  - E2E Chrome thật scene-0061: car_154 chậm 50% a=4 ⇒ 228 actor, hợp lệ, `mild`, tạo 4,9 s; hồi quy E2E PASS.
- **Sửa phụ:** nhãn sự kiện `half` hiện "chậm lại 50%" ở báo cáo real2sim.
- **Điều phối:** Orca, Claude P01/P03, Codex P02/P04; agy dừng vì lỗi xác thực 401, Claude tiếp quản. [Plan45](../planning/45_2026-10-15_reactive-events/plan.md).

## v0.32.1 — Instant view switching, red active tab — 2026-10-15T09:38:53+07:00
- Đổi Cảnh nguồn ⇄ OpenSCENARIO không còn dựng lại cảnh 3D: hai màn luôn mount, màn ẩn giữ props cũ và `TrackView active=false` bỏ qua vẽ. Đo Chrome thật: long task 2,5–2,7 s mỗi lần đổi ⇒ không còn; phát vẫn 60 fps. Icon rail tô đỏ theo màn đang hiện. vitest 436, server 41, E2E hồi quy PASS. [Plan44](../planning/44_2026-10-15_tab-switch/plan.md).

## v0.32.0 — Import team real2sim packages — 2026-10-15T09:16:00+07:00
- Thư viện OpenSCENARIO nạp được **gói real2sim** của team (thư mục `.xosc` OSC 1.1 + `report.json` + `trajectories.csv`): đường nạp riêng `topeye/scenario/real2sim.py` (`kind: "real2sim"`), KHÔNG nới `validate_xosc` của kịch bản tự tạo. Chỉ nhận hành vi phát lại (Teleport, FollowTrajectory position, Add/DeleteEntity theo thời gian); action khác bị từ chối có tên. Map/động học = ghi chú không chặn (`MAP_NOTE_*`, `DYNAMIC_NOTE`).
- Tab "Số liệu" của gói real2sim = **Báo cáo kịch bản** từ `report.json` (kết luận, sự kiện, ego mô phỏng vs bản ghi, tài xế phản ứng, động học, va chạm, esmini, nguồn gốc) + ghi chú map của app; không tính `scenario_metrics`. Sửa bị khoá.
- Gói mẫu `car_013_t01.0_stop_d3_a8` qua Chrome thật: 73 đối tượng, 31 ghi chú, nạp 4,7 s, mở lại kiểm hash đạt; backend 731, vitest 435, server 41. [Plan43](../planning/43_2026-10-15_real2sim-import/plan.md).

## v0.30.1 — No code when a scenario has no template — 2026-10-13T15:46:53+07:00
- Gói không có template.json (nạp .xosc hoặc tạo trước 0.30.0): Sửa không mở XML nữa; có "Tạo lại bằng template" trên cùng map (thay thế gói, cũ vào .trash) và "Sửa XML (nâng cao)". Chrome + E2E thật PASS; backend 702, vitest 426, server 40. [Plan38](../planning/38_2026-10-13_scenario-authoring/plan.md).

## v0.30.0 — Edit template scenarios as templates — 2026-10-13T15:26:50+07:00
- Gói tạo từ template lưu `template.json` cạnh `import/` (ngoài hash); "Sửa" mở form template điền sẵn, "Lưu thay đổi" tạo gói mới qua `validate_xosc` rồi đưa gói cũ vào .trash. Chỉ gói nạp từ .xosc còn sửa XML (có giải thích).
- Đổi tham số chính giữ đối tượng/tình huống người dùng tự thêm. Chrome: sửa 40→30 km/h giữ phanh ego, gói cũ vào .trash. Backend 702, vitest 425, server 40. [Plan38](../planning/38_2026-10-13_scenario-authoring/plan.md).

## v0.29.1 — Hard brake goes to ego — 2026-10-13T15:02:16+07:00
- Lỗi: "Phanh gấp" thêm vào template mặc định gắn cho đối tượng đầu tiên không phải ego (người đi bộ) nên ego không dừng. Giờ mặc định ego, "Phanh gấp" chỉ cho phương tiện (FE+BE), sơ đồ ghi tên đối tượng. Đo lại trên Chrome: ego 11,1 m/s → 0 sau ~2,3 s. Backend 702, vitest 423, server 40. [Plan38](../planning/38_2026-10-13_scenario-authoring/plan.md).

## v0.29.0 — Suggest usable maps for a scenario type — 2026-10-13T14:27:33+07:00
- Chọn loại kịch bản là app kiểm luôn mọi map bằng cổng thật: worker `template_fit` (chỉ đọc, trên worker chỉ số, cache) biên dịch template + `validate_xosc` trên từng cảnh; UI "Map phù hợp" hiện ✓ (điểm đặt, lật) / ✗ (lý do), bấm để chọn map, kiểm lại khi đổi tham số.
- Đo thật 10 cảnh mini: Dừng khẩn cấp 3/10 (16,5 s lần đầu), Xe cắt làn 2/10 (3,4 s). Backend 701, vitest 421, server 40, build exit 0. [Plan38](../planning/38_2026-10-13_scenario-authoring/plan.md).

## v0.28.0 — Create scenarios from templates — 2026-10-13T14:04:01+07:00
- "Tạo từ template" chạy thật: worker `import_template` biên dịch template (`backend/topeye/scenario/template.py`) → profile XOSC → cùng cổng `validate_xosc` → lưu gói như nạp file. Server `importTemplate` (≤256 KiB, source_id 32 hex); UI kiểm client trước, lỗi hiện trên dialog.
- Đặt kịch bản dọc quỹ đạo thật của ego nguồn (x dọc, y trái) nên bám đường cong; `placement.auto` thử vị trí khác gần nhất + lật trái/phải (Singapore đi bên trái); mô hình chuyển động: tốc độ tuyến tính, chuyển làn nửa cosin, bo góc Chaikin.
- `export.trajectory_xml` (không giới hạn 2–4 actor của luồng trích xuất) + `xosc_import.profile_xml` dùng chung với fixture; `check_map` thêm `at t=…s`. Toast lỗi runner nằm trên dialog.
- Đo thật 5 cảnh × 20 loại: 44/100 tạo được, ca hỏng có lý do map/vật lý. Backend 700, vitest 420, server 39, build/diff-check exit 0. [Plan38](../planning/38_2026-10-13_scenario-authoring/plan.md).

## Quyết định 2026-10-13T11:59:23+07:00 — Plan38 scenario authoring (chưa phát hành, chưa bump)
- Template cấp cao `topeye-scenario-template-v1` biên dịch xuống profile XOSC duy nhất; KHÔNG mở rộng profile. AI chỉ sinh template, người duyệt, rồi qua `validate_xosc` (P02).
- Gallery 20 loại / 5 nhóm (Euro NCAP AEB/LSS + NHTSA pre-crash); toạ độ ego-frame, anchor trên map ở P02, không bịa làn.
- P01 UI + mock AI: 412 FE (+38) / 38 server / build pass. Bump 0.27.0 khi P02 đóng.

## v0.27.0 — Bridge trusses and overhead structures from LiDAR — 2026-10-13T13:19:05+07:00
- Road-relative structures (`backend/topeye/scenario/structures.py`): tall continuous runs on BOTH sides of the driven road (bridge truss, tunnel walls) become `environment.barriers` (kind corridor) drawn as a steel frame on the road surface; their band no longer yields facades/tree crowns. Overhead decks/ceilings only where the ego drove under (`environment.overheads`). Buildings stand on the local road level.
- Measured on the 20 local scenes: corridor only on AV2 02678d04 (the truss bridge, both trusses), 0 false positives; overheads 0. Rejected single-edge heuristics (false railings in 19/20 scenes). nuScenes ego z is always 0, so no elevation there.
- Backend 681, vitest 416, server 38; local + access E2E pass; 6 mutations red. [Plan39](../planning/39_2026-10-13_bridge-structures/plan.md).

## v0.26.1 — Runner polish and recoverable history deletion — 2026-10-13T11:12:46+07:00
- Camera controls bottom12px; real trajectory markers thinned for display on separate rail, source/snap timestamps unchanged; remove timeline footer.
- Confirmed single-run history deletion moves only selected result into workspace .trash; strict IDs/symlink/running guards preserve scenario and other runs. No owner history deleted by agent.
- Browser found metrics pending on leave/return stuck at loading; completion now checks current scenario identity. Regression and intentional old-behavior mutant measured.
-673backend/374frontend/38server pass; build/lint pass; independent4attacks pass; real E2E16steps, metadata13unchanged,0worker leaks. [Plan37](../planning/37_2026-10-13_runner-polish/plan.md).

## v0.26.0 — OpenSCENARIO timeline and tabs — 2026-10-13T10:53:19+07:00
- Approved2:1 layout: actual3D/playback/XOSC object timeline left; library/metrics/history tabs right, fixed create footer. Preserve map and all existing metrics. Saved history aggregates real library runs with names/dates.
- Motion spans from source vertex displacement/time (>0.1m/s); blank outside coverage; exact pointer snap and keyboard seeking share playback time. No backend schema or engine execution changes.
-371frontend/37server pass; build/typecheck pass; parent37focused +31history tests; independent arithmetic/keyboard mutations red. Real E2E15steps, ratio2.000036, footer900px,13metadata unchanged,0owned worker leaks. [Plan36](../planning/36_2026-10-13_runner-timeline/plan.md).

## v0.25.0 — Full settings page — 2026-10-13T10:33:47+07:00
- Rail "Cài đặt" opens a full page (views stay mounted). Sections: Giao diện, Hiển thị 3D (starting camera, shadows, ego corridor), LiDAR (colour by height/intensity/distance, point size), Phát lại (0.5×/1×/2×, autoplay, loop), Đơn vị (km/h, m/s), Ngôn ngữ (Tiếng Việt/English), Dữ liệu & lưu trữ (dataset, save folder, sizes, clear metrics cache, empty trash), Tài khoản (change password, session length, sign out), Góp ý nhà sản xuất, Thông tin (version, shortcuts, licences).
- Keyboard: Space, ←/→, Home/End, Esc. Display preferences per browser (`preferences.ts`).
- Server: `auth/password` (verifies current password with the login throttle, rotates sessions), `auth/sessionHours`, `storageInfo`, `clearMetricsCache`, `emptyTrash`, `submitFeedback`/`listFeedback` (stored in userData/feedback; nothing sent over the network).
- English UI via `t()` keyed by Vietnamese text (`i18n.ts`, `i18n.en.ts`, 346 keys; test forbids missing keys). Server error messages and number formats stay Vietnamese.
- Vitest 365, server 37, typecheck/build, local E2E 14 steps + access E2E pass; 7 mutations red. [Plan35](../planning/35_2026-10-13_settings-page/plan.md).

## v0.24.0 — Settings: light/dark theme and graphics quality — 2026-10-13T09:41:34+07:00
- Owner request: "Môi trường" (weather) removed from the rail — weather will move into scenario authoring; the 3D view stays on ClearNoon (`EnvironmentMenu.tsx` kept for that work).
- "Cài đặt" (also in web demo): Giao diện Tối/Sáng/Theo hệ thống (`.studio[data-theme]`, colors moved to CSS tokens; 3D HUD overlays stay dark in both) and Chất lượng đồ hoạ Tự động/Cao/Cân bằng; both remembered per browser (`preferences.ts`, localStorage wrapped). Dataset/save folder/model credits only in the local app.
- Vitest 351, server 30, typecheck/build, local E2E 14 steps + access E2E pass; light/dark screenshots checked.

## v0.23.2 — Settings replaces Warnings and Data on the icon rail — 2026-10-13T09:30:31+07:00
- Owner request: rail items "Cảnh báo" and "Dữ liệu" removed; one "Cài đặt" item (bottom) holds dataset in use/change and save folder. Data warnings remain in the 3D view's "⚠ N cảnh báo dữ liệu" chip. Rail: Mở rộng · Cảnh nguồn · OpenSCENARIO · Môi trường · Cài đặt.
- Vitest 351 pass; local E2E 14 steps + access E2E pass.

## v0.23.1 — Faster AV2 opening — 2026-10-13T09:22:19+07:00
- AV2 adapter transforms all cuboids of a log in one numpy/scipy batch (6.3 s → 1.2 s for 10 logs; annotation poses equal within 1.8e-12 m).
- Worker keeps the adapter built by `inspect_dataset` as a spare, used when that dataset becomes active (no second load); inspection still never changes the active dataset.
- Source static environment processes LiDAR sweeps in a thread pool, frame order kept, cancel stops pending sweeps (AV2 scene 11.2 s → 7.6 s, identical buildings/trees/poles). Rejected: 2 Hz sweep sampling (3× faster but −25% buildings, −40% trees/poles).
- AV2 open path inspect+list+source: 25 s → 10 s. Backend 667 pass; local E2E 14 steps + access E2E pass.

## v0.23.0 — Local login, dataset library and native AV2 — 2026-10-13T01:55:58+07:00
- Username/password local account → racing-style dataset cards + equal-size add tile. Salted scrypt, session cookie, auth gates and independent revocation/preview probes.
- Native AV2 Sensor adapter preserves raw data, applies ego→city pose once, reads each log's vector map and measured LiDAR. Downloaded10 validation logs (30,362 files/11.6GB); reused nuScenes mini10. No incomplete trainval catalog entry.
- Backend666/frontend350/server30 pass; final AccessApp4/build pass; access browser0errors; existing runner14steps/0owned workers left/13metadata unchanged; 10AV2 scene smoke pass; independent7security probes pass. [Plan34](../planning/34_2026-10-13_dataset-intake/plan.md).

## v0.22.0 — Automatic scenario metrics in the OpenSCENARIO runner — 2026-10-13T01:04:08+07:00
- Runner report column (under Map 2D) shows "Chỉ số kịch bản", computed automatically on a third worker when a scenario opens; cached in `<workspace>/<id>/metrics/`. Backend `scene_metrics.py` + worker `scenario_metrics`; server `scenarioMetrics`; UI `MetricsPanel.tsx`. (First cut as a separate rail tool measuring source scenes was rejected by the owner.)
- Definitions (SPEC §1, scene-metrics-v3): pilot = the scenario's own XOSC replayed in esmini 3.9.0 vs its trajectory vertices; baseline = constant velocity from the first two vertices. Rare: TTC < 1.5 s with ego ≥ 5 m/s (v1 distance rule / v2 without ego speed rejected after measuring 10 nuScenes scenes).
- E2E found: deleting a scenario mid-measurement → raw errno and possible re-creation of its folder; now NOT_FOUND, `mkdir` without parents, engine scratch in system temp. Owner scenario: Topeye 0.000 m vs baseline 7.81 m. Backend 659, frontend 346, server 17, E2E 14/14. [Plan33](../planning/33_2026-10-13_scene-metrics/plan.md).

## v0.21.1 — Loading overlay, end-of-scene pose fix, request queue — 2026-10-13T00:15:54+07:00
- Loading overlay (spinner + "Đang tải dữ liệu") from load start until TrackView draws the first frame (onReady).
- End of scene no longer hides the scene with "Thiếu pose": pose t_s are rounded to 1 µs but interval ends are not (scene-0061/1094 off by ~1.7e-7 s); supportedPose tolerance 1e-7 → 1e-6.
- Worker bridge queues requests instead of returning BUSY (two tabs/reload left one tab blank). Frontend 343, server 16, E2E 13/13. [Plan32](../planning/32_2026-10-13_loading-end/plan.md).

## v0.21.0 — Runner: 2D map replaces the esmini run block — 2026-10-13T00:01:36+07:00
- Owner: removed "Chạy ESMINI"/"Chạy lại kịch bản này"; the 2D map (with legend) now heads the report column and the minimap overlay on 3D is gone. The UI can no longer start esmini; latest result/history come from saved runs. Backend replay_imported + real-engine backend tests unchanged; E2E 13/13 without run steps. [Plan31](../planning/31_2026-10-12_runner-map/plan.md).

## v0.20.0 — Scenario library management — 2026-10-12T23:43:28+07:00
- Owner: library header buttons and per-row checkboxes removed; "Chạy kịch bản đã chọn" → always-red "Tạo kịch bản" (dialog: map · download map context · pick .xosc); per-row icons Xuất/Sửa/Xoá. Batch run removed. Edit = XML editor + rename, saved via the normal validation as a new package, old one trashed only on success. Delete = confirm → `<workspace>/.trash`. Unnamed packages show the XOSC FileHeader description.
- 21 E2E mockup packages (fixture hash) moved to ~/.Trash. E2E now cleans up its own scenarios. Found by E2E: create button ignored clicks while busy → always opens now.
- Backend 649, server 15, frontend 339, E2E 16/16. [Plan30](../planning/30_2026-10-12_scenario-manage/plan.md).

## v0.19.2 — Fix scene view after visiting the runner — 2026-10-12T23:17:36+07:00
- Bug (owner): after opening a scenario in the OpenSCENARIO runner, returning to Cảnh nguồn still displayed the imported scenario (simulated LiDAR, ego-only map, 2 s timeline). Views shared one `scenario`. Fix: scene view always shows the loaded source; runner scenario/result kept in a snapshot and restored on return. Regression test + 2 mutations red; Chrome repro now measured LiDAR; E2E 14/14. Scene drawer narrowed to 200 px (owner). [Plan29](../planning/29_2026-10-12_lidar-return-fix/plan.md).

## v0.19.1 — Source scenes as a list — 2026-10-12T23:07:16+07:00
- Scene drawer lists every scene (name · duration · objects); click opens it, re-clicking the loaded scene returns to its original data without reloading. Removed the "Xem cảnh gốc" button and the map toggle; the integrated map is always shown. Frontend 337/337, E2E 14/14. [Plan28](../planning/28_2026-10-12_scene-list/plan.md).

## v0.19.0 — Remove extract/variant/verification from the UI — 2026-10-12T23:00:56+07:00
- Owner request: the UI no longer offers Trích đoạn, Biến thể, Kiểm chứng; also removed Xuất kịch bản, click-to-select vehicles and the timeline extract window (only served extraction). Picking code and CSS deleted. esmini runs only through the OpenSCENARIO runner. Backend/worker/server/CLI extract/variant/replay/export unchanged.
- Frontend 336/336, typecheck 0, E2E 14/14 (cancel/re-run now in the runner). [Plan27](../planning/27_2026-10-12_drop-extract-ui/plan.md).

## v0.18.0 — Icon rail shell + dedicated OpenSCENARIO runner — 2026-10-12T22:52:25+07:00
- Owner-approved mockup C: brand-only top bar ("Topeye"), icon rail with expand/collapse on top and per-tool drawers, status bar removed (sr-only live region + top-bar progress/cancel + error toast). Camera buttons flush bottom-left, warning chip bottom-right in 3D.
- OpenSCENARIO runner: workspace library (worker `list_imported`, display_name from the uploaded file name), status per package, batch run queue (sequential, continue on failure, cancel stops), latest result, actor table, run history, diagnostics.
- Bug found by E2E and fixed: entering the runner read the library outside the job lock, so the next action hit BUSY.
- Backend 647/647, server 14/14, frontend 341/341, E2E 20/20 (real batch of 2 → Đạt/Đạt). [Plan26](../planning/26_2026-10-12_icon-rail-runner/plan.md).

## v0.17.1 — Chrome-free sensor panels — 2026-10-12T22:07:50+07:00
- Owner request: removed panel title bars, guides, captions, LiDAR −/+/Top/Tilt buttons and map zoom buttons; only a floating expand control per panel; map keeps the class legend. Simulated LiDAR keeps a small "MÔ PHỎNG" tag (reason in tooltip) so it is never mistaken for measured data. Double-click resets views (LiDAR 3D → top view).
- worker-bridge: EPERM on the first SIGTERM (exited, unreaped leader) now falls back to the leader PID. E2E 19/19 twice, frontend 336/336, server 13/13. [Plan25](../planning/25_2026-10-12_clean-panels/plan.md).

## v0.17.0 — Usable layout + orbitable 3D LiDAR — 2026-10-12T21:50:59+07:00
- Measured LiDAR is now a Three.js point cloud with OrbitControls (drag up/down tilts, sideways orbits, right-drag pans; Top/Tilt presets; render on demand).
- Layout: header "Dữ liệu" menu (dataset/workspace) + sidebar toggle; sticky run step; variant step collapsed until an extract exists; sentence-case sidebar labels; extract window shaded on the source timeline; dismissible error toast; 3D data warnings in a chip; click-to-select tracks on 3D (raycast, ≤4 px) and map (only extractable tracks; drag capture deferred ≥3 px, post-drag click suppressed).
- Frontend 336/336, server 13/13, backend 643/643, E2E 19/19; 2 new mutations red→green. [Plan24](../planning/24_2026-10-12_layout-lidar3d/plan.md).

## v0.16.0 — Measured LiDAR, drag-to-pan sensors, panel expand — 2026-10-12T21:31:54+07:00
- LiDAR panel now draws the measured nuScenes LIDAR_TOP sweep nearest the timeline (ego frame, height-coloured canvas, offset shown) for source scenes and baseline extracts/replays; variants and imported XOSC keep the labelled 180-ray simulation (no recording matches moved actors). New worker method `lidar_frame` served by a dedicated LiDAR worker so timeline reads never hit BUSY or touch workspace recovery.
- `useViewTransform` (drag-to-pan + 0.5–8× zoom, ⌖/double-click recentre) for LiDAR and map; expand/restore button on 3D, LiDAR and map panels (Esc restores).
- Fixed: server shutdown threw on macOS EPERM when a worker group had only an exited leader; dataset switch no longer kills the LiDAR worker mid-request.
- Backend 643/643, frontend 329/329, server 13/13, E2E 17/17 (34,750 measured points on scene-0103); 4 mutations red then green. [Plan23](../planning/23_2026-10-12_lidar-layout/plan.md).

## v0.15.0 — Drop Electron desktop app — 2026-10-12T19:37:49+07:00
- Owner decision: remove the desktop app; the localhost web app (`npm run web:local`) is the only runtime. Cloudflare Pages project `topeye-demo` deleted (first API call failed with Cloudflare 8000000, retry succeeded; project list empty).
- Removed electron/, scenario.html, desktop dev/package/test scripts, PyInstaller entry and `sys.frozen` branches, electron/@electron/packager/pyinstaller deps. `npm run build` now builds dist-local. New `scripts/test-local-web.mjs` (`npm run test:e2e`) replaces the installed-app acceptance.
- Gates: typecheck 0, frontend 320/320, server 12/12, backend 638/638, build 0, E2E 14/14 (metadata 13 unchanged, 0 workers left, 0 external), `npm ls electron` empty. Installed `.app` copies and gitignored release/build artifacts left untouched. [Plan22](../planning/22_2026-10-12_drop-desktop/plan.md).

## v0.14.0 — Full-feature localhost web — 2026-10-12T19:24:40+07:00
- `npm run web:local`: Vite mode `localweb` → `dist-local/` + `frontend/server/local-server.mjs` (Node, 127.0.0.1 only) bridging the unchanged Python worker over JSONL; `httpApi.ts` implements DesktopAPI over fetch + SSE. All desktop features work in the browser; native dialogs → path prompt / file upload / download.
- Architecture decision (owner): invariant "no HTTP daemon" relaxed to "no public/remote server; opt-in localhost server". Per-run token, Host/Origin checks, static path containment, Electron allowlist mirrored.
- Frontend 320/320, server 12/12 (mutation-red on token/Host), E2E 14/14 real dataset + esmini (dataset, source, extract, replay, free variant, export, map context, import/run/reopen XOSC, cancel + recover); metadata 13 files unchanged; clean shutdown 0 workers. [Plan21](../planning/21_2026-10-12_local-web-full/plan.md).

## v0.13.0 — Static web demo for feedback — 2026-10-12T17:02:42+07:00
- New build target `npm run build:web` (Vite mode web → `dist-web/`), same ScenarioApp over `staticApi` (DesktopAPI backed by precomputed JSON); `Settings.mode` optional field is the only contract change. Desktop build/IPC unchanged.
- `backend/scripts/export_web_demo.py` exports worker responses (10 sources, 5 extracts, 3 variants, 8 real esmini replays, 5 genuine backend rejections as `skipped`), sha256 manifest, dataset metadata guard; 6.2 MB / 1.7 MB gzip.
- Unlisted hosting decision (owner): noindex headers + robots; Cloudflare Pages chosen; feedback URL pending (button hidden until set).
- Codex ×2 in parallel (both hit usage limit before reports); orchestrator verified and fixed missing site `index.html` and favicon 404. Frontend 314/314, backend 638/638, installed `~/Applications/Topeye 0.13.0.app` desktop test PASS; local web smoke: 10 scenes, replay + 3 variants pass thresholds, 0 external requests, 0 console errors. Deploy pending owner login. [Plan20](../planning/20_2026-10-12_web-demo/plan.md).

## v0.12.4 — Audit fixes before web demo — 2026-10-12T16:40:51+07:00
- Toolchain: Vite 5.4→8.3.4, Vitest 2.1→5.0.3, plugin-react 4.7→6.1.2; shadcn/@tailwindcss/vite/gaussian-splats moved to devDependencies; unused autoprefixer/postcss direct deps removed. `npm audit --omit=dev` 0; full audit 2 critical/8 high → 0 critical/7 high, all inside the dev-only shadcn CLI (braces advisory, no upstream fix). Packaged app never contained node_modules (only dist + electron), so shipped exposure was nil before and after.
- Legacy viewer entry removed from production build (`dist/` no longer ships legacy/gaussian-splats chunks); legacy source and tests kept. Root clean: removed stray patch_app.py and .vite cache, `.vite/` ignored. docs/scenario.md and roadmap Active refreshed to 0.12.3+.
- Work split: Codex (deps/build, report 🔁 only for the 7 dev-only high) + orchestrator re-measure; agy launch was blocked by the local permission classifier, docs done by orchestrator. Frontend 282/282 0 skip, typecheck/build/package exit 0, installed `~/Applications/Topeye 0.12.4.app` desktop flow + real esmini + cancel + dataset integrity PASS. [Plan19](../planning/19_2026-10-12_audit-fixes/plan.md). No commit/push.

## v0.12.1 — Map polish & faster scene load — 2026-10-10T15:20:28+07:00
- Integrated map no longer paints nuScenes stop_line regions (the broken light patches); header buttons all 210×34 px (168×34 ≤1150 px); LiDAR-estimated trees/poles on the road or observed vehicle paths are omitted from display (raw kept; 0 left on the road in 10 scenes).
- Faster load with byte-identical scenes: backend 31.7 → 18.1 s for 10 scenes; installed app first scene switch median 4.6 → 3.2 s, revisit 4.6 → 1.2 s (worker in-memory LRU, 12 scenes, 13.4 MB for mini).
- Backend 623 / frontend 279 pass, 0 skip; package exit 0; UI gate red on 0.12.0 (widths, heights) then green; plan15 regression, imported, legacy gates PASS. `~/Applications/Topeye 0.12.1.app`; 0.12.0 rollback. [Plan16](../planning/16_2026-10-10_map-load-polish/plan.md). No commit/push.

## v0.12.0 — Vehicle style, lamps, cabin view, class map — 2026-10-10T13:45:47+07:00
- Bus/truck (and trailer/construction) procedural bodies in the GLB car grayscale palette; all vehicles show fixed front-white / rear-red lamps (presentation only, no brake/indicator inference); GLB lights split by position.
- New 3D camera mode "Trong xe" (driver eye of ego); integrated map colours actors by class with a legend (3D/LiDAR unchanged); gap corridor fades from ego to the nearest lead vehicle and stops at its rear.
- Frontend 277 / backend 619 pass, 0 skip; typecheck/prettier/package exit 0; 16 mutations red. Two audits (🔁 → fixed). Audit fixes: bus/truck lamps/glass were buried in the body, cabin eye was lifted to ~2.2 m by orbit clamps, legend counted off-frame actors. Installed 0.12.0: 4 scenes × 3 camera modes 0 renderer errors, cabin eye 1.20 m, corridor stops at lead (32.73 m), legend computed colours verified, 10 switches 96 geometries/1 texture, 0061 p95 9.3 ms; imported (map_id unchanged, max XY/yaw 0) + legacy gates PASS.
- `~/Applications/Topeye 0.12.0.app`; 0.11.0 kept for rollback. [Plan15](../planning/15_2026-10-10_vehicle-lights-map/plan.md). No commit/push.

## v0.11.0 — Ground & static contact — 2026-10-10T12:35:21+07:00
- Optional `Environment.presentation` (schema 1): LiDAR ground cells + labelled inferred annotation-foot anchors, cropped map surfaces, estimated building fragments trimmed against vehicle swept OBBs (0.45 m, ≤1 s gaps). Source-mode models sit on supported terrain with display-only pitch/roll; imported/replay keep true XYZ. Raw map/poses/MapContext digest/XOSC profile unchanged; no physics engine.
- Takeover after Codex stalled: stale trim fixture fixed; uniform 1 m drape exhausted the 250 k budget (18–28 flat surfaces mislabelled "map nguồn lỗi") → conforming adaptive longest-edge drape (0 fallbacks, ≤143 k triangles); drape failures shown in contact notice; roof/deck LiDAR cells rejected by a local-majority slope check against measured + annotation-anchor ground (0916 walls removed; 1077 max ground 4.32→0.49 m).
- Backend 619 / frontend 227 pass, 0 skip; typecheck/ruff/prettier/build/package exit 0; mutations red for corridor trim, notice split, crack-free drape, spike filter. Installed 0.11.0: 5 scenes 0 renderer errors, 10 switches GPU stable, 0061 p95 8.9 ms; imported (map_id unchanged, max XY/yaw 0) + legacy gates PASS. Three independent audits (all 🔁 → fixed; final filter revision verified by tests/8 mutations/real data, not re-audited).
- Known limits: 0–15 residual T-junctions >2 cm/scene (max 0.245 m) from non-coincident source polygon vertices; near-vehicle ground coverage 0.59–0.995 (disclosed). `~/Applications/Topeye 0.11.0.app`; 0.10.1 kept for rollback. [Plan14](../planning/14_2026-10-10_ground-contact/plan.md). No commit/push.

## v0.8.0 — 3D / LiDAR / map — 2026-10-09T16:30:18+07:00
- Ba khung dùng chung thời gian: 3D chính, LiDAR quét ngang hình học giản lược và map vector nuScenes. Không thêm IPC/dependency.
- Bỏ camera/radar trang trí và telemetry ghi cứng; mở chọn mọi track (tối đa ba cho trích đoạn), map ẩn/hiện thật.
- Khôi phục canvas/HUD/camera CSS; numeric SVG giữ lỗ map; cửa sổ 1360×900 và 1050×720 đạt.
- Generation ownership chặn kết quả/error cũ sau hủy; phân biệt source thiếu môi trường và trích đoạn actor-only.
- Frontend160/160, typecheck/build/package/standalone exit0; nearest-hit mutation bắt5fail; review độc lập24/24,0blocker. esmini baseline+variant2/2pass;13metadata hashes nguyên vẹn;0renderer errors/0worker tồn dư.
- Cài/mở `~/Applications/Topeye 0.8.app`; ZIP và app cũ giữ rollback. [Plan09](../planning/09_2026-10-09_sensor-views/plan.md). Chưa commit/push; LiDAR là mô phỏng giản lược, không phải waveform cảm biến thực.

## v0.7.0 — UI Dashboard Upgrade — 2026-10-09
- Tái cấu trúc giao diện Frontend (ScenarioApp) sang thiết kế IDE-like Dark Mode.
- Thay thế CSS tuỳ chỉnh bằng Tailwind CSS v4 và shadcn/ui.
- Áp dụng các component chuẩn: ScrollArea, Card, Button, Input; chia màn hình thành Sidebar và Viewport.
- Mọi logic backend/esmini và 3D rendering (Three.js) giữ nguyên.


## v0.5.0 — Original scene — 2026-10-09T11:03:13+07:00
- Toàn bộ annotation trong cảnh gốc; bản đồ nuScenes offline, nhà/cây/cột đơn sắc ước lượng từ LiDAR, kiểu actor theo nguồn, đèn sau đỏ không suy trạng thái phanh.
- Sửa lỗ polygon lớp sọc qua đường; thiếu LiDAR giữ actors/map và cảnh báo; source ID không được export/replay.
- Sửa đóng gói symlink Python qua cả hai bước copy; 113 liên kết tương đối nằm trong app, SHA ZIP và codesign strict đạt.
- Backend565/frontend145 pass,0fail/skip; lint/typecheck/build/package đạt. Independent probes11/11 và packaging8/8; regression RED→GREEN lưu đầy đủ.
- Installed source/seek/cameras + esmini baseline/variant + cancel/process teardown +13metadata hashes đạt. Bản cài ~/Applications/Topeye 0.5.app; giữ app0.4 và zip rollback.
- Evidence: planning/06_2026-10-09_original-scene/evidence. Chưa nghiệm thu thẩm mỹ bởi người dùng, chưa notarize/public release, chưa commit/push.

## v0.4.0 — Scenario 3D viewport — 2026-10-09T10:37:02+07:00
- Thay preview phẳng bằng Three.js: xe ego trắng, traffic xanh, đường tổng hợp, ribbon quỹ đạo; bám xe/toàn cảnh/xoay/zoom.
- Replay chỉ dùng pose engine trong khoảng hỗ trợ; giữ XYZ/yaw và cắt timeline tại mẫu cuối chung, cảnh báo actor thiếu dữ liệu. Dispose WebGL khi đổi cảnh.
- Frontend143/143, typecheck/build/package exit0; app cài WebGL2, seek/camera/replay/variant/cancel/dataset integrity đạt. Review độc lập6/6 probes. Backend giữ baseline562, không đổi hành vi.
- Evidence: `planning/05_2026-10-09_scenario-3d/evidence`. Đã cài/mở app0.4.0; đường là mô hình tổng hợp, chưa nghiệm thu thẩm mỹ từ người dùng. Không commit/push.

## v0.3.0 — N3-09B Scenario Studio — 2026-10-09T10:09:35+07:00
- Local installed Electron/React app + bundled Python/esmini arm64; raw nuScenes tracks → OpenSCENARIO1.0/OpenDRIVE → actual replay → speed/offset variants → error/validity/clearance reports.
- Verified baseline +3 variants:4/4pass; installed app outside repo with no systemPython/Node dependency; cancel/restart/owned-process teardown and13metadata hashes verified. Backend562/frontend140pass;31scenario regressions; independent R01 approved.
- Fix gap-boundary interpolation, native-engine bbox shift, exclusive atomic writes, bundle admission and process-group shutdown; recovery skips malformed and nested-dataset states.
- Local ad-hoc signing only; no notarization/Windows/CARLA/photorealistic reconstruction. Existing6dev-tool audit advisories remain in roadmap. No commit/push/publication.

## NuRec static pilot — preparation, 2026-10-08 (not released)
- Quyết định mới thay thế Instant-only preview: người dùng muốn train1scene bằng fullNVIDIA NuRec. SPEC-P02 giữ NCore local, bổ sungauxdata/standardtraining/checkpoint/USDZ/novelviews; Brev L40S48GB$1.06/h đã thuê trong cap3USD/2h; aux exit0; native trainer stopped30079(exit1),30kUSDZ/PLY xuất thành công, đã tải khớpSHA/ZIPCRC, viewer mở được; VM huỷ23:32+07 trong cap. Chưa đủ40k/chưa nghiệm thu chất lượng.
- Người dùng thu hẹp nghiệm thu sang môi trường 3D tĩnh xem được; không triển khai actor động hoặc CARLA.
- Dùng converter nuScenes upstream; chỉ thêm adapter metadata calibration tương đương để nối SDK19.8 → SDK18.7, không viết lại converter dữ liệu. Instant NuRec đã có checkpoint public; pinhole preview và yêu cầu GPU phải được kiểm trước khi hứa kết quả.
- Có model NuRec thử30k và bản xem30k; giữ version ứng dụng0.2.0 vì chưa đủ40k và chưa nghiệm thu chất lượng.

## Source delivery - 2026-10-08
- Đóng gói snapshot v0.2.0 vào monorepo P-056/source-tool/topeye; backend/frontend giữ dependency riêng, không đổi runtime API/version. Dataset, checkpoint, asset binary và môi trường local không nằm trong Git.

## [0.2.0] - 2026-10-08: Scene assembly S15 (local, chưa nghiệm thu hình ảnh)
- Người dùng duyệt completion phía sau facade LiDAR và guard cây theo XYZ. Bật nhà bằng `procedural.facade_completion`; metadata cây được đo từ mọi triangle và đối chiếu lại trong Blender.
- Ghép 4 apartment block từ kit CC0 hiện có, giữ kích thước cửa/tầng; giới hạn scale completion 0,5–2 và distortion ≤1,4.
- BVH local chia sẻ giữa các instance, transform ray đúng non-uniform scale, opacity và đầy đủ geometry vẫn được kiểm. Backend 531/0/0; thẩm định độc lập không thấy lỗi correctness trong phạm vi kiểm.
- Pilot Cycles 1600×900: 4 ảnh camera, góc tự do, file Blender. Chưa ngang CARLA; không mở batch 234 ảnh, không đóng G-POC/G-sim hoặc phát hành v2.0.0.

## [0.1.1] - 2026-10-08: Tiếp nhận thử nghiệm StreetGS 30k (local, chưa phát hành)
- Khôi phục bối cảnh phiên Claude bị giới hạn tuần; xác nhận Kaggle COMPLETE, step 30000, PSNR 23,0809 / SSIM 0,68884 / LPIPS 0,27519. Không gửi thêm job remote.
- Thêm script tái lập export PLY/RGBD và mesh TSDF+LiDAR+atlas; viewer riêng 8772/30k giữ bản 5k nguyên trạng. Tái dùng helper `topeye.sim.texture_mesh`.
- Tensor TSDF thay API legacy bị rỗng trên macOS, có test mặt phẳng và đối chứng âm pose. Backend 525 pass.
- Kết quả âm được giữ: 149.999 tam giác / GLB 25,9 MB, độ phủ camera trước chỉ 29,3%; hai lượt không đạt, dừng cải thiện mesh. Không đóng G-POC/G-sim, không phát hành v2.0.0.
- Đồng bộ package backend/frontend/lock v0.1.0 → v0.1.1; sửa `state.current_version` từ giá trị scaffolding 1.0.0 sang version code thực 0.1.1. Khung não vẫn 1.7.1.

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

## 2026-10-08 — Đính chính hạ tầng và hồ sơ bàn giao (không phát hành)
- Chủ dự án xác nhận đã chuyển sang thuê/sử dụng GPU qua Kaggle; thay thế ràng buộc cũ cấm thuê GPU trong hiện trạng.
- Xuất docs/PROJECT_HANDOFF.md: cấu trúc nguồn, tiến trình S1–S15, kết quả và thất bại có bằng chứng, điều kiện nghiệm thu và phạm vi bàn giao ngoài Git. Không thay code hoặc version sản phẩm.

- Follow-up user requests full40k. No fulloptimizerresumeavailable from30kUSDZ; choose fresh native40k sameconfig+auxreuse. Localpackage488704000bytes prepared; additionalpaidcap3.50USD/3h proposed, unapproved.

- Superseded automaticfresh40k decision after userobjection: investigate weights-only continuation and higherresolution/native-render quality. User targets demo-like scene, iterationcountalone notacceptance. Existing30k saved; candidate2x prepared/unrun; newtrial3.50USD/3h acceptedbyoke, browserpausedhardstop.

- User supersedes scene-0061 continuation as nexttrial by requesting another higherqualitydataset. Select officialPhysicalAI NCore trainingexample as candidate, notyetqualityverified; HFfile401 gate, downloader/validatorready, no paidjob. Newscene requires owntraining; old30kretained.

- 2026-10-09: userclarifiesnuScenesonly; PhysicalAI/HFlogin path superseded. Selected0103 after10scene/180imageaudit andlocalSDK18validation; old0061/30kretained. Prep only, application0.2.0unchanged; GPUqualitygateopen.

2026-10-09T00:13+07:00 — userrequestsfullscene0103render; localjobprepared40k/6cams900px+novel. NoGPUjob/noapprelease; browser14resume required.

2026-10-09T00:46+07:00 — approvedscene0103 fulltrialstarted onL40Sl8hw4o5f5 at1.056USD/h; nativeparsePASS,auxrunning; 3.50USD/3hcap and isolatedwatchdog/backupmonitorarmed. Noapprelease/qualitysignoff.

2026-10-09T02:29:32+07:00 — scene0103 fullnative execution completed (experiment, noapplicationrelease/versionchange): scene-0103 native40000steps/trainexit0; full1613PNG1600x900 (6sourcecameras1384+frontnovel1m229), allPNGdecoded;7MP4/1613frames; USDZ+fulloptimizerCP+aux+publiclogs+renderarchive SHAverifiedlocal; independent14pass/0fail/0skip; VMl8hw4o5f5deleted/No instances; estimate2.25USD/finalinvoiceunverified; uservisualqualityOPEN, no weather/CARLA. Separatefulloptimizercheckpoint retained; no actualresume benchmark claimed.

2026-10-09 — Corrected video-onlyhandoff: interactiveGaussianenvironment scene0103 at8775, full40kbackground+road2,285,393vertices. CPUexport verifiedagainstnativeoldscenePLY, independent11/11. NativeUSDZ/CPpreserved; no paidjob/applicationrelease/versionchange; weather/mesh notimplemented.

2026-10-09 — Nativevideo acceptable; focuschanged to interactiveviewer. Addedlocalfloat32/noLOD diagnosticquery, confirmed31outofrangebackgroundcenters; syntaxPASS, runtime/visualUNRUN. Noapplicationrelease/versionchange.

2026-10-09 — PRIMARYscope changed by explicituserconfirmation to N3-09B installedscenarioapp. Plan04 SPEC_READY: macOSarm64first, Electron/React + privatePythonworker, esminireplay/variants/metrics. PriorBlender/NuRec retainedsecondary; no runtimechange/release, application0.2.0unchanged; target0.3.0 proposed afteracceptance.

2026-10-09T09:22:20+07:00 Userauthorizedobsoletefilecleanup forN3-09B. Moved 146360 files/57129709956 logicalbytes to /Users/macos/.Trash/topeye-obsolete-20261009-092105 viarename; reversible, diskspaceNOTfreeduntilTrashemptied. All213protectedsourcefilesunchanged. Stopped6ownedviewers8770–8775. RetainedexternalnuScenes,mainvenv/node_modules,manifestreferencedassets,andlayout.json+ground_drivable.pngforregression. Workspace~2GiB. Evidence: plan04/evidence/local/cleanup-manifest.json. Backendbefore531pass; after531pass/0fail/0skip(36.11s), frontendtypecheckexit0. OldNuRec/StreetGS/Blenderoutputs andisolatedtools no longeratpriorpaths.

## [v0.6.0] - 2026-10-09
### Added
- Tính năng Import Dataset cho phép nạp dữ liệu nuScenes tại chỗ (mini/trainval).
- Giao diện Import trên Desktop tự động giải quyết phiên bản, reset state và load cảnh đầu tiên.


## Ferrari theme patch — 2026-10-09T16:39:39+07:00

v0.8.1 Ferrari theme: desktop studio canvas #181818/panels #303030, sparse Rosso Corsa #da291c primary CTAs, sharp uppercase buttons, neutral map/LiDAR, visible focus and disabled states. Layout/IPC/geometry unchanged. Build + 160/160 tests pass; packaged signed app QA 1360×900 and 1050×720: 13 sharp buttons, 0 horizontal overflow, 0 renderer errors. Installed ~/Applications/Topeye 0.8.1.app. Evidence: planning/10_2026-10-09_ferrari-theme/evidence. User aesthetic acceptance pending.


2026-10-09T16:43:20+07:00 — v0.8.2: logo PNG do chủ dự án cung cấp thay dấu T ở header; giữ nguyên file gốc, hiển thị contain 44×44, không đổi bố cục/luồng. Build và 160/160 test đạt.


## Map-bound OpenSCENARIO v0.9.0 — 2026-10-09T21:36:47+07:00

v0.9.0 local: map-bound OpenSCENARIO import/export context/reopen/measured replay for ego,vehicles,pedestrians; profile topeye-map-trajectories-v1 (XML1.0 world timed polylines), no chatbot. Backend609/frontend171 pass0skip; real imported and legacy desktop gates pass,13source hashes unchanged/0renderer errors/0owned children. MapID numeric canonicalization survives Node JSON; dataset paths rebound app-side. Invalid map surfaces0103/0655 reject;8mini scenes have valid contexts; source geometry unchanged, estimated building collisions use conservative hulls. Installed ~/Applications/Topeye 0.9.app.
Plan: planning/11_2026-10-09_xosc-map-import/plan.md; module docs/scenario.md; modules map_context.py/xosc_import.py/imported_replay.py + private worker/IPC/UI. All local gates complete at 2026-10-09T21:38:26+07:00.


## Sensor zoom PATCH — 2026-10-09T21:51:35+07:00

v0.9.1: map/LiDAR zoom1–8× by wheel and +/−/reset; centered on ego, resets per scenario; Rosso Corsa #da291c ego markers/heading in both views. View-only, sensor60m/180rays and poses unchanged. Frontend174/174/typecheck/build/package pass; installed zoom/wheel/reset/computed red verified at1360×900/1050×720,0page errors. Installed ~/Applications/Topeye 0.9.1.app.
Shared frontend helpers: useSensorZoom.ts / SensorZoomControls.tsx; evidence plan11/evidence/zoom.


## Detailed driving scene v0.10.0 — 2026-10-10T09:13:41+07:00
Installed /Users/macos/Applications/Topeye 0.10.0.app. Genuine CC BY4 VinFast VF3 ego (red paint, high49,885/far≤8k), licensed grayscale traffic sedan/SUV, smooth pedestrians/cycles/instanced trees/beveled estimated buildings; neutral road depth support/joined markings with invalid source ring warnings preserved. Live forward bumper gap uses current source/import/replay poses and OBB supports (scene0103:38.3m at5s→14.6m at10s); cyan corridor follows actual ego samples. CARLA0.9.15 exact22presets are presentation-only; header OpenSCENARIO import/export-map/reopen replaces readiness badge.
Frontend216/backend609 pass0skip, scopedlint/typecheck/build/package exit0; independent63extensiontests plus topology/weather/abort/offline probes passed. Installed imported coverage1/maxXY0/maxYaw0; legacy2actual engine cases passed;13sourcefiles unchanged;0renderer errors/0ownedchildren. Native weather/window1050×720/1360×900 and10scene switches pass; GPUgeometry54/78 and1texture stable byscene. Earlier0.10.0 interactive30swarm+60ssample119.6RAFfps,p95=9.3ms; screenshots show scene/time varied, so this is not a fixed-scene A/B comparison. Fixed-scene measurement follows inpatch13. Bundle233,375,305B, +2,176,680B vs0.9.1.
Evidence: planning/12_2026-10-09_scene-detail/evidence/{driving-view,performance-final,desktop,imported-release,legacy-release,audit-p03}. Plan12 local gates complete; user visual signoff remains owner discretion, no remote release/commit/push. Weather scattering/friction and estimated environment are not CARLA physics or surveyed geometry.


## Stop-region display PATCH v0.10.1 — 2026-10-10T09:28:54+07:00
Fixed large white pavement patches: nuScenes stop_line polygons are semantic stopping areas, so3Drenderer omits their full whitefill. Roadsupport/holes/crossings/dividers/sourceJSON/mapcontext/actorposes remain unchanged; no invented stopstripe. Installed /Users/macos/Applications/Topeye 0.10.1.app. Regressionred1fail/20pass→green21pass;fullfrontend217pass0skip;independentreview21pass/typecheck0;build/package/nativebefore-after exit0,0renderererrors. Source0553/time0/overview before.png andafter.png show removed patches withcrosswalks retained. Controlled source0061/time0 benchmark30swarm+60ssample120.02RAFfps/p95=8.8ms,0errors; guard checks scene/time everyframe. Earlier interrupted run rejected, evidence retained. Backendlogic unchanged;609tests from0.10.0 remain applicable. No commit/push. Evidence: planning/13_2026-10-10_stop-region/evidence/.


## v0.12.2 — 2026-10-10T15:46:15+07:00 — local PATCH
- Fixed source annotation/fallback height mismatch producing airborne vehicles (0916 max4.1665m); all source display vehicles now follow rendered terrain.
- Fit rotation-aware wheel support rectangle; prevent body overhang from lifting wheels on curved surfaces. Disclose unknown support as display fallback. Raw data/import/replay XYZ preserved.
- v0.12.2 local installed: source vehicles use displayed terrain contact including disclosed fallback; rotated wheel-support rectangle (±0.3 length / ±0.4 width), not body overhang. 282/282 frontend and15/15 scoped backend tests;10 scenes/13307 visible vehicle poses, contact error≤4.45e-16m,0source mutations/0import-replay XYZ changes;installed10scene0renderer errors,120.1RAFfps,p95=9.3ms; imported desktop PASS. No scene IDs or dataset-specific corrections. Terrain remains estimated; no exact tire/suspension or physical multilevel reconstruction claim. Plan17; ~/Applications/Topeye 0.12.2.app.


## v0.12.3 — 2026-10-10T15:57:06+07:00 — local PATCH
- Replace default native Electron icon with owner-supplied logo; make generation automatic for future packages.
- v0.12.3 installed: supplied logo is now the native macOS app icon; header PNG already matched owner source byte-for-byte and is preserved. Packaging derives10 standard icon PNGs (16–1024px, alpha) and ICNS from frontend/src/scenario/assets/topeye-logo.png via sips/iconutil.282frontend tests/build/signature pass;installed native ICNS hash matches generated icon, UI logo SHA matches owner image,0renderer errors. ~/Applications/Topeye 0.12.3.app;plan18.

## Unreleased experiment — 2026-10-13T15:24:38+07:00 — plan40
One-scene monochrome OSM footprint preview on localhost5181. Product remains0.29.0; no production feature/API/class changes. Height uncertainty and geographic mismatch explicitly disclosed; no release or global integration.

Unreleased plan40 styling 2026-10-13T15:34:43+07:00: owner-requested pastel reference replaces monochrome after view. Product version remains0.29.0; preview only.

Unreleased experiment 2026-10-13T15:54:04+07:00:plan40 full-map revision uses wider420×420m source map, measured display-only building/road clearance and original actors. No product version/API/class change.


### Pilot road depth patch — 2026-10-13T16:03:47+07:00
Owner screenshot shows distant pavement breakup. Pilot camera now adapts near plane to orbit distance (clamp distance/50 to0.25–25m), retaining far2500m. 24-bit depth quantization check:2538samples, old near0.1 produced1365collisions for4cm layers; adaptive near produces0. Road vertices below floor(-0.2m):0/168474. tsc/Three geometry/Vite exit0; evidence:`planning/40_2026-10-13_map-shape-pilot/evidence/depth-checks.txt`. This proves precision improvement, not GPU visual acceptance; owner refresh pending. No geometry/class/product/version changes.


## Twenty pastel scene maps — 2026-10-13T17:53:59+07:00
Plan42 local preview at http://127.0.0.1:5181 replaces single-scene pilot.20/20 maps (10nuScenes mini+10AV2 Sensor),20OSM-covered regions,2793display building components counted across scenes. Keep existing actors/classes/poses; cancel all plan41 object-model integration. Offline source export122.923s, cached reconstruction about7s;30,522,677bytes JSON total, max3,520,269bytes/scene. Only one selected scene loads; no20map GPU residency.
Sources: cached BBBike Singapore for6scenes;14OpenFreeMap/OpenMapTiles OSM tiles(2,534,936bytes) for14US scenes. AV2 uses official city-origin UTM, nuScenes origin-scaled Mercator; holes preserved,0.4m cosmetic road clearance, measured overlap0m². Tile heights may be inferred; missing heights9.6m explicitly estimated. Supplement uncovered facades with LiDAR estimates. Existing LiDAR structures retained; no invented bridge.
Geometry cleanup at1mm presentation precision removes near-zero union edges/slivers; source polygons/lines and actor arrays preserved.27tests pass,5801rings valid,20Three.js CPU builds pass with0new geometry defects/0terrain fallbacks;3pre-existing invalid source polygons remain disclosed (scene0103:2,0655:1). Independent reviewer remeasured14scopedtests+5801rings+tsc. HTTP20/20 payload hashes match built files. GPU visual/FPS not measured because owner controls browser; not a product release. Evidence: plan42/evidence/{summary.json,geometry.json,rings.txt,tests.txt,http.json}.

## v0.31.0 — 2026-10-13T18:56:20+07:00
Owner approved20pastel maps and requested mainweb integration. Offline source-fingerprinted presentation assets, original actor/map contracts unchanged, expanded map display in source/imported views, pastel palette/landscape and adaptive camera depth preserving cabin. Dataset/network dependencies not added. Local release only, no remote publish.

## v0.31.1 — 2026-10-13T21:31:34+07:00
Display a lightweight red bonnet at the bottom of driver view; hide it outside cabin or without ego pose. No actor/data/physics changes.
