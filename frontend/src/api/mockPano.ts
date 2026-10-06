import { PanoMeta } from './types';
import { generateRoomBoxDepth } from '../geometry/panorama';

export const MOCK_PANO_WIDTH = 4096;
export const MOCK_PANO_HEIGHT = 2048;
export const MOCK_DEPTH_WIDTH = 1024;
export const MOCK_DEPTH_HEIGHT = 512;
export const MOCK_ROOM_EXTENT_M = 10.0;

export function getMockPanoMeta(): PanoMeta {
  return {
    center: [0, 0, 0],
    width: MOCK_PANO_WIDTH,
    height: MOCK_PANO_HEIGHT,
    depth_width: MOCK_DEPTH_WIDTH,
    depth_height: MOCK_DEPTH_HEIGHT,
    depth_unit_m: 0.001,
    max_depth_m: 60.0,
  };
}

/**
 * Generate synthetic depth buffer for a 10m room box.
 * Returns ArrayBuffer containing uint16 little-endian mm values (Hd x Wd = 512 x 1024).
 */
export function generateMockPanoDepthBuffer(
  width = MOCK_DEPTH_WIDTH,
  height = MOCK_DEPTH_HEIGHT,
  roomExtentM = MOCK_ROOM_EXTENT_M
): ArrayBuffer {
  const depths = generateRoomBoxDepth(width, height, roomExtentM, [0, 0, 0]);
  const buffer = new ArrayBuffer(width * height * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < depths.length; i++) {
    const depthMm = Math.round(depths[i] * 1000);
    // uint16 clamp [0, 65535]
    const clamped = Math.max(0, Math.min(65535, depthMm));
    view.setUint16(i * 2, clamped, true); // little-endian
  }

  return buffer;
}

/**
 * Generate SVG image data URI for mock synthetic panorama (W x H) with:
 * - Equirectangular grid pattern (lat/lon lines)
 * - Distinct colored directional labels F / R / B / L matching SPEC-P09 §1:
 *   - F (Front, +y) at center u = W/2 (φ = 0)
 *   - R (Right, +x) at u = 3W/4 (φ = +π/2)
 *   - B (Back, -y) at u = 0 & u = W (φ = ±π)
 *   - L (Left, -x) at u = W/4 (φ = -π/2)
 * - Clear horizon line at v = H/2 (θ = 0)
 */
export function generateMockPanoRgbSvg(): string {
  const w = 2048;
  const h = 1024;
  const horizonY = h / 2;

  // Longitudinal lines (vertical) every 30 degrees (12 intervals)
  let vLines = '';
  for (let i = 0; i <= 12; i++) {
    const x = (i / 12) * w;
    const deg = (i / 12) * 360 - 180;
    vLines += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#334155" stroke-width="2"/>`;
    vLines += `<text x="${x + 6}" y="${horizonY - 12}" fill="#64748b" font-family="monospace" font-size="16">${deg > 0 ? `+${deg}` : deg}°</text>`;
  }

  // Latitudinal lines (horizontal) every 15 degrees (-90 to +90)
  let hLines = '';
  for (let j = 1; j < 12; j++) {
    const y = (j / 12) * h;
    const deg = 90 - (j / 12) * 180;
    const isHorizon = j === 6;
    hLines += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${isHorizon ? '#38bdf8' : '#1e293b'}" stroke-width="${isHorizon ? 4 : 1}" stroke-dasharray="${isHorizon ? 'none' : '4,4'}"/>`;
    hLines += `<text x="12" y="${y - 6}" fill="${isHorizon ? '#38bdf8' : '#64748b'}" font-family="monospace" font-size="16" font-weight="${isHorizon ? 'bold' : 'normal'}">${deg > 0 ? `+${deg}` : deg}° ${isHorizon ? '(HORIZON θ=0)' : ''}</text>`;
  }

  // Direction cards
  const cardW = 280;
  const cardH = 220;
  const cardY = horizonY - cardH / 2;

  const cards = [
    // Back (Left seam u=0)
    { cx: 0, label: 'B', name: 'BACK (-y)', color: '#3b82f6', phi: '-180°' },
    // Left (u = W/4)
    { cx: w / 4, label: 'L', name: 'LEFT (-x)', color: '#a855f7', phi: '-90°' },
    // Front (u = W/2)
    { cx: w / 2, label: 'F', name: 'FRONT (+y)', color: '#10b981', phi: '0°' },
    // Right (u = 3W/4)
    { cx: (3 * w) / 4, label: 'R', name: 'RIGHT (+x)', color: '#f59e0b', phi: '+90°' },
    // Back (Right seam u=W)
    { cx: w, label: 'B', name: 'BACK (-y)', color: '#3b82f6', phi: '+180°' },
  ];

  let cardSvg = '';
  for (const c of cards) {
    const x0 = c.cx - cardW / 2;
    cardSvg += `
      <g>
        <rect x="${x0}" y="${cardY}" width="${cardW}" height="${cardH}" fill="${c.color}" fill-opacity="0.9" rx="16" stroke="#ffffff" stroke-width="4"/>
        <text x="${c.cx}" y="${cardY + 95}" font-family="sans-serif" font-size="90" font-weight="900" fill="#ffffff" text-anchor="middle">${c.label}</text>
        <text x="${c.cx}" y="${cardY + 145}" font-family="sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">${c.name}</text>
        <text x="${c.cx}" y="${cardY + 180}" font-family="monospace" font-size="18" fill="rgba(255,255,255,0.85)" text-anchor="middle">φ = ${c.phi}</text>
      </g>
    `;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#090d16"/>
    ${vLines}
    ${hLines}
    ${cardSvg}
    <text x="${w / 2}" y="60" font-family="sans-serif" font-size="28" font-weight="bold" fill="#94a3b8" text-anchor="middle">▲ ZENITH (+z) θ = +90° ▲</text>
    <text x="${w / 2}" y="${h - 40}" font-family="sans-serif" font-size="28" font-weight="bold" fill="#94a3b8" text-anchor="middle">▼ NADIR (-z) θ = -90° ▼</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Generate SVG image data URI for mock alpha map (fully opaque white).
 */
export function generateMockPanoAlphaSvg(): string {
  const w = 1024;
  const h = 512;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#ffffff"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

let cachedMockRgbUrl: string | null = null;
let cachedMockAlphaUrl: string | null = null;
let cachedMockDepthBuffer: ArrayBuffer | null = null;

export function getMockPanoRgbUrl(): string {
  if (!cachedMockRgbUrl) {
    cachedMockRgbUrl = generateMockPanoRgbSvg();
  }
  return cachedMockRgbUrl;
}

export function getMockPanoAlphaUrl(): string {
  if (!cachedMockAlphaUrl) {
    cachedMockAlphaUrl = generateMockPanoAlphaSvg();
  }
  return cachedMockAlphaUrl;
}

export function getMockPanoDepthBuffer(): ArrayBuffer {
  if (!cachedMockDepthBuffer) {
    cachedMockDepthBuffer = generateMockPanoDepthBuffer();
  }
  return cachedMockDepthBuffer;
}
