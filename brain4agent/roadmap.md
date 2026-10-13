# Roadmap & Active Tasks

Mục tiêu chính từ2026-10-09: đề N3-09B, app desktop tạo/phát lại OpenSCENARIO từ nuScenes; đo quỹ đạo và số kịch bản hợp lệ. Blender/NuRec/perception là nghiên cứu phụ, chưa nghiệm thu và không tự chạy tiếp.

## Mục tiêu hiện tại (Active)
- [x] [Plan34](../planning/34_2026-10-13_dataset-intake/plan.md) v0.23.0: local login/catalog + native AV2 10 logs + nuScenes mini10; local E2E đạt.
- [x] v0.8.0: [Plan09](../planning/09_2026-10-09_sensor-views/plan.md) — 3D/LiDAR quét ngang/map nuScenes theo timeline;160frontend,independent24,standalone2/2esmini đạt; đã cài/mở app.
- [ ] Chủ dự án nghiệm thu bằng mắt 0.8.1→0.12.3 (thay các mục nghiệm thu v0.5/v0.8; LiDAR giả lập 2D, nhà/cây ước lượng LiDAR).
- [x] [Plan19](../planning/19_2026-10-12_audit-fixes/plan.md) audit fixes 0.12.4 (installed, desktop test PASS).
- [x] [Plan23](../planning/23_2026-10-12_lidar-layout/plan.md) LiDAR đo thực + kéo/zoom + phóng to khung 0.16.0.
- [x] [Plan33](../planning/33_2026-10-13_scene-metrics/plan.md) chỉ số kịch bản tự động trong OpenSCENARIO (Topeye vs baseline) 0.22.0.
- [x] [Plan32](../planning/32_2026-10-13_loading-end/plan.md) màn hình tải + giữ hình cuối cảnh + xếp hàng yêu cầu 0.21.1.
- [x] [Plan31](../planning/31_2026-10-12_runner-map/plan.md) bỏ khối chạy esmini, map 2D lên cột phải 0.21.0.
- [x] [Plan30](../planning/30_2026-10-12_scenario-manage/plan.md) quản lý kịch bản (tạo/xuất/sửa/xoá) 0.20.0.
- [x] [Plan29](../planning/29_2026-10-12_lidar-return-fix/plan.md) sửa LiDAR/map sai khi từ OpenSCENARIO về Cảnh nguồn 0.19.2.
- [x] [Plan28](../planning/28_2026-10-12_scene-list/plan.md) cảnh nguồn dạng danh sách 0.19.1.
- [x] [Plan27](../planning/27_2026-10-12_drop-extract-ui/plan.md) bỏ Trích đoạn/Biến thể/Kiểm chứng khỏi giao diện 0.19.0.
- [x] [Plan26](../planning/26_2026-10-12_icon-rail-runner/plan.md) thanh icon + giao diện chạy OpenSCENARIO 0.18.0.
- [x] [Plan25](../planning/25_2026-10-12_clean-panels/plan.md) khung xem không chữ hướng dẫn 0.17.1.
- [x] [Plan24](../planning/24_2026-10-12_layout-lidar3d/plan.md) bố cục 9 mục + LiDAR 3D xoay/nghiêng 0.17.0.
- [x] [Plan22](../planning/22_2026-10-12_drop-desktop/plan.md) bỏ app desktop Electron 0.15.0; Cloudflare project đã xoá.
- [x] [Plan21](../planning/21_2026-10-12_local-web-full/plan.md) web localhost đầy đủ 0.14.0 (`npm run web:local`).
- [ ] [Plan20](../planning/20_2026-10-12_web-demo/plan.md) web demo tĩnh 0.13.0: code giữ; Cloudflare project ĐÃ XOÁ theo chủ dự án (chưa cần deploy). Mở lại khi cần chia sẻ.
- [x] Nâng cấp UI Dashboard (v0.7.0): Chuyển đổi giao diện sang Dark Mode IDE-like với Tailwind CSS và shadcn/ui. [Plan08](../planning/08_2026-10-09_ui-tailwind-shadcn/plan.md).
- [x] v0.5.0: [cảnh gốc đầy đủ](../planning/06_2026-10-09_original-scene/plan.md), map/LiDAR đơn sắc;565backend/145frontend, installed và review đạt.
- [x] v0.4.0: khung hiển thị kịch bản 3D theo ảnh người dùng; camera bám xe/xoay/zoom/toàn cảnh và đọc pose esmini. [Plan05](../planning/05_2026-10-09_scenario-3d/plan.md).
- [x] Chốt mục tiêu N3-09B + app cài trên máy; audit local10scenes/18538annotationrecords.
- [x] Tạo [SPECpackage04](../planning/04_2026-10-09_scenario-desktop/plan.md): macOSarm64/Electron+React+Pythonstdio/esmini; v0.3.0 local desktop.
- [x] N3-09B extraction/export/esmini/variants/metrics: baseline +3 biến thể thực đạt; source và fail evidence được giữ.
- [x] App standalone arm64 ngoài repo, sandbox/stdio, engine ABI/dimensions/centers; kiểm thử installed dùng PATH=/usr/bin:/bin.
- [ ] Apple signing/notarization, Windows, verified HD map và mở lại project đã lưu: các đợt sau.

