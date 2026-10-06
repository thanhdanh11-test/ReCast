import { describe, it, expect } from 'vitest';
import { pixelToMeters, metersToPixel, DEFAULT_BEV_CONFIG } from './coords';

describe('coords pixel <-> meters conversions (01-CONTRACTS §3)', () => {
  it('converts (600, 600) pixel to (0.05, -0.05) meters with default config', () => {
    const { x, y } = pixelToMeters(600, 600, DEFAULT_BEV_CONFIG);
    expect(x).toBeCloseTo(0.05, 5);
    expect(y).toBeCloseTo(-0.05, 5);
  });

  it('converts (0.05, -0.05) meters to (600, 600) pixel with default config', () => {
    const { u, v } = metersToPixel(0.05, -0.05, DEFAULT_BEV_CONFIG);
    expect(u).toBeCloseTo(600, 5);
    expect(v).toBeCloseTo(600, 5);
  });

  it('round-trip test for various meter points', () => {
    const testCases = [
      { x: 0, y: 0 },
      { x: 10, y: 25 },
      { x: -15, y: -20 },
      { x: 50, y: -45 },
    ];

    for (const tc of testCases) {
      const { u, v } = metersToPixel(tc.x, tc.y, DEFAULT_BEV_CONFIG);
      const back = pixelToMeters(u, v, DEFAULT_BEV_CONFIG);
      expect(back.x).toBeCloseTo(tc.x, 5);
      expect(back.y).toBeCloseTo(tc.y, 5);
    }
  });

  it('verifies +y is forward (up) and +x is right', () => {
    const origin = pixelToMeters(600, 600);
    const upPoint = pixelToMeters(600, 500); // smaller v = higher up in image
    const rightPoint = pixelToMeters(700, 600); // larger u = further right in image

    expect(upPoint.y).toBeGreaterThan(origin.y);
    expect(rightPoint.x).toBeGreaterThan(origin.x);
  });
});
