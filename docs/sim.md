# `topeye.sim` — Real-to-Sim bằng Blender

Module dựng môi trường 3D "digital cousin" từ một scene thật rồi sinh dữ liệu train (ảnh, LiDAR, label). Đặc tả gốc: [kế hoạch 02](../planning/02_2026-10-05_blender-real2sim/plan.md). Contract chi tiết ở [01-CONTRACTS](../planning/02_2026-10-05_blender-real2sim/specs/01-CONTRACTS.md). File này là bản tra cứu vận hành.

## 1. Chạy
```bash
cd backend
.venv/bin/topeye-sim-layout --scene scene-0061            # ~9 s
.venv/bin/topeye-sim-render --scene scene-0061 --selftest # camera Blender khớp OpenCV
.venv/bin/topeye-sim-render --scene scene-0061 \
    --scenario topeye/sim/blender/scenarios/night.toml    # render + LiDAR + label
.venv/bin/python scripts/sim_evidence.py --scene scene-0061 --run night
```
- Đường dẫn Blender lấy theo thứ tự: biến môi trường `TOPEYE_BLENDER` → `blender_bin` trong `config.toml` → `/Applications/Blender.app/Contents/MacOS/Blender`.
- `topeye-sim-render` luôn chạy selftest trước khi render. Selftest hỏng thì dừng.
- **Xem map 3D trên web:** chạy `.venv/bin/topeye-sim-view --scene scene-0061`. Lệnh mở `http://127.0.0.1:8770/?scene=scene-0061` (three.js), xem được mặt đường + vạch sơn, voxel, xe/người theo frame, quỹ đạo ego và LiDAR mô phỏng của từng run.
  - Server chỉ bind `127.0.0.1` và chỉ phục vụ `backend/data/sim/` cùng trang viewer; không liệt kê thư mục.
  - Trang tải three.js từ CDN jsdelivr, nên cần có mạng.
  - Cổng bận thì CLI thoát mã 3; truyền `--port` để đổi cổng.

## 2. Tham số CLI
| Lệnh | Tham số | Ý nghĩa |
|---|---|---|
| `topeye-sim-layout` | `--scene` (bắt buộc), `--frames i j …`, `--config` | Chỉ lấy các keyframe đã chọn để dựng map tĩnh và camera; mặt đất vẫn gộp mọi sweep |
| `topeye-sim-render` | `--scene`, `--scenario F.toml` hoặc `--selftest`, `--save-blend F.blend`, `--config` | `--save-blend` lưu cảnh để mở bằng Blender GUI khi debug |
| `topeye-sim-view` | `--scene`, `--port` (8770), `--no-browser`, `--config` | Web viewer three.js trên localhost |

Mã thoát: 0 = ok · 1 = một phần lỗi, hoặc layout check trượt (`ego_on_drivable < 0.9`) · 2 = input sai · 3 = không chạy được Blender.

## 3. Scenario (`.toml`)
| Khoá | Miền | Ghi chú |
|---|---|---|
| `name` | `[a-z0-9_-]+` | Thành tên thư mục `runs/<name>` (bị ghi đè mỗi lần chạy) |
| `seed` | int | Màu xe, nhiễu LiDAR |
| `engine` / `samples` | `eevee` hoặc `cycles` / 1–4096 | EEVEE 0,2–0,6 s/ảnh trên M3 Pro |
| `frames` / `cameras` | list, `[]` = tất cả | |
| `resolution_scale` | (0, 1] | |
| `weather.preset` | `day`, `night`, `rain`, `fog` | |
| `weather.fog_density` | 0–0.1 m⁻¹ | Vật có `exp(−density·d) < 0.2` bị bỏ label |
| `weather.wetness` | 0–1 | Mặt đường bóng và tối hơn; intensity LiDAR giảm |
| `weather.paint_fade` | 0–1 | Vạch mờ trên cả ảnh lẫn intensity LiDAR |
| `weather.rain_drop_rate` | 0–1 | Tỷ lệ tia LiDAR mất thêm |
| `traffic.mode` | `replay` | POC chỉ phát lại track GT |
| `traffic.color_randomization` | bool | |

## 4. Thuật toán chính
- **Map tĩnh** (`static_map.py`):
  - Dùng **mọi sweep**, với box nội suy giữa hai keyframe; bỏ điểm trong box (nới 0,4 m), điểm mặt đất và thân xe ego.
  - Tô màu bằng `colorize` có nhân gain camera.
  - Voxel 0,2 m, chỉ giữ voxel thấy ở ≥ 3 sweep; màu là trung vị.
- **Mặt đất:**
  - Điểm Patchwork++ của mọi sweep, giữ z_lidar trong [−4, −1] m và cách xe ≤ 40 m.
  - Lưới 0,5 m (`ground_surface.py`): trung vị, loại ô lệch > 0,3 m, nội suy tuyến tính kín toàn bộ vùng đi được (ngoài vùng đó chỉ lấp ≤ 3 m), làm mượt Gauss.
- **Vạch sơn:** phân vị 0,9 của intensity theo ô 0,1 m, trừ trung bình cửa sổ 3 m, chỉ giữ trong vùng đi được (raster `semantic_prior` nuScenes).
- **Actor:** xe, người, xe hai bánh, rào và nón dựng low-poly đúng kích thước box. Màu ngẫu nhiên theo seed và track. Đèn emission bật ở preset night.
- **Visibility và LiDAR:** BVHTree riêng cho ground, static và actor. LiDAR bắn 32 × 1080 tia (−30,67° đến 10,67°), sau đó mô hình mất tia và nhiễu theo sương/mưa.

## 5. Số đo POC (scene-0061, frame 0, 2026-10-06)
- Selftest camera lệch tối đa 0,00027 px.
- LiDAR ngày: Chamfer sim→thật trung vị 0,242 m, tỷ lệ điểm 1,17. Sương: tỷ lệ điểm 0,59.
- Label 2D: ngày 44 box, sương 33 box.

## 6. Giới hạn đã biết
- Vật tĩnh trông như khối voxel.
- Mưa chưa có vệt mưa.
- Chỉ phát lại giao thông thật (`replay`).
- Pixel camera phải vuông, không méo ống kính.
- Mô hình mưa/sương cho LiDAR chỉ là xấp xỉ thống kê.
- Gotchas Blender: xem [`brain4agent/-known-gotchas.md`](../brain4agent/-known-gotchas.md).
