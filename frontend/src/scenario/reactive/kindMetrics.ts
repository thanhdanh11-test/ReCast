import type { KindParams, RareCase, ReactiveGroup, ReactiveKind, ReactiveKindMetrics, ReactiveMetrics } from "../reactiveTypes";
import { GOALS, fmt, goalOf, type Params } from "./model";

/**
 * Scene metric 2 per kind (plan47 C5, 2026-10-15): brake keeps the v0.34.0 shape; the other kinds have a grid of
 * `axes` (named like the event fields) and cells / rare cases with generic `params`. These helpers give both one
 * shape for the workspace: rare cases, the parameter-space rows, and the form fields a choice fills.
 */
export type AnyMetrics = ReactiveMetrics | ReactiveKindMetrics;
export const isKindMetrics = (m: AnyMetrics): m is ReactiveKindMetrics => "kind" in m && Array.isArray((m.grid as ReactiveKindMetrics["grid"]).axes);

/** A rare case of any kind, ready to fill the form and to label. */
export interface Rare { actor: string; actor_id: string; t0: number; kind: ReactiveKind; params: Partial<Params>; label: string; group: "hard" | "close"; ego_min_gap: number | null; ego_min_ttc: number | null }

/** Form fields of a generic event `params` (axis names = event field names, C5). */
export function paramsOf(kind: ReactiveKind, p: KindParams): Partial<Params> {
    const num = (k: string) => typeof p[k] === "number" ? p[k] as number : Number(p[k]);
    if (kind === "accelerate") return { accel: num("accel_mps2") as Params["accel"], target_mps: num("target_mps") };
    if (kind === "stopline") return { dwell: num("dwell_s") as Params["dwell"] };
    if (kind === "lane_change") return { direction: p.direction === "right" ? "right" : "left", duration: num("duration_s") as Params["duration"] };
    return {};
}
/** Short Vietnamese label of one choice, e.g. "2 m/s² → 9,0 m/s", "chờ 3 s", "trái · 4 s". */
export function paramsLabel(kind: ReactiveKind, p: KindParams, tr: (vi: string, vars?: Record<string, string | number>) => string): string {
    if (kind === "accelerate") return tr("{a} → {v}", { a: fmt(Number(p.accel_mps2), 0, " m/s²"), v: fmt(Number(p.target_mps), 1, " m/s") });
    if (kind === "stopline") return tr("chờ {s}", { s: fmt(Number(p.dwell_s), 0, " s") });
    if (kind === "lane_change") return `${p.direction === "right" ? tr("phải") : tr("trái")} · ${fmt(Number(p.duration_s), 0, " s")}`;
    return Object.entries(p).map(([k, v]) => `${k}=${v}`).join(" · ");
}

export function rareCases(m: AnyMetrics, tr: (vi: string, vars?: Record<string, string | number>) => string): Rare[] {
    if (isKindMetrics(m)) return m.rare.map(c => ({ actor: c.actor, actor_id: c.actor_id, t0: c.t0, kind: m.kind, params: paramsOf(m.kind, c.params),
        label: paramsLabel(m.kind, c.params, tr), group: c.group, ego_min_gap: c.ego_min_gap, ego_min_ttc: c.ego_min_ttc }));
    return m.rare.map((c: RareCase) => ({ actor: c.actor, actor_id: c.actor_id, t0: c.t0, kind: "brake" as const,
        params: { decel: c.decel, goal: goalOf(c.target, c.dwell) }, label: `${fmt(c.decel, 0, " m/s²")} · ${tr(GOALS[goalOf(c.target, c.dwell)].label)}`,
        group: c.group, ego_min_gap: c.ego_min_gap, ego_min_ttc: c.ego_min_ttc }));
}

export interface SpaceRow { key: string; label: string; cells: Map<number, ReactiveKindMetrics["cells"][number]> }
/**
 * Rows of the parameter space of a non-brake kind for one vehicle: one row per combination of the non-time axes,
 * one column per t0. A param value that is not literally on its axis (accelerate targets are "speed at t0 + step")
 * is placed by its rank among the cells sharing t0 and the other params, so each row keeps one axis step.
 */
export function kindSpace(m: ReactiveKindMetrics, actorId: string, tr: (vi: string, vars?: Record<string, string | number>) => string): { times: number[]; rows: SpaceRow[] } {
    const cells = m.cells.filter(c => c.actor_id === actorId);
    const axes = m.grid.axes;
    const times = [...new Set(cells.map(c => c.t0))].sort((a, b) => a - b);
    const stepOf = (c: (typeof cells)[number], axis: { name: string; values: (number | string)[] }) => {
        const v = c.params[axis.name];
        if (axis.values.includes(v)) return v;
        const peers = cells.filter(o => o.t0 === c.t0 && axes.every(a => a.name === axis.name || o.params[a.name] === c.params[a.name]))
            .map(o => Number(o.params[axis.name])).sort((a, b) => a - b);
        return axis.values[peers.indexOf(Number(v))] ?? v;
    };
    const rows = new Map<string, SpaceRow>();
    for (const c of cells) {
        const steps = axes.map(a => [a.name, stepOf(c, a)] as const);
        const key = JSON.stringify(steps);
        // An off-axis value was placed by rank: its step is relative ("+3 m/s"), not the value itself.
        const label = steps.map(([name, v], i) => axisText(name, v, !axes[i].values.includes(c.params[name]), tr)).join(" · ");
        if (!rows.has(key)) rows.set(key, { key, label, cells: new Map() });
        rows.get(key)!.cells.set(c.t0, c);
    }
    const order = (row: SpaceRow) => (JSON.parse(row.key) as [string, number | string][]).map(([name, v], i) => axes[i].values.indexOf(v) * 100 + (axes[i].name === name ? 0 : 1));
    return { times, rows: [...rows.values()].sort((a, b) => { const x = order(a), y = order(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }) };
}
function axisText(name: string, v: number | string, relative: boolean, tr: (vi: string, vars?: Record<string, string | number>) => string): string {
    if (name === "direction") return v === "right" ? tr("phải") : tr("trái");
    if (name === "accel_mps2") return fmt(Number(v), 0, " m/s²");
    if (name === "target_mps") return relative ? tr("tốc độ +{v}", { v: fmt(Number(v), 1, " m/s") }) : tr("đích {v}", { v: fmt(Number(v), 1, " m/s") });
    if (name === "dwell_s" || name === "duration_s") return fmt(Number(v), 0, " s");
    return `${name} ${v}`;
}
export const groupTone = (side: { valid: boolean; group: ReactiveGroup | null }) => side.valid && side.group ? `g-${side.group}` : "invalid";
