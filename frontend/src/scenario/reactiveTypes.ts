/**
 * Plan46 contracts (planning/46_2026-10-15_reactive-metrics/specs/01-CONTRACTS.md), mirrored 1:1 from the Python
 * worker results. snake_case kept. `null` = not measured / not applicable, never invented.
 */

/** Group of a variant, measured on the ego (replay-forge `events.GROUPS`). */
export type ReactiveGroup = "collision" | "hard" | "close" | "mild" | "far";
/** The 7 validity conditions of replay-forge docs §8.3, in that order. */
export type CheckId = "esmini" | "physics" | "label" | "collision" | "tailgate" | "merge" | "appear";
/** plan47 adds event_start (start of a non-brake event: accelerate / stopline approach / lane change) and lane_arrived (lane change completed); brake markers unchanged; stopline reuses stopped/resume. */
export type MarkerKind = "brake_start" | "brake_full" | "stopped" | "resume" | "reacts" | "closest" | "collision" | "event_start" | "lane_arrived";
export type DriverMode = "nominal" | "waiting" | "driving" | "late" | "event";

export interface EgoOutcome { min_gap: number | null; min_ttc: number | null; a_min: number | null; a_used: number | null; conflict_with: string | null }
/** One simulation of the event: with nobody reacting (baseline) or with human-like reactions (pilot). */
export interface VariantOutcome {
  valid: boolean; group: ReactiveGroup | null; reasons: string[]; ego: EgoOutcome;
  /** [vehicle a, vehicle b, t_s, type] */
  collisions: [string, string, number, string][];
  reacted: string[];
}
export interface CheckResult {
  id: CheckId;
  /** null = not checked (esmini until an esmini check exists). */
  passed: boolean | null;
  value: number | null; threshold: number | null; unit: string; t: number | null;
  /** Short Vietnamese detail, e.g. the vehicle or pair concerned. */
  detail: string;
}
export interface ReactiveMarker { t: number; kind: MarkerKind; agent: string; other?: string; value?: number }
export interface VehicleSeries { v: (number | null)[]; v_rec: (number | null)[]; a: (number | null)[] }
export interface ReactiveVehicle {
  role: "event" | "reacted" | "ego";
  /** [t_from, t_to, mode] */
  modes: [number, number, DriverMode][];
  /** [t_from, t_to, leader name] */
  leaders: [number, number, string][];
  T: number | null; s0: number | null; T_source: "measured" | "default"; s0_source: "measured" | "default";
  max_decel: number; decel_used: number | null; min_gap: number | null;
}
/** report.json["topeye"] of a reactive package (plan46 C2). Absent on team real2sim packages. */
export interface ReactiveDetail {
  version: "topeye-reactive-v2";
  /** One plain sentence: verdict, key number, hint when not usable. */
  summary: string;
  comparison: { baseline: VariantOutcome; pilot: VariantOutcome };
  /** Checks of the package's own variant (event.react decides which one that is). */
  checks: CheckResult[];
  /** [a, b, t_s] recorded overlaps that were excused. */
  excused: [string, string, number][];
  series: { t: number[]; vehicles: Record<string, VehicleSeries>; ego: { gap: (number | null)[]; ttc: (number | null)[] } };
  markers: ReactiveMarker[];
  vehicles: Record<string, ReactiveVehicle>;
  trigger_note: string;
}

/** reactiveSensitivity: the same event re-run with reaction 0.7 / 1.0 / 1.5 s. */
export interface SensitivityRun { reaction_s: number; valid: boolean; group: ReactiveGroup | null; reasons: string[]; ego: EgoOutcome }
export interface ReactiveSensitivity { runs: SensitivityRun[]; /** verdict and group identical on every run */ stable: boolean }

/** esmini check of a reactive / real2sim package (validity condition 1), cached next to the package. */
export interface EsminiCheck {
  version: "esmini-check-v1";
  exit: number; esmini_version: string | null;
  /** Entities absent from the esmini log during their presence interval. */
  missing: string[];
  replay_error_m: Record<string, { mean: number; max: number }>;
  max_error_m: number | null;
  accel_max_mps2: number | null;
  edge_skip_s: number;
  /** null = could not be checked (see skipped_reason), never a failure. */
  passed: boolean | null;
  /** "no_road": a team package stored without its .xodr cannot be replayed by esmini (plan46 decision). */
  skipped_reason: "no_road" | null;
}

/** Scene metric 2 (replay-forge docs §8): fixed grid, baseline vs pilot. */
export interface MethodCount {
  valid: number;
  /** encounters (vehicle × t0) with at least one valid variant */
  encounters_valid: number;
  rare: number;
  rare_encounters: number;
  groups: Record<ReactiveGroup, number>;
  reasons: { collision: number; appearing: number; merge: number; label_error: number; tailgating: number; physics: number };
}
export interface GridCell {
  actor: string; actor_id: string; t0: number; decel: number; target: "stop" | "half" | "hold"; dwell: number;
  baseline: { valid: boolean; group: ReactiveGroup | null };
  pilot: { valid: boolean; group: ReactiveGroup | null; min_gap: number | null };
}
export interface RareCase {
  actor: string; actor_id: string; t0: number; decel: number; target: "stop" | "half" | "hold"; dwell: number;
  group: "hard" | "close"; ego_min_gap: number | null; ego_min_ttc: number | null; ego_a_min: number | null;
}
export interface ReactiveMetrics {
  scene: string;
  grid: { event_step_s: number; decels: number[]; targets: ["stop" | "half" | "hold", number][] };
  reaction_s: number;
  tried: number;
  encounters: number;
  baseline: MethodCount;
  pilot: MethodCount;
  /** Present when several reaction times were asked for (docs §8.6). */
  sensitivity: { reaction_s: number; pilot_valid: number; pilot_rare: number }[];
  rare: RareCase[];
  cells: GridCell[];
  /** esmini is not run inside the sweep: condition 1 is reported per package by esminiCheck. */
  esmini_checked: false;
  runtime_s: number;
  engine: string;
}

