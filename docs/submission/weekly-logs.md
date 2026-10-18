# Nhật ký tuần — Recast (trước đây là Topeye)

Ngày tổng hợp: 18/10/2026 · Snapshot tài liệu: `0.43.2`.

## Cách lập nhật ký

Đây là bản **tổng hợp hồi cứu** từ Git, changelog và ký ức phát triển của dự án, không phải biên bản họp được viết đồng thời với mỗi ngày làm việc. Tuần tính từ thứ Hai đến Chủ nhật. Nhật ký không tự thêm tên thành viên, số giờ, nội dung họp hoặc phân công khi không có nguồn chứng minh.

- [Lịch sử Git xuất bằng máy](evidence/git-history.txt) là dấu vết commit; ngày commit có thể khác ngày triển khai thực tế.
- [Changelog dự án](../../brain4agent/changelog.md) ghi quyết định và mốc phiên bản; nội dung lịch sử không tự mô tả trạng thái hiện tại.
- [Nhật ký phiên](../../brain4agent/memory/hot/today.md) bổ sung bối cảnh gần nhất; [báo cáo kiểm thử](testing.md) ghi số đo của lần bàn giao này.

Không suy từ một commit gộp rằng toàn bộ tính năng được thực hiện trong một ngày, hoặc một người đã thực hiện toàn bộ công việc.

## Tuần 1 — 28/09–04/10/2026

### Mục tiêu

Khởi tạo repository làm nền cho quá trình phát triển Topeye. Phần có dấu vết trong tuần bắt đầu từ ngày 03/10.

### Công việc có bằng chứng

| Ngày | Công việc | Bằng chứng |
| --- | --- | --- |
| 03/10 | Khởi tạo lịch sử repository | Commit `938468e` — `Initial commit` |

### Kết quả và hạn chế

- Có mốc khởi tạo để theo dõi thay đổi các tuần sau.
- Chưa có bằng chứng kiểm thử hoặc bản sản phẩm nghiệm thu của riêng tuần này trong tập nguồn được dùng để tổng hợp.
- Không suy diễn hoạt động từ 28/09 đến 02/10 hoặc ngày 04/10 khi không có dấu vết tương ứng.

### Công việc tiếp nối

Triển khai thử nghiệm xử lý dữ liệu cảnh và đánh giá hướng real-to-sim. Hướng Blender được ghi nhận bằng các commit tuần 2.

## Tuần 2 — 05–11/10/2026

### Mục tiêu

Thử nghiệm chuyển dữ liệu cảnh thật sang mô phỏng; sau đó chốt hướng Scenario Studio N3-09B với quỹ đạo, OpenSCENARIO và phép đo phát lại.

### Công việc và kết quả

| Mốc | Công việc / quyết định | Bằng chứng |
| --- | --- | --- |
| 06/10 | Triển khai pipeline real-to-sim bằng Blender trên core Topeye | `4895790` |
| 06/10 | Bổ sung dựng môi trường, thư viện actor và tình huống hiển thị | `c682fb5` |
| 06/10 | Sửa vòng hoạt ảnh để phát lại viewer | `5811a05` |
| 07/10 | Thử nghiệm môi trường procedural/PBR theo layout | `708e1b1` |
| 08–09/10 | Đánh giá giới hạn chất lượng tái dựng; hướng nghiên cứu không tự được coi là mô phỏng sẵn sàng | Các mục lịch sử trong changelog và hồ sơ bàn giao R&D |
| 09/10 | Chốt ưu tiên N3-09B: quỹ đạo → OpenSCENARIO → phát lại → biến thể → số đo | Changelog mốc `v0.3.0`, bộ nhớ phiên 09/10 |
| 10/10 | Gộp mã Scenario Studio desktop, viewer, bản đồ và cải tiến hiển thị tới `v0.12.3` vào Git | `2b7048d` |

### Khó khăn và cách xử lý

- Chất lượng 3D từ các hướng tái dựng chưa đủ để suy ra độ đúng mô phỏng. Dự án tách hướng nghiên cứu hình ảnh khỏi luồng nghiệm thu quỹ đạo.
- Khác biệt hệ tọa độ, điểm tham chiếu hộp xe và khoảng thời gian quan sát cần xử lý trước khi đo; giới hạn nguồn được ghi rõ thay vì ngoại suy tùy ý.
- Phát lại phải dùng engine và báo cáo thật; kiểm tham số hoặc xem hoạt ảnh không thay thế nghiệm thu.

### Sản phẩm của tuần

Scenario Studio desktop và nền tảng xử lý/phát lại được ghi nhận trong mã nguồn; bằng chứng nghiệm thu lịch sử được mô tả trong changelog. Kiến trúc desktop sau đó được thay thế ở tuần 3, nên không dùng hướng dẫn cài desktop cũ cho bản hiện tại.

## Tuần 3 — 12–18/10/2026

### Mục tiêu

Chuyển sang ứng dụng web local; hoàn thiện luồng thiết kế, lưu, so sánh, phân tích và xuất kịch bản; bổ sung hồ sơ nộp sản phẩm.

### Công việc và kết quả

