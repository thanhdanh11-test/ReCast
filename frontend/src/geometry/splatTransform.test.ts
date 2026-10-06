import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  matrix4FromRowMajor,
  invertPose,
  invertPoseToArray,
  transformPoint,
  applyPoseInverseToObject,
} from './splatTransform';
import { generateMockSplatPly, getMockPose } from '../api/mockSplat';
import { PlyParser } from '@mkkellogg/gaussian-splats-3d';

describe('Splat Pose Inversion & Transformation (SPEC-P07 §3 & §5)', () => {
  it('converts row-major 4x4 array to THREE.Matrix4 correctly', () => {
    const T = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [0, 0, 0, 1],
    ];
    const mat = matrix4FromRowMajor(T);
    const el = mat.elements; // column-major in Three.js
    expect(el[0]).toBe(1);
    expect(el[4]).toBe(2);
    expect(el[8]).toBe(3);
    expect(el[12]).toBe(4);
    expect(el[1]).toBe(5);
    expect(el[5]).toBe(6);
    expect(el[9]).toBe(7);
    expect(el[13]).toBe(8);
  });

  it('rejects invalid matrix shapes', () => {
    expect(() => matrix4FromRowMajor([])).toThrow();
    expect(() => matrix4FromRowMajor([[1, 2], [3, 4]] as unknown as number[][])).toThrow();
  });

  it('preserves point under identity T_world_lidar (P07 §5: scene_world -> LIDAR_TOP)', () => {
    const identity = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const invMat = invertPose(identity);
    const pWorld: [number, number, number] = [12.5, -8.3, 2.1];
    const pLidar = transformPoint(pWorld, invMat);

    expect(pLidar[0]).toBeCloseTo(12.5, 6);
    expect(pLidar[1]).toBeCloseTo(-8.3, 6);
    expect(pLidar[2]).toBeCloseTo(2.1, 6);
  });

  it('correctly shifts world points to LIDAR_TOP under pure translation', () => {
    // Ego vehicle is at world (10, 20, 0)
    const T_world_lidar = [
      [1, 0, 0, 10],
      [0, 1, 0, 20],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const invMat = invertPose(T_world_lidar);

    // A static landmark is at world (15, 35, 1.8)
    // Relative to vehicle at (10, 20, 0), it should be at (+5, +15, 1.8) in LIDAR_TOP
    const pWorld: [number, number, number] = [15, 35, 1.8];
    const pLidar = transformPoint(pWorld, invMat);

    expect(pLidar[0]).toBeCloseTo(5.0, 6);
    expect(pLidar[1]).toBeCloseTo(15.0, 6);
    expect(pLidar[2]).toBeCloseTo(1.8, 6);
  });

  it('correctly transforms world points to LIDAR_TOP under translation and yaw rotation', () => {
    // Ego vehicle at world (10, 20, 0), rotated 90 deg (pi/2) counter-clockwise
    // cos(pi/2) = 0, sin(pi/2) = 1
    const theta = Math.PI / 2;
    const T_world_lidar = [
      [Math.cos(theta), -Math.sin(theta), 0, 10],
      [Math.sin(theta),  Math.cos(theta), 0, 20],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];

    const invMat = invertPose(T_world_lidar);

    // If point in LIDAR_TOP is (4, 7, -1)
    // Then point in world is:
    // x_w = 10 + 4*0 - 7*1 = 3
    // y_w = 20 + 4*1 + 7*0 = 24
    // z_w = -1
    const pWorld: [number, number, number] = [3, 24, -1];
    const pLidar = transformPoint(pWorld, invMat);

    expect(pLidar[0]).toBeCloseTo(4.0, 5);
    expect(pLidar[1]).toBeCloseTo(7.0, 5);
    expect(pLidar[2]).toBeCloseTo(-1.0, 5);
  });

  it('guarantees round-trip invariant: inverse(T_world_lidar) * (T_world_lidar * P_lidar) === P_lidar', () => {
    // Test across mock poses
    for (let frameIdx = 0; frameIdx < 10; frameIdx++) {
      const frameId = `scene-0061_${String(frameIdx).padStart(6, '0')}`;
      const { T_world_lidar } = getMockPose(frameId);

      const pLidarOriginal: [number, number, number] = [3.2, -14.7, 1.25];

      // Convert LIDAR -> world
      const pWorld = transformPoint(pLidarOriginal, T_world_lidar);

      // Convert world -> LIDAR via inverse
      const invMat = invertPose(T_world_lidar);
      const pLidarReconstructed = transformPoint(pWorld, invMat);

      expect(pLidarReconstructed[0]).toBeCloseTo(pLidarOriginal[0], 5);
      expect(pLidarReconstructed[1]).toBeCloseTo(pLidarOriginal[1], 5);
      expect(pLidarReconstructed[2]).toBeCloseTo(pLidarOriginal[2], 5);
    }
  });

  it('invertPoseToArray returns matching 4x4 array', () => {
    const { T_world_lidar } = getMockPose('scene-0061_000003');
    const invArr = invertPoseToArray(T_world_lidar);
    const invMat = invertPose(T_world_lidar);

    const testP: [number, number, number] = [5, 10, 0];
    const res1 = transformPoint(testP, invArr);
    const res2 = transformPoint(testP, invMat);

    expect(res1[0]).toBeCloseTo(res2[0], 5);
    expect(res1[1]).toBeCloseTo(res2[1], 5);
    expect(res1[2]).toBeCloseTo(res2[2], 5);
  });

  it('applyPoseInverseToObject updates THREE.Object3D world matrix correctly', () => {
    const group = new THREE.Group();
    const { T_world_lidar } = getMockPose('scene-0061_000002');

    applyPoseInverseToObject(group, T_world_lidar);

    const invMat = invertPose(T_world_lidar);
    const pWorld = new THREE.Vector3(10, 25, 0);

    // Apply object's transform to pWorld
    const pObject = pWorld.clone().applyMatrix4(group.matrixWorld);
    const expected = pWorld.clone().applyMatrix4(invMat);

    expect(pObject.x).toBeCloseTo(expected.x, 5);
    expect(pObject.y).toBeCloseTo(expected.y, 5);
    expect(pObject.z).toBeCloseTo(expected.z, 5);
  });

  it('validates mock Gaussian Splat PLY buffer with PlyParser from @mkkellogg/gaussian-splats-3d', () => {
    const plyBuffer = generateMockSplatPly(250);
    expect(plyBuffer.byteLength).toBeGreaterThan(1000);

    const parsed = PlyParser.parseToUncompressedSplatBuffer(plyBuffer);
    expect(parsed.splatCount).toBe(250);
  });
});
