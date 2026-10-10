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
- **StreetGS / 2026-10-08:** thế giới của DriveStudio nuScenes = inverse(camera trước đầu tiên) × global; pose học thêm CamPose nhân bên phải, index = frame×6+camera. `layout.json` dùng `origin_global`; điểm `gs/init_points.ply` đã là local scene. Không đoán transform từ hình ảnh.
- **Open3D 0.20 macOS tại máy:** `ScalableTSDFVolume.integrate()` nhận mặt phẳng depth 2 m nhưng xuất 0 voxel/triangle ở cả hai venv. Tensor `VoxelBlockGrid` tạo đúng mặt phẳng (test <1 cm). Tensor integrate yêu cầu depth/color cùng float hoặc uint16/uint8; dùng millimetre uint16 + RGB uint8.
- **3DGS → mesh không bảo đảm kín:** expected depth từ splat 30k + LiDAR, 234 góc, vẫn chỉ phủ 29,3% ảnh camera trước; hai lượt 60/234 góc không đạt. Không lấy mesh thử nghiệm làm dữ liệu train hoặc hứa thay thời tiết chân thực; texture còn ánh sáng đã nướng.
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

- S15: bbox nhà từ LiDAR thường là dải facade sâu <2 m, không phải footprint đầy đủ. Ép asset vào đó loại toàn bộ nhà; completion opt-in phải mở ra phía ngoài road và vẫn qua clearance.
- S15: BVH opacity flatten từng bản sao cây tạo hàng triệu closure/inverse matrix trùng. Chia sẻ BVH mesh local, kiểm ray về local + đổi distance/normal về world; không cache chung object có modifiers.

- **NuRec SDK19→18 calibration (2026-10-08):** converter nuScenes mới xuất `IdealPinhole`, Instant NuRec pin nvidia-ncore18.7 chỉ hiểu `OpenCVPinhole`. Không đổi model/F-theta hoặc backport motion API. Convert bằng SDK19.8, dùng `planning/03_2026-10-08_nurec-static/adapt_pinhole.py` đổi camera metadata sang zero-distortion OpenCV; ảnh/LiDAR byte-identical. SDK18 validator thật pass; roundtrip≤0,000123px. Không dùng `--render-preview/video` F-theta-only cho pinhole.

- **Instant NuRec memory research:** encoder PA alreadyFP16; adding outer autocast may be neutralized by explicit decorators. Loaderdefaultbatch8 staysCUDA while forwards process1chunk. DPTchunk4→1 reduces decoder temporaries, not globalattention/features. `--n-gaussians` affects postmerge voxelization, not encoder peak; no_grad/checkpointing are not new inference savings. T4 below supported minimum is not a measured OOM.

- BrevCLI0.6.335 `refresh` unconditionally downloads cloudflared if absent; slow GitHub transfer can block SSH config generation. Same CLI refresh while cache file exists completed config setup. New pilot host alias used directIP with gateway port62544, causing timeout: direct host SSH22 worked with provisioned Brev key; gateway hostname62544 is a different endpoint. `brev exec <ID> --host` attempted missing `<ID>-host` alias; use instance-name alias. No key/token output. Incomplete cloudflared moved to ignored tools cache, never executed.
- NuRec layer label matching is exact/case-sensitive: nuScenes car/truck/bus/construction_vehicle need responsible rigid layer config; parked vehicles require static_rigids if clean reusable background is desired. Do not assume motion classification alone separates all cars.

### NuRec26.04 nuScenes LiDAR 4340 columns (2026-10-08)
- First native full trainer failed beforestep1 with exit255: RowOffsetStructuredSpinningLidarProjection.__post_init__ rejects n_columns4340 without angles_to_columns_map (>4096 fallback limit). Native converter passes no map. Not OOM.
- Isolated pilot patch calls existing ensure_angles_map() after angular shape validation and before dtype/limit validation, only when no map and columns>4096. Geometry/data unchanged; small sensor unchanged. Pinned original/patched SHA guards; reapply no-op. Native red reproduced, green5/5exit0. Recovery verified on scene0103 beyond30000steps; full40000/native-render quality still pending. Files in ignored planning/03_2026-10-08_nurec-static/; do not treat as accepted environment.

