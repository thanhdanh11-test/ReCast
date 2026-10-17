import { vehicleClass, VEHICLE_CLASS_LABELS } from "../vehicleClass";
import { DECEL_LEVELS, clampToWindows, windowsFor } from "../authoring/ReactiveForm";
import type { Actor, Candidate, ReactiveEvent } from "../types";
import type { MarkerKind, ReactiveDetail, ReactiveKind, ReactiveMarker, VariantOutcome } from "../reactiveTypes";

/**
 * Pure model of the "Phản ứng" workspace (plan47 SPEC-WP2): which kinds a vehicle offers, the allowed start windows
 * of one choice, the event sent to `importReactive` (01-CONTRACTS C1, only the chosen kind's fields), and labels.
 */
export { DECEL_LEVELS, clampToWindows };
export const KINDS: ReactiveKind[] = ["brake", "accelerate", "stopline", "lane_change"];
export const KIND_LABEL: Record<ReactiveKind, string> = { brake: "Phanh", accelerate: "Tăng tốc", stopline: "Dừng ở vạch", lane_change: "Chuyển làn" };
/** "Xe phanh" etc.: the inspector's label of the vehicle causing the event. */
export const ACTOR_LABEL: Record<ReactiveKind, string> = { brake: "Xe phanh", accelerate: "Xe tăng tốc", stopline: "Xe dừng ở vạch", lane_change: "Xe chuyển làn" };
export const START_LABEL: Record<ReactiveKind, string> = { brake: "Phanh lúc", accelerate: "Tăng tốc lúc", stopline: "Đi tới vạch từ lúc", lane_change: "Chuyển làn lúc" };
/** Short timeline/marker label of the event start, per kind. */
export const START_MARK: Record<ReactiveKind, string> = { brake: "phanh", accelerate: "tăng tốc", stopline: "dừng ở vạch", lane_change: "chuyển làn" };
/** Step ② of the top bar, per kind. */
export const STEP2_LABEL: Record<ReactiveKind, string> = { brake: "Chỉnh cách phanh", accelerate: "Chỉnh cách tăng tốc", stopline: "Chỉnh cách dừng", lane_change: "Chỉnh cách chuyển làn" };

export const GOALS = {
    stop: { label: "Dừng hẳn", target: "stop", dwell_s: 0 },
    dwell: { label: "Dừng 3 s", target: "stop", dwell_s: 3 },
    half: { label: "Chậm lại 50%", target: "half", dwell_s: 0 },
} as const;
export type Goal = keyof typeof GOALS;
export const goalOf = (target: "stop" | "half", dwell: number): Goal => target === "half" ? "half" : dwell > 0 ? "dwell" : "stop";
export const BRAKE_LEVEL_LABEL: Record<number, string> = { 2: "Nhẹ", 4: "Vừa", 6: "Gấp", 8: "Khẩn" };
/** C1 value sets (EVENT_NOT_ALLOWED outside them). */
export const ACCELS = [1, 2, 3] as const;
export const DWELLS = [0, 3, 10] as const;
export const DURATIONS = [3, 4, 6] as const;
export const REACTIONS = [0.7, 1.0, 1.5] as const;
/** accelerate: the target must exceed the speed at t0 by more than this (C1). */
export const ACCEL_MARGIN_MPS = 0.5;
/** accelerate: default target = speed at t0 + this (the C5 grid's first step), capped at max_target_mps. */
export const ACCEL_DEFAULT_STEP_MPS = 3;

export interface Params {
    decel: number; goal: Goal;
    accel: (typeof ACCELS)[number]; target_mps: number | null;
    dwell: (typeof DWELLS)[number];
    direction: "left" | "right"; duration: (typeof DURATIONS)[number];
    react: boolean; reaction: number;
}
export const DEFAULT_PARAMS: Params = { decel: 4, goal: "stop", accel: 2, target_mps: null, dwell: 3, direction: "left", duration: 4, react: true, reaction: 1.0 };

