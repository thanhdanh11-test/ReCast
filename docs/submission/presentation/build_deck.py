"""Build the static, Vietnamese 5-minute Recast PDF pitch. No product/runtime changes.

Dependencies: reportlab, pillow, pymupdf. Static Inter TTF files are bundled with OFL.
Run from any cwd: python /path/to/docs/submission/presentation/build_deck.py
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pymupdf as fitz
from PIL import Image
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

BASE = Path(__file__).resolve().parent
ASSETS = BASE / "assets"
EVIDENCE = BASE / "evidence"
PREVIEWS = BASE / "previews"
W, H = 960, 540
BG, WHITE, BODY, LINE, RED = map(HexColor, ["#181818", "#ffffff", "#969696", "#303030", "#da291c"])
CONTENT = json.loads((BASE / "pitch-content.json").read_text())
VERIFY = json.loads((BASE.parent / "evidence/verification-summary.json").read_text())
TEXT_BOXES: list[dict] = []

for weight in (400, 500, 700):
    pdfmetrics.registerFont(TTFont(f"Inter{weight}", str(ASSETS / f"Inter-{weight}.ttf")))


def text(c, x, y, value, size=20, color=WHITE, weight=400, width=None, tracking=0):
    """Coordinates from top-left. Keep display regular/medium, captions may be bold."""
    font = f"Inter{weight}"
    measured = pdfmetrics.stringWidth(value, font, size) + max(0, len(value) - 1) * tracking
    if width is not None:
        assert measured <= width + 0.1, (c.getPageNumber(), value, measured, width)
    assert x >= 0 and x + measured <= W + 0.1 and y >= 0 and y + size <= H, value
    c.setFillColor(color)
    obj = c.beginText(x, H - y - size)
    obj.setFont(font, size)
    if tracking:
        obj.setCharSpace(tracking)
    obj.textOut(value)
    c.drawText(obj)
    TEXT_BOXES.append({"page": c.getPageNumber(), "text": value, "x": x, "y": y, "width": measured, "font_size": size})


def lines(c, x, y, values, size=44, leading=None, width=864, color=WHITE):
    for i, value in enumerate(values):
        text(c, x, y + i * (leading or size * 1.12), value, size, color, 500, width)


def rect(c, x, y, w, h, color):
    c.setFillColor(color)
    c.rect(x, H - y - h, w, h, stroke=0, fill=1)


def rule(c, x, y, w, color=LINE, thickness=0.7):
    c.setStrokeColor(color)
    c.setLineWidth(thickness)
    c.line(x, H - y, x + w, H - y)


def photo(c, name, x, y, w, h):
    im = Image.open(ASSETS / name)
    iw, ih = im.size
    scale = max(w / iw, h / ih)
    c.saveState()
    path = c.beginPath()
    path.rect(x, H - y - h, w, h)
    c.clipPath(path, stroke=0, fill=0)
    c.drawImage(ImageReader(im), x + (w - iw * scale) / 2, H - y - h + (h - ih * scale) / 2,
                width=iw * scale, height=ih * scale, mask="auto")
    c.restoreState()


def shade(c, alpha):
    c.saveState()
    c.setFillColor(BG)
    c.setFillAlpha(alpha)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.restoreState()


def header(c, section, photographic=False):
    if not photographic:
        rect(c, 0, 0, W, H, BG)
    c.drawImage(str(ASSETS / "topeye-logo.png"), 48, H - 47, width=24, height=24, preserveAspectRatio=True, mask="auto")
    text(c, 83, 25, "TOPEYE", 12, WHITE, 700, tracking=1.3)
    text(c, 690, 27, section, 9, WHITE if photographic else BODY, 700, width=222, tracking=1)


def footer(c, number, caption="KỊCH BẢN GIAO THÔNG · TẠO / PHÁT LẠI / ĐÁNH GIÁ", photographic=False):
    rule(c, 48, 503, 864, WHITE if photographic else LINE, 0.4)
    text(c, 48, 514, caption, 8, WHITE if photographic else BODY, width=790, tracking=0.3)
    text(c, 878, 512, f"{number:02d} / 09", 9, WHITE if photographic else BODY)


def arrow(c, x1, y, x2, color=BODY):
    c.setStrokeColor(color)
    c.setLineWidth(1.2)
    c.line(x1, H - y, x2, H - y)
    c.line(x2 - 7, H - y + 4, x2, H - y)
    c.line(x2 - 7, H - y - 4, x2, H - y)


def car(c, x, y, color=RED):
    rect(c, x, y, 62, 30, color)
    rect(c, x + 17, y + 4, 25, 22, BG)
    rect(c, x + 3, y - 3, 13, 3, WHITE)
    rect(c, x + 45, y - 3, 13, 3, WHITE)
    rect(c, x + 3, y + 30, 13, 3, WHITE)
    rect(c, x + 45, y + 30, 13, 3, WHITE)


def road(c, x, y, w):
    rect(c, x, y, w, 120, LINE)
    c.setStrokeColor(BODY)
    c.setLineWidth(0.8)
    c.setDash(9, 10)
    c.line(x, H - y - 60, x + w, H - y - 60)
    c.setDash()


def build():
    EVIDENCE.mkdir(exist_ok=True)
    PREVIEWS.mkdir(exist_ok=True)
    assert len(CONTENT["slides"]) == 9
    assert sum(s["seconds"] for s in CONTENT["slides"]) == 300
    out = BASE / "topeye-pitch-5min.pdf"
    c = canvas.Canvas(str(out), pagesize=(W, H), pageCompression=1)
    c.setTitle("Recast — Chủ động tạo kịch bản hiếm | Pitch 5 phút")
    c.setAuthor("Recast")
    c.setSubject("Bộ slide tiếng Việt cho ban giám khảo; 5 phút gồm 45 giây video phát riêng")

    # 01 — Cinema opening, real project footage rather than invented product imagery.
    photo(c, "child-crossing.jpg", 0, 0, W, H)
    shade(c, 0.61)
    header(c, "SCENARIO STUDIO", True)
    rect(c, 48, 128, 48, 3, RED)
    lines(c, 48, 164, ["Đi nhiều.", "Vẫn thiếu ca hiếm."], 64, 70)
    text(c, 48, 352, "Chủ động tạo kịch bản giao thông để kiểm thử.", 22, WHITE, width=864)
    footer(c, 1, "ẢNH TỪ VIDEO MÔ PHỎNG CARLA CỦA DỰ ÁN", True)
    c.showPage()

    # 02 — No invented collection rates or market-size statistics.
    header(c, "01 / BÀI TOÁN")
    lines(c, 48, 91, ["Thu thập nhiều dữ liệu,", "vẫn có thể thiếu ca hiếm."], 44, 52)
    text(c, 48, 248, "Nhiều dữ liệu", 31, WHITE, 500)
    text(c, 435, 237, "≠", 48, RED, 500)
    text(c, 553, 248, "Đủ tình huống", 31, WHITE, 500)
    rule(c, 48, 320, 864)
    for x, title, body in [
        (48, "Ít gặp", ["Thiếu đúng ca hiếm", "cần kiểm thử."]),
        (350, "Khó chủ động", ["Không chọn được lúc", "tình huống xảy ra."]),
        (652, "Khó lặp lại", ["Khó gặp lại đúng vận tốc", "và khoảng cách mong muốn."]),
    ]:
        text(c, x, 345, title, 23, WHITE, 500, width=260)
        for j, s in enumerate(body):
            text(c, x, 389 + j * 26, s, 16, BODY, width=260)
    footer(c, 2)
    c.showPage()

    # 03 — Native vector illustrations, explicitly conceptual, not measured plots.
    header(c, "02 / HAI TÌNH HUỐNG")
    lines(c, 48, 91, ["Hai ca hiếm.", "Nhiều biến thể để kiểm thử."], 44, 52)
    road(c, 48, 252, 408)
    road(c, 504, 252, 408)
    car(c, 85, 322)
    car(c, 300, 263, BODY)
    arrow(c, 162, 337, 251)
    c.setFillColor(WHITE)
    c.circle(317, H - 320, 6, stroke=0, fill=1)
    c.setStrokeColor(WHITE)
    c.setLineWidth(2)
    c.line(317, H - 328, 317, H - 344)
    c.line(309, H - 334, 325, H - 334)
    c.line(317, H - 344, 310, H - 353)
    c.line(317, H - 344, 324, H - 353)
    text(c, 270, 226, "VÙNG CHE KHUẤT", 10, BODY, 700, width=186)
    car(c, 543, 300)
    car(c, 782, 300, BODY)
    arrow(c, 625, 315, 742)
    rect(c, 769, 300, 3, 30, RED)
    rect(c, 761, 300, 3, 30, RED)
    text(c, 770, 273, "PHANH", 10, WHITE, 700)
    text(c, 48, 398, "Trẻ em lao ra từ sau xe đỗ", 21, WHITE, 500, width=408)
    text(c, 504, 398, "Xe phía trước phanh gấp", 21, WHITE, 500, width=408)
    text(c, 48, 447, "Thay thời điểm, vận tốc và khoảng cách để kiểm thử lại.", 18, BODY, width=864)
    footer(c, 3, "SƠ ĐỒ MINH HỌA TÌNH HUỐNG · KHÔNG PHẢI SỐ ĐO QUỸ ĐẠO")
    c.showPage()

    # 04 — Reusable pipeline, not a claim of autonomous scenario generation by AI.
    header(c, "03 / GIẢI PHÁP")
    lines(c, 48, 91, ["Từ cảnh đã có,", "đến tình huống cần kiểm thử."], 44, 52)
    rule(c, 48, 242, 864)
    steps = [
        (48, "01", "Đọc cảnh", ["Dữ liệu nguồn", "và quỹ đạo."]),
        (272, "02", "Thiết kế", ["Chọn tình huống", "và tham số."]),
        (496, "03", "Phát lại", ["Tạo quỹ đạo,", "xuất kịch bản."]),
        (720, "04", "Đánh giá", ["Đọc chỉ số và", "lý do kiểm định."]),
    ]
    for x, n, title, body in steps:
        text(c, x, 271, n, 23, RED, 500)
        text(c, x, 315, title, 26, WHITE, 500, width=192)
        for j, s in enumerate(body):
            text(c, x, 361 + j * 24, s, 17, BODY, width=192)
    text(c, 48, 445, "Tận dụng cảnh đã có. Chủ động thêm bài kiểm thử.", 21, WHITE, width=864)
    footer(c, 4)
    c.showPage()

    # 05 — Real UI image. Its invalid verdict is disclosed, never painted green.
    header(c, "04 / SẢN PHẨM")
    lines(c, 48, 105, ["Một nơi", "để tạo, so sánh", "và kiểm tra."], 36, 43, width=320)
    for y, n, title in [(298, "01", "Chọn cảnh"), (344, "02", "Thiết kế tình huống"), (390, "03", "So sánh và phân tích")]:
        text(c, 48, y, n, 12, RED, 700)
        text(c, 82, y - 3, title, 18, WHITE, width=275)
    photo(c, "studio.png", 390, 124, 522, 370)
    footer(c, 5, "ẢNH GIAO DIỆN THẬT 18/10/2026 · CA MINH HỌA CÓ CẢNH BÁO KIỂM ĐỊNH")
    c.showPage()

    # 06 — Quality is a separate axis from successful creation.
    header(c, "05 / GIÁ TRỊ KIỂM THỬ")
    lines(c, 48, 91, ["Tạo được chưa có nghĩa", "là đã đạt kiểm định."], 44, 52)
    rule(c, 48, 244, 864)
    text(c, 48, 276, "CÙNG MỘT TÌNH HUỐNG", 10, BODY, 700, tracking=1)
    text(c, 48, 314, "Baseline", 32, WHITE, 500)
    text(c, 48, 358, "Không có phản ứng", 18, BODY)
    text(c, 290, 314, "Pilot", 32, WHITE, 500)
    text(c, 290, 358, "Có phản ứng", 18, BODY)
    rule(c, 48, 415, 428)
    text(c, 48, 440, "So sánh diễn biến, không chỉ xem hoạt ảnh.", 16, WHITE, width=428)
    for y, s in [(281, "Khoảng cách / TTC"), (334, "Mức phanh / va chạm"), (387, "Lý do chưa đạt")]:
        rect(c, 570, y + 8, 5, 5, RED)
        text(c, 594, y, s, 22, WHITE, 500, width=318)
        rule(c, 594, y + 40, 318)
    footer(c, 6, "KIỂM TRA ESMINI LÀ BƯỚC RIÊNG · KHÔNG CHỨNG NHẬN AN TOÀN NGOÀI ĐỜI")
    c.showPage()

    # 07 — Video cue only. Static PDF deliberately has no broken attachment/link.
    photo(c, "driver-view.jpg", 0, 0, W, H)
    shade(c, 0.64)
    header(c, "06 / VIDEO DEMO", True)
    lines(c, 48, 114, ["Xem Recast", "trong một tình huống."], 46, 55)
    c.setStrokeColor(WHITE)
    c.setLineWidth(1.5)
    c.circle(785, H - 302, 48, stroke=1, fill=0)
    c.setFillColor(WHITE)
    p = c.beginPath()
    p.moveTo(774, H - 281)
    p.lineTo(774, H - 323)
    p.lineTo(807, H - 302)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    rect(c, 48, 370, 102, 36, RED)
    text(c, 65, 378, "45 GIÂY", 14, WHITE, 700)
    text(c, 48, 430, "Phát video demo riêng khi trình bày.", 20, WHITE, width=864)
    footer(c, 7, "KHUNG HÌNH TỪ VIDEO CARLA LOCAL · PDF KHÔNG TỰ PHÁT VIDEO", True)
    c.showPage()

    # 08 — Values loaded from the measured evidence, not pitch estimates.
    total = sum(VERIFY["gates"][k]["passed"] for k in ("backend", "frontend", "server"))
    engine = VERIFY["gates"]["engine_acceptance"]
    header(c, "07 / TÍNH KHẢ THI")
    lines(c, 48, 91, ["Đã có sản phẩm.", "Đã có bằng chứng chạy thật."], 44, 52)
    text(c, 48, 244, f"{engine['valid']}/{engine['generated']}", 82, RED, 500)
    text(c, 504, 244, f"{total:,}".replace(",", "."), 82, WHITE, 500)
    text(c, 48, 350, "ca nghiệm thu phát lại esmini", 20, WHITE, width=408)
    text(c, 504, 350, "test tự động đạt", 20, WHITE, width=408)
    text(c, 48, 410, "MVP chạy local · Luồng esmini không cần GPU · CARLA tùy chọn", 16, BODY, width=864)
    text(c, 48, 453, "4/4 trên một đoạn được chọn; không đại diện mọi cảnh hoặc an toàn ngoài đời.", 10, BODY, width=864)
    footer(c, 8, "NGUỒN: HỒ SƠ KIỂM THỬ 18/10/2026 · 842 BACKEND + 578 FRONTEND + 67 SERVER")
    c.showPage()

    # 09 — Roadmap clearly future tense, no unsupported savings/market/AI claims.
    header(c, "08 / HƯỚNG PHÁT TRIỂN")
    lines(c, 48, 105, ["Đừng chờ ca hiếm.", "Hãy chủ động kiểm thử."], 54, 64)
    rect(c, 48, 274, 72, 3, RED)
    text(c, 48, 322, "TIẾP THEO", 10, BODY, 700, tracking=1.2)
    for x, a, b in [(48, "Mở rộng", "thư viện ca hiếm"), (350, "Cải thiện", "trải nghiệm chia sẻ"), (652, "Tăng tương tác", "của mô phỏng")]:
        text(c, x, 365, a, 23, WHITE, 500, width=260)
        text(c, x, 401, b, 19, BODY, width=260)
    footer(c, 9, "TOPEYE · TỪ CẢNH ĐÃ CÓ ĐẾN NHỮNG TÌNH HUỐNG CẦN KIỂM THỬ")
    c.showPage()
    c.save()

    # Presenter script and exact timing are generated from the same content source.
    notes = ["# Recast — Lời dẫn thuyết trình 5 phút", "", "> 9 trang · 300 giây tổng cộng · 45 giây dành cho video phát riêng.", "", "Đây là kịch bản tham chiếu. Cần tập đọc, bấm giờ và thử video trước khi trình bày. Không đọc cả chú thích nguồn trên slide.", "", "| Trang | Thời gian | Nội dung |", "| --- | --- | --- |"]
    elapsed = 0
    for s in CONTENT["slides"]:
        end = elapsed + s["seconds"]
        stamp = lambda n: f"{n // 60:02d}:{n % 60:02d}"
        notes.append(f"| {s['id']} | {stamp(elapsed)}–{stamp(end)} ({s['seconds']} s) | {s['title']} |")
        elapsed = end
    for s in CONTENT["slides"]:
        notes.extend(["", f"## Trang {s['id']} — {s['seconds']} giây", "", s.get("script") or s["presenter_instruction"]])
    notes.extend(["", "## Chuẩn bị video", "", "- PDF là bản tĩnh; mở sẵn video bằng trình phát riêng và thử chuyển cửa sổ trước.", "- Trang 7 dành tối đa 45 giây, đã nằm trong tổng 5 phút, không cộng thêm sau bài nói.", "- Video cuối chưa được người dùng chỉ định. Có hai clip CARLA local đã thấy: `tre_em_lao_ra.mp4` (12,05 s) và `car154_trong_xe.mp4` (19,15 s). Chưa xác minh clip thứ hai là bản demo phanh gấp mà người trình bày muốn dùng; cần xem và chọn trước buổi trình bày.", "- Nếu video dài hơn 45 giây, cắt/chọn đoạn hoặc điều chỉnh lời dẫn; không hứa bài vẫn đủ 5 phút khi chưa tập.", "", "## Nguồn và giới hạn", "", "- Số đo: `../evidence/verification-summary.json`, thực hiện 18/10/2026; 4/4 là acceptance trên đoạn được chọn, không phải tỷ lệ mọi kịch bản.", "- Ảnh giao diện lấy từ bằng chứng 0.43.1; ảnh CARLA là khung hình từ clip local đã có.", "- Hai sơ đồ tình huống ở trang 3 là minh họa vector, không phải quỹ đạo đo được.", "- Không công bố tiết kiệm chi phí, tăng độ an toàn hoặc hiệu quả train khi chưa đo.", "- Hệ thống dùng quỹ đạo tính sẵn; closed-loop và Live URL công khai chưa được nghiệm thu trong bộ slide này.", "- Thiết kế theo `frontend/DESIGN-ferrari.md`: #181818, #da291c, chữ trắng, nét mảnh, cạnh vuông; Inter 500/400 thay FerrariSans theo guide. Không dùng biểu tượng Ferrari."])
    (BASE / "speaker-notes.md").write_text("\n".join(notes) + "\n")

    # Actual PDF checks: Unicode text, embedded fonts, page count and page boundaries.
    doc = fitz.open(out)
    assert len(doc) == 9
    overflow = []
    missing_fonts = []
    embedded_faces = set()
    extracted = []
    thumbs = []
    for i, page in enumerate(doc):
        page_text = page.get_text()
        extracted.append(page_text)
        assert "TOPEYE" in page_text
        for block in page.get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            for row in block["lines"]:
                for span in row["spans"]:
                    x0, y0, x1, y1 = span["bbox"]
                    if x0 < -0.5 or y0 < -0.5 or x1 > W + 0.5 or y1 > H + 0.5:
                        overflow.append({"page": i + 1, "text": span["text"], "bbox": span["bbox"]})
        for font in page.get_fonts(full=True):
            if font[3].startswith("Helvetica"):
                continue  # unused default ReportLab resource
            embedded_faces.add(font[3].split("+")[-1])
            if not doc.extract_font(font[0])[3]:
                missing_fonts.append(font[3])
        pix = page.get_pixmap(matrix=fitz.Matrix(1.25, 1.25), alpha=False)
        pix.save(PREVIEWS / f"slide-{i + 1:02d}.png")
        thumb = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        thumb.thumbnail((480, 270))
        thumbs.append(thumb)
    assert not overflow, overflow
    assert not missing_fonts, missing_fonts
    assert {"TopeyeDeckSans-Regular", "TopeyeDeckSans-Medium", "TopeyeDeckSans-Bold"} <= embedded_faces
    assert "Trẻ em lao ra từ sau xe đỗ" in extracted[2]
    assert "Xe phía trước phanh gấp" in extracted[2]
    assert "1.487" in extracted[7]
    assert "4/4" in extracted[7]
    assert "�" not in "".join(extracted)
    sheet = Image.new("RGB", (1440, 810), "#303030")
    for i, thumb in enumerate(thumbs):
        sheet.paste(thumb, ((i % 3) * 480, (i // 3) * 270))
    sheet.save(PREVIEWS / "contact-sheet.jpg", quality=94)
    result = {"pdf": out.name, "sha256": hashlib.sha256(out.read_bytes()).hexdigest(), "pages": len(doc), "page_size_pt": [W, H], "aspect_ratio": "16:9", "talk_seconds": 300, "video_seconds_included": 45, "text_overflows": overflow, "nonembedded_fonts": missing_fonts, "embedded_faces": sorted(embedded_faces), "unicode_extraction_passed": True, "evidence_total_tests": total, "engine_cases": f"{engine['valid']}/{engine['generated']}", "pdf_video_embedded": False, "speaker_script_units": sum(len(s["script"].split()) for s in CONTENT["slides"]), "font": "Inter static 400/500/700, embedded subsets", "product_logic_changed": False}
    (EVIDENCE / "pdf-validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    build()
