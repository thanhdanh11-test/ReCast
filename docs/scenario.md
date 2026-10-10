# Scenario Studio — N3-09B, v0.9.0

Ứng dụng desktop macOS Apple Silicon: đọc quỹ đạo nuScenes → xuất OpenSCENARIO 1.0 + OpenDRIVE → phát lại bằng esmini 3.9.0 → tạo biến thể tốc độ/vị trí → báo cáo sai số và số kịch bản hợp lệ. App dùng Electron/React, đóng gói Python 3.12 qua PyInstaller và thư viện esmini arm64; không cần Python/Node/Terminal/GPU khi sử dụng. Giao tiếp worker bằng JSONL stdio riêng, không mở HTTP server.

## Giao diện ba khung v0.8.0

3D là khung chính; bên phải là **Mô phỏng LiDAR** và **Map tích hợp** (có công tắc ẩn/hiện thật). Bỏ gallery camera giả, radar trang trí, độ tin cậy/tốc độ ghi cứng và nút không hoạt động. Thanh bên chứa cảnh nguồn, toàn bộ track (không cắt còn sáu), chọn tối đa ba đối tượng để trích đoạn, biến thể và kiểm chứng. Thanh thời gian dùng chung ba khung. CSS được scope `.studio`, đặt kích thước canvas/HUD rõ ràng, hỗ trợ cửa sổ tối thiểu 1050×720; sidebar tự cuộn.

LiDAR là **mô phỏng hình học quét ngang**, không phải waveform/point cloud nuScenes đo thực, không phải mô phỏng vật lý cảm biến đã hiệu chuẩn. `sensors.ts::simulateScan(scenario, replay, time)` phát 180 tia phủ 360°, tầm 60m, giả định cao 1m trên ego pose. Mỗi tia lấy giao điểm gần nhất với hộp xe có hướng và footprint nhà/cột/cây giản lược; bỏ vật ngoài mặt phẳng cao độ và bỏ ego. Không có giao điểm → không tạo return. Trích đoạn/esmini chỉ quét các actor của trích đoạn, không gắn map cảnh nguồn sang tọa độ đã biến đổi. UI ghi rõ nguồn/giới hạn này.

Map chỉ hiện khi có vector nuScenes: polygon giữ lỗ bằng evenodd, vị trí/yaw actor theo `supportedPose`, khung bám ego 130m, Bắc hướng lên. Thiếu map/pose có thông báo; không vẽ xe/đèn/radar tưởng tượng. Source gaps >1s và replay gaps >0,075s không được lấp bằng pose nguồn. `LidarView.tsx`, `TacticalMap.tsx`, `sensors.ts` tái dùng contracts Scenario/Replay, không thêm IPC hay thay backend.

Tác vụ UI dùng generation token: bấm Hủy vô hiệu mọi kết quả cũ trước khi gọi worker cancellation; kết quả hoặc lỗi đến muộn không được ghi lại cảnh/message. Đây là bảo vệ UI, không thay process-group cancellation trong Electron.

## Dùng bản cài

Mở `~/Applications/Topeye 0.8.app`. Bản đóng gói cũng có tại `frontend/release/Topeye-darwin-arm64/Topeye.app`. Chọn thư mục chứa `v1.0-mini`: app tự dựng cảnh gốc đầy đủ. Để đo bằng simulator, chọn 1–3 xe, bấm **Trích đoạn thử nghiệm**, rồi **Chạy phát lại**. **Xuất kịch bản** lưu gói XOSC/XODR/reference/manifest. Thanh tốc độ và dịch dọc đường tạo một reference mới; số kịch bản đạt là số ID đã chạy đạt trong phiên hiện tại, không phải số file xuất.

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

## Phát triển và đóng gói

Từ root repo, sau khi đã tạo Python 3.12 venv:

```sh
uv pip install --python backend/.venv/bin/python -e 'backend[dev,scenario-build]'
backend/.venv/bin/python backend/scripts/build_scenario_engine.py
cd frontend
npm ci
npm run desktop:dev
npm run desktop:package
```

Build engine kiểm SHA256 của `esmini-fullsrc.zip` v3.9.0: `dbf409d228087ef71e3077498aad181974a1adc222823e7ebcf9cd981b6ceaf8`. CMake tắt OSG/OSI/SUMO/PROJ/IMPLOT; không tải GPU/runtime mô phỏng khác. Xcode Command Line Tools cần cho build, không cần cho người dùng app. Electron archive cache được kiểm bằng checksums của package Electron. Bộ cài ở `frontend/release/Topeye-0.8.0-mac-arm64.zip`, manifest ghi engine/artifact SHA, phiên bản và kiến trúc. Ký ad-hoc local, **chưa notarize để phát hành công khai**; không vô hiệu hóa Gatekeeper.

```sh
backend/.venv/bin/python -m topeye.scenario.cli probe-engine --engine backend/.tools/esmini/build/EnvironmentSimulator/Libraries/esminiLib/libesminiLib.dylib
backend/.venv/bin/python -m topeye.scenario.cli accept --dataset /path/to/nuscenes --engine backend/.tools/esmini/build/EnvironmentSimulator/Libraries/esminiLib/libesminiLib.dylib --workspace /new/acceptance-directory
node frontend/scripts/test-desktop.mjs /path/Topeye.app/Contents/MacOS/Topeye /path/to/nuscenes /existing/evidence-directory
```

`accept` chọn reference đáp ứng các ngưỡng động học trước, rồi bắt buộc chạy baseline và 3 biến thể qua engine. Reference preflight không được tính là bằng chứng simulator. `desktop:test` điều khiển app cài thật bằng Playwright Electron, chỉ giả lập giá trị trả về của hộp chọn thư mục; toàn bộ IPC, đọc dữ liệu, xuất file, engine, đo sai số, hủy và đóng tiến trình đều thật. Kiểm hash 13 file metadata trước/sau. Không claim đã tự động kiểm mọi thao tác native file picker bằng chuột.

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