## Mục tiêu trước đây — tạm ngưng ưu tiên (không xoá lịch sử)

- [ ] **Nghiệm thu chất lượng môi trường NuRec**: scene0103 native40000/trainexit0,1613fullPNG/7MP4 đãverified; review8774. Cònuservisualacceptance/nền sạch; chưaweather/CARLA. Old0061giữ nguyên.
- [x] Đã push snapshot Topeye v0.2.0 vào P-056/main tại `source-tool/topeye`, commit `95fd2b2`; GitHub API xác nhận,68backend+136frontendtest và build/lint pass.
- [ ] **S15 chất lượng CARLA:** đã duyệt và triển khai hai contract; pilot `lookdev_s15_v3` có 4 ảnh camera + góc tự do, 531 test pass. Nhà/cây tốt hơn nhưng còn nền xa trống, vạch vụn và actor low-poly; chưa đóng gate mắt hoặc full-scene 20 phút.
- [ ] **StreetGS 30k → mesh:** splat đã xem được ở `http://127.0.0.1:8772/30k/`; TSDF+LiDAR+atlas 60/234 góc còn thủng, đã dừng thử thêm. Cần quyết định hướng hình học nếu tiếp tục; không mở thêm job Kaggle tự động.
- [ ] **Kế hoạch 02 – POC real-to-sim 1 scene** (`planning/02_2026-10-05_blender-real2sim/`):
  - WP-A, WP-S1, WP-S2, WP-S3 và WP-E đã ✅ (2026-10-06).
  - G-POC: đo bằng máy đã ✅ local, **chờ người dùng duyệt bằng mắt** các ảnh `evidence/s3/compare_*.jpg`.
  - Sau duyệt: bump v2.0.0.
- [ ] **Gate G-sim (đợt sau):** sinh dữ liệu nhiều scene × nhiều preset, train YOLO theo 2 nhánh real vs real+sim, đo trên ảnh thật đêm/mưa (`scene-1077`, `scene-1094`, `scene-1100`). Đạt khi tập đêm tăng ≥ +3 mAP và tập ngày không tụt quá 1 điểm.
- [ ] **Giao thông dày hơn:** `density` đang nhân theo số xe chạy thật trong scene (scene-0061 chỉ có 2 xe), nên mật độ 3 mới ra 6 xe. Cần đổi sang mật độ tuyệt đối (xe/100 m làn).
- [ ] Đưa giờ trong ngày (hướng mặt trời) vào contract scenario và Blender.
- [ ] Pipeline fusion kiểu YOLO-LiDAR-Fusion trên adapter của ta (baseline đo mAP 3D).

## Tương lai (Upcoming)
- [x] ~~Xử lý audit frontend cũ~~: xong ở 0.12.4 (plan19); còn 7 high dev-only trong shadcn CLI.
- [ ] Chạy layout và render cho đủ 10 scene nuScenes-mini, ở tất cả các frame.
- [ ] Dữ liệu thật 8 cam của team: viết adapter mới. Nếu không có map làn thì tự dò làn từ intensity LiDAR.