### NuRec native PLY temporal DC is not standard scalar RGB (2026-10-08)
- Background fourier_features_dim=5 exports f_dc_0..2 as uchar-counted lists of5float; Spark standard3DGS reader rejects. Road has scalarDC and loads. Native source initializes features_albedo[:,0,:] as basecolor.
- Preview-only canonical_ply.py selects coefficient0 for eachDC while preserving every other scalar field bitwise;892020Gaussians,59properties,210518197bytes. OriginalnativePLY+USDZ preserved; temporalcolor discarded only in derivedpreview, not a renderer-equivalent result. Browserloaded background+road successfully; vehicles absent but occlusion/shadow/floaters remain.
- checkpoint.save_on_preemption=True only registers nativeSIGUSR1 callback when PID_PATH exists (also requiresSLURM_PROCID). This pilot does not setthose; rely on completed10k-stepcheckpoints, not an assumed arbitrary-step signal save.

- NuRec quality comparison: pilot nativepreset train/valsubsample4 (~400×225 nuScenes) and genericSparkpreview onlytemporalDCindex0, nofullnativepipeline. InspectnativeUSDZrender before judging weights; raisingstepcountalone doesnotfixmissingappearance/occlusion. Scene0103 candidate2x (~800×450) is running beyond30000steps onL40S; no quality guarantee from resolution/steps alone. Weights-only continuation resetsoptimizer; mustinspect nativeglobalstep/LRschedule/densification semantics beforeclaiming last10k equalsfullresume.

### NuRec checkpoint and transport retention (2026-10-09)
- Native USDZ can close a few seconds before last.ckpt is rewritten. Associate a closed fullcheckpoint only when its mtime >= the corresponding closedUSDZ; confirm actual global_step from trustedcheckpoint, never infer it from a localfolder label. USDZ modelweights are not the fulloptimizerresumecheckpoint.
- TLSparallel transfers occasionally stalled on one4MiB part while others completed. Keep verifiedparts and retryonlymissing/badhash parts; finite connect/transfer/low-speedtimeouts avoid consuming the trial on a stalledconnection. WholeartifactSHA remains mandatory before accepting output.

- Finalscene0103 backup: parallel64+64 over sharedbandwidth causedmany4MiB timeout/retry loops. Sequentialartifactdownloads withparallel16 completed; verifiedparts reused. Arbitraryshortmax-time can discardpartialbytes repeatedly. WholeSHA/CRC/allPNGdecode passed after retries. NativefullCP maypickleOmegaConf; MacSDKvenv withoutomegaconf cannotload it, while pinnednativeimage loaded40000/16optimizer/97finitetensors successfully. Do not diagnosecorruption frommissinglocalruntimepackages or changeproductiondependencies for this isolatedexperiment.


### NuRec interactive preview is not realistic simulation
2026-10-09 quality rejection: user reports broken scene0103 and rejects it for realistic simulation. Directly inspected native source/camera_front/000114.png: softbuilding/road details already present; genericWebGL middle-canvas.png has additional sky artifacts and softened appearance. Comparison not pixelaligned (differentFOV/pose and actorsomitted), so do NOTattribute all degradation to export/LOD. ExportintegrityPASS is not visualqualityPASS. No newtrain/paidjob authorized. Interactivepreview is NOT simulation-ready; collision, relighting/weather and nativeappearance notimplemented.

2026-10-09 clarification: user finds nativevideo acceptable, interactive3D muchmorebroken. Supersedes inference that nativequality is primaryblocker. Confirmed from Spark2.3.1 source/docs: default PackedSplats positionsfloat16, defaultLODgenerated; audit background31centersoutsideFP16finite range,588beyond3000m; float32inputmax2422217. Candidate viewer ?precision=1 uses extSplats:true, accumExtSplats:true, enableLod:false/lod:false, countguard2285393; defaultmodeunchanged. JSsyntaxPASS. VisualeffectUNMEASURED; browser14hardstop/usercontrol, MUSTwaitexplicitcontinuebeforeclaim/resume. No train/job/paidresource.


## N3-09B — 2026-10-09
- esmini tự dịch bounding center khi RearAxle positionX khác 0. Replay vị trí chọn RearAxle X=0; engine đọc lại/assert dimensions và center offsets tại t0. Không suy từ sai số XY nhỏ rằng hộp va chạm đã đúng.
- Gap >1s cắt qua biên clip phải kiểm trên mọi cặp observation giao interval; lọc rows trong start±1s có thể bỏ mất bracket lỗi.
- Không xóa timer SIGKILL khi leader thoát: descendant có thể còn sống. Chờ cả process group, chặn worker mới trong shutdown.
- Atomic JSON dùng mkstemp exclusive ngẫu nhiên + replace; file .tmp dự đoán được có thể là symlink vào dataset.
- Recovery phải nhận dataset root, bỏ qua status bên trong dataset dù workspace là thư mục cha; JSON [] không có .get, phải kiểm dict trước. Malformed project không được khóa toàn app.
- Polyline nội suy dữ liệu 2Hz rồi sai phân ở20Hz có thể vượt ngưỡng gia tốc. Giữ fail report, chọn clip nguồn phù hợp, không nới ngưỡng/giấu spikes. scene0103 actor f399… giây3–8:0/4fail; actor ec0e… clip giao10,4–13:4/4pass.
- Test đóng app phải đối chiếu PID/PPID của đúng phiên, không gom mọi process có cùng binary path; có thể có app Topeye khác đang mở.
- PyInstaller --add-data được giải theo thư mục .spec; dùng đường tuyệt đối cho schema. @electron/packager20 dùng named export {packager}.

