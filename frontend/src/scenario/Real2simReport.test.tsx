// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Real2simReport } from "./Real2simReport";
import type { EsminiCheck, ReactiveDetail } from "./reactiveTypes";
import type { Real2simReport as Report } from "./types";

afterEach(cleanup);

/** report.json["topeye"] (plan46 C2): car_154 half/4, baseline collides, pilot mild. */
/** A small report.json["topeye"] block (plan46 C2) for the report tests: car_154 half/4, baseline collides, pilot mild. */
const reactiveDetail: ReactiveDetail = {
    version: "topeye-reactive-v2",
    summary: "Dùng được · phanh nhẹ là đủ (xe của bạn phanh 1,2 m/s²).",
    comparison: {
        baseline: { valid: true, group: "collision", reasons: [], ego: { min_gap: 0, min_ttc: 0.4, a_min: 5.2, a_used: null, conflict_with: "car_154" },
            collisions: [["ego", "car_154", 3.1, "ego"]], reacted: [] },
        pilot: { valid: true, group: "mild", reasons: [], ego: { min_gap: 4.2, min_ttc: 2.8, a_min: 1.1, a_used: 1.2, conflict_with: "car_154" },
            collisions: [], reacted: ["ego", "car_200"] },
    },
    checks: [
        { id: "esmini", passed: null, value: null, threshold: null, unit: "", t: null, detail: "Chưa kiểm: esmini chạy sau khi tạo kịch bản" },
        { id: "physics", passed: true, value: 4, threshold: 8.2, unit: "m/s²", t: 1.2, detail: "car_154 phanh 4,0 m/s² (giới hạn 8,2)" },
        { id: "label", passed: true, value: null, threshold: 5, unit: "m", t: null, detail: "Không có vi phạm vật lý" },
        { id: "collision", passed: true, value: 0, threshold: 0, unit: "m", t: null, detail: "Không có xe nào đâm nhau" },
        { id: "tailgate", passed: true, value: 3.4, threshold: 0.5, unit: "m", t: 2, detail: "Không có xe nào bám sau xe đổi chuyển động khi > 3 m/s" },
        { id: "merge", passed: true, value: null, threshold: 30, unit: "°", t: null, detail: "Không có va chạm nhập làn" },
        { id: "appear", passed: true, value: null, threshold: 2, unit: "s", t: null, detail: "Không có xe mới vào khung hình" },
    ],
    excused: [["car_300", "car_301", 4.5]],
    series: {
        t: [0, 0.1, 0.2, 0.3],
        vehicles: { car_154: { v: [10, 9.6, 9.2, null], v_rec: [10, 10, 10, 10], a: [0, -4, -4, null] }, ego: { v: [9, 9, 8.9, 8.8], v_rec: [9, 9, 9, 9], a: [0, 0, -1.2, -1.2] } },
        ego: { gap: [12, 11.5, null, 10.9], ttc: [99, 20, null, 6] },
    },
    markers: [{ t: 0, kind: "brake_start", agent: "car_154" }, { t: 0.2, kind: "reacts", agent: "ego" }, { t: 0.3, kind: "closest", agent: "ego", value: 10.9 }],
    vehicles: {
        car_154: { role: "event", modes: [[0, 0.3, "event"]], leaders: [], T: null, s0: null, T_source: "default", s0_source: "default", max_decel: 8, decel_used: 4, min_gap: null },
        ego: { role: "ego", modes: [[0, 0.1, "nominal"], [0.1, 0.2, "waiting"], [0.2, 0.3, "driving"]], leaders: [[0, 0.3, "car_154"]],
            T: 1.46, s0: 2, T_source: "measured", s0_source: "default", max_decel: 8, decel_used: 1.2, min_gap: 10.9 },
    },
    trigger_note: "Kịch bản xuất ra là quỹ đạo tính sẵn: các xe khác không phản ứng lại phần mềm lái của bạn.",
};

