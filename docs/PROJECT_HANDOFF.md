# TOPEYE — Hồ sơ bàn giao triển khai

> Cập nhật: 2026-10-08. Tổng hợp từ code local, SPEC, nhật ký và evidence hiện có.
> Trạng thái: R&D / POC, chưa nghiệm thu sản phẩm, chưa chứng minh hiệu quả train bằng dữ liệu sim.
> Cập nhật của chủ dự án: **đã chuyển sang thuê/sử dụng GPU qua Kaggle**. Quy định cũ “chỉ Mac, không thuê GPU” không còn mô tả đúng hạ tầng hiện tại. Chưa có thông tin xác nhận loại GPU, đơn giá hoặc ngân sách trong lượt bàn giao này.

## 1. Mục tiêu và phạm vi

TOPEYE chuyển dữ liệu cảnh giao thông thật thành môi trường 3D có thể sinh thêm dữ liệu huấn luyện: ảnh nhiều camera, LiDAR mô phỏng, nhãn YOLO 2D và box 3D. Người dùng muốn cảnh giống bố cục thật, chất lượng hình ảnh hướng tới CARLA, có thể thay đổi thời tiết và giao thông.

Đầu vào: LiDAR, ảnh surround camera, intrinsic/extrinsic, ego pose và box/track. Bộ mẫu đang dùng là nuScenes-mini (6 camera); dữ liệu Việt Nam có 8 camera fisheye là hướng tích hợp tiếp.

Cách dựng chính là **digital cousin**: hình học và bố cục có căn cứ từ cảnh thật, phần thiếu được hoàn thiện bằng asset/PBR và phải ghi nguồn suy diễn. Không mặc định mọi bề mặt đều là phép đo chính xác của cảnh thật.

Model đích theo kiểu YOLO–LiDAR fusion: train bộ nhận diện ảnh 2D, kết hợp điểm LiDAR trong vùng phát hiện để suy ra hình học 3D. Pipeline train/evaluate cuối cùng chưa được nghiệm thu.

Web app gán nhãn 3D ban đầu đã dừng từ 2026-10-05. Code cũ được giữ để tái sử dụng, không phải trọng tâm sản phẩm hiện tại.

## 2. Kiến trúc và hạ tầng hiện hành

```text
nuScenes / dữ liệu thật của team
  ├─ ảnh camera + calibration + ego pose + box/track
  └─ point cloud LiDAR
                │
                ▼
Python core: adapter → geometry → ground/colorize/accumulation
                │
                ▼
Python sim: layout + camera + procedural/asset planning + traffic
                │
                ├─ layout.json / PLY / PNG / scenario.toml
                │                 │
                │                 ▼
                │          Blender headless
                │          dựng cảnh + render + ray casting
                │                 │
                │                 ▼
                │          ảnh + LiDAR + visibility → nhãn 2D/3D
                │                 │
                │                 ▼
                │          viewer / FiftyOne / đánh giá
                │
                └─ dataset Gaussian Splatting
                                  │
                                  ▼
                       GPU Kaggle: StreetGS training
                                  │
                                  ▼
                       checkpoint → tải về local
                                  │
                       splat viewer / thử chuyển mesh
```

- Máy phát triển: Mac M3 Pro 18 GB, không CUDA; vẫn dùng cho xử lý dữ liệu, viewer, Blender và kiểm thử local.
- GPU remote: Kaggle; job StreetGS 30k đã hoàn tất và output đã được tải về. Thông tin thuê GPU do chủ dự án cập nhật, không suy diễn giá hoặc SKU GPU.
- Python chính: 3.12; Blender dùng Python riêng. `build_scene.py` không import package `topeye`; giao tiếp bằng file.
- Blender: bản được hồ sơ local ghi nhận là 5.2.2; EEVEE cho tốc độ, Cycles/Metal cho mẫu kiểm chất lượng.
- Venv phụ: `backend/.tools/mpsplat/` cho splat trên Metal, `backend/.tools/fo/` cho FiftyOne; có tooling Kaggle local. Không mặc định venv chính chứa tất cả thư viện thử nghiệm.
- Viewer chính: three.js, cổng mặc định 8770. Viewer StreetGS riêng từng được chạy ở 8772; đây là địa chỉ vận hành local, không phải cam kết server đang chạy.
- Không tự suy ra rằng dữ liệu riêng của team được phép upload từ việc dùng Kaggle. Hạn chế local của bộ dữ liệu VinFast vẫn cần được tôn trọng theo phạm vi đã chốt.

## 3. Cấu trúc dự án và quyền sở hữu

