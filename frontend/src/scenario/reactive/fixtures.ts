import type { Actor, Candidate, ImportedScenario, ReactiveCandidates, Scenario } from "../types";
import type { ReactiveDetail, ReactiveKindDetail, VariantOutcome } from "../reactiveTypes";

/**
 * Test data of the reactive workspace, shaped by reactiveTypes.ts plan47 (the engine of WP1 is not wired yet):
 * ego driving east at 8 m/s behind car_154, a parked truck, and a vehicle offering every kind.
 */
const environment = { polygons: [{ kind: "drivable_area", outer: [[-60, -10], [200, -10], [200, 10], [-60, 10]], holes: [] },
    { kind: "stop_line", outer: [[60, -2], [61, -2], [61, 2], [60, 2]], holes: [] }],
    lines: [], buildings: [], trees: [], poles: [], warnings: [], provenance: [] };
const track = (id: string, role: "ego" | "traffic", category: string, x0: number, v: number, y = 0): Actor => ({
    id, role, category, length_m: 4.5, width_m: 1.9, height_m: 1.6,
    samples: Array.from({ length: 21 }, (_, i) => ({ t_s: i, x_m: x0 + v * i, y_m: y, z_m: 0, yaw_rad: 0, observed: true })),
} as unknown as Actor);
export const source = {
    id: "source", mode: "source", interval_s: [0, 20], source: { scene: "scene-0061" }, road: { kind: "source_map" }, environment,
    actors: [track("ego", "ego", "vehicle.car", 0, 8), track("tok-car", "traffic", "vehicle.car", 15, 8), track("tok-truck", "traffic", "vehicle.truck", 40, 0, 6)],
} as unknown as Scenario;
export const allKinds: Candidate = {
    actor_id: "tok-car", name: "car_154", category: "vehicle.car", max_decel_mps2: 8, windows: [[0, 7]], followers: ["ego"],
    windows_by_event: { "stop:0:4": [[0, 7]], "hold:0:4": [[0, 7]], "half:0:4": [[0, 6]] },
    kinds: {
        brake: { windows_by_event: { "stop:0:4": [[0, 7]], "hold:0:4": [[0, 7]], "half:0:4": [[0, 6]], "stop:0:2": [[1, 5]], "hold:0:2": [[1, 5]] } },
        accelerate: { windows_by_accel: { "1": [[0, 8]], "2": [[0, 8]], "3": [[2, 6]] }, max_target_mps: 18 },
        stopline: { windows_by_dwell: { "0": [[0, 4]], "3": [[0, 4]], "10": [[0, 2]] }, stoplines: [{ id: "sl-1", x_m: 60, y_m: 0, type: "STOP_SIGN", t_reach_s: 5.6 }] },
        lane_change: { windows_by_change: { "left:4": [[1, 9]], "right:4": [], "left:3": [[1, 9]] } },
    },
};
/** A truck candidate on a worker that knows kinds but offers it no stop line / lane change. */
export const brakeOnly: Candidate = {
    actor_id: "tok-truck", name: "truck_003", category: "vehicle.truck", max_decel_mps2: 5, windows: [[0, 7]], followers: ["car_154"],
    kinds: { brake: { windows_by_event: { "stop:0:4": [[0, 7]], "hold:0:4": [[0, 7]] } }, accelerate: { windows_by_accel: { "2": [[0, 7]] }, max_target_mps: 12 } },
};
export const candidates: ReactiveCandidates = { scene: "scene-0061", duration_s: 20, label_problems: [{ name: "car_154", t_from: 9, t_to: 10 }], candidates: [allKinds, brakeOnly] };

const outcome = (valid: boolean, group: VariantOutcome["group"], gap: number): VariantOutcome =>
    ({ valid, group, reasons: valid ? [] : ["collision"], ego: { min_gap: gap, min_ttc: gap ? 3.2 : 0, a_min: 2.7, a_used: valid ? 2.69 : null, conflict_with: "car_154" }, collisions: [], reacted: valid ? ["ego"] : [] });
