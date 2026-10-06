import {
  SceneSummary,
  SceneMeta,
  CameraCalib,
  Box3D,
  DEFAULT_BEV_CONFIG,
} from './types';

export const MOCK_SCENE_ID = 'scene-0061';
export const MOCK_NUM_FRAMES = 10;

export const MOCK_CAMERAS = [
  'CAM_FRONT_LEFT',
  'CAM_FRONT',
  'CAM_FRONT_RIGHT',
  'CAM_BACK_LEFT',
  'CAM_BACK',
  'CAM_BACK_RIGHT',
] as const;

export function getMockFrameId(index: number): string {
  return `${MOCK_SCENE_ID}_${String(index).padStart(6, '0')}`;
}

export const mockScenes: SceneSummary[] = [
  { scene: MOCK_SCENE_ID, n_frames: MOCK_NUM_FRAMES, cached: true },
  { scene: 'scene-0103', n_frames: 10, cached: false }, // for testing 425 error
];

export const mockMeta: SceneMeta = {
  cache_version: 1,
  scene: MOCK_SCENE_ID,
  frames: Array.from({ length: MOCK_NUM_FRAMES }, (_, i) => getMockFrameId(i)),
  bev: DEFAULT_BEV_CONFIG,
  calib_report: {
    verdict: 'ok',
    cameras: {
      CAM_FRONT_LEFT: { dt_ms: 0.42, status: 'ok' },
      CAM_FRONT: { dt_ms: 0.18, status: 'ok' },
      CAM_FRONT_RIGHT: { dt_ms: 0.55, status: 'ok' },
      CAM_BACK_LEFT: { dt_ms: 0.81, status: 'ok' },
      CAM_BACK: { dt_ms: 0.25, status: 'ok' },
      CAM_BACK_RIGHT: { dt_ms: 0.63, status: 'ok' },
    },
  },
};

/**
 * Generate 4x4 matrix for camera extrinsic T_lidar_cam:
 * yawAngleRad: camera heading in LiDAR frame (e.g. 0 for front, pi for back)
 * Camera coords: +x right, +y down, +z forward
 * LiDAR coords: +x right, +y front, +z up
 */
function makeExtrinsic(yawAngleRad: number, tx: number, ty: number, tz: number): number[][] {
  const c = Math.cos(yawAngleRad);
  const s = Math.sin(yawAngleRad);

  // Rotation: First rotate in horizontal LiDAR plane by -yawAngleRad so forward aligns with camera heading,
  // then map (x, y, z)_lidar to (x, -z, y)_cam
  // R_lidar_heading:
  // x' =  c*x + s*y
  // y' = -s*x + c*y (forward for camera)
  // z' =  z (up)
  // Then camera frame:
  // x_cam =  x' =  c*x + s*y
  // y_cam = -z' = -z
  // z_cam =  y' = -s*x + c*y
  return [
    [ c,  s,  0, tx],
    [ 0,  0, -1, ty],
    [-s,  c,  0, tz],
    [ 0,  0,  0,  1],
  ];
}

const K_NU_SCENES: number[][] = [
  [1260, 0, 800],
  [0, 1260, 450],
  [0, 0, 1],
];

export const mockCalibs: Record<string, CameraCalib> = {
  CAM_FRONT: {
    name: 'CAM_FRONT',
    K: K_NU_SCENES,
    T_lidar_cam: makeExtrinsic(0, 0, 0.3, 0.8),
    width: 1600,
    height: 900,
  },
  CAM_FRONT_LEFT: {
    name: 'CAM_FRONT_LEFT',
    K: K_NU_SCENES,
    T_lidar_cam: makeExtrinsic(Math.PI / 3, -0.6, 0.4, 0.7),
    width: 1600,
    height: 900,
  },
  CAM_FRONT_RIGHT: {
    name: 'CAM_FRONT_RIGHT',
    K: K_NU_SCENES,
    T_lidar_cam: makeExtrinsic(-Math.PI / 3, 0.6, 0.4, 0.7),
    width: 1600,
    height: 900,
  },
  CAM_BACK_LEFT: {
    name: 'CAM_BACK_LEFT',
    K: K_NU_SCENES,
    T_lidar_cam: makeExtrinsic((2 * Math.PI) / 3, -0.6, 0.4, -0.7),
    width: 1600,
    height: 900,
  },
  CAM_BACK: {
    name: 'CAM_BACK',
    K: K_NU_SCENES,
    T_lidar_cam: makeExtrinsic(Math.PI, 0, 0.3, -1.2),
    width: 1600,
    height: 900,
  },
  CAM_BACK_RIGHT: {
    name: 'CAM_BACK_RIGHT',
    K: K_NU_SCENES,
    T_lidar_cam: makeExtrinsic((-2 * Math.PI) / 3, 0.6, 0.4, -0.7),
    width: 1600,
    height: 900,
  },
};

