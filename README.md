# ReCast — Scenario Studio

_Trước đây có tên **Topeye**; mã nguồn vẫn giữ định danh kỹ thuật `topeye` (package Python, lệnh `topeye-*`, biến môi trường `TOPEYE_*`)._

**Chuyển quỹ đạo giao thông thành kịch bản mô phỏng có thể phát lại, tạo biến thể và đánh giá.**

ReCast phục vụ quy trình N3-09B đã ghi nhận trong dự án: dữ liệu nuScenes → OpenSCENARIO → simulator → biến thể → sai số quỹ đạo và số kịch bản hợp lệ. Người dùng xem cảnh trên bản đồ 2D/3D, thiết kế tình huống, so sánh baseline/pilot, đọc báo cáo và xuất gói kịch bản.

> Bộ tài liệu: 18/10/2026, phiên bản mã nguồn `0.43.4` (đổi tên hiển thị thành ReCast; chức năng từ `0.43.1`). MVP hiện là ứng dụng web **chạy local**, không phải dịch vụ nhiều người dùng đã triển khai công khai. `http://127.0.0.1:5180` không phải Live URL để ban giám khảo truy cập từ máy khác.

## Tài liệu nộp sản phẩm

| Tài liệu | Nội dung |
| --- | --- |
| [Sơ đồ kiến trúc](docs/submission/architecture.md) | Thành phần, luồng dữ liệu, triển khai và ranh giới tin cậy |
| [Đặc tả và thiết kế](docs/submission/specification-design.md) | Yêu cầu, use case, contract, trạng thái, giới hạn và tiêu chí nghiệm thu |
| [Tài liệu kiểm thử](docs/submission/testing.md) | Phương pháp, ma trận kiểm thử, kết quả đo và lệnh tái hiện |
| [Nhật ký tuần](docs/submission/weekly-logs.md) | Tiến trình theo tuần, quyết định, vấn đề và dấu vết commit |
| [Pitch deck PDF — 5 phút](docs/submission/presentation/topeye-pitch-5min.pdf) | 9 trang cho ban giám khảo, kèm [lời dẫn](docs/submission/presentation/speaker-notes.md); 45 giây video phát riêng |
| [Bằng chứng kiểm thử](docs/submission/evidence/) | Output máy của các lần chạy phục vụ bộ tài liệu này |

## Bài toán và giải pháp

Quỹ đạo thu từ giao thông thật cần được chuyển sang kịch bản có thời gian và vị trí rõ ràng để tái hiện trong simulator. Nếu chỉ xem chuyển động, người dùng khó biết kịch bản có chạy được, bám đúng quỹ đạo hay vượt giới hạn vật lý.

ReCast kết hợp công cụ trực quan với pipeline kiểm chứng: giữ dữ liệu nguồn chỉ đọc; tạo gói kịch bản riêng; chạy esmini thật để đo khả năng phát lại; mô phỏng phản ứng bám xe để so sánh cùng sự kiện khi không có và có phản ứng. Kết quả lưu được cùng báo cáo và lý do kiểm định.

## Chức năng hiện có

- Đăng nhập bằng tài khoản local, quản lý thư viện dữ liệu nuScenes và chọn cảnh.
- Xem bản đồ 2D, cảnh 3D, quỹ đạo, đối tượng và dòng thời gian đồng bộ; xem LiDAR nguồn khi dữ liệu có sẵn.
- Tạo kịch bản từ 20 mẫu hoặc tình huống phản ứng: phanh/dừng, tăng tốc, dừng ở vạch và chuyển làn trong cửa sổ được hỗ trợ.
- So sánh baseline không phản ứng với pilot phản ứng theo mô hình bám xe; phân tích khoảng cách, TTC, phanh, va chạm và các điều kiện kiểm định.
- Nạp `.xosc` theo profile của ứng dụng hoặc gói real2sim theo tập hành vi được hỗ trợ; không cam kết đọc mọi OpenSCENARIO tùy ý.
- Lưu, mở lại, sửa theo loại kịch bản, xóa vào `.trash`; xuất `.xosc` hoặc gói CARLA.
- Chạy phép đo quỹ đạo và thống kê kịch bản; backend/CLI giữ khả năng sinh biến thể tốc độ và dịch khoảng cách.
- Tích hợp tùy chọn dựng video CARLA ở góc sau xe/trong xe, cần máy và cấu hình riêng.