```text
topeye/
├── AGENTS.md                       Luật dự án / giao thức khởi động
├── CLAUDE.md                       Shim trỏ về AGENTS.md
├── PROJECT_BRIEF.md                Ý tưởng gốc; không thay cho quyết định hiện hành
├── brain4agent-v1.7.1.md            Marker khung quản trị, không phải version sản phẩm
├── .agents/skills/                 Skill vận hành dùng chung
├── .claude/                        Shim / cấu hình hỗ trợ Claude
├── brain4agent/                    Bộ nhớ và bản đồ dự án
│   ├── memory-distill.txt          Kernel hiện trạng
│   ├── index.md                    Router tài liệu và codebase
│   ├── project-intro.md            Mục tiêu, stack
│   ├── -data-architecture.md       Luồng dữ liệu / lưu trữ
│   ├── -known-gotchas.md           Bẫy kỹ thuật
│   ├── roadmap.md                 Tiến độ / backlog
│   ├── changelog.md                Lịch sử quyết định
│   └── memory/{hot,archive}/       Trạng thái và nhật ký
├── docs/
│   ├── sim.md                     Hướng dẫn module sim / CLI
│   └── PROJECT_HANDOFF.md          Hồ sơ này
├── planning/                      LOCAL, bị gitignore
│   └── 02_2026-10-05_blender-real2sim/
│       ├── plan.md                Quyết định, checklist, work packages
│       ├── specs/                 Contract kiến trúc và S1–S15
│       ├── handoffs/              Giao việc
│       ├── reports/               Báo cáo
│       └── evidence/              Log, số đo, ảnh kiểm chứng
├── backend/
│   ├── pyproject.toml             Package Python, CLI, extras; version 0.1.1
│   ├── config.toml                Đường dẫn dataset/cache/Blender theo máy
│   ├── topeye/
│   │   ├── core/                  Adapter, geometry, ground, colorize, BEV…
│   │   ├── sim/                   Pipeline hiện tại
│   │   │   ├── blender/           Dựng cảnh/chuẩn hoá asset; chạy trong Blender
│   │   │   └── viewer/            Viewer web cho sim
│   │   ├── api/                   FastAPI của hướng viewer cũ
│   │   ├── config.py              Đọc cấu hình
│   │   ├── prepare.py             Chuẩn bị cache viewer cũ
│   │   └── export_splat.py        Xuất splat
│   ├── scripts/                   Pilot, export, evidence, tải asset
│   ├── splat/                     Train/diagnose Gaussian local
│   ├── eval/                      KID và recognizability
│   ├── tests/                     Kiểm thử backend
│   ├── assets/                    Manifest, attribution và asset local
│   ├── data/                      Cache, layout, dataset, render, checkpoint dẫn xuất
│   ├── .venv/                     Môi trường Python chính
│   └── .tools/                    Tool/venv thử nghiệm, gồm Kaggle
└── frontend/                      Web viewer cũ React/TypeScript/Vite
    ├── src/{api,components,geometry,perf}/
    ├── public/
    ├── package.json / package-lock.json
    └── dist/ / node_modules/      Build và dependency local
```

Danh mục file mã nguồn đầy đủ nằm ở Phụ lục A. Không liệt kê từng ảnh, checkpoint, dependency cài đặt hoặc file cache vì chúng là artifact lớn, không phải cấu trúc nguồn cần triển khai.

### Module chính

| Module | Trách nhiệm |
|---|---|
| `core/adapters/base.py`, `nuscenes.py` | Interface dataset và đọc nuScenes JSON trực tiếp |
| `core/geometry.py`, `types.py`, `calib_check.py` | Kiểu dữ liệu, transform, phép chiếu và kiểm calibration |
| `core/ground.py`, `colorize.py`, `object_accum.py` | Tách ground, gán màu, tích luỹ điểm theo vật |
| `core/bev.py`, `box_texture.py`, `panorama.py`, `cache.py` | Nền tảng viewer/BEV/bird/surround cũ |
| `sim/layout.py`, `camera.py` | Xuất layout thật và chuyển camera OpenCV sang Blender |
| `sim/static_map.py`, `ground_surface.py`, `map_photo.py` | Map tĩnh, mặt đất và ảnh mặt đường |
| `sim/procedural_layout.py`, `env_assets.py` | Trích bố cục và đặt asset môi trường |
| `sim/traffic.py`, `actor_color.py` | Giao thông và màu actor |
| `sim/blender/build_scene.py` | Dựng cảnh, render, BVH, LiDAR/visibility, xuất môi trường |
| `sim/blender/normalize*_assets.py` | Chuẩn hoá asset, trục, kích thước và metadata |
| `sim/labels.py` | Nhãn 2D/3D nhất quán với hình học và visibility |
| `sim/gs_data.py`, `texture_mesh.py` | Dataset splat và nhánh mesh dán ảnh |
| `sim/view.py`, `viewer/index.html` | Server/viewer sim |
| `sim/fo_dataset.py` | Dataset FiftyOne thật vs sim, embedding/UMAP |
| `scripts/streetgs_mesh.py` | Xuất checkpoint StreetGS, RGBD và thử TSDF + LiDAR + atlas |
| `eval/` | Đo khoảng cách ảnh KID và khả năng nhận diện |