export function getMockBoxes(frameIndex: number): Box3D[] {
  const t = frameIndex * 0.3; // speed offset
  const fTag = String(frameIndex).padStart(4, '0');
  return [
    {
      id: `gt:scene-0061_f${fTag}_box01`,
      source: 'gt',
      track_key: 'inst:car_01',
      label: 'vehicle.car',
      cx: 1.8,
      cy: 14.0 + t,
      cz: -0.7,
      l: 4.6,
      w: 2.0,
      h: 1.6,
      yaw: 0.04,
      score: 1.0,
      version: null,
      attributes: {},
    },
    {
      id: `gt:scene-0061_f${fTag}_box02`,
      source: 'gt',
      track_key: 'inst:car_02',
      label: 'vehicle.car',
      cx: -3.8,
      cy: 28.0 - t * 1.5,
      cz: -0.7,
      l: 4.4,
      w: 1.9,
      h: 1.5,
      yaw: Math.PI - 0.05,
      score: 1.0,
      version: null,
      attributes: {},
    },
    {
      id: `gt:scene-0061_f${fTag}_box03`,
      source: 'gt',
      track_key: 'inst:truck_01',
      label: 'vehicle.truck',
      cx: 6.8,
      cy: 22.0,
      cz: -0.2,
      l: 7.2,
      w: 2.5,
      h: 2.7,
      yaw: 0.0,
      score: 1.0,
      version: null,
      attributes: {},
    },
    {
      id: `gt:scene-0061_f${fTag}_box04`,
      source: 'gt',
      track_key: 'inst:ped_01',
      label: 'human.pedestrian',
      cx: 4.5,
      cy: 9.0 + frameIndex * 0.08,
      cz: -0.85,
      l: 0.8,
      w: 0.8,
      h: 1.75,
      yaw: -Math.PI / 2,
      score: 1.0,
      version: null,
      attributes: {},
    },
    {
      id: `gt:scene-0061_f${fTag}_box05`,
      source: 'gt',
      track_key: 'inst:car_03',
      label: 'vehicle.car',
      cx: 0.5,
      cy: -14.0 + t * 0.8,
      cz: -0.7,
      l: 4.5,
      w: 2.0,
      h: 1.6,
      yaw: 0.0,
      score: 1.0,
      version: null,
      attributes: {},
    },
  ];
}

/**
 * Generate synthetic ~30,000 LiDAR points as Float32Array (N, 7).
 * Channels: [x, y, z, intensity, r, g, b]
 * r, g, b are 0..255 or -1 when no camera sees the point.
 */