## 💡 Kho Ý Tưởng & Backlog (Idea Vault)
*Nơi lưu trữ các ý tưởng hay, kiến trúc mở rộng chưa ưu tiên làm ngay nhưng cần giữ lại để tham khảo.*
- [ ] **Chạy esmini trên giao diện** (bỏ ở 0.21.0 theo chủ dự án): nếu cần lại, gợi ý icon ▶ trên dòng kịch bản; backend replay_imported vẫn sẵn.
- [ ] **Trình sửa kịch bản trực quan** (0.20.0): hiện "Sửa" là sửa XML; có thể kéo điểm quỹ đạo trên map/3D rồi sinh XOSC.
- [ ] **Khôi phục từ .trash trong app** (0.20.0): hiện phải chuyển thư mục tay.
- [x] ~~**E2E dùng thư mục lưu riêng**~~ (0.20.0: E2E tự xoá kịch bản nó tạo; vẫn dùng workspace thật, các gói vào `.trash`): `test-local-web.mjs` đang ghi gói/run vào workspace thật của chủ dự án (thư viện hiện ~20 gói `fixture.xosc`/"kịch bản <mã>"); nên cho E2E workspace tạm + nút xoá kịch bản trong thư viện.
- [x] **Dọn artifact desktop cũ** (2026-10-12, chủ dự án đồng ý): 17 `.app` + `frontend/{release,build,dist}` + `backend/build` (≈15 GB) chuyển vào `~/.Trash/topeye-desktop-20261012-195140` (khôi phục được tới khi dọn Thùng rác).
- [ ] **Một lệnh khởi động không cần Terminal** (0.15.0): ví dụ script `.command` mở `npm run web:local`, vì bản web cần repo/venv/Node.
- [ ] **Bỏ phụ thuộc shadcn CLI** (plan19): chỉ dùng `shadcn/tailwind.css` trong `src/index.css`; vendor file CSS đó để gỡ 7 high dev-only (braces chain).
- [ ] **Build chậm ~50 s ở Tailwind transform** (Vite 8, plan19): kiểm phạm vi quét nguồn `@source` của Tailwind v4.
- [ ] **Chạy biến thể hàng loạt + xuất báo cáo CSV/HTML** (audit 2026-10-12): tăng trực tiếp chỉ số số kịch bản hợp lệ.
- [x] ~~Notarize Apple / bản Windows~~: không còn áp dụng, desktop đã bỏ (0.15.0).
- [ ] **Dựng 3D nhanh hơn khi đổi cảnh** (plan16): phía trình duyệt còn ~1.1 s (drape địa hình + model); cân nhắc dựng trong worker/Web Worker hoặc cache geometry theo cảnh.
- [ ] **Bus/truck GLB có giấy phép** (plan15): hiện là thân thủ tục cùng bảng màu xe con; cần nguồn CC0/CC-BY xác minh offline trước khi bundle.
- [ ] **Hàn đỉnh polygon nguồn trước khi drape** (2026-10-10, plan14): 0–15 T-junction >2 cm/scene (max 0.245 m) còn lại do polygon kề nhau không chung đỉnh; chèn đỉnh lên cạnh kề / weld trước khi tam giác hoá. Probe: planning/14_2026-10-10_ground-contact/evidence/tjunction-probe.test.ts.
- [ ] **Cụm ô nền cao tự nhất quán biệt lập (cầu/mái ≥2 ô, 1100: 3.15 m) và ô chỉ có lân cận 12–20 m (0061: 4.35 m)** vẫn lọt bộ lọc spike; cần phân lớp đa tầng theo LiDAR/annotation.
- [ ] **Hybrid 3DGS → mesh có ràng buộc** (người dùng hỏi 2026-10-08): dùng LiDAR neo kích thước, RGB/depth đa góc 3DGS để suy facade/hình dáng/màu, completion mesh kín cho phần thiếu. S14 chỉ chứng minh TSDF trực tiếp chưa đạt; không loại toàn bộ tín hiệu 3DGS. Chưa triển khai lớp suy luận facade từ 3DGS.
- [ ] **Real-to-sim cảnh Việt Nam từ dữ liệu VinFast** (Hà Nội, 66 frame × 8 cam fisheye + PCD, chỉ dùng local). Cần: (a) hiệu chỉnh đủ 8 camera (hiện chỉ có `CAM_P_F`), (b) pose xe (ước bằng ICP giữa các PCD), (c) adapter mới cùng interface `DatasetAdapter`, (d) camera fisheye trong Blender (Cycles panoramic) hoặc undistort.
- [ ] **Bộ asset VN mở rộng:** taxi VinFast màu xanh ngọc, tài xế công nghệ áo xanh lá, đèn quả cầu trên trụ cọ, lề và cột sơn đỏ trắng (theo ảnh tham chiếu VinFast).
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
- [x] **v0.6.0 Dataset Import (2026-10-09):** Backend hỗ trợ `resolve_dataset`/`inspect_dataset`, trả về `version`/`scenes`. Frontend tích hợp `chooseDataset` và tự động load scene đầu tiên. App packaged thành công, pass 572 tests backend và 145 tests frontend. [Plan 07](../planning/07_2026-10-09_dataset-import/plan.md).
- [x] **Tiếp nhận Claude / StreetGS 30k (2026-10-08):** xác nhận Kaggle COMPLETE, checkpoint 30000; xuất splat 1.010.984 Gaussian; viewer có splat/mesh; thử TSDF+LiDAR+atlas 149.999 tam giác, GLB 25,9 MB. Kết luận mesh chưa đạt (phủ camera trước 29,3%). Backend 525 pass, giữ G-POC/G-sim mở. Chi tiết `docs/sim.md`, SPEC-S14, evidence/s14.
- [x] **S11 pilot procedural (2026-10-07):** 17,4 phút cho 6×39 ảnh, KID tốt nhất trong các hướng (65,3), nhận diện 0,54. Còn mở: mẫu xe chi tiết (cần tài khoản Sketchfab/BlenderKit) để đạt ≥ 0,8; đưa cảnh procedural lên web.
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