**Phân biệt trạng thái:** tạo/lưu thành công không đồng nghĩa đạt mọi điều kiện kiểm định. Va chạm baseline có thể là kết quả để so sánh. “Dữ liệu nguồn cần kiểm tra” là dấu hiệu từ bộ kiểm định, không tự chứng minh annotation sai. Kiểm tra bằng esmini là một bước riêng.

## Công nghệ và cấu trúc

| Tầng | Công nghệ |
| --- | --- |
| Giao diện | React 18, TypeScript, Vite 8, Three.js |
| Server local | Node.js, HTTP loopback, tài khoản và hàng đợi tác vụ local |
| Xử lý | Python 3.12, NumPy, SciPy, Shapely, lxml; JSONL worker |
| Phát lại | esmini 3.9.0, thư viện headless build từ source kiểm SHA256 |
| Lưu trữ | JSON/XML/CSV và manifest hash trong workspace |
| Tích hợp tùy chọn | CARLA, Brev CLI; không cần cho luồng esmini cơ bản |

```text
backend/topeye/scenario/  Chuyển đổi, mô phỏng, kiểm định, phát lại, xuất gói
backend/topeye/core/      Adapter và xử lý dữ liệu nguồn dùng chung
frontend/src/scenario/   Giao diện Scenario Studio, 2D/3D, phân tích
frontend/server/         HTTP local, tài khoản, worker bridge, hàng đợi
docs/submission/         Hồ sơ nộp sản phẩm và bằng chứng kiểm thử
brain4agent/             Bộ nhớ phát triển và lịch sử quyết định
```

Các thư mục Blender/NuRec trong repo là hướng nghiên cứu lịch sử; không phải điều kiện chạy MVP Scenario Studio.

## Cài đặt và chạy

### 1. Chuẩn bị

- Môi trường đã kiểm chứng: macOS Apple Silicon, Python `3.12.13`, Node.js `22.23.2`, npm và trình duyệt có WebGL.
- Cần C/C++ build tools để build esmini; trên macOS dùng Xcode Command Line Tools.
- Cần bộ nuScenes có metadata và dữ liệu liên quan; map expansion cần cho quy trình tạo kịch bản gắn map. Dataset/model không được đóng kèm trong source.
- Python package khai báo `>=3.12`; bộ tài liệu này không chứng nhận mọi Python mới hơn, Windows hay Linux.

### 2. Cài dependencies và esmini

Chạy từ gốc repository:

```sh
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e './backend[dev,scenario-build]'
backend/.venv/bin/python backend/scripts/build_scenario_engine.py
```

Script cuối tải source esmini 3.9.0 từ upstream nếu chưa có, kiểm SHA256 rồi build thư viện. Máy cần mạng ở bước tải dependencies/source; luồng xem và xử lý local dùng dữ liệu đã có trên máy.

### 3. Chạy ứng dụng

```sh
cd frontend
npm ci
npm run web:local
```

Mở `http://127.0.0.1:5180`. Có thể đổi cổng bằng `TOPEYE_PORT`. Tạo tài khoản local ở lần đầu, sau đó **Thêm dữ liệu** và chọn đường dẫn nuScenes trên chính máy chạy server. Không dùng tài khoản dịch vụ bên ngoài.

Cấu trúc dữ liệu điển hình:

