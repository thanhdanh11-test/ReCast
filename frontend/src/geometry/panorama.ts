import { PanoMeta } from '../api/types';

/**
 * SPEC-P09 §1: Azimuth angle φ from horizontal image coordinate u.
 * φ = ((u + 0.5) / W) · 2π − π
 * φ = 0 is +y (forward), φ > 0 is +x (right), φ < 0 is -x (left), φ = ±π is -y (back).
 */
export function panoAzimuth(u: number, width: number): number {
  return ((u + 0.5) / width) * 2 * Math.PI - Math.PI;
}

/**
 * SPEC-P09 §1: Elevation angle θ from vertical image coordinate v.
 * θ = π/2 − ((v + 0.5) / H) · π
 * v = 0 is straight up (+z, zenith), v = H/2 is horizon (θ = 0), v = H is nadir (-z).
 */
export function panoElevation(v: number, height: number): number {
  return Math.PI / 2 - ((v + 0.5) / height) * Math.PI;
}

/**
 * SPEC-P09 §1: 3D unit direction vector d(φ, θ).
 * d(φ, θ) = (sin φ · cos θ, cos φ · cos θ, sin θ)
 */
export function panoDirection(phi: number, theta: number): [number, number, number] {
  const cosTheta = Math.cos(theta);
  return [
    Math.sin(phi) * cosTheta,
    Math.cos(phi) * cosTheta,
    Math.sin(theta),
  ];
}

/**
 * SPEC-P09 §1: 3D world/LIDAR_TOP point P = C + D(φ, θ) · d.
 */
export function panoPoint(
  center: [number, number, number],
  depth: number,
  phi: number,
  theta: number
): [number, number, number] {
  const [dx, dy, dz] = panoDirection(phi, theta);
  return [
    center[0] + depth * dx,
    center[1] + depth * dy,
    center[2] + depth * dz,
  ];
}

/**
 * SPEC-P09 §1 & §3: Equirectangular UV coordinates.
 * u = (φ + π) / 2π
 * v according to θ: v = (θ + π/2) / π
 */
export function panoUV(phi: number, theta: number): [number, number] {
  return [
    (phi + Math.PI) / (2 * Math.PI),
    (theta + Math.PI / 2) / Math.PI,
  ];
}

/**
 * SPEC-P09 §3: Check if edge between two vertices has depth discontinuity.
 * Threshold: depth difference > 2.0 m AND > 20% relative to minimum depth.
 */
export function isEdgeDepthDiscontinuous(
  d1: number,
  d2: number,
  thresholdM = 2.0,
  thresholdRatio = 0.2
): boolean {
  const diff = Math.abs(d1 - d2);
  if (diff <= thresholdM) {
    return false;
  }
  const minD = Math.min(d1, d2);
  if (minD <= 0) {
    return true;
  }
  return diff / minD > thresholdRatio;
}

/**
 * SPEC-P09 §3: Check if triangle should be dropped to prevent rubber sheet artifacts.
 * Returns true if ANY of the three edges connecting vertices has depth diff > 2m and > 20%.
 */
export function shouldDropTriangle(
  d0: number,
  d1: number,
  d2: number,
  thresholdM = 2.0,
  thresholdRatio = 0.2
): boolean {
  if (isEdgeDepthDiscontinuous(d0, d1, thresholdM, thresholdRatio)) return true;
  if (isEdgeDepthDiscontinuous(d1, d2, thresholdM, thresholdRatio)) return true;
  if (isEdgeDepthDiscontinuous(d2, d0, thresholdM, thresholdRatio)) return true;
  return false;
}

/**
 * Parse depth buffer (uint16 mm, little-endian, row-major Hd x Wd) using DataView.
 * Returns Float32Array in meters.
 */
export function parseDepthBuffer(
  buffer: ArrayBufferLike,
  depthWidth: number,
  depthHeight: number,
  depthUnitM = 0.001
): Float32Array {
  const expectedBytes = depthWidth * depthHeight * 2;
  if (buffer.byteLength < expectedBytes) {
    throw new Error(
      `Invalid depth buffer byteLength (${buffer.byteLength}): expected at least ${expectedBytes} bytes for ${depthWidth}x${depthHeight} uint16`
    );
  }
  const view = new DataView(
    buffer instanceof ArrayBuffer ? buffer : buffer.slice(0)
  );
  const totalPixels = depthWidth * depthHeight;
  const depths = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    // uint16 little-endian: true
    const rawMm = view.getUint16(i * 2, true);
    depths[i] = rawMm * depthUnitM;
  }
  return depths;
}

