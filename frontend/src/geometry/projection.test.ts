import { describe, it, expect } from 'vitest';
import {
  projectBoxToCamera,
  computeBoxCorners,
  transformPointToCam,
  projectCamToPixel,
  CameraCalib,
  Box3D,
} from './projection';

describe('projection pure functions (SPEC-P02 §2)', () => {
  const calib: CameraCalib = {
    name: 'CAM_FRONT',
    K: [
      [1000, 0, 800],
      [0, 1000, 450],
      [0, 0, 1],
    ],
    // Transform LiDAR (x right, y front, z up) -> Cam (x right, y down, z forward)
    T_lidar_cam: [
      [1, 0, 0, 0],
      [0, 0, -1, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 1],
    ],
    width: 1600,
    height: 900,
  };

  it('projects 3D box with known K and T to exact pixel coordinates', () => {
    const box: Box3D = {
      cx: 0,
      cy: 10,
      cz: 0,
      l: 2,
      w: 2,
      h: 2,
      yaw: 0,
      label: 'car',
    };

    const corners = computeBoxCorners(box);
    expect(corners.length).toBe(8);

    // Corner 6: dx=1, dy=1, dz=1 -> [1, 11, 1] in LiDAR
    const c6 = corners[6];
    expect(c6).toEqual([1, 11, 1]);

    const c6Cam = transformPointToCam(c6, calib.T_lidar_cam);
    expect(c6Cam).toEqual([1, -1, 11]);

    const p6 = projectCamToPixel(c6Cam, calib.K);
    expect(p6).not.toBeNull();
    // u = 1000 * (1/11) + 800 = 890.909...
    // v = 1000 * (-1/11) + 450 = 359.0909...
    expect(p6!.u).toBeCloseTo(1000 * (1 / 11) + 800, 4);
    expect(p6!.v).toBeCloseTo(1000 * (-1 / 11) + 450, 4);

    // Project all edges
    const edges = projectBoxToCamera(box, calib);
    // All 12 edges are in front of camera (y=9..11, z_cam > 0.1) and inside 1600x900
    expect(edges.length).toBe(12);

    // Find the edge between 6 and 7 (top front edge)
    const topFrontEdge = edges.find(
      (e) =>
        (e.originalIndices[0] === 6 && e.originalIndices[1] === 7) ||
        (e.originalIndices[0] === 7 && e.originalIndices[1] === 6)
    );
    expect(topFrontEdge).toBeDefined();
    expect(topFrontEdge!.p1.u).toBeCloseTo(1000 * (1 / 11) + 800, 2);
    expect(topFrontEdge!.p2.u).toBeCloseTo(1000 * (-1 / 11) + 800, 2);
    expect(topFrontEdge!.p1.v).toBeCloseTo(1000 * (-1 / 11) + 450, 2);
    expect(topFrontEdge!.p2.v).toBeCloseTo(1000 * (-1 / 11) + 450, 2);
  });

  it('discards edges where any vertex has z_cam <= 0.1', () => {
    // Box straddling the z_cam = 0.1 boundary:
    // cy = 0.5, w = 2 -> dy in [-1, 1] -> y in [-0.5, 1.5]
    // Under T_lidar_cam: z_cam = y, so vertices with dy = -1 have z_cam = -0.5 <= 0.1!
    // Vertices with dy = +1 have z_cam = 1.5 > 0.1.
    const straddlingBox: Box3D = {
      cx: 0,
      cy: 0.5,
      cz: 0,
      l: 2,
      w: 2,
      h: 2,
      yaw: 0,
      label: 'car',
    };

    const edges = projectBoxToCamera(straddlingBox, calib);

    // Edges with dy = -1 vertices (indices 0, 1, 4, 5) must be discarded.
    // Edges connecting dy = -1 and dy = +1 must also be discarded.
    // Only edges with BOTH vertices having dy = +1 can survive:
    // Namely: [2, 3] (bottom back) and [6, 7] (top back).
    expect(edges.length).toBe(2);

    for (const edge of edges) {
      const [i1, i2] = edge.originalIndices;
      expect([2, 3, 6, 7]).toContain(i1);
      expect([2, 3, 6, 7]).toContain(i2);
    }
  });

  it('discards all edges when entire box is behind camera (z_cam <= 0.1)', () => {
    const behindBox: Box3D = {
      cx: 0,
      cy: -10,
      cz: 0,
      l: 2,
      w: 2,
      h: 2,
      yaw: 0,
      label: 'car',
    };

    const edges = projectBoxToCamera(behindBox, calib);
    expect(edges.length).toBe(0);
  });
});
