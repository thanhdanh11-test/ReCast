import type { Placement, ScenarioTemplate } from "./authoring/template";
import type { CandidateKinds, CandidateWindows, EsminiCheck, ReactiveDetail, ReactiveKind, ReactiveKindFields, ReactiveMetrics, ReactiveMetricsByKind, ReactiveSensitivity, ReplayErrorMetrics } from "./reactiveTypes";
export interface Pose {
  t_s: number;
  x_m: number;
  y_m: number;
  z_m: number;
  yaw_rad: number;
  observed: boolean;
}
export interface Actor {
  id: string;
  role: string;
  category: string;
  length_m: number;
  width_m: number;
  height_m?: number;
  samples: Pose[];
  attributes?: string[];
}
export interface Environment {
  presentation?: {
    schema_version: 1;
    style?: "pastel-v1";
    lines?: Environment["lines"];
    landscape?: {polygon: number[][]; holes: number[][][]}[];
    attribution?: string;
    bounds_m?: number[];
    ground: {cell_m: number; samples: number[][]};
    surfaces: Environment["polygons"];
    buildings: {polygon: number[][]; holes: number[][][]; base_z: number; height: number}[];
    /** Display-filtered estimates (off road / off vehicle paths); raw lists below unchanged. */
    trees?: Environment["trees"];
    poles?: Environment["poles"];
    diagnostics: string[];
  };
  polygons: { kind: string; outer: number[][]; holes: number[][][] }[];
  lines: { kind: string; points: number[][] }[];
  buildings: { polygon: number[][]; base_z: number; height: number }[];
  trees: {
    x: number;
    y: number;
    z: number;
    height: number;
    crown_radius: number;
  }[];
  poles: { x: number; y: number; z: number; height: number }[];
  /** Plan36: continuous structures on the drivable edge (railings, trusses, walls); heights above the road. */
  barriers?: { kind: "barrier"; points: number[][]; heights: number[]; length_m: number }[];
  /** Plan36: decks/ceilings the ego drove under; underside height above the local road. */
  overheads?: { kind: "overhead"; polygon: number[][]; underside_above_road_m: number; road_z: number; area_m2: number }[];
  warnings: string[];
  provenance: string[];
}
export interface Scenario {
  mode?: "source" | "imported";
  profile?: string;
  map_id?: string;
  import?: { sha256: string; diagnostics: Diagnostic[] };
  environment?: Environment;
  id: string;
  interval_s: [number, number];
  source: { scene: string; selected_interval_s?: [number, number]; source_id?: string; origin_global_m?: number[] };
  actors: Actor[];
  variant?: { speed_factor: number; gap_offset_m: number };
  road?: { kind: string; heading_rad?: number };
}
export interface Track {
  token: string;
  category: string;
  start_s: number;
  end_s: number;
  distance_m: number;
  observations: number;
}
export interface Scene {
  scene: string;
  duration_s: number;
  ego_start_s: number;
  tracks: Track[];
}
export interface Metric {
  id: string;
  n: number;
  coverage: number;
  ade_xy_m?: number;
  max_xy_m?: number;
  yaw_rmse_rad?: number;
  max_acceleration_mps2?: number;
  status: string;
  reason?: string;
}
export interface Replay {
  path: string;
  observed: (Pose & { id: string })[];
  report: ImportedReport | {
    kind?: "legacy";
    status: string;
    coverage: number;
    per_actor: Metric[];
    engine_version: string;
    events?: {
      actors: string[];
      minimum_clearance_xy_m: number;
      contact_samples: number;
    }[];
    validity: { dynamic_checks: boolean };
  };
}
export interface Diagnostic { code: string; message: string; actor_id?: string; vertex_index?: number; xml_line?: number; /** real2sim notes (plan43): when it happens. */ t_s?: number }
export interface MapContext { schema_version: 1; profile: string; map_id: string; scene: string; coordinates: { frame: string; units: string; yaw_units: string; axes: string; origin_global_m: number[] }; bounds_m: number[]; polygons: Environment["polygons"]; static_obstacles: {kind: string; footprint: number[][]; estimated: true}[]; source_actors: {id: string; role: string; category: string; length_m: number; width_m: number; height_m: number; initial_pose: {x_m: number; y_m: number; z_m: number; yaw_rad: number}}[]; limits: {max_xml_bytes: number; max_actors: number; max_duration_s: number; max_vertices_per_actor: number; min_duration_s: number; max_speed_mps: {vehicle: number; pedestrian: number}; max_acceleration_mps2: {vehicle: number; pedestrian: number}}; capabilities: {xosc_version: string; position: string; action: string; shape: string; time: string; external_assets: boolean; road_relative_positions: boolean}; dataset_version: string }
export interface ImportedScenario extends Scenario { mode: "imported"; profile: string; map_id: string; environment: Environment; import: {sha256: string; diagnostics: Diagnostic[]; file_name?: string}; /** Only after importTemplate: where it landed on the source ego path. */ placement?: Placement;
  /** Team real2sim replay package (plan43): own admission path; map findings are notes in import.diagnostics. */
  kind?: "real2sim"; report?: Real2simReport | null }
