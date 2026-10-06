import { describe, it, expect } from 'vitest';
import {
  panoAzimuth,
  panoElevation,
  panoDirection,
  panoPoint,
  panoUV,
  isEdgeDepthDiscontinuous,
  shouldDropTriangle,
  parseDepthBuffer,
  generateRoomBoxDepth,
  buildSurroundSphereGeometry,
  buildBackgroundSphereGeometry,
} from './panorama';
import { PanoMeta } from '../api/types';

describe('SPEC-P09 §1: Panorama Conventions (Azimuth, Elevation, Direction & 3D Points)', () => {
  const W = 4096;
  const H = 2048;

  it('SPEC-P09 §1: center of image u = W/2 points to +y (forward)', () => {
    const uCenter = W / 2;
    const phi = panoAzimuth(uCenter, W);
    // At center, phi is close to 0 (within half a pixel: pi / W rad ≈ 0.000767 rad)
    expect(Math.abs(phi)).toBeLessThan(2 * Math.PI / W);

    const dir = panoDirection(phi, 0);
    expect(dir[0]).toBeCloseTo(0, 2); // dx = sin(phi) ~ 0
    expect(dir[1]).toBeCloseTo(1, 2); // dy = cos(phi) ~ 1 (+y)
    expect(dir[2]).toBeCloseTo(0, 2); // dz = sin(0) = 0
  });

  it('SPEC-P09 §1: u = 3W/4 points to +x (right)', () => {
    const uRight = (3 * W) / 4;
    const phi = panoAzimuth(uRight, W);
    expect(phi).toBeCloseTo(Math.PI / 2, 2);

    const dir = panoDirection(phi, 0);
    expect(dir[0]).toBeCloseTo(1, 2); // dx ~ 1 (+x)
    expect(dir[1]).toBeCloseTo(0, 2); // dy ~ 0
    expect(dir[2]).toBeCloseTo(0, 2); // dz ~ 0
  });

  it('SPEC-P09 §1: u = W/4 points to -x (left)', () => {
    const uLeft = W / 4;
    const phi = panoAzimuth(uLeft, W);
    expect(phi).toBeCloseTo(-Math.PI / 2, 2);

    const dir = panoDirection(phi, 0);
    expect(dir[0]).toBeCloseTo(-1, 2); // dx ~ -1 (-x)
    expect(dir[1]).toBeCloseTo(0, 2);
    expect(dir[2]).toBeCloseTo(0, 2);
  });

  it('SPEC-P09 §1: u = 0 and u = W-1 point to -y (back)', () => {
    const phiLeftEdge = panoAzimuth(0, W);
    const dirLeft = panoDirection(phiLeftEdge, 0);
    expect(dirLeft[1]).toBeCloseTo(-1, 2); // dy ~ -1 (-y)

    const phiRightEdge = panoAzimuth(W - 1, W);
    const dirRight = panoDirection(phiRightEdge, 0);
    expect(dirRight[1]).toBeCloseTo(-1, 2); // dy ~ -1 (-y)
  });

  it('SPEC-P09 §1: v = H/2 lies on the horizon (theta = 0)', () => {
    const vHorizon = H / 2;
    const theta = panoElevation(vHorizon, H);
    expect(Math.abs(theta)).toBeLessThan(Math.PI / H);

    const dir = panoDirection(0, theta);
    expect(dir[2]).toBeCloseTo(0, 2); // dz ~ 0
  });

  it('SPEC-P09 §1: v = 0 points straight up (+z, zenith)', () => {
    const thetaZenith = panoElevation(0, H);
    expect(thetaZenith).toBeCloseTo(Math.PI / 2, 2);

    const dir = panoDirection(0, thetaZenith);
    expect(dir[2]).toBeCloseTo(1, 2); // dz ~ 1 (+z)
  });

  it('SPEC-P09 §1: v = H - 1 points straight down (-z, nadir)', () => {
    const thetaNadir = panoElevation(H - 1, H);
    expect(thetaNadir).toBeCloseTo(-Math.PI / 2, 2);

    const dir = panoDirection(0, thetaNadir);
    expect(dir[2]).toBeCloseTo(-1, 2); // dz ~ -1 (-z)
  });

  it('SPEC-P09 §1: 3D point P = C + D(phi, theta) * d', () => {
    const center: [number, number, number] = [1.5, -2.0, 0.5];
    const depth = 10.0;
    // Ray pointing forward (+y): phi = 0, theta = 0
    const pForward = panoPoint(center, depth, 0, 0);
    expect(pForward[0]).toBeCloseTo(1.5, 3);
    expect(pForward[1]).toBeCloseTo(8.0, 3); // -2.0 + 10.0 = 8.0
    expect(pForward[2]).toBeCloseTo(0.5, 3);

    // Ray pointing right (+x): phi = Math.PI / 2, theta = 0
    const pRight = panoPoint(center, depth, Math.PI / 2, 0);
    expect(pRight[0]).toBeCloseTo(11.5, 3); // 1.5 + 10.0 = 11.5
    expect(pRight[1]).toBeCloseTo(-2.0, 3);
    expect(pRight[2]).toBeCloseTo(0.5, 3);
  });

  it('SPEC-P09 §1 & §3: UV mapping formulas', () => {
    const [u0, v0] = panoUV(-Math.PI, -Math.PI / 2);
    expect(u0).toBeCloseTo(0, 4);
    expect(v0).toBeCloseTo(0, 4);

    const [uCenter, vCenter] = panoUV(0, 0);
    expect(uCenter).toBeCloseTo(0.5, 4);
    expect(vCenter).toBeCloseTo(0.5, 4);

    const [uMax, vMax] = panoUV(Math.PI, Math.PI / 2);
    expect(uMax).toBeCloseTo(1.0, 4);
    expect(vMax).toBeCloseTo(1.0, 4);
  });
});