/** Kinds this vehicle can do. A worker without `kinds` (v0.34.0) only offers brake. */
export function kindsOf(c: Candidate | undefined): ReactiveKind[] {
    if (!c) return [];
    if (!c.kinds) return ["brake"];
    return KINDS.filter(k => !!c.kinds?.[k]);
}
/** Braking levels allowed for this vehicle (≤ its max_decel). */
export const brakeLevels = (c: Candidate): number[] => DECEL_LEVELS.filter(l => l.value <= c.max_decel_mps2).map(l => l.value);

/** Allowed start windows of one choice (C2): `fits` already checked by the worker for every t0 inside. */
export function windowsOf(c: Candidate, kind: ReactiveKind, p: Params): [number, number][] {
    const k = c.kinds;
    if (kind === "brake") {
        const goal = GOALS[p.goal];
        const byEvent = k?.brake?.windows_by_event ?? c.windows_by_event;
        return windowsFor({ ...c, windows_by_event: byEvent }, goal.target, goal.dwell_s, brakeLevels(c).includes(p.decel) ? p.decel : null);
    }
    if (kind === "accelerate") return k?.accelerate?.windows_by_accel[String(p.accel)] ?? [];
    if (kind === "stopline") return k?.stopline?.windows_by_dwell[String(p.dwell)] ?? [];
    return k?.lane_change?.windows_by_change[`${p.direction}:${p.duration}`] ?? [];
}

/** Speed (m/s) of `actor` at `t` from its recorded samples (finite difference of the surrounding pair); null outside. */
export function speedAt(actor: Actor | undefined, t: number): number | null {
    const s = actor?.samples ?? [];
    if (s.length < 2 || t < s[0].t_s - 1e-6 || t > s[s.length - 1].t_s + 1e-6) return null;
    const i = Math.max(1, s.findIndex(p => p.t_s >= t));
    const dt = s[i].t_s - s[i - 1].t_s;
    return dt > 0 ? Math.hypot(s[i].x_m - s[i - 1].x_m, s[i].y_m - s[i - 1].y_m) / dt : null;
}

/** accelerate target range at t0: (speed + 0,5; max_target_mps], on a 0,5 m/s grid. null = nothing allowed. */
export function targetRange(c: Candidate, speed: number | null): { min: number; max: number } | null {
    const max = c.kinds?.accelerate?.max_target_mps;
    if (max === undefined || speed === null) return null;
    const min = Math.floor((speed + ACCEL_MARGIN_MPS) * 2 + 1) / 2;
    return min <= max ? { min, max } : null;
}
export function defaultTarget(range: { min: number; max: number } | null, speed: number | null): number | null {
    if (!range || speed === null) return null;
    return Math.min(range.max, Math.max(range.min, Math.round((speed + ACCEL_DEFAULT_STEP_MPS) * 2) / 2));
}

/** The C1 event of one choice: shared fields + only the fields of `kind` (the worker rejects the others). */
export function eventOf(c: Candidate, kind: ReactiveKind, p: Params, t0: number, target: number | null): ReactiveEvent | null {
    const base = { actor_id: c.actor_id, t0_s: t0, react: p.react, reaction_s: p.reaction };
    if (kind === "brake") return { ...base, decel_mps2: p.decel, target: GOALS[p.goal].target, dwell_s: GOALS[p.goal].dwell_s };
    if (kind === "accelerate") return target === null ? null : { ...base, kind, target_mps: target, accel_mps2: p.accel };
    if (kind === "stopline") return { ...base, kind, dwell_s: p.dwell };
    return { ...base, kind, direction: p.direction, duration_s: p.duration };
}

/** Vietnamese name of a dataset category ("vehicle.car" → "xe con"); unknown categories keep their code. */
export function categoryName(category: string): string {
    const cls = vehicleClass(category);
    const label = VEHICLE_CLASS_LABELS.find(([c]) => c === cls)?.[1];
    return label && cls !== "other" ? label.toLowerCase() : category;
}

