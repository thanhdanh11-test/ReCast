import type { CheckResult, ReactiveDetail, ReactiveGroup, ReactiveMarker, VariantOutcome } from "../reactiveTypes";
import type { Real2simReport } from "../types";

/** plan53 C1: pure helpers of the Analysis page. Only re-reads the report; never simulates or fills gaps. */
export type Better = "higher" | "lower";
export type Verdict = "ok" | "near" | "over" | null;
export type KpiId = "min_gap" | "min_ttc" | "a_min" | "a_used" | "ego_collisions";
export interface KpiRow {
    id: KpiId; label: string; unit: string; digits: number; better: Better;
    baseline: number | null; pilot: number | null; delta: number | null; improved: boolean | null;
    threshold: number | null; verdict: Verdict;
}

/** Danger scale of a variant, least to most (backend reactive.GROUPS reversed). */
export const SEVERITY: ReactiveGroup[] = ["far", "mild", "close", "hard", "collision"];

/** Within this share of the threshold counts as "near" (sát ngưỡng). */
const NEAR_HIGHER = 1.5, NEAR_LOWER = 0.8;

export function verdictOf(value: number | null, threshold: number | null, better: Better): Verdict {
    if (value === null || threshold === null || !Number.isFinite(value)) return null;
    if (better === "higher") return value < threshold ? "over" : value < threshold * NEAR_HIGHER ? "near" : "ok";
    return value > threshold ? "over" : value > threshold * NEAR_LOWER ? "near" : "ok";
}

const num = (v: number | null | undefined) => v === undefined || v === null || !Number.isFinite(v) ? null : v;
const egoHits = (v: VariantOutcome | undefined) => v?.collisions ? v.collisions.filter(c => c[0] === "ego" || c[1] === "ego").length : null;

export function kpiRows(detail: ReactiveDetail, thresholds: Record<string, number> | undefined): KpiRow[] {
    const { baseline, pilot } = detail.comparison ?? {};
    const thr = (key: string) => num(thresholds?.[key]);
    const row = (id: KpiId, label: string, unit: string, digits: number, better: Better, b: number | null, p: number | null, threshold: number | null): KpiRow => {
        const delta = b !== null && p !== null ? p - b : null;
        const improved = delta === null || delta === 0 ? null : better === "higher" ? delta > 0 : delta < 0;
        return { id, label, unit, digits, better, baseline: b, pilot: p, delta, improved, threshold,
            verdict: id === "ego_collisions" ? (p === null ? null : p > 0 ? "over" : "ok") : verdictOf(p, threshold, better) };
    };
    return [
        row("min_gap", "Khoảng cách gần nhất", "m", 2, "higher", num(baseline?.ego?.min_gap), num(pilot?.ego?.min_gap), thr("close_gap_m")),
        row("min_ttc", "Thời gian tới va chạm nhỏ nhất (TTC)", "s", 2, "higher", num(baseline?.ego?.min_ttc), num(pilot?.ego?.min_ttc), thr("close_ttc_s")),
        row("a_min", "Mức phanh cần để tránh", "m/s²", 1, "lower", num(baseline?.ego?.a_min), num(pilot?.ego?.a_min), thr("comfort_decel")),
        row("a_used", "Mức phanh xe bạn đã dùng", "m/s²", 1, "lower", num(baseline?.ego?.a_used), num(pilot?.ego?.a_used), thr("comfort_decel")),
        row("ego_collisions", "Số lần xe bạn va chạm", "", 0, "lower", egoHits(baseline), egoHits(pilot), 0),
    ];
}

export function checkTally(checks: CheckResult[] | undefined) {
    const out = { passed: 0, failed: 0, unknown: 0 };
    for (const c of checks ?? []) c.passed === true ? out.passed++ : c.passed === false ? out.failed++ : out.unknown++;
    return out;
}

export function keyMoments(detail: ReactiveDetail): ReactiveMarker[] {
    const seen = new Set<string>();
    return [...(detail.markers ?? [])].sort((a, b) => a.t - b.t).filter(m => {
        const key = `${m.t}|${m.kind}|${m.agent}|${m.other ?? ""}`;
        return seen.has(key) ? false : (seen.add(key), true);
    });
}

/**
 * plan54: vehicles the report is about — the ego, the event vehicle, those that reacted, the ego's conflict
 * partner and the vehicles of the reactive detail. Everything else in the scene is background.
 */
export function relevantIds(report: Real2simReport | null | undefined): Set<string> {
    const ids = new Set<string>(["ego"]);
    const add = (id: string | null | undefined) => { if (id) ids.add(id); };
    add(report?.event?.actor);
    report?.reacted?.forEach(add);
    add(report?.ego?.conflict_with);
    Object.keys(report?.topeye?.vehicles ?? {}).forEach(add);
    return ids;
}

/** Whether a free-text line (collision, note) names one of the ids as a whole token. */
export function mentions(text: string, ids: Set<string>): boolean {
    return text.split(/[^A-Za-z0-9_.-]+/).some(token => ids.has(token));
}
