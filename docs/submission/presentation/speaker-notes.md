# Topeye — Lời dẫn thuyết trình 5 phút

> 9 trang · 300 giây tổng cộng · 45 giây dành cho video phát riêng.

Đây là kịch bản tham chiếu. Cần tập đọc, bấm giờ và thử video trước khi trình bày. Không đọc cả chú thích nguồn trên slide.

| Trang | Thời gian | Nội dung |
| --- | --- | --- |
| 1 | 00:00–00:20 (20 s) | Đi nhiều. Vẫn thiếu ca hiếm. |
| 2 | 00:20–01:00 (40 s) | Thu thập nhiều dữ liệu, vẫn có thể thiếu ca hiếm. |
| 3 | 01:00–01:35 (35 s) | Hai ca hiếm. Nhiều biến thể để kiểm thử. |
| 4 | 01:35–02:10 (35 s) | Từ cảnh đã có, đến tình huống cần kiểm thử. |
| 5 | 02:10–02:45 (35 s) | Một nơi để tạo, so sánh và kiểm tra. |
| 6 | 02:45–03:15 (30 s) | Tạo được chưa có nghĩa là đã đạt kiểm định. |
| 7 | 03:15–04:00 (45 s) | Video demo — 45 giây |
| 8 | 04:00–04:35 (35 s) | Đã có sản phẩm. Đã có bằng chứng chạy thật. |
| 9 | 04:35–05:00 (25 s) | Đừng chờ ca hiếm. Hãy chủ động kiểm thử. |

## Trang 1 — 20 giây

Topeye bắt đầu từ một câu hỏi: nếu cứ đưa xe ra đường để thu thập dữ liệu, bao giờ chúng ta mới gặp đủ những tình huống hiếm cần kiểm thử? Chúng em xây dựng một công cụ để chủ động tạo, phát lại và đánh giá các kịch bản giao thông, thay vì chỉ chờ chúng tình cờ xuất hiện.

## Trang 2 — 40 giây

Trong những chuyến thu thập dữ liệu, phần lớn điều chúng ta quan sát là giao thông thường ngày. Nhưng để kiểm thử, nhóm phát triển còn cần những khoảnh khắc khó gặp: một người bất ngờ bước ra, hoặc chiếc xe phía trước phanh gấp. Chúng ta khó chủ động chọn lúc các tình huống này xảy ra, cũng khó gặp lại chúng với đúng khoảng cách và vận tốc mong muốn. Vì vậy, chỉ tăng lượng dữ liệu thu được chưa chắc giải quyết được phần còn thiếu. Bài toán của Topeye là giúp tạo ra các tình huống cần kiểm thử một cách có kiểm soát và có thể lặp lại.

## Trang 3 — 35 giây

Chúng em tập trung minh họa bằng hai trường hợp. Thứ nhất là trẻ em lao ra từ sau xe đỗ, khiến vùng bị che khuất trở thành điểm cần quan tâm. Thứ hai là xe phía trước phanh gấp, khi khoảng cách và độ trễ phản ứng ảnh hưởng tới diễn biến. Với mỗi tình huống, nhu cầu không chỉ là có một video. Người kiểm thử muốn thay đổi thời điểm, vận tốc hoặc khoảng cách, chạy lại và so sánh kết quả. Đây là lý do chúng em lựa chọn kịch bản có tham số thay vì chỉ xem lại dữ liệu đã ghi.

## Trang 4 — 35 giây

Topeye tổ chức quy trình thành bốn bước. Đầu tiên, đọc cảnh và quỹ đạo từ dữ liệu nguồn như nuScenes. Tiếp theo, người dùng thiết kế tình huống từ mẫu hoặc thay đổi sự kiện và tham số. Sau đó, hệ thống tạo quỹ đạo và xuất kịch bản để phát lại. Cuối cùng, kết quả được phân tích bằng các chỉ số và điều kiện kiểm định. Giá trị chúng em hướng tới là tận dụng lại cảnh đã có để xây dựng thêm những bài kiểm thử có thể tái hiện, thay vì luôn phải bắt đầu bằng một chuyến thu thập mới.

## Trang 5 — 35 giây

Đây là giao diện sản phẩm thực tế. Người dùng chọn cảnh, xem bản đồ hoặc không gian ba chiều và theo dõi chuyển động trên dòng thời gian. Sau khi tạo tình huống, các kịch bản được lưu vào lịch sử để mở lại, phân tích hoặc xuất. Với tình huống phản ứng, Topeye cho phép so sánh baseline không phản ứng và pilot có phản ứng theo mô hình. Như vậy, công cụ không dừng ở việc vẽ ra một cảnh, mà kết nối quá trình thiết kế với việc xem lại diễn biến và đọc kết quả của chính kịch bản đó.