## Cập nhật bàn giao 2026-10-08
- Chủ dự án xác nhận đã chuyển sang thuê/sử dụng GPU qua Kaggle; quyết định cũ loại thuê GPU vì chi phí không còn áp dụng cho hướng này. Không tự mở rộng sang dịch vụ khác hoặc quyền upload dữ liệu riêng.
- S15: SPEC hiện đã ghi hai contract được duyệt, code/test/pilot đang triển khai; các dòng chờ duyệt phía trên là trạng thái cũ. Chưa đóng gate mắt/G-sim.
- Hồ sơ team: [PROJECT_HANDOFF.md](../docs/PROJECT_HANDOFF.md).

- Historical / superseded: NuRec40k request: localpackage/SPEC-P03ready, reuseaux, fullcheckpointbackupmandatory; additional3.50USD/3h approvalpending, no newremotejob.

- Supersedes fresh40kproposal: ưu tiênweights-only30kresume auditedschedule +qualitycandidate800x450/nativeUSDZrender; noautofreshfallback. Useroke3.50USD/3h; browser14pausedhardstop, chưaVM/job.

- User chọn dữ liệu mới: SPEC-P04 PhysicalAI NCore candidate100ae358,1.95GB/10files; pinnedinventory/hashready, HF401 chờuserterms/auth. Inspectactualimages+calibration beforeGPUrent; giữold30k, khôngtrainnốioldsceneởlượt tiếp.

- [x] NuScenes-only selection/localpreparation2026-10-09: scene-0103 from10localmini/180images,0missing;SDK18valid1384images/389lidar/2035EXTERNALboxes,7preservedstores; independent8/8. SPEC-P05active; P04PhysicalAIcancelled.
- [x] NativeNuRec scene0103:40000steps/800×450train,1613PNG1600×900/full6cams+frontnovel1m; allPNGdecode+7MP4PASS; fullCP/USDZ/aux/logs/renderarchive SHAverified; independent14/14. VMdeleted02:27+07, estimate2.25USD/invoiceunverified.

- [x] NuRec0103 full-render localjob prepared; dataSHA/shellsyntaxPASS.
- [ ] Native40k/all6camera900pxrender+optimizercheckpointbackup; browser14explicitresume required, cap3.50USD/3h.

- [x] scene0103 paidL40Screated withinapprovedcap; GPU/nativeparse/configguardPASS.
- [ ] AUXrunning→full40k/native900pxrender→verifiedoptimizer/USDZbackup→VMdelete.

- [x] scene0103 interactive3D local8775: fullbackground+road2,285,393Gaussian exported from40kUSDZ; nativeoldsceneoracle bitwisePASS, independent11/11. No newpaidjob.
- [ ] Userreview interactive0103quality; nativeappearance/cleanbackground/weather remainopen.

- [ ] NuRec0103 rendererA/B: nativevideo acceptable to user; precisioncandidate prepared; browservisualQA pendinguserresume, no newtraining.

