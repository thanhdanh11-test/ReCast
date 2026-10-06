import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

describe('A3 OrthographicCamera & 10m Metric Scale Ratio (SPEC-P06 §3 & H17 §3.1)', () => {
  const containerW = 600;
  const containerH = 400;
  const aspect = containerW / containerH; // 1.5
  const distance = 45; // default distance

  function setupOrthoCamera(yawDeg: number = 0, dist: number = distance) {
    const halfH = dist * Math.tan((25 * Math.PI) / 180);
    const halfW = halfH * aspect;

    const orthoCam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000);
    const yRad = (yawDeg * Math.PI) / 180;

    orthoCam.position.set(0, 0, dist);
    orthoCam.up.set(Math.sin(yRad), Math.cos(yRad), 0);
    orthoCam.lookAt(0, 0, 0);
    orthoCam.updateProjectionMatrix();
    orthoCam.updateMatrixWorld(true);

    const worldHeight = 2 * halfH;
    const metersPerPixel = worldHeight / containerH;

    return { orthoCam, halfH, halfW, worldHeight, metersPerPixel };
  }

  function projectToScreen(point: THREE.Vector3, camera: THREE.Camera) {
    const clone = point.clone();
    clone.project(camera);
    // Normalized Device Coordinates (-1 to 1) -> Screen pixels (0 to W, 0 to H)
    const screenX = ((clone.x + 1) * containerW) / 2;
    const screenY = ((-clone.y + 1) * containerH) / 2;
    return { x: screenX, y: screenY };
  }

  it('orients +y (front of vehicle) straight UP on screen when yaw = 0', () => {
    const { orthoCam } = setupOrthoCamera(0);

    const center = projectToScreen(new THREE.Vector3(0, 0, 0), orthoCam);
    const front10m = projectToScreen(new THREE.Vector3(0, 10, 0), orthoCam);

    // X should remain unchanged
    expect(Math.abs(front10m.x - center.x)).toBeLessThan(1e-4);
    // In screen coordinates, top of screen has smaller Y. So front (larger Y in world) has smaller screen Y
    expect(front10m.y).toBeLessThan(center.y);
  });

  it('verifies 10m scale ratio: two points 10m apart have exactly 10 / (metersPerPixel) pixels, error <= 1 px', () => {
    const { orthoCam, metersPerPixel } = setupOrthoCamera(0);

    // Two points 10m apart along Y axis
    const p1 = new THREE.Vector3(0, -5, 0);
    const p2 = new THREE.Vector3(0, 5, 0);

    const s1 = projectToScreen(p1, orthoCam);
    const s2 = projectToScreen(p2, orthoCam);

    const measuredPixelDist = Math.hypot(s2.x - s1.x, s2.y - s1.y);
    const expectedPixels = 10 / metersPerPixel;

    // Spec acceptance: sai <= 1 px
    const error = Math.abs(measuredPixelDist - expectedPixels);
    expect(error).toBeLessThanOrEqual(1.0);
    expect(error).toBeLessThan(1e-4); // Mathematically exact
  });

  it('verifies 10m scale ratio along X axis: two points 10m apart have exactly 10 / (metersPerPixel) pixels, error <= 1 px', () => {
    const { orthoCam, metersPerPixel } = setupOrthoCamera(0);

    // Two points 10m apart along X axis
    const p1 = new THREE.Vector3(-5, 0, 0);
    const p2 = new THREE.Vector3(5, 0, 0);

    const s1 = projectToScreen(p1, orthoCam);
    const s2 = projectToScreen(p2, orthoCam);

    const measuredPixelDist = Math.hypot(s2.x - s1.x, s2.y - s1.y);
    const expectedPixels = 10 / metersPerPixel;

    const error = Math.abs(measuredPixelDist - expectedPixels);
    expect(error).toBeLessThanOrEqual(1.0);
    expect(error).toBeLessThan(1e-4);
  });

  it('preserves 10m scale ratio and accuracy across different zoom distances', () => {
    // Test multiple zoom levels: dist = 20m, 45m, 80m
    for (const dist of [20, 45, 80]) {
      const { orthoCam, metersPerPixel } = setupOrthoCamera(0, dist);

      const p1 = new THREE.Vector3(2, 4, 0);
      const p2 = new THREE.Vector3(2, 14, 0); // 10m apart

      const s1 = projectToScreen(p1, orthoCam);
      const s2 = projectToScreen(p2, orthoCam);

      const measuredDist = Math.hypot(s2.x - s1.x, s2.y - s1.y);
      const expectedPixels = 10 / metersPerPixel;

      expect(Math.abs(measuredDist - expectedPixels)).toBeLessThan(1e-4);
    }
  });

  it('preserves 10m distance under yaw rotations without distortion', () => {
    for (const yaw of [30, 45, 90, 180]) {
      const { orthoCam, metersPerPixel } = setupOrthoCamera(yaw);

      const p1 = new THREE.Vector3(0, 0, 0);
      const p2 = new THREE.Vector3(6, 8, 0); // distance = sqrt(6^2 + 8^2) = 10m

      const s1 = projectToScreen(p1, orthoCam);
      const s2 = projectToScreen(p2, orthoCam);

      const measuredDist = Math.hypot(s2.x - s1.x, s2.y - s1.y);
      const expectedPixels = 10 / metersPerPixel;

      expect(Math.abs(measuredDist - expectedPixels)).toBeLessThan(1e-4);
    }
  });
});