## Scenario 3D (0.4.0)
- World XYZ → Three `[x,z,-y]`; yaw quanh Y giữ đúng hướng. Annotation center khác ground-origin của ego.
- Replay 20Hz có thể kết thúc trước duration lẻ; dùng mẫu cuối chung làm playback end. Thiếu track/gap không được fallback sang reference hoặc giữ pose ngoài support.
- Bike demo scene0103 cách ego khoảng75m: nhỏ trong camera bám xe là đúng dữ liệu; chọn Toàn cảnh để thấy cả hai, không kéo actor lại gần để làm đẹp.

## Source scene v0.5.0
- Ped-crossing overlay must copy polygon holes independently of the base mesh; regression ray into hole caught filled stripe geometry.
- Missing/invalid LiDAR raises adapter DatasetError: source viewer retains actors/map and marks environment incomplete; no fabricated replacement.
- Original source IDs must never enter simulator cache; only validated extracted clips can export/replay.
- Node `cpSync` mặc định có thể biến symlink PyInstaller thành đường tuyệt đối về build tree. Khi chép worker dùng `verbatimSymlinks:true`; package phải kiểm mọi link nằm trong bundle và `codesign --verify --deep --strict`.

## 2026-10-09 — Sensor view regression fixes
- Removing `.scene3d`/canvas/HUD sizing while keeping component class names clips controls and leaves canvas at default height. Keep explicit scoped CSS; unit tests mocking TrackView do not prove layout.
- SVG `path d` requires numeric coordinates, not `calc()` or percentages. Map now builds numeric paths and evenodd holes from source vectors.
- Checkbox state alone does not control a view. Verify actual DOM visibility and timeline-driven positions; remove decorative controls and fabricated telemetry.
- After worker cancellation, a pending renderer promise can still settle. Guard each awaited job result with generation ownership, suppress stale errors/finally, invalidate before cancel; regression includes late successful resolve.


## Imported scenarios v0.9.0
- Python JSON floating literals lose int/float/signed-zero representation through Node serialization; map hashes normalize numeric leaves (preserve double precision/bools) or exported context cannot be reloaded. Actual Node red/green evidence in plan11.
- nuScenes mini0103/0655 raw road_segment polygons self-intersect; reject map context, no silent repair. LiDAR estimated building rings may self-intersect; collision context universally derives conservative convex envelopes while leaving source renderer unchanged.
- OpenSCENARIO object reference point differs from bbox center. Apply rotated offsets for display/map and center dynamics, including offset-rotation arcs; stationary reference can have a moving center. Sparse original yaw replay can diverge in esmini; normalized imports are densified and imported-only traj_filter0; engine fidelity thresholds unchanged. Stationary rotation may still report execution failure.
- 32actors/time samples produce huge contact arrays; aggregate per pair (max496), compact IPC poses, bound7MiB responses and2MiB normalized XML before publishing. Imported engine inherits worker process group so cancel/quit owns cleanup.


2026-10-10 plan12: presentation ring validation must reject inclusive nonadjacent touches/pinches/overlap and adjacent retraces; strict crossing alone misses malformed rings. Source invalid road polygons remain omitted with visible diagnostic, authoritative importer unchanged. Native Electron QA runs sequentially: concurrent visible-window scripts can close each other and produce false page-closed failures. Bundled GLB uses .base64?raw with Vite5; ?inline did not guarantee GLB inlining, so offline parsing is tested with zero fetch. Asset templates attach to a hidden scene vault before instantiation, ensuring shared GPU resources remain owned even on exception.


2026-10-10 stop-region patch: nuScenes stop_line polygons describe stoppingareas, not pavement paint. Never fill their fullpolygons white or infer a paintedstripe from bounds; source semanticJSON stays unchanged. Native foreground benchmarks require scene/time checks throughout sampling; a run changed scene/time mid-sample and was rejected (plan13/evidence/performance-interrupted.txt). Isolate input on the owned measurement window to avoid recording an uncontrolled mixed workload.


