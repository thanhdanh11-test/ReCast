import { describe, expect, it } from "vitest";
import { checkTally, keyMoments, kpiRows, verdictOf } from "./analysis";
import type { ReactiveDetail } from "../reactiveTypes";

const ego = (min_gap: number | null, min_ttc: number | null, a_min: number | null, a_used: number | null) => ({ min_gap, min_ttc, a_min, a_used, conflict_with: "car_1" });
const detail = {
    comparison: {
        baseline: { valid: true, group: "collision", reasons: [], ego: ego(0, 0.4, 5.2, null), collisions: [["ego", "car_1", 3.1, "ego"]], reacted: [] },
        pilot: { valid: true, group: "mild", reasons: [], ego: ego(4.2, 2.8, 1.1, 3), collisions: [], reacted: ["ego"] },
    },
    checks: [{ id: "physics", passed: true }, { id: "esmini", passed: null }, { id: "collision", passed: false }],
    markers: [{ t: 2, kind: "reacts", agent: "ego" }, { t: 1, kind: "brake_start", agent: "car_1" }, { t: 2, kind: "reacts", agent: "ego" }],
} as unknown as ReactiveDetail;
const thr = { close_gap_m: 1, close_ttc_s: 1.5, comfort_decel: 3.4 };

describe("verdictOf", () => {
    it("grades higher-is-better and lower-is-better against the threshold, null without data", () => {
        expect(verdictOf(0.5, 1, "higher")).toBe("over");
        expect(verdictOf(1.2, 1, "higher")).toBe("near");
        expect(verdictOf(1.5, 1, "higher")).toBe("ok");
        expect(verdictOf(4, 3.4, "lower")).toBe("over");
        expect(verdictOf(3, 3.4, "lower")).toBe("near");
        expect(verdictOf(1, 3.4, "lower")).toBe("ok");
        expect(verdictOf(null, 1, "higher")).toBeNull();
        expect(verdictOf(2, null, "higher")).toBeNull();
    });
});

describe("kpiRows", () => {
    it("compares baseline and pilot with direction and thresholds from the report", () => {
        const rows = Object.fromEntries(kpiRows(detail, thr).map(r => [r.id, r]));
        expect(rows.min_gap).toMatchObject({ baseline: 0, pilot: 4.2, delta: 4.2, improved: true, threshold: 1, verdict: "ok" });
        expect(rows.min_ttc).toMatchObject({ baseline: 0.4, pilot: 2.8, improved: true, threshold: 1.5, verdict: "ok" });
        expect(rows.a_min).toMatchObject({ baseline: 5.2, pilot: 1.1, improved: true, threshold: 3.4, verdict: "ok" });
        expect(rows.a_used).toMatchObject({ baseline: null, pilot: 3, delta: null, improved: null, verdict: "near" });
        expect(rows.ego_collisions).toMatchObject({ baseline: 1, pilot: 0, improved: true, threshold: 0, verdict: "ok" });
    });
    it("never invents a threshold the report does not carry", () => {
        const rows = kpiRows(detail, undefined);
        expect(rows.filter(r => r.id !== "ego_collisions").every(r => r.threshold === null && r.verdict === null)).toBe(true);
    });
});

it("tallies checks and orders key moments without duplicates", () => {
    expect(checkTally(detail.checks)).toEqual({ passed: 1, failed: 1, unknown: 1 });
    expect(keyMoments(detail).map(m => `${m.t}:${m.kind}`)).toEqual(["1:brake_start", "2:reacts"]);
});

describe("plan54 relevantIds", () => {
    it("keeps the ego, the event vehicle, reacting vehicles, the conflict partner and vehicles of the reactive detail", async () => {
        const { relevantIds, mentions } = await import("./analysis");
        const report = { event: { actor: "car_154" }, reacted: ["car_200", "ego"], ego: { conflict_with: "truck_9" },
            topeye: { vehicles: { ego: {}, car_154: {}, car_300: {} } } } as never;
        expect([...relevantIds(report)].sort()).toEqual(["car_154", "car_200", "car_300", "ego", "truck_9"]);
        expect([...relevantIds(null)]).toEqual(["ego"]);
        expect(mentions("car_154 – car_1540 @3,1 s", new Set(["car_1540"]))).toBe(true);
        expect(mentions("car_15 – car_16", new Set(["car_1"]))).toBe(false);
    });
});
