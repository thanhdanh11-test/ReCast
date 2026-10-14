// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage, type SettingsPageProps } from "./SettingsPage";
import { defaultPreferences } from "./preferences";
import { LanguageProvider } from "./i18n";
import type { DesktopAPI } from "./types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup(overrides: Partial<SettingsPageProps> = {}, api: Partial<DesktopAPI> = {}) {
    const props: SettingsPageProps = {
        preferences: defaultPreferences, onChange: vi.fn(), onBack: vi.fn(), demo: false,
        api: { storageInfo: vi.fn(async () => ({ workspace: "/w", scenarios: 3, scenarioBytes: 3 * 1024 * 1024, metricsBytes: 2048, trashBytes: 10, trashItems: 2 })),
            clearMetricsCache: vi.fn(async () => ({ removed: 3 })), emptyTrash: vi.fn(async () => ({ removed: 2 })),
            submitFeedback: vi.fn(async () => ({ id: "f", saved_at: "2026-10-13T10:00:00Z" })), listFeedback: vi.fn(async () => []), ...api } as unknown as DesktopAPI,
        settings: { dataset: "nuscenes", datasetVersion: "v1.0-mini", workspace: "/w", engineAvailable: true, version: "0.25.0" },
        busy: false, onChooseDataset: vi.fn(), onChooseWorkspace: vi.fn(), feedbackContext: { version: "0.25.0", scene: "scene-0061" }, ...overrides,
    };
    render(<SettingsPage {...props}/>);
    return props;
}
const go = (name: string) => fireEvent.click(within(screen.getByRole("navigation", { name: "Mục cài đặt" })).getByRole("button", { name }));
const pick = (group: string, option: string) => fireEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option }));

describe("SettingsPage", () => {
    it("changes display, LiDAR, playback, unit and language preferences", () => {
        const p = setup();
        go("Hiển thị 3D"); pick("Góc camera khi mở cảnh", "Toàn cảnh"); pick("Bóng đổ", "Tắt"); pick("Hành lang đường đi của xe ego", "Ẩn");
        go("LiDAR"); pick("Tô màu điểm theo", "Cường độ phản xạ"); pick("Kích thước điểm", "Lớn");
        go("Phát lại"); pick("Tốc độ phát", "2×"); pick("Tự phát khi mở cảnh", "Bật"); pick("Lặp lại khi hết", "Bật");
        go("Đơn vị"); pick("Tốc độ", "m/s");
        go("Ngôn ngữ"); pick("Ngôn ngữ giao diện", "English");
        expect((p.onChange as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])).toEqual([
            { camera: "overview" }, { shadows: false }, { corridor: false }, { lidarColor: "intensity" }, { lidarPointSize: 3 },
            { playbackRate: 2 }, { autoplay: true }, { loop: true }, { speedUnit: "ms" }, { language: "en" }]);
    });
    it("shows storage, clears the metrics cache and empties trash only after confirmation", async () => {
        const p = setup();
        go("Dữ liệu & lưu trữ");
        expect(await screen.findByText("3 · 3.0 MB")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Xoá bộ nhớ đệm chỉ số" }));
        expect(await screen.findByText("Đã xoá bộ nhớ đệm chỉ số (3 kịch bản).")).toBeTruthy();
        const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
        window.confirm = confirm;
        fireEvent.click(screen.getByRole("button", { name: "Dọn thùng rác" }));
        expect(p.api.emptyTrash).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Dọn thùng rác" }));
        await waitFor(() => expect(p.api.emptyTrash).toHaveBeenCalledTimes(1));
        expect(confirm).toHaveBeenCalledTimes(2);
    });
    it("submits feedback with or without system context", async () => {
        const p = setup();
        go("Góp ý nhà sản xuất");
        fireEvent.click(within(screen.getByRole("radiogroup", { name: "Loại góp ý" })).getByRole("radio", { name: "Đề xuất" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Nội dung" }), { target: { value: "Thêm phím tắt" } });
        fireEvent.click(screen.getByRole("button", { name: "Gửi góp ý" }));
        expect(await screen.findByText("Đã lưu góp ý. Cảm ơn bạn!")).toBeTruthy();
        expect(p.api.submitFeedback).toHaveBeenCalledWith({ kind: "idea", message: "Thêm phím tắt", context: { version: "0.25.0", scene: "scene-0061" } });
        fireEvent.click(screen.getByRole("checkbox", { name: "Kèm thông tin hệ thống" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Nội dung" }), { target: { value: "Lỗi" } });
        fireEvent.click(screen.getByRole("button", { name: "Gửi góp ý" }));
        await waitFor(() => expect(p.api.submitFeedback).toHaveBeenLastCalledWith({ kind: "idea", message: "Lỗi" }));
    });
    it("account: changes the password through the local auth API and logs out", async () => {
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify({
            value: String(url).endsWith("auth/session") ? { configured: true, authenticated: true, username: "owner", sessionHours: 8 } : { ok: true } }), { status: 200 }));
        const p = setup({ onLogout: vi.fn() });
        go("Tài khoản");
        expect(await screen.findByText("owner")).toBeTruthy();
        fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), { target: { value: "old-password-123" } });
        fireEvent.change(screen.getByLabelText("Mật khẩu mới (12–128 ký tự)"), { target: { value: "new-password-456" } });
        fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), { target: { value: "different-pass-789" } });
        fireEvent.click(screen.getAllByRole("button", { name: "Đổi mật khẩu" })[0]);
        expect(await screen.findByText("Mật khẩu nhập lại không khớp.")).toBeTruthy();
        fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), { target: { value: "new-password-456" } });
        fireEvent.click(screen.getAllByRole("button", { name: "Đổi mật khẩu" })[0]);
        expect(await screen.findByText("Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất.")).toBeTruthy();
        const call = fetch.mock.calls.find(([u]) => String(u).endsWith("auth/password"))!;
        expect(JSON.parse(String(call[1]!.body))).toEqual({ current: "old-password-123", next: "new-password-456" });
        fireEvent.click(screen.getByRole("radio", { name: "1 ngày" }));
        await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => String(u).endsWith("auth/sessionHours") && JSON.parse(String(i!.body)).hours === 24)).toBe(true));
        fireEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
        expect(p.onLogout).toHaveBeenCalled();
    });
    it("web demo hides local-only sections; English renders the page in English", () => {
        render(<LanguageProvider value="en"><SettingsPage {...{ preferences: defaultPreferences, onChange: vi.fn(), onBack: vi.fn(), demo: true, api: {} as DesktopAPI,
            settings: null, busy: false, onChooseDataset: vi.fn(), onChooseWorkspace: vi.fn(), feedbackContext: {} }}/></LanguageProvider>);
        const nav = within(screen.getByRole("navigation", { name: "Settings sections" }));
        expect(nav.queryByRole("button", { name: "Data & storage" })).toBeNull();
        expect(nav.queryByRole("button", { name: "Account" })).toBeNull();
        expect(nav.getByRole("button", { name: "Appearance" })).toBeTruthy();
        expect(screen.getByRole("radiogroup", { name: "Colour mode" })).toBeTruthy();
    });
});