const team: Report = {
    id: "car_154", scene: "scene-0103", source: "topeye", valid: true, reasons: [], group: "mild",
    event: { actor: "car_154", t0: 0, decel: 4, target: "half", dwell: 0 },
    drivers: { react: true, reaction_s: 1, thresholds: {}, per_vehicle: { ego: { T: 1.46, s0: 2, max_decel: 8 } } },
    ego: { a_min: 1.1, a_used: 1.2, min_gap: 4.2, min_ttc: 2.8, conflict_with: "car_154", recorded_min_gap: 10.3 },
    reacted: ["ego"], max_decel_used: { ego: 1.2 }, physics: { ego: { max_speed: 9, max_decel: 1.2, limit_decel: 8.2 } }, gaps: {}, collisions: [],
    esmini: { exit: 0, version: "v3.9.0", problems: [], replay_error_m: { ego: { mean: 0, max: 0.0001 } } },
    run: { created: "2026-10-15T10:00:00", commit: "cdd902d92b", dirty: true, esmini_version: "v3.9.0", dt: 0.05, road: "map" },
};
const withDetail = (detail: ReactiveDetail = reactiveDetail): Report => ({ ...team, topeye: detail });
const check: EsminiCheck = { version: "esmini-check-v1", exit: 0, esmini_version: "v3.9.0", missing: [], replay_error_m: { ego: { mean: 0.001, max: 0.004 } },
    max_error_m: 0.004, accel_max_mps2: 4.1, edge_skip_s: 0.2, passed: true, skipped_reason: null };
const block = (name: string) => screen.getByRole("region", { name });