## 4. Các giai đoạn và trạng thái

| Giai đoạn | Thời gian | Đã làm | Trạng thái / việc còn lại |
|---|---|---|---|
| Ý tưởng và feasibility | 03/10 | Đánh giá hướng hỗ trợ gán nhãn 3D | Kết luận khả thi có điều kiện; mục tiêu sau đó đổi |
| Kế hoạch 01 | 03–05/10 | Adapter, cache/API, top/bird/surround viewer | Dừng; code giữ lại, hồ sơ kế hoạch 01 đã xoá theo nhật ký |
| S1–S3: Blender POC | 05–06/10 | Layout scene-0061, camera, 4 preset, LiDAR, label | Gate máy có bằng chứng; chưa đóng nghiệm thu thị giác |
| S4: map quality | 06/10 | 382 sweep, voxel 0,2 m, ground kín vùng đường | Chamfer ngày 0,242 → 0,173 m; hình ảnh vẫn dạng khối |
| S5: web và traffic | 06/10 | Traffic seeded, bảng môi trường, render, splat và orthophoto | Đã tích hợp; mật độ còn phụ thuộc xe thật trong scene |
| S6: Gaussian local | 06/10 | Train nền bằng mpsplat/MPS | M0 dừng dưới ngưỡng chất lượng; M1/M2 actor đổi sang S8 |
| S7–S8 | 06/10 | Tham số kiểu CARLA; actor từ thư viện | Nhận diện ban đầu khoảng 0,50, dưới gate 0,80 |
| S9: textured mesh | 06/10 | Mesh từ điểm + ảnh thật | POC không đạt, không chọn làm hướng chính |
| S10: build 15 phút | 06/10 | Pipeline dựng nhanh | 784 giây đạt thời gian, PSNR 19,31 dB vẫn mờ |
| S11: procedural PBR | 06–07/10 | Đường/nhà/cây thủ tục, PBR, pilot 6×39 ảnh | 17,4 phút; KID 65,3; chất lượng actor còn thấp |
| S12: asset môi trường | 07/10 | Nhà/cây/cột/props từ thư viện, guard label/BVH/va chạm | Code local có; placement nhà bộc lộ hạn chế, dẫn tới S15 |
| S13: phong cách VN | 07/10 | region_style, preset xe máy, rider/mũ; tham chiếu dữ liệu VN | Code và test local có; chưa tuyên bố đạt mọi gate thực chiến |
| S14: StreetGS Kaggle → mesh | 08/10 | Job 30k COMPLETE, xuất splat/RGBD/mesh | Splat xem được; mesh không đạt, đã dừng thử thêm |
| S15: scene assembly | 08/10 | Đã duyệt completion nhà + va chạm cây XYZ; có code/test/pilot | Đang triển khai; chưa đóng gate thị giác và runtime toàn scene |
| G-sim: hiệu quả train | Chưa hoàn tất | Đã có tiêu chí đánh giá | Chưa có bằng chứng real+sim thắng real-only trên tập thật |

## 5. Các phương pháp đã thử, thất bại và bài học

“Thất bại” trong bảng nghĩa là không đạt mục tiêu của phép thử đã ghi, không có nghĩa thuật toán đó vô dụng cho mọi bài toán.

