import { BoxAtlasEntry, FaceName } from '../api/types';

export const FACE_DISPLAY_ORDER: { key: FaceName; label: string }[] = [
  { key: 'front', label: 'F' },
  { key: 'left', label: 'L' },
  { key: 'right', label: 'R' },
  { key: 'back', label: 'B' },
  { key: 'top', label: 'T' },
];

/**
 * Format texture source string per SPEC-P06 §4:
 * Example: `F: CAM_FRONT @t0 · L: CAM_BACK_LEFT @−4 · R: — · B: CAM_BACK @+2 · T: —`
 * - When face.seen is false (or face missing): displays `—` (U+2014 em-dash)
 * - When face.src_dt is missing or 0: displays `@t0`
 * - When face.src_dt is negative: displays `@−${Math.abs(src_dt)}` (U+2212 minus sign)
 * - When face.src_dt is positive: displays `@+${src_dt}`
 */
export function formatTextureSource(entry?: BoxAtlasEntry | null): string {
  if (!entry || !entry.faces) {
    return 'F: — · L: — · R: — · B: — · T: —';
  }

  const parts = FACE_DISPLAY_ORDER.map(({ key, label }) => {
    const face = entry.faces[key];
    if (!face || !face.seen) {
      return `${label}: —`;
    }

    const cam = face.cam || 'CAM_UNKNOWN';
    let dtStr = '@t0';
    if (face.src_dt !== undefined && face.src_dt !== null && face.src_dt !== 0) {
      if (face.src_dt < 0) {
        dtStr = `@−${Math.abs(face.src_dt)}`;
      } else {
        dtStr = `@+${face.src_dt}`;
      }
    }

    return `${label}: ${cam} ${dtStr}`;
  });

  return parts.join(' · ');
}
