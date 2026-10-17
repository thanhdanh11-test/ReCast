// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import type { ReactiveCandidates } from "../types";
import { ReactiveForm, clampToWindows, type ReactivePreset } from "./ReactiveForm";
import { ScenarioCreator } from "./ScenarioCreator";

afterEach(cleanup);
const data: ReactiveCandidates = {
    scene: "scene-0103", duration_s: 20,
    candidates: [
        { actor_id: "a1", name: "car_001", category: "car", max_decel_mps2: 7, windows: [[2, 5], [8, 12]], followers: ["ego", "car_002"] },
        { actor_id: "a2", name: "truck_003", category: "truck", max_decel_mps2: 4.5, windows: [[3, 6]], followers: ["ego"] },
    ],
    label_problems: [{ name: "car_001", t_from: 9, t_to: 10 }],
};
const setup = (candidates: ReactiveCandidates = data, onCreate = vi.fn(async () => true)) => {
    const load = vi.fn(async () => candidates), onDone = vi.fn();
    render(<LanguageProvider value="vi"><div className="studio"><ReactiveForm scene="scene-0103" busy={false} load={load} onCreate={onCreate} onDone={onDone}/></div></LanguageProvider>);
    return { load, onCreate, onDone };
};
const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("ReactiveForm", () => {
    it("loads candidates for the scene and lists them with their followers", async () => {
        const { load } = setup();
        expect(screen.getByText("Đang tìm xe phù hợp")).toBeTruthy();
        expect(await screen.findByRole("option", { name: "car_001 · car · 2 xe phía sau" })).toBeTruthy();
        expect(load).toHaveBeenCalledWith("scene-0103");
        expect((screen.getByRole("slider", { name: "Thời điểm t0" }) as HTMLInputElement).value).toBe("2");
        expect(pressed("vừa 4 m/s²")).toBe("true");
        expect(pressed("dừng hẳn")).toBe("true");
        expect(screen.getAllByLabelText("nhãn gốc lỗi")).toHaveLength(1);
    });
    it("says so when no vehicle has followers", async () => {
        setup({ ...data, candidates: [] });
        expect(await screen.findByText("Cảnh này không có xe nào đang có xe khác chạy phía sau. Chọn cảnh khác.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Tạo tình huống/ })).toBeNull();
    });
    it("hides braking levels above the vehicle's max deceleration", async () => {
        setup();
        await screen.findByRole("option", { name: /car_001/ });
        expect(screen.getByRole("button", { name: "gấp 6 m/s²" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "khẩn 8 m/s²" })).toBeNull();
        fireEvent.change(screen.getByRole("combobox", { name: "Xe gây sự kiện" }), { target: { value: "a2" } });
        expect(screen.queryByRole("button", { name: "gấp 6 m/s²" })).toBeNull();
        expect(pressed("vừa 4 m/s²")).toBe("true");
        expect(screen.queryAllByLabelText("nhãn gốc lỗi")).toHaveLength(0);
    });
    it("keeps t0 inside the vehicle's windows", async () => {
        expect(clampToWindows(6, [[2, 5], [8, 12]])).toBe(5);
        expect(clampToWindows(7.5, [[2, 5], [8, 12]])).toBe(8);
        expect(clampToWindows(10, [[2, 5], [8, 12]])).toBe(10);
        setup();
        const slider = await screen.findByRole("slider", { name: "Thời điểm t0" }) as HTMLInputElement;
        expect([slider.min, slider.max, slider.step]).toEqual(["2", "12", "0.5"]);
        fireEvent.change(slider, { target: { value: "7.5" } });
        expect(slider.value).toBe("8");
    });
    it("moves the slider to the windows of the chosen event (plan46 windows_by_event) and blocks creation without one", async () => {
        const byEvent: ReactiveCandidates = { ...data, candidates: [{ ...data.candidates[0], windows: [[2, 12]],
            windows_by_event: { "stop:0:4": [[2, 9]], "stop:0:6": [[2, 7]], "stop:3:4": [[2, 5]], "half:0:4": [[3, 11]] } }] };
        const { onCreate } = setup(byEvent);
        const slider = await screen.findByRole("slider", { name: "Thời điểm t0" }) as HTMLInputElement;
        expect([slider.min, slider.max]).toEqual(["2", "9"]);
        fireEvent.change(slider, { target: { value: "8.5" } });
        fireEvent.click(screen.getByRole("button", { name: "gấp 6 m/s²" }));
        expect([slider.min, slider.max, slider.value]).toEqual(["2", "7", "7"]);
        fireEvent.click(screen.getByRole("button", { name: "vừa 4 m/s²" }));
        fireEvent.click(screen.getByRole("button", { name: "chậm lại 50%" }));
        expect([slider.min, slider.max, slider.value]).toEqual(["3", "11", "7"]);
        fireEvent.click(screen.getByRole("button", { name: "dừng 3 s" }));
        expect([slider.min, slider.max, slider.value]).toEqual(["2", "5", "5"]);
        fireEvent.click(screen.getByRole("button", { name: "gấp 6 m/s²" }));
        expect(screen.getByRole("status").textContent).toContain("Không còn lúc nào hợp lệ");
        expect((screen.getByRole("button", { name: /Tạo tình huống/ }) as HTMLButtonElement).disabled).toBe(true);
        expect(slider.disabled).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "dừng hẳn" }));
        fireEvent.click(screen.getByRole("button", { name: /Tạo tình huống/ }));
        expect(onCreate).toHaveBeenCalledWith("scene-0103", expect.objectContaining({ t0_s: 5, decel_mps2: 6, target: "stop", dwell_s: 0 }));
    });
    it("has a help mark next to every parameter", async () => {
        setup();
        await screen.findByRole("option", { name: /car_001/ });
        fireEvent.click(screen.getByRole("button", { name: "Nâng cao" }));
        // pick, t0, strength, decel, target, dwell, react, reaction, trigger
        expect(screen.getAllByRole("button", { name: /\?|giải thích|Giải thích/ }).length).toBeGreaterThanOrEqual(9);
    });
    it("applies a choice picked in the scene metrics panel", async () => {
        const load = vi.fn(async () => data), onCreate = vi.fn(async () => true);
        const view = (preset: ReactivePreset | null) => <LanguageProvider value="vi"><div className="studio"><ReactiveForm scene="scene-0103" busy={false} load={load} onCreate={onCreate} onDone={vi.fn()} preset={preset}/></div></LanguageProvider>;
        const { rerender } = render(view(null));
        await screen.findByRole("option", { name: /car_001/ });
        rerender(view({ actor_id: "a2", t0_s: 4, decel_mps2: 4, target: "half", dwell_s: 0, seq: 1 }));
        expect((screen.getByRole("combobox", { name: "Xe gây sự kiện" }) as HTMLSelectElement).value).toBe("a2");
        expect((screen.getByRole("slider", { name: "Thời điểm t0" }) as HTMLInputElement).value).toBe("4");
        expect(pressed("chậm lại 50%")).toBe("true");
        fireEvent.click(screen.getByRole("button", { name: /Tạo tình huống/ }));
        expect(onCreate).toHaveBeenCalledWith("scene-0103", { actor_id: "a2", t0_s: 4, decel_mps2: 4, target: "half", dwell_s: 0, react: true, reaction_s: 1 });
    });
    it("sends the chosen ReactiveEvent and closes on success", async () => {
        const { onCreate, onDone } = setup();
        await screen.findByRole("option", { name: /car_001/ });
        fireEvent.change(screen.getByRole("slider", { name: "Thời điểm t0" }), { target: { value: "9.5" } });
        fireEvent.click(screen.getByRole("button", { name: "gấp 6 m/s²" }));
        fireEvent.click(screen.getByRole("button", { name: "dừng 3 s" }));
        fireEvent.click(screen.getByRole("button", { name: "Nâng cao" }));
        fireEvent.click(screen.getByRole("button", { name: "1.5 s" }));
        fireEvent.click(screen.getByRole("button", { name: /Tạo tình huống/ }));
        expect(onCreate).toHaveBeenCalledWith("scene-0103", { actor_id: "a1", t0_s: 9.5, decel_mps2: 6, target: "stop", dwell_s: 3, react: true, reaction_s: 1.5 });
        await waitFor(() => expect(onDone).toHaveBeenCalled());
    });
    it("sends defaults with half-speed goal and reactions off", async () => {
        const { onCreate } = setup();
        await screen.findByRole("option", { name: /car_001/ });
        fireEvent.click(screen.getByRole("button", { name: "chậm lại 50%" }));
        fireEvent.click(screen.getByRole("button", { name: "Nâng cao" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Các xe phía sau phản ứng" }));
        fireEvent.click(screen.getByRole("button", { name: /Tạo tình huống/ }));
        expect(onCreate).toHaveBeenCalledWith("scene-0103", { actor_id: "a1", t0_s: 2, decel_mps2: 4, target: "half", dwell_s: 0, react: false, reaction_s: 1 });
    });
    it("shows worker errors in the form and stays open", async () => {
        const onCreate = vi.fn(async () => { throw new Error("EVENT_NOT_ALLOWED: Thời gian đứng phải trong [0; 10] s"); });
        const { onDone } = setup(data, onCreate);
        await screen.findByRole("option", { name: /car_001/ });
        fireEvent.click(screen.getByRole("button", { name: /Tạo tình huống/ }));
        expect((await screen.findByRole("alert")).textContent).toContain("EVENT_NOT_ALLOWED: Thời gian đứng phải trong [0; 10] s");
        expect(onDone).not.toHaveBeenCalled();
    });
});

describe("ScenarioCreator (plan47)", () => {
    it("has no reactive tab: reactive events have their own workspace", () => {
        render(<LanguageProvider value="vi"><div className="studio"><ScenarioCreator scenes={["scene-0103"]} currentScene="scene-0103" busy={false}
            onClose={vi.fn()} onExportMap={vi.fn(async () => ({}))} onImportXosc={vi.fn(async () => true)} onCreateTemplate={vi.fn(async () => true)}/></div></LanguageProvider>);
        expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Từ template", "Bằng AI"]);
        expect(screen.queryByRole("tab", { name: "Phản ứng" })).toBeNull();
    });
});
