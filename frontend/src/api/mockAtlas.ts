import { BoxAtlas, Box3D } from './types';

export const MOCK_ATLAS_WIDTH = 1024;
export const MOCK_ATLAS_HEIGHT = 1024;
export const MOCK_GROUND_Z = -1.84;

export const MOCK_FACE_REGIONS = {
  front: { uv: [32, 32, 288, 288] as [number, number, number, number], color: '#ef4444', label: 'F', name: 'FRONT' },
  back:  { uv: [320, 32, 576, 288] as [number, number, number, number], color: '#3b82f6', label: 'B', name: 'BACK' },
  left:  { uv: [608, 32, 864, 288] as [number, number, number, number], color: '#10b981', label: 'L', name: 'LEFT' },
  right: { uv: [32, 320, 288, 576] as [number, number, number, number], color: '#f59e0b', label: 'R', name: 'RIGHT' },
  top:   { uv: [320, 320, 576, 576] as [number, number, number, number], color: '#06b6d4', label: 'T', name: 'TOP' },
};

/**
 * Generate SVG image data URI for mock atlas with distinct colored faces & F/B/L/R/T letters.
 * Works seamlessly in both browser and headless/node environments.
 */
export function generateMockAtlasSvg(): string {
  const w = MOCK_ATLAS_WIDTH;
  const h = MOCK_ATLAS_HEIGHT;

  let rects = '';
  for (const [, face] of Object.entries(MOCK_FACE_REGIONS)) {
    const [u0, v0, u1, v1] = face.uv;
    const fw = u1 - u0;
    const fh = v1 - v0;
    const cx = u0 + fw / 2;
    const cy = v0 + fh / 2;

    rects += `
      <!-- Face ${face.name} -->
      <g>
        <rect x="${u0}" y="${v0}" width="${fw}" height="${fh}" fill="${face.color}" rx="8" stroke="#ffffff" stroke-width="4"/>
        <rect x="${u0 + 12}" y="${v0 + 12}" width="${fw - 24}" height="${fh - 24}" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-dasharray="8,8"/>
        <!-- Top edge indicator -->
        <rect x="${u0}" y="${v0}" width="${fw}" height="10" fill="#ffffff" opacity="0.8"/>
        <text x="${cx}" y="${v0 + 32}" font-family="sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle">${face.name} ▲</text>
        <!-- Center letter -->
        <text x="${cx}" y="${cy + 30}" font-family="sans-serif" font-size="120" font-weight="900" fill="#ffffff" text-anchor="middle">${face.label}</text>
      </g>
    `;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#0f172a"/>
    <!-- Grid lines -->
    <defs>
      <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
        <path d="M 64 0 L 0 0 0 64" fill="none" stroke="#1e293b" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#grid)" />
    <text x="50" y="${h - 40}" font-family="monospace" font-size="24" fill="#64748b">TopEye Mock Box Atlas (F/B/L/R/T)</text>
    ${rects}
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

let cachedMockAtlasUrl: string | null = null;

export function getMockAtlasImageUrl(): string {
  if (!cachedMockAtlasUrl) {
    cachedMockAtlasUrl = generateMockAtlasSvg();
  }
  return cachedMockAtlasUrl;
}

/**
 * Generate mock BoxAtlas metadata mapping each box in the frame to the mock atlas texture faces.
 */
export function getMockBoxAtlas(_frameId: string, boxes: Box3D[]): BoxAtlas {
  const boxAtlasEntries: BoxAtlas['boxes'] = {};

  for (const box of boxes) {
    boxAtlasEntries[box.id] = {
      faces: {
        front: { uv: MOCK_FACE_REGIONS.front.uv, cam: 'CAM_FRONT', seen: true, src_frame: _frameId, src_dt: 0 },
        back:  { uv: MOCK_FACE_REGIONS.back.uv, cam: 'CAM_BACK', seen: true, src_frame: 'scene-0061_000012', src_dt: 2 },
        left:  { uv: MOCK_FACE_REGIONS.left.uv, cam: 'CAM_BACK_LEFT', seen: true, src_frame: 'scene-0061_000006', src_dt: -4 },
        right: { uv: MOCK_FACE_REGIONS.right.uv, cam: 'CAM_FRONT_RIGHT', seen: false },
        top:   { uv: MOCK_FACE_REGIONS.top.uv, cam: 'CAM_FRONT', seen: false },
      },
    };
  }

  return {
    atlas_w: MOCK_ATLAS_WIDTH,
    atlas_h: MOCK_ATLAS_HEIGHT,
    ground_z: MOCK_GROUND_Z,
    boxes: boxAtlasEntries,
  };
}
