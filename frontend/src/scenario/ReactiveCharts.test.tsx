// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactiveCharts } from "./ReactiveCharts";
import type { ReactiveDetail } from "./reactiveTypes";

afterEach(cleanup);

const detail = (series: ReactiveDetail["series"], markers: ReactiveDetail["markers"] = []) => ({
    series, markers, vehicles: { car_154: { role: "event" }, ego: { role: "ego" } },
} as unknown as ReactiveDetail);
const series: ReactiveDetail["series"] = {
    t: [0, 0.1, 0.2, 0.3],
    vehicles: { ego: { v: [9, 9, 8.9, 8.8], v_rec: [9, 9, 9, 9], a: [0, 0, -1.2, -1.2] }, car_154: { v: [10, null, 9.2, 9], v_rec: [10, 10, 10, 10], a: [0, -4, -4, null] } },
    ego: { gap: [12, 11.5, null, 10.9], ttc: [99, 20, null, 6] },
};

describe("ReactiveCharts", () => {
    it("draws speed (simulated solid, recorded dashed), acceleration, ego gap and TTC with thresholds and markers", () => {
        render(<ReactiveCharts detail={detail(series, [{ t: 0, kind: "brake_start", agent: "car_154" }, { t: 0.2, kind: "reacts", agent: "ego" }])}/>);
        const speed = screen.getByRole("img", { name: "Tốc độ car_154" });
        expect(speed.querySelector(".reactive-sim")?.getAttribute("d")).toMatch(/^M[\d.]+ [\d.]+M/); // null breaks the line
        expect(speed.querySelector(".reactive-rec")?.getAttribute("d")).toContain("L");
        expect(speed.querySelectorAll(".reactive-marker")).toHaveLength(2);
        expect(speed.textContent).toContain("bắt đầu phanh");
        expect(screen.getByRole("img", { name: "Gia tốc car_154" })).toBeTruthy();
        expect(screen.getByRole("img", { name: "Khoảng cách xe của bạn tới xe trước" }).querySelectorAll(".reactive-threshold")).toHaveLength(1);
        const ttc = screen.getByRole("img", { name: "TTC xe của bạn" });
        expect(ttc.querySelectorAll(".reactive-threshold")).toHaveLength(1);
        expect(ttc.textContent).toContain("10 s"); // clamped axis, the 99 s clamp stays off-scale
        expect(screen.getByText("phản ứng", { exact: false, selector: "li" })).toBeTruthy();
    });
    it("switches the vehicle of the speed and acceleration charts", () => {
        render(<ReactiveCharts detail={detail(series)}/>);
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "ego" } });
        expect(screen.getByRole("img", { name: "Tốc độ ego" })).toBeTruthy();
    });
    it("does not break on null-only, empty or missing series", () => {
        const { unmount } = render(<ReactiveCharts detail={detail({ t: [0, 0.1], vehicles: { ego: { v: [null, null], v_rec: [null, null], a: [null, null] } }, ego: { gap: [null, null], ttc: [null, null] } })}/>);
        expect(screen.getAllByRole("img")).toHaveLength(4);
        for (const p of document.querySelectorAll("path")) expect(p.getAttribute("d")).not.toContain("NaN");
        unmount();
        render(<ReactiveCharts detail={{} as ReactiveDetail}/>);
        expect(screen.getAllByRole("img")).toHaveLength(4);
        expect(screen.queryByRole("combobox")).toBeNull();
    });
});