/**
 * Generate synthetic depth map of a 10m room box centered at C.
 * For any ray direction d, finds intersection with walls at ±roomExtentM in x, y, z.
 */
export function generateRoomBoxDepth(
  width: number,
  height: number,
  roomExtentM = 10.0,
  center: [number, number, number] = [0, 0, 0]
): Float32Array {
  const depths = new Float32Array(width * height);
  for (let v = 0; v < height; v++) {
    const theta = panoElevation(v, height);
    for (let u = 0; u < width; u++) {
      const phi = panoAzimuth(u, width);
      const [dx, dy, dz] = panoDirection(phi, theta);

      // Ray-box intersection from center C to box [-roomExtentM, roomExtentM]
      const tx = dx > 1e-6
        ? (roomExtentM - center[0]) / dx
        : dx < -1e-6
        ? (-roomExtentM - center[0]) / dx
        : 60.0;
      const ty = dy > 1e-6
        ? (roomExtentM - center[1]) / dy
        : dy < -1e-6
        ? (-roomExtentM - center[1]) / dy
        : 60.0;
      const tz = dz > 1e-6
        ? (roomExtentM - center[2]) / dz
        : dz < -1e-6
        ? (-roomExtentM - center[2]) / dz
        : 60.0;

      let d = Math.min(tx, ty, tz);
      if (d < 0.5) d = 0.5;
      if (d > 60.0) d = 60.0;

      depths[v * width + u] = d;
    }
  }
  return depths;
}

export interface SurroundSphereMeshResult {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  vertexDepths: Float32Array;
  totalTriangles: number;
  droppedTriangles: number;
  cols: number;
  rows: number;
}

/**
 * Build 256×128 spherical mesh per SPEC-P09 §1 & §3.
 * Vertices placed at C + D · d.
 * Drops triangles with edges exhibiting depth discontinuity > 2m and > 20%.
 */
export function buildSurroundSphereGeometry(
  meta: PanoMeta,
  depthMeters: Float32Array,
  cols = 256,
  rows = 128
): SurroundSphereMeshResult {
  const depthW = meta.depth_width;
  const depthH = meta.depth_height;
  const center = meta.center;

  // Grid has (cols + 1) * (rows + 1) vertices to correctly wrap seam from u=0 to u=1
  const numVertices = (cols + 1) * (rows + 1);
  const positions = new Float32Array(numVertices * 3);
  const uvs = new Float32Array(numVertices * 2);
  const vertexDepths = new Float32Array(numVertices);

  for (let r = 0; r <= rows; r++) {
    const vFrac = r / rows;
    const theta = Math.PI / 2 - vFrac * Math.PI;
    const vUv = 1.0 - vFrac; // v=1 at zenith (+z), v=0.5 at horizon, v=0 at nadir (-z)

    // Corresponding row in depth map
    const depthV = Math.min(depthH - 1, Math.max(0, Math.round(vFrac * (depthH - 1))));

    for (let c = 0; c <= cols; c++) {
      const uFrac = c / cols;
      const phi = uFrac * 2 * Math.PI - Math.PI;
      const uUv = uFrac; // u=0 at -π, u=0.5 at 0 (+y), u=0.75 at +π/2 (+x), u=1 at +π

      // Corresponding column in depth map
      const depthU = Math.min(depthW - 1, Math.max(0, Math.round(uFrac * (depthW - 1))));

      // Sample depth
      let d = depthMeters[depthV * depthW + depthU];
      if (isNaN(d) || d < 0.5) {
        d = meta.max_depth_m || 60.0;
      }
      if (d > (meta.max_depth_m || 60.0)) {
        d = meta.max_depth_m || 60.0;
      }

      const [dx, dy, dz] = panoDirection(phi, theta);
      const vIdx = r * (cols + 1) + c;

      positions[vIdx * 3 + 0] = center[0] + d * dx;
      positions[vIdx * 3 + 1] = center[1] + d * dy;
      positions[vIdx * 3 + 2] = center[2] + d * dz;

      uvs[vIdx * 2 + 0] = uUv;
      uvs[vIdx * 2 + 1] = vUv;

      vertexDepths[vIdx] = d;
    }
  }

  // Build quads and drop triangles that exceed depth discontinuity threshold
  const maxIndices = cols * rows * 6;
  const tempIndices = new Uint32Array(maxIndices);
  let indexCount = 0;
  let totalTriangles = 0;
  let droppedTriangles = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i00 = r * (cols + 1) + c;
      const i10 = r * (cols + 1) + (c + 1);
      const i01 = (r + 1) * (cols + 1) + c;
      const i11 = (r + 1) * (cols + 1) + (c + 1);

      const d00 = vertexDepths[i00];
      const d10 = vertexDepths[i10];
      const d01 = vertexDepths[i01];
      const d11 = vertexDepths[i11];

      // Triangle 1: (i00, i01, i10)
      totalTriangles++;
      if (shouldDropTriangle(d00, d01, d10)) {
        droppedTriangles++;
      } else {
        tempIndices[indexCount++] = i00;
        tempIndices[indexCount++] = i01;
        tempIndices[indexCount++] = i10;
      }

      // Triangle 2: (i10, i01, i11)
      totalTriangles++;
      if (shouldDropTriangle(d10, d01, d11)) {
        droppedTriangles++;
      } else {
        tempIndices[indexCount++] = i10;
        tempIndices[indexCount++] = i01;
        tempIndices[indexCount++] = i11;
      }
    }
  }

  const indices = tempIndices.slice(0, indexCount);

  return {
    positions,
    uvs,
    indices,
    vertexDepths,
    totalTriangles,
    droppedTriangles,
    cols,
    rows,
  };
}