/** Filtered real2sim report.json (plan43 01-CONTRACTS §3); absent fields are null/empty, never invented. */
export interface Real2simReport {
  id: string; scene: string; source: string; valid: boolean | null; reasons: string[]; group: string | null;
  event: { actor: string; t0: number | null; decel: number | null; target: string; dwell: number | null } | null;
  drivers: { react: boolean; reaction_s: number | null; thresholds: Record<string, number>; per_vehicle: Record<string, { T?: number; s0?: number; max_decel?: number }> } | null;
  ego: { stimulus?: number; a_min?: number; a_used?: number; min_gap?: number; min_ttc?: number; conflict_with?: string; recorded_min_gap?: number; recorded_min_ttc?: number } | null;
  reacted: string[]; max_decel_used: Record<string, number>;
  physics: Record<string, { max_speed?: number; max_accel?: number; t_accel?: number; max_decel?: number; t_decel?: number; limit_accel?: number; limit_decel?: number }>;
  gaps: Record<string, { gap?: number; t?: number; speed?: number; leader?: string }>;
  collisions: string[];
  esmini: { exit: number | null; version: string | null; problems: string[]; replay_error_m: Record<string, { mean?: number; max?: number }> } | null;
  run: { created: string | null; commit: string | null; dirty: boolean | null; esmini_version: string | null; dt: number | null; road: string | null } | null;
  /** Topeye reactive detail (plan46 C2); absent on team real2sim packages. */
  topeye?: ReactiveDetail | null;
}
/** Files of a real2sim package folder as sent to importPackage (plan43). */
export interface PackageFile { name: string; data_base64: string }
export interface PackageSelection { files: PackageFile[]; /** report.json scene, if any. */ scene: string | null; skipped: string[] }
/** Reactive scenario authoring candidate lead vehicle (plan45); `kinds` per event kind (plan47 C2). */
export interface Candidate extends Partial<CandidateKinds> {
  actor_id: string;
  name: string;
  category: string;
  max_decel_mps2: number;
  windows: [number, number][];
  followers: string[];
  /** Windows per event (plan46 C1), keyed "<target>:<dwell>:<decel>"; absent from older workers. */
  windows_by_event?: CandidateWindows["windows_by_event"];
}
export interface ReactiveLabelProblem {
  name: string;
  t_from: number;
  t_to: number;
}
export interface ReactiveCandidates {
  scene: string;
  duration_s: number;
  candidates: Candidate[];
  label_problems: ReactiveLabelProblem[];
}
/** Fields of every event kind (plan45 C1). */
interface ReactiveEventBase {
  actor_id: string;
  t0_s: number;
  react: boolean;
  reaction_s: number;
}
/** plan45 braking event; without `kind` it is a brake (v0.34.0 packages). */
export interface BrakeEvent extends ReactiveEventBase {
  kind?: "brake";
  decel_mps2: number;
  target: "stop" | "half";
  dwell_s: number;
}
/**
 * plan47 C1: one event per kind, carrying only that kind's fields (the worker rejects fields of another kind with
 * INVALID_INPUT). Field types come from ReactiveKindFields.
 */
export type ReactiveEvent = BrakeEvent
  | (ReactiveEventBase & { kind: "accelerate" } & Required<Pick<ReactiveKindFields, "target_mps" | "accel_mps2">>)
  | (ReactiveEventBase & { kind: "stopline"; dwell_s: number })
  | (ReactiveEventBase & { kind: "lane_change" } & Required<Pick<ReactiveKindFields, "direction" | "duration_s">>);