| Phương pháp | Bằng chứng/kết quả | Vấn đề và quyết định |
|---|---|---|
| BEV mosaic từ camera + LiDAR thưa | Qua các vòng WP4/b/c; coverage_20m đạt 4/8 trường hợp ở bản giữ lại | LiDAR 32 tia làm depth thủng, vệt nan quạt, vùng bị che khó loại. Lấp depth theo cột và giới hạn 25 m giảm lỗi; còn thiếu phủ ở giao lộ/frame cuối |
| Dán ảnh lên box bird view | Tăng mặt có texture 246→293/504; điểm/vật 11,5→316 nhờ tích luỹ | Có cải thiện nhưng không khôi phục đầy đủ hình học/vẻ ngoài; không phải môi trường để tái chiếu sáng |
| DrivingForward feed-forward 3DGS | Chạy MPS khoảng 1,8 s/frame | Novel view gần camera có thể chạy, bird view ra nan quạt do sai số depth theo tia; không đạt yêu cầu nhìn từ trên |
| STORM feed-forward 3DGS | Chạy được nhưng bird view không dùng được | Cùng hạn chế hình học; thêm rào cản license phi thương mại được ghi trong hồ sơ |
| Surround panorama/bowl | Đã thêm nền cầu 60 m, BEV và làm mượt depth; cạnh bị loại giảm 27% theo nhật ký | Có sửa hiện tượng vỡ nhưng không phải tái dựng scene 3D đầy đủ; hướng sản phẩm này đã dừng |
| Gaussian nền local — M0 | 10.000 bước, 4.714 s, ~838k Gaussian; PSNR test 17,87 dB < 23 dB | Render mờ, mất vạch đường; dừng theo quy tắc hai lần không đạt. Lỗi NaN kernel được sửa nhưng chất lượng vẫn chưa đạt |
| Splat giới hạn 15 phút — S10 | 784 s; PSNR 19,31 dB; KID splat ghi 185,7 | Đạt tốc độ không đồng nghĩa đạt độ thật; không chọn làm lời giải chất lượng cuối |
| Mesh dán ảnh — S9 | Hồ sơ ghi PSNR khoảng 9,1 dB | Không đạt chất lượng ảnh. Texture mang sẵn ánh sáng nguồn, không giải quyết tái chiếu sáng; không suy ra mọi biến thể mesh đều đã được đo riêng |
| Voxel map + low-poly actor | Chamfer cải thiện tới 0,173 m | Đúng hình học hơn nhưng nhà cụt/dạng khối, màu tối; nhận diện actor dưới gate |
| Procedural PBR — S11 | 6×39 ảnh, 17,4 phút, KID 65,3; mốc real split 27,8 | Tốt nhất trong các hướng KID đã ghi nhưng còn xa ảnh thật; chuyển sang asset chi tiết. Hồ sơ ghi car 0,39 và chỉ số tổng hợp 0,54 ở nguồn khác: không coi hai số là cùng metric |
| Asset placement — S12 baseline | 0 building asset; 17 fallback do méo, 9 fallback bị loại, còn 8 nhà thủ tục | Footprint LiDAR chỉ là dải facade, không phải khối nhà; bbox XY cây loại cả tán cao. Đây là nguyên nhân S15 sửa contract |
| StreetGS 30k trên Kaggle | PSNR 23,0809; SSIM 0,68884; LPIPS 0,27519; 1.010.984 Gaussian xuất nền | Training thành công, splat xem được; chưa chứng minh scene editable/relightable, label đúng hoặc G-sim đạt |
| Poisson từ tâm Gaussian | S14 ghi đã thất bại và cấm lặp lại theo cách này | Tâm Gaussian không tự bảo đảm bề mặt mesh hợp lệ; hồ sơ bàn giao không có số đo riêng đáng tin để bổ sung |
| StreetGS RGBD → TSDF + LiDAR + atlas | 60 góc: phủ camera trước 14,14%; 234 góc: 29,30%; mesh 149.999 tam giác, GLB ~25,9 MB | Nhiều lỗ dù tăng góc; dừng. Không dùng mesh này train/label/đổi thời tiết. RGBD nền không chứa đầy đủ Sky/actor/Affine |
| Open3D legacy TSDF trên máy | Test mặt phẳng trả 0 voxel/triangle | Lỗi đường triển khai local; chuyển Tensor TSDF qua synthetic plane test. Sửa được tích hợp không đồng nghĩa mesh cảnh thật đạt |

### Hướng bị loại/hoãn ở bước đánh giá, không gọi là benchmark thất bại

- World Labs Marble: bị loại ở giai đoạn cũ vì dịch vụ trả phí. Quyết định dùng GPU Kaggle không tự động phê duyệt Marble.
- DUSt3R/MASt3R, LucidDreamer, Skybox AI, WorldDreamer: hồ sơ quyết định không chọn vì độ phù hợp, license/cloud/phần cứng; không có bằng chứng trong lượt rà này cho thấy từng hướng đều đã chạy benchmark đầy đủ.
- Gaussian riêng từng xe/người (S6 M1/M2): tạm dừng, thay bằng actor thư viện S8; không ghi thành thử nghiệm hoàn tất.
- BEVFusion/RoMe/OmniRe: từng gặp giới hạn CUDA/phần cứng local hoặc nằm ở mức khảo sát. Kaggle thay đổi điều kiện phần cứng nhưng chưa có quyết định triển khai lại tất cả các hướng.
- Asset NC/ND hoặc license không phù hợp: loại theo quy tắc asset; giữ CC0/CC-BY và attribution.

### Bẫy kỹ thuật cần tránh lặp lại

