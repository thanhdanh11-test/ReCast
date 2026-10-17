# Project Index Map & Navigation Router

Tệp này là **Bản Đồ Chỉ Mục Trung Tâm (Master Index Map)** của dự án. Mọi AI Agent sử dụng tệp này để định tuyến tài liệu và nắm bắt toàn bộ bản đồ cấu trúc mã nguồn, luồng giao tiếp và các điểm vào (Entry Points).

---

Source delivery: [`P-056/source-tool/topeye`](https://github.com/AI20K-Build-Phase-Cohort-4A/P-056/tree/main/source-tool/topeye) — backend/frontend cùng repo, asset/dataset local riêng.

**Cleanup2026-10-09:** oldgenerated3Doutputs/tools areinmacOSTrash; oldviewerURLsinthisdocument arehistorical/inactive. Manifest: plan04/evidence/local/cleanup-manifest.json.

**0.15.0 (2026-10-12):** app desktop Electron đã bỏ; chạy bằng `npm run web:local` ([plan22](../planning/22_2026-10-12_drop-desktop/plan.md), [plan21](../planning/21_2026-10-12_local-web-full/plan.md)).

**PRIMARY2026-10-09:** [ScenarioDesktopplan04](../planning/04_2026-10-09_scenario-desktop/plan.md), [scenario module](../docs/scenario.md). v0.5.0 bổ sung cảnh gốc toàn bộ annotation và map/LiDAR đơn sắc; v0.4.0 bổ sung viewport3D: Electron/React + Python JSONL + esmini arm64; 4/4 kịch bản thực đạt. Plans02/03 secondary research.

**Original scene v0.5.0:** [Plan06](../planning/06_2026-10-09_original-scene/plan.md); backend `source_scene.py`, frontend `sourceEnvironment.ts`; source playback remains separate from esmini acceptance.

**Sensor views v0.8.0:** [Plan09](../planning/09_2026-10-09_sensor-views/plan.md), [contracts/runbook](../docs/scenario.md). `frontend/src/scenario/sensors.ts` sở hữu footprint/raycast/visible actors; `LidarView.tsx` quét ngang giả lập, `TacticalMap.tsx` map thật, `ScenarioApp.tsx` workflow/cancellation, `scenario.css` bố cục ba khung. Không đổi IPC/backend.

## 🧭 1. ĐIỀU HƯỚNG TÀI LIỆU & KẾ HOẠCH (Documentation & Planning Router)

Khi nhận nhiệm vụ, Agent tra cứu bảng này để đọc **chính xác** tài liệu chuyên sâu liên quan:

| Lĩnh vực / Nhiệm vụ | Tài liệu chuyên trách | Nội dung chính |
| :--- | :--- | :--- |
| **Ký ức nóng phiên gần nhất** | [`memory/hot/today.md`](memory/hot/today.md) & [`state.json`](memory/hot/state.json) | Trạng thái máy (JSON), nhật ký làm việc theo phiên và kết quả benchmark gần nhất. |
| **Khởi động / Quy tắc chung** | [`memory-distill.txt`](memory-distill.txt) | Kernel hiện trạng, Startup Protocol, Tech stack cốt lõi. |
| **Bàn giao team** | [`docs/PROJECT_HANDOFF.md`](../docs/PROJECT_HANDOFF.md) | Cấu trúc đầy đủ, giai đoạn, phương pháp đã thử/thất bại; cập nhật GPU Kaggle. |
| **Tổng quan dự án** | [`project-intro.md`](project-intro.md) | Mục tiêu, kiến trúc tổng thể. |
| **Kế hoạch nâng cấp & RFCs** | [`planning/`](../planning/) | Thư mục chứa các bản kế hoạch theo chuẩn `[STT]_[YYYY-MM-DD]_[Ten-Ngan]`. |
| **Lỗi khó / Cạm bẫy / Gotchas** | [`-known-gotchas.md`](-known-gotchas.md) | Tổng hợp các bẫy kỹ thuật và lỗi dị biệt đã gặp. |
| **Kiến trúc dữ liệu & Data Flow** | [`-data-architecture.md`](-data-architecture.md) | Cấu trúc dữ liệu, cơ chế lưu trữ và State Flow. |
| **Lộ trình nâng cấp & Ý tưởng** | [`roadmap.md`](roadmap.md) | Active tasks, Kho Ý Tưởng (Idea Vault) và các mốc đã hoàn thành. |
| **Lịch sử cập nhật** | [`changelog.md`](changelog.md) | Lịch sử Semantic Releases (vX.Y.Z). |
| **Tài liệu kỹ thuật module** | [`docs/`](../docs/) | Tài liệu 1-1 cho từng module. Hiện có: [`docs/sim.md`](../docs/sim.md) (real-to-sim). |
| **NuRec cảnh tĩnh** | [Kế hoạch 03](../planning/03_2026-10-08_nurec-static/plan.md), [docs/sim.md](../docs/sim.md) | Active SPEC-P05: scene0103 native40k +1613PNG/7MP4 verifiedlocal; fulloptimizerCP/USDZ/aux/logs kept, VMdeleted. Review8774; visualquality/weather gatesopen; old0061preserved. |
| **Kế hoạch Blender lịch sử** | [`planning/02_2026-10-05_blender-real2sim/`](../planning/02_2026-10-05_blender-real2sim/plan.md) | Real-to-sim bằng Blender: SPEC, bằng chứng, exit gate. |
| **StreetGS 30k / mesh thử nghiệm** | [`docs/sim.md`](../docs/sim.md), [S14](../planning/02_2026-10-05_blender-real2sim/specs/SPEC-S14-StreetGS-Mesh.md) | Kaggle COMPLETE; splat trên web 8772/30k; mesh TSDF chưa đạt chất lượng. |
| **Cảnh 3D chất lượng CARLA — S15 pilot** | [S15](../planning/02_2026-10-05_blender-real2sim/specs/SPEC-S15-Scene-Assembly.md) | Đã duyệt và triển khai completion nhà, guard cây XYZ, BVH instance; 5 ảnh pilot, chưa đạt CARLA. |

---

### 🛠️ 1.2. Bảng Định Tuyến Kỹ Năng Chuyên Dụng (Workspace Skills Router - `.agents/skills/`)

| STT | Tên Skill (`.agents/skills/`) | File Quy Chuẩn (`SKILL.md`) | Vai Trò & Chức Năng Cốt Lõi |
| :---: | :--- | :--- | :--- |
| **1** | `nao-dong-bo` | `SKILL.md` | Đồng bộ não bộ (engine quản lý). |
| **2** | `nao-commit` | `SKILL.md` | Đề xuất & thực hiện commit theo luật D. |
| **3** | `nao-dong-phien` | `SKILL.md` | Đóng phiên, ghi ký ức nóng. |
| **4** | `nao-ten-phien` | `SKILL.md` | Đặt tên phiên. |
| **5** | `vai-dieu-phoi` | `SKILL.md` | Vai super orchestrator + hồ sơ vai trong `agents/`. |
| **6** | `vai-thi-cong` | `SKILL.md` | Vai worker thi công. |

---

## 🗺️ 2. BẢN ĐỒ CẤU TRÚC MÃ NGUỒN (Codebase Directory Map)

```text
project-root/
├── AGENTS.md / CLAUDE.md             # Luật tối thượng (nguồn chân lý) + shim Claude Code
├── brain4agent-v1.7.1.md             # [MARKER] Phiên bản khung não
├── PROJECT_BRIEF.md · REVIEW.md      # Ý tưởng gốc + tranh luận khả thi (2026-10-03)
├── brain4agent/                      # [BỘ NHỚ DỰ ÁN] 8 phân vùng (xem §1)
├── planning/                         # Chỉ local (gitignore). Kế hoạch 01 đã xoá 2026-10-06
│   ├── 02_2026-10-05_blender-real2sim/   # Historical research
│   ├── 04_2026-10-09_scenario-desktop/   # N3-09B desktop verified
│   ├── 05_2026-10-09_scenario-3d/        # 3D driving viewport
│   └── 06_2026-10-09_original-scene/     # Original scene/map/static estimates
├── docs/
│   ├── sim.md                        # Historical Blender module
│   └── scenario.md                   # N3-09B desktop operation/contracts
├── backend/                          # Python 3.12, package `topeye` (venv: backend/.venv)
│   ├── config.toml                   #   nusc_root, cache_root, blender_bin (tuỳ chọn)
│   ├── topeye/scenario/              # Extract/variant/XML/replay/metrics/private worker
│   ├── topeye/core/                  #   Lõi dùng chung: adapters/nuscenes, geometry, ground, colorize, bev, object_accum…
│   ├── topeye/sim/                   #   ★ Real-to-sim (kế hoạch 02)
│   │   ├── camera.py                 #     OpenCV K/pose → tham số camera Blender
│   │   ├── layout.py                 #     Scene thật → layout.json + ground/static PLY + raster sơn/vùng đi được
│   │   ├── labels.py                 #     Label YOLO 2D + 3D từ layout + visibility
│   │   ├── cli.py                    #     topeye-sim-layout / topeye-sim-render
│   │   ├── view.py + viewer/         #     topeye-sim-view: web viewer three.js (localhost)
│   │   └── blender/                  #     build_scene.py (bpy, KHÔNG import topeye) + scenarios/*.toml
│   ├── topeye/api/ · prepare.py      #   (kế hoạch 01) FastAPI viewer + CLI cache
│   ├── scripts/sim_evidence.py       #   Ảnh so sánh thật/sim + chỉ số LiDAR → planning/02/evidence
│   ├── scripts/streetgs_mesh.py      #   Export checkpoint 30k/RGBD và mesh TSDF+LiDAR+atlas (local)
│   ├── scripts/streetgs_viewer.html  #   Template viewer riêng splat/mesh thử nghiệm
│   ├── tests/                        #   pytest: 565 pass (2026-10-09), includes source-scene regressions
│   └── data/                         #   (gitignore) cache/, sim/<scene>/{layout…, runs/<scenario>/}
├── frontend/                         # React/TS + legacy viewer
│   ├── server/                       # Localhost web server (127.0.0.1, token) + Python worker bridge
│   ├── src/scenario/                 # Scenario Studio UI/Three.js 3D viewport + trajectory helpers
│   ├── local.html · web.html          # Entries: full localhost app / static demo
│   └── scripts/test-local-web.mjs     # E2E on real dataset + esmini
├── .agents/skills/ · .claude/        # Skill vault + shim (engine sinh)
```

### 2.1. Entry Points
| Lệnh | Vai trò |
| :--- | :--- |
| `backend/.venv/bin/python backend/scripts/build_scenario_engine.py` | Build pinned esmini arm64 |
| `cd frontend && npm run web:local` | Full app in browser at http://127.0.0.1:5180 (0.15.0: only way; desktop removed) |
| `cd frontend && npm run test:server` / `npm run test:e2e -- <nuscenes>` | Server security tests / real-data E2E |
| `.venv/bin/python -m topeye.scenario.cli probe-engine` / `accept` | See docs/scenario.md for required arguments |
| `cd backend && .venv/bin/topeye-sim-layout --scene scene-0061` | Xuất bố cục scene thật cho Blender |
| `.venv/bin/topeye-sim-render --scene scene-0061 --selftest` | Kiểm camera Blender khớp OpenCV (< 0,5 px) |
| `.venv/bin/topeye-sim-render --scene scene-0061 --scenario topeye/sim/blender/scenarios/night.toml` | Render + LiDAR + label |
| `.venv/bin/topeye-sim-view --scene scene-0061` | Xem map 3D trên web (http://127.0.0.1:8770) |
| `.venv/bin/python scripts/sim_evidence.py --scene scene-0061 --run day night rain fog` | Bằng chứng nghiệm thu |
| `.venv/bin/python -m pytest -q` · `.venv/bin/ruff check topeye tests scripts` | Cổng test/lint |
| `topeye-prepare` / `uvicorn topeye.api.main:app` | (kế hoạch 01) cache + API viewer |

Historical / superseded nexttrial: NuRec completion draft: plan03/specs/SPEC-P03-Complete-40k.md; fresh40k withauxreuse, fullresumecheckpointbackuprequired. Localfull-40k-job.tar ready; addedbudget3.50USD/3h pending.

Historical / superseded nexttrial: NuRec SPEC-P03 latestoverride: audited30kweights-onlyresume +quality800x450candidate; fresh40kproposal superseded. NativeUSDZrendererprimary; browser14paused, no newVM.

Historical / superseded nexttrial: Active NuRec data path: plan03/specs/SPEC-P04-PhysicalAI-Data.md; officialPhysicalAI NCore clip100ae358 candidate1.95GB; HF401/authtermsgate, inputimagesunreviewed, noGPUjob.

**ActiveNuRec2026-10-09:** SPEC-P05 scene0103 full40k train/render success; all1613PNG decoded +7MP4; nativeUSDZ/fullCP/aux/logs/renderarchive verified. VMdeleted, no newpaidjob. UservisualqualityOPEN.

NuRec0103 runner/package: plan03/{run_0103.sh,render_0103.sh,finalize_0103.sh,verify_render_0103.py}; nativeexecutionPASS; localfull-output/review/ + http://127.0.0.1:8774/.

NuRec0103 closed02:27+07: fullCP40000/16optimizerstates+USDZ retained; SHA/CRC/1613PNGdecode PASS; independent14/14. VMNo instances, watchdogcancelledafterconfirmation; estimate2.25USD/invoiceunverified.

NuRec interactive0103: primary http://127.0.0.1:8775/; local full-output/viewer/{background.ply,road.ply,poses.json,index.html,export-proof.json}; exporter plan03/export_viewer_ply_0103.py. 2,285,393 Gaussians; nativeappearance/weather gates open.

NuRec viewer precisioncandidate: http://127.0.0.1:8775/?precision=1 (float32/noLOD), runtimevisualQA pending; audit plan03/evidence/local/viewer-0103/precision-audit.json.


## Ferrari theme patch — 2026-10-09T16:39:39+07:00

v0.8.1 Ferrari theme: desktop studio canvas #181818/panels #303030, sparse Rosso Corsa #da291c primary CTAs, sharp uppercase buttons, neutral map/LiDAR, visible focus and disabled states. Layout/IPC/geometry unchanged. Build + 160/160 tests pass; packaged signed app QA 1360×900 and 1050×720: 13 sharp buttons, 0 horizontal overflow, 0 renderer errors. Installed ~/Applications/Topeye 0.8.1.app. Evidence: planning/10_2026-10-09_ferrari-theme/evidence. User aesthetic acceptance pending.


2026-10-09T16:43:20+07:00 — v0.8.2: logo PNG do chủ dự án cung cấp thay dấu T ở header; giữ nguyên file gốc, hiển thị contain 44×44, không đổi bố cục/luồng. Build và 160/160 test đạt.


## Map-bound OpenSCENARIO v0.9.0 — 2026-10-09T21:36:47+07:00

v0.9.0 local: map-bound OpenSCENARIO import/export context/reopen/measured replay for ego,vehicles,pedestrians; profile topeye-map-trajectories-v1 (XML1.0 world timed polylines), no chatbot. Backend609/frontend171 pass0skip; real imported and legacy desktop gates pass,13source hashes unchanged/0renderer errors/0owned children. MapID numeric canonicalization survives Node JSON; dataset paths rebound app-side. Invalid map surfaces0103/0655 reject;8mini scenes have valid contexts; source geometry unchanged, estimated building collisions use conservative hulls. Installed ~/Applications/Topeye 0.9.app.
Plan: planning/11_2026-10-09_xosc-map-import/plan.md; module docs/scenario.md; modules map_context.py/xosc_import.py/imported_replay.py + private worker/IPC/UI. All local gates complete at 2026-10-09T21:38:26+07:00.


## Sensor zoom PATCH — 2026-10-09T21:51:35+07:00

v0.9.1: map/LiDAR zoom1–8× by wheel and +/−/reset; centered on ego, resets per scenario; Rosso Corsa #da291c ego markers/heading in both views. View-only, sensor60m/180rays and poses unchanged. Frontend174/174/typecheck/build/package pass; installed zoom/wheel/reset/computed red verified at1360×900/1050×720,0page errors. Installed ~/Applications/Topeye 0.9.1.app.
Shared frontend helpers: useSensorZoom.ts / SensorZoomControls.tsx; evidence plan11/evidence/zoom.

## Detailed renderer/weather candidate — plan12
Owner-approved `planning/12_2026-10-09_scene-detail/`. Helpers frontend/src/scenario/{detailModels.ts,renderGeometry.ts,weather.ts,weatherEffects.ts,EnvironmentMenu.tsx}; docs/scenario.md explains LOD, grayscale road rendering and CARLA presentation limits. Driving extension adds assetModels.ts/vinfastModels.ts (licensed offline GLBs), leadVehicle.ts (live bumper gap), drivingOverlay.ts (actual ego trajectory/range guides), ModelCredits.tsx. Genuine VF3 near49,885/far7,923 triangles verified; latest frontend216pass. Installed0.10.0 acceptance and independent63-test extension review passed;119.6RAFfps/p95=9.3ms, stable GPUresources.


Stop-region PATCH0.10.1: sourceEnvironment.ts omits semanticstop_line fill (not pavementpaint); renderer regression217totalpass, independent21pass, nativebefore/after andfixedbenchmark120RAFfps/p95=8.8ms. Plan13/docs/scenario.md; sourceauthority unchanged.

**Ground contact v0.11.0:** [Plan14](../planning/14_2026-10-10_ground-contact/plan.md), [docs](../docs/scenario.md). `backend/topeye/scenario/presentation.py` sở hữu ground estimate + presentation surfaces/building trim (optional `Environment.presentation`); `frontend/src/scenario/groundSupport.ts` sở hữu height query, source-only contact/tilt và adaptive drape; `sourceEnvironment.ts` dựng mặt bám nền. Raw map/poses/MapContext không đổi.

**Vehicle style v0.12.0:** [Plan15](../planning/15_2026-10-10_vehicle-lights-map/plan.md), [docs](../docs/scenario.md). `frontend/src/scenario/vehicleClass.ts` (category→class, map legend labels), `vehicleMaterials.ts` (palette, lamp materials), `cabinCamera.ts` (driver-eye view); bus/truck templates in `detailModels.ts`, GLB lamp split in `assetModels.ts`, fading corridor in `drivingOverlay.ts`, class colours in `TacticalMap.tsx`.

**Scenario metrics v0.22.0:** [Plan33](../planning/33_2026-10-13_scene-metrics/plan.md). `backend/topeye/scenario/scene_metrics.py` (định nghĩa pilot/baseline/biến thể/hiếm, chạy esmini con), worker `scenario_metrics` (cache `<ws>/<id>/metrics/`), server `scenarioMetrics` trên worker thứ 3; UI `frontend/src/scenario/MetricsPanel.tsx` trong cột báo cáo `ScenarioRunner.tsx`.

**Map polish v0.12.1:** [Plan16](../planning/16_2026-10-10_map-load-polish/plan.md). Worker `SOURCE_CACHE_SIZE` LRU in `backend/topeye/scenario/worker.py`; `_unique_rows` + cKDTree box mask in `source_scene.py`; `presentation.trees/poles` filter in `presentation.py`.


**Source vehicle contact0.12.2:** [Plan17](../planning/17_2026-10-10_vehicle-contact/plan.md), [module](../docs/scenario.md). `groundSupport.ts` now aligns source display to rendered terrain, using rotated wheel support rectangle; `TrackView.tsx` computes tilt before placement, `sourceEnvironment.ts` discloses fallback. Import/replay/source data unchanged. 2026-10-10T15:46:15+07:00.


**Native logo0.12.3:** [Plan18](../planning/18_2026-10-10_app-logo/plan.md), [module](../docs/scenario.md). Existing packaging script generates macOS ICNS from the shared unchanged header PNG; no new module. 2026-10-10T15:57:06+07:00.

## Plan34 / v0.23.0 access and datasets
- `frontend/src/scenario/AccessApp.tsx` + accessApi/access.css: login and dataset catalog before ScenarioApp.
- `frontend/server/local-auth.mjs`, `dataset-catalog.mjs`: account/session and local dataset registry; local-server routes.
- **Structures v0.27.0** ([Plan39](../planning/39_2026-10-13_bridge-structures/plan.md)): `backend/topeye/scenario/structures.py` (mép đường, hành lang hai bên, trần), gọi từ `source_scene.static_environment`; vẽ ở `frontend/src/scenario/sourceEnvironment.ts`.
- **Settings v0.25.0** ([Plan35](../planning/35_2026-10-13_settings-page/plan.md)): `frontend/src/scenario/SettingsPage.tsx` (trang Cài đặt), `preferences.ts` (tuỳ chọn theo trình duyệt), `i18n.ts` + `i18n.en.ts` (`t()` tiếng Việt → English), `playback.ts`; server `local-storage.mjs` (dung lượng, xoá cache chỉ số, dọn .trash), `local-feedback.mjs` (góp ý lưu `userData/feedback/`), `local-auth.mjs` (đổi mật khẩu, thời gian phiên).
- `backend/topeye/core/adapters/argoverse.py`: native AV2 Sensor; `scenario/dataset.py::create_adapter` factory.
- Operations/contracts: [scenario](../docs/scenario.md), [plan34](../planning/34_2026-10-13_dataset-intake/plan.md).

**Runner timeline v0.26.0 (plan36):** `frontend/src/scenario/ActorTimeline.tsx` + `actorTimeline.css` own source-vertex motion rows and seeking; ScenarioRunner owns 2:1 layout, three tabs, aggregated saved history. Contracts and operations: docs/scenario.md / planning/36_2026-10-13_runner-timeline/specs.

**Runner polish0.26.1 (plan37):** ActorTimeline visibleKeys display thinning + separate marker/motion rails; library.py::delete_imported_run and worker/API/UI one-run trash flow. See docs/scenario.md.
**Reactive scenarios v0.33.0 (plan45):** `backend/topeye/scenario/reactive.py` (scene_model/candidates/run_event — port replay-forge behavior/events/safety) + `reactive_package.py` (xosc/report/csv gói real2sim) ← worker `reactive_candidates`/`import_reactive` (nạp như `import_package`) ← server `reactiveCandidates`/`importReactive` ← `ScenarioApp.createReactive` ← tab "Phản ứng" `authoring/ReactiveForm.tsx`. Template motion: `template.py::simulate` (jerk-limited). Spec: planning/45_2026-10-15_reactive-events/.

**Reactive metrics v0.34.0 (plan46):** `backend/topeye/scenario/reactive_metrics.py` (chỉ số 2, lưới sự kiện + ca hiếm), `replay_metrics.py` (chỉ số 1 ADE/holdout qua esmini), `esmini_check.py` (kiểm gói real2sim, cache ngoài manifest) ← worker `reactive_metrics`/`replay_error_metrics`/`esmini_check` trên worker chỉ số; `reactive_sensitivity` trên worker chính ← localhost API tương ứng ← `authoring/SceneMetricsPanel.tsx`, `Real2simReport.tsx`, `ReactiveCharts.tsx`, `help/terms.ts`/`HelpTip.tsx`. Contract, cổng đo và vận hành: planning/46_2026-10-15_reactive-metrics/specs/; module docs: docs/scenario.md.

**Reactive kinds + workspace v0.35.0 (plan47):** `reactive.py` thêm accelerate/stopline/lane_change với cửa sổ hợp lệ theo kind và kiểm dừng vật lý; `reactive_metrics.py` quét lưới từng kind, giữ brake bất biến. `frontend/src/scenario/reactive/` là workspace Phản ứng với bản đồ, inspector, timeline, dock; `ScenarioApp` tải lại source khi đổi cảnh. `authoring/SceneMetricsPanel.tsx` và báo cáo plan46 được dùng lại trong dock. Contract/gates: `planning/47_2026-10-15_reactive-kinds-ui/specs/`; hướng dẫn: `docs/scenario.md`.

**Unified scenario preview (plan48, chưa phát hành):** Luồng 5 bước: chọn xe → tình huống → tham số → so sánh → lưu/xuất; click ego mở 20 template, xe giao thông có 4 kind. Hai API cùng event sinh hai gói baseline/pilot thật, phát cạnh nhau cùng đồng hồ; tự lưu được nói rõ. Chọn sẵn hướng/thời lượng khả thi theo xe; khóa chuyển bước khi đang chạy. 66/66 test, typecheck/build exit0; Chrome 8 bước/10 gói/0 lỗi, quỹ đạo ego khác nhau. Chưa phát hành, chờ duyệt hình thức. Mã: `frontend/src/scenario/unified/{UnifiedScenarioDemo,ReactionParameters,model}`; tài liệu `docs/unified.md`; evidence `planning/48_2026-10-15_unified-scenario-demo/evidence/guided`.

**real2sim packages v0.32.0 (plan43):** `backend/topeye/scenario/real2sim.py` (`parse_package`/`persist_package`/`load_package`, manifest `kind: "real2sim"`, ghi chú map không chặn) ← worker `import_package` (+ `open_imported` chọn theo manifest; `scenario_metrics`/`replay_imported` trả `UNSUPPORTED_KIND`) ← server `importPackage` (≤ 7,8 MiB base64) ← `httpApi.pickPackage/readPackage` (chọn thư mục) ← `ScenarioApp.importPackage`; báo cáo `frontend/src/scenario/Real2simReport.tsx` thay `MetricsPanel` khi `scenario.kind === "real2sim"`. Spec: planning/43_2026-10-15_real2sim-import/.

**Scenario authoring v0.28.0 (plan38):** backend `backend/topeye/scenario/template.py` (`check_template`, `compile_template`, placement dọc quỹ đạo ego nguồn) ← worker `import_template` ← server `importTemplate` ← `ScenarioApp.createFromTemplate`; `xosc_import.profile_xml` + `export.trajectory_xml` dùng chung; v0.30.0 sửa bằng template: `library.read_imported` trả `template` từ `<ws>/<id>/template.json` (ghi trong `imported_replay.persist_import`); v0.29.0 gợi ý map: worker `template_fit` ← server `templateFit` (worker chỉ số) ← `authoring/MapFit.tsx`. Frontend: `frontend/src/scenario/authoring/` — `template.ts` (schema `topeye-scenario-template-v1` + `validateTemplate`), `catalog.ts` (20 loại kịch bản/5 nhóm, preset `build(params)`), `mockAi.ts` (mock AI), `ScenarioCreator.tsx` (mở từ `ScenarioRunner.openCreate`), `TypeGallery`/`TemplateForm`/`TemplatePreview`/`AiChat`, `authoring.css`. `i18n.test.ts` quét cả thư mục con + chuỗi catalog. Spec: planning/38_2026-10-13_scenario-authoring/.

**Map shape pilot (plan40, isolated):** `planning/40_2026-10-13_map-shape-pilot/{extract_osm.py,prepare.py,build.mjs,preview/}` → http://127.0.0.1:5181. OSM footprints + source roads/LiDAR, scene0061 only. Product unchanged; owner visual/alignment acceptance pending.

Plan40 style override: owner AVIF reference → pastel preview at5181; `preview/main.ts` owns palette and camera only. See `evidence/pastel-checks.txt`.

Plan40 full-map entry:`complete_map.py`→`preview/data.json`→existing`build.mjs`;`verify-render.mjs` builds/exercises actual Three geometry without browser.420×420m pastel neighborhood at5181;source classes unchanged.

Plan40 camera depth: `preview/cameraDepth.ts` adapts near plane for distant roads; regression/evidence in `verify-scene.ts` / `evidence/depth-checks.txt`.

Plan41 `planning/41_2026-10-13_3d-display/`: comprehensive3D update, P01 lightweight per-class model research, owner approval before implementation.

**Plan42 pastel20 preview:** `planning/42_2026-10-13_pastel-maps/` owns geography.py/export_sources.py/fetch_tiles.py/reconstruct.py, preview scene/main, public manifest+maps, build.mjs/publish_local.py. Reuses plan40 footprint parser (optional projection callback).localhost5181. Plan41 objectmodels cancelled.

- Mainweb pastel (v0.31.0): `backend/topeye/scenario/pastel.py`, `backend/scripts/package_pastel_maps.py`, `backend/assets/pastel-maps/` → `sourceEnvironment.ts` / `pastelStyle.ts` / `scene3d.ts`; docs/scenario.md; plan42 SPEC-P02-WEB.md.

- v0.31.1 cabin bonnet: `cabinCamera.ts#createCabinHood`, TrackView camera subtree; docs/scenario.md / plan42 P03.

**Plan48 P03 — 2026-10-16T20:37:00+07:00:** Có hướng dẫn mặc định: chọn ý định → gợi ý xe có ego theo sau → preset hợp lệ và thời điểm → hai kết quả thật → xuất. Chuyên sâu giữ 20 mẫu/tham số; engine/API không đổi. 70/70 tests, typecheck/build exit0, Chrome 9 bước/12 gói/0 lỗi, HTTP200. Chờ duyệt trải nghiệm; preview trên0.35.0. `frontend/src/scenario/unified/guidance.ts` owns intent/preset adapter; `docs/unified.md`; evidence `planning/48_2026-10-15_unified-scenario-demo/evidence/beginner/`.

**Mainweb guided 2026-10-16T20:50:23+07:00:** v0.36.0 mainweb: Có hướng dẫn trên thanh công cụ, dùng cảnh đang chọn; quay về không gian làm việc. 71/71 focused tests, typecheck/build exit0; Chrome từ root URL 11 bước/12 gói/0 lỗi. Engine/API không đổi. Toàn bộ tương tác ego cùng làn chưa triển khai. Entry `ScenarioApp.tsx` lazy-loads `unified/UnifiedScenarioDemo.tsx`; contract [docs/unified.md](../docs/unified.md), P04 and evidence/mainweb in Plan48.

**Main default 2026-10-16T21:40:31+07:00:** v0.36.1: chọn dataset trên web chính mở thẳng cùng component/bộ nút demo (Có hướng dẫn/Chuyên sâu/thanh5bước). AccessApp initialGuided=true, chờ source load trước khi gọi API. Back trả công cụ cũ.72tests/typecheck/build pass;Chrome12bước12gói0lỗi. Evidence `planning/48_2026-10-15_unified-scenario-demo/evidence/main-default/`; P04 addendum supersedes toolbar-only launch.

**Plan49 — v0.37.0 shared workspace:** `frontend/src/scenario/workspace/ScenarioWorkspace.tsx` owns draft/results/jobs, `useScenarioSession.ts` isolates resources and source reuse, `ScenarioTools.tsx` adapts advanced Runner/ReactiveDock. `frontend/server/scenario-groups.mjs` persists validated `.scenario-groups.json`; worker records additive hashed source event binding. AccessApp always enters the same shell; legacy query aliases it. Contracts: [docs/unified.md](../docs/unified.md), [Plan49](../planning/49_2026-10-16_scenario-unify/plan.md). FE538/server51/BE819 pass; browser13packages/5groups/reload,20scene18supported,EN/light/mobile pass;mainweb5180 v0.37.0 verified. Owner visual pending.
