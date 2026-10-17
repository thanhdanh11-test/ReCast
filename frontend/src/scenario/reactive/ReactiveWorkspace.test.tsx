// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import type { ImportedScenario, ReactiveCandidates, ReactiveEvent } from "../types";
import type { ReactiveMetrics } from "../reactiveTypes";
import { ReactiveWorkspace } from "./ReactiveWorkspace";
import { accelMetrics, brakeOnly, candidates, pkg, source } from "./fixtures";

afterEach(cleanup);
beforeEach(() => { try { window.localStorage.clear(); } catch { /* no storage */ } });

const metrics = { scene: "scene-0061", engine: "replay-forge d36205b", rare: [
    { actor: "car_154", actor_id: "tok-car", t0: 2, decel: 6, target: "stop", dwell: 0, group: "close", ego_min_gap: 0.8, ego_min_ttc: 1.1, ego_a_min: 5 }],
    cells: [], grid: { event_step_s: 2, decels: [2, 4, 6, 8], targets: [["stop", 0]] } } as unknown as ReactiveMetrics;

type Create = (scene: string, event: ReactiveEvent) => Promise<ImportedScenario>;
function setup(over: { candidates?: ReactiveCandidates; create?: Create } = {}) {
    const props = {
        candidates: vi.fn(async () => over.candidates ?? candidates),
        loadScene: vi.fn(async (scene: string) => ({ ...source, source: { ...source.source, scene } })),
        create: vi.fn<Create>(over.create ?? (async () => pkg())),
        discard: vi.fn(async () => undefined),
        open3d: vi.fn(),
        reactiveMetrics: vi.fn(async () => metrics),
        reactiveKindMetrics: vi.fn(async (_scene: string, kinds: string[]) => kinds[0] === "accelerate" ? { accelerate: accelMetrics } : {}),
        onChooseDataset: vi.fn(),
    };
    render(<LanguageProvider value="vi"><div className="studio"><ReactiveWorkspace active busy={false} datasetName="nuscenes" scenes={["scene-0061", "scene-0103"]}
        currentScene="scene-0061" source={source} esmini={() => null} {...props}/></div></LanguageProvider>);
    return props;
}
const ws = () => within(screen.getByTestId("reactive-workspace"));
const pressed = (name: string | RegExp) => ws().getByRole("button", { name }).getAttribute("aria-pressed");

