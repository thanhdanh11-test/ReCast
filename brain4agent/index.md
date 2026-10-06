# Project Index Map & Navigation Router

Tệp này là **Bản Đồ Chỉ Mục Trung Tâm (Master Index Map)** của dự án. Mọi AI Agent sử dụng tệp này để định tuyến tài liệu và nắm bắt toàn bộ bản đồ cấu trúc mã nguồn, luồng giao tiếp và các điểm vào (Entry Points).

---

## 🧭 1. ĐIỀU HƯỚNG TÀI LIỆU & KẾ HOẠCH (Documentation & Planning Router)

Khi nhận nhiệm vụ, Agent tra cứu bảng này để đọc **chính xác** tài liệu chuyên sâu liên quan:

| Lĩnh vực / Nhiệm vụ | Tài liệu chuyên trách | Nội dung chính |
| :--- | :--- | :--- |
| **Ký ức nóng phiên gần nhất** | [`memory/hot/today.md`](memory/hot/today.md) & [`state.json`](memory/hot/state.json) | Trạng thái máy (JSON), nhật ký làm việc theo phiên và kết quả benchmark gần nhất. |
| **Khởi động / Quy tắc chung** | [`memory-distill.txt`](memory-distill.txt) | Kernel hiện trạng, Startup Protocol, Tech stack cốt lõi. |
| **Tổng quan dự án** | [`project-intro.md`](project-intro.md) | Mục tiêu, kiến trúc tổng thể. |
| **Kế hoạch nâng cấp & RFCs** | [`planning/`](../planning/) | Thư mục chứa các bản kế hoạch theo chuẩn `[STT]_[YYYY-MM-DD]_[Ten-Ngan]`. |
| **Lỗi khó / Cạm bẫy / Gotchas** | [`-known-gotchas.md`](-known-gotchas.md) | Tổng hợp các bẫy kỹ thuật và lỗi dị biệt đã gặp. |
| **Kiến trúc dữ liệu & Data Flow** | [`-data-architecture.md`](-data-architecture.md) | Cấu trúc dữ liệu, cơ chế lưu trữ và State Flow. |
| **Lộ trình nâng cấp & Ý tưởng** | [`roadmap.md`](roadmap.md) | Active tasks, Kho Ý Tưởng (Idea Vault) và các mốc đã hoàn thành. |
| **Lịch sử cập nhật** | [`changelog.md`](changelog.md) | Lịch sử Semantic Releases (vX.Y.Z). |
| **Tài liệu kỹ thuật module** | [`docs/`](../docs/) | Tài liệu 1-1 cho từng module. Hiện có: [`docs/sim.md`](../docs/sim.md) (real-to-sim). |
| **Kế hoạch active** | [`planning/02_2026-10-05_blender-real2sim/`](../planning/02_2026-10-05_blender-real2sim/plan.md) | Real-to-sim bằng Blender: SPEC, bằng chứng, exit gate. |

---

### 🛠️ 1.2. Bảng Định Tuyến Kỹ Năng Chuyên Dụng (Workspace Skills Router - `.agents/skills/`)

| STT | Tên Skill (`.agents/skills/`) | File Quy Chuẩn (`SKILL.md`) | Vai Trò & Chức Năng Cốt Lõi |
| :---: | :--- | :--- | :--- |
| **1** | `nao-dong-bo` | `SKILL.md` | Đồng bộ não bộ (engine quản lý). |
| **2** | `nao-commit` | `SKILL.md` | Đề xuất & thực hiện commit theo luật D. |
| **3** | `nao-dong-phien` | `SKILL.md` | Đóng phiên, ghi ký ức nóng. |
| **4** | `nao-ten-phien` | `SKILL.md` | Đặt tên phiên. |
| **5** | `vai-dieu-phoi` | `SKILL.md` | Vai super orchestrator + hồ sơ vai trong `agents/`. |
| **6** | `vai-thi-cong` | `SKILL.md` | Vai worker thi công. |

---

## 🗺️ 2. BẢN ĐỒ CẤU TRÚC MÃ NGUỒN (Codebase Directory Map)

```text
project-root/
├── AGENTS.md / CLAUDE.md             # Luật tối thượng (nguồn chân lý) + shim Claude Code
├── brain4agent-v1.7.1.md             # [MARKER] Phiên bản khung não
├── PROJECT_BRIEF.md · REVIEW.md      # Ý tưởng gốc + tranh luận khả thi (2026-10-03)
├── brain4agent/                      # [BỘ NHỚ DỰ ÁN] 8 phân vùng (xem §1)
├── planning/                         # Chỉ local (gitignore). Kế hoạch 01 đã xoá 2026-10-06
│   └── 02_2026-10-05_blender-real2sim/   # 🚧 ACTIVE — real-to-sim Blender (specs/, evidence/)
├── docs/
│   └── sim.md                        # Tài liệu module `topeye.sim` (CLI, contract, vận hành)
├── backend/                          # Python 3.12, package `topeye` (venv: backend/.venv)
│   ├── config.toml                   #   nusc_root, cache_root, blender_bin (tuỳ chọn)
│   ├── topeye/core/                  #   Lõi dùng chung: adapters/nuscenes, geometry, ground, colorize, bev, object_accum…
│   ├── topeye/sim/                   #   ★ Real-to-sim (kế hoạch 02)
│   │   ├── camera.py                 #     OpenCV K/pose → tham số camera Blender
│   │   ├── layout.py                 #     Scene thật → layout.json + ground/static PLY + raster sơn/vùng đi được
│   │   ├── labels.py                 #     Label YOLO 2D + 3D từ layout + visibility
│   │   ├── cli.py                    #     topeye-sim-layout / topeye-sim-render
│   │   ├── view.py + viewer/         #     topeye-sim-view: web viewer three.js (localhost)
│   │   └── blender/                  #     build_scene.py (bpy, KHÔNG import topeye) + scenarios/*.toml
│   ├── topeye/api/ · prepare.py      #   (kế hoạch 01) FastAPI viewer + CLI cache
│   ├── scripts/sim_evidence.py       #   Ảnh so sánh thật/sim + chỉ số LiDAR → planning/02/evidence
│   ├── tests/                        #   pytest (108); test_sim.py cho topeye.sim
│   └── data/                         #   (gitignore) cache/, sim/<scene>/{layout…, runs/<scenario>/}
├── frontend/                         # (kế hoạch 01) React/TS/Vite/three.js viewer
├── .agents/skills/ · .claude/        # Skill vault + shim (engine sinh)
```

### 2.1. Entry Points
| Lệnh | Vai trò |
| :--- | :--- |
| `cd backend && .venv/bin/topeye-sim-layout --scene scene-0061` | Xuất bố cục scene thật cho Blender |
| `.venv/bin/topeye-sim-render --scene scene-0061 --selftest` | Kiểm camera Blender khớp OpenCV (< 0,5 px) |
| `.venv/bin/topeye-sim-render --scene scene-0061 --scenario topeye/sim/blender/scenarios/night.toml` | Render + LiDAR + label |
| `.venv/bin/topeye-sim-view --scene scene-0061` | Xem map 3D trên web (http://127.0.0.1:8770) |
| `.venv/bin/python scripts/sim_evidence.py --scene scene-0061 --run day night rain fog` | Bằng chứng nghiệm thu |
| `.venv/bin/python -m pytest -q` · `.venv/bin/ruff check topeye tests scripts` | Cổng test/lint |
| `topeye-prepare` / `uvicorn topeye.api.main:app` | (kế hoạch 01) cache + API viewer |
