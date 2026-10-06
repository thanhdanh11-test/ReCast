export interface Box3D {
  id?: string;
  cx: number;
  cy: number;
  cz: number;
  l: number;
  w: number;
  h: number;
  yaw: number;
  label: string;
  score?: number | null;
  source?: 'gt' | 'human' | 'pred' | 'gt_import';
  track_key?: string | null;
  version?: number | null;
  attributes?: Record<string, unknown>;
}

export interface CameraCalib {
  name?: string;
  K: number[][]; // 3x3
  T_lidar_cam: number[][]; // 4x4
  width: number;
  height: number;
}

export interface ProjectedEdge {
  p1: { u: number; v: number };
  p2: { u: number; v: number };
  originalIndices: [number, number];
}

export const BOX_EDGES: [number, number][] = [
  // Bottom face (dz = -h/2)
  [0, 1], [1, 2], [2, 3], [3, 0],
  // Top face (dz = +h/2)
  [4, 5], [5, 6], [6, 7], [7, 4],
  // Vertical pillars
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Compute 8 corners of 3D bounding box in LiDAR coordinates.
 * Convention (01-CONTRACTS §1):
 * l is length along x when yaw = 0
 * w is width along y when yaw = 0
 * h is height along z
 * yaw is rotation angle around z (in radians)
 */
export function computeBoxCorners(box: {
  cx: number;
  cy: number;
  cz: number;
  l: number;
  w: number;
  h: number;
  yaw: number;
}): [number, number, number][] {
  const { cx, cy, cz, l, w, h, yaw } = box;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);

  const signs: [number, number, number][] = [
    [-1, -1, -1], // 0: -x, -y, -z
    [ 1, -1, -1], // 1: +x, -y, -z
    [ 1,  1, -1], // 2: +x, +y, -z
    [-1,  1, -1], // 3: -x, +y, -z
    [-1, -1,  1], // 4: -x, -y, +z
    [ 1, -1,  1], // 5: +x, -y, +z
    [ 1,  1,  1], // 6: +x, +y, +z
    [-1,  1,  1], // 7: -x, +y, +z
  ];

  return signs.map(([sx, sy, sz]) => {
    const dx = (sx * l) / 2;
    const dy = (sy * w) / 2;
    const dz = (sz * h) / 2;
    const x = cx + dx * cosYaw - dy * sinYaw;
    const y = cy + dx * sinYaw + dy * cosYaw;
    const z = cz + dz;
    return [x, y, z];
  });
}

/**
 * Transform a 3D point in LiDAR frame to Camera frame using 4x4 matrix T_lidar_cam.
 */
export function transformPointToCam(
  p: [number, number, number],
  T: number[][]
): [number, number, number] {
  const [x, y, z] = p;
  const xc = T[0][0] * x + T[0][1] * y + T[0][2] * z + T[0][3];
  const yc = T[1][0] * x + T[1][1] * y + T[1][2] * z + T[1][3];
  const zc = T[2][0] * x + T[2][1] * y + T[2][2] * z + T[2][3];
  return [xc, yc, zc];
}

/**
 * Project a 3D camera coordinate [xc, yc, zc] to 2D pixel [u, v] using 3x3 intrinsic K.
 * Returns null if zc <= 0.1 (behind or at lens).
 */
export function projectCamToPixel(
  pCam: [number, number, number],
  K: number[][]
): { u: number; v: number } | null {
  const [xc, yc, zc] = pCam;
  if (zc <= 0.1) return null;
  const u = (K[0][0] * xc + K[0][1] * yc + K[0][2] * zc) / zc;
  const v = (K[1][0] * xc + K[1][1] * yc + K[1][2] * zc) / zc;
  return { u, v };
}

/**
 * Clip a 2D line segment [(x0, y0), (x1, y1)] to rectangle [0, width] x [0, height]
 * using Liang-Barsky algorithm.
 */
export function clipLineToRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number
): [{ u: number; v: number }, { u: number; v: number }] | null {
  let t0 = 0.0;
  let t1 = 1.0;
  const dx = x1 - x0;
  const dy = y1 - y0;

  const p = [-dx, dx, -dy, dy];
  const q = [x0, width - x0, y0, height - y0];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null; // Parallel and outside image
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }

  return [
    { u: x0 + t0 * dx, v: y0 + t0 * dy },
    { u: x0 + t1 * dx, v: y0 + t1 * dy },
  ];
}

/**
 * Project a 3D box onto a camera image.
 * Rules (SPEC-P02 §2 & H02):
 * - Chiếu 8 đỉnh box.
 * - Bỏ cạnh có đỉnh z_cam <= 0.1.
 * - Clip theo khung ảnh (width, height).
 */
export function projectBoxToCamera(
  box: Box3D,
  calib: CameraCalib
): ProjectedEdge[] {
  const corners = computeBoxCorners(box);
  const cornersCam = corners.map((c) => transformPointToCam(c, calib.T_lidar_cam));

  const validEdges: ProjectedEdge[] = [];

  for (const [i1, i2] of BOX_EDGES) {
    const c1 = cornersCam[i1];
    const c2 = cornersCam[i2];

    // Bỏ cạnh có đỉnh z_cam <= 0.1
    if (c1[2] <= 0.1 || c2[2] <= 0.1) {
      continue;
    }

    const p1 = projectCamToPixel(c1, calib.K);
    const p2 = projectCamToPixel(c2, calib.K);
    if (!p1 || !p2) continue;

    // Clip theo khung ảnh
    const clipped = clipLineToRect(
      p1.u,
      p1.v,
      p2.u,
      p2.v,
      calib.width,
      calib.height
    );

    if (clipped) {
      validEdges.push({
        p1: clipped[0],
        p2: clipped[1],
        originalIndices: [i1, i2],
      });
    }
  }

  return validEdges;
}

export { shortLabel, isBoxLongEdgeAtLeast40 } from './labels';
