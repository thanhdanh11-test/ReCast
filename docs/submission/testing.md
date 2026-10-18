# Tài liệu kiểm thử và bằng chứng nghiệm thu

Ngày lập: 18/10/2026 · Mã tài liệu: TEST-01 · Phiên bản bộ tài liệu: `0.43.2`.

## 1. Mục tiêu và phạm vi

Kiểm tra pipeline Scenario Studio từ dữ liệu đến kịch bản, trạng thái và báo cáo; cung cấp lệnh tái hiện và dấu vết máy. Tài liệu phân biệt bốn loại bằng chứng:

1. Unit/integration test: hành vi module, component và server theo các ca có trong bộ test.
2. Acceptance engine: chuyển đổi và chạy simulator thật trên một đoạn nuScenes được chọn.
3. Browser: tương tác/giao diện đã quan sát, kèm phạm vi và phiên bản của lần đo.
4. Remote CARLA/public hosting: chỉ được coi là đạt khi có phép nghiệm thu riêng; không suy ra từ test mock.

Không dùng số lượng test để chứng minh mọi dataset, mọi profile OpenSCENARIO hoặc mọi tương tác đều hỗ trợ.

## 2. Môi trường và snapshot

- Máy đo: macOS Apple Silicon (`Darwin arm64`).
- Python `3.12.13`, Node.js `22.23.2`; esmini `3.9.0` build headless trong repo.
- Dữ liệu cho phép đo nghiệm thu engine: nuScenes `v1.0-mini`; dùng đoạn được CLI lựa chọn có đủ dữ liệu hỗ trợ.
- Phiên bản package `0.43.2` là bản vá tài liệu, không đổi logic sản phẩm so với `0.43.1`.
- SHA nền, thời điểm đo và tóm tắt từng gate nằm trong [verification-summary.json](evidence/verification-summary.json). SHA nền không phải tag phát hành của các tài liệu chưa commit.
- Các bộ kiểm tra dùng output/temp workspace riêng; không cần bật máy GPU/CARLA hoặc deploy public.

## 3. Kết quả đo trong đợt bàn giao

| Gate | Kết quả đo | Mã thoát | Bằng chứng |
| --- | --- | --- | --- |
| Backend pytest | 842 đạt, 0 fail, 0 skip; 1 warning | 0 | backend-tests.txt |
| Frontend Vitest | 578 đạt, 0 fail, 0 skip | 0 | frontend-tests.txt |
| Node server tests | 67 đạt, 0 fail, 0 skip | 0 | server-tests.txt |
| Build + TypeScript | Thành công | 0 | build.txt |
| esmini thật | 4/4 ca đạt, scene-0103 | 0 | scenario-acceptance.json |

Output máy:

- [Backend pytest](evidence/backend-tests.txt).
- [Frontend Vitest](evidence/frontend-tests.txt).
- [Server Node tests](evidence/server-tests.txt).
- [TypeScript + Vite build](evidence/build.txt).
- [Acceptance esmini](evidence/scenario-acceptance.json).

Build bao gồm bước `tsc`; Vite phát cảnh báo về cấu hình/độ lớn bundle nếu có. Cảnh báo không được ghi thành lỗi test, nhưng cũng không bị coi là bằng chứng đã tối ưu hiệu năng. Chi tiết warning nằm nguyên trong output.

[Rà tài liệu](evidence/documentation-check.json) kiểm các liên kết local và XML của sơ đồ. [Phép đo SVG trên trình duyệt](evidence/diagram-render.json) ghi 39 phần tử chữ, không có phần tử chữ vượt khung 1440×1000. Đây là kiểm tra bố trí chữ, không phải đánh giá thẩm mỹ; capture screenshot đã timeout nên không có ảnh preview mới. Mermaid được rà cấu trúc cơ bản, chưa chạy compiler riêng.

## 4. Ma trận truy vết yêu cầu → kiểm thử

