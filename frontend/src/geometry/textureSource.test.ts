import { describe, it, expect } from 'vitest';
import { formatTextureSource } from './textureSource';
import { BoxAtlasEntry } from '../api/types';

describe('formatTextureSource (SPEC-P06 §4 & H17 §3.4)', () => {
  it('formats texture source according to SPEC-P06 §4 exact pattern with all 5 faces', () => {
    const entry: BoxAtlasEntry = {
      faces: {
        front: { uv: [32, 32, 288, 288], cam: 'CAM_FRONT', seen: true, src_frame: 'scene-0061_000000', src_dt: 0 },
        left: { uv: [608, 32, 864, 288], cam: 'CAM_BACK_LEFT', seen: true, src_frame: 'scene-0061_000006', src_dt: -4 },
        right: { uv: [32, 320, 288, 576], cam: 'CAM_FRONT_RIGHT', seen: false },
        back: { uv: [320, 32, 576, 288], cam: 'CAM_BACK', seen: true, src_frame: 'scene-0061_000012', src_dt: 2 },
        top: { uv: [320, 320, 576, 576], cam: 'CAM_FRONT', seen: false },
      },
    };

    const formatted = formatTextureSource(entry);
    // SPEC-P06 §4: "F: CAM_FRONT @t0 · L: CAM_BACK_LEFT @−4 · R: — · B: …"
    expect(formatted).toBe('F: CAM_FRONT @t0 · L: CAM_BACK_LEFT @−4 · R: — · B: CAM_BACK @+2 · T: —');
  });

  it('displays @t0 when src_frame or src_dt is missing (H17 §3.4)', () => {
    const entry: BoxAtlasEntry = {
      faces: {
        front: { uv: [32, 32, 288, 288], cam: 'CAM_FRONT', seen: true },
        left: { uv: [608, 32, 864, 288], cam: 'CAM_LEFT', seen: true },
      },
    };

    const formatted = formatTextureSource(entry);
    expect(formatted).toContain('F: CAM_FRONT @t0');
    expect(formatted).toContain('L: CAM_LEFT @t0');
  });

  it('displays — for seen: false faces (SPEC-P06 §4)', () => {
    const entry: BoxAtlasEntry = {
      faces: {
        front: { uv: [32, 32, 288, 288], cam: 'CAM_FRONT', seen: false },
        left: { uv: [608, 32, 864, 288], cam: 'CAM_LEFT', seen: false },
        right: { uv: [32, 320, 288, 576], cam: 'CAM_RIGHT', seen: false },
        back: { uv: [320, 32, 576, 288], cam: 'CAM_BACK', seen: false },
        top: { uv: [320, 320, 576, 576], cam: 'CAM_TOP', seen: false },
      },
    };

    const formatted = formatTextureSource(entry);
    expect(formatted).toBe('F: — · L: — · R: — · B: — · T: —');
  });

  it('handles null, undefined, or missing faces safely', () => {
    expect(formatTextureSource(null)).toBe('F: — · L: — · R: — · B: — · T: —');
    expect(formatTextureSource(undefined)).toBe('F: — · L: — · R: — · B: — · T: —');
    expect(formatTextureSource({ faces: {} })).toBe('F: — · L: — · R: — · B: — · T: —');
  });
});