/** Scene metric 1 (replay-forge docs §5–7.1): esmini replay error of exact / baseline / pilot. */
export type ReplayMethod = "exact" | "baseline" | "pilot";
export type ReplayGroupName = "all" | "moving" | "static" | "vehicle" | "pedestrian" | "obstacle";
export interface ReplayErrorGroup { n: number; ade: number | null; fde: number | null; max: number | null; yaw_deg: number | null; v_rmse: number | null }
export interface ReplayObject {
  name: string; category: string; moving: boolean; keyframes: number;
  /** label_problems of the object (count of flagged spans) */
  label_problems: number;
  ade: Record<ReplayMethod, number | null>;
}
export interface ReplayErrorMetrics {
  scene: string;
  esmini_version: string | null;
  esmini_exit: Record<ReplayMethod, number>;
  methods: Record<ReplayMethod, Record<ReplayGroupName, ReplayErrorGroup>>;
  objects: ReplayObject[];
  /** Held-out keyframes (docs §7.1); "exact" there means straight lines between kept labels. */
  holdout: { n: number; ade: Record<ReplayMethod, number | null>; accel_p99_over_4_share: Record<ReplayMethod, number | null> };
  runtime_s: number;
}

/** reactiveCandidates extension: windows depend on the event (fits needs AFTER_EVENT s after it ends). */
export type WindowKey = `${"stop" | "half" | "hold"}:${number}:${number}`;
export interface CandidateWindows { windows_by_event: Partial<Record<WindowKey, [number, number][]>> }

// ------------------------------------------------------------------ plan47: event kinds (planning/47_2026-10-15_reactive-kinds-ui/specs/01-CONTRACTS.md)
export type ReactiveKind = "brake" | "accelerate" | "stopline" | "lane_change";
/** kind-specific fields; ReactiveEvent (types.ts) keeps actor_id/t0_s/react/reaction_s and gains these, all optional. */
export interface ReactiveKindFields {
  /** default "brake" (v0.34.0 behaviour) */
  kind?: ReactiveKind;
  /** accelerate: desired speed after t0 (m/s), > speed at t0 */
  target_mps?: number;
  /** accelerate: 1 | 2 | 3 m/s² */
  accel_mps2?: number;
  /** lane_change */
  direction?: "left" | "right";
  /** lane_change: 3 | 4 | 6 s */
  duration_s?: number;
}
/** Per-kind availability of one candidate vehicle (reactiveCandidates). Absent kind = not possible for this vehicle. */
export interface CandidateKinds {
  kinds: Partial<{
    /** same as windows_by_event of v0.34.0 */
    brake: { windows_by_event: Partial<Record<WindowKey, [number, number][]>> };
    /** key "<accel>" (e.g. "2"); target speeds offered: max_target_mps caps the UI slider */
    accelerate: { windows_by_accel: Record<string, [number, number][]>; max_target_mps: number };
    /** next stop line on the vehicle's path for each window, world centre (app frame) for drawing */
    stopline: { windows_by_dwell: Record<string, [number, number][]>; stoplines: { id: string; x_m: number; y_m: number; type: string | null; t_reach_s: number }[] };
    /** key "<direction>:<duration>" (e.g. "left:4") */
    lane_change: { windows_by_change: Record<string, [number, number][]> };
  }>;
}
/** Extra report.json["topeye"] fields for non-brake kinds (absent for brake). */
export interface ReactiveKindDetail {
  kind: ReactiveKind;
  /** lane_change: MOBIL safety of the cut-in for the new follower (b_safe = 4 m/s²) */
  mobil?: { new_follower: string | null; required_decel_mps2: number | null; safe: boolean | null };
  /** stopline: the stop line used */
  stopline?: { id: string; x_m: number; y_m: number; type: string | null };
  /** lane_change: polyline of the event vehicle's lateral path (app frame), for drawing */
  path?: [number, number][];
}
/** Event parameters of one grid cell of a non-brake kind, e.g. {accel_mps2: 2, target_mps: 9} / {dwell_s: 3} / {direction: "left", duration_s: 4}. */
export type KindParams = Record<string, number | string>;
/** Scene metric 2 of a non-brake kind (plan47 C5, sửa 2026-10-15). Same counting as ReactiveMetrics; cells carry generic params. */
export interface ReactiveKindMetrics extends Omit<ReactiveMetrics, "grid" | "cells" | "rare" | "sensitivity"> {
  kind: Exclude<ReactiveKind, "brake">;
  /** the fixed grid: t0 step plus one axis per parameter, in display order */
  grid: { event_step_s: number; axes: { name: string; values: (number | string)[] }[] };
  sensitivity: { reaction_s: number; pilot_valid: number; pilot_rare: number }[];
  cells: { actor: string; actor_id: string; t0: number; params: KindParams; baseline: { valid: boolean; group: ReactiveGroup | null }; pilot: { valid: boolean; group: ReactiveGroup | null; min_gap: number | null } }[];
  rare: { actor: string; actor_id: string; t0: number; params: KindParams; group: "hard" | "close"; ego_min_gap: number | null; ego_min_ttc: number | null; ego_a_min: number | null }[];
}
/** reactiveMetrics with kinds: brake keeps the v0.34.0 shape exactly; other kinds use ReactiveKindMetrics. */
export type ReactiveMetricsByKind = { brake?: ReactiveMetrics } & Partial<Record<Exclude<ReactiveKind, "brake">, ReactiveKindMetrics>>;