| Ngày / mốc | Công việc | Bằng chứng |
| --- | --- | --- |
| 12/10 | Nâng toolchain, thử web demo tĩnh | `329987e`, `3ef337d` |
| 12/10 | Thay desktop Electron bằng web local đầy đủ, bỏ artifact desktop | `1b93df1`, `c2554a3` |
| 13/10 | Bổ sung chỉ số, tài khoản local, catalog dataset; lịch sử có adapter AV2 | `e3f102f` |
| 13/10 | Cài đặt giao diện/chất lượng đồ họa, cải tiến camera | `9025404`, `95ae6fe` |
| 14/10 | Mẫu tạo kịch bản, bản đồ pastel, cấu trúc cầu/đường và cài đặt; ghi nhận đồng bộ source | `d29392c`, `9814e04` |
| 15/10 | Nạp gói real2sim và báo cáo, giữ cảnh khi đổi màn | `cdd902d` |
| 15–17/10 | Phản ứng baseline/pilot, đo chỉ số, thống nhất workspace và cổng map | `c4ba186`; changelog các mốc `0.33–0.37` |
| 17/10 | Studio ba cột, lịch sử/phân tích/xuất; ego va chạm được gắn cờ; catalog hiện chỉ nuScenes | `c073512` |
| 17/10 | Báo cáo phân tích, chỉ hiển thị xe liên quan, giảm thời gian tải cảnh | `cb038b1` |
| 18/10 | Làm rõ trạng thái kiểm định, hiện đủ lý do, tránh quy lỗi tuyệt đối cho dữ liệu nguồn | `b31e1cc` |
| 18/10 | Cảnh CARLA Town10HD và tích hợp nút dựng video CARLA | `e908a4a`; có mã tích hợp, nghiệm thu remote phải xét bằng chứng riêng |
| 18/10 | Soạn README, kiến trúc, đặc tả/thiết kế, kiểm thử và nhật ký tuần; chạy lại bộ kiểm tra | Bộ tài liệu `docs/submission/`, output trong `evidence/`; là thay đổi đang chuẩn bị bàn giao, chưa có commit riêng khi lập bản này |

- Bổ sung ngày 18/10 sau bộ tài liệu: [pitch deck PDF](presentation/topeye-pitch-5min.pdf), 9 trang cho bài nói 5 phút gồm 45 giây video phát riêng. Nội dung được chốt với chủ dự án trước khi tạo; chưa có commit riêng khi lập bản này.

### Quyết định quan trọng

1. **Web local là runtime hiện tại:** cần Node/Python và dataset trên máy; không còn phát hành bộ cài Electron trong luồng này.
2. **Thu hẹp catalog về nuScenes:** việc từng có adapter AV2 không có nghĩa giao diện hiện tại nhận AV2.
3. **Giữ luật kiểm định:** tách tạo/lưu thành công khỏi đạt kiểm định, kiểm esmini và kết quả CARLA. Không tăng tỷ lệ đạt bằng cách bỏ lý do lỗi.
4. **Phân biệt nguồn và giả định:** vi phạm gần nguồn được diễn đạt là dấu hiệu cần kiểm tra; phép đo vẫn theo các ngưỡng được công bố.
5. **Hồ sơ nộp dựa vào số đo:** không công bố mọi chức năng đã hoàn tất chỉ vì unit test xanh; tách phần chưa có public URL/video/deck và kiểm chứng remote.

### Khó khăn còn lại

- Một số đoạn nguồn có chuyển động vượt ngưỡng; không bảo đảm mọi tình huống người dùng tạo đều hợp lệ.
- Các đường biến thể CLI và thiết kế UI có phạm vi khác nhau; không mô tả UI có nút mà thực tế đã bỏ.
- CARLA là tác vụ ngoài máy và phụ thuộc cấu hình/hạ tầng; không có cam kết thành công cho mọi lần dựng.
- Tài liệu lịch sử có mốc phiên bản cũ; bộ hồ sơ nộp này làm điểm đọc đầu tiên cho người chấm.

### Kết quả kiểm chứng của bản bàn giao

Các số lượng test và kết quả engine được đặt trong [testing.md](testing.md), đi kèm output máy. Không điền số giờ đóng góp, tỷ lệ hoàn thành phần trăm hoặc tên người thực hiện khi chưa có dữ liệu xác nhận.

## Tuần tiếp theo — công việc dự kiến, chưa được tính là đã làm

| Ưu tiên | Công việc | Điều kiện hoàn tất |
| --- | --- | --- |
| 1 | Chọn và nghiệm thu phương án Live URL | Người chấm trên máy khác truy cập được theo quyền được cấp |
| 2 | Quay video demo tối đa 3 phút | Thể hiện bài toán, một luồng tạo/phân tích/xuất thật và giới hạn |
| 3 | Hoàn thiện pitch deck và thumbnail | Nội dung khớp sản phẩm và có link chia sẻ |
| 4 | Chốt mã nguồn/tài liệu trên GitHub | Review diff, commit và push sau khi chủ dự án cho phép |
| 5 | Đo luồng CARLA nếu chọn đưa vào demo | Có kết quả job/video thực, cấu hình và chi phí được duyệt |

Đây là backlog phục vụ nộp bài; chưa phải lịch cam kết hoặc biên bản nghiệm thu.
