// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelpTip, placeTip } from "./HelpTip";
import { GROUP_LABEL, GROUP_TERM, TERMS } from "./terms";

afterEach(cleanup);

/** replay-forge real2sim/app/static/js/help.js @ d36205b keys (43), in their order. */
const REPLAY_FORGE_KEYS = ["pick", "ego", "t0", "strength", "decel", "target", "dwell", "reaction", "react", "trigger", "sensitivity",
    "valid", "group", "close", "hard", "min_gap", "ttc", "braking", "recorded_gap", "reacted",
    "idm", "T_s0", "jerk", "max_decel", "modes",
    "c_esmini", "c_physics", "c_label", "c_collision", "c_excused", "c_tailgate", "c_merge", "c_appear",
    "esmini_err", "esmini_acc", "ade", "keyframes", "label_problem", "space", "provenance", "quality", "package", "found"];

describe("TERMS", () => {
    it("has the 43 replay-forge keys plus the 5 display groups and the 4 plan47 kind keys, each with a title and a body", () => {
        expect(REPLAY_FORGE_KEYS).toHaveLength(43);
        expect(Object.keys(TERMS)).toEqual([...REPLAY_FORGE_KEYS, "g_collision", "g_hard", "g_close", "g_mild", "g_far",
            "kind", "k_accelerate", "k_stopline", "k_lane_change"]);
        for (const [title, body] of Object.values(TERMS)) { expect(title.length).toBeGreaterThan(1); expect(body.length).toBeGreaterThan(10); }
    });
    it("rewords the topeye-specific terms and names groups for readers, with the raw code in the explanation", () => {
        expect(TERMS.ego[1]).toContain("nuScenes hoặc AV2");
        expect(TERMS.valid[1]).toContain("Kiểm bằng esmini");
        expect(TERMS.react[1]).toMatch(/Pilot.*Baseline/);
        expect(TERMS.ade[1]).toContain("real2sim");
        expect(GROUP_LABEL).toEqual({ collision: "xe của bạn đâm", hard: "phải phanh gấp", close: "suýt chạm", mild: "phanh nhẹ là đủ", far: "không ảnh hưởng" });
        for (const [group, term] of Object.entries(GROUP_TERM)) expect(TERMS[term][1]).toContain(`Mã gốc: ${group}.`);
    });
});

describe("HelpTip", () => {
    const mark = () => screen.getByRole("button", { name: "Giải thích: TTC (thời gian tới va chạm)" });
    const tip = () => screen.queryByRole("tooltip");

    it("shows on hover and hides on leave", () => {
        render(<HelpTip term="ttc"/>);
        expect(tip()).toBeNull();
        fireEvent.mouseEnter(mark());
        expect(tip()?.textContent).toContain("dưới 1,5 s được tính là suýt chạm");
        expect(mark().getAttribute("aria-describedby")).toBe(tip()?.id);
        fireEvent.mouseLeave(mark());
        expect(tip()).toBeNull();
    });
    it("shows on focus, hides on blur and on Escape", () => {
        render(<HelpTip term="ttc"/>);
        fireEvent.focus(mark());
        expect(tip()).not.toBeNull();
        fireEvent.blur(mark());
        expect(tip()).toBeNull();
        fireEvent.focus(mark());
        fireEvent.keyDown(document, { key: "Escape" });
        expect(tip()).toBeNull();
    });
    it("pins on click (touch), survives leaving, closes on a second click or a click elsewhere", () => {
        render(<><HelpTip term="ttc"/><p>khác</p></>);
        fireEvent.click(mark());
        fireEvent.mouseLeave(mark());
        expect(tip()).not.toBeNull();
        fireEvent.click(mark());
        expect(tip()).toBeNull();
        fireEvent.click(mark());
        fireEvent.pointerDown(screen.getByText("khác"));
        expect(tip()).toBeNull();
    });
});

describe("placeTip (plan47 WP2 §7: never cut by the viewport)", () => {
    const view = { width: 1440, height: 900 }, tip = { width: 320, height: 120 };
    const at = (x: number, y: number) => ({ left: x, right: x + 15, top: y, bottom: y + 15 });
    it("sits below and centred when it fits", () => {
        expect(placeTip(at(700, 100), tip, view)).toEqual({ left: 547.5, top: 121 });
    });
    it("slides inside the left and right edges", () => {
        expect(placeTip(at(2, 100), tip, view).left).toBe(8);
        expect(placeTip(at(1430, 100), tip, view).left).toBe(1440 - 320 - 8);
    });
    it("flips above when the bottom would cut it", () => {
        expect(placeTip(at(700, 850), tip, view).top).toBe(850 - 6 - 120);
    });
});