/** Number with Vietnamese decimal comma and unit; "—" when not measured (never invented). */
export const fmt = (value: number | null | undefined, digits: number, unit = "") =>
    value === undefined || value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits).replace(".", ",")}${unit}`;

/** Verdict of the shown package (its own variant): usable, not usable, or a case the engine does not simulate yet. */
export type Verdict = { tone: "ok" | "bad" | "unsupported"; outcome: VariantOutcome };
export function verdictOf(detail: ReactiveDetail, react: boolean): Verdict | null {
    const own = react ? detail.comparison?.pilot : detail.comparison?.baseline;
    if (!own) return null;
    if (own.valid) return { tone: "ok", outcome: own };
    // "Not supported yet" only when every reason is an interaction the engine does not simulate; any real failure is "bad".
    return { tone: own.reasons.length > 0 && own.reasons.every(r => r.startsWith("unsupported")) ? "unsupported" : "bad", outcome: own };
}

/** Value of a time series at `t` (nearest sample), null when absent. */
export function seriesAt(times: number[], values: (number | null)[] | undefined, t: number): number | null {
    if (!values?.length || !times.length) return null;
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    return values[best] ?? null;
}
/** Leader of `name` at `t` from report vehicles[*].leaders. */
export function leaderAt(detail: ReactiveDetail | null, name: string, t: number): string | null {
    return detail?.vehicles?.[name]?.leaders?.find(([a, b]) => t >= a && t <= b)?.[2] ?? null;
}
/** True while `name` is not driving as recorded (waiting / driving / late / event) at `t`. */
export function reactingAt(detail: ReactiveDetail | null, name: string, t: number): boolean {
    const mode = detail?.vehicles?.[name]?.modes?.find(([a, b]) => t >= a && t <= b)?.[2];
    return !!mode && mode !== "nominal";
}

export interface TimelineMark { t: number; kind: MarkerKind | "start"; label: string; tone: "event" | "react" | "closest" | "collision" | "minor" }
/**
 * Timeline marks (SPEC-WP2 §3): the event start (per kind), the ego's reaction, the closest point and collisions are
 * labelled; the other report markers stay as unlabelled ticks. Without a package only the chosen start is shown.
 */
export function timelineMarks(markers: ReactiveMarker[] | undefined, kind: ReactiveKind, t0: number | null,
    tr: (vi: string, vars?: Record<string, string | number>) => string): TimelineMark[] {
    if (!markers) return t0 === null ? [] : [{ t: t0, kind: "start", label: tr(START_MARK[kind]), tone: "event" }];
    const out: TimelineMark[] = [];
    for (const m of markers) {
        if (m.kind === "brake_start") out.push({ t: m.t, kind: m.kind, label: tr(START_MARK[kind]), tone: "event" });
        else if (m.kind === "reacts" && m.agent === "ego") out.push({ t: m.t, kind: m.kind, label: tr("ego phản ứng"), tone: "react" });
        else if (m.kind === "closest") out.push({ t: m.t, kind: m.kind, label: m.value === undefined ? tr("gần nhất") : tr("gần nhất {v}", { v: fmt(m.value, 1, " m") }), tone: "closest" });
        // Several collisions would stack their labels: the first one is named, the others are ticks.
        else if (m.kind === "collision") out.push({ t: m.t, kind: m.kind, label: out.some(o => o.kind === "collision") ? "" : tr("va chạm"), tone: "collision" });
        else out.push({ t: m.t, kind: m.kind, label: "", tone: "minor" });
    }
    if (t0 !== null && !out.some(m => m.tone === "event")) out.unshift({ t: t0, kind: "start", label: tr(START_MARK[kind]), tone: "event" });
    return out;
}

/** "Mode" of the workspace (top-bar toggle), remembered per browser; storage may be unavailable. */
export type Mode = "simple" | "technical";
const MODE_KEY = "topeye.reactive.mode";
export function loadMode(): Mode {
    try { return window.localStorage.getItem(MODE_KEY) === "simple" ? "simple" : "technical"; } catch { return "technical"; }
}
export function saveMode(mode: Mode) {
    try { window.localStorage.setItem(MODE_KEY, mode); } catch { /* private window: keep it for this session only */ }
}