| Yêu cầu | Bộ kiểm tra / bằng chứng | Hành vi cần chứng minh |
| --- | --- | --- |
| FR-01 — tài khoản local | `frontend/server/local-auth.test.mjs`, `local-access.test.mjs` | Xác thực, cookie/session, sai mật khẩu, rate-limit, từ chối trước khi worker chạy |
| FR-02 — dataset | Backend dataset/source tests; server dataset/catalog tests | Từ chối dữ liệu sai; catalog chỉ nuScenes; không ghi nguồn |
| FR-03 — viewer/timeline | Frontend scenario/map/timeline/pose tests | Pose hợp lệ, thời gian đồng bộ, đổi cảnh và kết quả đến muộn |
| FR-04 — template | `backend/tests/test_scenario_template.py`, `ScenarioCreator.test.tsx` | Kiểm tham số/map, phản ứng ego theo mẫu, va chạm được gắn cờ; không gọi kiểm tham số là kiểm chuyển động |
| FR-05 — phản ứng | `test_scenario_reactive.py`, `test_scenario_reactive_kinds.py`, workspace tests | Sự kiện, cửa sổ, baseline/pilot, dừng hẳn, giới hạn và dữ liệu nguồn |
| FR-06 — nạp gói | XOSC import và real2sim tests | Chấp nhận đúng tập hỗ trợ; từ chối hành vi ngoài profile/hash sai |
| FR-07 — engine/sai số | Acceptance JSON; backend replay/engine/metrics tests | Engine hoàn tất, exit code, coverage, sai số theo report |
| FR-08 — biến thể | `variants.py` tests và acceptance CLI | Baseline, ×0,8 tốc độ, ×1,2 tốc độ và dịch dọc +2 m chạy được trong ca lựa chọn |
| FR-09 — chỉ số/verdict | Reactive/replay metrics tests; `validity.test.ts`, `studio.test.tsx`, `Real2simReport.test.tsx` | Mọi lý do được giữ; trạng thái thiếu số liệu không bị biến thành đạt/0 |
| FR-10 — lưu/xóa | `test_scenario_library.py`, Studio/server tests | Định danh/path, mở lại, quyền, xóa đúng phạm vi |
| FR-11 — xuất | `test_scenario_export.py`, `scenario-exports.test.mjs` | Job, payload/manifest, trạng thái và xử lý lỗi |
| FR-12 — CARLA | `carla-render.test.mjs`, các test liên quan export | Chỉ chứng minh điều phối theo runner mock/test; chưa thay bằng chứng chạy remote của phiên bản nộp |

Tên file là điểm vào; output toàn bộ bộ test là bằng chứng thực thi, không khẳng định mọi dòng trong ma trận là một E2E trình duyệt độc lập.

## 5. Phép nghiệm thu esmini thật

CLI `topeye.scenario.cli accept` tìm đoạn nguồn mà baseline và ba biến thể đủ hỗ trợ, sau đó xuất bundle và **chạy engine thật cho cả bốn ca**. Preflight không được tính thay cho engine.

| Ca | Biến đổi |
| --- | --- |
| baseline | Quỹ đạo gốc của đoạn trích |
| slower | Tốc độ đối tượng được chọn ×0,8 |
| faster | Tốc độ đối tượng được chọn ×1,2 |
| offset | Dịch dọc quỹ đạo +2 m |

[JSON nghiệm thu](evidence/scenario-acceptance.json) chứa scene, coverage, `per_actor`, các `thresholds`, exit code và hash engine/bundle cho từng ca. Không thay các giá trị đó bằng số minh họa.

**Cách đọc:** sai số rất nhỏ của phát lại quỹ đạo tính sẵn cho biết engine bám reference của gói; không tự chứng minh độ chính xác bản đồ thực, nhận thức của xe tự lái hay phản ứng closed-loop. Ca lựa chọn đi qua đường legacy extraction với corridor tổng hợp, không chứng minh mọi cảnh qua cổng map của template/UI.

## 6. Ca âm và hồi quy quan trọng

| Nhóm | Đầu vào / tình huống | Kết quả mong đợi |
| --- | --- | --- |
| Tài khoản | Chưa đăng nhập, token/Origin không hợp lệ | Từ chối trước thao tác dữ liệu |
| Phân loại | `label_error` từ report cũ | “Dữ liệu nguồn cần kiểm tra”, có giải thích heuristic, không quy lỗi chắc chắn cho annotation |
| Nhiều lý do | `label_error` cùng `physics` | Hiện cả hai; không chỉ lấy phần tử đầu |
| Mã mới | Reason chưa biết | Giữ nội dung gốc; không bỏ qua hoặc đổi thành đạt |
| Baseline va chạm | Report baseline `valid=false`, reason collision | Ghi rõ baseline có va chạm, tách khỏi lỗi tạo/lưu |
| Chưa đo esmini | `passed=null` | “Chưa kiểm”; không báo engine hỏng hoặc tự đạt |
| Template | Client kiểm đúng tham số | Nói rõ chưa kiểm chuyển động/map ở bước này |
| Dữ liệu | Track thiếu/gap/không hữu hạn | Từ chối hoặc không hỗ trợ pose theo contract; không ngoại suy tùy ý |
| Toàn vẹn | Hash/payload gói sai hoặc đường dẫn vượt quyền | Từ chối mở/xử lý theo mã lỗi |
| Race | Hủy/chuyển cảnh khi kết quả cũ sắp về | Không ghi kết quả cũ vào cảnh mới |
| Xuất | Job thất bại hoặc payload thiếu | Trạng thái failed/lý do; không đưa download giả |