describe("Real2simReport with a reactive detail (plan46)", () => {
    it("shows the 8 blocks in order: verdict, baseline/pilot, checks, charts, vehicles, sensitivity, esmini, trigger note", () => {
        render(<Real2simReport report={withDetail()} diagnostics={[]} onSensitivity={() => new Promise(() => {})} esmini={null} onEsminiCheck={() => {}}/>);
        const names = ["Kết luận", "Baseline và pilot", "Kiểm tra hợp lệ", "Biểu đồ", "Các xe", "Thử độ nhạy", "Độ khớp esmini", "Kích hoạt theo thời gian"];
        const regions = screen.getAllByRole("region").map(r => r.getAttribute("aria-label"));
        expect(regions.filter(n => names.includes(n!))).toEqual(names);
        // 1. verdict: summary + reader-facing group with its "?"
        expect(within(block("Kết luận")).getByText(reactiveDetail.summary)).toBeTruthy();
        expect(within(block("Kết luận")).getByText("phanh nhẹ là đủ")).toBeTruthy();
        expect(within(block("Kết luận")).getByRole("button", { name: "Giải thích: Phanh nhẹ là đủ" })).toBeTruthy();
        // 2. baseline and pilot on the same event
        const compare = block("Baseline và pilot");
        expect(within(compare).getByRole("cell", { name: "xe của bạn đâm" })).toBeTruthy();
        expect(within(compare).getByRole("cell", { name: "ego – car_154 @3,1 s" })).toBeTruthy();
        expect(within(compare).getByRole("cell", { name: "4,20 m" })).toBeTruthy();
        expect(within(compare).getByRole("button", { name: "Giải thích: Xe phía sau phản ứng" })).toBeTruthy();
        // 3. checks: 7 rows, esmini not checked yet, excused overlap listed
        const checks = block("Kiểm tra hợp lệ");
        expect(within(checks).getAllByRole("row")).toHaveLength(8);
        expect(within(checks).getByRole("cell", { name: "chưa kiểm" })).toBeTruthy();
        for (const term of ["esmini chạy hết", "Giới hạn vật lý", "Dữ liệu nguồn cần kiểm tra", "Không xe nào đâm nhau", "Bám sát phi lý", "Nhập làn, cắt ngang", "Xe vừa vào khung hình", "Chồng hộp được miễn"])
            expect(within(checks).getByRole("button", { name: `Giải thích: ${term}` })).toBeTruthy();
        expect(within(checks).getByText("car_300 – car_301 @4,50 s")).toBeTruthy();
        // 4. charts: speed, acceleration, gap, TTC
        expect(within(block("Biểu đồ")).getAllByRole("img")).toHaveLength(4);
        // 5. vehicles: measured / default T and s0
        expect(within(block("Các xe")).getByText("1,46 s (đo) · 2,0 m (mặc định)")).toBeTruthy();
        expect(within(block("Các xe")).getByRole("img", { name: "Trạng thái ego" }).children).toHaveLength(3);
        // 8. trigger note
        expect(within(block("Kích hoạt theo thời gian")).getByText(reactiveDetail.trigger_note)).toBeTruthy();
    });
    it("runs the sensitivity check on request and flags a changing verdict", async () => {
        const run = vi.fn().mockResolvedValue({ stable: false, runs: [
            { reaction_s: 0.7, valid: true, group: "mild", reasons: [], ego: { min_gap: 5, min_ttc: 3, a_min: 1, a_used: 1, conflict_with: null } },
            { reaction_s: 1, valid: true, group: "mild", reasons: [], ego: { min_gap: 4.2, min_ttc: 2.8, a_min: 1.1, a_used: 1.2, conflict_with: null } },
            { reaction_s: 1.5, valid: false, group: null, reasons: ["collision"], ego: { min_gap: 0, min_ttc: 0, a_min: null, a_used: null, conflict_with: null } },
        ] });
        render(<Real2simReport report={withDetail()} diagnostics={[]} onSensitivity={run}/>);
        fireEvent.click(within(block("Thử độ nhạy")).getByRole("button", { name: "Thử độ nhạy" }));
        await screen.findByText("Kết luận đổi theo phản xạ: phụ thuộc nhiều vào giả định về người lái.");
        expect(run).toHaveBeenCalledTimes(1);
        expect(within(block("Thử độ nhạy")).getAllByRole("row")).toHaveLength(4);
        expect(within(block("Thử độ nhạy")).getByRole("cell", { name: "✗ Có va chạm giữa các xe trong kịch bản." })).toBeTruthy();
    });
    it("shows the esmini check states and asks for one", async () => {
        const onCheck = vi.fn();
        const { rerender } = render(<Real2simReport report={withDetail()} diagnostics={[]} esmini={null} onEsminiCheck={onCheck}/>);
        expect(screen.queryByRole("region", { name: "Thử độ nhạy" })).toBeNull();
        fireEvent.click(within(block("Độ khớp esmini")).getByRole("button", { name: "Kiểm bằng esmini" }));
        expect(onCheck).toHaveBeenCalledTimes(1);
        rerender(<Real2simReport report={withDetail()} diagnostics={[]} esmini="loading" onEsminiCheck={onCheck}/>);
        expect(within(block("Độ khớp esmini")).getByText("Đang chạy esmini")).toBeTruthy();
        expect(within(block("Độ khớp esmini")).queryByRole("button", { name: "Kiểm bằng esmini" })).toBeNull();
        rerender(<Real2simReport report={withDetail()} diagnostics={[]} esmini={{ error: "Thiếu esmini" }} onEsminiCheck={onCheck}/>);
        expect(within(block("Độ khớp esmini")).getByText("Thiếu esmini")).toBeTruthy();
        rerender(<Real2simReport report={withDetail()} diagnostics={[]} esmini={check} onEsminiCheck={onCheck}/>);
        expect(within(block("Độ khớp esmini")).getByText("esmini chạy hết")).toBeTruthy();
        expect(within(block("Độ khớp esmini")).getByText("0,0040 m", { selector: "dd" })).toBeTruthy();
        expect(within(block("Độ khớp esmini")).getByText("4,10 m/s²")).toBeTruthy();
        // the esmini row of the checks takes the check's result
        const esminiRow = within(block("Kiểm tra hợp lệ")).getAllByRole("row")[1];
        expect(within(esminiRow).getByRole("cell", { name: "✓" })).toBeTruthy();
        rerender(<Real2simReport report={withDetail()} diagnostics={[]} esmini={{ ...check, passed: null, skipped_reason: "no_road" }}/>);
        expect(within(block("Độ khớp esmini")).getByText("không kiểm được: gói thiếu .xodr")).toBeTruthy();
        expect(within(within(block("Kiểm tra hợp lệ")).getAllByRole("row")[1]).getByRole("cell", { name: "chưa kiểm" })).toBeTruthy();
    });
    it("survives a detail with empty or null series", () => {
        const empty: ReactiveDetail = { ...reactiveDetail, series: { t: [], vehicles: {}, ego: { gap: [], ttc: [] } }, markers: [], vehicles: {}, excused: [] };
        render(<Real2simReport report={withDetail(empty)} diagnostics={[]}/>);
        expect(within(block("Biểu đồ")).getAllByRole("img")).toHaveLength(4);
        expect(within(block("Kiểm tra hợp lệ")).getByText("Không có.")).toBeTruthy();
    });
});

