# Topeye Scenario — N3-09B, v0.22.0

## Tóm tắt phiên bản hiện hành

- 0.10.0: ego VinFast VF3 có giấy phép, xe giao thông xám, khoảng cách xe trước, 22 preset thời tiết CARLA (chỉ hiển thị), XOSC trên header.
- 0.10.1: bỏ mảng trắng lớn của vùng dừng nuScenes.
- 0.11.0: nền LiDAR/annotation, tiếp xúc/nghiêng theo nguồn, cắt nhà theo hành lang xe.
- 0.12.0: thân bus/truck, đèn trước/sau, camera "Trong xe", map tô màu theo loại + chú giải.
- 0.12.1: bỏ vạch dừng trên map, nút header đều nhau, cây/cột không nằm trên đường, đổi cảnh nhanh hơn.
- 0.12.2: xe nguồn bám mặt địa hình hiển thị (hình chữ nhật tựa bánh xoay).
- 0.12.3: logo chủ dự án làm icon app macOS.
- 0.12.4: Vite 8/Vitest 5, viewer cũ ra khỏi build.
- 0.13.0: web demo tĩnh.
- 0.14.0: web localhost đầy đủ tính năng.
- 0.22.0: khối **Chỉ số kịch bản** trong cột báo cáo OpenSCENARIO (dưới Map 2D). Mở một kịch bản ⇒ app tự tính ở worker riêng (`scenarioMetrics` → `scenario_metrics`, cache `<thư mục lưu>/<id>/metrics/scene-metrics-v3.json`). 4 thẻ: sai số phát lại Topeye (esmini chạy chính XOSC, so với mốc quỹ đạo) vs baseline (vận tốc không đổi), vật thể chuyển động (≥ 2 m và ≥ 0,5 m/s), biến thể hợp lệ (tốc độ ×0,8–1,2 × dịch ±2/±4 m; kiểm động học, map, va chạm, esmini ≤ 0,25/0,5 m), tình huống hiếm (TTC < 1,5 s với ego ≥ 5 m/s). Vật thể đang chọn: độ lệch tại thời điểm xem (dọc/ngang), biểu đồ theo thời gian. Xoá kịch bản lúc đang đo ⇒ `NOT_FOUND`, không tạo lại thư mục. Định nghĩa: `planning/33_2026-10-13_scene-metrics/specs/00-SPEC.md`.
- 0.21.1: vòng tải "Đang tải dữ liệu" khi nạp/dựng cảnh; giữ hình ở cuối cảnh (ngưỡng thời gian 1 µs); server xếp hàng yêu cầu (nhiều tab không còn BUSY).
- 0.21.0: màn OpenSCENARIO bỏ khối "Chạy ESMINI" (không còn nút chạy esmini trên giao diện); map 2D ở đầu cột phải thay map nhỏ trong 3D. Kết quả/lịch sử đọc từ các lần chạy đã lưu.
- 0.20.0: thư viện OpenSCENARIO: nút "Tạo kịch bản" (hộp thoại chọn map · tải thông tin map · chọn .xosc), mỗi kịch bản có Xuất/Sửa (XML)/Xoá (vào .trash); bỏ ô tick, chạy hàng loạt và nút ở tiêu đề; tên mặc định lấy từ description của .xosc.
- 0.19.2: sửa lỗi quay từ OpenSCENARIO về Cảnh nguồn vẫn hiện kịch bản nạp (LiDAR mô phỏng, map sai); màn xem cảnh luôn hiện cảnh gốc đang nạp, runner nhớ kịch bản/kết quả; ngăn Cảnh nguồn rộng 200 px.
- 0.19.1: ngăn Cảnh nguồn = danh sách cảnh bấm để mở (bấm lại = về dữ liệu gốc); bỏ nút "Xem cảnh gốc" và ô tick map; map luôn hiển thị.
- 0.19.0: bỏ Trích đoạn / Biến thể / Kiểm chứng / Xuất kịch bản / chọn xe bằng click khỏi giao diện; chạy esmini chỉ qua màn OpenSCENARIO (backend/CLI giữ nguyên).
- 0.18.0: thanh icon trái + ngăn kéo, thanh trên chỉ logo "Topeye", bỏ thanh trạng thái; giao diện riêng chạy OpenSCENARIO (thư viện, chạy hàng loạt, lịch sử) (mục cuối).
- 0.17.1: 3 khung không còn tiêu đề/hướng dẫn/chú thích/nút phụ — chỉ biểu tượng phóng to; map giữ chú giải loại; LiDAR giả lập có nhãn nhỏ "MÔ PHỎNG".
- 0.17.0: LiDAR 3D xoay/nghiêng, bố cục mới (menu Dữ liệu, ẩn thanh bên, bước chạy luôn thấy, chip cảnh báo, chọn xe bằng click, vùng trích đoạn trên timeline, toast lỗi) (mục cuối).
- 0.16.0: LiDAR đo thực trong khung LiDAR, kéo để di chuyển LiDAR/map, nút phóng to từng khung.
- 0.15.0: **bỏ app desktop Electron**; chạy duy nhất bằng `npm run web:local` (mục cuối). Các đoạn bên dưới nhắc "app/desktop/Electron/.app" là lịch sử ≤0.14.0.


Ứng dụng web chạy trên máy (localhost, từ 0.15.0; trước đó là app desktop Electron): đọc quỹ đạo nuScenes → xuất OpenSCENARIO 1.0 + OpenDRIVE → phát lại bằng esmini 3.9.0 → tạo biến thể tốc độ/vị trí → báo cáo sai số và số kịch bản hợp lệ. Giao diện React chạy trong trình duyệt, nói chuyện với server Node chỉ nghe 127.0.0.1 (`frontend/server/`), server điều khiển worker Python 3.12 qua JSONL stdio và esmini arm64 build trong repo. Cần repo + `backend/.venv` + Node; không cần GPU.

## Giao diện ba khung v0.8.0

3D là khung chính; bên phải là **Mô phỏng LiDAR** và **Map tích hợp** (có công tắc ẩn/hiện thật). Bỏ gallery camera giả, radar trang trí, độ tin cậy/tốc độ ghi cứng và nút không hoạt động. Thanh bên chứa cảnh nguồn, toàn bộ track (không cắt còn sáu), chọn tối đa ba đối tượng để trích đoạn, biến thể và kiểm chứng. Thanh thời gian dùng chung ba khung. CSS được scope `.studio`, đặt kích thước canvas/HUD rõ ràng, hỗ trợ cửa sổ tối thiểu 1050×720; sidebar tự cuộn.

LiDAR là **mô phỏng hình học quét ngang**, không phải waveform/point cloud nuScenes đo thực, không phải mô phỏng vật lý cảm biến đã hiệu chuẩn. `sensors.ts::simulateScan(scenario, replay, time)` phát 180 tia phủ 360°, tầm 60m, giả định cao 1m trên ego pose. Mỗi tia lấy giao điểm gần nhất với hộp xe có hướng và footprint nhà/cột/cây giản lược; bỏ vật ngoài mặt phẳng cao độ và bỏ ego. Không có giao điểm → không tạo return. Trích đoạn/esmini chỉ quét các actor của trích đoạn, không gắn map cảnh nguồn sang tọa độ đã biến đổi. UI ghi rõ nguồn/giới hạn này.

Map chỉ hiện khi có vector nuScenes: polygon giữ lỗ bằng evenodd, vị trí/yaw actor theo `supportedPose`, khung bám ego 130m, Bắc hướng lên. Thiếu map/pose có thông báo; không vẽ xe/đèn/radar tưởng tượng. Source gaps >1s và replay gaps >0,075s không được lấp bằng pose nguồn. `LidarView.tsx`, `TacticalMap.tsx`, `sensors.ts` tái dùng contracts Scenario/Replay, không thêm IPC hay thay backend.

Tác vụ UI dùng generation token: bấm Hủy vô hiệu mọi kết quả cũ trước khi gọi worker cancellation; kết quả hoặc lỗi đến muộn không được ghi lại cảnh/message. Đây là bảo vệ UI, không thay process-group cancellation trong Electron.

## Dùng bản cài

Mở `~/Applications/Topeye 0.12.3.app`. Bản đóng gói cũng có tại `frontend/release/Topeye-darwin-arm64/Topeye.app`. Chọn thư mục chứa `v1.0-mini`: app tự dựng cảnh gốc đầy đủ. Để đo bằng simulator, chọn 1–3 xe, bấm **Trích đoạn thử nghiệm**, rồi **Chạy phát lại**. **Xuất kịch bản** lưu gói XOSC/XODR/reference/manifest. Thanh tốc độ và dịch dọc đường tạo một reference mới; số kịch bản đạt là số ID đã chạy đạt trong phiên hiện tại, không phải số file xuất.

Preset minh họa đã đo: `scene-0103`, actor `ec0e6425eae2442698ff7b43d405d279` (bicycle), yêu cầu giây 8–13. Giao thời gian quan sát thực bắt đầu khoảng 10,4 giây, nên clip chung khoảng 2,6 giây. Tốc độ 0,8×/1,2× và dịch +2m đều có đủ hỗ trợ dữ liệu. Các lựa chọn khác có thể bị từ chối hoặc báo không đạt; không tự nới ngưỡng.

Workspace mặc định `~/Documents/Topeye Projects`; settings/log tại Electron userData. Mỗi scenario có ID riêng:

```text
<workspace>/<scenario-id>/
  bundle/{scenario.xosc,road.xodr,reference.json,manifest.json}
  runs/<run-id>/{observed.json,report.json,engine-info.json,status.json,engine-output.log,esmini.log}
```