```text
nuscenes/
├── v1.0-mini/          Metadata JSON
├── maps/              Bản đồ; map expansion theo cấu trúc nuScenes
├── samples/           LiDAR/ảnh theo bộ dữ liệu đã tải
└── sweeps/            Sweep bổ sung nếu có
```

Không chép đường dẫn dataset của máy phát triển sang máy người chấm. Tự tải và sử dụng dữ liệu theo điều kiện cấp phép của nhà cung cấp.

### 4. Quy trình trải nghiệm

1. Đăng nhập → mở bộ dữ liệu → chọn cảnh.
2. Quan sát bản đồ, chuyển 2D/3D và kéo timeline.
3. Chọn **Tạo kịch bản** → mẫu có sẵn hoặc tự tạo tình huống phản ứng.
4. Chạy tạo; đọc trạng thái kiểm định, xem baseline/pilot và các lý do chưa đạt nếu có.
5. Mở **Phân tích** để xem diễn biến, kiểm định và số liệu từng xe.
6. **Lưu / xuất** → theo dõi trang **Đã xuất** → tải gói.

Một số cảnh xem được nhưng không qua cổng map để tạo kịch bản. Đây là từ chối có lý do, không phải quyền bỏ qua kiểm định.

### 5. Đưa lên máy chủ (tùy chọn)

Chạy trên VPS Linux sau Caddy (HTTPS), app vẫn chỉ nghe `127.0.0.1`; tài khoản tạo bằng lệnh trên máy chủ. Hướng dẫn: [deploy/README.md](deploy/README.md).

## Kiểm thử

```sh
# Từ gốc repo
backend/.venv/bin/python -m pytest backend/tests -q

# Trong frontend/
npm test -- --run
npm run test:server
npm run typecheck
npm run build
```

Kiểm thử có dữ liệu nuScenes/esmini cần đúng dataset và engine local; xem [hướng dẫn tái hiện](docs/submission/testing.md). Báo cáo liên kết output đo thực, phân biệt test tự động với kiểm chứng trên trình duyệt và CARLA.

## Dữ liệu, vận hành và giới hạn

- Workspace mặc định: `~/Documents/ReCast Projects` (máy đã có `~/Documents/Topeye Projects` thì dùng tiếp); đầu ra phải nằm ngoài dataset nguồn.
- Trên macOS, tài khoản/settings/log local ở `~/Library/Application Support/ReCast` (máy đã có thư mục `Topeye` cũ thì dùng tiếp). Không đưa thư mục này, mật khẩu hoặc cấu hình máy CARLA lên GitHub.
- Server bind `127.0.0.1`; tài khoản local và các chốt Host/Origin/token không phải thiết kế SaaS nhiều người dùng. Đưa MVP ra Internet cần phương án triển khai riêng.
- Gói dùng quỹ đạo tính sẵn. Xe xung quanh không tự phản ứng lại khi một hệ lái bên ngoài thay đổi quỹ đạo ego lúc phát lại.
- Nhà/cây và một phần địa hình hiển thị là hình học ước lượng; không phải digital twin được khảo sát chính xác.
- Kiểm tra va chạm có giới hạn hộp 2D/lấy mẫu; không chứng nhận an toàn xe tự lái thực tế.
- Giao diện AI hiện diễn giải theo mock từ khóa; không công bố là mô hình AI sinh kịch bản thật.
- Windows/Linux, public hosting, video demo ≤3 phút và pitch deck chưa được chứng nhận bởi bộ tài liệu này. GPU/CARLA không cần cho luồng local esmini.

## Tình trạng bàn giao

Bộ này cung cấp README, kiến trúc, đặc tả/thiết kế, tài liệu kiểm thử, nhật ký tuần và pitch deck PDF 5 phút. Live URL công khai, video demo cuối cùng và link thumbnail vẫn là các hạng mục riêng; trang video trong PDF là cue phát video ngoài. Bản này chưa tự push/publish hoặc phát hành tag lên GitHub.