- mpsplat: packed chưa hỗ trợ; render RGB+depth nhiều kênh rất chậm; điểm sau camera gây NaN backward; cần guard hình học. SSIM trên MPS dùng conv2d thay avg_pool2d có gradient lỗi trong thử nghiệm đã ghi.
- Patchwork++ có thể lấy trần cầu vượt làm ground, gây gai 49 m; phải lọc ground theo hệ LiDAR và khoảng cách.
- Vạch intensity cần tương phản cục bộ và mask vùng đường, tránh lấy bê tông sáng thành vạch.
- EEVEE World volume từng làm ảnh đen; dùng mesh volume. Không tin exit 0 của Blender nếu script không xử lý exception/exit đúng.
- Ray-cast không tự biết vật chìm trong sương; visibility phải tính thêm truyền qua môi trường.
- StreetGS có hệ toạ độ neo camera trước đầu tiên và delta CamPose; không đoán transform bằng mắt.

## 6. Trạng thái S15 và điều kiện nghiệm thu

S15 đã được người dùng duyệt hai thay đổi contract ngày 08/10; các dòng “chờ duyệt” trong nhật ký cũ là trạng thái lịch sử.

1. **Nhà:** completion về phía ngoài đường, độ sâu suy diễn 4–12 m, giữ mặt tiền quan sát được, kiểm clearance và ghi `geometry_source`/provenance.
2. **Cây:** metadata hình học chia collision theo XYZ; tán đủ cao có thể vươn trên đường nhưng thân/cành thấp và mọi phần va actor vẫn phải bị chặn. Tán vẫn nằm trong BVH camera/LiDAR.
3. Có code trong planner/normalizer, test và script `s15_lookdev.py`; đã có evidence render pilot. Chưa coi log render hoặc test xanh là người dùng đã duyệt chất lượng.
4. Mẫu phải gồm frame 0, 20, camera trước, camera bên và góc tự do; không chỉ chọn góc đẹp. Chưa mở rộng 39×6 trước khi mẫu được chấp nhận.
5. Ngân sách ≤20 phút của pilot full scene vẫn là contract đã ghi; việc dùng Kaggle chưa tự thay đổi cổng này. Nếu đổi target phần cứng/runtime cần ghi lại điều kiện đo.

## 7. Số đo và giới hạn của bằng chứng

| Bằng chứng | Giá trị / cách hiểu |
|---|---|
| Backend S14 | 525 pass, 0 fail, 0 skip theo nhật ký |
| Backend S15 | Log `evidence/s15/backend-tests.txt`: 530 passed, 1 warning, 44,19 s |
| Test tập trung S15 | 53 passed, 5,13 s |
| Camera pilot S15 | max error khoảng 0,000307 px; contract <0,5 px |
| Frontend gần nhất trong ký ức | typecheck/build exit 0; audit 3 moderate, 1 high, 2 critical |
| G-POC | Có cổng máy local; chưa đóng cổng mắt |
| G-sim | Chưa chạy/hoàn tất đối chứng train để kết luận |

Các số trên đọc từ hồ sơ có sẵn, không phải kết quả chạy lại toàn bộ trong phiên viết tài liệu. Working tree đang có thay đổi nên team phải đo lại trên snapshot/commit bàn giao. Không so PSNR StreetGS 5k và 30k như thí nghiệm chỉ thay số bước vì cấu hình độ phân giải khác nhau.

G-sim dự kiến: cùng cách chia dữ liệu và cách đánh giá, so YOLO real-only với real+sim trên ảnh thật; tập đêm tăng ≥3 điểm mAP, tập ngày không tụt quá 1 điểm. Các scene thật đêm/sau mưa được ghi là scene-1077/1094/1100. KID hay PSNR tốt chưa thay thế được cổng này; không dùng KID với nuScenes làm gate độ thật riêng cho phong cách Việt Nam.

## 8. Chia việc cho team và thứ tự tiếp theo

| Nhóm | Phạm vi sở hữu đề xuất | Hoàn tất khi |
|---|---|---|
| Scene/Blender | env_assets, normalize_env_assets, build_scene, asset manifest | S15 mẫu nhiều góc được duyệt; đủ invariant và đo full-scene runtime |
| Data/Geometry | adapters, geometry, layout/camera, ground/static map | Dataset/transform tái lập; camera và label/LiDAR đúng |
| GPU/3D reconstruction | Kaggle config/checkpoint/export; splat/mesh thử nghiệm | Run có cấu hình, chi phí/thời gian, checkpoint và số đo truy nguyên được; thử nghiệm có cổng dừng |
| ML/Evaluation | eval, dataset split, train baseline/fusion | Có real-only vs real+sim, không leakage, báo mAP trên tập thật |
| Tooling/QA | viewer/FiftyOne, môi trường cài đặt, test/audit, packaging | Team tái lập từ snapshot và bundle dữ liệu/asset; xử lý dependency tồn đọng |

Thứ tự đề xuất: đóng gói snapshot → hoàn tất mẫu S15 → kiểm nhãn/LiDAR → sinh dataset có kiểm soát → G-sim → mở rộng scene và dữ liệu Việt Nam. Không lặp lại TSDF/Poisson chỉ vì có thêm GPU mà chưa có giả thuyết mới và phép đo để chứng minh.