Dataset chỉ đọc. Bundle hoàn tất không bị ghi đè; hash và XML sinh từ reference được kiểm lại trước replay. Hủy/đóng app dừng cả process group riêng, kể cả engine con bỏ qua SIGTERM. App mở lại đánh dấu run còn `running` thành `interrupted`; bỏ qua trạng thái cũ hỏng và mọi đường dẫn vào dataset. Sau hủy, tạo lại kịch bản vì cache worker bị giải phóng.

## Xem kịch bản 3D

Trong cảnh gốc hoặc sau **Trích đoạn thử nghiệm**, bấm ▶ để các đối tượng chạy trong khung 3D. **Bám xe** đặt camera nghiêng phía sau ego; kéo chuột chuyển sang góc tự do, cuộn để zoom. **Toàn cảnh** đưa toàn bộ đối tượng được chọn vào khung; hữu ích khi xe khác ở xa. Sau **Chạy phát lại**, nhãn ESMINI xác nhận hình đang dùng pose simulator. Tốc độ ở góc trên là km/h từ các pose đang hiển thị.

Cảnh gốc hiển thị toàn bộ annotation (kể cả người đi bộ, xe đạp và đối tượng chỉ xuất hiện một lần), ẩn đối tượng ngoài thời gian quan sát hoặc qua khoảng trống >1 giây. Model đơn sắc theo loại/kích thước nguồn; đèn sau màu đỏ chỉ là vật liệu, không phải trạng thái phanh đo được. Van không có nhãn riêng trong nuScenes, giữ nguyên category và dùng kích thước để thể hiện hình dáng.

Mặt đường/vỉa hè/vạch lấy từ nuScenes map expansion đóng gói offline. Nhà/cây/cột là hình học giản lược **ước lượng từ LiDAR**, đã loại các hộp annotation trước khi dựng; không phải mesh khảo sát chính xác. Thiếu map hoặc LiDAR có cảnh báo, vẫn giữ phần dữ liệu nguồn còn đọc được. Lỗ polygon được giữ ở cả mặt đường và lớp sọc qua đường.

Cảnh gốc không xuất/replay trực tiếp và không tính vào số kịch bản đạt. Trích đoạn thử nghiệm vẫn giữ giới hạn đường thẳng tổng hợp và tối đa 3 traffic actor của v0.4.0; nhãn ESMINI chỉ xuất hiện sau khi engine chạy thật.

Renderer nằm trong `frontend/src/scenario/{TrackView.tsx,scene3d.ts,trajectory.ts}`. Transform worldXYZ→Three(X,Z,-Y), yaw quay quanh+Y. Ego pose là origin mặt đất; traffic annotation là tâm hộp. Scene rebuild chỉ khi scenario/replay thay đổi; thời gian chạy cập nhật pose, không tạo renderer mỗi frame. Unmount giải phóng geometry/material/controls/RAF/ResizeObserver/WebGL. Thiếu WebGL hoặc pose có cảnh báo.

## Cài đặt và chạy (0.15.0)

Từ root repo, sau khi đã tạo Python 3.12 venv:

```sh
uv pip install --python backend/.venv/bin/python -e 'backend[dev,scenario-build]'
backend/.venv/bin/python backend/scripts/build_scenario_engine.py
cd frontend
npm ci
npm run web:local                       # build dist-local + server http://127.0.0.1:5180
npm run test:server                     # 12 test bảo mật server
npm run test:e2e -- /path/to/nuscenes   # E2E 14 bước trên Chrome, dataset + esmini thật
```

Ghi chú lịch sử ≤0.14.0 (đóng gói desktop, đã bỏ):

Build engine kiểm SHA256 của `esmini-fullsrc.zip` v3.9.0: `dbf409d228087ef71e3077498aad181974a1adc222823e7ebcf9cd981b6ceaf8`. CMake tắt OSG/OSI/SUMO/PROJ/IMPLOT; không tải GPU/runtime mô phỏng khác. Xcode Command Line Tools cần cho build, không cần cho người dùng app. Electron archive cache được kiểm bằng checksums của package Electron. Bộ cài ở `frontend/release/Topeye-<version>-mac-arm64.zip`, manifest ghi engine/artifact SHA, phiên bản và kiến trúc. Ký ad-hoc local, **chưa notarize để phát hành công khai**; không vô hiệu hóa Gatekeeper.

```sh
backend/.venv/bin/python -m topeye.scenario.cli probe-engine --engine backend/.tools/esmini/build/EnvironmentSimulator/Libraries/esminiLib/libesminiLib.dylib
backend/.venv/bin/python -m topeye.scenario.cli accept --dataset /path/to/nuscenes --engine backend/.tools/esmini/build/EnvironmentSimulator/Libraries/esminiLib/libesminiLib.dylib --workspace /new/acceptance-directory
node frontend/scripts/test-local-web.mjs /path/to/nuscenes /existing/evidence-directory
```

`accept` chọn reference đáp ứng các ngưỡng động học trước, rồi bắt buộc chạy baseline và 3 biến thể qua engine. Reference preflight không được tính là bằng chứng simulator. `test-local-web.mjs` (thay `test-desktop.mjs` từ 0.15.0) tự dựng server localhost, điều khiển Chrome qua Playwright: nhập đường dẫn dataset, cảnh gốc, trích đoạn, phát lại esmini, biến thể, xuất kịch bản, tải map context, tải lên/chạy/mở lại `.xosc`, huỷ rồi chạy tiếp; kiểm hash metadata dataset trước/sau, 0 worker sót, 0 request ngoài 127.0.0.1.

## Contracts và giới hạn

- Extractor dùng raw global `sample_annotation` và `ego_pose`; không dùng `gt_boxes()` LIDAR-local. Dịch origin theo ego đầu clip, giữ timestamps, unwrap yaw, không ngoại suy, không nội suy qua gap >1s kể cả tại biên clip.
- Đường trình diễn thẳng tổng hợp, yaw thay đổi ≤5° và residual ngang ≤1m; không phải HD map nuScenes. Ego dimensions giả định 4,5×1,85×1,6m. Vehicle bounding box bám tâm nguồn; RearAxle X=0 để esmini không tự dịch tâm. Axles là placeholder cho replay vị trí, không phải hình học xe đã hiệu chuẩn.
- Biến thể `s'=a*s+d`, `a∈[0.5,1.5]`, `d∈[-10,10]m`, crop hỗ trợ chung ≥2s. Offset d không phải khoảng hở bumper thực. Xe đứng yên chỉ cho identity.
- Bước engine 0,05s; report đo ADE/FDE/maxXY/yawRMSE/coverage theo đúng timestamps. Pass: coverage ≥99%, ADE ≤0,25m, FDE/max ≤0,5m, yawRMSE ≤0,05rad, speed ≤40m/s, gia tốc sai phân ≤10m/s². Sai phân trên polyline có thể làm clip nguồn bị loại; ngưỡng không được nới để ép pass.
- Khoảng hở dùng hộp xoay 2D và pose engine, bỏ qua cao độ, lấy mẫu 20Hz; không chứng minh không va chạm liên tục. Va chạm có chủ ý không tự làm replay invalid. Biến thể không đồng nghĩa đã chứng minh tình huống hiếm.
- Giao diện 3D Three.js: xe đơn sắc, đèn sau đỏ, dải đường chạy xanh ngọc; camera Bám xe/Toàn cảnh, kéo xoay và cuộn zoom. Trước replay hiển thị reference (XEM TRƯỚC); sau replay lấy observed poses (ESMINI), dừng ở mẫu cuối chung. Không giữ endpoint/che thiếu pose dưới nhãn esmini. Preview không được dùng thay kết quả simulator. Không có dựng cảnh photoreal, thời tiết, autonomous controller hay tích hợp CARLA trong v0.4.0. Chưa có Windows hoặc trình mở/chỉnh dự án lưu sẵn.

## Bằng chứng

[Plan04](../planning/04_2026-10-09_scenario-desktop/plan.md) và `evidence/local/`: `acceptance-final/acceptance.json` 4/4 đạt; `engine-abi-verified/` xác nhận ABI/pose/kích thước/tâm; `installed-app.json` và ảnh chụp app cài; `backend-tests-final.txt`; `desktop-package-final.txt`. [Review độc lập](../planning/04_2026-10-09_scenario-desktop/reports/R01_scenario-review.md) đo lại source, actual engine và 101 phép biến đổi clearance. Bản thử đầu `acceptance/` giữ nguyên 0/4 do gia tốc vượt ngưỡng, không xóa bằng chứng thất bại.

Audit npm còn 6 advisory có sẵn trong toolchain Vite/Vitest (3 moderate, 1 high, 2 critical). Các dev dependencies không được đưa vào `.app`; app dùng assets build tĩnh, không mở Vite server. Nâng toolchain là việc riêng trong roadmap, chưa giải quyết bằng ép major upgrade ở phiên này.

Dữ liệu/render cũ đã chuyển vào Trash theo yêu cầu dọn trước đó; manifest phục hồi tại plan04/evidence/local/cleanup-manifest.json. Nguồn nuScenes và source cũ vẫn giữ.

Bằng chứng v0.4.0: [plan05](../planning/05_2026-10-09_scenario-3d/plan.md), evidence/installed-baseline.png, installed-overview.png, viewport3d.json, installed-app.json và frontend-tests-final.txt.

## Cảnh gốc v0.5.0 — contract bổ sung

`sourceScene({scene: string})` → worker `source_scene` trả `mode="source"`, toàn bộ actors và `environment` gồm polygons/holes, lines, buildings, trees, poles, warnings/provenance. Không đưa ID cảnh gốc vào cache kịch bản được phép export/replay. `source_scene.py` sở hữu chuyển tọa độ theo ego origin; `sourceEnvironment.ts` dựng hình Three.js và giữ lỗ polygon. Thiếu LiDAR trả `stats.complete=false` và cảnh báo, không sinh môi trường giả.

