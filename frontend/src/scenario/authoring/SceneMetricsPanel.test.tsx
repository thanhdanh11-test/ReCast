// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import type { MethodCount, ReactiveMetrics, ReplayErrorMetrics } from "../reactiveTypes";
import { SceneMetricsPanel } from "./SceneMetricsPanel";

afterEach(cleanup);
const count = (valid: number, encounters_valid: number, rare: number, rare_encounters: number, collision: number): MethodCount => ({
    valid, encounters_valid, rare, rare_encounters,
    groups: { collision: 0, hard: rare - 1, close: 1, mild: valid - rare, far: 0 },
    reasons: { collision, appearing: 2, merge: 3, label_error: 4, tailgating: 5, physics: 6 },
});
const metrics: ReactiveMetrics = {
    scene: "scene-0103", grid: { event_step_s: 2, decels: [2, 4], targets: [["stop", 0], ["half", 0]] }, reaction_s: 1, tried: 777, encounters: 129,
    baseline: count(225, 40, 0 + 1, 1, 552), pilot: count(591, 101, 18, 9, 50),
    sensitivity: [{ reaction_s: 0.7, pilot_valid: 607, pilot_rare: 0 }, { reaction_s: 1, pilot_valid: 591, pilot_rare: 18 }, { reaction_s: 1.5, pilot_valid: 493, pilot_rare: 41 }],
    rare: [
        { actor: "car_154", actor_id: "a1", t0: 3, decel: 6, target: "stop", dwell: 3, group: "close", ego_min_gap: 0.9, ego_min_ttc: 1.2, ego_a_min: 3.6 },
        { actor: "car_200", actor_id: "a2", t0: 5, decel: 8, target: "half", dwell: 0, group: "hard", ego_min_gap: 2.5, ego_min_ttc: null, ego_a_min: 4.1 },
    ],
    cells: [
        { actor: "car_154", actor_id: "a1", t0: 1, decel: 2, target: "stop", dwell: 0, baseline: { valid: false, group: null }, pilot: { valid: true, group: "mild", min_gap: 4 } },
        { actor: "car_154", actor_id: "a1", t0: 3, decel: 4, target: "half", dwell: 0, baseline: { valid: true, group: "far" }, pilot: { valid: true, group: "close", min_gap: 0.8 } },
        { actor: "car_200", actor_id: "a2", t0: 5, decel: 2, target: "stop", dwell: 0, baseline: { valid: false, group: null }, pilot: { valid: false, group: null, min_gap: null } },
    ],
    esmini_checked: false, runtime_s: 12, engine: "topeye-reactive",
};
const group = (ade: number | null) => ({ n: 4, ade, fde: ade, max: ade, yaw_deg: 1, v_rmse: 0.2 });
const groups = (ade: number) => ({ all: group(ade), moving: group(ade), static: group(0), vehicle: group(ade), pedestrian: group(null), obstacle: group(null) });
const replay: ReplayErrorMetrics = {
    scene: "scene-0103", esmini_version: "v2.37", esmini_exit: { exact: 0, baseline: 0, pilot: 0 },
    methods: { exact: groups(0.001), baseline: groups(1.771), pilot: groups(0.098) },
    objects: [
        { name: "car_001", category: "car", moving: true, keyframes: 40, label_problems: 0, ade: { exact: 0, baseline: 0.5, pilot: 0.05 } },
        { name: "car_002", category: "car", moving: true, keyframes: 38, label_problems: 2, ade: { exact: 0, baseline: 3.2, pilot: 0.2 } },
    ],
    holdout: { n: 120, ade: { exact: 0.091, baseline: 1.983, pilot: 0.133 }, accel_p99_over_4_share: { exact: 0.1, baseline: 0.5, pilot: 0 } },
    runtime_s: 30,
};
const panel = (props: Partial<Parameters<typeof SceneMetricsPanel>[0]> = {}) => {
    const all = { scene: "scene-0103", busy: false, reactiveMetrics: vi.fn(async () => metrics), replayErrorMetrics: vi.fn(async () => replay),
        onFill: vi.fn(), onCreate: vi.fn(async () => true), onDone: vi.fn(), ...props };
    render(<LanguageProvider value="vi"><div className="studio"><SceneMetricsPanel {...all}/></div></LanguageProvider>);
    return all;
};
const row = (table: HTMLElement, name: RegExp) => within(table).getAllByRole("row").find(r => name.test(r.querySelector("th")?.textContent ?? ""))!;
const cells = (r: HTMLElement) => [...r.querySelectorAll("td")].map(td => td.textContent);