export const detail: ReactiveDetail & Partial<ReactiveKindDetail> = {
    version: "topeye-reactive-v2", summary: "Dùng được: xe của bạn phanh 2,7 m/s², gần nhất 9,6 m.",
    comparison: { baseline: outcome(true, "collision", 0), pilot: outcome(true, "mild", 9.55) },
    checks: [{ id: "esmini", passed: null, value: null, threshold: null, unit: "m", t: null, detail: "" },
        { id: "physics", passed: true, value: 2.7, threshold: 4, unit: "m/s²", t: 3, detail: "" }],
    excused: [],
    series: { t: [0, 1, 2, 3, 4], vehicles: { car_154: { v: [8, 6, 4, 4, 4], v_rec: [8, 8, 8, 8, 8], a: [0, -4, -2, 0, 0] }, ego: { v: [8, 8, 6, 5, 4], v_rec: [8, 8, 8, 8, 8], a: [0, 0, -2.7, -1, 0] } },
        ego: { gap: [15, 13, 11, 9.6, 10], ttc: [99, 6, 4, 3.2, 99] } },
    markers: [{ t: 0, kind: "brake_start", agent: "car_154" }, { t: 0.6, kind: "reacts", agent: "ego" }, { t: 3, kind: "closest", agent: "ego", other: "car_154", value: 9.6 },
        { t: 1.2, kind: "brake_full", agent: "car_154" }],
    vehicles: {
        car_154: { role: "event", modes: [[0, 20, "event"]], leaders: [], T: null, s0: null, T_source: "default", s0_source: "default", max_decel: 8, decel_used: 4, min_gap: null },
        ego: { role: "ego", modes: [[0, 0.6, "nominal"], [0.6, 20, "driving"]], leaders: [[0, 20, "car_154"]], T: 1.2, s0: 2, T_source: "measured", s0_source: "default", max_decel: 8, decel_used: 2.69, min_gap: 9.55 },
    },
    trigger_note: "Kích hoạt theo thời gian.",
};
export function pkg(extra: Partial<ReactiveDetail & ReactiveKindDetail> = {}): ImportedScenario {
    const actors = [track("ego", "ego", "vehicle.car", 0, 7), track("car_154", "traffic", "vehicle.car", 15, 6), track("truck_003", "traffic", "vehicle.truck", 40, 0, 6)];
    return {
        ...(source as object), id: "f".repeat(32), mode: "imported", kind: "real2sim", profile: "real2sim-replay-v1", map_id: "m", import: { sha256: "h", diagnostics: [] }, actors,
        report: { id: "car_154", scene: "scene-0061", source: "topeye", valid: true, reasons: [], group: "mild", event: { actor: "car_154", t0: 0, decel: 4, target: "stop", dwell: 0 },
            drivers: { react: true, reaction_s: 1, thresholds: {}, per_vehicle: {} }, ego: null, reacted: ["ego"], max_decel_used: {}, physics: {}, gaps: {}, collisions: [], esmini: null, run: null,
            topeye: { ...detail, ...extra } },
    } as unknown as ImportedScenario;
}

/** Scene metric 2 of accelerate (plan47 C5, ReactiveKindMetrics): targets are "speed at t0 + 3 / + 6", so not on the axis literally. */
export const accelMetrics = {
    scene: "scene-0061", kind: "accelerate", engine: "replay-forge d36205b", reaction_s: 1, tried: 4, encounters: 2, esmini_checked: false, runtime_s: 1,
    baseline: {}, pilot: {}, sensitivity: [],
    grid: { event_step_s: 2, axes: [{ name: "accel_mps2", values: [1, 2, 3] }, { name: "target_mps", values: [3, 6] }] },
    cells: [
        { actor: "car_154", actor_id: "tok-car", t0: 0, params: { accel_mps2: 2, target_mps: 11 }, baseline: { valid: true, group: "far" }, pilot: { valid: true, group: "mild", min_gap: 5 } },
        { actor: "car_154", actor_id: "tok-car", t0: 0, params: { accel_mps2: 2, target_mps: 14 }, baseline: { valid: false, group: null }, pilot: { valid: true, group: "close", min_gap: 0.8 } },
        { actor: "car_154", actor_id: "tok-car", t0: 2, params: { accel_mps2: 2, target_mps: 12 }, baseline: { valid: true, group: "far" }, pilot: { valid: true, group: "far", min_gap: 9 } },
        { actor: "car_154", actor_id: "tok-car", t0: 2, params: { accel_mps2: 1, target_mps: 15 }, baseline: { valid: true, group: "far" }, pilot: { valid: true, group: "hard", min_gap: 2 } },
    ],
    rare: [{ actor: "car_154", actor_id: "tok-car", t0: 0, params: { accel_mps2: 2, target_mps: 14 }, group: "close", ego_min_gap: 0.8, ego_min_ttc: 1.2, ego_a_min: 3 }],
} as unknown as import("../reactiveTypes").ReactiveKindMetrics;
