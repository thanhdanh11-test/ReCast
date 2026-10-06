import { describe, it, expect } from 'vitest';
import { validatePointsBuffer, validateDensePointsBuffer, validateBox, validateBoxes, api } from './client';
import { getMockBoxes } from './mock';

describe('validatePointsBuffer', () => {
  it('accepts buffers with byteLength divisible by 28', () => {
    // 0 points: 0 bytes
    const buf0 = new ArrayBuffer(0);
    const p0 = validatePointsBuffer(buf0);
    expect(p0.length).toBe(0);

    // 1 point: 1 * 28 = 28 bytes (7 float32)
    const buf1 = new ArrayBuffer(28);
    const view1 = new Float32Array(buf1);
    view1[0] = 1.5; // x
    view1[1] = 2.5; // y
    view1[2] = 3.5; // z
    view1[3] = 100; // intensity
    view1[4] = 255; // r
    view1[5] = 128; // g
    view1[6] = 64;  // b

    const p1 = validatePointsBuffer(buf1);
    expect(p1.length).toBe(7);
    expect(p1[0]).toBe(1.5);
    expect(p1[4]).toBe(255);

    // 100 points: 100 * 28 = 2800 bytes
    const buf100 = new ArrayBuffer(2800);
    const p100 = validatePointsBuffer(buf100);
    expect(p100.length).toBe(700);
  });

  it('rejects buffers with byteLength not divisible by 28 and throws descriptive error', () => {
    // 27 bytes (1 byte short of 1 point)
    const buf27 = new ArrayBuffer(27);
    expect(() => validatePointsBuffer(buf27)).toThrowError(
      /Invalid points buffer byteLength \(27\): must be a multiple of 28 bytes/
    );

    // 29 bytes (1 byte too long)
    const buf29 = new ArrayBuffer(29);
    expect(() => validatePointsBuffer(buf29)).toThrowError(
      /Invalid points buffer byteLength \(29\): must be a multiple of 28 bytes/
    );

    // 32 bytes (8 float32s, e.g. wrong format)
    const buf32 = new ArrayBuffer(32);
    expect(() => validatePointsBuffer(buf32)).toThrowError(
      /Invalid points buffer byteLength \(32\): must be a multiple of 28 bytes/
    );
  });
});