describe('SPEC-P09 §3: Depth Discontinuity and Triangle Dropping', () => {
  it('keeps edges with depth difference <= 2.0 m even if ratio > 20%', () => {
    // Diff is 1.5m <= 2.0m, though 1.5 / 2.0 = 75% > 20%
    expect(isEdgeDepthDiscontinuous(2.0, 3.5)).toBe(false);
  });

  it('keeps edges with depth difference > 2.0 m if ratio <= 20%', () => {
    // Diff is 3.0m > 2.0m, but 3.0 / 25.0 = 12% <= 20%
    expect(isEdgeDepthDiscontinuous(25.0, 28.0)).toBe(false);
  });

  it('marks edge discontinuous when depth diff > 2.0 m AND ratio > 20%', () => {
    // Diff is 4.0m > 2.0m, and 4.0 / 5.0 = 80% > 20%
    expect(isEdgeDepthDiscontinuous(5.0, 9.0)).toBe(true);
  });

  it('shouldDropTriangle drops triangle if ANY of the three edges is discontinuous', () => {
    // Triangle with smooth edges
    expect(shouldDropTriangle(10.0, 11.0, 10.5)).toBe(false);

    // Discontinuity on edge (d0, d1): 5m vs 12m (diff 7m > 2m, ratio 140% > 20%)
    expect(shouldDropTriangle(5.0, 12.0, 11.8)).toBe(true);

    // Discontinuity on edge (d1, d2): 10m vs 25m
    expect(shouldDropTriangle(10.0, 10.2, 25.0)).toBe(true);

    // Discontinuity on edge (d2, d0): 4m vs 15m
    expect(shouldDropTriangle(4.0, 4.2, 15.0)).toBe(true);
  });
});

