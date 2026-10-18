# ReCast — bộ slide cho ban giám khảo

- [PDF thuyết trình](topeye-pitch-5min.pdf): 9 trang, 16:9, tiếng Việt.
- [Lời dẫn và bảng thời gian](speaker-notes.md): tổng 300 giây, đã tính 45 giây video.
- [Ảnh xem nhanh](previews/contact-sheet.jpg).
- [Nguồn nội dung](pitch-content.json) và [script dựng PDF](build_deck.py).
- [Kết quả kiểm PDF](evidence/pdf-validation.json): số trang, font nhúng, dấu tiếng Việt, chữ tràn trang và nguồn số đo.

## Brief đã chốt

Tên dự án **ReCast**; người nghe là **ban giám khảo**. Bài nói dài **5 phút**, nhấn mạnh khó thu thập đủ tình huống hiếm trong những chuyến thu dữ liệu. Hai ví dụ: trẻ em lao ra từ sau xe đỗ và xe phía trước phanh gấp. Có video demo, phát riêng tại trang 7.

Quyết định 5 phút thay thế yêu cầu 3 phút trước đó. Không còn hai thời lượng cùng áp dụng. Không bổ sung tên thành viên hoặc đơn vị khi chưa được cung cấp.

## Câu chuyện

1. Đi nhiều nhưng vẫn thiếu ca hiếm.
2. Vì sao lượng dữ liệu không đồng nghĩa độ phủ tình huống.
3. Hai tình huống cụ thể và nhu cầu tạo biến thể.
4. Quy trình đọc cảnh → thiết kế → phát lại → đánh giá.
5. Giao diện sản phẩm thực tế.
6. Phân biệt tạo được với đạt kiểm định.
7. Video demo, tối đa 45 giây.
8. Bằng chứng khả thi: 4/4 ca esmini và 1.487 test tự động trong hồ sơ 18/10.
9. Hướng phát triển và thông điệp kết thúc.

Các số đo không phải tỷ lệ đạt của mọi cảnh hay bằng chứng tiết kiệm chi phí/tăng an toàn thực tế. Giới hạn này được ghi ngay trên trang bằng chứng và trong lời dẫn.

## Thiết kế

Theo [DESIGN-ferrari.md](../../../frontend/DESIGN-ferrari.md): nền `#181818`, điểm nhấn Rosso Corsa `#da291c`, chữ trắng, hairline `#303030`, cạnh vuông, ít thành phần và khoảng thở rộng. Mở đầu/trang video dùng ảnh mô phỏng thực tế của dự án.

FerrariSans là font có giấy phép riêng; dùng Inter 500 cho display, 400 cho body và 700 cho nhãn theo phương án thay thế được ghi trong guide. Các instance TTF được đặt tên nội bộ riêng để PDF nhúng đúng từng độ đậm. Không dùng biểu tượng Ferrari hoặc ngụ ý liên kết với Ferrari. Font kèm [OFL](assets/OFL-Inter.txt).

## Video demo

PDF là bản tĩnh, **không nhúng và không tự phát video**. Trang 7 là cue chuyển sang video đã mở sẵn. Người dùng chưa chỉ định file video cuối cùng; cần chọn và thử trước khi trình bày. Các ảnh CARLA trong slide là khung hình từ clip local sẵn có, không phải video demo mới do bộ slide tạo ra.

Khung thời gian 45 giây bao gồm chuyển cửa sổ và phát video. Nếu clip dài hơn, cần chọn đoạn hoặc chỉnh lời dẫn; 300 giây là kế hoạch, không thay thế tập trình bày có bấm giờ.

## Dựng lại PDF

Dùng môi trường Python riêng cho công cụ tài liệu; không cần cài các dependency này vào runtime của ứng dụng:

```sh
python3 -m venv /tmp/topeye-presentation-tools
/tmp/topeye-presentation-tools/bin/python -m pip install -r docs/submission/presentation/requirements.txt
/tmp/topeye-presentation-tools/bin/python docs/submission/presentation/build_deck.py
```

TTF, logo, ảnh và nội dung đều có trong thư mục này. Script không gọi mạng, không chạy CARLA, không thay dữ liệu nguồn hoặc logic sản phẩm. Muốn sửa lời dẫn/thời lượng, chỉnh `pitch-content.json`; sửa nội dung/bố cục slide trong `build_deck.py` rồi dựng lại.

Khi dựng lại, giữ tổng `seconds=300` và các kiểm tra PDF đạt. Số liệu slide 8 đọc từ hồ sơ kiểm thử `../evidence/verification-summary.json`; nếu thay hồ sơ, cần kiểm lại lời dẫn và chú thích nguồn.
