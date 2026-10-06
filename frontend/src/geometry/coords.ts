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

/**
 * Convert pixel (u, v) on BEV map to LiDAR coordinates (x, y) in meters.
 * Contract (01-CONTRACTS §3):
 * x = (u + 0.5 - 600) * 0.1
 * y = (600 - v - 0.5) * 0.1
 * (+y forward is up, +x right is right)
 */
export function pixelToMeters(
  u: number,
  v: number,
  config: BevConfig = DEFAULT_BEV_CONFIG
): { x: number; y: number } {
  const center = config.size_px / 2;
  const x = (u + 0.5 - center) * config.res_m;
  const y = (center - v - 0.5) * config.res_m;
  return { x, y };
}

/**
 * Convert LiDAR coordinates (x, y) in meters to pixel (u, v) on BEV map.
 */
export function metersToPixel(
  x: number,
  y: number,
  config: BevConfig = DEFAULT_BEV_CONFIG
): { u: number; v: number } {
  const center = config.size_px / 2;
  const u = x / config.res_m + center - 0.5;
  const v = center - 0.5 - y / config.res_m;
  return { u, v };
}

export { shortLabel } from './labels';