2026-10-09T09:22:20+07:00 Userauthorizedobsoletefilecleanup forN3-09B. Moved 146360 files/57129709956 logicalbytes to /Users/macos/.Trash/topeye-obsolete-20261009-092105 viarename; reversible, diskspaceNOTfreeduntilTrashemptied. All213protectedsourcefilesunchanged. Stopped6ownedviewers8770–8775. RetainedexternalnuScenes,mainvenv/node_modules,manifestreferencedassets,andlayout.json+ground_drivable.pngforregression. Workspace~2GiB. Evidence: plan04/evidence/local/cleanup-manifest.json. Backendbefore531pass; after531pass/0fail/0skip(36.11s), frontendtypecheckexit0. OldNuRec/StreetGS/Blenderoutputs andisolatedtools no longeratpriorpaths.


## Ferrari theme patch — 2026-10-09T16:39:39+07:00

v0.8.1 Ferrari theme: desktop studio canvas #181818/panels #303030, sparse Rosso Corsa #da291c primary CTAs, sharp uppercase buttons, neutral map/LiDAR, visible focus and disabled states. Layout/IPC/geometry unchanged. Build + 160/160 tests pass; packaged signed app QA 1360×900 and 1050×720: 13 sharp buttons, 0 horizontal overflow, 0 renderer errors. Installed ~/Applications/Topeye 0.8.1.app. Evidence: planning/10_2026-10-09_ferrari-theme/evidence. User aesthetic acceptance pending.


2026-10-09T16:43:20+07:00 — v0.8.2: logo PNG do chủ dự án cung cấp thay dấu T ở header; giữ nguyên file gốc, hiển thị contain 44×44, không đổi bố cục/luồng. Build và 160/160 test đạt.


2026-10-09T17:09:20+07:00 — Plan11 SPEC ready: current-map context export + restricted timestamped XOSC import for ego/vehicles/pedestrians + measured replay; chatbot deferred. No implementation or 0.9.0 version bump. Awaiting owner approval per Spec-First §3.


## Map-bound OpenSCENARIO v0.9.0 — 2026-10-09T21:36:47+07:00

v0.9.0 local: map-bound OpenSCENARIO import/export context/reopen/measured replay for ego,vehicles,pedestrians; profile topeye-map-trajectories-v1 (XML1.0 world timed polylines), no chatbot. Backend609/frontend171 pass0skip; real imported and legacy desktop gates pass,13source hashes unchanged/0renderer errors/0owned children. MapID numeric canonicalization survives Node JSON; dataset paths rebound app-side. Invalid map surfaces0103/0655 reject;8mini scenes have valid contexts; source geometry unchanged, estimated building collisions use conservative hulls. Installed ~/Applications/Topeye 0.9.app.
Plan: planning/11_2026-10-09_xosc-map-import/plan.md; module docs/scenario.md; modules map_context.py/xosc_import.py/imported_replay.py + private worker/IPC/UI. All local gates complete at 2026-10-09T21:38:26+07:00.


## Sensor zoom PATCH — 2026-10-09T21:51:35+07:00

v0.9.1: map/LiDAR zoom1–8× by wheel and +/−/reset; centered on ego, resets per scenario; Rosso Corsa #da291c ego markers/heading in both views. View-only, sensor60m/180rays and poses unchanged. Frontend174/174/typecheck/build/package pass; installed zoom/wheel/reset/computed red verified at1360×900/1050×720,0page errors. Installed ~/Applications/Topeye 0.9.1.app.
Shared frontend helpers: useSensorZoom.ts / SensorZoomControls.tsx; evidence plan11/evidence/zoom.

## Done — detailed driving scene 0.10.0
- Plan `planning/12_2026-10-09_scene-detail/`: detailed monochrome actors/environment with LOD, continuous road/markings, licensed VinFast ego, CARLA 0.9.15 presentation weather and header OpenSCENARIO actions. Owner approved; implementation, independent review and installed acceptance complete. Genuine licensed VF3 acquired via normal download and normalized offline; live front-vehicle gap and image-directed camera implemented. Final installed acceptance and extension review passed. First packaged frame p95~10.1ms,120RAFfps; full192frontend/609backend tests pass.


