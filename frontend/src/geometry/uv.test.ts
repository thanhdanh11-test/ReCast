import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  faceUVs,
  getFaceCornersInBox,
  getFaceOutwardNormal,
  THREE_BOX_CORNER_ORDER,
} from './uv';
import { BoxAtlasEntry } from '../api/types';

describe('UV mapping and Face Convention (SPEC-P05 §2)', () => {
  it('SPEC-P05 §2: normals for all 5 faces point outward', () => {
    // front (+x) -> normal should be (+x, 0, 0)
    const nFront = getFaceOutwardNormal('front', 4, 2, 1.5);
    expect(nFront[0]).toBeGreaterThan(0);
    expect(Math.abs(nFront[1])).toBeCloseTo(0);
    expect(Math.abs(nFront[2])).toBeCloseTo(0);

    // back (-x) -> normal should be (-x, 0, 0)
    const nBack = getFaceOutwardNormal('back', 4, 2, 1.5);
    expect(nBack[0]).toBeLessThan(0);
    expect(Math.abs(nBack[1])).toBeCloseTo(0);
    expect(Math.abs(nBack[2])).toBeCloseTo(0);

    // left (+y) -> normal should be (0, +y, 0)
    const nLeft = getFaceOutwardNormal('left', 4, 2, 1.5);
    expect(Math.abs(nLeft[0])).toBeCloseTo(0);
    expect(nLeft[1]).toBeGreaterThan(0);
    expect(Math.abs(nLeft[2])).toBeCloseTo(0);

    // right (-y) -> normal should be (0, -y, 0)
    const nRight = getFaceOutwardNormal('right', 4, 2, 1.5);
    expect(Math.abs(nRight[0])).toBeCloseTo(0);
    expect(nRight[1]).toBeLessThan(0);
    expect(Math.abs(nRight[2])).toBeCloseTo(0);

    // top (+z) -> normal should be (0, 0, +z)
    const nTop = getFaceOutwardNormal('top', 4, 2, 1.5);
    expect(Math.abs(nTop[0])).toBeCloseTo(0);
    expect(Math.abs(nTop[1])).toBeCloseTo(0);
    expect(nTop[2]).toBeGreaterThan(0);
  });

  it('SPEC-P05 §2: top face corners match explicit spec definition', () => {
    // Spec §2 example top: c0=(-l/2,+w/2,+h/2), c1=(-l/2,-w/2,+h/2), c2=(+l/2,-w/2,+h/2), c3=(+l/2,+w/2,+h/2)
    const [c0, c1, c2, c3] = getFaceCornersInBox('top', 4, 2, 1.6);
    expect(c0).toEqual([-2, 1, 0.8]);
    expect(c1).toEqual([-2, -1, 0.8]);
    expect(c2).toEqual([2, -1, 0.8]);
    expect(c3).toEqual([2, 1, 0.8]);
  });

  it('SPEC-P05 §2: front face corners match explicit spec definition', () => {
    // Spec §2 example front: c0=(+l/2,-w/2,-h/2), c1=(+l/2,+w/2,-h/2), c2=(+l/2,+w/2,+h/2), c3=(+l/2,-w/2,+h/2)
    const [c0, c1, c2, c3] = getFaceCornersInBox('front', 4, 2, 1.6);
    expect(c0).toEqual([2, -1, -0.8]);
    expect(c1).toEqual([2, 1, -0.8]);
    expect(c2).toEqual([2, 1, 0.8]);
    expect(c3).toEqual([2, -1, 0.8]);
  });

  it('faceUVs maps atlas pixel rectangles to BoxGeometry vertex UV array (48 floats)', () => {
    const atlasW = 2048;
    const atlasH = 1536;

    const entry: BoxAtlasEntry = {
      faces: {
        front: { uv: [100, 200, 300, 400], seen: true }, // w=200, h=200
        back: { uv: [320, 200, 520, 400], seen: true },
        left: { uv: [540, 200, 740, 400], seen: true },
        right: { uv: [100, 420, 300, 620], seen: true },
        top: { uv: [320, 420, 520, 620], seen: false },
      },
    };

    const uvs = faceUVs(entry, atlasW, atlasH);
    expect(uvs).toBeInstanceOf(Float32Array);
    expect(uvs.length).toBe(48);

    // Test front face (indices 0..7)
    // u0=100 -> uMin = 100/2048
    // u1=300 -> uMax = 300/2048
    // v0=200 -> vTop = (1536-200)/1536 = 1336/1536
    // v1=400 -> vBottom = (1536-400)/1536 = 1136/1536
    const uMin = 100 / atlasW;
    const uMax = 300 / atlasW;
    const vBottom = (atlasH - 400) / atlasH;
    const vTop = (atlasH - 200) / atlasH;

    // Front: ['c2', 'c1', 'c3', 'c0']
    // v0 (c2: top-right) -> [uMax, vTop]
    expect(uvs[0]).toBeCloseTo(uMax);
    expect(uvs[1]).toBeCloseTo(vTop);

    // v1 (c1: bottom-right) -> [uMax, vBottom]
    expect(uvs[2]).toBeCloseTo(uMax);
    expect(uvs[3]).toBeCloseTo(vBottom);

    // v2 (c3: top-left) -> [uMin, vTop]
    expect(uvs[4]).toBeCloseTo(uMin);
    expect(uvs[5]).toBeCloseTo(vTop);

    // v3 (c0: bottom-left) -> [uMin, vBottom]
    expect(uvs[6]).toBeCloseTo(uMin);
    expect(uvs[7]).toBeCloseTo(vBottom);

    // Face 5 (bottom) should be all zeros
    for (let i = 40; i < 48; i++) {
      expect(uvs[i]).toBe(0);
    }
  });

  it('faceUVs applies seamlessly to THREE.BoxGeometry attribute', () => {
    const geom = new THREE.BoxGeometry(4.5, 2.0, 1.6);
    const entry: BoxAtlasEntry = {
      faces: {
        front: { uv: [0, 0, 256, 256], seen: true },
        back: { uv: [256, 0, 512, 256], seen: true },
        left: { uv: [0, 256, 256, 512], seen: true },
        right: { uv: [256, 256, 512, 512], seen: true },
        top: { uv: [512, 0, 768, 256], seen: true },
      },
    };

    const uvs = faceUVs(entry, 1024, 1024);
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const uvAttr = geom.getAttribute('uv');
    expect(uvAttr.count).toBe(24);
    expect(uvAttr.itemSize).toBe(2);
  });

  it('handles null, undefined, or missing faces gracefully', () => {
    const emptyUvs = faceUVs(null, 1024, 1024);
    expect(emptyUvs.length).toBe(48);
    expect(emptyUvs.every((val) => val === 0)).toBe(true);

    const partial = faceUVs({ faces: {} }, 1024, 1024);
    expect(partial.length).toBe(48);
    expect(partial.every((val) => val === 0)).toBe(true);
  });

  it('THREE_BOX_CORNER_ORDER defines exact 4-corner mapping for all 5 faces', () => {
    expect(THREE_BOX_CORNER_ORDER.front).toEqual(['c2', 'c1', 'c3', 'c0']);
    expect(THREE_BOX_CORNER_ORDER.back).toEqual(['c0', 'c3', 'c1', 'c2']);
    expect(THREE_BOX_CORNER_ORDER.left).toEqual(['c1', 'c0', 'c2', 'c3']);
    expect(THREE_BOX_CORNER_ORDER.right).toEqual(['c3', 'c2', 'c0', 'c1']);
    expect(THREE_BOX_CORNER_ORDER.top).toEqual(['c0', 'c3', 'c1', 'c2']);
  });
});