Dữ liệu Việt Nam: hồ sơ ghi 66 frame × 8 camera fisheye + PCD; mới có calibration CAM_P_F, thiếu pose xe. Cần calibration đủ camera, pose/ước lượng chuyển động, adapter và quyết định undistort hay fisheye render trước khi nhận đây là input real-to-sim hoàn chỉnh.

## 9. Cách chạy và kiểm tra

Trước khi chạy: chuẩn bị đúng dataset/asset, tạo venv và cấu hình `backend/config.toml` theo máy; các lệnh dưới giả định môi trường local đã cài. Preset dùng cùng tên run có thể ghi đè output: tạo scenario/tên run riêng cho phép thử mới.

```bash
cd backend
.venv/bin/topeye-sim-layout --scene scene-0061
.venv/bin/topeye-sim-render --scene scene-0061 --selftest
.venv/bin/topeye-sim-render --scene scene-0061 --scenario topeye/sim/blender/scenarios/night.toml
.venv/bin/topeye-sim-view --scene scene-0061
.venv/bin/python -m pytest -q
.venv/bin/ruff check topeye tests scripts
```

Các CLI khác có trong pyproject: `topeye-prepare`, `topeye-export-splat`, `topeye-sim-build`, `topeye-sim-gsdata`, `topeye-sim-fo`. Xem [sim.md](sim.md) để biết venv và tham số phù hợp. Chưa có lệnh chuẩn hoá được xác minh trong lượt này cho việc thuê/submit Kaggle mới; không tự điền lệnh phỏng đoán.

## 10. Những gì phải bàn giao ngoài Git

- `planning/02_2026-10-05_blender-real2sim/`: toàn bộ SPEC, handoff/report và evidence; hiện bị gitignore.
- Dataset gốc theo quyền truy cập của team; không commit dataset hoặc thông tin đăng nhập.
- Asset thực trong `backend/assets/library/`, `pbr/`, `env/` cùng manifest/attribution; ba thư mục asset đang bị gitignore.
- `backend/data/`: layout/cache cần thiết, scenario snapshot, render mẫu, checkpoint và export quan trọng; đang bị gitignore.
- Config tái lập GPU: notebook/script, dependency versions, loại GPU, checkpoint, run ID, thời gian và chi phí nếu có. Bộ hồ sơ hiện chưa đủ để khẳng định các trường này đã được chuẩn hoá.
- Snapshot code: lúc rà có nhiều file modified/untracked; HEAD đọc được là `708e1b1` (S11 procedural PBR). Clone riêng HEAD không chứa hết S12–S15/StreetGS đang có trên máy.
- Tài liệu được supplement nhắc tới `docs/CODEX-NAVIGATION-GUIDE.md` không có trong checkout hiện tại; dùng index, hồ sơ này và SPEC.

Chưa đóng gói dataset/asset, chưa commit/push và chưa khởi chạy job GPU trong phiên xuất tài liệu này.

## 11. Tài liệu nguồn

- [Module sim](sim.md)
- [Kernel](../brain4agent/memory-distill.txt), [index](../brain4agent/index.md), [roadmap](../brain4agent/roadmap.md)
- [Nhật ký](../brain4agent/memory/hot/today.md), [gotchas](../brain4agent/-known-gotchas.md)
- [Kế hoạch 02](../planning/02_2026-10-05_blender-real2sim/plan.md)
- [Kiến trúc](../planning/02_2026-10-05_blender-real2sim/specs/00-ARCHITECTURE.md), [contract](../planning/02_2026-10-05_blender-real2sim/specs/01-CONTRACTS.md), [nghiệm thu](../planning/02_2026-10-05_blender-real2sim/specs/TESTING-ACCEPTANCE.md)
- [S14](../planning/02_2026-10-05_blender-real2sim/specs/SPEC-S14-StreetGS-Mesh.md), [S15](../planning/02_2026-10-05_blender-real2sim/specs/SPEC-S15-Scene-Assembly.md)

Link planning chỉ hoạt động khi team nhận cả thư mục planning cùng cấu trúc. Nội dung chính của hồ sơ này vẫn đọc độc lập được.

## Phụ lục A — Danh mục đầy đủ file nguồn và SPEC

Danh mục chụp tại thời điểm xuất tài liệu; bao gồm file chưa commit. Bỏ qua dependency, cache, binary asset và dữ liệu sinh ra.

### Backend source

