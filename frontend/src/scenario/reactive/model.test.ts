// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "../i18n";
import { EN } from "../i18n.en";
import { LAYERS } from "./ReactiveMap";
import { ACTOR_LABEL, BRAKE_LEVEL_LABEL, DEFAULT_PARAMS, GOALS, KIND_LABEL, START_LABEL, START_MARK, STEP2_LABEL, categoryName, defaultTarget, eventOf, fmt,
    kindsOf, loadMode, saveMode, speedAt, targetRange, timelineMarks, verdictOf, windowsOf } from "./model";
import { allKinds, brakeOnly, detail, source } from "./fixtures";

const tr = (vi: string, vars?: Record<string, string | number>) => translate("vi", vi, vars);
afterEach(() => vi.restoreAllMocks());

describe("kinds and windows (plan47 C2)", () => {
    it("offers only the kinds the worker sent; a v0.34.0 candidate is brake only", () => {
        expect(kindsOf(allKinds)).toEqual(["brake", "accelerate", "stopline", "lane_change"]);
        expect(kindsOf(brakeOnly)).toEqual(["brake", "accelerate"]);
        expect(kindsOf({ ...brakeOnly, kinds: undefined })).toEqual(["brake"]);
        expect(kindsOf(undefined)).toEqual([]);
    });
    it("reads the windows of each kind by its own key", () => {
        expect(windowsOf(allKinds, "brake", { ...DEFAULT_PARAMS, decel: 2, goal: "stop" })).toEqual([[1, 5]]);
        expect(windowsOf(allKinds, "accelerate", { ...DEFAULT_PARAMS, accel: 3 })).toEqual([[2, 6]]);
        expect(windowsOf(allKinds, "stopline", { ...DEFAULT_PARAMS, dwell: 10 })).toEqual([[0, 2]]);
        expect(windowsOf(allKinds, "lane_change", { ...DEFAULT_PARAMS, direction: "right", duration: 4 })).toEqual([]);
        expect(windowsOf(brakeOnly, "stopline", DEFAULT_PARAMS)).toEqual([]);
        // brake levels above the vehicle's limit have no window
        expect(windowsOf(brakeOnly, "brake", { ...DEFAULT_PARAMS, decel: 8 })).toEqual([]);
    });
});

describe("events (01-CONTRACTS C1: only the chosen kind's fields)", () => {
    const base = { actor_id: "tok-car", t0_s: 2, react: true, reaction_s: 1 };
    it("brake keeps the plan45 shape without kind", () => {
        expect(eventOf(allKinds, "brake", { ...DEFAULT_PARAMS, goal: "dwell" }, 2, null)).toEqual({ ...base, decel_mps2: 4, target: "stop", dwell_s: 3 });
    });
    it("other kinds carry kind + their own fields only", () => {
        expect(eventOf(allKinds, "accelerate", DEFAULT_PARAMS, 2, 14)).toEqual({ ...base, kind: "accelerate", target_mps: 14, accel_mps2: 2 });
        expect(eventOf(allKinds, "accelerate", DEFAULT_PARAMS, 2, null)).toBeNull();
        expect(eventOf(allKinds, "stopline", DEFAULT_PARAMS, 2, null)).toEqual({ ...base, kind: "stopline", dwell_s: 3 });
        expect(eventOf(allKinds, "lane_change", { ...DEFAULT_PARAMS, direction: "right", duration: 6 }, 2, null))
            .toEqual({ ...base, kind: "lane_change", direction: "right", duration_s: 6 });
    });
    it("accelerate targets lie in (speed + 0,5; max_target_mps] on a 0,5 grid", () => {
        const speed = speedAt(source.actors[1], 2);
        expect(speed).toBeCloseTo(8);
        expect(targetRange(allKinds, speed)).toEqual({ min: 9, max: 18 });
        expect(defaultTarget({ min: 9, max: 18 }, speed)).toBe(11);
        expect(defaultTarget({ min: 9, max: 10 }, speed)).toBe(10);
        expect(targetRange(allKinds, 17.6)).toBeNull();
        expect(targetRange({ ...allKinds, kinds: {} }, 8)).toBeNull();
        expect(speedAt(source.actors[1], 25)).toBeNull();
    });
});

describe("labels", () => {
    it("translates dataset categories to Vietnamese", () => {
        expect(categoryName("vehicle.car")).toBe("xe con");
        expect(categoryName("vehicle.truck")).toBe("xe tải");
        expect(categoryName("human.pedestrian.adult")).toBe("người đi bộ");
        expect(categoryName("animal")).toBe("animal");
    });
    it("uses the decimal comma", () => {
        expect(fmt(9.55, 1, " m")).toBe("9,6 m");
        expect(fmt(null, 1)).toBe("—");
    });
    it("has an English entry for every label rendered through t(variable)", () => {
        const keys = [KIND_LABEL, ACTOR_LABEL, START_LABEL, START_MARK, STEP2_LABEL, BRAKE_LEVEL_LABEL].flatMap(Object.values)
            .concat(Object.values(GOALS).map(g => g.label), LAYERS.map(([, label]) => label), ["ego phản ứng", "xe con", "xe tải", "rơ-moóc / công trình", "vật cản"]);
        expect(keys.filter(k => !(k in EN))).toEqual([]);
    });
});

describe("verdict and marks", () => {
    it("judges the package's own variant", () => {
        expect(verdictOf(detail, true)?.tone).toBe("ok");
        const unsupported = { ...detail, comparison: { ...detail.comparison, pilot: { ...detail.comparison.pilot, valid: false, reasons: ["unsupported_interaction"] } } };
        expect(verdictOf(unsupported, true)?.tone).toBe("unsupported");
        const mixed = { ...detail, comparison: { ...detail.comparison, pilot: { ...detail.comparison.pilot, valid: false, reasons: ["physics", "unsupported_interaction"] } } };
        expect(verdictOf(mixed, true)?.tone).toBe("bad");
        const bad = { ...detail, comparison: { ...detail.comparison, pilot: { ...detail.comparison.pilot, valid: false, reasons: ["collision"] } } };
        expect(verdictOf(bad, true)?.tone).toBe("bad");
    });
    it("labels the event start per kind, the ego reaction and the closest point; other markers are ticks", () => {
        const marks = timelineMarks(detail.markers, "lane_change", 0, tr);
        expect(marks.filter(m => m.label).map(m => m.label)).toEqual(["chuyển làn", "ego phản ứng", "gần nhất 9,6 m"]);
        expect(marks.filter(m => !m.label).map(m => m.kind)).toEqual(["brake_full"]);
        const crashes = timelineMarks([{ t: 1, kind: "collision", agent: "a" }, { t: 2, kind: "collision", agent: "b" }], "brake", 0, tr);
        expect(crashes.map(m => m.label)).toEqual(["phanh", "va chạm", ""]);
        expect(timelineMarks(undefined, "stopline", 2, tr)).toEqual([{ t: 2, kind: "start", label: "dừng ở vạch", tone: "event" }]);
        expect(timelineMarks(undefined, "brake", null, tr)).toEqual([]);
    });
});

describe("mode memory", () => {
    it("remembers the mode and survives a storage that throws", () => {
        saveMode("simple");
        expect(loadMode()).toBe("simple");
        vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
        expect(() => saveMode("simple")).not.toThrow();
        expect(loadMode()).toBe("technical");
    });
});