/**
 * SPEC-P09 §5 (F1): Build complete background sphere geometry at radius max_depth_m (default 60m).
 * Centered at C. No dropped triangles.
 * Rendered behind the LiDAR bowl mesh to prevent black voids where triangles were dropped or alpha=0.
 */
export function buildBackgroundSphereGeometry(
  meta: PanoMeta,
  radius?: number,
  cols = 128,
  rows = 64
): SurroundSphereMeshResult {
  const r = radius ?? meta.max_depth_m ?? 60.0;
  const center = meta.center;
  const numVertices = (cols + 1) * (rows + 1);
  const positions = new Float32Array(numVertices * 3);
  const uvs = new Float32Array(numVertices * 2);
  const vertexDepths = new Float32Array(numVertices);

  for (let row = 0; row <= rows; row++) {
    const vFrac = row / rows;
    const theta = Math.PI / 2 - vFrac * Math.PI;
    const vUv = 1.0 - vFrac;

    for (let col = 0; col <= cols; col++) {
      const uFrac = col / cols;
      const phi = uFrac * 2 * Math.PI - Math.PI;
      const uUv = uFrac;

      const [dx, dy, dz] = panoDirection(phi, theta);
      const vIdx = row * (cols + 1) + col;

      positions[vIdx * 3 + 0] = center[0] + r * dx;
      positions[vIdx * 3 + 1] = center[1] + r * dy;
      positions[vIdx * 3 + 2] = center[2] + r * dz;

      uvs[vIdx * 2 + 0] = uUv;
      uvs[vIdx * 2 + 1] = vUv;

      vertexDepths[vIdx] = r;
    }
  }

  const maxIndices = cols * rows * 6;
  const indices = new Uint32Array(maxIndices);
  let idx = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i00 = row * (cols + 1) + col;
      const i10 = row * (cols + 1) + (col + 1);
      const i01 = (row + 1) * (cols + 1) + col;
      const i11 = (row + 1) * (cols + 1) + (col + 1);

      // Triangle 1: (i00, i01, i10)
      indices[idx++] = i00;
      indices[idx++] = i01;
      indices[idx++] = i10;

      // Triangle 2: (i10, i01, i11)
      indices[idx++] = i10;
      indices[idx++] = i01;
      indices[idx++] = i11;
    }
  }

  return {
    positions,
    uvs,
    indices,
    vertexDepths,
    totalTriangles: cols * rows * 2,
    droppedTriangles: 0,
    cols,
    rows,
  };
}
