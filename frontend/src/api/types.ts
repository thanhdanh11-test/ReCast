export interface SceneSummary {
  scene: string;
  n_frames: number;
  cached: boolean;
}

export interface BevConfig {
  res_m: number;
  extent_m: number;
  origin: string;
  size_px: number;
}

export const DEFAULT_BEV_CONFIG: BevConfig = {
  res_m: 0.1,
  extent_m: 60.0,
  origin: 'ego_center',
  size_px: 1200,
};

export interface CameraCalibInfo {
  dt_ms: number;
  status: 'ok' | 'warning' | 'error';
}

export interface CalibReport {
  verdict: 'ok' | 'warning' | 'error';
  cameras: Record<string, CameraCalibInfo>;
}

export interface SceneMeta {
  cache_version: number;
  scene: string;
  frames: string[];
  bev: BevConfig;
  calib_report: CalibReport;
}

export interface CameraCalib {
  name?: string;
  K: number[][]; // 3x3
  T_lidar_cam: number[][]; // 4x4
  width: number;
  height: number;
}

export interface Box3D {
  id: string;
  source: 'gt' | 'human' | 'pred' | 'gt_import';
  track_key: string | null;
  label: string;
  cx: number;
  cy: number;
  cz: number;
  l: number;
  w: number;
  h: number;
  yaw: number;
  score: number | null;
  version: number | null;
  attributes: Record<string, unknown>;
}

export type FaceName = 'front' | 'back' | 'left' | 'right' | 'top';

export interface FaceEntry {
  uv: [number, number, number, number]; // [u0, v0, u1, v1] in atlas pixels
  cam?: string;
  seen: boolean;
  src_frame?: string;
  src_dt?: number;
}

export interface BoxAtlasEntry {
  faces: Partial<Record<FaceName, FaceEntry>>;
}

export interface BoxAtlas {
  atlas_w: number;
  atlas_h: number;
  ground_z: number;
  boxes: Record<string, BoxAtlasEntry>;
}

export interface DenseObjectEntry {
  id: string;
  track_key: string;
  start: number;
  count: number;
  n_frames: number;
  rigid: boolean;
}

export interface ObjectsDenseMeta {
  objects: DenseObjectEntry[];
}

export interface ObjectsDenseData {
  meta: ObjectsDenseMeta;
  points: Float32Array;
}

export interface PointsData {
  buffer: Float32Array;
  count: number;
  channels: 7; // [x, y, z, intensity, r, g, b]
}

export interface FramePose {
  T_world_lidar: number[][]; // 4x4 float64: LIDAR_TOP -> scene_world
}

export interface PanoMeta {
  center: [number, number, number]; // [x, y, z] in LIDAR_TOP
  width: number;
  height: number;
  depth_width: number;
  depth_height: number;
  depth_unit_m: number;
  max_depth_m: number;
}

export interface PanoData {
  meta: PanoMeta;
  depthBuffer: ArrayBuffer;
  rgbUrl: string;
  alphaUrl: string;
}

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

