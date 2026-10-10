> Historical pipeline: generated scene/model/render artifacts and auxiliary tool environments were moved to macOS Trash by explicit user cleanup on2026-10-09. Viewer ports8770–8775 are stopped. Source and regression-required assets/fixtures remain. Recovery manifest: planning/04_2026-10-09_scenario-desktop/evidence/local/cleanup-manifest.json.

# `topeye.sim` — Real-to-Sim bằng Blender

Module dựng môi trường 3D "digital cousin" từ một scene thật rồi sinh dữ liệu train (ảnh, LiDAR, label). Đặc tả gốc: [kế hoạch 02](../planning/02_2026-10-05_blender-real2sim/plan.md). Contract chi tiết ở [01-CONTRACTS](../planning/02_2026-10-05_blender-real2sim/specs/01-CONTRACTS.md). File này là bản tra cứu vận hành.

## Thử nghiệm StreetGS 30k — 2026-10-08

Job Kaggle `danhtong/topeye-streetgs-scene0061` đã COMPLETE; checkpoint xác nhận `step=30000`. PSNR/SSIM/LPIPS test = 23,0809 / 0,68884 / 0,27519 (bản 5k: 21,5911 / 0,69434 / 0,32386; cấu hình độ phân giải khác nhau nên không phải phép đo riêng tác động số bước).