describe('SPEC-P09 §2 & §3: Depth Buffer Parsing & Sphere Mesh Construction', () => {
  it('parseDepthBuffer parses uint16 mm little-endian DataView into float32 meters', () => {
    const width = 4;
    const height = 2;
    const buffer = new ArrayBuffer(width * height * 2);
    const view = new DataView(buffer);

    // Test specific depths in mm
    view.setUint16(0, 10000, true); // 10.0 m
    view.setUint16(2, 500, true);   // 0.5 m
    view.setUint16(4, 25400, true); // 25.4 m
    view.setUint16(6, 60000, true); // 60.0 m
    view.setUint16(8, 1234, true);  // 1.234 m
    view.setUint16(10, 5000, true); // 5.0 m
    view.setUint16(12, 15000, true);// 15.0 m
    view.setUint16(14, 2000, true); // 2.0 m

    const depths = parseDepthBuffer(buffer, width, height, 0.001);
    expect(depths.length).toBe(8);
    expect(depths[0]).toBeCloseTo(10.0, 3);
    expect(depths[1]).toBeCloseTo(0.5, 3);
    expect(depths[2]).toBeCloseTo(25.4, 3);
    expect(depths[3]).toBeCloseTo(60.0, 3);
    expect(depths[4]).toBeCloseTo(1.234, 3);
  });

  it('parseDepthBuffer throws on truncated buffer', () => {
    const buffer = new ArrayBuffer(10);
    expect(() => parseDepthBuffer(buffer, 1024, 512, 0.001)).toThrow();
  });

  it('generateRoomBoxDepth generates 10m room box with exact distances in cardinal directions', () => {
    const w = 64;
    const h = 32;
    const depths = generateRoomBoxDepth(w, h, 10.0, [0, 0, 0]);

    // Center u = w / 2, horizon v = h / 2 (+y direction)
    const forwardIdx = Math.floor(h / 2) * w + Math.floor(w / 2);
    expect(depths[forwardIdx]).toBeCloseTo(10.0, 1);

    // Right u = 3w / 4, horizon v = h / 2 (+x direction)
    const rightIdx = Math.floor(h / 2) * w + Math.floor((3 * w) / 4);
    expect(depths[rightIdx]).toBeCloseTo(10.0, 1);

    // Left u = w / 4, horizon v = h / 2 (-x direction)
    const leftIdx = Math.floor(h / 2) * w + Math.floor(w / 4);
    expect(depths[leftIdx]).toBeCloseTo(10.0, 1);
  });

  it('buildSurroundSphereGeometry builds 256x128 spherical mesh and drops discontinuous triangles', () => {
    const meta: PanoMeta = {
      center: [0, 0, 0],
      width: 4096,
      height: 2048,
      depth_width: 64,
      depth_height: 32,
      depth_unit_m: 0.001,
      max_depth_m: 60.0,
    };

    // Create depth map with a sharp step discontinuity in one region
    const depths = new Float32Array(meta.depth_width * meta.depth_height);
    depths.fill(10.0);
    // Introduce a step to 30.0m in half the map (diff 20m > 2m and 200% > 20%)
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 32; c++) {
        depths[r * meta.depth_width + c] = 35.0;
      }
    }

    const mesh = buildSurroundSphereGeometry(meta, depths, 32, 16);
    expect(mesh.positions.length).toBe((32 + 1) * (16 + 1) * 3);
    expect(mesh.uvs.length).toBe((32 + 1) * (16 + 1) * 2);
    expect(mesh.droppedTriangles).toBeGreaterThan(0);
    expect(mesh.indices.length).toBeLessThan(mesh.totalTriangles * 3);
  });

  it('SPEC-P09 §5 (F1): buildBackgroundSphereGeometry builds complete sphere with radius max_depth_m and no dropped triangles', () => {
    const meta: PanoMeta = {
      center: [1.2, -0.5, 0.8],
      width: 4096,
      height: 2048,
      depth_width: 1024,
      depth_height: 512,
      depth_unit_m: 0.001,
      max_depth_m: 60.0,
    };

    const bgMesh = buildBackgroundSphereGeometry(meta, 60.0, 32, 16);
    expect(bgMesh.droppedTriangles).toBe(0);
    expect(bgMesh.totalTriangles).toBe(32 * 16 * 2);
    expect(bgMesh.indices.length).toBe(bgMesh.totalTriangles * 3);

    const numVerts = (32 + 1) * (16 + 1);
    expect(bgMesh.positions.length).toBe(numVerts * 3);

    // Verify all vertices are placed exactly at distance max_depth_m (60.0m) from center
    for (let i = 0; i < numVerts; i++) {
      const dx = bgMesh.positions[i * 3 + 0] - meta.center[0];
      const dy = bgMesh.positions[i * 3 + 1] - meta.center[1];
      const dz = bgMesh.positions[i * 3 + 2] - meta.center[2];
      const dist = Math.hypot(dx, dy, dz);
      expect(dist).toBeCloseTo(60.0, 2);
      expect(bgMesh.vertexDepths[i]).toBeCloseTo(60.0, 2);
    }
  });
});
