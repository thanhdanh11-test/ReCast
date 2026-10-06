import { FramePose } from './types';

/**
 * Generate a synthetic 3D Gaussian Splat PLY buffer (INRIA V1 binary little-endian format).
 * Compatible with standard 3DGS tools and @mkkellogg/gaussian-splats-3d PlyParser.
 */
export function generateMockSplatPly(count = 1000): ArrayBuffer {
  const headerLines = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${count}`,
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
    'property float opacity',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'end_header\n',
  ];

  const headerStr = headerLines.join('\n');
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(headerStr);

  const numFloatsPerVertex = 17;
  const vertexData = new Float32Array(count * numFloatsPerVertex);

  // Deterministic pseudo-random number generator
  let seed = 1337;
  function rand(): number {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  for (let i = 0; i < count; i++) {
    const o = i * numFloatsPerVertex;

    // Distribute Gaussians around the scene (road, static buildings, ground)
    const angle = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * 35; // 0 to 35m
    const x = Math.cos(angle) * dist;
    const y = Math.sin(angle) * dist;
    const z = -1.8 + rand() * 2.5;

    vertexData[o + 0] = x;
    vertexData[o + 1] = y;
    vertexData[o + 2] = z;
    vertexData[o + 3] = 0; // nx
    vertexData[o + 4] = 0; // ny
    vertexData[o + 5] = 1; // nz

    // Base color SH f_dc: C = (SH * 0.28209479177387814 + 0.5)
    // For asphalt / ground / buildings: gray / beige / subtle tints
    const shade = 0.3 + rand() * 0.4;
    vertexData[o + 6] = (shade - 0.5) / 0.28209479; // f_dc_0 (R)
    vertexData[o + 7] = (shade - 0.5) / 0.28209479; // f_dc_1 (G)
    vertexData[o + 8] = (shade - 0.5) / 0.28209479; // f_dc_2 (B)

    vertexData[o + 9] = 2.0; // opacity (logit: sigmoid(2.0) ~ 0.88)
    vertexData[o + 10] = -1.8; // scale_0 (log scale: exp(-1.8) ~ 0.16m)
    vertexData[o + 11] = -1.8; // scale_1
    vertexData[o + 12] = -1.8; // scale_2

    vertexData[o + 13] = 1.0; // rot_0 (w)
    vertexData[o + 14] = 0.0; // rot_1 (x)
    vertexData[o + 15] = 0.0; // rot_2 (y)
    vertexData[o + 16] = 0.0; // rot_3 (z)
  }

  const totalByteLength = headerBytes.byteLength + vertexData.byteLength;
  const outBuffer = new Uint8Array(totalByteLength);
  outBuffer.set(headerBytes, 0);
  outBuffer.set(new Uint8Array(vertexData.buffer), headerBytes.byteLength);

  return outBuffer.buffer;
}

/**
 * Generate mock pose T_world_lidar for a given frameId.
 * Transforms points from LIDAR_TOP of frameId to scene_world.
 */
export function getMockPose(frameId: string): FramePose {
  const match = frameId.match(/_(\d+)$/);
  const frameIdx = match ? parseInt(match[1], 10) : 0;

  // Ego vehicle travels forward along +y with slight yaw
  const yaw = frameIdx * 0.02;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const tx = frameIdx * 0.2;
  const ty = frameIdx * 2.0;
  const tz = 0.0;

  return {
    T_world_lidar: [
      [c, -s, 0, tx],
      [s,  c, 0, ty],
      [0,  0, 1, tz],
      [0,  0, 0,  1],
    ],
  };
}

let cachedBlobUrl: string | null = null;
export function getMockSplatBlobUrl(): string {
  if (cachedBlobUrl) return cachedBlobUrl;
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return 'blob:mock-splat';
  }
  const plyBuffer = generateMockSplatPly(1000);
  const blob = new Blob([plyBuffer], { type: 'application/octet-stream' });
  cachedBlobUrl = URL.createObjectURL(blob);
  return cachedBlobUrl;
}