- Viewer riêng: `http://127.0.0.1:8772/30k/`, splat nền 1.010.984 Gaussian, 250.725.564 byte; bản 5k vẫn ở `/`.
- Artifact: `backend/data/sim/scene-0061/streetgs/30k/`, gồm `background.ply`, `rgbd/*.npz`, `export.json`, `lowpoly.ply`, `lowpoly.glb`, `mesh.json`, ảnh `compare_*.jpg`. Không commit dataset/artifact lớn.
- Mesh TSDF + LiDAR + atlas: 234 góc × 400×225, 149.999 tam giác, 25.931.584 byte GLB. Độ phủ mesh ở camera trước frame 0 chỉ 29,30%; **không đạt chất lượng map hoàn chỉnh**, dừng thử thêm sau hai lượt (60 và 234 góc). GLB để xem/thẩm định, chưa dùng train/label/đổi thời tiết.
- RGB/depth chỉ từ Background, không gồm Sky, actor động, Affine. GLB unlit giữ ánh sáng đã nướng trong ảnh; không phải vật liệu đã tách albedo.
- Tọa độ mesh/splat lấy camera trước đầu tiên làm gốc (x phải, y xuống, z trước). `mesh.json.splat_to_topeye` đổi sang local scene; chưa ghép vào viewer chính cổng 8770.
- API Tensor TSDF theo [Open3D](https://www.open3d.org/docs/release/tutorial/t_reconstruction_system/integration.html); API legacy trên wheel macOS 0.20 tại máy trả rỗng ở test mặt phẳng.

Chạy từ root, chỉ đọc output Kaggle có sẵn, không gửi job mới:

```sh
backend/.tools/mpsplat/.venv/bin/python backend/scripts/streetgs_mesh.py export --source backend/.tools/kaggle/streetgs/out30 --out backend/data/sim/scene-0061/streetgs/30k --stride 5
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/streetgs_mesh.py fuse --out backend/data/sim/scene-0061/streetgs/30k --layout backend/data/sim/scene-0061/layout.json --lidar backend/data/sim/scene-0061/gs/init_points.ply
python3 -m http.server 8772 --bind 127.0.0.1 --directory backend/data/sim/scene-0061/streetgs
```

Chỉ chạy server nếu cổng chưa có server cũ. `export` dùng PyTorch/MPS venv đã có; `fuse` dùng Open3D trong backend venv. Exit khác 0 = lỗi input/render/mesh, không coi file còn lại từ lần trước là kết quả mới; `export.json`/`mesh.json` ghi cuối lượt thành công. Contract: [S14](../planning/02_2026-10-05_blender-real2sim/specs/SPEC-S14-StreetGS-Mesh.md).

## S15 — Scene assembly (local v0.2.0)

Hai contract đã được duyệt ngày 2026-10-08; [S15](../planning/02_2026-10-05_blender-real2sim/specs/SPEC-S15-Scene-Assembly.md). Chưa đạt chất lượng CARLA.

- `procedural.facade_completion: bool = false`: giữ mặt tiền quan sát được, hoàn thiện chiều sâu 4–12m ra phía ngoài road. Placement ghi `geometry_source`, `observed_facade`, `completion_depth_m`; scale0,5–2 và distortion≤1,4; footprint mới vẫn qua guard road/actor. Không có road chứng minh hướng thì fallback. Không sửa JSON gốc.
- Tree metadata optional `collision_parts: [{min:[x,y,z], max:[x,y,z]}]`, `canopy_min_z: float`: normalizer chia geometry thành slab0,5m, bao mọi triangle cắt slab. Canopy field chỉ mô tả đáy slab đầu tiên đạt nửa độ rộng native; guard dùng đáy từng slab, không tên mesh hay canopy field. Slab thấp<4,5m tránh road; mọi slab tránh actor sweptXYZ+0,2m. Thiếu metadata giữ guard XY cũ; metadata sai/lệch evaluated mesh dừng InputError.
- BVH opacity chia sẻ mesh/material local giữa các instance không modifier. Ray, distance và normal đổi tọa độ chính xác với scale không đều; mọi mesh vẫn có audit contribution. Camera/LiDAR dùng chung alpha.
- Ghép4apartment block từ kit Poly Haven CC0 đã có, cửa/tầng3m. Không tải asset hoặc mở job remote.

Tái lập từ root, từng job Blender một:
```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 -P backend/topeye/sim/blender/normalize_env_assets.py -- --refresh-collision
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 -P backend/topeye/sim/blender/normalize_env_assets.py -- --assemble-blocks
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 -P backend/scripts/s15_lookdev.py -- --name lookdev_new
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 -P backend/topeye/sim/blender/build_scene.py -- --layout backend/data/sim/scene-0061/layout.lookdev_new.json --out backend/data/sim/scene-0061/runs/lookdev_new --export-env-only
```
Pilot từ chối run đã tồn tại; tạo layout/procedural dẫn xuất, render frame0/20 CAM_FRONT/CAM_FRONT_RIGHT+freeview, lưu scene.blend và selftest. Không mở schema scenario. Rollback completion bằng input không flag; rollback guard cây bằng manifest không collision metadata; geometry vẫn nằm trong BVH.

Evidence `evidence/s15/`: 531pass/0fail/0skip; camera error0,000307px; 7nhà asset+1fallback,135cây; BVH1859meshes/13.811.325triangles/missing0. Build51,507s; build+4ảnh397,836s, chưa gồm freeview/export. Chưa đo batch234ảnh/20phút. Hình còn nền xa trống, vạch vụn, actorlowpoly.

S15 chưa dùng3DGS để suy facade. S14 chỉ cho thấy RGBD→TSDF+LiDAR trực tiếp chưa đạt; hybrid LiDAR neo metric +3DGS suy hình/màu +mesh completion còn trong backlog.

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
- **Giao thông sinh tự động:** trong scenario đặt `[traffic] mode = "generated"` với `density`, `speed_scale`, `speed_jitter`, `lane_change_rate`, `aggressiveness`, `pedestrians`, `keep_parked`, `seed` (xem SPEC-S5 §1). Có preset mẫu `scenarios/night_traffic.toml`. Xe đỗ thật luôn được giữ; xe sinh ra phải không chồng nhau, cách xe ego ≥ 1 m và nằm trên đường.
- **Xem map 3D trên web:** viewer có thêm bảng Môi trường (xem trước realtime; riêng giờ trong ngày chưa áp cho Blender), bảng Giao thông (sinh và xem trực tiếp), nút Render Blender, lớp splat (Spark) và mặt đường ảnh thật. chạy `.venv/bin/topeye-sim-view --scene scene-0061`. Lệnh mở `http://127.0.0.1:8770/?scene=scene-0061` (three.js), xem được mặt đường + vạch sơn, voxel, xe/người theo frame, quỹ đạo ego và LiDAR mô phỏng của từng run.
  - Server chỉ bind `127.0.0.1` và chỉ phục vụ `backend/data/sim/` cùng trang viewer; không liệt kê thư mục.
  - Chọn **Run / môi trường**: nếu run có `environment.glb`, viewer nạp nhà/cây/cột/vỉa hè từ Blender và ẩn voxel/splat; run không có GLB giữ nền cũ. Có trạng thái tải/lỗi và huỷ kết quả tải cũ khi đổi run nhanh. Checkbox Nhà/cây áp dụng cả nền GLB.
  - Scenario schema 2 có `export_web_env = true` mặc định cho `procedural`/`assets`; đặt `false` để bỏ bước xuất. GLB chỉ chứa môi trường, không chứa actor/ego/camera/đèn/fog, modifier đã đánh giá, instance đã hiện thực; ≤1.500.000 tam giác, texture ≤1024 px, ≤150 MB. Bản sao geometry được giảm lưới riêng, cảnh render/label/LiDAR không thay đổi. Vật liệu thủ tục được ánh xạ sang PBR glTF, không bảo đảm khớp shader Blender từng pixel.
  - `run.json` ghi `environment_export_s`, `environment_triangles`, `environment_bytes`, `total_s` (bao gồm xuất). Xuất bù dùng scenario đã lưu trong run và chỉ thay GLB cùng các chỉ số này; tổng của run cũ được suy ra từ build/render/LiDAR đã ghi nếu chưa có `total_s`.
  - Xuất bù **không render lại ảnh** (từ root repo, lần lượt từng run; chỉ một job Blender):
    ```sh
    /Applications/Blender.app/Contents/MacOS/Blender -b --python backend/topeye/sim/blender/build_scene.py -- --layout backend/data/sim/scene-0061/layout.json --out backend/data/sim/scene-0061/runs/day_proc --export-env-only
    /Applications/Blender.app/Contents/MacOS/Blender -b --python backend/topeye/sim/blender/build_scene.py -- --layout backend/data/sim/scene-0061/layout.json --out backend/data/sim/scene-0061/runs/day_assets --export-env-only
    ```
  - Trang tải three.js từ CDN jsdelivr, nên cần có mạng.
  - Cổng bận thì CLI thoát mã 3; truyền `--port` để đổi cổng.

## 2. Tham số CLI
| Lệnh | Tham số | Ý nghĩa |
|---|---|---|
| `topeye-sim-layout` | `--scene` (bắt buộc), `--frames i j …`, `--config` | Chỉ lấy các keyframe đã chọn để dựng map tĩnh và camera; mặt đất vẫn gộp mọi sweep |
| `topeye-sim-render` | `--scene`, `--scenario F.toml` hoặc `--selftest`, `--save-blend F.blend`, `--config` | `--save-blend` lưu cảnh để mở bằng Blender GUI khi debug |
| `topeye-sim-view` | `--scene`, `--port` (8770), `--no-browser`, `--config` | Web viewer three.js trên localhost |
| `topeye-sim-fo` | `--scene`, `--runs`, `--port` (5151), `--no-app`, `--config` | Grouped dataset FiftyOne + UMAP embedding real vs sim |

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

## 7. FiftyOne — Xem và đánh giá dataset thật vs sim
- Lệnh chạy:
  ```bash
  topeye-sim-fo --scene scene-0061 --runs day_proc,day_vn,night_proc,rain_proc,day_assets [--port 5151]
  ```
- **Grouped dataset:** Mỗi frame bao gồm slice 6 surround camera (`CAM_FRONT`, `CAM_FRONT_LEFT`, `CAM_FRONT_RIGHT`, `CAM_BACK`, `CAM_BACK_LEFT`, `CAM_BACK_RIGHT`) và slice `LIDAR_TOP` (`.pcd` 3D). Slice mặc định hiển thị: `CAM_FRONT`.
- **Trường `source`:** Phân loại nguồn `real` (nuScenes keyframes) và từng run sim (`day_proc`, `day_vn`, `night_proc`, `rain_proc`, `day_assets`).
- **Bounding Boxes:**
  - 2D trên các slice camera: `Detections` (chuẩn hoá theo YOLO và class ID tương ứng, hoặc từ 3D box chiếu qua intrinsic/extrinsic cho ảnh thật).
  - 3D trên slice LiDAR: `Detections` 3D gồm `location`, `dimensions`, `rotation` (yaw quanh trục Z).
- **Embedding & Đo khoảng cách domain:**
  - Trích xuất embedding đặc trưng thị giác bằng mô hình ResNet-18 (chạy hoàn toàn local).
  - Giảm chiều UMAP và hiển thị phân cụm theo `source` (nhìn thấy rõ khoảng cách domain giữa dữ liệu thật và các preset sim).
  - Báo khoảng cách Euclidean L2 giữa tâm cụm (centroid) của `real` và từng run, cosine distance, và khoảng cách trung bình của các mẫu.
- **Lưu trữ & Môi trường:**
  - Dataset được lưu persistent với tên `topeye-<scene>` (chạy lại sẽ tự động ghi đè).
  - FiftyOne và các thư viện liên quan (`fiftyone`, `umap-learn`, `torchvision`) được cách ly trong virtualenv `backend/.tools/fo/.venv`, không làm phình venv sản xuất.
  - Tự động thiết lập `FIFTYONE_DO_NOT_TRACK=true` để vô hiệu hoá mọi thu thập dữ liệu telemetry.

## 8. NuRec — tái dựng môi trường tĩnh

Ưu tiên mới: tái dựng môi trường scene-0061 xem được, chưa xe động/CARLA. Hồ sơ: [kế hoạch03](../planning/03_2026-10-08_nurec-static/plan.md). Reuse [converter nuScenes NVIDIA](https://nvidia.github.io/ncore/conversions/nuscenes/nuscenes.html), giữ đủ camera/LiDAR/pose và cuboid EXTERNAL. Active path là full NuRec native recipe6camera + lidar_top; Instant preview3camera dưới đây là nghiên cứu lịch sử.

NVIDIA yêu cầu Linux x86_64, CUDA≥12.8 và GPU >24GB. Log Kaggle cũ chỉ có2×T4 15360MiB/card; Mac không có runtime CUDA được hỗ trợ. Không gộp VRAM hai card hoặc báo benchmark giấy thành kết quả chạy thật.

Instant NuRec ở môi trường Python3.11 riêng. PLY và sky sidecar phải giữ cùng nhau; viewer PLY thông thường chưa tự áp sky/ISP. Camera nuScenes ideal pinhole không được gắn nhầm F-theta để chạy --render-preview/video. Runner và lệnh theo OPERATIONS trong kế hoạch03; dữ liệu thử ở backend/data/sim/scene-0061/nurec, không đổi backend production dependencies.

Local preparation đã đo: converter SDK19.8 xuất 1318 ảnh,382 LiDAR,4664 cuboid. Adapter metadata `adapt_pinhole.py` đổi IdealPinhole sang OpenCV zero distortion để SDK18.7 của model đọc được; giữ nguyên 7 sensor stores. Validator SDK18 và thẩm định độc lập pass; calibration roundtrip tối đa0,000123px. Gói `backend/data/sim/scene-0061/nurec/static-job.tar` 482324480byte đã có source NVIDIA pin, dữ liệu và runner. Đã có PLY NuRec thử10k/30k; chưa nghiệm thu chất lượng hình ảnh. Quota Kaggle còn24,48h khi kiểm2026-10-08; quota không chứng minh quyền dùng A100/H100.

Kiểm menu accelerator account Kaggle trực tiếp (2026-10-08): chỉ None/T4x2/TPUv5e-8. Người dùng đã duyệt pilot Kaggle nhưng chưa tạo job/upload do không có GPU đủ VRAM. Gói chạy vẫn sẵn sàng cho host phù hợp; phương án trả phí ngoài Kaggle cần duyệt riêng.

NuRec T4 research (no GPU benchmark): [memory tradeoffs](../planning/03_2026-10-08_nurec-static/research/kaggle-memory.md). Candidate controls: loaderbatch1, DPTchunk1, efficient SDPA capability check; PA encoder alreadyFP16. Supported1camera504x280 preview trades spatial coverage for lower memory. Original runner/archive unchanged; do not treat the >24GB official support check as proof no experimental T4 adaptation is possible.

**Active override (2026-10-08):** người dùng chuyển nghiệm thu sang train1scene bằng NuRec đầy đủ, xem [SPEC-P02](../planning/03_2026-10-08_nurec-static/specs/SPEC-P02-Full-NuRec.md). Dữ liệu NCore đã kiểm được tái sử dụng; auxiliary data đã hoàn tất, native full trainer đã xuất checkpoint/USDZ30k; render/download hoàn tất; VM đã xoá23:32+07. Gói static-job.tar hiện là gói Instant chuẩn bị cũ, không chứa aux hoặc model đã train. Brev L40S arl0iuyc4 đã tạo21:49+07, tổng$1.06/h gồm storage, cap3USD/2h; đã huỷVM23:32+07 trước watchdog23:44. Aux exit0, full trainer attempt2 đã dừng tại30079(exit1) sau checkpoint30k để kịp tải và huỷ máy trong2h; nominal40k còn mở. Runtime sửa khởi tạo bảng LiDAR native4340cột. Bản gốc failstep0exit255; bản sửa red/green5/5 và thẩm định độc lập pass. Không áp ước tính thời gian Instant cho fulltraining.

Cảnh tái sử dụng: EXTERNAL cuboids rawlabels car/truck/bus/construction_vehicle tách thành dynamic_rigids và static_rigids; nền khởi tạo lọc semantic car/truck/bus. Nhãn raw và semantic khác ontology; construction_vehicle chưa chứng minh nền sạch. Không xoá ảnh đầu vào; khả năng ẩn xe, vùng bị che và thời tiết cần nghiệm thu render riêng. Artifact tải bằng TLS có xác thực/chứng chỉ pin và chia phần kiểmSHA; credential transport chỉ ở ignoredtools, không trong Git/logs.

Bản xem local: `http://127.0.0.1:8773/step-030000/viewer/` (30k đã tải, khớp SHA/ZIPCRC; mở đầu/giữa/lệch ngang thành công). Native PLY background có3DC dạng list5 temporal coefficients, Spark không đọc trực tiếp; `canonical_ply.py` chỉ tạo derivedpreview index0 basecolor, giữ XYZ/scales/rotations/opacity/SH khác bitwise. OriginalPLY/USDZ được giữ nguyên. Browser preview10k và native source/lateral1m render có cảnh đường/phố nhưng mờ, bóng và lỗ còn lại; không coi là nền sạch hay hỗ trợ relighting/thời tiết.

Kết quả30k: USDZ1114780075bytesSHA256b259db9f288fe619c6abdec12efd969bf96f951bf366218a63cb22ced8c5c338 chứa modelweights1092465489bytes; backgroundnativePLY648947543bytes/2261136vertices +road35079101bytes/148634vertices đã tải và khớpSHA. Bản xem chỉ nền/mặtđường đã ẩn xe lớn nhưng còn bóng/ghost/holes/floaters; qualitygate OPEN. Không tải optimizerresume checkpoint3242759383bytes trong lượt cap này; USDZweights vẫn giữ. Auxdata+69memberrunlogs/configs+4nativePNG giữ ở full-output/.

Hoàn tất40k: SPEC-P03 chọn chạy mới đủ40000 với config cũ +reuseaux (USDZ30k cóglobal_step30000 nhưng khôngoptimizer_states, không coi là exactresume). Gói full-40k-job.tar488704000bytes/SHA312ad1fa24483336d3518d266378170487a41e18eedc97c95ca904b6a96601ca gồm dữ liệu,aux,config,patch,prepare/run; bashsyntaxpass. Lượt mới phải lưu cảfullresumecheckpoint trướcteardown. Đề xuất thêm3.50USD/3h, chờduyệt; chưathuêmáy.

**Quyết định thay thế:** người dùng muốn tận dụng30k và chất lượng gần demo, không chấp thuận mặc địnhtrainmới. SPEC-P03 chuyển sang kiểm tra nativeweights-onlyresume +schedule trướclaunch; candidate train/valsubsample4→2 (800×450 thay400×225), chưaparse/trialGPU. NativeUSDZrenderer là nguồn đánh giá chính; SparkbasecolorPLY không tái hiện sky/ISP/temporalappearance đầy đủ. Không cam kết40k=demoquality. Trần lượt mới3.50USD/3h; useroke, nhưng ego taskspace14pausedhardstop chờexplicitcontinue. No newVM/job.

**Nguồn dữ liệu mới theo yêu cầu:** NVIDIA PhysicalAI-Autonomous-Vehicles-NCore, clip100ae358-f548-49b8-af4d-c0afdbcfe9ed (officialfulltrainingexample), revision5f2fd45b413f685799a6c087072c3de0a4f8db3f. API10files/1954813617bytes (9LFSsha256+1gitblob) confirmed; dữ liệu cóofflinecalibration/egomotion/cuboids theoNVIDIA, nhưng chưaxemảnh/độphângiải thực tế. File401, chưaHFauth/terms; noGPUrent. `backend/.tools/hf/.venv/bin/hf auth login` rồi `bash planning/03_2026-10-08_nurec-static/download_pai.sh` tải clip đãpin vàkiểmhash. SPEC-P04active; oldscenecontinuationdeferred; cảnhmới cầnmodelriêng.

**Active2026-10-09 — nuScenes only:** người dùng huỷ chuyểnPhysicalAI, khôngcầnHFlogin. Audit10scene localv1.0-mini/180ảnh/0missingcameraLiDAR; chọnscene-0103BostonSeaport (40keyframe/19.40s/117.91m/yaw14.41deg), backup0655. 0103 có mặt tiền nhiều chi tiết và ánh sáng đều hơn trong ảnh đã xem; khôngclaimbesttoànbộnuScenes/khôngđảm bảoNuRecquality. Contacts `backend/data/sim/nurec-scene-selection/scene-0103-six-cameras.jpg`, audit.json cùngfolder. Officialconverter/adapt/SDK18validationexit0:1384ảnh/389LiDAR/2035EXTERNALboxobservations,7storesbyteidentical; old0061defaultregressionpass, wrongsceneexit2. Archive `backend/data/sim/scene-0103/nurec/full-data.tar`456243200bytesSHA352df1bd66515cf79609bbbfd687516b38bf2363a573c98ca99b56cc8a2f1aeb. `pilot-0103.candidate.yaml` kếthừa2xsubsample, nativeparse/aux/GPUchưachạy. Newscene cầnmodelriêng; old30kgiữ nguyên.

NuRec full-render request2026-10-09: scene0103 target40000steps at800x450training; native1600x900render all6cams/frame-step1+frontnovel1m. Local full-render-job.tar ready/shellsyntax0, noGPUrun. Mustretainoptimizercheckpoint. Browser14requiresexplicitresume, cap3.50USD/3hunchanged; cannotpromisefullrunwithincap.

NuRec0103 live2026-10-09T00:46+07:00: useroke approvedbrowserresume/execution; L40Sl8hw4o5f5 created1.056USD/h,watchdog10951deadline~03:15+07. UploadedSHAverified; nativeparse/configguardPASS; AUXrunning, train/renderpending. Backupmonitor27542checksclosednativecheckpoint/USDZevery60s overauthenticatedTLS/SHA. Exactcheckpointglobalstep remainsunverified untildownload.

### Kết quả scene-0103 native 40.000 bước — 2026-10-09T02:29:32+07:00
Giữ nuScenes theo yêu cầu; chọn scene0103 trong10cảnh mini đã audit. NativeNuRec26.04 train40000bước thành công trênL40S;6camera+LiDAR/cuboidEXTERNAL, subsample2/training800×450. Fullrender1600×900/frame-step1:1384PNG sáucamera và229PNG frontlateral1m; all1613PNGdecode/dimensions/count PASS.7MP4giữ đủ1613frame, dùng tốc độ trungbình riêngtừngcamera (~11.7–12fps); không coi cùngindex giữa các camera là đồngbộtimestamp. Trainwall70m29s, render3m11s.

Xem [video local](http://127.0.0.1:8774/). Artifacts ignoredlocal: `backend/data/sim/scene-0103/nurec/full-output/step-040000-usdz/model.usdz` (1151659878byte), `step-040000-checkpoint/model.ckpt` (3353819543byte), aux-data, run-evidence-archive và render-full-archive. Tất cảkhớpSHA; USDZ/fullCP ZIPCRC PASS; nativefullCPglobal40000/16optimizer/11scheduler,97floatingtensorsfinite. USDZ chỉmodelweights; fulloptimizerCP riêngđãgiữ, actualresume chưa chạy. Dùng runtimeNVIDIA pin đểresume; MacSDKvenv thiếuomegaconf khiđọcfullCP, không phải bằngchứng checkpointhỏng.

Thẩm địnhđộc lập14pass/0fail/0skip,decodeall1613ảnh. Mặt tiền/phố nhậnra rõ nhưngchitiet còn mềm/ghost ởvùngche; nativefullrender cònxe/người, chưa nghiệmthu nền sạch hay chấtlượng demo. Rendering900px không tăngchitiet train450px. Thời tiết/CARLA chưa triểnkhai. VMl8hw4o5f5 đãxoá, `brev ls` No instances lúc02:27+07; watchdog/keepawake đãdừng sauxácnhận, credentialtransportriêngđãxoá. Ướctính2.25USD trongcap3.50USD/3h, hoáđơncuốichưa xácminh. Old0061outputs/viewer8773giữ nguyên; app0.2.0khôngđổi.


### Môi trường 3D tương tác scene-0103 — 2026-10-09
Bàn giao chính là [viewer 3D local](http://127.0.0.1:8775/), không phải video. Viewer đọc background.ply (2.105.373 Gaussian) và road.ply (180.020), tổng 2.285.393 từ USDZ40k đã lưu. Kéo chuột để xoay/dời, cuộn để zoom; WASD di chuyển, Q/E lên xuống, Shift tăng tốc; bốn vị trí đầu/giữa/cuối/trên cao. Chế độ Mượt dùng LOD800k, Chi tiết cao2,5M; dữ liệu lưu không bị cắt giảm. Server local PID30635, thư mục backend/data/sim/scene-0103/nurec/full-output/viewer.
Exporter thí nghiệm `planning/03_2026-10-08_nurec-static/export_viewer_ply_0103.py` giữ toàn bộ XYZ/scale/rotation/opacity/SH; chuyển SH coefficient-major sang RGB-major, temporal DC chỉ lấy hệ số0. Oracle scene0061 so với PLY NVIDIA bitwise giống toàn bộ body. Thẩm định độc lập11pass/0fail/0skip, SHA và số Gaussian xác nhận. Browser không áp native NRE sky/ISP/toàn bộ temporal appearance; màu và chi tiết có thể khác native render. Đây là Gaussian scene, chưa phải mesh có collision hoặc relighting/weather. USDZ/fulloptimizercheckpoint gốc giữ nguyên. Không thuê thêm máy/train lại.

BrowserQA: ready=true, 4/4presetpositions matched, W moved1.2m, error=null. Actualcanvas screenshot evidence/local/viewer-0103/middle-canvas.png inspected: streets/buildings present, softdetails/holes remain; userqualityOPEN.

2026-10-09 clarification: user finds nativevideo acceptable, interactive3D muchmorebroken. Supersedes inference that nativequality is primaryblocker. Confirmed from Spark2.3.1 source/docs: default PackedSplats positionsfloat16, defaultLODgenerated; audit background31centersoutsideFP16finite range,588beyond3000m; float32inputmax2422217. Candidate viewer ?precision=1 uses extSplats:true, accumExtSplats:true, enableLod:false/lod:false, countguard2285393; defaultmodeunchanged. JSsyntaxPASS. VisualeffectUNMEASURED; browser14hardstop/usercontrol, MUSTwaitexplicitcontinuebeforeclaim/resume. No train/job/paidresource.