export function generateMockPoints(frameIndex: number, count = 30000): Float32Array {
  const buffer = new Float32Array(count * 7);
  let offset = 0;

  // Pseudo-random deterministic generator
  let seed = 42 + frameIndex * 17;
  function rand(): number {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  // 1. Ground points (~18,000 points)
  const numGround = Math.floor(count * 0.6);
  for (let i = 0; i < numGround; i++) {
    const angle = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 45; // radius up to 45m
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    const z = -1.8 + (rand() - 0.5) * 0.08; // ground surface

    // Intensity: higher near center and on road stripes
    const isStripe = Math.abs(x - 3.5) < 0.2 || Math.abs(x + 3.5) < 0.2;
    const intensity = isStripe ? 200 + rand() * 40 : 40 + rand() * 50;

    let cr = -1;
    let cg = -1;
    let cb = -1;
    // Points within 30m get camera colors
    if (r < 30) {
      if (isStripe) {
        cr = 240; cg = 240; cb = 220;
      } else {
        const shade = Math.floor(70 + rand() * 30);
        cr = shade; cg = shade; cb = shade;
      }
    }

    buffer[offset++] = x;
    buffer[offset++] = y;
    buffer[offset++] = z;
    buffer[offset++] = intensity;
    buffer[offset++] = cr;
    buffer[offset++] = cg;
    buffer[offset++] = cb;
  }

  // 2. Obstacles / cars / pedestrians / surroundings (~12,000 points)
  const boxes = getMockBoxes(frameIndex);
  const remaining = count - numGround;
  for (let i = 0; i < remaining; i++) {
    const box = boxes[i % boxes.length];
    // Sample points around box surface
    const u = (rand() - 0.5) * box.l;
    const v = (rand() - 0.5) * box.w;
    const w = (rand() - 0.5) * box.h;

    const cosY = Math.cos(box.yaw);
    const sinY = Math.sin(box.yaw);
    const x = box.cx + u * cosY - v * sinY + (rand() - 0.5) * 0.1;
    const y = box.cy + u * sinY + v * cosY + (rand() - 0.5) * 0.1;
    const z = box.cz + w + (rand() - 0.5) * 0.05;

    const intensity = 80 + rand() * 120;
    let cr = 180;
    let cg = 80;
    let cb = 80;
    if (box.label === 'human.pedestrian') {
      cr = 60; cg = 180; cb = 240;
    } else if (box.label === 'vehicle.truck') {
      cr = 240; cg = 180; cb = 40;
    }

    buffer[offset++] = x;
    buffer[offset++] = y;
    buffer[offset++] = z;
    buffer[offset++] = intensity;
    buffer[offset++] = cr;
    buffer[offset++] = cg;
    buffer[offset++] = cb;
  }

  return buffer;
}

/**
 * Generate a synthetic BEV 1200x1200 PNG as a data URL or blob.
 */
let cachedBevBlobUrl: string | null = null;
export function getMockBevImageUrl(): string {
  if (cachedBevBlobUrl) return cachedBevBlobUrl;
  if (typeof document === 'undefined') {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Background dark
  ctx.fillStyle = '#111216';
  ctx.fillRect(0, 0, 1200, 1200);

  // Range circles (10m = 100px, 20m = 200px, 30m = 300px, 40m = 400px, 50m = 500px)
  const cx = 600;
  const cy = 600;
  ctx.strokeStyle = '#222530';
  ctx.lineWidth = 1;
  for (const radiusM of [10, 20, 30, 40, 50]) {
    const rPx = radiusM / 0.1;
    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#444b60';
    ctx.font = '12px monospace';
    ctx.fillText(`${radiusM}m`, cx + rPx + 4, cy - 4);
  }

  // Cross axes
  ctx.strokeStyle = '#2a2e3d';
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, 1200);
  ctx.moveTo(0, cy); ctx.lineTo(1200, cy);
  ctx.stroke();

  // Road asphalt
  ctx.fillStyle = '#1a1c24';
  ctx.fillRect(cx - 50, 0, 100, 1200); // 10m road width

  // Road lane markings
  ctx.strokeStyle = '#4e566d';
  ctx.lineWidth = 2;
  ctx.setLineDash([20, 20]);
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, 1200);
  ctx.stroke();
  ctx.setLineDash([]);

  // Road edges (white solid)
  ctx.strokeStyle = '#606a85';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 50, 0); ctx.lineTo(cx - 50, 1200);
  ctx.moveTo(cx + 50, 0); ctx.lineTo(cx + 50, 1200);
  ctx.stroke();

  // Ego vehicle footprint (2m x 4.5m = 20px x 45px) at center (600, 600)
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(cx - 10, cy - 22, 20, 45);

  // Ego forward heading arrow (white triangle pointing up)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 30);
  ctx.lineTo(cx - 6, cy - 20);
  ctx.lineTo(cx + 6, cy - 20);
  ctx.closePath();
  ctx.fill();

  cachedBevBlobUrl = canvas.toDataURL('image/png');
  return cachedBevBlobUrl;
}

/**
 * Generate synthetic 1600x900 camera image as data URL.
 */
const cachedCamImages: Record<string, string> = {};
export function getMockCameraImageUrl(camName: string, frameId: string): string {
  const key = `${camName}_${frameId}`;
  if (cachedCamImages[key]) return cachedCamImages[key];

  if (typeof document === 'undefined') {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, 450);
  skyGrad.addColorStop(0, '#1c2438');
  skyGrad.addColorStop(1, '#2f3b52');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, 1600, 450);

  // Ground / road
  const roadGrad = ctx.createLinearGradient(0, 450, 0, 900);
  roadGrad.addColorStop(0, '#1a1d24');
  roadGrad.addColorStop(1, '#2d323e');
  ctx.fillStyle = roadGrad;
  ctx.fillRect(0, 450, 1600, 450);

  // Horizon line
  ctx.strokeStyle = '#3a4459';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 450);
  ctx.lineTo(1600, 450);
  ctx.stroke();

  // Perspective road guidelines
  ctx.strokeStyle = '#4a556d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(800, 450); ctx.lineTo(200, 900);
  ctx.moveTo(800, 450); ctx.lineTo(1400, 900);
  ctx.stroke();

  // Center dash
  ctx.strokeStyle = '#8a95ad';
  ctx.lineWidth = 3;
  ctx.setLineDash([30, 30]);
  ctx.beginPath();
  ctx.moveTo(800, 450);
  ctx.lineTo(800, 900);
  ctx.stroke();
  ctx.setLineDash([]);

  // Hood / bumper at bottom
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(400, 900);
  ctx.quadraticCurveTo(800, 830, 1200, 900);
  ctx.closePath();
  ctx.fill();

  // Overlay info tag
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(30, 30, 380, 75);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 30, 380, 75);

  ctx.fillStyle = '#60a5fa';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(camName, 45, 65);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '16px monospace';
  ctx.fillText(`Frame: ${frameId}`, 45, 92);

  const url = canvas.toDataURL('image/jpeg', 0.85);
  cachedCamImages[key] = url;
  return url;
}