Các assertion tương ứng thuộc bộ regression hiện có; đây không phải danh sách đầu vào mới được chạy riêng ngoài bộ test.

## 7. Kiểm chứng trình duyệt và kết quả lịch sử

Phiên kiểm giao diện ngày 18/10 ở `0.43.1` đã dùng server local riêng và bản sao 17 gói để quan sát history/Studio/analysis. Trường hợp nguồn + vật lý hiển thị đủ hai lý do; 97 payload bản sao khớp bản gốc. Các artifact được sao chép nguyên vẹn vào `evidence/` với tiền tố `historical-` và có [provenance](evidence/historical-browser-provenance.json).

Đây là **bằng chứng của lần đo trước**, không phải tuyên bố đã chạy lại toàn bộ browser E2E trong đợt tài liệu `0.43.2`. Thay đổi hiện tại chỉ gồm tài liệu/phiên bản; các test mới và acceptance engine ở mục 3 là lần đo của đợt này.

Các benchmark 10 cảnh ghi trong lịch sử dự án cũng không được tự chuyển thành số lượng “kịch bản đạt hiện tại” nếu chưa chạy lại với cùng định nghĩa. Quy tắc pilot, baseline và chỉ số theo cảnh phải được phân biệt.

## 8. Lệnh tái hiện

### 8.1. Bộ test tự động

Sau khi cài theo [README](../../README.md), chạy từ gốc repo:

```sh
backend/.venv/bin/python -m pytest backend/tests -q
```

Trong `frontend/`:

```sh
npm test -- --run
npm run test:server
npm run typecheck
npm run build
```

Một số test backend cần dataset/esmini thật. Có thể đặt `TOPEYE_NUSC_ROOT` tới dataset của máy đo; không giả định đường dẫn trên máy phát triển tồn tại ở máy người chấm.

### 8.2. Acceptance engine trên macOS đã build esmini

Lệnh sau nhập đường dẫn dataset từ người chạy để không ghi cứng đường dẫn riêng vào tài liệu:

```sh
read -r -p "Đường dẫn nuScenes: " TOPEYE_ACCEPT_DATASET
backend/.venv/bin/python -m topeye.scenario.cli accept \
  --dataset "$TOPEYE_ACCEPT_DATASET" \
  --engine backend/.tools/esmini/build/EnvironmentSimulator/Libraries/esminiLib/libesminiLib.dylib
```

Đoạn `read -p` dùng Bash; với shell khác, có thể đặt biến bằng đường dẫn dataset của máy trước khi chạy Python. Nếu không truyền `--workspace`, CLI tự tạo thư mục tạm riêng và in vị trí output. Mã thoát 0 chỉ khi bốn ca đạt; thiếu engine/dataset hoặc ca thất bại phải được giữ nguyên trong báo cáo.

### 8.3. Browser E2E có dataset

Trong `frontend/`, với Chrome và dependencies đã cài:

```sh
read -r -p "Đường dẫn nuScenes: " TOPEYE_E2E_DATASET
npm run test:e2e -- "$TOPEYE_E2E_DATASET"
```

Đây là hướng dẫn tái hiện riêng; không ghi là đã chạy trong đợt này nếu chưa có output tương ứng. Không chạy CARLA/Brev như một phần mặc định của test local.

## 9. Những phần chưa được chứng nhận

- Hệ điều hành khác macOS arm64; dataset đầy đủ ở mọi quy mô; mọi cảnh/phân loại hành vi.
- Khả năng chạy mọi OpenSCENARIO ngoài profile và tập action hỗ trợ.
- Public URL, nhiều người dùng đồng thời qua Internet, kiểm thử tải hoặc SLA.
- Thành công remote CARLA của mọi gói và mọi cấu hình máy; hiệu quả huấn luyện mô hình perception.
- Giả định hộp va chạm 2D, hình học ước lượng và quỹ đạo tính sẵn không đủ để chứng nhận an toàn thực tế.

## 10. Kết luận nghiệm thu

Bộ bằng chứng đủ để báo cáo các gate local đã đo ở mục 3. Việc ký nghiệm thu toàn bộ sản phẩm cần đối chiếu đề chức năng nguyên văn và hoàn thành các hạng mục nộp riêng như Live URL/video/deck. Không có phép push, publish hay job GPU mới nào được thực hiện chỉ để tạo bộ tài liệu này.
