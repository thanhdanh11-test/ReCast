# Changelog & Semantic Releases

Tất cả các quyết định kiến trúc và lịch sử nâng cấp phiên bản của dự án.

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