```text
backend/topeye/__init__.py
backend/topeye/api/__init__.py
backend/topeye/api/main.py
backend/topeye/config.py
backend/topeye/core/__init__.py
backend/topeye/core/adapters/__init__.py
backend/topeye/core/adapters/base.py
backend/topeye/core/adapters/nuscenes.py
backend/topeye/core/bev.py
backend/topeye/core/box_texture.py
backend/topeye/core/cache.py
backend/topeye/core/calib_check.py
backend/topeye/core/colorize.py
backend/topeye/core/geometry.py
backend/topeye/core/ground.py
backend/topeye/core/object_accum.py
backend/topeye/core/panorama.py
backend/topeye/core/types.py
backend/topeye/export_splat.py
backend/topeye/prepare.py
backend/topeye/sim/__init__.py
backend/topeye/sim/actor_color.py
backend/topeye/sim/blender/build_scene.py
backend/topeye/sim/blender/normalize_assets.py
backend/topeye/sim/blender/normalize_env_assets.py
backend/topeye/sim/blender/render_textured.py
backend/topeye/sim/blender/scenarios/day.toml
backend/topeye/sim/blender/scenarios/day_proc.toml
backend/topeye/sim/blender/scenarios/day_v2.toml
backend/topeye/sim/blender/scenarios/dusk_v2.toml
backend/topeye/sim/blender/scenarios/fog.toml
backend/topeye/sim/blender/scenarios/fog_v2.toml
backend/topeye/sim/blender/scenarios/night.toml
backend/topeye/sim/blender/scenarios/night_proc.toml
backend/topeye/sim/blender/scenarios/night_traffic.toml
backend/topeye/sim/blender/scenarios/night_traffic_v2.toml
backend/topeye/sim/blender/scenarios/night_v2.toml
backend/topeye/sim/blender/scenarios/rain.toml
backend/topeye/sim/blender/scenarios/rain_proc.toml
backend/topeye/sim/blender/scenarios/rain_v2.toml
backend/topeye/sim/blender/scenarios/traffic_generated.toml
backend/topeye/sim/camera.py
backend/topeye/sim/cli.py
backend/topeye/sim/env_assets.py
backend/topeye/sim/fo_dataset.py
backend/topeye/sim/ground_surface.py
backend/topeye/sim/gs_data.py
backend/topeye/sim/labels.py
backend/topeye/sim/layout.py
backend/topeye/sim/map_photo.py
backend/topeye/sim/procedural_layout.py
backend/topeye/sim/static_map.py
backend/topeye/sim/texture_mesh.py
backend/topeye/sim/traffic.py
backend/topeye/sim/view.py
backend/topeye/sim/viewer/index.html
```

### Backend scripts

```text
backend/scripts/bev_evidence.py
backend/scripts/box_atlas_evidence.py
backend/scripts/calib_overlay.py
backend/scripts/fetch_pbr_assets.py
backend/scripts/multiframe_evidence.py
backend/scripts/panorama_evidence.py
backend/scripts/recognize_manifest.py
backend/scripts/s11_pilot.py
backend/scripts/s12_pilot.py
backend/scripts/s13_kid_vn.py
backend/scripts/s15_lookdev.py
backend/scripts/s9_evaluate.py
backend/scripts/sim_evidence.py
backend/scripts/splat_evaluate.py
backend/scripts/splat_projection.py
backend/scripts/streetgs_mesh.py
backend/scripts/streetgs_viewer.html
backend/scripts/topeye-export-splat
backend/scripts/train_splat.py
backend/scripts/train_splat.sh
```

### Splat và evaluation

```text
backend/splat/diagnose_bg.py
backend/splat/test_time_sky.py
backend/splat/test_train_bg.py
backend/splat/train_bg.py
```

### Evaluation

```text
backend/eval/kid.py
backend/eval/recognize.py
backend/eval/test_kid.py
backend/eval/test_recognize.py
```

### Backend tests

```text
backend/tests/test_asset_manifest.py
backend/tests/test_bev.py
backend/tests/test_box_texture.py
backend/tests/test_config.py
backend/tests/test_env_assets.py
backend/tests/test_fo_dataset.py
backend/tests/test_geometry.py
backend/tests/test_nuscenes.py
backend/tests/test_object_accum.py
backend/tests/test_panorama.py
backend/tests/test_processing.py
backend/tests/test_region_vn.py
backend/tests/test_sim.py
backend/tests/test_sim_build.py
backend/tests/test_sim_carla_params.py
backend/tests/test_sim_ground_surface.py
backend/tests/test_sim_gs_data.py
backend/tests/test_sim_library_actors.py
backend/tests/test_sim_map_photo.py
backend/tests/test_sim_procedural.py
backend/tests/test_sim_static_map.py
backend/tests/test_sim_texture_mesh.py
backend/tests/test_sim_traffic.py
backend/tests/test_sim_view.py
backend/tests/test_sim_view_assets.py
backend/tests/test_splat.py
backend/tests/test_streetgs_mesh.py
backend/tests/test_web_env.py
```

### Frontend source

