import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import { isKindMetrics, kindSpace, paramsLabel, paramsOf, rareCases } from "./kindMetrics";
import { accelMetrics } from "./fixtures";
import type { ReactiveMetrics } from "../reactiveTypes";

const tr = (vi: string, vars?: Record<string, string | number>) => translate("vi", vi, vars);
const brake = { scene: "s", engine: "e", grid: { event_step_s: 2, decels: [4], targets: [["stop", 0]] }, cells: [], sensitivity: [],
    rare: [{ actor: "car_154", actor_id: "tok-car", t0: 2, decel: 6, target: "stop", dwell: 3, group: "hard", ego_min_gap: 1, ego_min_ttc: 2, ego_a_min: 5 }] } as unknown as ReactiveMetrics;

describe("scene metric 2 per kind (plan47 C5)", () => {
    it("tells the two shapes apart", () => {
        expect(isKindMetrics(accelMetrics)).toBe(true);
        expect(isKindMetrics(brake)).toBe(false);
    });
    it("turns generic params into form fields and labels", () => {
        expect(paramsOf("accelerate", { accel_mps2: 2, target_mps: 14 })).toEqual({ accel: 2, target_mps: 14 });
        expect(paramsOf("stopline", { dwell_s: 10 })).toEqual({ dwell: 10 });
        expect(paramsOf("lane_change", { direction: "right", duration_s: 6 })).toEqual({ direction: "right", duration: 6 });
        expect(paramsLabel("accelerate", { accel_mps2: 2, target_mps: 14 }, tr)).toBe("2 m/s² → 14,0 m/s");
        expect(paramsLabel("stopline", { dwell_s: 3 }, tr)).toBe("chờ 3 s");
        expect(paramsLabel("lane_change", { direction: "left", duration_s: 4 }, tr)).toBe("trái · 4 s");
    });
    it("lists rare cases of both shapes", () => {
        expect(rareCases(accelMetrics, tr)).toEqual([{ actor: "car_154", actor_id: "tok-car", t0: 0, kind: "accelerate", params: { accel: 2, target_mps: 14 },
            label: "2 m/s² → 14,0 m/s", group: "close", ego_min_gap: 0.8, ego_min_ttc: 1.2 }]);
        expect(rareCases(brake, tr)[0]).toMatchObject({ kind: "brake", params: { decel: 6, goal: "dwell" }, label: "6 m/s² · Dừng 3 s rồi đi tiếp" });
    });
    it("places off-axis targets by their rank, one row per axis step", () => {
        const { times, rows } = kindSpace(accelMetrics, "tok-car", tr);
        expect(times).toEqual([0, 2]);
        expect(rows.map(r => [r.label, [...r.cells.keys()]])).toEqual([
            ["1 m/s² · tốc độ +3,0 m/s", [2]], ["2 m/s² · tốc độ +3,0 m/s", [0, 2]], ["2 m/s² · tốc độ +6,0 m/s", [0]]]);
    });
});
