// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MetricsPanel } from "./MetricsPanel";
import type { SceneMetrics } from "./types";

const obj = (role: string, category: string, base: number[], pilot: number[] | null) => ({
    category, role, length_m: 4.5, width_m: 1.9, height_m: 1.6, keyframes: 3, span_s: 0.1,
    grid_t: [0, 0.05, 0.1], baseline_err: base, pilot_err: pilot,
    baseline_lon_lat: base.map(v => [-v, 0.5] as [number, number]), pilot_lon_lat: pilot && pilot.map(() => [0, 0] as [number, number]),
    baseline_ade_m: base.reduce((a, b) => a + b) / base.length, baseline_max_m: Math.max(...base),
    pilot_ade_m: pilot ? 0.001 : null, pilot_max_m: pilot ? 0.002 : null,
});
const data: SceneMetrics = {
    version: "scene-metrics-v3", scene: "scene-0061", generated_at: "", engine: "esmini 3.9.0",
    objects: { total: 228, moving: 49 },
    replay: { pilot: { ade_m: 0.0001, max_m: 0.0002 }, baseline: { ade_m: 3.2088, max_m: 111.7 }, objects: 49 },
    variants: { per_object: 16, total: 112, pilot_valid: 63, baseline_valid: 38, map_checked: true },
    rare: { pilot: 0, original: 0 },
    per_object: { "ego-1": obj("ego", "vehicle.ego", [0, 1, 2], [0, 0, 0]), "abcdef1234": obj("traffic", "human.pedestrian.adult", [0, 0.3, 0.6], null) },
    notes: ["interp", "Không có esmini: x"],
};

afterEach(cleanup);
describe("MetricsPanel", () => {
    it("shows the four scene cards and the selected object's deviation at the current time", () => {
        render(<MetricsPanel state={{ key: "k", status: "ready", data }} time={0.1}/>);
        expect(screen.getByText("Sai số phát lại (Topeye)").nextElementSibling?.textContent).toBe("0,000 m");
        expect(screen.getByText("baseline 3,209 m")).toBeTruthy();
        expect(screen.getByText("trên 228 vật thể")).toBeTruthy();
        expect(screen.getByText("63/112")).toBeTruthy();
        expect(screen.getByText(/56,3% · baseline 33,9%/)).toBeTruthy();
        expect(screen.getByText("Không có esmini: x")).toBeTruthy();
        // Ego is selected first; at 0.1 s baseline is 2 m behind and 0.5 m to the left.
        expect((screen.getByLabelText("Vật thể đang chọn") as HTMLSelectElement).value).toBe("ego-1");
        expect(screen.getByText("Độ lệch so với vị trí thật lúc 0,1 s")).toBeTruthy();
        expect(screen.getByText("tụt sau 2,00 m · lệch trái 0,50 m")).toBeTruthy();
        fireEvent.change(screen.getByLabelText("Vật thể đang chọn"), { target: { value: "abcdef1234" } });
        expect(screen.getByText("Người đi bộ", { selector: ".chip" })).toBeTruthy();
        expect(screen.getByText("Baseline").nextElementSibling?.textContent).toBe("0,60 m");
    });
    it("reports time outside the labelled span and the loading state", () => {
        const { rerender } = render(<MetricsPanel state={{ key: "s", status: "ready", data }} time={5}/>);
        expect(screen.getByText("Thời điểm đang xem nằm ngoài khoảng có nhãn")).toBeTruthy();
        rerender(<MetricsPanel state={{ key: "s", status: "loading" }} time={0}/>);
        expect(screen.getByRole("status").textContent).toContain("Đang tính chỉ số");
    });
});