### Environment contact investigation — 2026-10-10T09:40:24+07:00
Owner reports floating vehicles and wall penetration in0.10.1. Read-only source audit: roadScene uses one constantfloor (min egoZ−0.08), source annotation centers retain measuredZ and median actorheight. EgoZ range0 across all10mini scenes; traffic bboxbottom−displayfloor ranges scene0061−0.38..1.16m,0103−1.16..1.45m,0553−1.02..3.20m; this explains airborne/sunken appearances and does not prove vehicle dynamics failure. Estimatedbuilding footprints overlap actual vehicle tracks:0061=2includingego/truck,0655=11,0757=1,0916=2bicycles;0103/0553/0796/1077/1094/1100=0 insampledfootprint probe (XYintersectionarea>0.05m²,verticaloverlap checked for eight-scene extension). Footprints are simplified LiDAR estimates; invalidrings render convexenclosures. Kinematic source playback has no staticwall/ground collisionresponse. Fix requires synchronized terrain/contact display and refinement/masking ofestimated static geometry while preserving originalposes/mapconformance/importdigest. No product edit/versionbump or confirmedphysicssolver defect.

### Terrain drape gotchas — 2026-10-10T12:35:21+07:00 (plan14)
- Per-triangle adaptive subdivision creates T-junction cracks (465–1365 >2 cm/scene, max 0.34 m). Split decisions MUST be per edge (endpoints only) with longest-edge propagation; red-green splitting without it never terminates (sliver fans).
- Uniform ≤1 m drape exhausts a 250 k budget; never count drape fallbacks as "Map nguồn … vùng hình học lỗi" (they are presentation limits → contact notice).
- Per-cell LiDAR plane fits accept roofs/overpass decks (10–12 m in 0916) and roads drape into vertical walls. A slope bound 0.35·d+0.3 checked against ANY neighbour within 20 m is useless (tolerance grows to 7 m; 0061 5.48 m spike passed): judge by local majority within 8 m, nearest otherwise, and include annotation anchors in the reference (1077).
- T-junction probes must exclude buildings/facades/trees (vertical walls project onto the same 2D points → false gaps) and state tolerance.

### UI/style gotchas — 2026-10-10T13:45:47+07:00 (plan15)
- Legend swatches must not reuse map shape classes (`map-ego`, `map-class-*`): the legacy desktop gate locates `.map-ego` strictly and fails on duplicates; use `map-swatch-*`, prefixed by `.map-legend` to beat `.map-legend .map-swatch` specificity (otherwise all swatches render white — happy-dom tests cannot see computed CSS; check colours in the installed gate).
- package-lock.json also contains dependency versions equal to the next app version; bump only lines 3 and 9, never a global replace.
- Contact notice sits above the camera button row (bottom 120 px) or it covers new buttons.
- OrbitControls.update() runs even with `enabled=false` and clamps the polar angle: a scripted camera (cabin) must use lookAt directly, never controls.update().
- Overlay parts (lamps/glass) placed flush with a rounded body face are fully occluded; keep the body face inset and verify with a raycast test, not bbox checks. Box3.setFromObject does not update parent matrices — call root.updateMatrixWorld(true) first in tests.
- Measurement attributes for gates must read the rendered state (camera.position before render), never recompute the intended formula — otherwise the gate stays green on the very bug it guards.

### Load/UI gotchas — 2026-10-10T15:20:28+07:00 (plan16)
- source_scene JSON has a random uuid4 `id`: byte-compare outputs only after dropping it.
- An LRU smaller than a sequential sweep (8 vs 10 mini scenes) never hits; size caches to the working set and measure revisits.
- `.studio button.primary` (min-height 48 px) outranks single-class header rules; header sizing selectors need `.studio .header-actions>button`.


## Source unsupported terrain / body overhang contact — 2026-10-10T15:46:15+07:00
- With heightAt=null or >1.5m annotation-to-ground offset, former raw-Z fallback kept cars airborne while displayed surface faded to the flat backdrop;0916 gap4.1665m. Source display now uses surfaceAt; support confidence remains separately disclosed. Preserve raw coordinates and measured/imported/replay fidelity.
- Do not use outer body bbox corners as wheel supports: overhangs over a hump lift every wheel. Use axle rectangle ±0.3length/±0.4width and apply the same YZX rotation before fitting contact. This is an approximate support footprint, not exact tire geometry/suspension or bridge reconstruction.
- Installed source window closed once with concurrent imported acceptance; isolated retry/final run passed. Same class of transient event exists in plans14/16; cause still unconfirmed. Prefer sequential native QA and retain failed outputs.
