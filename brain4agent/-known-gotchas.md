# Known Gotchas & Bugs

Tổng hợp các lỗi khó, các lưu ý dị biệt hoặc cách workaround đặc thù của dự án này để AI không dẫm lại vết xe đổ.

## Môi trường & Config
- **Gemini CLI (`gemini` v0.62.0) không dùng được** (2026-10-03):
  - Lỗi: `IneligibleTierError: UNSUPPORTED_CLIENT`, vì tài khoản free-tier Code Assist không còn được hỗ trợ.
  - Cách xử lý: gọi Gemini qua Antigravity CLI, `agy --mode plan -p "<prompt>"` (chế độ plan là chỉ đọc).
- **Codex CLI:** gọi không tương tác bằng `codex exec --sandbox read-only --skip-git-repo-check "<prompt>" < /dev/null`. Output bị lặp 2 lần vì hook in thêm, nên chỉ cần đọc phần sau dòng `codex`.

## Miền kỹ thuật (từ REVIEW.md — cần kiểm chứng trên dữ liệu thật)
- **CVAT 3D:** không dùng calibration và không chiếu cuboid lên ảnh (issue #6417, #4810, năm 2022–2023). Yaw có thể bị nhập nhằng 180°. Cần kiểm tra lại trên bản CVAT đang chạy.
- **Đồng bộ thời gian:** lệch khoảng 20 ms ở tốc độ 15 m/s đã gây trượt khoảng 30 cm. Rolling shutter không sửa được bằng một pose cho mỗi camera. Deskew chỉ bù chuyển động của ego, không bù chuyển động riêng của vật thể.
- **Mask vật thể:** segmentation không biết vật đang chạy hay đứng yên. Khi làm road mosaic nên mask cả vật đứng yên và chấp nhận có lỗ.
- **Z-buffer với LiDAR thưa:** không loại hết điểm bị che, nên điểm phía sau vẫn có thể nhận màu của vật phía trước.
- **Khẳng định chưa kiểm chứng (từ Gemini):**
  - SAM 2 đạt "hàng chục FPS" trên 8 camera.
  - Tên gọi "Waymo Auto4D".
  - Xtreme1 hỗ trợ lớp ảnh nền top view.

## Hạ tầng (2026-10-03)
- Máy dev là **Mac M3 Pro, không có NVIDIA**. CVAT là fork v2.74.1 tự host (`~/cvat-day2`), quy ước CẤM sửa core CVAT. Hệ quả:
  - BEVFusion (cần CUDA ops/spconv), RoMe và 3DGS khó chạy local, cần GPU thuê ngoài.
  - CenterPoint-Pillar đang chạy CPU trong `.venv-lidar3d`.
- nuScenes chỉ có **6 camera** (không phải 8), PCD đã xuất chỉ có `x y z intensity` (chưa có RGB).
- `nuscenes-devkit` 1.1.11 ép `matplotlib<3.6` + `numpy<2` → topeye đọc JSON nuScenes trực tiếp, không dùng devkit.
- Orca `worker-start --agent codex` fail `agent-update-prompt` khi Codex CLI có bản mới → cập nhật Codex (brew cask) rồi `worker-start --task <id> --retry-of <dispatch>`.
- Mock frontend che lỗi contract (box mock có id, API thật không) → mỗi đợt PHẢI ghép thử qua Vite proxy với backend thật trước khi duyệt. Vite dev bind `localhost` (IPv6), curl `127.0.0.1:5173` sẽ ra 000.
- Màn hình trắng (2026-10-03): meta `bev: null` làm `TopView` đọc `size_px` của null, exception gỡ cả cây React. Đã sửa: meta luôn chứa lưới BEV (cache v3). Còn thiếu: frontend chưa có error boundary theo từng pane, nên một pane lỗi vẫn làm trắng cả trang.
- Top view (WP4c): LiDAR 32 tia thưa làm thủng depth buffer; đã lấp theo cột (|Δd|<1 m) và giới hạn camera 25 m. Còn phủ thấp ở frame cuối scene và vùng giao lộ. Muốn tốt hơn phải dùng RoMe/3DGS (Phase 3, cần GPU). Chỉ số `streak_pct` vô nghĩa sau khi chỉ tô ô có mặt đất thật. `ego-browser task.finish()` có thể treo, nên chạy riêng, đừng nối lệnh khác phía sau.
- Ego Lite (ego-browser) có lúc ghìm WebGL/rAF còn ~3 fps, kể cả với canvas tối giản trên about:blank, và `page.screenshot` của trang WebGL bị quá thời gian. Trước khi kết luận app bị hồi quy hiệu năng, PHẢI đo một canvas WebGL tối giản để đối chứng.
- Feed-forward 3DGS (DrivingForward, STORM) chạy được trên MPS khoảng 1,8 s/frame. Nhưng output của một frame, khi nhìn từ trên xuống, ra hình nan quạt vì sai số độ sâu nằm dọc tia nhìn: các model này làm novel view GẦN xe, không phải bird view. STORM bị loại vì license NVIDIA phi thương mại. Đối chứng âm phải TỆ HƠN kết quả thật; nếu không thì phép đo vô nghĩa.

## Real-to-sim / Blender (2026-10-06, kế hoạch 02)
- **Blender 5.2, EEVEE:**
  - Volume gắn vào World cho ảnh **đen toàn bộ**. Sương phải dựng bằng một khối mesh có material `Volume Scatter`.
  - `ShaderNodePrincipledVolume` không tồn tại trong 5.2.
  - Exception không bắt trong script `-P` vẫn để Blender **thoát mã 0**, nên `main()` phải bắt mọi lỗi rồi gọi `sys.exit(code)`.
- **Patchwork++ xếp trần cầu vượt và mái che vào mặt đất** ở một số sweep. Heightfield gộp sẽ có gai cao 49 m chắn camera (scene-0061, CAM_BACK). Cách xử lý: chỉ giữ điểm mặt đất có z_lidar trong [−4, −1] m và cách xe ≤ 40 m.
- **Vạch sơn từ intensity LiDAR:** nếu chuẩn hoá theo p50..p99 toàn scene, các mảng bê tông sáng ngoài đường bị coi là vạch. Phải dùng độ tương phản cục bộ (cửa sổ 3 m) và cắt theo vùng đi được.
- **Raster `semantic_prior` của nuScenes:** hàng 0 ứng với y global lớn nhất (`row = (H·0,1 − gy)/0,1`). Kiểm bằng quỹ đạo ego: tỷ lệ nằm trên vùng đi được phải ≥ 0,9 (scene-0061 đạt 1,0). Test phải dùng dải đường **lệch tâm**; dải nằm đối xứng quanh tâm ảnh thì lật trục cũng không phát hiện được.
- **Label trong sương:** ray-cast không thấy sương, nên phải nhân thêm độ truyền qua `exp(−density·d) ≥ 0,2`. Nếu không, YOLO sẽ học nhận vật mà mắt người không thấy.
- Trên M3 Pro, EEVEE render 0,2–0,6 s/ảnh 1600×900 và LiDAR 32×1080 tia (BVHTree) chạy khoảng 0,2 s/frame. Layout scene-0061 mất khoảng 9 s.
- **mpsplat (gsplat trên Metal) v0.1.0** (2026-10-06):
  - `packed=True` báo NotImplementedError.
  - `render_mode` nhiều kênh (`RGB+ED`, `RGB+D`) chậm khoảng 35 lần (3,8 s so với 0,1 s mỗi bước).
  - Cách vòng: render depth bằng lượt 3 kênh riêng với màu = z camera, chia cho alpha; kết quả giống hệt.
  - Cài bằng uv vào venv riêng `backend/.tools/mpsplat/.venv` (Python 3.13, torch 2.14).
- **mpsplat:** projection backward tính 1/z³ cho điểm nằm sau camera, sinh NaN và làm sập toàn bộ Gaussian (render ra ảnh xám phẳng). Phải đặt opacity = 0 và gán hình học an toàn cho z < near trước khi gọi kernel.
- **open3d 0.20:**
  - Poisson đa luồng bị lỗi "Failed to close loop" (lỗi race). Dùng `n_threads=1`.
  - Wheel cần `brew install libusb`.
- **PyTorch MPS:** gradient của `avg_pool2d` có overlap sai dấu. SSIM phải dùng `conv2d`.