describe('Box contract & validation (01-CONTRACTS §5)', () => {
  it('accepts valid box with non-empty string id', () => {
    const rawBox = {
      id: 'gt:scene-0061_000000_box01',
      source: 'gt',
      track_key: 'inst:car_01',
      label: 'vehicle.car',
      cx: 1.0,
      cy: 2.0,
      cz: 0.0,
      l: 4.5,
      w: 2.0,
      h: 1.6,
      yaw: 0.0,
      score: 1.0,
      version: null,
      attributes: {},
    };

    const validated = validateBox(rawBox);
    expect(validated.id).toBe('gt:scene-0061_000000_box01');
    expect(validated.track_key).toBe('inst:car_01');
  });

  it('rejects box missing id property and throws clear error without synthesizing id', () => {
    const boxWithoutId = {
      source: 'gt',
      track_key: 'inst:car_01',
      label: 'vehicle.car',
      cx: 1.0,
      cy: 2.0,
      cz: 0.0,
      l: 4.5,
      w: 2.0,
      h: 1.6,
      yaw: 0.0,
    };

    expect(() => validateBox(boxWithoutId)).toThrowError(
      /Client rejected box: missing required string 'id' \(received undefined\)/
    );
  });

  it('rejects box where id is null, empty string, or non-string', () => {
    expect(() => validateBox({ id: null, label: 'car' })).toThrowError(
      /missing required string 'id'/
    );
    expect(() => validateBox({ id: '', label: 'car' })).toThrowError(
      /missing required string 'id'/
    );
    expect(() => validateBox({ id: '   ', label: 'car' })).toThrowError(
      /missing required string 'id'/
    );
    expect(() => validateBox({ id: 123, label: 'car' })).toThrowError(
      /missing required string 'id' \(received number/
    );
    expect(() => validateBox({ id: true, label: 'car' })).toThrowError(
      /missing required string 'id'/
    );
  });

  it('rejects non-object or null boxes in validateBoxes', () => {
    expect(() => validateBoxes(null)).toThrowError(
      /Invalid boxes response: expected an array/
    );
    expect(() => validateBoxes([null])).toThrowError(
      /expected an object/
    );
  });

  it('validates array of boxes in validateBoxes and identifies failing index', () => {
    const list = [
      { id: 'gt:box_1', label: 'car' },
      { label: 'car_missing_id' },
    ];
    expect(() => validateBoxes(list)).toThrowError(
      /Client rejected box: missing required string 'id'/
    );
  });

  it('generates mock boxes conforming to new schema with gt:<id> and stable track_key across frames', () => {
    const frame0Boxes = getMockBoxes(0);
    const frame1Boxes = getMockBoxes(1);

    expect(frame0Boxes.length).toBe(5);
    expect(frame1Boxes.length).toBe(5);

    // All boxes pass validation
    expect(() => validateBoxes(frame0Boxes)).not.toThrow();
    expect(() => validateBoxes(frame1Boxes)).not.toThrow();

    for (let i = 0; i < frame0Boxes.length; i++) {
      const b0 = frame0Boxes[i];
      const b1 = frame1Boxes[i];

      // id starts with gt:
      expect(b0.id.startsWith('gt:')).toBe(true);
      expect(b1.id.startsWith('gt:')).toBe(true);

      // id is unique per frame
      expect(b0.id).not.toBe(b1.id);

      // track_key is stable for same object across frames
      expect(b0.track_key).toBe(b1.track_key);
      expect(b0.track_key).not.toBeNull();

      expect(b0.source).toBe('gt');
      expect(b0.score).toBe(1.0);
      expect(b0.version).toBeNull();
      expect(b0.attributes).toEqual({});
    }
  });

  it('api.getFrameBoxes validates and returns mock boxes in mock mode', async () => {
    (import.meta.env as Record<string, string>).VITE_MOCK = '1';
    const boxes = await api.getFrameBoxes('scene-0061', 'scene-0061_000000');
    expect(boxes.length).toBe(5);
    for (const b of boxes) {
      expect(typeof b.id).toBe('string');
      expect(b.id.startsWith('gt:')).toBe(true);
    }
  });

  it('api.getFrameBoxes rejects API response containing box without id', async () => {
    (import.meta.env as Record<string, string>).VITE_MOCK = '0';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => [{ label: 'vehicle.car', cx: 0, cy: 0, cz: 0, l: 2, w: 2, h: 2, yaw: 0 }],
    })) as unknown as typeof fetch;

    try {
      await expect(api.getFrameBoxes('scene-0061', 'scene-0061_000000')).rejects.toThrowError(
        /Client rejected box: missing required string 'id'/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('api.getFrameBoxAtlas and getFrameBoxAtlasImageUrl return mock atlas in mock mode', async () => {
    (import.meta.env as Record<string, string>).VITE_MOCK = '1';
    delete (import.meta.env as Record<string, string | undefined>).VITE_MOCK_NO_ATLAS;

    const atlas = await api.getFrameBoxAtlas('scene-0061', 'scene-0061_000000');
    expect(atlas.atlas_w).toBe(1024);
    expect(atlas.atlas_h).toBe(1024);
    expect(atlas.ground_z).toBe(-1.84);
    expect(Object.keys(atlas.boxes).length).toBe(5);

    const firstBoxId = Object.keys(atlas.boxes)[0];
    const faces = atlas.boxes[firstBoxId].faces;
    expect(faces.front?.uv).toEqual([32, 32, 288, 288]);
    expect(faces.top?.uv).toEqual([320, 320, 576, 576]);

    const imageUrl = await api.getFrameBoxAtlasImageUrl('scene-0061', 'scene-0061_000000');
    expect(imageUrl.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('api.getFrameBoxAtlas throws 404 when VITE_MOCK_NO_ATLAS is active', async () => {
    (import.meta.env as Record<string, string>).VITE_MOCK = '1';
    (import.meta.env as Record<string, string>).VITE_MOCK_NO_ATLAS = '1';

    try {
      await expect(api.getFrameBoxAtlas('scene-0061', 'scene-0061_000000')).rejects.toThrowError(
        /404/
      );
      await expect(api.getFrameBoxAtlasImageUrl('scene-0061', 'scene-0061_000000')).rejects.toThrowError(
        /404/
      );
    } finally {
      delete (import.meta.env as Record<string, string | undefined>).VITE_MOCK_NO_ATLAS;
    }
  });

  describe('objects_dense client and validation (SPEC-P06 §2 & H17 §3.2)', () => {
    it('accepts dense buffer with byteLength divisible by 28 and matching metadata count', () => {
      // 2 points = 56 bytes
      const buf56 = new ArrayBuffer(56);
      const points = validateDensePointsBuffer(buf56, {
        objects: [{ id: 'gt:obj1', track_key: 'inst:1', start: 0, count: 2, n_frames: 5, rigid: true }],
      });
      expect(points.length).toBe(14); // 2 * 7
    });

    it('rejects dense buffer with byteLength not divisible by 28', () => {
      const buf30 = new ArrayBuffer(30);
      expect(() => validateDensePointsBuffer(buf30)).toThrowError(
        /Invalid objects_dense\.bin byteLength \(30\): must be a multiple of 28 bytes/
      );
    });

    it('rejects dense buffer when metadata count does not match row count', () => {
      const buf56 = new ArrayBuffer(56); // 2 rows
      expect(() =>
        validateDensePointsBuffer(buf56, {
          objects: [{ id: 'gt:obj1', track_key: 'inst:1', start: 0, count: 5, n_frames: 5, rigid: true }],
        })
      ).toThrowError(
        /Total count in objects_dense\.json \(5\) does not match binary row count \(2\)/
      );
    });

    it('api.getFrameObjectsDense returns mock dense data with >= 3 objects and valid points in mock mode', async () => {
      (import.meta.env as Record<string, string>).VITE_MOCK = '1';
      delete (import.meta.env as Record<string, string | undefined>).VITE_MOCK_NO_DENSE;

      const dense = await api.getFrameObjectsDense('scene-0061', 'scene-0061_000000');
      expect(dense.meta.objects.length).toBeGreaterThanOrEqual(3);
      expect(dense.points.byteLength % 28).toBe(0);

      const totalCount = dense.meta.objects.reduce((sum, o) => sum + o.count, 0);
      expect(totalCount).toBe(dense.points.length / 7);

      // Verify points contain both RGB colored and grayscale points
      let hasRgb = false;
      let hasGray = false;
      for (let i = 0; i < dense.points.length / 7; i++) {
        const r = dense.points[i * 7 + 4];
        if (r >= 0) hasRgb = true;
        if (r < 0) hasGray = true;
      }
      expect(hasRgb).toBe(true);
      expect(hasGray).toBe(true);
    });

    it('api.getFrameObjectsDense throws 404 when VITE_MOCK_NO_DENSE is active', async () => {
      (import.meta.env as Record<string, string>).VITE_MOCK = '1';
      (import.meta.env as Record<string, string>).VITE_MOCK_NO_DENSE = '1';

      try {
        await expect(api.getFrameObjectsDense('scene-0061', 'scene-0061_000000')).rejects.toThrowError(
          /404/
        );
      } finally {
        delete (import.meta.env as Record<string, string | undefined>).VITE_MOCK_NO_DENSE;
      }
    });
  });

  describe('Gaussian Splat client and pose (SPEC-P07 §3 & H19)', () => {
    it('api.getFramePose returns valid 4x4 T_world_lidar matrix in mock mode', async () => {
      (import.meta.env as Record<string, string>).VITE_MOCK = '1';
      delete (import.meta.env as Record<string, string | undefined>).VITE_MOCK_NO_SPLAT;

      const pose = await api.getFramePose('scene-0061', 'scene-0061_000000');
      expect(pose).toBeDefined();
      expect(pose.T_world_lidar).toBeDefined();
      expect(pose.T_world_lidar.length).toBe(4);
      expect(pose.T_world_lidar[0].length).toBe(4);
      expect(pose.T_world_lidar[3]).toEqual([0, 0, 0, 1]);
    });

    it('api.getSceneSplatUrl and api.getSceneSplatBuffer return mock splat in mock mode', async () => {
      (import.meta.env as Record<string, string>).VITE_MOCK = '1';
      delete (import.meta.env as Record<string, string | undefined>).VITE_MOCK_NO_SPLAT;

      const url = await api.getSceneSplatUrl('scene-0061');
      expect(url).toBeDefined();
      expect(typeof url).toBe('string');

      const buffer = await api.getSceneSplatBuffer('scene-0061');
      expect(buffer).toBeDefined();
      expect(buffer.byteLength).toBeGreaterThan(1000);
      const textHeader = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 100)));
      expect(textHeader).toContain('ply');
      expect(textHeader).toContain('element vertex');
    });

    it('api.getFramePose, getSceneSplatUrl, getSceneSplatBuffer throw 404 when VITE_MOCK_NO_SPLAT is active', async () => {
      (import.meta.env as Record<string, string>).VITE_MOCK = '1';
      (import.meta.env as Record<string, string>).VITE_MOCK_NO_SPLAT = '1';

      try {
        await expect(api.getFramePose('scene-0061', 'scene-0061_000000')).rejects.toThrowError(
          /404/
        );
        await expect(api.getSceneSplatUrl('scene-0061')).rejects.toThrowError(
          /404/
        );
        await expect(api.getSceneSplatBuffer('scene-0061')).rejects.toThrowError(
          /404/
        );
      } finally {
        delete (import.meta.env as Record<string, string | undefined>).VITE_MOCK_NO_SPLAT;
      }
    });
  });

  describe('panorama client and 404 behavior (SPEC-P09 §2 & §3 & H23)', () => {
    it('api.getFramePanoData returns meta, depthBuffer, rgbUrl, alphaUrl in mock mode', async () => {
      (import.meta.env as Record<string, string>).VITE_MOCK = '1';
      delete (import.meta.env as Record<string, string | undefined>).VITE_MOCK_NO_PANO;

      const data = await api.getFramePanoData('scene-0061', 'scene-0061_000000');
      expect(data.meta).toBeDefined();
      expect(data.meta.width).toBe(4096);
      expect(data.meta.height).toBe(2048);
      expect(data.meta.depth_width).toBe(1024);
      expect(data.meta.depth_height).toBe(512);

      // Depth buffer should be 1024 * 512 * 2 bytes = 1,048,576 bytes
      expect(data.depthBuffer.byteLength).toBe(1024 * 512 * 2);

      // RGB and Alpha data URLs
      expect(data.rgbUrl.startsWith('data:image/svg+xml')).toBe(true);
      expect(data.alphaUrl.startsWith('data:image/svg+xml')).toBe(true);
    });

    it('api panorama methods throw 404 when VITE_MOCK_NO_PANO is active', async () => {
      (import.meta.env as Record<string, string>).VITE_MOCK = '1';
      (import.meta.env as Record<string, string>).VITE_MOCK_NO_PANO = '1';

      try {
        await expect(api.getFramePanoMeta('scene-0061', 'scene-0061_000000')).rejects.toThrowError(/404/);
        await expect(api.getFramePanoRgbUrl('scene-0061', 'scene-0061_000000')).rejects.toThrowError(/404/);
        await expect(api.getFramePanoAlphaUrl('scene-0061', 'scene-0061_000000')).rejects.toThrowError(/404/);
        await expect(api.getFramePanoDepth('scene-0061', 'scene-0061_000000')).rejects.toThrowError(/404/);
        await expect(api.getFramePanoData('scene-0061', 'scene-0061_000000')).rejects.toThrowError(/404/);
      } finally {
        delete (import.meta.env as Record<string, string | undefined>).VITE_MOCK_NO_PANO;
      }
    });
  });
});


