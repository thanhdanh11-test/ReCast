# Project brief: BEV Fusion Viewer cho 3D labeling (LiDAR + 8 camera)

> File này dùng để giao cho Claude Code. Đọc hết trước khi code. Phần "Câu hỏi cần hỏi trước" phải được trả lời trước khi bắt đầu Phase 1.

## 1. Bối cảnh

- Team làm **3D labeling dữ liệu xe tự lái**. Mục tiêu dài hạn là pipeline **auto-labeling** cho dữ liệu có sẵn, đầu ra gồm **3D bounding box + track ID + attribute**. Người gán nhãn sửa label trong **CVAT**.
- Dữ liệu có **LiDAR** và **8 camera surround**: front, front-left, front-right, left, right, back-left, back-right, back.
- Vấn đề: khi label, người gán nhãn phải chuyển qua lại giữa point cloud và 8 ảnh riêng lẻ, nên khó có cái nhìn tổng thể về không gian giao thông.

## 2. Ý tưởng gốc

- Ghép 8 camera thành ảnh 360° và chiếu lên một **cái bát úp ngược** (bowl view, giống 3D surround view trong hệ thống hỗ trợ đỗ xe).
- **Thành bát** hiển thị ảnh camera. **Đáy/miệng bát** hiển thị point cloud LiDAR nhìn từ trên (BEV).
- Mục tiêu cuối: có một **top view giống ảnh chụp từ drone** để label chính xác hơn.

## 3. Vấn đề kỹ thuật đã xác định và hướng giải quyết

- **Parallax / ghosting:** bowl projection chỉ đúng với điểm nằm trên mặt bát. Xe và người không nằm trên mặt bát nên bị kéo méo hoặc nhân đôi ở đường ghép giữa các camera. Chiếu ảnh thẳng xuống mặt đất (IPM) cũng làm vật cao bị kéo dài.
- Camera gắn trên xe không nhìn thấy nóc xe/nóc nhà, nên **không thể có ảnh drone thật**.
- **Giải pháp đã chọn: tách top view thành 2 lớp**
  - **Lớp 1 – Ground layer (mặt đường):** IPM từng frame, dùng độ cao mặt đất lấy từ LiDAR (không giả định đường phẳng), rồi ghép nhiều frame theo ego pose thành một mosaic. **Phải mask vùng vật thể động** (dựa vào box 3D hoặc segmentation 2D) trước khi ghép để tránh vệt mờ.
  - **Lớp 2 – Object layer (vật thể):** không dùng ảnh. Hiển thị **point cloud LiDAR tô màu từ camera** cùng box 3D. Hình học lấy từ LiDAR nên đúng.
  - **Bowl view:** chỉ là chế độ xem phụ, dùng làm ngữ cảnh cho vùng xa ngoài tầm LiDAR. Có thể làm adaptive bowl (nắn hình bát theo khoảng cách LiDAR).

## 4. Kiến trúc đề xuất (module)

1. **Data adapter:** đọc frame (LiDAR, 8 ảnh, calibration, ego pose, timestamp). Viết theo interface để hỗ trợ nhiều format (nuScenes / KITTI / rosbag / format riêng). Format thực tế: **TBD, hỏi người dùng**.
2. **Calib & sync checker:** chiếu LiDAR lên từng ảnh để kiểm tra bằng mắt; báo độ lệch timestamp giữa LiDAR và từng camera.
3. **Point cloud colorizer:** chiếu từng điểm vào các camera, xử lý che khuất bằng z-buffer, chọn camera nhìn tốt nhất (gần trục quang học nhất, ít méo nhất), bù ego-motion nếu có timestamp từng điểm.
4. **Ground layer builder:** tách điểm mặt đất (RANSAC hoặc grid-based ground fitting), IPM theo độ cao mặt đất đó, ghép nhiều frame theo pose, mask object, blend và cân bằng sáng giữa các camera. Output: ảnh BEV kèm metadata (độ phân giải m/pixel, gốc tọa độ).
5. **Viewer:** chế độ top view orthographic, bật/tắt từng lớp (ground / colored points / raw points / boxes); chế độ bowl view phụ; chọn frame hoặc scrub timeline.
6. **Label I/O:** đọc và hiển thị box 3D (từ auto-label hoặc label tay); export/import sang CVAT (Kitti Raw Format hoặc Sly Point Cloud Format).
7. **(Sau) Auto-label integration:** detector LiDAR (CenterPoint, qua OpenPCDet/MMDetection3D) → tracking → refine theo track → đẩy vào CVAT.

**Tech stack mặc định** (đổi được nếu người dùng muốn): Python (numpy, opencv, open3d) cho xử lý; viewer là web app (three.js) hoặc Open3D GUI cho bản đầu.

## 5. Lộ trình

- **Phase 0 – Script prototype:** từ khoảng 20–50 frame liên tiếp, xuất **1 ảnh PNG top view** gồm ground mosaic, colored points và box (nếu có). Không cần train gì.
  - *Done khi:* ảnh rõ vạch kẻ đường, xe/người hiện thành cụm điểm có màu, không có vệt mờ của xe đang chạy.
- **Phase 1 – Viewer:** xem tương tác, bật/tắt layer, đổi frame, có chế độ bowl view.
- **Phase 2 – Label workflow:** hiển thị và sửa box trên top view, export sang CVAT.
- **Phase 3 – Nâng cấp chất lượng (tùy chọn):** thay ground layer bằng **RoMe** (github.com/DRosemei/RoMe, có config sẵn cho nuScenes và KITTI) hoặc thử 3D Gaussian Splatting (Street Gaussians).

## 6. Rủi ro đã biết

- Calibration sai hoặc đồng bộ thời gian lệch (vài chục ms là màu và ảnh trượt khỏi vật thể).
- Độ sáng và cân bằng trắng khác nhau giữa 8 camera, tạo đường nối lộ rõ.
- Che khuất: điểm LiDAR thấy được nhưng camera không thấy sẽ bị tô sai màu.
- Dốc lớn hoặc mặt đường không phẳng (RoMe bản đầu cũng yếu ở điểm này).
- Pose drift khi ghép nhiều frame.
- CVAT không có sẵn kiểu view này, nên viewer là app riêng chạy song song với CVAT.

## 7. Câu hỏi cần hỏi người dùng trước khi code

1. Dữ liệu đang lưu theo format gì (nuScenes, KITTI, rosbag hay format riêng)? Có sample data không?
2. LiDAR bao nhiêu tia, gắn ở đâu? Camera là pinhole hay fisheye?
3. Có sẵn ego pose (GNSS/INS hoặc odometry) không, hay phải tự tính?
4. Calibration (intrinsic/extrinsic) lưu ở đâu, định dạng gì?
5. Viewer nên là web app hay desktop app? Máy chạy có GPU không?
6. Đã có box 3D nào (label tay hoặc từ model) để test overlay chưa?

## 8. Tham khảo

- RoMe: Road surface reconstruction via mesh representation — arXiv 2306.11368, github.com/DRosemei/RoMe
- EMIE-MAP: road surface reconstruction dùng explicit mesh + implicit encoding — arXiv 2403.11789
- Eker et al., "A Real-time 3D Surround View Pipeline for Embedded Devices" (2022) — bowl view
- Offboard 3D Object Detection from Point Cloud Sequences (Qi et al., CVPR 2021) — auto-labeling
- OpenPCDet, MMDetection3D, CenterPoint
