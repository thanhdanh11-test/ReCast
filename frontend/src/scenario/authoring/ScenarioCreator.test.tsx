// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { ScenarioCreator } from "./ScenarioCreator";
import type { ScenarioTemplate } from "./template";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const setup = (busy = false, language: "vi" | "en" = "vi") => {
    const props = { onClose: vi.fn(), onExportMap: vi.fn(async () => ({})), onImportXosc: vi.fn(async () => true), onCreateTemplate: vi.fn(async () => true) };
    render(<LanguageProvider value={language}><div className="studio"><ScenarioCreator scenes={["scene-0061", "scene-0103"]} currentScene="scene-0103" busy={busy} {...props}/></div></LanguageProvider>);
    return { props, dialog: within(screen.getByRole("dialog", { name: language === "vi" ? "Tạo kịch bản" : "Create scenario" })) };
};

describe("ScenarioCreator", () => {
    it("greys out scenes whose map the backend rejects, and keeps the others selectable", async () => {
        const mapStatus = vi.fn(async () => ({ "scene-0061": null, "scene-0103": "Source polygon 8 (road_segment): Invalid map polygon" }));
        render(<LanguageProvider value="vi"><div className="studio"><ScenarioCreator scenes={["scene-0061", "scene-0103"]} currentScene="scene-0061" busy={false} mapStatus={mapStatus} onClose={vi.fn()} onExportMap={vi.fn(async () => ({}))} onImportXosc={vi.fn(async () => true)} onCreateTemplate={vi.fn(async () => true)}/></div></LanguageProvider>);
        const bad = await screen.findByRole("option", { name: "scene-0103 · map lỗi, không tạo được kịch bản" }) as HTMLOptionElement;
        expect(bad.disabled).toBe(true);
        expect(bad.title).toContain("Invalid map polygon");
        expect((screen.getByRole("option", { name: "scene-0061" }) as HTMLOptionElement).disabled).toBe(false);
        expect(mapStatus).toHaveBeenCalledTimes(1);
    });
    it("keeps every scene selectable when the map probe is unavailable or fails", async () => {
        const mapStatus = vi.fn(async () => { throw new Error("worker down"); });
        render(<LanguageProvider value="vi"><ScenarioCreator scenes={["scene-0061", "scene-0103"]} currentScene="scene-0061" busy={false} mapStatus={mapStatus} onClose={vi.fn()} onExportMap={vi.fn(async () => ({}))} onImportXosc={vi.fn(async () => true)} onCreateTemplate={vi.fn(async () => true)}/></LanguageProvider>);
        await act(async () => {});
        expect(screen.getAllByRole("option").every(o => !(o as HTMLOptionElement).disabled)).toBe(true);
    });
    it("opens on the type gallery for the current map and filters by group and search", () => {
        const { dialog } = setup();
        expect((dialog.getByRole("combobox", { name: "Map cho kịch bản" }) as HTMLSelectElement).value).toBe("scene-0103");
        expect(dialog.getAllByRole("button", { name: /^Chọn loại / })).toHaveLength(20);
        fireEvent.click(dialog.getByRole("button", { name: "Giao lộ" }));
        expect(dialog.getAllByRole("button", { name: /^Chọn loại / })).toHaveLength(3);
        fireEvent.click(dialog.getByRole("button", { name: "Tất cả" }));
        fireEvent.change(dialog.getByRole("textbox", { name: "Tìm loại kịch bản" }), { target: { value: "phanh" } });
        expect(dialog.getByRole("button", { name: "Chọn loại Dừng khẩn cấp" })).toBeTruthy();
        expect(dialog.queryByRole("button", { name: "Tạo từ template" })).toBeNull();
    });
    it("edits key params of the picked type and validates the template", () => {
        const { dialog } = setup();
        fireEvent.click(dialog.getByRole("button", { name: "Chọn loại Dừng khẩn cấp" }));
        expect(dialog.getByRole("img", { name: "Sơ đồ kịch bản" })).toBeTruthy();
        fireEvent.change(dialog.getByRole("slider", { name: "Khoảng cách ban đầu" }), { target: { value: "35" } });
        fireEvent.click(dialog.getByRole("tab", { name: "JSON" }));
        const json = JSON.parse(dialog.getByLabelText("Nội dung template (JSON)").textContent!);
        expect(json).toMatchObject({ profile: "topeye-scenario-template-v1", scenario_type: "emergency_stop", params: { gap_m: 35 }, map: { scene: "scene-0103" } });
        expect(json.actors.find((a: { id: string }) => a.id === "lead").start.x_m).toBe(39.5);
        fireEvent.click(dialog.getByRole("button", { name: "Kiểm tra" }));
        expect(dialog.getByText("Template hợp lệ")).toBeTruthy();
        fireEvent.change(dialog.getByRole("spinbutton", { name: "Thời lượng" }), { target: { value: "90" } });
        fireEvent.click(dialog.getByRole("button", { name: "Kiểm tra" }));
        expect(within(dialog.getByRole("alert")).getByText("Thời lượng phải trong 2–60 s")).toBeTruthy();
        fireEvent.click(dialog.getByRole("button", { name: "Đổi loại" }));
        expect(dialog.getAllByRole("button", { name: /^Chọn loại / })).toHaveLength(20);
    });
    it("creates from the template only when the client checks pass, then closes", async () => {
        const { dialog, props } = setup();
        fireEvent.click(dialog.getByRole("button", { name: "Chọn loại Xe cắt làn" }));
        fireEvent.change(dialog.getByRole("spinbutton", { name: "Thời lượng" }), { target: { value: "90" } });
        fireEvent.click(dialog.getByRole("button", { name: "Tạo từ template" }));
        expect(props.onCreateTemplate).not.toHaveBeenCalled();
        expect(dialog.getByRole("alert")).toBeTruthy();
        fireEvent.change(dialog.getByRole("spinbutton", { name: "Thời lượng" }), { target: { value: "12" } });
        fireEvent.change(dialog.getByRole("spinbutton", { name: "Điểm bắt đầu trên quỹ đạo nguồn" }), { target: { value: "25" } });
        await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Tạo từ template" })); });
        expect(props.onCreateTemplate).toHaveBeenCalledWith(expect.objectContaining({ scenario_type: "cut_in", map: expect.objectContaining({ scene: "scene-0103", duration_s: 12, placement: { start_m: 25, lateral_m: 0, auto: true, mirror: false } }) }));
        expect(props.onClose).toHaveBeenCalled();
    });
    it("is disabled while a job runs", () => {
        const { dialog } = setup(true);
        fireEvent.click(dialog.getByRole("button", { name: "Chọn loại Xe cắt làn" }));
        expect((dialog.getByRole("button", { name: "Tạo từ template" }) as HTMLButtonElement).disabled).toBe(true);
    });
    it("keeps an event the user added when a key param regenerates the preset", () => {
        const { dialog } = setup();
        fireEvent.click(dialog.getByRole("button", { name: "Chọn loại Người đi bộ băng qua" }));
        fireEvent.click(dialog.getByRole("button", { name: "Thêm tình huống" }));
        fireEvent.change(dialog.getByRole("slider", { name: "Vận tốc ego" }), { target: { value: "30" } });
        expect(dialog.getByText("⚡ ego: Phanh gấp · 2 s")).toBeTruthy();
        expect((dialog.getByRole("combobox", { name: "Đối tượng của tình huống 1" }) as HTMLSelectElement).value).toBe("ego");
    });
    it("adds a new hard-brake event to ego, and a pedestrian can only stop", () => {
        const { dialog } = setup();
        fireEvent.click(dialog.getByRole("button", { name: "Chọn loại Người đi bộ băng qua" }));
        fireEvent.click(dialog.getByRole("button", { name: "Thêm tình huống" }));
        const actorSelect = dialog.getByRole("combobox", { name: "Đối tượng của tình huống 1" }) as HTMLSelectElement;
        expect(actorSelect.value).toBe("ego");
        expect((dialog.getByRole("combobox", { name: "Loại tình huống 1" }) as HTMLSelectElement).value).toBe("hard_brake");
        expect(dialog.getByText("⚡ ego: Phanh gấp · 2 s")).toBeTruthy();
        fireEvent.change(actorSelect, { target: { value: "ped" } });
        const typeSelect = dialog.getByRole("combobox", { name: "Loại tình huống 1" }) as HTMLSelectElement;
        expect(typeSelect.value).toBe("stop");
        expect([...typeSelect.options].map(o => o.value)).not.toContain("hard_brake");
    });
    it("warns before key params overwrite hand edits", () => {
        const { dialog } = setup();
        fireEvent.click(dialog.getByRole("button", { name: "Chọn loại Xe cắt làn" }));
        fireEvent.click(dialog.getByRole("button", { name: "Thêm đối tượng" }));
        expect(dialog.getByText(/Đổi tham số chính sẽ sinh lại/)).toBeTruthy();
        fireEvent.change(dialog.getByRole("slider", { name: "Vận tốc ego" }), { target: { value: "70" } });
        expect(dialog.queryByText(/Đổi tham số chính sẽ sinh lại/)).toBeNull();
    });
    it("chats in the AI tab: text replies, choices, refinement, then opens the template", async () => {
        vi.useFakeTimers();
        const { dialog } = setup();
        expect(dialog.queryByRole("heading", { name: "Tạo kịch bản" })).toBeNull();
        fireEvent.click(dialog.getByRole("tab", { name: "Bằng AI" }));
        const log = within(dialog.getByRole("log", { name: "Hội thoại với AI" }));
        expect(log.getByText(/Chào bạn!/)).toBeTruthy();
        const box = dialog.getByRole("textbox", { name: "Nhắn cho AI" });
        fireEvent.change(box, { target: { value: "một tình huống bất kỳ" } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(log.getByText("một tình huống bất kỳ")).toBeTruthy();
        await act(async () => { vi.advanceTimersByTime(800); });
        expect(log.getByText(/chưa nhận ra tình huống/)).toBeTruthy();
        fireEvent.click(log.getByRole("button", { name: "Người đi bộ băng qua" }));
        await act(async () => { vi.advanceTimersByTime(800); });
        expect(log.getByRole("region", { name: "Kết quả AI" })).toBeTruthy();
        fireEvent.change(box, { target: { value: "ego 30 km/h, từ bên trái, ban đêm" } });
        fireEvent.click(dialog.getByRole("button", { name: "Gửi" }));
        await act(async () => { vi.advanceTimersByTime(800); });
        expect(log.getByText("Đã cập nhật kịch bản “Người đi bộ băng qua”.")).toBeTruthy();
        // Choices on older replies are disabled; the latest stays active.
        const opens = log.getAllByRole("button", { name: "Mở trong template để chỉnh" }) as HTMLButtonElement[];
        expect(opens.map(b => b.disabled)).toEqual([true, false]);
        fireEvent.click(opens[1]);
        expect(dialog.getByRole("tab", { name: "Từ template" }).getAttribute("aria-selected")).toBe("true");
        expect((dialog.getByRole("combobox", { name: "Xuất phát từ" }) as HTMLSelectElement).value).toBe("left");
        expect((dialog.getByRole("slider", { name: "Vận tốc ego" }) as HTMLInputElement).value).toBe("30");
        expect((dialog.getByRole("combobox", { name: "Thời tiết của template" }) as HTMLSelectElement).value).toBe("ClearNight");
        fireEvent.click(dialog.getByRole("tab", { name: "Bằng AI" }));
        expect(log.getByText("ego 30 km/h, từ bên trái, ban đêm")).toBeTruthy();
    });
    it("keeps the .xosc import and map export, disabled while a job runs", async () => {
        const busy = setup(true);
        expect((busy.dialog.getByRole("button", { name: "Chọn file .xosc" }) as HTMLButtonElement).disabled).toBe(true);
        cleanup();
        const { dialog, props } = setup();
        fireEvent.click(dialog.getByRole("button", { name: "Tải thông tin map" }));
        expect(props.onExportMap).toHaveBeenCalledWith("scene-0103");
        await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Chọn file .xosc" })); });
        expect(props.onImportXosc).toHaveBeenCalledWith("scene-0103");
        expect(props.onClose).toHaveBeenCalled();
    });
    it("renders in English", () => {
        const { dialog } = setup(false, "en");
        expect(dialog.getByRole("button", { name: "Choose type Emergency stop" })).toBeTruthy();
        expect(dialog.getByRole("tab", { name: "With AI" })).toBeTruthy();
    });
});

describe("map suggestions", () => {
    it("probes every map for the picked type, current map first, and picks a usable one", async () => {
        vi.useFakeTimers();
        const fit = vi.fn(async (scene: string, _template: ScenarioTemplate) => scene === "scene-0061"
            ? { scene, ok: true as const, placement: { start_m: 35, lateral_m: 0, auto: true, mirror: true } }
            : { scene, ok: false as const, code: "DYNAMIC_LIMIT", message: "ego: acceleration limit" });
        render(<LanguageProvider value="vi"><div className="studio"><ScenarioCreator scenes={["scene-0061", "scene-0103"]} currentScene="scene-0103" busy={false}
            onClose={vi.fn()} onExportMap={vi.fn(async () => ({}))} onImportXosc={vi.fn(async () => true)} onCreateTemplate={vi.fn(async () => true)} fitTemplate={fit}/></div></LanguageProvider>);
        const dialog = within(screen.getByRole("dialog", { name: "Tạo kịch bản" }));
        fireEvent.click(dialog.getByRole("button", { name: "Chọn loại Dừng khẩn cấp" }));
        expect(within(dialog.getByRole("region", { name: "Map phù hợp" })).getByText("Đang kiểm 0/2 map…")).toBeTruthy();
        await act(async () => { vi.advanceTimersByTime(10); });
        expect(fit.mock.calls.map(c => c[0])).toEqual(["scene-0103", "scene-0061"]);
        const box = within(dialog.getByRole("region", { name: "Map phù hợp" }));
        expect(box.getByText("1/2 map dùng được")).toBeTruthy();
        expect(box.getByText(/Map đang chọn \(scene-0103\) không đặt được loại này: cua gắt \/ vượt gia tốc/)).toBeTruthy();
        expect(box.getByText("35 m · lật")).toBeTruthy();
        fireEvent.click(box.getByRole("button", { name: /scene-0061/ }));
        expect((dialog.getByRole("combobox", { name: "Map cho kịch bản" }) as HTMLSelectElement).value).toBe("scene-0061");
        // Changing a key param re-probes after the debounce; the map choice alone does not.
        const calls = fit.mock.calls.length;
        await act(async () => { vi.advanceTimersByTime(1100); });
        expect(fit.mock.calls.length).toBe(calls);
        fireEvent.change(dialog.getByRole("slider", { name: "Vận tốc ego" }), { target: { value: "30" } });
        expect(box.getByText("Đang kiểm 0/2 map…")).toBeTruthy();  // old results are not reported as current
        await act(async () => { vi.advanceTimersByTime(1100); });
        expect(fit.mock.calls.length).toBe(calls + 2);
        expect(fit.mock.calls.at(-1)?.[1].params.ego_kmh).toBe(30);
    });
});
