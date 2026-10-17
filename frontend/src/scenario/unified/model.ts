import { ACCELS, DEFAULT_PARAMS, DURATIONS, DWELLS, GOALS, brakeLevels, clampToWindows, defaultTarget, eventOf, speedAt, targetRange, windowsOf, type Params } from "../reactive/model";
import type { Candidate, ImportedScenario, Scenario } from "../types";
import type { ReactiveKind } from "../reactiveTypes";

export interface ComparisonPair { baseline: ImportedScenario; pilot: ImportedScenario }
/** Start with an offered combination, including right-only lane changes. Manual edits may still be infeasible. */
export function initialParams(candidate: Candidate, kind: ReactiveKind): Params {
  const choices: Params[] = [DEFAULT_PARAMS];
  if (kind === "brake") for (const goal of Object.keys(GOALS) as Params["goal"][]) for (const decel of brakeLevels(candidate)) choices.push({ ...DEFAULT_PARAMS, goal, decel });
  if (kind === "accelerate") for (const accel of ACCELS) choices.push({ ...DEFAULT_PARAMS, accel });
  if (kind === "stopline") for (const dwell of DWELLS) choices.push({ ...DEFAULT_PARAMS, dwell });
  if (kind === "lane_change") for (const direction of ["left", "right"] as const) for (const duration of DURATIONS) choices.push({ ...DEFAULT_PARAMS, direction, duration });
  return choices.find(params => windowsOf(candidate, kind, params).length > 0) ?? DEFAULT_PARAMS;
}
export function reactionChoice(selected: Candidate | undefined, kind: ReactiveKind, params: Params, t0: number, source: Scenario | null) {
  const levels = selected ? brakeLevels(selected) : [];
  const effectiveDecel = levels.includes(params.decel) ? params.decel : levels[0] ?? params.decel;
  const effectiveParams = { ...params, decel: effectiveDecel };
  const windows = selected ? windowsOf(selected, kind, effectiveParams) : [];
  const availableTimes = windows.flatMap(([lo, hi]) => Array.from({ length: Math.max(0, Math.floor(hi * 2) - Math.ceil(lo * 2) + 1) }, (_, i) => (Math.ceil(lo * 2) + i) / 2));
  const chosenTime = windows.length ? clampToWindows(t0, windows) : 0;
  const speed = kind === "accelerate" && selected ? speedAt(source?.actors.find(actor => actor.id === selected.actor_id), chosenTime) : null;
  const rawRange = selected && kind === "accelerate" ? targetRange(selected, speed) : null;
  // Same four-second post-event margin as reactive.py and ReactiveWorkspace.
  const feasibleMax = speed === null ? 0 : speed + params.accel * ((source?.interval_s[1] ?? 0) - chosenTime - 4);
  const range = rawRange && feasibleMax >= rawRange.min ? { min: rawRange.min, max: Math.min(rawRange.max, Math.floor(feasibleMax * 2) / 2) } : null;
  const target = range ? params.target_mps !== null ? Math.min(range.max, Math.max(range.min, params.target_mps)) : defaultTarget(range, speed) : null;
  const event = selected && windows.length ? eventOf(selected, kind, effectiveParams, chosenTime, target) : null;
  return { levels, effectiveParams, windows, availableTimes, chosenTime, range, target, event };
}