export type ScenarioApi = DesktopAPI;
export type TemplateFit = { scene: string; ok: true; placement: Placement } | { scene: string; ok: false; code: string; message: string };
export interface ImportedReport { kind: "imported"; execution: "pass" | "fail"; fidelity: {coverage: number; max_xy_m: number; max_yaw_rad: number}; map_conformance: "pass" | "fail"; contacts: {actors: string[]; [key: string]: unknown}[]; warnings: string[] }
export interface ImportedReplay extends Replay { report: ImportedReport }
export interface Settings {
  mode?: "web-demo" | "local-web";
  dataset: string | null;
  datasetVersion: string | null;
  workspace: string;
  engineAvailable: boolean;
  version: string;
}
/** Measured LIDAR_TOP sweep in the ego frame (x forward, y left, z up); see backend lidar_frame.py. */
export interface LidarFrame {
  scene: string;
  sensor: "LIDAR_TOP";
  frame: "ego";
  time_s: number;
  offset_s: number;
  timestamp_us: number;
  count: number;
  range_m: number;
  xyz_cm_b64: string;
  intensity_b64: string;
}
/** One imported OpenSCENARIO package in the workspace (backend library.py). */
export interface ImportedRun {
  run_id: string;
  at: string;
  status: "completed" | "running" | "interrupted" | "failed";
  execution?: "pass" | "fail";
  map_conformance?: "pass" | "fail";
  coverage?: number;
  max_xy_m?: number;
  max_yaw_rad?: number;
  contacts?: number;
}
export interface ImportedEntry {
  /** Made from a template: "Sửa" opens the template form. */
  has_template?: boolean;
  /** "real2sim" = team replay package (plan43): view only, report instead of metrics. */
  kind?: "imported" | "real2sim";
  report?: { valid: boolean | null; group: string | null; event: Real2simReport["event"] } | null;
  scenario_id: string;
  package_path: string;
  name: string;
  scene: string;
  map_id: string;
  actors: number;
  duration_s: number;
  created_at: string;
  runs: ImportedRun[];
}
/** Automatic scene metrics (backend scene_metrics.py, definitions in plan33 SPEC §1). */
export interface ObjectMetrics {
  category: string; role: string; length_m: number; width_m: number; height_m: number | null;
  keyframes: number; span_s: number; grid_t: number[];
  pilot_err: (number | null)[] | null; baseline_err: number[];
  pilot_lon_lat: [number, number][] | null; baseline_lon_lat: [number, number][];
  pilot_ade_m: number | null; pilot_max_m: number | null; baseline_ade_m: number; baseline_max_m: number;
}
export interface SceneMetrics {
  version: string; scene: string; generated_at: string; engine: string | null;
  objects: { total: number; moving: number };
  replay: { pilot: { ade_m: number; max_m: number } | null; baseline: { ade_m: number; max_m: number }; objects: number };
  variants: { per_object: number; total: number; pilot_valid: number | null; baseline_valid: number; map_checked: boolean };
  rare: { pilot: number | null; original: number };
  per_object: Record<string, ObjectMetrics>;
  notes: string[]; scenario_id?: string;
}
export interface StorageInfo { workspace: string; scenarios: number; scenarioBytes: number; metricsBytes: number; trashBytes: number; trashItems: number }
export type FeedbackKind = "bug" | "idea" | "other";
export interface FeedbackEntry { id: string; kind: FeedbackKind; message: string; contact: string; saved_at: string; context?: Record<string, string> }
export interface DesktopAPI {
    scenarioGroups?(args: {scene: string}): Promise<ScenarioGroup[]>;
    recordScenarioGroup?(args: {group: ScenarioGroup}): Promise<ScenarioGroup>;
  chooseDataset(): Promise<{ name: string; version: string; scenes: Scene[] } | null>;
  chooseWorkspace(): Promise<{ name: string } | null>;
  settings(): Promise<Settings>;
  listScenes(): Promise<Scene[]>;
  sourceScene(args: { scene: string }): Promise<Scenario>;
  extract(args: {
    scene: string;
    actor_tokens: string[];
    start_s: number;
    end_s: number;
  }): Promise<Scenario>;
  variant(args: {
    scenario_id: string;
    target_actor: string;
    speed_factor: number;
    gap_offset_m: number;
  }): Promise<Scenario>;
  export(args: { scenario_id: string }): Promise<{ path: string }>;
  replay(args: { scenario_id: string }): Promise<Replay>;
  mapContext(args: { source_id: string }): Promise<MapContext>;
  exportMapContext(args: { source_id: string }): Promise<{path: string} | null>;
  /** With `xml` the given text is imported (editor); otherwise a file is picked. */
  importXosc(args: { source_id: string; xml?: string; file_name?: string }): Promise<ImportedScenario | null>;
  /** Compiles a scenario template (plan38) to profile XOSC in the worker and imports it like a file. */
  importTemplate(args: { source_id: string; template: ScenarioTemplate }): Promise<ImportedScenario>;
  /** Picks a real2sim package folder (plan43); null when the picker is closed. */
  pickPackage(): Promise<PackageSelection | null>;
  importPackage(args: { source_id: string; files: PackageFile[] }): Promise<ImportedScenario>;
  /** Finds candidate lead vehicles and valid windows for reactive braking (plan45). */
  reactiveCandidates(args: { source_id: string }): Promise<ReactiveCandidates>;
  /** Imports a reactive event variant as a real2sim package (plan45). */
  importReactive(args: { source_id: string; event: ReactiveEvent }): Promise<ImportedScenario>;
  /** The same reactive event re-run with reaction 0.7 / 1.0 / 1.5 s (plan46); nothing is saved. */
  reactiveSensitivity(args: { source_id: string; event: ReactiveEvent }): Promise<ReactiveSensitivity>;
  /** Scene metric 2 (plan46): fixed event grid, baseline vs pilot (metrics worker, cached). */
  reactiveMetrics(args: { scene: string; reactions?: number[] }): Promise<ReactiveMetrics>;
  /** plan47 C5: the same metric per event kind (`["brake"]` = v0.34.0). */
  reactiveMetrics(args: { scene: string; reactions?: number[]; kinds: ReactiveKind[] }): Promise<ReactiveMetricsByKind>;
  /** Scene metric 1 (plan46): esmini replay error of exact / baseline / pilot (metrics worker, cached). */
  replayErrorMetrics(args: { scene: string }): Promise<ReplayErrorMetrics>;
  /** esmini check of a real2sim package (plan46, validity condition 1); cached next to the package. */
  esminiCheck(args: { scenario_id: string }): Promise<EsminiCheck>;
  /** Read-only: would this template pass the import gate on `scene`? (metrics worker, cached). */
  templateFit(args: { scene: string; template: ScenarioTemplate }): Promise<TemplateFit>;
  /** Read-only: why each scene's map is rejected for scenario creation (null = usable). Metrics worker, cached. */
  mapStatus?(): Promise<Record<string, string | null>>;
  openImported(args: { source_id: string; path?: string }): Promise<ImportedScenario | null>;
  listImported(): Promise<ImportedEntry[]>;
  /** `template` is set for scenarios made from a template (plan38): they are edited in the template form, not as XML. */
  readImported(args: { scenario_id: string }): Promise<{ scenario_id: string; name: string; file_name: string; xml: string; template?: ScenarioTemplate | null }>;
  deleteImportedRun(args: { scenario_id: string; run_id: string }): Promise<{ trash_path: string }>;
  deleteImported(args: { scenario_id: string }): Promise<{ trash_path: string }>;
  replayImported(args: { scenario_id: string }): Promise<ImportedReplay>;
  lidarFrame(args: { scene: string; time_s: number }): Promise<LidarFrame>;
  scenarioMetrics(args: { scenario_id: string }): Promise<SceneMetrics>;
  /** Settings page (local app only; absent in the web demo). */
  storageInfo?(): Promise<StorageInfo>;
  clearMetricsCache?(): Promise<{ removed: number }>;
  emptyTrash?(): Promise<{ removed: number }>;
  submitFeedback?(args: { kind: FeedbackKind; message: string; contact?: string; context?: Record<string, string> }): Promise<{ id: string; saved_at: string }>;
  listFeedback?(): Promise<FeedbackEntry[]>;
  cancelJob(): Promise<boolean>;
  onProgress(
    callback: (value: {
      phase: string;
      completed: number;
      total: number;
    }) => void,
  ): () => void;
}
declare global {
  interface Window {
    scenarioApp?: DesktopAPI;
  }
}

export type WithoutReact<T> = T extends unknown ? Omit<T, "react"> : never;
export interface ScenarioGroup {
 schema_version: 1; id: string; scene: string; map_id: string; event: WithoutReact<ReactiveEvent>;
 baseline_id: string | null; pilot_id: string | null; created_at: string;
}