## Detailed driving scene v0.10.0 — 2026-10-10T09:13:41+07:00
Installed /Users/macos/Applications/Topeye 0.10.0.app. Genuine CC BY4 VinFast VF3 ego (red paint, high49,885/far≤8k), licensed grayscale traffic sedan/SUV, smooth pedestrians/cycles/instanced trees/beveled estimated buildings; neutral road depth support/joined markings with invalid source ring warnings preserved. Live forward bumper gap uses current source/import/replay poses and OBB supports (scene0103:38.3m at5s→14.6m at10s); cyan corridor follows actual ego samples. CARLA0.9.15 exact22presets are presentation-only; header OpenSCENARIO import/export-map/reopen replaces readiness badge.
Frontend216/backend609 pass0skip, scopedlint/typecheck/build/package exit0; independent63extensiontests plus topology/weather/abort/offline probes passed. Installed imported coverage1/maxXY0/maxYaw0; legacy2actual engine cases passed;13sourcefiles unchanged;0renderer errors/0ownedchildren. Native weather/window1050×720/1360×900 and10scene switches pass; GPUgeometry54/78 and1texture stable byscene. Earlier0.10.0 interactive30swarm+60ssample119.6RAFfps,p95=9.3ms; screenshots show scene/time varied, so this is not a fixed-scene A/B comparison. Fixed-scene measurement follows inpatch13. Bundle233,375,305B, +2,176,680B vs0.9.1.
Evidence: planning/12_2026-10-09_scene-detail/evidence/{driving-view,performance-final,desktop,imported-release,legacy-release,audit-p03}. Plan12 local gates complete; user visual signoff remains owner discretion, no remote release/commit/push. Weather scattering/friction and estimated environment are not CARLA physics or surveyed geometry.


## Stop-region display PATCH v0.10.1 — 2026-10-10T09:28:54+07:00
Fixed large white pavement patches: nuScenes stop_line polygons are semantic stopping areas, so3Drenderer omits their full whitefill. Roadsupport/holes/crossings/dividers/sourceJSON/mapcontext/actorposes remain unchanged; no invented stopstripe. Installed /Users/macos/Applications/Topeye 0.10.1.app. Regressionred1fail/20pass→green21pass;fullfrontend217pass0skip;independentreview21pass/typecheck0;build/package/nativebefore-after exit0,0renderererrors. Source0553/time0/overview before.png andafter.png show removed patches withcrosswalks retained. Controlled source0061/time0 benchmark30swarm+60ssample120.02RAFfps/p95=8.8ms,0errors; guard checks scene/time everyframe. Earlier interrupted run rejected, evidence retained. Backendlogic unchanged;609tests from0.10.0 remain applicable. No commit/push. Evidence: planning/13_2026-10-10_stop-region/evidence/.


## Done — Map polish & faster load v0.12.1 — 2026-10-10T15:20:28+07:00
- Plan16: map stop_line patches removed, equal header buttons, trees/poles off roads, faster scene load (byte-identical) + worker LRU. Installed 0.12.1; owner visual sign-off pending; no commit/push.

## Done — Vehicle style, lamps, cabin view, class map v0.12.0 — 2026-10-10T13:45:47+07:00
- Plan15 complete locally (2 independent audits, findings fixed): bus/truck style, front/rear lamps, "Trong xe" camera, class-coloured integrated map, fading gap corridor. Installed `~/Applications/Topeye 0.12.0.app`; owner visual sign-off pending; no commit/push.

## Done — Ground & static contact v0.11.0 — 2026-10-10T12:35:21+07:00
- Plan14 complete locally: LiDAR/annotation ground support, source-only contact/tilt, building trim against vehicle corridors, conforming adaptive drape, spike-cell rejection. Installed `~/Applications/Topeye 0.11.0.app`; owner visual sign-off pending; no commit/push.


## Done — Source vehicle contact v0.12.2 — 2026-10-10T15:46:15+07:00
- Plan17 completed local: generalized source terrain contact;10 scenes/13307 vehicle poses,282frontend/15scopedbackend,installed0errors/importedPASS/p95=9.3ms. Installed0.12.2; owner visual sign-off pending; no commit/push.


## Done — Native app logo v0.12.3 — 2026-10-10T15:57:06+07:00
- Supplied logo embedded as Dock/Finder application icon; same original header logo verified.282tests/build/signature/installed UI+icon checks PASS. Installed0.12.3; no commit/push.

- ✅ v0.31.1: visible red bonnet in cabin only;24triangles, same driver eye and actor poses;17focused tests.
