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
export interface Diagnostic { code: string; message: string; actor_id?: string; vertex_index?: number; xml_line?: number }
export interface MapContext { schema_version: 1; profile: string; map_id: string; scene: string; coordinates: { frame: string; units: string; yaw_units: string; axes: string; origin_global_m: number[] }; bounds_m: number[]; polygons: Environment["polygons"]; static_obstacles: {kind: string; footprint: number[][]; estimated: true}[]; source_actors: {id: string; role: string; category: string; length_m: number; width_m: number; height_m: number; initial_pose: {x_m: number; y_m: number; z_m: number; yaw_rad: number}}[]; limits: {max_xml_bytes: number; max_actors: number; max_duration_s: number; max_vertices_per_actor: number; min_duration_s: number; max_speed_mps: {vehicle: number; pedestrian: number}; max_acceleration_mps2: {vehicle: number; pedestrian: number}}; capabilities: {xosc_version: string; position: string; action: string; shape: string; time: string; external_assets: boolean; road_relative_positions: boolean}; dataset_version: string }
export interface ImportedScenario extends Scenario { mode: "imported"; profile: string; map_id: string; environment: Environment; import: {sha256: string; diagnostics: Diagnostic[]} }
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
export interface DesktopAPI {
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
  openImported(args: { source_id: string; path?: string }): Promise<ImportedScenario | null>;
  listImported(): Promise<ImportedEntry[]>;
  readImported(args: { scenario_id: string }): Promise<{ scenario_id: string; name: string; file_name: string; xml: string }>;
  deleteImported(args: { scenario_id: string }): Promise<{ trash_path: string }>;
  replayImported(args: { scenario_id: string }): Promise<ImportedReplay>;
  lidarFrame(args: { scene: string; time_s: number }): Promise<LidarFrame>;
  scenarioMetrics(args: { scenario_id: string }): Promise<SceneMetrics>;
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