describe("Real2simReport of a team package (no topeye block)", () => {
    it("keeps the plan43 layout and adds the ? marks to its labels", () => {
        render(<Real2simReport report={team} diagnostics={[]}/>);
        const panel = screen.getByLabelText("Báo cáo kịch bản real2sim");
        expect(within(panel).getByText("car_154 chậm lại 50% · giảm tốc 4,0 m/s² lúc 0,0 s · đứng 0,0 s")).toBeTruthy();
        expect(within(panel).getByRole("cell", { name: "4,20 m" })).toBeTruthy();
        expect(within(panel).getByRole("cell", { name: "10,30 m" })).toBeTruthy();
        expect(within(panel).getByText("mild")).toBeTruthy();
        expect(screen.queryByRole("region", { name: "Baseline và pilot" })).toBeNull();
        for (const term of ["Hợp lệ", "Nhóm", "Gần nhất", "TTC (thời gian tới va chạm)", "Xe phía sau phản ứng", "T · s₀", "Truy vết", "Lệch so với quỹ đạo định đưa"])
            expect(within(panel).getByRole("button", { name: `Giải thích: ${term}` })).toBeTruthy();
    });
    it("still shows the notes block without a report.json", async () => {
        render(<Real2simReport report={null} diagnostics={[{ code: "MAP_NOTE_SURFACE", message: "ra ngoài mặt đường" } as never]}/>);
        await waitFor(() => expect(screen.getByText("ra ngoài mặt đường")).toBeTruthy());
    });
});

describe("plan54 related vehicles only", () => {
    const notes = [{ code: "MAP_NOTE_SURFACE", message: "ego ra ngoài mặt đường", actor_id: "ego" },
        { code: "MAP_NOTE_SURFACE", message: "pedestrian_001 ra ngoài mặt đường", actor_id: "pedestrian_001" },
        { code: "MAP_NOTE_OBSTACLE", message: "truck_010 chạm vật cản", actor_id: "truck_010" }];
    it("lists notes of the ego and related vehicles, counts the rest and shows them on request", () => {
        render(<Real2simReport report={withDetail()} diagnostics={notes} focus={new Set(["ego", "car_154"])} brief/>);
        expect(screen.getByText("ego ra ngoài mặt đường")).toBeTruthy();
        expect(screen.queryByText("pedestrian_001 ra ngoài mặt đường")).toBeNull();
        expect(screen.getByText(/Ẩn 2 mục về 2 đối tượng không liên quan/)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Hiện tất cả" }));
        expect(screen.getByText("pedestrian_001 ra ngoài mặt đường")).toBeTruthy();
    });
    it("brief leaves out what the Analysis tabs already show", () => {
        render(<Real2simReport report={withDetail()} diagnostics={[]} focus={new Set(["ego"])} brief/>);
        expect(screen.queryByRole("region", { name: "Baseline và pilot" })).toBeNull();
        expect(screen.queryByRole("region", { name: "Kiểm tra hợp lệ" })).toBeNull();
        expect(screen.getByRole("region", { name: "Phạm vi báo cáo" })).toBeTruthy();
    });
    it("a team report keeps only related vehicles in the per-vehicle tables", () => {
        const many = { ...team, physics: { ego: { max_speed: 9 }, car_154: { max_speed: 8 }, car_999: { max_speed: 7 } } };
        render(<Real2simReport report={many} diagnostics={[]} focus={new Set(["ego", "car_154"])}/>);
        expect(screen.queryByText("car_999")).toBeNull();
        expect(screen.getByText(/Ẩn 1 mục về 1 đối tượng/)).toBeTruthy();
    });
});