## Trang 6 — 30 giây

Một điểm quan trọng là tạo được kịch bản chưa đồng nghĩa kịch bản đã đạt. Topeye tách trạng thái tạo và lưu khỏi kết quả kiểm định. Người dùng có thể xem khoảng cách, thời gian tới va chạm, mức phanh và các lý do chưa đạt. Một số vấn đề có thể liên quan đến dữ liệu nguồn hoặc giới hạn mô hình. Việc hiển thị rõ những giới hạn này giúp kết quả dễ kiểm tra lại, thay vì coi một chuyển động trông hợp lý là bằng chứng duy nhất.

## Trang 7 — 45 giây

Chuyển sang video demo đã chuẩn bị. Dành tối đa 45 giây cho cả thao tác chuyển cửa sổ và phát video. Ưu tiên cho thấy chọn/tạo kịch bản, trẻ em lao ra từ sau xe đỗ, xe trước phanh gấp và một kết quả phân tích. PDF không nhúng hoặc tự phát video. Video demo cuối cùng chưa được chỉ định trong hội thoại; cần chọn và thử trước buổi trình bày. Các khung hình trong slide được lấy từ video CARLA local đã có, không phải video demo mới do bộ slide tạo ra.

## Trang 8 — 35 giây

Về tính khả thi, MVP hiện chạy trên máy local và luồng esmini cơ bản không cần GPU. Trong đợt kiểm tra ngày 18 tháng 10, tổng cộng một nghìn bốn trăm tám mươi bảy test tự động đã đạt. Phép nghiệm thu esmini cũng chạy thành công cả bốn ca gồm bản gốc, chậm hơn, nhanh hơn và dịch khoảng cách trên một đoạn dữ liệu được chọn. Chúng em dùng những kết quả này để chứng minh pipeline có thể chạy và kiểm tra lại. Đây chưa phải bằng chứng về mọi cảnh, khả năng tự lái ngoài đời hay mức tiết kiệm chi phí thực tế.

## Trang 9 — 25 giây

Trong giai đoạn tiếp theo, Topeye hướng tới mở rộng thư viện tình huống hiếm, cải thiện trải nghiệm chia sẻ và tăng khả năng tương tác của mô phỏng. Mục tiêu xuyên suốt vẫn là giúp người phát triển chủ động có những kịch bản cần kiểm thử, có thể lặp lại và có số liệu để đối chiếu. Topeye: từ cảnh đã có đến những tình huống cần kiểm thử. Chúng em cảm ơn ban giám khảo.

## Chuẩn bị video

- PDF là bản tĩnh; mở sẵn video bằng trình phát riêng và thử chuyển cửa sổ trước.
- Trang 7 dành tối đa 45 giây, đã nằm trong tổng 5 phút, không cộng thêm sau bài nói.
- Video cuối chưa được người dùng chỉ định. Có hai clip CARLA local đã thấy: `tre_em_lao_ra.mp4` (12,05 s) và `car154_trong_xe.mp4` (19,15 s). Chưa xác minh clip thứ hai là bản demo phanh gấp mà người trình bày muốn dùng; cần xem và chọn trước buổi trình bày.
- Nếu video dài hơn 45 giây, cắt/chọn đoạn hoặc điều chỉnh lời dẫn; không hứa bài vẫn đủ 5 phút khi chưa tập.

## Nguồn và giới hạn

- Số đo: `../evidence/verification-summary.json`, thực hiện 18/10/2026; 4/4 là acceptance trên đoạn được chọn, không phải tỷ lệ mọi kịch bản.
- Ảnh giao diện lấy từ bằng chứng 0.43.1; ảnh CARLA là khung hình từ clip local đã có.
- Hai sơ đồ tình huống ở trang 3 là minh họa vector, không phải quỹ đạo đo được.
- Không công bố tiết kiệm chi phí, tăng độ an toàn hoặc hiệu quả train khi chưa đo.
- Hệ thống dùng quỹ đạo tính sẵn; closed-loop và Live URL công khai chưa được nghiệm thu trong bộ slide này.
- Thiết kế theo `frontend/DESIGN-ferrari.md`: #181818, #da291c, chữ trắng, nét mảnh, cạnh vuông; Inter 500/400 thay FerrariSans theo guide. Không dùng biểu tượng Ferrari.