```text
frontend/src/App.tsx
frontend/src/api/client.test.ts
frontend/src/api/client.ts
frontend/src/api/mock.ts
frontend/src/api/mockAtlas.ts
frontend/src/api/mockDense.ts
frontend/src/api/mockPano.ts
frontend/src/api/mockSplat.ts
frontend/src/api/types.ts
frontend/src/components/BirdView.test.tsx
frontend/src/components/BirdView.tsx
frontend/src/components/CalibModal.tsx
frontend/src/components/CameraGrid.test.tsx
frontend/src/components/CameraGrid.tsx
frontend/src/components/Header.test.tsx
frontend/src/components/Header.tsx
frontend/src/components/PaneErrorBoundary.test.tsx
frontend/src/components/PaneErrorBoundary.tsx
frontend/src/components/SurroundView.test.tsx
frontend/src/components/SurroundView.tsx
frontend/src/components/ThreeView.tsx
frontend/src/components/Toast.tsx
frontend/src/components/TopView.test.tsx
frontend/src/components/TopView.tsx
frontend/src/components/ViewMode.test.tsx
frontend/src/geometry/coords.test.ts
frontend/src/geometry/coords.ts
frontend/src/geometry/labels.test.ts
frontend/src/geometry/labels.ts
frontend/src/geometry/ortho.test.ts
frontend/src/geometry/panorama.test.ts
frontend/src/geometry/panorama.ts
frontend/src/geometry/projection.test.ts
frontend/src/geometry/projection.ts
frontend/src/geometry/splatTransform.test.ts
frontend/src/geometry/splatTransform.ts
frontend/src/geometry/textureSource.test.ts
frontend/src/geometry/textureSource.ts
frontend/src/geometry/uv.test.ts
frontend/src/geometry/uv.ts
frontend/src/index.css
frontend/src/main.tsx
frontend/src/perf/benchmark.test.ts
frontend/src/perf/benchmark.ts
frontend/src/perf/fpsTracker.ts
frontend/src/perf/index.ts
frontend/src/perf/stats.test.ts
frontend/src/perf/stats.ts
frontend/src/perf/types.ts
frontend/src/vite-env.d.ts
```

### SPEC kế hoạch 02

```text
planning/02_2026-10-05_blender-real2sim/specs/00-ARCHITECTURE.md
planning/02_2026-10-05_blender-real2sim/specs/01-CONTRACTS.md
planning/02_2026-10-05_blender-real2sim/specs/OPERATIONS.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S1-Layout.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S10-Build-15min.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S11-Procedural-Pilot.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S12-Env-Assets.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S13-Region-VN.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S14-StreetGS-Mesh.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S15-Scene-Assembly.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S2-Blender-Scene.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S3-Render-Labels-Lidar.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S4-Map-Quality.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S5-Web-Scenario-Traffic.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S6-Local-Gaussian-Map.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S7-Carla-Style-Parameters.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S8-Library-Actors.md
planning/02_2026-10-05_blender-real2sim/specs/SPEC-S9-Textured-Mesh-POC.md
planning/02_2026-10-05_blender-real2sim/specs/TESTING-ACCEPTANCE.md
```

### Skills của repo

```text
.agents/skills/nao-commit/SKILL.md
.agents/skills/nao-dong-bo/SKILL.md
.agents/skills/nao-dong-phien/SKILL.md
.agents/skills/nao-ten-phien/SKILL.md
.agents/skills/vai-dieu-phoi/SKILL.md
.agents/skills/vai-dieu-phoi/agents/architect-fable.md
.agents/skills/vai-dieu-phoi/agents/auditor-sonnet.md
.agents/skills/vai-dieu-phoi/agents/judge-opus.md
.agents/skills/vai-dieu-phoi/agents/orchestrator-opus.md
.agents/skills/vai-dieu-phoi/agents/worker-haiku.md
.agents/skills/vai-dieu-phoi/agents/worker-sonnet.md
.agents/skills/vai-thi-cong/SKILL.md
```

### Manifest và cấu hình

```text
.gitignore
backend/assets/ATTRIBUTION.md
backend/assets/env_manifest.json
backend/assets/library_manifest.json
backend/assets/pbr_manifest.json
backend/config.toml
backend/pyproject.toml
frontend/package-lock.json
frontend/package.json
frontend/tsconfig.json
frontend/vite.config.ts
```

## Phân phối source trong monorepo
Theo yêu cầu chủ dự án, source được đóng gói tại `AI20K-Build-Phase-Cohort-4A/P-056/source-tool/topeye`, giữ `backend/` và `frontend/` cùng Git repo, không submodule. README tại thư mục tool hướng dẫn cài đặt. Dataset/checkpoint/render/model/texture không được đóng gói; người nhận cần chuẩn bị local theo manifest và tài liệu. `planning/`/evidence vẫn local nên link nội bộ tới chúng không có trên GitHub.