describe("ReactiveWorkspace (plan47 SPEC-WP2)", () => {
    it("loads the chosen scene before showing its map and candidates", async () => {
        const props = setup();
        await ws().findByRole("img", { name: "Bản đồ 2D của tình huống phản ứng" });
        fireEvent.change(ws().getByRole("combobox", { name: "Cảnh" }), { target: { value: "scene-0103" } });
        await waitFor(() => expect(props.loadScene).toHaveBeenCalledWith("scene-0103"));
        await waitFor(() => expect(props.candidates).toHaveBeenCalledWith("scene-0103"));
        expect(await ws().findByRole("img", { name: "Bản đồ 2D của tình huống phản ứng" })).toBeTruthy();
        expect(ws().getByRole("button", { name: "Chọn xe car_154" })).toBeTruthy();
    });

    it("keeps the map when the selected scene is chosen again", async () => {
        const props = setup();
        await ws().findByRole("img", { name: "Bản đồ 2D của tình huống phản ứng" });
        fireEvent.change(ws().getByRole("combobox", { name: "Cảnh" }), { target: { value: "scene-0061" } });
        expect(ws().getByRole("img", { name: "Bản đồ 2D của tình huống phản ứng" })).toBeTruthy();
        expect(props.loadScene).not.toHaveBeenCalled();
        expect(props.candidates).toHaveBeenCalledTimes(1);
    });
    it("lays out the approved sketch: steps, map, time bar, inspector tabs, tray", async () => {
        setup();
        await ws().findByRole("img", { name: "Bản đồ 2D của tình huống phản ứng" });
        expect(ws().getByRole("list", { name: "Các bước" }).textContent).toBe("1Chọn xe2Chỉnh cách phanh3Xem và lưu");
        expect(ws().getByText("engine replay-forge d36205b · ego 2 Hz")).toBeTruthy();
        expect(ws().getAllByRole("tab").map(t => t.textContent)).toEqual(["Tạo tình huống", "Ca hiếm tìm sẵn · 1",
            "Biểu đồ", "Không gian tham số", "Các xe", "Kiểm tra hợp lệ", "Độ khớp esmini", "Chỉ số cảnh", "Dữ liệu gốc"]);
        expect(ws().getByRole("group", { name: "Lớp phủ bản đồ" }).textContent).toBe("Bóng bản ghiXe phía trướcKhoảng cách, TTCMã xeDải đường điVạch dừngĐo khoảng cách");
        expect(ws().getByRole("group", { name: "Kiểu xem" }).textContent).toBe("2D từ trên3DTrong xe");
        expect(ws().getByText("Bấm một xe viền hồng trên bản đồ để chọn xe gây sự kiện").className).toBe("rx-hint");
    });

    it("picks the event vehicle by clicking it on the map (only candidates are pickable)", async () => {
        const props = setup();
        const car = await ws().findByRole("button", { name: "Chọn xe car_154" });
        expect(ws().queryByRole("button", { name: /Chọn xe ego/ })).toBeNull();
        expect(car.getAttribute("class")).toContain("rx-candidate");
        fireEvent.click(car);
        expect(ws().getByText("car_154", { selector: "b" })).toBeTruthy();
        expect(ws().getByText("xe con · 1 xe phía sau")).toBeTruthy();
        expect(ws().getByRole("list", { name: "Các bước" }).querySelector('[aria-current="step"]')?.textContent).toBe("2Chỉnh cách phanh");
        expect(ws().getByText("car_154 · phanh 4,0 m/s²")).toBeTruthy();
        expect(props.create).not.toHaveBeenCalled();
        // "đổi xe" goes back to step ①
        fireEvent.click(ws().getByRole("button", { name: "đổi xe" }));
        expect(await ws().findByRole("button", { name: "Chọn xe car_154" })).toBeTruthy();
    });

    it("enables only the kinds of the chosen vehicle", async () => {
        setup();
        fireEvent.change(await ws().findByRole("combobox", { name: "Hoặc chọn trong danh sách" }), { target: { value: brakeOnly.actor_id } });
        const kinds = within(ws().getByRole("group", { name: "Loại sự kiện" }));
        const disabled = (name: string) => (kinds.getByRole("button", { name: new RegExp(`^${name}`) }) as HTMLButtonElement).disabled;
        expect([disabled("Phanh"), disabled("Tăng tốc"), disabled("Dừng ở vạch"), disabled("Chuyển làn")]).toEqual([false, false, true, true]);
        expect(kinds.getByRole("button", { name: "Dừng ở vạch, không khả dụng" }).getAttribute("aria-label")).toBe("Dừng ở vạch, không khả dụng");
        // the truck brakes at most 5 m/s²: "Gấp 6" and "Khẩn 8" are not offered
        expect(within(ws().getByRole("group", { name: "Phanh mạnh cỡ nào" })).getAllByRole("button").map(b => b.textContent)).toEqual(["Nhẹ 2", "Vừa 4"]);
    });

    it("a worker without kinds (v0.34.0) offers brake only, without errors", async () => {
        const old = { ...candidates, candidates: [{ ...candidates.candidates[0], kinds: undefined }] };
        setup({ candidates: old });
        fireEvent.click(await ws().findByRole("button", { name: "Chọn xe car_154" }));
        const kinds = within(ws().getByRole("group", { name: "Loại sự kiện" }));
        expect(kinds.getAllByRole("button").filter(b => !(b as HTMLButtonElement).disabled).map(b => b.textContent)).toEqual(["Phanh"]);
    });

    it("caps an acceleration target by the scene time left after a late start", async () => {
        setup({ candidates: { ...candidates, duration_s: 10 } });
        fireEvent.click(await ws().findByRole("button", { name: "Chọn xe car_154" }));
        fireEvent.click(ws().getByRole("group", { name: "Loại sự kiện" }).querySelector('[aria-label="Tăng tốc"]')!);
        fireEvent.change(ws().getByRole("slider", { name: /^Thời gian/ }), { target: { value: "5" } });
        const target = ws().getByRole("slider", { name: "Tốc độ đích" }) as HTMLInputElement;
        expect(Number(target.max)).toBeLessThanOrEqual(10);
    });

    it("sends each kind's own event, and the time bar sets the start in step ②", async () => {
        const props = setup();
        fireEvent.click(await ws().findByRole("button", { name: "Chọn xe car_154" }));
        fireEvent.click(ws().getByRole("button", { name: "Chuyển làn" }));
        fireEvent.click(ws().getByRole("button", { name: "Phải" }));
        expect(ws().getByText(/không còn lúc nào hợp lệ/)).toBeTruthy();
        expect((ws().getByRole("button", { name: /Tạo tình huống$/ }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(ws().getByRole("button", { name: "Trái" }));
        fireEvent.change(ws().getByRole("slider", { name: "Thời gian (kéo để chọn lúc bắt đầu)" }), { target: { value: "0.2" } });
        const start = () => screen.getByTestId("reactive-workspace").querySelector(".rx-big")?.firstChild?.textContent;
        expect(start()).toBe("1,0 s");
        fireEvent.change(ws().getByRole("slider", { name: "Thời gian (kéo để chọn lúc bắt đầu)" }), { target: { value: "3.5" } });
        expect(start()).toBe("3,5 s");
        fireEvent.click(ws().getByRole("button", { name: /Tạo tình huống$/ }));
        await waitFor(() => expect(props.create).toHaveBeenCalledWith("scene-0061", { actor_id: "tok-car", t0_s: 3.5, react: true, reaction_s: 1, kind: "lane_change", direction: "left", duration_s: 4 }));

        fireEvent.click(await ws().findByRole("button", { name: "Huỷ tình huống này" }));
        expect(props.discard).toHaveBeenCalledWith("f".repeat(32));
        fireEvent.click(ws().getByRole("button", { name: "Dừng ở vạch" }));
        fireEvent.click(ws().getByRole("button", { name: "10 s" }));
        expect(ws().getByText("Vạch dừng kế tiếp: biển dừng · 5,6 s")).toBeTruthy();
        fireEvent.click(ws().getByRole("button", { name: /Tạo tình huống$/ }));
        await waitFor(() => expect(props.create).toHaveBeenLastCalledWith("scene-0061", { actor_id: "tok-car", t0_s: 2, react: true, reaction_s: 1, kind: "stopline", dwell_s: 10 }));
    });

    it("accelerate sends the target speed within (v(t0) + 0,5; max]", async () => {
        const props = setup();
        fireEvent.click(await ws().findByRole("button", { name: "Chọn xe car_154" }));
        fireEvent.click(ws().getByRole("button", { name: "Tăng tốc" }));
        fireEvent.click(ws().getByRole("button", { name: "3 m/s²" }));
        const target = ws().getByRole("slider", { name: "Tốc độ đích" }) as HTMLInputElement;
        expect([target.min, target.max, target.value]).toEqual(["9", "18", "11"]);
        fireEvent.change(target, { target: { value: "16" } });
        fireEvent.click(ws().getByRole("button", { name: /Tạo tình huống$/ }));
        await waitFor(() => expect(props.create).toHaveBeenCalledWith("scene-0061", { actor_id: "tok-car", t0_s: 2, react: true, reaction_s: 1, kind: "accelerate", target_mps: 16, accel_mps2: 3 }));
    });

    it("after Tạo: verdict card, map roles, ▼ marks, tray blocks; Lưu keeps it and enables 3D", async () => {
        const props = setup();
        fireEvent.click(await ws().findByRole("button", { name: "Chọn xe car_154" }));
        fireEvent.click(ws().getByRole("button", { name: /Tạo tình huống$/ }));
        const verdict = await ws().findByRole("status", { name: "Kết luận" });
        expect(verdict.className).toContain("ok");
        expect(verdict.textContent).toContain("Dùng được · phanh nhẹ là đủ");
        expect(within(ws().getByRole("list", { name: "Mốc trên thanh thời gian" })).getAllByRole("button").map(b => b.textContent))
            .toEqual(["▼phanh", "▼ego phản ứng", "▼gần nhất 9,6 m"]);
        const map = ws().getByTestId("reactive-map");
        expect(map.querySelector('[data-actor="car_154"]')?.getAttribute("class")).toBe("rx-event");
        expect(map.querySelectorAll(".rx-ghost").length).toBeGreaterThan(0);
        act(() => { fireEvent.click(ws().getByRole("button", { name: "▼gần nhất 9,6 m" })); });
        expect(map.querySelector('[data-actor="ego"]')?.getAttribute("class")).toBe("rx-ego reacting");
        expect(ws().getByText("cách xe trước 9,6 m · TTC 3,2 s")).toBeTruthy();
        expect(within(ws().getByRole("table", { name: "Baseline và pilot" })).getByText("xe của bạn đâm").className).toBe("bad");
        expect(ws().getByRole("tab", { name: "Kiểm tra hợp lệ ✓1" })).toBeTruthy();
        fireEvent.click(ws().getByRole("tab", { name: "Các xe" }));
        expect(ws().getByRole("region", { name: "Các xe" })).toBeTruthy();
        fireEvent.click(ws().getByRole("tab", { name: "Biểu đồ" }));
        fireEvent.click(ws().getByRole("button", { name: "Khoảng cách và TTC" }));
        expect(ws().getAllByRole("img", { name: /Khoảng cách xe của bạn|TTC xe của bạn/ })).toHaveLength(2);

        expect((ws().getByRole("button", { name: "3D" }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(ws().getByRole("button", { name: "Lưu vào thư viện" }));
        expect(ws().getByText(/Đã lưu vào thư viện/)).toBeTruthy();
        fireEvent.click(ws().getByRole("button", { name: "Trong xe" }));
        expect(props.open3d).toHaveBeenCalledWith("f".repeat(32));
        // a saved package is kept when the choice changes
        fireEvent.click(ws().getByRole("button", { name: "Tạo tình huống khác" }));
        fireEvent.click(ws().getByRole("button", { name: /Gấp/ }));
        expect(props.discard).not.toHaveBeenCalled();
    });

    it("a changed choice deletes the unsaved package; a worker error shows in a red card", async () => {
        const create = vi.fn<Create>(async () => pkg()).mockRejectedValueOnce(new Error("EVENT_NOT_ALLOWED: Không có làn kề"));
        const props = setup({ create });
        fireEvent.click(await ws().findByRole("button", { name: "Chọn xe car_154" }));
        fireEvent.click(ws().getByRole("button", { name: /Tạo tình huống$/ }));
        expect((await ws().findByRole("alert")).textContent).toContain("EVENT_NOT_ALLOWED: Không có làn kề");
        fireEvent.click(ws().getByRole("button", { name: /Tạo tình huống$/ }));
        await ws().findByRole("status", { name: "Kết luận" });
        fireEvent.click(ws().getByRole("button", { name: /Nhẹ/ }));
        expect(props.discard).toHaveBeenCalledWith("f".repeat(32));
        expect(ws().queryByRole("status", { name: "Kết luận" })).toBeNull();
    });

    it("Đơn giản hides chips, tray, baseline/pilot and numeric parameters; the choice is remembered", async () => {
        setup();
        fireEvent.click(await ws().findByRole("button", { name: "Chọn xe car_154" }));
        fireEvent.click(ws().getByRole("button", { name: /Tạo tình huống$/ }));
        await ws().findByRole("status", { name: "Kết luận" });
        fireEvent.click(ws().getByRole("button", { name: "Đơn giản" }));
        expect(pressed("Đơn giản")).toBe("true");
        expect(ws().queryByRole("group", { name: "Lớp phủ bản đồ" })).toBeNull();
        expect(ws().queryByRole("region", { name: "Khay chi tiết" })).toBeNull();
        expect(ws().queryByRole("table", { name: "Baseline và pilot" })).toBeNull();
        expect(ws().queryByText("Kích hoạt theo thời gian.")).toBeNull();
        expect(within(ws().getByRole("group", { name: "Phanh mạnh cỡ nào" })).getAllByRole("button").map(b => b.textContent)).toEqual(["Nhẹ", "Vừa", "Gấp", "Khẩn"]);
        expect(ws().getByRole("status", { name: "Kết luận" })).toBeTruthy();
        expect(window.localStorage.getItem("topeye.reactive.mode")).toBe("simple");
        cleanup();
        setup();
        expect(screen.getByTestId("reactive-workspace").dataset.mode).toBe("simple");
    });

    it("a rare case fills the form and simulates it", async () => {
        const props = setup();
        await ws().findByRole("button", { name: "Chọn xe car_154" });
        fireEvent.click(ws().getByRole("tab", { name: "Ca hiếm tìm sẵn · 1" }));
        fireEvent.click(ws().getByRole("button", { name: "Xem car_154 lúc 2,0 s" }));
        await waitFor(() => expect(props.create).toHaveBeenCalledWith("scene-0061", { actor_id: "tok-car", t0_s: 2, react: true, reaction_s: 1, decel_mps2: 6, target: "stop", dwell_s: 0 }));
        expect(pressed(/Gấp/)).toBe("true");
    });

    it("asks for candidates again after an error", async () => {
        const props = setup();
        props.candidates.mockClear();
        cleanup();
        const failing = { ...props, candidates: vi.fn().mockRejectedValueOnce(new Error("BUSY: Một tác vụ đang chạy")).mockResolvedValue(candidates) };
        render(<LanguageProvider value="vi"><ReactiveWorkspace active busy={false} datasetName="" scenes={["scene-0061"]} currentScene="scene-0061" source={source} esmini={() => null} {...failing}/></LanguageProvider>);
        expect((await screen.findByRole("alert")).textContent).toContain("Một tác vụ đang chạy");
        fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
        expect(await screen.findByRole("button", { name: "Chọn xe car_154" })).toBeTruthy();
    });

    it("scene metric 2 follows the kind: accelerate rare cases and its parameter space by axes (plan47 C5)", async () => {
        const props = setup();
        fireEvent.click(await ws().findByRole("button", { name: "Chọn xe car_154" }));
        expect(props.reactiveKindMetrics).not.toHaveBeenCalled();
        fireEvent.click(ws().getByRole("button", { name: "Tăng tốc" }));
        await waitFor(() => expect(props.reactiveKindMetrics).toHaveBeenCalledWith("scene-0061", ["accelerate"]));
        fireEvent.click(ws().getByRole("tab", { name: "Không gian tham số" }));
        const grid = await ws().findByRole("table", { name: "Lưới Tăng tốc" });
        expect(within(grid).getAllByRole("rowheader").map(r => r.textContent)).toEqual(["1 m/s² · tốc độ +3,0 m/s", "2 m/s² · tốc độ +3,0 m/s", "2 m/s² · tốc độ +6,0 m/s"]);
        fireEvent.click(within(grid).getByRole("button", { name: "2 m/s² · tốc độ +6,0 m/s lúc 0,0 s · baseline: không hợp lệ · pilot: suýt chạm" }));
        expect((ws().getByRole("slider", { name: "Tốc độ đích" }) as HTMLInputElement).value).toBe("14");
        fireEvent.click(ws().getByRole("tab", { name: "Ca hiếm tìm sẵn · 1" }));
        fireEvent.click(ws().getByRole("button", { name: "Xem car_154 lúc 0,0 s" }));
        await waitFor(() => expect(props.create).toHaveBeenCalledWith("scene-0061", { actor_id: "tok-car", t0_s: 0, react: true, reaction_s: 1, kind: "accelerate", target_mps: 14, accel_mps2: 2 }));
        // a kind the metrics worker does not measure yet says so, without breaking the form
        fireEvent.click(ws().getByRole("button", { name: "Dừng ở vạch" }));
        fireEvent.click(ws().getByRole("tab", { name: /Ca hiếm tìm sẵn/ }));
        expect((await ws().findByRole("alert")).textContent).toContain("Bộ đo chưa có chỉ số cho loại sự kiện này");
    });
});