Bằng chứng nằm trong [plan06](../planning/06_2026-10-09_original-scene/plan.md). Scene-0103: 124 đối tượng gồm ego, 2.090 annotation đối chiếu XYZ với dung sai 1e-8m; 125 polygon, 40 đường vector, 13 khối nhà, 107 cây, 43 cột ước lượng. Giữ zip v0.4.0 và app cũ để rollback. Chất lượng hình ảnh cần người dùng nghiệm thu.

Nghiệm thu kỹ thuật 2026-10-09T11:03:13+07:00: backend565/frontend145, independent19probes, installed source+engine+cancel+integrity đạt. Package kiểm113symlink tương đối trong app, SHA ZIP và codesign strict. Kết quả trước sửa giữ tại evidence/*-red.txt; chưa commit/push.

Nghiệm thu v0.8.0 2026-10-09T16:30:18+07:00: [Plan09](../planning/09_2026-10-09_sensor-views/plan.md); frontend160/160, independent24/24, typecheck/build/package exit0. App standalone ngoài repo/PATH tối thiểu: source/map/LiDAR theo timeline,58track,2kích thước cửa sổ,baseline+variant esmini2/2,export,cancel/security/lifecycle đạt;13metadata hashes nguyên vẹn,0renderer errors. App đã cài và mở tại `~/Applications/Topeye 0.8.app`.


## Ferrari theme patch — 2026-10-09T16:39:39+07:00

v0.8.1 Ferrari theme: desktop studio canvas #181818/panels #303030, sparse Rosso Corsa #da291c primary CTAs, sharp uppercase buttons, neutral map/LiDAR, visible focus and disabled states. Layout/IPC/geometry unchanged. Build + 160/160 tests pass; packaged signed app QA 1360×900 and 1050×720: 13 sharp buttons, 0 horizontal overflow, 0 renderer errors. Installed ~/Applications/Topeye 0.8.1.app. Evidence: planning/10_2026-10-09_ferrari-theme/evidence. User aesthetic acceptance pending.


2026-10-09T16:43:20+07:00 — v0.8.2: logo PNG do chủ dự án cung cấp thay dấu T ở header; giữ nguyên file gốc, hiển thị contain 44×44, không đổi bố cục/luồng. Build và 160/160 test đạt.


## Map-bound OpenSCENARIO import — v0.9.0

Hạ tầng cho chatbot tương lai; hiện không gọi AI/API/cloud. Chọn cảnh nguồn → **Xuất thông tin map** → trình tạo dùng context JSON để sinh `.xosc` → **Nạp OpenSCENARIO** → xem trước → **Chạy kịch bản đã nạp**. **Mở kịch bản đã lưu** chọn thư mục `import/` trong workspace của kịch bản, map hiện tại phải khớp. Import thành công tự lưu gói; nút xuất legacy và biến thể speed/gap không áp dụng imported.

Profile duy nhất: `topeye-map-trajectories-v1`, OpenSCENARIO XML 1.0. Inline Vehicle/Pedestrian; đúng một ego; `WorldPosition` x/y/z/h, p=r=0; `FollowTrajectoryAction`/`Polyline`, absolute timestamps, scale1/offset0, zero-time triggers, duration stop. Mỗi model Properties chứa `topeye.map_id`, `topeye.profile`, `topeye.role`. Không nhận OpenDRIVE/catalog/controller/asset ngoài, parameter references, DTD/XXE, action/condition khác profile; không tự bỏ qua các phần không hiểu. File `.xosc` khác profile bị từ chối dù đúng chuẩn ASAM tổng quát.

Giới hạn: XML≤2MiB, 1–32 actors, duration2–60s, 3–1201 vertices/actor, max gap1s; speed≤55m/s phương tiện/4m/s người; acceleration≤12m/s² phương tiện/6m/s² người. Những giới hạn này là kiểm tra đầu vào, không chứng nhận tình huống an toàn.

### Contract cho trình tạo AI

`mapContext({source_id})` trả geometry digest `map_id`, scene/version, origin_global_m, frame source_local (meters, x East/y North/z Up, yaw rad), bounds theo ego nguồn±60m, polygon outer/holes, vật cản tĩnh ước lượng, actor nguồn và limits/capabilities. Không suy ra tọa độ từ ảnh camera. WorldPosition của XOSC là điểm tham chiếu object; app chuyển offset BoundingBox Center theo yaw thành tâm hộp để vẽ/kiểm tra. Initial pose actor nguồn là dữ liệu nuScenes, ego pose mặt đất và annotation pose tâm hộp; generator phải tính đúng offset, không sao chép mù thành điểm tham chiếu XOSC.

AI phải gửi `.xosc` với đúng map/profile, tất cả actors span [0,duration], vị trí teleport khớp vertex đầu. App tự dựng context từ cảnh đã đăng ký, không tin hình học/giới hạn do file nhập cung cấp. Hàm backend `validate_xosc(xml_bytes, context)` là cổng dùng chung cho native file import và tích hợp chatbot sau này. Không có renderer API đọc đường dẫn tùy ý. Private IPC mới: mapContext/exportMapContext/importXosc/openImported/replayImported.

### Kiểm tra map và kết quả

Footprint có yaw nằm trong envelope và union polygon drivable cho xe; người có thể ở walkway/crossing/drivable (cảnh báo nếu đi trên đường ngoài crossing). Có kiểm tra đoạn giữa các vertices, holes và vật cản building/tree/pole. Collision footprint nhà dùng convex enclosure bảo thủ của các đỉnh LiDAR ước lượng; không đổi hình học 3D gốc và không sửa polygon mặt đường. Polygon dữ liệu gốc không hợp lệ bị từ chối `INVALID_MAP_GEOMETRY`; không tự sửa. Kiểm tra mini ghi nhận scene-0103/0655 có road_segment tự giao nhau; scene-0061 và tám cảnh tổng cộng có polygon hợp lệ. Dùng scene-0061 làm fixture nghiệm thu.

Imported actors thay toàn bộ dynamic actors nguồn; giữ map/môi trường nguồn và timeline chung 3D/map/LiDAR. Preview chỉ là quỹ đạo dự kiến; replay lấy trạng thái thực esmini20Hz, chuyển tâm hộp trước khi vẽ. Báo cáo imported tách execution/fidelity/map_conformance/contact observations, không cộng vào counter đạt nuScenes. Contacts là tiếp xúc lấy mẫu, không phải xác nhận va chạm liên tục hoặc chứng nhận an toàn vật lý.

Gói lưu `<workspace>/<id>/import/{original.xosc,normalized.xosc,context.json,scenario.json,manifest.json}`; manifest SHA256 kiểm bốn payload. Replay tạo `runs/<id>/` chứa measured poses/report/status/esmini logs. Reopen xác minh hash, semantic XML và map hiện tại. Native picker cancellation/invalid file giữ cảnh đang xem; actual job cancel dừng process group và vô hiệu handles, cần tải lại cảnh nguồn.

Fixture cho development/QA: `backend/.venv/bin/python backend/scripts/generate_map_scenario_fixture.py <exported-context.json> <output.xosc>`. Đây là fixture xác định, chưa phải chatbot. Runbook/gates: planning/11_2026-10-09_xosc-map-import/specs/OPERATIONS.md và TESTING-ACCEPTANCE.md.

Map digest chuẩn hóa số nguyên/số thực cùng giá trị và signed zero trước SHA256, giữ độ chính xác IEEE double; context xuất qua Electron JSON phải hash giống snapshot Python. XML normalized vượt 2MiB hoặc phản hồi vượt 7MiB bị từ chối trước publish. Mẫu đã đo: planning/11_2026-10-09_xosc-map-import/evidence/desktop/generated.xosc (scene-0061).


## Sensor zoom v0.9.1
Map/LiDAR có nút +/−/đặt lại và cuộn chuột để zoom1–8×. Map vẫn bám ego; LiDAR giữ gốc ở ego. Đổi scenario reset zoom, playback cùng scenario giữ zoom. Zoom chỉ đổi SVG viewBox, không đổi footprint/quỹ đạo/tầm60m hoặc kết quả180tia. Ego và hướng map dùng Rosso Corsa #da291c. Helper useSensorZoom/SensorZoomControls dùng chung hai khung.


## Detailed driving scene 0.10.0

Plan12 is owner-approved; the detailed renderer and driving extension are implemented. `detailModels.ts` owns curved procedural vehicles, smooth people/cycles, two actor LOD levels and per-scene geometry/material templates. Near detail remains enabled at0–42m, high quality forces firstLOD; auto capsDPR1.5 and reduces to1 after sustained slow frames, balancedDPR1, highDPR2. Cosmetic body shapes are not surveyed vehicle identities. The driving-view extension bundles genuine VinFast VF3 by Hoàng Huy under CC BY 4.0, normalized offline with Blender: 49,885 near / 7,923 far triangles. Ferrari-red paint is restricted to ego; traffic, trim and environment stay neutral. Asset provenance and derivative hashes are recorded in plan12/evidence/assets; credits and source links appear in Môi trường. Offline base64 GLBs require no runtime download. Generic sedan/SUV models by Comrade1280 use CC BY 4.0; unsupported vehicle categories retain procedural templates.

`renderGeometry.ts` owns presentation ring checks, joined source-vector strips, crossing direction and estimated building hulls. Road/lane/segment surfaces share neutral support instead of competing colored layers; markings use explicit depth ordering. Source holes remain, invalid road rings (including pinches/overlap/touches) are omitted with geometry diagnostics surfaced in the 3D warning status. Invalid estimated building rings use a cosmetic convex enclosure; importer authority/collision checks and source metadata are unchanged. Beveled facade details are decorative estimates, not annotations. Trees and poles are instanced smooth geometry; no per-tree draw call.

`weather.ts` copies22 CARLA0.9.15 presets/14 parameters exactly with MIT notice bundled. `weatherEffects.ts` adapts sun/day-night brightness, grayscale cloud-cover sky, fog/dust haze, wind-driven bounded rain particles and wet-road roughness. Fog falloff/atmospheric scattering/cloud shapes/puddles/physical friction are approximated or not simulated; this is Three.js presentation, not CARLA/Unreal engine, calibrated weather/sensor physics or altered trajectories. Wetness/deposits/rain affect surface roughness; preset/quality remain in session and changing them preserves playback timestamp/camera/renderer. XOSC profile has not expanded to weather elements.

Header has Môi trường and OpenSCENARIO popovers (native import/export-map/reopen actions), Escape/outside-close/focus restoration. esmini readiness badge removed; execution gates/errors remain. Sensor zoom/red ego unchanged. Initial procedural preview evidence (192tests/geo52–34) is historical and superseded by the licensed-model extension below. Independent topology/official-preset probes passed after ring fixes. Final source/import/legacy native gates and216frontend/609backend tests pass; final acceptance evidence resides in plan12/evidence.


### Driving-view extension — installed acceptance complete
`leadVehicle.ts` measures nearest forward vehicle bumper gap from current actor poses and oriented bounding boxes; filtering uses direction, lateral corridor and vertical overlap, not authoritative lane assignment. Missing poses or no eligible vehicle display —. The floating annotation and HUD share the same measured value; source scene-0103 at5s measured38.3m. `drivingOverlay.ts` shows actual future ego samples up to60m, stops at missing samples, and draws geometric range guides (not LiDAR measurements). The camera follows behind ego; controls retain orbit/zoom/overview. Async asset load aborts on scene teardown and resources are disposed once. Frontend216/backend609 tests and independent63 scoped probes passed. Installed0.10.0 source/imported/legacy replay gates passed; live gap changed38.3m at5s to14.6m at10s,0renderer errors. Final installed119.6RAFfps/p95=9.3ms,10switch resources stable,0renderer errors; evidence/performance-final anddesktop.


## Detailed driving scene v0.10.0 — 2026-10-10T09:13:41+07:00
Installed /Users/macos/Applications/Topeye 0.10.0.app. Genuine CC BY4 VinFast VF3 ego (red paint, high49,885/far≤8k), licensed grayscale traffic sedan/SUV, smooth pedestrians/cycles/instanced trees/beveled estimated buildings; neutral road depth support/joined markings with invalid source ring warnings preserved. Live forward bumper gap uses current source/import/replay poses and OBB supports (scene0103:38.3m at5s→14.6m at10s); cyan corridor follows actual ego samples. CARLA0.9.15 exact22presets are presentation-only; header OpenSCENARIO import/export-map/reopen replaces readiness badge.
Frontend216/backend609 pass0skip, scopedlint/typecheck/build/package exit0; independent63extensiontests plus topology/weather/abort/offline probes passed. Installed imported coverage1/maxXY0/maxYaw0; legacy2actual engine cases passed;13sourcefiles unchanged;0renderer errors/0ownedchildren. Native weather/window1050×720/1360×900 and10scene switches pass; GPUgeometry54/78 and1texture stable byscene. Earlier0.10.0 interactive30swarm+60ssample119.6RAFfps,p95=9.3ms; screenshots show scene/time varied, so this is not a fixed-scene A/B comparison. Fixed-scene measurement follows inpatch13. Bundle233,375,305B, +2,176,680B vs0.9.1.
Evidence: planning/12_2026-10-09_scene-detail/evidence/{driving-view,performance-final,desktop,imported-release,legacy-release,audit-p03}. Plan12 local gates complete; user visual signoff remains owner discretion, no remote release/commit/push. Weather scattering/friction and estimated environment are not CARLA physics or surveyed geometry.


### Stop-region presentation patch (0.10.1 installed acceptance complete)
nuScenes `stop_line` is an area where a vehicle stops, not the painted stripe footprint ([official layer definition](https://www.nuscenes.org/tutorials/map_expansion_tutorial.html)). Rendering its full polygon white caused large white patches on otherwise valid pavement. The3Drenderer omits this semantic overlay; it keeps sourceJSON unchanged, valid road support, real holes, crossing stripes and divider lines. It does not infer a new stop stripe from polygon edges. This patch cannot repair invalid authoritative road polygons; their visible diagnostics remain. Regression reproduces white coverage before the patch and verifies road material, hole preservation and immutable input after it.


## Stop-region display PATCH v0.10.1 — 2026-10-10T09:28:54+07:00
Fixed large white pavement patches: nuScenes stop_line polygons are semantic stopping areas, so3Drenderer omits their full whitefill. Roadsupport/holes/crossings/dividers/sourceJSON/mapcontext/actorposes remain unchanged; no invented stopstripe. Installed /Users/macos/Applications/Topeye 0.10.1.app. Regressionred1fail/20pass→green21pass;fullfrontend217pass0skip;independentreview21pass/typecheck0;build/package/nativebefore-after exit0,0renderererrors. Source0553/time0/overview before.png andafter.png show removed patches withcrosswalks retained. Controlled source0061/time0 benchmark30swarm+60ssample120.02RAFfps/p95=8.8ms,0errors; guard checks scene/time everyframe. Earlier interrupted run rejected, evidence retained. Backendlogic unchanged;609tests from0.10.0 remain applicable. No commit/push. Evidence: planning/13_2026-10-10_stop-region/evidence/.


### Environment contact investigation — 2026-10-10T09:40:24+07:00
Owner reports floating vehicles and wall penetration in0.10.1. Read-only source audit: roadScene uses one constantfloor (min egoZ−0.08), source annotation centers retain measuredZ and median actorheight. EgoZ range0 across all10mini scenes; traffic bboxbottom−displayfloor ranges scene0061−0.38..1.16m,0103−1.16..1.45m,0553−1.02..3.20m; this explains airborne/sunken appearances and does not prove vehicle dynamics failure. Estimatedbuilding footprints overlap actual vehicle tracks:0061=2includingego/truck,0655=11,0757=1,0916=2bicycles;0103/0553/0796/1077/1094/1100=0 insampledfootprint probe (XYintersectionarea>0.05m²,verticaloverlap checked for eight-scene extension). Footprints are simplified LiDAR estimates; invalidrings render convexenclosures. Kinematic source playback has no staticwall/ground collisionresponse. Fix requires synchronized terrain/contact display and refinement/masking ofestimated static geometry while preserving originalposes/mapconformance/importdigest. No product edit/versionbump or confirmedphysicssolver defect.

## Ground & static contact v0.11.0 — 2026-10-10
Plan14 (`planning/14_2026-10-10_ground-contact/`). Optional `Environment.presentation` (schema_version 1, contract `specs/01-CONTRACTS.md`) built by `backend/topeye/scenario/presentation.py`: `estimate_ground` fits 3 m low-plane cells from masked multi-keyframe LiDAR (≥8 points, ≥2 frames, slope ≤0.35, residual ≤0.15 m); `build_presentation` crops valid map surfaces to the source envelope (holes kept, invalid rings omitted + diagnosed), adds labelled inferred annotation-foot anchors (source=1) and trims cosmetic estimated building fragments against drivable free space and vehicle swept OBBs (0.45 m margin, only across ≤1 s gaps; fragments <0.5 m² dropped). Raw polygons/buildings/actors, MapContext digest, XOSC profile and collision authority are unchanged.
Frontend `groundSupport.ts`: `createGroundSupport` (bounded ≤8 m query, hull check beyond 2 m, multilevel rejection, C2 8 m kernel), `contactPosition`/`contactTilt` (source mode only; imported/replay keep true XYZ, no tilt) and `drapeGeometry`. Draping is adaptive and conforming: an edge is marked from its endpoints only (>4 m always; 1–4 m when its midpoint deviates >2 cm from linear interpolation), a triangle with a marked edge bisects its longest edge and marks it so neighbours follow, until no marks remain — shared edges split identically (no T-junction cracks), budget 250 000 triangles/scene. Drape failures go to `userData.terrainDiagnostics` (`environmentIssues`, `formatContactNotice`) and the contact notice, never to the "Map nguồn … vùng hình học lỗi" count. `_terrain_spikes` rejects roof/deck LiDAR cells: judged against measured + inferred-anchor cells with |dz| ≤ 0.35·d + 0.3 — majority of neighbours within 8 m, else the nearest within 20 m, else > 3 m off the median — keeping raw/unknown height there (cKDTree; 20 000 cells 0.45 s). 10 mini scenes: 0 fallbacks, 22–141 k triangles, 0–15 residual T-junctions >2 cm per scene (max 0.245 m; non-coincident vertices between adjacent source polygons), probe `planning/14_2026-10-10_ground-contact/evidence/tjunction-probe.test.ts`. Known limits: isolated self-consistent elevated clusters and cells whose nearest neighbour is 12–20 m away within the slope bound are kept.
UI notice `contact-notice`: số đối tượng có hỗ trợ nền / giữ cao độ nguồn vì nền chưa rõ. Height adjustment is presentation-only, not physics or surveyed terrain.

## Vehicle style, lamps, cabin view, class map v0.12.0 — 2026-10-10
Plan15 (`planning/15_2026-10-10_vehicle-lights-map/`). `vehicleClass.ts` is the single category→class mapping (car/truck/bus/heavy/motorcycle/bicycle/pedestrian/object/other, incl. import `vehicle.bus`/`vehicle.motorbike`). `vehicleMaterials.ts` holds the shared grayscale palette and `createLampMaterial(front|rear)`: fixed front-white / rear-red presentation lamps, no scene lights, never brake/indicator state. `detailModels.ts` builds procedural bus (2/3 axles, glass bands, doors) and truck (cab + cargo box, also trailer/construction) bodies in the GLB car palette; `assetModels.ts` splits GLB light materials by triangle centroid (+x front) and adds fallback lamps when a side is missing.
3D view camera modes: Bám xe / Toàn cảnh / **Trong xe** (`cabinCamera.ts`: driver eye 1.2 m above displayed ground, 25 m look-ahead, FOV 70, OrbitControls disabled, ego model hidden; `data-camera-mode` on the canvas host). Gap corridor (`drivingOverlay.ts`): RGBA vertex alpha 0.6·(1−s/L)^1.5, L = min(60, lead gap + ego length/2) or the 60 m reference path, end point interpolated exactly at L. Integrated map only (`TacticalMap.tsx`): `map-class-<class>` colours + legend (`map-swatch-*`), ego stays #da291c; 3D/LiDAR unchanged.

## Map polish & faster load v0.12.1 — 2026-10-10
Plan16 (`planning/16_2026-10-10_map-load-polish/plan.md`, PATCH). Integrated map skips `stop_line` polygons (semantic stop regions, as in 3D). Header buttons share `--header-button-width` (210 px, 168 px ≤1150 px) and 34 px height. `presentation.trees`/`presentation.poles`: display-filtered LiDAR estimates — trees whose base is >0.3 m inside the road or on an observed vehicle footprint and poles >0.5 m inside the road are omitted (diagnostic count); raw `environment.trees/poles` unchanged; frontend uses `presentation.trees ?? trees`. Loading: `static_environment` masks annotation boxes via cKDTree candidates and voxel-dedups with a monotone int64 key (`_unique_rows`), byte-identical output, ~1.75× faster; the worker keeps an in-memory LRU of 12 source scenes per dataset (deep copies, fresh id per load; cleared on dataset change; never on disk).


## Source display contact PATCH v0.12.2 — 2026-10-10T15:46:15+07:00

Owner screenshot scene0916 and renewed algorithm-fix instruction supersede plan14 SOURCE DISPLAY raw-Z retention / >1.5m contact guard. Original samples, XY/yaw, vehicle dimensions, sensor/collision authority and import/replay remain unchanged. `contactPosition(actor,pose,mode,ground,modelMinY,tilt=[0,0])` returns raw scenePosition for nonsource before querying ground. Source mode evaluates four local support points at actual modelMinY, ±0.3length/±0.4width for vehicles (same axle rectangle as tilt; nonvehicles ±0.5), rotated with Euler YZX, then translates by max(surfaceAt(worldFoot)−rotatedFootY). This avoids the raw annotation-vs-fallback gap and compensates underside movement after rotation. Body overhang corners are forbidden for vehicle wheel contact: a curved road outside the wheelbase raised all wheels (regression expected1m, actual2m). `contactTilt` estimates the existing capped±0.15rad roll/pitch from the same rendered surface, including fallback. Nonfinite model/surface → rawposition, nonsource tilt →0.

`heightAt` retains support/multilevel validation for confidence reporting; unsupported source models now disclose “bám nền hiển thị dự phòng (chưa đủ hỗ trợ đo)” instead of keeping annotation Z. An elevated actor in source view follows this estimated single display surface; this is visual contact, not surveyed geometry, bridge reconstruction or esmini physics. Import/replay preserve true XYZ. No dataset-specific rule; all newly opened source datasets use the same renderer algorithm.

v0.12.2 local installed: source vehicles use displayed terrain contact including disclosed fallback; rotated wheel-support rectangle (±0.3 length / ±0.4 width), not body overhang. 282/282 frontend and15/15 scoped backend tests;10 scenes/13307 visible vehicle poses, contact error≤4.45e-16m,0source mutations/0import-replay XYZ changes;installed10scene0renderer errors,120.1RAFfps,p95=9.3ms; imported desktop PASS. No scene IDs or dataset-specific corrections. Terrain remains estimated; no exact tire/suspension or physical multilevel reconstruction claim. Plan17; ~/Applications/Topeye 0.12.2.app.
Evidence: planning/17_2026-10-10_vehicle-contact/evidence/{regression-red.txt,overhang-red.txt,frontend-tests.txt,rotated-contact-after.jsonl,after.json,after-scene-0916-cabin.png,imported/desktop-imported.json}. First installed source attempt closed while a concurrent imported gate ran; isolated retry and final source run PASS. Cause unconfirmed; do not infer a deterministic app defect from this event.


## Native application logo v0.12.3 — 2026-10-10T15:57:06+07:00
`frontend/scripts/package-desktop.mjs` derives standard macOS16/32/128/256/512 logical-size1x/2x PNGs from `src/scenario/assets/topeye-logo.png` with macOS `sips`, then `iconutil` produces `build/topeye.icns`, passed to Electron packager `icon`. Build outputs remain ignored. User source PNG is preserved byte-for-byte; header stays44×44 contain. `CFBundleIconFile` remains `electron.icns` because packager replaces its contents; filename is not evidence of a default Electron graphic. Verify embedded ICNS SHA against generated file.
v0.12.3 installed: supplied logo is now the native macOS app icon; header PNG already matched owner source byte-for-byte and is preserved. Packaging derives10 standard icon PNGs (16–1024px, alpha) and ICNS from frontend/src/scenario/assets/topeye-logo.png via sips/iconutil.282frontend tests/build/signature pass;installed native ICNS hash matches generated icon, UI logo SHA matches owner image,0renderer errors. ~/Applications/Topeye 0.12.3.app;plan18.
Evidence: planning/18_2026-10-10_app-logo/evidence/verification.json and installed-logo.png; source SHA256 `3556d9a03505242c7cad98ff179c15886f327e287c50f58f8bf8352c5879a8ff`; ICNS SHA256 `67ed9e942a34aa68ed9871d50ba1354b480de5816652b8ff8ff8459712ff4140`.


## Web demo tĩnh 0.13.0

Cho người không cài app xem và góp ý. Cùng `ScenarioApp`; `src/scenario/staticApi.ts` cài `DesktopAPI` bằng JSON tính sẵn, `webMain.tsx` gắn API trước khi import động app. Không Python/esmini/dataset trên web. Chế độ `settings.mode="web-demo"` ẩn chọn dữ liệu/thư mục lưu/OpenSCENARIO/xuất; biến thể là nút chọn đúng tổ hợp đã tính; nút Góp ý chỉ hiện khi build có `VITE_FEEDBACK_URL` (mở tab mới, kèm scene/time/camera/weather/version).

```sh
backend/.venv/bin/python backend/scripts/export_web_demo.py --dataset <nuscenes> --engine <libesminiLib.dylib> --out frontend/public-web/data
cd frontend && VITE_FEEDBACK_URL=<url> npm run build:web      # → dist-web/ (index.html, _headers, robots.txt, data/)
npx wrangler pages deploy dist-web --project-name topeye-demo --branch preview
```

Dữ liệu: 10 cảnh mini, 5 trích đoạn (preset scene-0103 + mặc định UI), 3 biến thể, 8 replay esmini thật; 5 tổ hợp backend từ chối được ghi `skipped`. 6,2 MB (gzip 1,7 MB); manifest sha256 từng file; exporter dừng nếu metadata dataset đổi. Unlisted: `X-Robots-Tag: noindex` + robots Disallow; ai có link đều xem được. Ghi nguồn: VF3/sedan/SUV CC BY 4.0, nuScenes CC BY-NC-SA 4.0 (phi thương mại), CARLA MIT. `public-web/data/` và `dist-web/` bị gitignore. SPEC: planning/20_2026-10-12_web-demo/.


## Web localhost đầy đủ 0.14.0

`cd frontend && npm run web:local` → build `dist-local/` (Vite mode `localweb`, entry `local.html`) rồi chạy `server/local-server.mjs` tại `http://127.0.0.1:5180/` và mở trình duyệt. Đủ mọi tính năng desktop: chọn dataset, cảnh gốc, trích đoạn/biến thể tự do, phát lại esmini thật, xuất kịch bản, xuất map context, nạp/mở OpenSCENARIO, huỷ.

- `server/worker-bridge.mjs` là bản chuyển từ Electron main: một worker Python JSONL, một tác vụ (BUSY), huỷ dừng cả process group. `local-server.mjs` giữ đúng allowlist tham số/giới hạn/kiểm ID của Electron.
- Bảo mật: chỉ bind 127.0.0.1; token 32 byte mỗi lần chạy nhúng vào `index.html` (`<meta name="topeye-token">`), bắt buộc ở header `X-Topeye-Token` (SSE `/api/events?token=`); Host phải là 127.0.0.1/localhost:port (chống DNS rebinding), Origin cùng gốc; static không thoát khỏi `dist-local/`; không có endpoint đọc file tuỳ ý.
- Hộp thoại native thay bằng: `window.prompt` nhập đường dẫn (dataset, thư mục lưu, thư mục `import/` của kịch bản đã lưu); chọn file `.xosc` từ trình duyệt (≤2 MiB); map context tải về thư mục Tải về.
- Settings/log dùng chung `~/Library/Application Support/Topeye/` với app desktop. `TOPEYE_PORT` (mặc định 5180), `TOPEYE_NO_OPEN=1`. Ctrl+C dừng worker trước khi thoát.
- Test: `npm run test:server` (12, node:test), `httpApi.test.ts` (6). SPEC/bằng chứng: planning/21_2026-10-12_local-web-full/.


## Bỏ app desktop 0.15.0

Đã xoá `frontend/electron/`, `frontend/scenario.html`, `frontend/scripts/{dev,package,test,test-imported}-desktop.mjs`, `backend/scripts/scenario_worker.py` (PyInstaller), dependency `electron`/`@electron/packager`, `pyinstaller` khỏi extra `scenario-build`, và nhánh `sys.frozen` trong `replay.py`/`imported_replay.py`/`source_scene.py`. `npm run build` = build web localhost (`dist-local/`). Code desktop còn trong lịch sử git đến commit `3ef337d` (0.13.0) / bản 0.14.0; các `.app` đã cài trong `~/Applications` không bị gỡ. SPEC: planning/22_2026-10-12_drop-desktop/.


## LiDAR đo thực, kéo/zoom, phóng to khung 0.16.0

- **LiDAR đo thực:** khung LiDAR vẽ sweep `LIDAR_TOP` (20 Hz) gần nhất với thời điểm timeline, đổi sang khung xe ego (x trước, y trái, z lên) bằng `calibrated_sensor` của chính sweep, nhìn từ trên, đầu xe hướng lên, màu theo độ cao; không lọc/nội suy/bù chuyển động. Backend `topeye/scenario/lidar_frame.py` (worker method `lidar_frame`), cắt |x|,|y| ≤ 100 m, lượng tử 1 cm (int16) + intensity uint8, base64. Lệch thời gian sweep hiển thị (ms); > 0,1 s ⇒ `LIDAR_UNAVAILABLE`.
- Áp dụng cho cảnh gốc và trích đoạn/phát lại **bản gốc** (thời điểm nguồn = `selected_interval_s[0] + t`). Biến thể (tốc độ ≠ 1 hoặc dịch ≠ 0) và kịch bản nạp XOSC không có LiDAR đo tương ứng ⇒ quét giả lập 180 tia cũ, có ghi rõ lý do. Bản demo tĩnh không có LiDAR đo ⇒ quét giả lập.
- Server dùng **worker LiDAR riêng** (`lidarFrame`), không chung hàng đợi BUSY với trích đoạn/phát lại; worker này không chạy khôi phục workspace. Frontend `measuredLidar.ts`: tối đa 1 request đang chạy, chỉ lấy thời điểm mới nhất, cache 48 sweep, vẽ canvas.
- **Kéo/zoom:** `useViewTransform.ts` (thay `useSensorZoom`) cho LiDAR và map: kéo chuột để di chuyển, cuộn/±/0,5–8×, nút ⌖ hoặc bấm đúp để về giữa; đổi kịch bản tự reset. Chỉ đổi khung nhìn.
- **Phóng to khung:** nút ở góc khung 3D, LiDAR, map; Esc hoặc bấm lại để trả về bố cục.
- Kiểm: backend 643 (5 mới, dataset thật), frontend 329, server 13, E2E 17 bước (`npm run test:e2e`). SPEC: planning/23_2026-10-12_lidar-layout/.


## Bố cục 0.17.0 và LiDAR 3D

- **LiDAR 3D** (`LidarPointCloud3D.tsx`): đám mây điểm đo thực trong không gian 3D quanh xe ego. Kéo trái lên/xuống để nghiêng, kéo ngang để xoay, chuột phải để dời, cuộn để zoom; nút −/+, "Từ trên", "Nghiêng". Vòng 20–100 m trên mặt đất, hộp đỏ = xe ego. Chỉ vẽ lại khi dữ liệu/camera đổi.
- **Header:** nút ẩn/hiện thanh thiết lập · Môi trường · OpenSCENARIO · **Dữ liệu** (đổi dataset, thư mục lưu, hiện đường dẫn đang dùng).
- **Thanh bên:** nhãn chữ thường; bước 02 thu gọn tới khi có trích đoạn; bước 03 "Kiểm chứng" ghim đáy (luôn thấy "Chạy phát lại", kết quả cuộn riêng).
- **Chọn xe:** bấm xe trên khung 3D hoặc map ở cảnh gốc để chọn/bỏ (tối đa 3, chỉ track trích đoạn được); xe đã chọn viền trắng trên map; danh sách vẫn còn.
- **Timeline:** vùng đỏ = khoảng trích đoạn Từ–Đến trên cảnh gốc.
- **Cảnh báo/lỗi:** cảnh báo dữ liệu 3D gom vào chip "⚠ N cảnh báo dữ liệu"; lỗi hiện toast giữa vùng xem (đóng được), vẫn ghi ở thanh trạng thái.
- SPEC/bằng chứng: planning/24_2026-10-12_layout-lidar3d/.

**0.17.1:** khung 3D/LiDAR/map không còn thanh tiêu đề, chữ hướng dẫn, chú thích hay nút −/+/Từ trên/Nghiêng; chỉ biểu tượng phóng to ở góc. Thao tác: cuộn = zoom, kéo = dời (map) hoặc xoay/nghiêng (LiDAR 3D, chuột phải = dời), bấm đúp = về mặc định. Map chỉ giữ chú giải loại. LiDAR giả lập có nhãn nhỏ "MÔ PHỎNG" (lý do trong tooltip).


## Thanh icon và giao diện OpenSCENARIO 0.18.0

- **Thanh trên:** chỉ logo + "Topeye"; khi có tác vụ, góc phải hiện tiến trình + nút "Huỷ tác vụ". Thanh trạng thái cuối màn hình đã bỏ (thông điệp vẫn ở vùng `role=status` ẩn cho trình đọc màn hình/test); lỗi hiện thông báo nổi.
- **Thanh icon trái** (`IconRail.tsx`): nút mở rộng/thu gọn trên cùng (mở rộng = hiện chữ). Trên → dưới: Cảnh nguồn · Trích đoạn · Biến thể · Kiểm chứng · Xuất kịch bản (hành động) · OpenSCENARIO · Môi trường · … · Cảnh báo (chấm vàng khi có) · Dữ liệu. Bấm công cụ ⇒ mở ngăn kéo 300 px của công cụ đó; bấm lại hoặc Esc ⇒ đóng.
- **Giao diện OpenSCENARIO** (`ScenarioRunner.tsx`): cột trái = thư viện kịch bản trong thư mục lưu (tên file .xosc lúc nạp; gói cũ = "kịch bản <mã>"), trạng thái Đạt/Không đạt/Đang chạy/Đã huỷ/Chưa chạy, nút Nạp .xosc / Mở gói đã lưu / Xuất thông tin map, ô chọn + "Chạy N kịch bản đã chọn" (tuần tự; mục lỗi ghi lỗi rồi chạy tiếp; Huỷ dừng cả hàng). Giữa = 3D + map nhỏ + thanh thời gian, chip Đúng map/Động học hợp lệ/cảnh báo. Phải = chạy/chạy lại, kết quả gần nhất, bảng đối tượng (V tối đa), lịch sử chạy, cảnh báo.
- Backend: worker `list_imported` (`topeye/scenario/library.py`, chỉ đọc workspace: `*/import/manifest.json` + `runs/*/{status,report}.json`, bỏ symlink/hỏng); `import_xosc` nhận `file_name` ⇒ manifest `display_name` (ngoài tập hash). Server/API: `listImported`, `importXosc{file_name}`, `openImported{path}`.
- SPEC/bằng chứng: planning/26_2026-10-12_icon-rail-runner/.

**0.19.0:** giao diện không còn Trích đoạn, Biến thể, Kiểm chứng, Xuất kịch bản, chọn xe bằng click và vùng trích đoạn trên timeline. Thanh icon: Mở rộng · Cảnh nguồn · OpenSCENARIO · Môi trường · Cảnh báo · Dữ liệu. Chạy esmini qua màn OpenSCENARIO. `extract/variant/replay/export` vẫn có ở worker/server/CLI (`topeye.scenario.cli accept`) — các mục bên trên mô tả chúng là năng lực backend.


## Quản lý kịch bản 0.20.0

- **Tạo kịch bản** (nút đỏ cuối cột thư viện, luôn bấm được): hộp thoại chọn map (cảnh nguồn) → "Tải thông tin map" (context cho công cụ sinh kịch bản) → "Chọn file .xosc" (kiểm như cũ, nạp xong mở ngay).
- Mỗi dòng: tên (bấm = mở) · trạng thái · **Xuất** (tải original.xosc) · **Sửa** (đổi tên + sửa XML; lưu ⇒ kiểm lại với map, hợp lệ mới tạo gói mới và chuyển gói cũ vào .trash; không hợp lệ giữ nguyên) · **Xoá** (hỏi xác nhận ⇒ `<thư mục lưu>/.trash/<id>-<thời điểm>`, khôi phục bằng cách chuyển thư mục về lại).
- Worker: `read_imported`, `delete_imported` (chỉ theo scenario_id, trong workspace, chặn symlink). Tên gói không có tên file = `description` của FileHeader.
- Bỏ: ô tick, chạy hàng loạt, nút Nạp/Mở gói/Xuất map ở tiêu đề. E2E tự xoá kịch bản nó tạo. SPEC: planning/30_2026-10-12_scenario-manage/.


## v0.23.0 — Local login, dataset library and native AV2

Run `cd frontend && npm run web:local`, then open http://127.0.0.1:5180. First use creates one local account (username 3–64 ASCII letters/digits/`_.-`, password 12–128 characters). There is no default password. Later visits log in before selecting a dataset; the “+” tile opens a local directory-path form. Dataset tiles and the add tile share the same size. “Thư viện map” returns from Studio; logout revokes that browser session.

`AccessApp.tsx` wraps the existing ScenarioApp. `server/local-auth.mjs` stores only salted scrypt credentials in `~/Library/Application Support/Topeye/local-account.json` (0600). Sessions live in server RAM for eight hours and use HttpOnly/SameSite=Strict cookies; restarting requires login again. This is a single-account localhost application, not remote hosting or multi-user access control. Existing token, Host and Origin checks remain required. Invalid credentials are throttled; malformed account storage fails closed.

`server/dataset-catalog.mjs` persists schemaVersion 1 / entries in `dataset-catalog.json` beside scenario-settings.json. Optional ignored seed file `backend/data/dataset-library.json` is an array of `{root,name,format}` (`format`: `nuscenes` or `av2`). Each entry is inspected before admission. POST `/api/catalog/add` accepts `{path,name?}`; POST `/api/catalog/select` accepts `{id}`; GET `/api/catalog` returns `{value:entries}`. Preview requests resolve registered IDs, never caller filenames. Selection during worker activity returns BUSY; failed inspection preserves the previous settings. Request authorization is rechecked after body receipt and after asynchronous inspection before any user-requested configuration write.

`scenario.dataset.create_adapter(root, version)` chooses NuScenesAdapter or ArgoverseAdapter. Native AV2 Sensor requires `pyarrow` (`uv pip install --python backend/.venv/bin/python 'pyarrow>=18,<27'`, also in the `av2` extra). Input is a directory of log UUIDs, or one log, containing annotations.feather, city_SE3_egovehicle.feather, sensors/lidar and per-log map JSON. AV2 point clouds and annotations are already ego-frame; apply the city pose once, never sensor extrinsics again. Preserve raw timestamps, convert ns to internal µs, and reorder cuboid dimensions to width/length/height. Exact poses and all referenced LiDAR files are required. Source scenes use the log's own lane/drivable/crossing map and measured LiDAR; camera streams are retained, not added as new Studio camera views.

Machine-local library: nuScenes mini (10 existing scenes) plus Argoverse 2 Sensor (10 downloaded validation logs across PIT/MIA/WDC/DTW/PAO). AV2 raw: `backend/data/dataset-intake-20261013/argoverse2`, 30,362 files / 11,605,779,571 bytes / 1,568 LiDAR frames. Incomplete earlier trainval archives are retained outside the catalog. These are subsets, not full datasets. Raw data is never rewritten by the adapter.

Verification: `npm run test:server`, `npm test -- --run`, `npm run build` in frontend; `backend/.venv/bin/pytest backend/tests`; `npm run test:access` exercises login/catalog/both real sources in isolated userData; `npm run test:e2e -- <nuscenes-root> <evidence-dir>` checks the existing runner in a temporary workspace. Evidence and rollback snapshots: `planning/34_2026-10-13_dataset-intake/`. Rollback must preserve Claude's pre-existing dirty changes and user account/catalog/settings; do not reset the whole worktree.

**0.23.2:** thanh icon: Mở rộng · Cảnh nguồn · OpenSCENARIO · Môi trường · **Cài đặt** (dữ liệu đang dùng/đổi dữ liệu, thư mục lưu). Bỏ mục Cảnh báo và Dữ liệu; cảnh báo dữ liệu chỉ còn ở chip trong khung 3D.

**0.24.0:** thanh icon: Mở rộng · Cảnh nguồn · OpenSCENARIO · Cài đặt. Bỏ Môi trường (thời tiết sẽ nằm trong phần tạo kịch bản; 3D giữ ClearNoon). Cài đặt: Giao diện (Tối/Sáng/Theo hệ thống, `data-theme` trên `.studio`, màu qua biến CSS), Chất lượng đồ hoạ (Tự động/Cao/Cân bằng); nhớ theo trình duyệt (`preferences.ts`).

**0.25.0 (plan35):** Cài đặt là trang riêng (`SettingsPage.tsx`; khung xem vẫn gắn, ẩn). Mục: Giao diện · Hiển thị 3D · LiDAR · Phát lại · Đơn vị · Ngôn ngữ · Dữ liệu & lưu trữ · Tài khoản · Góp ý nhà sản xuất · Thông tin. Server: `auth/password`, `auth/sessionHours`, `storageInfo`, `clearMetricsCache`, `emptyTrash`, `submitFeedback`, `listFeedback` (`server/local-storage.mjs`, `server/local-feedback.mjs`). Ngôn ngữ: `t()` khoá bằng chuỗi tiếng Việt (`i18n.ts`, `i18n.en.ts`); thiếu khoá ⇒ `i18n.test.ts` đỏ. Phím tắt: Space, ←/→, Home/End, Esc.


## v0.26.0 — OpenSCENARIO timeline and inspector tabs
The approved runner layout uses a 2:1 grid above 760px. Left: existing 3D TrackView and playback bar, followed by ActorTimeline. Right: Kịch bản / Số liệu / Lịch sử tabs, with keyboard arrow navigation. The scenario list scrolls independently of its fixed create footer. Metrics retains the existing map, four scenario measurements, per-object chart/details and latest-run report. History aggregates saved runs from the workspace library by date and includes scenario names; it does not generate run records when the user merely plays a preview.

`ActorTimeline.tsx` receives `scenario`, `time`, `duration`, `disabled`, `onSeek`. Its diamonds represent actual XOSC trajectory vertices (`actor.samples`), not model/manual annotation provenance or engine samples. Bars classify each consecutive source interval using planar speed >0.1m/s; <=0.1m/s is stationary. Areas outside an actor's samples remain empty. Intervals use the source trajectory even when the viewport displays an esmini replay, as indicated by the XOSC label. Timeline seeks clamp to the shared playback range and pause playback. Pointer clicks within 7px of a vertex snap to its exact time; arrows seek 0.1s, Home/End seek start/end. Handled keys stop propagation to global shortcuts. SVG paths are memoized per dataset/duration, avoiding per-frame reconstruction of all vertices. No trajectory edit or backend schema change.

No new esmini run button. Existing import, edit, export, delete, metrics and source-scene workflows are preserved. On narrow windows the columns stack. Plan/evidence: `planning/36_2026-10-13_runner-timeline/`.


### v0.26.1 — Timeline density and saved-run deletion
Runner camera controls now use the same bottom12px/left12px anchor as the source view. Timeline vertices occupy a separate upper rail from motion bars. Display-only thinning retains source endpoint times and a minimum24/1000 viewbox separation between intermediate markers (the two real endpoints are retained even for shorter actor coverage); all original timestamps remain available for precise snapping. Dense source sampling no longer masks moving/stationary colors. The timeline footer is removed per owner request.

History provides a trash icon per saved run. UI confirmation calls `deleteImportedRun({scenario_id,run_id})` → authenticated POST `/api/deleteImportedRun` → worker `delete_imported_run`. Both identifiers require32 lowercase hex. Backend validates project/runs/run/status/trash paths and rejects symlinks, missing states and running jobs. It renames only the run directory into `<workspace>/.trash/run-<scenario>-<run>-<timestamp>`; the scenario package and other runs stay intact. Busy main workers reject mutation. Successful deletion refreshes the library and clears the active replay if it belongs to that scenario, avoiding stale deleted results. Cancelling changes nothing. Restore by moving the trashed run back to its original `<scenario>/runs/<run_id>` while app is idle; existing Settings empty-trash action permanently removes trash only upon separate confirmation. No bulk history deletion.

### Plan38 P01 — Tạo kịch bản: template + AI (giao diện, chưa phát hành)
Nút "Tạo kịch bản" mở `ScenarioCreator` (`frontend/src/scenario/authoring/`). Tab **Từ template**: gallery 20 loại / 5 nhóm (`catalog.ts`: dừng khẩn cấp, xe đứng yên, xe chậm, dừng-đi, đuôi hàng xe, cắt làn, tách làn, điểm mù, nhập làn, người đi bộ băng qua, trẻ em sau xe đỗ, người đi dọc mép, xe hai bánh băng ngang/cùng chiều, rẽ trái cắt hướng, xe cắt ngang giao lộ, vượt đèn đỏ, ngược chiều lấn làn, tránh vật cản, tự do) → "Tham số chính" sinh lại đối tượng/tình huống → 8 phần template `topeye-scenario-template-v1` (`template.ts`, frame ego-start x trước/y trái) → sơ đồ/JSON, tải/nạp template, Kiểm tra (`validateTemplate`, giới hạn = profile import). Tab **Bằng AI** là chatbot: người dùng nhắn mô tả, AI trả lời bằng text + nút lựa chọn (mở template, đổi loại, chọn loại khi chưa rõ), tin sau chỉnh tiếp kịch bản; P01 là mock luật từ khoá (`mockAi.ts`, model `mock-keywords`). "Tải thông tin map"/"Chọn file .xosc" giữ ở chân màn hình. Contract: planning/38_2026-10-13_scenario-authoring/specs/01-CONTRACTS.md.

**0.27.0 (plan39):** kết cấu theo mặt đường — `structures.py`: hành lang (giàn cầu/vách hầm: kết cấu ≥2,5 m hai bên đường ego, chồng ≥10 m) → `environment.barriers`; trần/cầu vượt khi ego đi bên dưới → `environment.overheads`; chân nhà theo cao độ mặt đường tại chỗ. Vẽ ở `sourceEnvironment.ts` (khung thép, khối trần). Giới hạn: nuScenes không có cao độ; chưa có dữ liệu hầm để nghiệm thu thật.

### v0.28.0 — Tạo kịch bản từ template (plan38 P02)
"Tạo từ template" → `importTemplate({source_id, template})` → worker `import_template` → `topeye/scenario/template.py::compile_template` → `validate_xosc` (cùng cổng với file nạp tay) → lưu gói `<tên>.xosc`. Backend kiểm lại mọi trường (`INVALID_TEMPLATE`). Kịch bản đặt dọc quỹ đạo thật của ego nguồn: x = mét dọc quỹ đạo từ `map.placement.start_m`, y = mét sang trái (+`lateral_m`); `mirror` lật trái/phải. `placement.auto` (mặc định bật) thử điểm bắt đầu lưới 5 m gần nhất trước, cả hai phía, khi bị OUTSIDE_MAP/OUTSIDE_SURFACE/STATIC_OBSTACLE/DYNAMIC_LIMIT; kết quả trả `placement` đã dùng. Mô hình: tốc độ đổi tuyến tính (mặc định 3 m/s² xe, 1,5 m/s² người), `hard_brake`/`stop` về 0, `accelerate`, `lane_change` nửa cosin (+ = trái theo hướng đối tượng), lộ trình bo góc Chaikin, quá điểm cuối đi thẳng. Lỗi `check_map` kèm `at t=…s`. Đo 5 cảnh mini × 20 loại: 44/100 qua; loại giao lộ cần đường cắt ngang thật. Spec: planning/38_2026-10-13_scenario-authoring/specs/SPEC-P02-compiler.md.

### v0.29.0 — Gợi ý map khi chọn loại kịch bản
Editor template có khối "Map phù hợp" (`authoring/MapFit.tsx`): với template hiện tại, gọi `templateFit({scene, template})` lần lượt cho mọi cảnh (map đang chọn trước) → worker `template_fit` biên dịch + `validate_xosc` như khi tạo thật nhưng không lưu gì; chạy trên worker chỉ số nên worker chính vẫn rảnh; nguồn và kết quả được cache. ✓ = map dùng được (kèm điểm đặt, "lật"), ✗ = lý do ngắn (tooltip lỗi đầy đủ); bấm ✓ để chọn map. Đổi tham số ⇒ kiểm lại sau 1 s; trong lúc kiểm luôn ghi "Đang kiểm". Lần đầu ~16 s cho 10 cảnh mini (nạp nguồn), sau đó vài giây.

### v0.29.1 — Tình huống gắn đúng đối tượng
"Thêm tình huống" mặc định gắn cho ego. "Phanh gấp" chỉ dành cho phương tiện; người đi bộ dùng "Dừng" (đổi đối tượng sang người đi bộ sẽ tự chuyển). Sơ đồ ghi "⚡ <id>: <tình huống> · <giây>".

## One-scene monochrome environment pilot (plan40)
Local review at http://127.0.0.1:5181; build and source extraction live only in `planning/40_2026-10-13_map-shape-pilot/`. Reuses `sourceEnvironment` without modifying product runtime, classes, actors, trajectories or map authority. Scene-0061: 8 OSM footprints (ODbL / BBBike), 134 source polygons, 21 lines; 5 heights from levels ×3.2m, 3 display fallbacks. Before/after toggle and three camera views. No bridge verified. OSM/source drivable overlap331.785m² remains unresolved; do not treat this as globally aligned or simulator-ready. Build/typecheck/Ruff pass;10 tests;0 browser errors. Full-page screenshot failed in Ego; review images are real canvas captures. Product version unchanged.

### v0.30.0 — Sửa kịch bản bằng template
Kịch bản tạo từ template có `<ws>/<id>/template.json` (cạnh `import/`, không thuộc manifest hash). Nút Sửa mở lại form template (dialog "Sửa <tên>", nút "Lưu thay đổi"); lưu = biên dịch lại thành gói mới qua `validate_xosc`, gói cũ vào `.trash`. Kịch bản nạp từ file .xosc (hoặc tạo trước v0.30.0) vẫn sửa dạng XML. Đổi tham số chính giữ đối tượng/tình huống người dùng tự thêm (`manual`).

Plan40 owner override: after view now uses reference pastel palette (cream buildings, gray roads, ivory sidewalks, sage ground/trees), removes decorative facade windows and raises/compresses overview perspective. Geometry/classes unchanged; ground tint is presentation, not grass classification. tsc/build passed; pastel visual acceptance awaits owner refresh at5181.

### v0.30.1 — Kịch bản không có template
Sửa một kịch bản không có template (nạp từ .xosc hoặc tạo trước 0.30.0) không mở mã XML: dialog giải thích, nút "Tạo lại bằng template" mở danh sách loại trên cùng map và khi lưu thì thay thế kịch bản cũ (cũ vào .trash); "Sửa XML (nâng cao)" mới hiện ô XML.

Plan40 complete patch (owner request):`complete_map.py` expands same origin to420×420m using536nuScenes polygons/57lines and30rawOSM footprints. Display-only0.4m road clearance produces34components,0m² road overlap (raw1288.488m² preserved),49decorative planting islands.127actors at5s use unchanged product class/model/pose/contact logic. Four views:Toàn map/Giao lộ/Mặt đường/Từ trên xuống.13tests+Ruff/tsc/Vite+Threegeometry pass. Browser/GPU visual check pending user-controlled window. Still isolated localhost5181;no product release.


### Pilot road depth patch — 2026-10-13T16:03:47+07:00
Owner screenshot shows distant pavement breakup. Pilot camera now adapts near plane to orbit distance (clamp distance/50 to0.25–25m), retaining far2500m. 24-bit depth quantization check:2538samples, old near0.1 produced1365collisions for4cm layers; adaptive near produces0. Road vertices below floor(-0.2m):0/168474. tsc/Three geometry/Vite exit0; evidence:`planning/40_2026-10-13_map-shape-pilot/evidence/depth-checks.txt`. This proves precision improvement, not GPU visual acceptance; owner refresh pending. No geometry/class/product/version changes.


## Twenty pastel scene maps — 2026-10-13T17:53:59+07:00
Plan42 local preview at http://127.0.0.1:5181 replaces single-scene pilot.20/20 maps (10nuScenes mini+10AV2 Sensor),20OSM-covered regions,2793display building components counted across scenes. Keep existing actors/classes/poses; cancel all plan41 object-model integration. Offline source export122.923s, cached reconstruction about7s;30,522,677bytes JSON total, max3,520,269bytes/scene. Only one selected scene loads; no20map GPU residency.
Sources: cached BBBike Singapore for6scenes;14OpenFreeMap/OpenMapTiles OSM tiles(2,534,936bytes) for14US scenes. AV2 uses official city-origin UTM, nuScenes origin-scaled Mercator; holes preserved,0.4m cosmetic road clearance, measured overlap0m². Tile heights may be inferred; missing heights9.6m explicitly estimated. Supplement uncovered facades with LiDAR estimates. Existing LiDAR structures retained; no invented bridge.
Geometry cleanup at1mm presentation precision removes near-zero union edges/slivers; source polygons/lines and actor arrays preserved.27tests pass,5801rings valid,20Three.js CPU builds pass with0new geometry defects/0terrain fallbacks;3pre-existing invalid source polygons remain disclosed (scene0103:2,0655:1). Independent reviewer remeasured14scopedtests+5801rings+tsc. HTTP20/20 payload hashes match built files. GPU visual/FPS not measured because owner controls browser; not a product release. Evidence: plan42/evidence/{summary.json,geometry.json,rings.txt,tests.txt,http.json}.

## v0.31.0 — Pastel maps on the main local web
The source worker now applies `pastel.apply_pastel` after source extraction. Twenty gzip assets in `backend/assets/pastel-maps/` (2,101,118 bytes total) replace only `environment.presentation`; original polygons, lines, obstacles, actor arrays and map_context remain unchanged. Fingerprint covers scene/version/origin, actors and raw environment. Missing, corrupt or mismatched files fall back to original display. No OSM/network call or planning import at runtime. Repackage using `PYTHONPATH=backend backend/.venv/bin/python backend/scripts/package_pastel_maps.py --preview planning/42_2026-10-13_pastel-maps/preview/public --sources planning/42_2026-10-13_pastel-maps/evidence/cache/sources`.
Presentation includes pastel-v1 style, expanded surfaces/bounds/lines, OSM+LiDAR buildings, decorative landscape and attribution. Source and imported scenarios share the environment; replay actor positions remain measured. Palette, matte materials and full-map shadows coexist with weather controls. Camera near plane adapts to distance, cabin stays0.1m. Pastel fallback datum is-0.08m (same as approved preview), backdrop stays below terrain; landscaping has a separate25k-triangle drape budget per island. Mainweb5180 needs rebuild and host restart so existing worker caches reload. Rollback disables the apply_pastel hook and rebuilds frontend; source datasets/import packages remain intact.
Acceptance:428 frontend tests,31 scoped backend tests,20 fresh extraction fingerprint matches,40 source/imported CPU geometry builds with0new geometry diagnostics/0terrain fallbacks. Source map_context remains identical for18valid scenes;2scenes retain existing INVALID_MAP_GEOMETRY. Owner approved preview visuals. Mainweb GPU/FPS not measured while browser owned by user. Evidence:planning/42_2026-10-13_pastel-maps/evidence/web/.

## v0.31.1 — Visible cabin bonnet
`cabinCamera.createCabinHood()` creates a red24-triangle cosmetic bonnet attached to the perspective camera. TrackView shows it only in cabin with a valid visible ego pose; follow/overview/missing pose hide it. Camera eye1.2m,70° FOV and original actor models/poses remain unchanged. Scene disposal traverses the camera subtree. Projection tests across1:1,2:1,3:1 verify all vertices below NDC y=-0.5 and some inside the frustum.17 focused camera/vehicle/pastel tests pass; no GPU screenshot while owner controls browser.