describe("SceneMetricsPanel", () => {
    it("shows scene metric 2 baseline vs pilot from the worker numbers, with the reaction assumption", async () => {
        const { reactiveMetrics } = panel();
        fireEvent.click(screen.getByRole("button", { name: "Đo chỉ số 2" }));
        expect(reactiveMetrics).toHaveBeenCalledWith("scene-0103", undefined);
        const table = await screen.findByRole("table", { name: "Chỉ số 2: baseline và pilot" });
        expect(cells(row(table, /^Đã thử/))).toEqual(["777", "777"]);
        expect(cells(row(table, /^Hợp lệ/))).toEqual(["225 (29,0 %)", "591 (76,1 %)"]);
        expect(cells(row(table, /^Lần phanh có biến thể hợp lệ/))).toEqual(["40/129", "101/129"]);
        expect(cells(row(table, /^Ca hiếm/))).toEqual(["1 (1 lần phanh)", "18 (9 lần phanh)"]);
        expect(cells(row(table, /^Loại: Va chạm/))).toEqual(["552", "50"]);
        expect(screen.getByText(/777 biến thể trên 129 lần phanh · với phản xạ 1,0 s · esmini kiểm riêng từng gói/)).toBeTruthy();
        expect(screen.getByText("với phản xạ 1,0 s")).toBeTruthy();
        expect(screen.getByRole("table", { name: "Độ nhạy theo phản xạ" })).toBeTruthy();
    });
    it("asks for the 0.7 / 1.0 / 1.5 s sensitivity when ticked", async () => {
        const { reactiveMetrics } = panel();
        fireEvent.click(screen.getByRole("checkbox", { name: "kèm độ nhạy 0,7/1,0/1,5 s" }));
        fireEvent.click(screen.getByRole("button", { name: "Đo chỉ số 2" }));
        expect(reactiveMetrics).toHaveBeenCalledWith("scene-0103", [0.7, 1.0, 1.5]);
    });
    it("“Xem” on a rare case fills the form and creates exactly that event with the measured reaction", async () => {
        const { onCreate, onFill, onDone } = panel();
        fireEvent.click(screen.getByRole("button", { name: "Đo chỉ số 2" }));
        fireEvent.click(await screen.findByRole("button", { name: "Xem car_154 lúc 3,0 s" }));
        expect(onFill).toHaveBeenCalledWith({ actor_id: "a1", t0_s: 3, decel_mps2: 6, target: "stop", dwell_s: 3 });
        expect(onCreate).toHaveBeenCalledWith("scene-0103", { actor_id: "a1", t0_s: 3, decel_mps2: 6, target: "stop", dwell_s: 3, react: true, reaction_s: 1 });
        await waitFor(() => expect(onDone).toHaveBeenCalled());
    });
    it("creates every rare case in turn with progress, and can stop between cases", async () => {
        let release: (ok: boolean) => void = () => {};
        const onCreate = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
        const { onDone } = panel({ onCreate });
        fireEvent.click(screen.getByRole("button", { name: "Đo chỉ số 2" }));
        fireEvent.click(await screen.findByRole("button", { name: "Tạo tất cả ca hiếm vào thư viện" }));
        expect(onCreate).toHaveBeenCalledTimes(1);
        expect(screen.getByText("Đã tạo 0/2 · lỗi 0")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Dừng" }));
        release(true);
        await screen.findByText("Đã tạo 1/2 · lỗi 0");
        expect(onCreate).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("button", { name: "Tạo tất cả ca hiếm vào thư viện" })).toBeTruthy();
        expect(onDone).not.toHaveBeenCalled();
    });
    it("draws the parameter space per vehicle and fills the form from a tile", async () => {
        const { onFill } = panel();
        fireEvent.click(screen.getByRole("button", { name: "Đo chỉ số 2" }));
        const space = await screen.findByLabelText("Không gian tham số");
        expect(within(space).getAllByRole("table")).toHaveLength(2);
        const tile = within(space).getByRole("button", { name: "4 m/s² lúc 3,0 s · baseline: không ảnh hưởng · pilot: suýt chạm" });
        expect(tile.className).toContain("g-close");
        expect(tile.querySelector(".param-base")!.className).toContain("g-far");
        fireEvent.click(tile);
        expect(onFill).toHaveBeenCalledWith({ actor_id: "a1", t0_s: 3, decel_mps2: 4, target: "half", dwell_s: 0 });
        fireEvent.change(within(space).getByRole("combobox", { name: "Xe trong không gian tham số" }), { target: { value: "a2" } });
        expect(within(space).getByRole("button", { name: "2 m/s² lúc 5,0 s · baseline: không hợp lệ · pilot: không hợp lệ" }).className).toContain("invalid");
    });
    it("shows scene metric 1, the held-out check and a sortable raw-data table", async () => {
        const { replayErrorMetrics } = panel();
        fireEvent.click(screen.getByRole("button", { name: "Đo chỉ số 1 (esmini)" }));
        expect(replayErrorMetrics).toHaveBeenCalledWith("scene-0103");
        const table = await screen.findByRole("table", { name: "Chỉ số 1: sai số phát lại" });
        expect(cells(row(table, /^baseline$/))[0]).toBe("1,771 m");
        expect(cells(row(table, /^pilot$/))[0]).toBe("0,098 m");
        const holdout = screen.getByRole("table", { name: "Kiểm chéo bằng mốc giấu" });
        expect(cells(row(holdout, /^baseline$/))).toEqual(["1,983 m", "50,0 %"]);
        const raw = screen.getByRole("table", { name: "Dữ liệu gốc từng vật thể" });
        const names = () => within(raw).getAllByRole("row").slice(1).map(r => r.querySelector("td")!.textContent);
        expect(names()).toEqual(["car_002", "car_001"]);
        fireEvent.click(within(raw).getByRole("button", { name: "ADE pilot" }));
        expect(names()).toEqual(["car_001", "car_002"]);
        fireEvent.click(within(raw).getByRole("button", { name: "Vật thể" }));
        expect(names()).toEqual(["car_002", "car_001"]);
    });
    it("says esmini is missing for scene metric 1", async () => {
        panel({ replayErrorMetrics: vi.fn(async () => { throw new Error("ESMINI_MISSING: not found"); }) });
        fireEvent.click(screen.getByRole("button", { name: "Đo chỉ số 1 (esmini)" }));
        expect((await screen.findByRole("alert")).textContent).toBe("Thiếu esmini");
    });
});
