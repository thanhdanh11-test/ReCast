// plan50 P01 §3: history rows of the Studio (one row per baseline+pilot group, one per other scenario).
import { DEFAULT_PARAMS, goalOf, type Params } from "../reactive/model";
import { paramsOf } from "../reactive/kindMetrics";
import type { ImportedEntry, ScenarioGroup } from "../types";
import type { ReactiveKind } from "../reactiveTypes";

export type HistoryKind = "reaction" | "template" | "xosc" | "real2sim";
export interface HistoryRow {
  id: string;                    // pilot (group) or scenario id — the row key and the scenario opened/analysed/saved
  name: string;
  kind: HistoryKind;
  created_at: string;
  entry: ImportedEntry;          // the entry acted on (pilot for a group)
  baseline: ImportedEntry | null; // group only
  group: ScenarioGroup | null;
}

export const KIND_LABEL: Record<HistoryKind, string> = { reaction: "Phản ứng", template: "Mẫu", xosc: ".xosc", real2sim: "real2sim" };

export function kindOf(entry: ImportedEntry, group: ScenarioGroup | null): HistoryKind {
  if (group) return "reaction";
  if (entry.kind === "real2sim") return "real2sim";
  return entry.has_template ? "template" : "xosc";
}

/** Newest first; a group with both packages present collapses to one row named after its pilot. */
export function historyRows(entries: ImportedEntry[], groups: ScenarioGroup[]): HistoryRow[] {
  const byId = new Map(entries.map(e => [e.scenario_id, e]));
  const used = new Set<string>();
  const rows: HistoryRow[] = [];
  for (const group of groups) {
    const pilot = group.pilot_id ? byId.get(group.pilot_id) : undefined;
    const baseline = group.baseline_id ? byId.get(group.baseline_id) : undefined;
    if (!pilot || !baseline) continue;
    used.add(pilot.scenario_id); used.add(baseline.scenario_id);
    rows.push({ id: pilot.scenario_id, name: pilot.name, kind: "reaction", created_at: pilot.created_at, entry: pilot, baseline, group });
  }
  for (const entry of entries) {
    if (used.has(entry.scenario_id)) continue;
    rows.push({ id: entry.scenario_id, name: entry.name, kind: kindOf(entry, null), created_at: entry.created_at, entry, baseline: null, group: null });
  }
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Reaction form values of a stored group event (Sửa on a reaction row reopens "Tự tạo" with them). */
export function initialOf(group: ScenarioGroup): { actorId: string; kind: ReactiveKind; params: Params; t0: number } {
  const event = group.event as ScenarioGroup["event"] & Record<string, unknown>;
  const kind = (event.kind ?? "brake") as ReactiveKind;
  const brake = kind === "brake" ? { decel: event.decel_mps2 as Params["decel"], goal: goalOf(event.target as "stop" | "half" | "hold", Number(event.dwell_s ?? 0)), dwell: (Number(event.dwell_s) || DEFAULT_PARAMS.dwell) as Params["dwell"] } : {};
  const params: Params = { ...DEFAULT_PARAMS, ...brake, ...(kind === "brake" ? {} : paramsOf(kind, event as Record<string, string | number>)), reaction: Number(event.reaction_s ?? DEFAULT_PARAMS.reaction) };
  return { actorId: String(event.actor_id), kind, params, t0: Number(event.t0_s) };
}

/** plan52: readable label of a reaction package name `<actor>_t<t0>_<target|kind>_<params>` (i18n key + vars);
 * null for other names (templates, .xosc files keep the name the user gave). */
/** Vars that are words (goal, side) are i18n keys themselves. */
export const translateVars = (vars: Record<string, string>, t: (k: string) => string) =>
    Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, k === "goal" || k === "side" ? t(v) : v]));
export function describeName(name: string): { key: string; vars: Record<string, string> } | null {
    const num = (v: string) => Number(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
    const brake = /^(.+?)_t(\d+(?:\.\d+)?)_(hold|stop|half)_a(\d+(?:\.\d+)?)$/.exec(name);
    if (brake) {
        const goal = { hold: "dừng hẳn", stop: "dừng rồi đi tiếp", half: "chậm lại 50%" }[brake[3] as "hold" | "stop" | "half"];
        return { key: "{actor} · phanh {decel} m/s², {goal} · lúc {t0} s", vars: { actor: brake[1], decel: num(brake[4]), goal, t0: num(brake[2]) } };
    }
    const other = /^(.+?)_t(\d+(?:\.\d+)?)_(accelerate|stopline|lane_change)_(.+)$/.exec(name);
    if (!other) return null;
    const [, actor, t0, kind, rest] = other;
    if (kind === "accelerate") { const m = /^v([\d.]+)_a([\d.]+)$/.exec(rest); if (m) return { key: "{actor} · tăng tốc lên {v} m/s · lúc {t0} s", vars: { actor, v: num(m[1]), t0: num(t0) } }; }
    if (kind === "stopline") { const m = /^d([\d.]+)$/.exec(rest); if (m) return { key: "{actor} · dừng ở vạch {d} s · lúc {t0} s", vars: { actor, d: num(m[1]), t0: num(t0) } }; }
    if (kind === "lane_change") { const m = /^(left|right)_d([\d.]+)$/.exec(rest); if (m) return { key: "{actor} · chuyển làn {side} trong {d} s · lúc {t0} s", vars: { actor, side: m[1] === "left" ? "trái" : "phải", d: num(m[2]), t0: num(t0) } }; }
    return null;
}
