import {
  SceneSummary,
  SceneMeta,
  CameraCalib,
  Box3D,
  ApiError,
  BoxAtlas,
  ObjectsDenseMeta,
  ObjectsDenseData,
  FramePose,
  PanoMeta,
  PanoData,
} from './types';
import {
  mockScenes,
  mockMeta,
  mockCalibs,
  getMockBoxes,
  generateMockPoints,
  getMockBevImageUrl,
  getMockCameraImageUrl,
  MOCK_SCENE_ID,
} from './mock';
import {
  getMockBoxAtlas,
  getMockAtlasImageUrl,
} from './mockAtlas';
import {
  getMockObjectsDense,
} from './mockDense';
import {
  getMockPose,
  getMockSplatBlobUrl,
  generateMockSplatPly,
} from './mockSplat';
import {
  getMockPanoMeta,
  getMockPanoRgbUrl,
  getMockPanoAlphaUrl,
  getMockPanoDepthBuffer,
} from './mockPano';

export const isMockEnabled = (): boolean => {
  return (
    import.meta.env.VITE_MOCK === '1' ||
    import.meta.env.VITE_MOCK === 'true' ||
    // Default to true in standalone preview if backend is not present
    (typeof window !== 'undefined' && window.location.search.includes('mock=1'))
  );
};

export const isMockNoBev = (): boolean => {
  return (
    import.meta.env.VITE_MOCK_NO_BEV === '1' ||
    import.meta.env.VITE_MOCK_NO_BEV === 'true' ||
    (typeof window !== 'undefined' &&
      (window.location.search.includes('no_bev=1') ||
        window.location.search.includes('mock_no_bev=1')))
  );
};

export const isMockNoAtlas = (): boolean => {
  return (
    import.meta.env.VITE_MOCK_NO_ATLAS === '1' ||
    import.meta.env.VITE_MOCK_NO_ATLAS === 'true' ||
    (typeof window !== 'undefined' &&
      (window.location.search.includes('no_atlas=1') ||
        window.location.search.includes('mock_no_atlas=1')))
  );
};

export const isMockNoDense = (): boolean => {
  return (
    import.meta.env.VITE_MOCK_NO_DENSE === '1' ||
    import.meta.env.VITE_MOCK_NO_DENSE === 'true' ||
    (typeof window !== 'undefined' &&
      (window.location.search.includes('no_dense=1') ||
        window.location.search.includes('mock_no_dense=1')))
  );
};

export const isMockNoSplat = (): boolean => {
  return (
    import.meta.env.VITE_MOCK_NO_SPLAT === '1' ||
    import.meta.env.VITE_MOCK_NO_SPLAT === 'true' ||
    (typeof window !== 'undefined' &&
      (window.location.search.includes('no_splat=1') ||
        window.location.search.includes('mock_no_splat=1')))
  );
};

export const isMockNoPano = (): boolean => {
  return (
    import.meta.env.VITE_MOCK_NO_PANO === '1' ||
    import.meta.env.VITE_MOCK_NO_PANO === 'true' ||
    (typeof window !== 'undefined' &&
      (window.location.search.includes('no_pano=1') ||
        window.location.search.includes('mock_no_pano=1')))
  );
};

/**
 * Validate and parse LiDAR points buffer.
 * Points are float32 (N, 7) little-endian: [x, y, z, intensity, r, g, b].
 * Each point requires 7 channels * 4 bytes/float = 28 bytes.
 */
export function validatePointsBuffer(arrayBuffer: ArrayBufferLike): Float32Array {
  if (arrayBuffer.byteLength % 28 !== 0) {
    throw new Error(
      `Invalid points buffer byteLength (${arrayBuffer.byteLength}): must be a multiple of 28 bytes (7 float32 channels per point: x, y, z, intensity, r, g, b)`
    );
  }
  return new Float32Array(arrayBuffer as ArrayBuffer);
}

/**
 * Validate and parse objects_dense binary buffer and verify against metadata.
 * Points are float32 (N, 7) little-endian: [x, y, z, intensity, r, g, b].
 * Each point requires 7 channels * 4 bytes/float = 28 bytes.
 * Total count in objects_dense.json must match binary row count.
 */
export function validateDensePointsBuffer(
  arrayBuffer: ArrayBufferLike,
  meta?: ObjectsDenseMeta
): Float32Array {
  if (arrayBuffer.byteLength % 28 !== 0) {
    throw new Error(
      `Invalid objects_dense.bin byteLength (${arrayBuffer.byteLength}): must be a multiple of 28 bytes (7 float32 channels per point: x, y, z, intensity, r, g, b)`
    );
  }
  const points = new Float32Array(arrayBuffer as ArrayBuffer);
  const numRows = points.length / 7;

  if (meta && Array.isArray(meta.objects)) {
    const totalCount = meta.objects.reduce((sum, obj) => sum + (obj.count || 0), 0);
    if (totalCount !== numRows) {
      throw new Error(
        `Total count in objects_dense.json (${totalCount}) does not match binary row count (${numRows})`
      );
    }
  }

  return points;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP error ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.detail) msg = errJson.detail;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

/**
 * Validate that a box conforms to contract:
 * id is a required non-empty string.
 * Client rejects box missing id and MUST NEVER generate an id.
 */
export function validateBox(box: unknown, index?: number): Box3D {
  const prefix = index !== undefined ? `Box at index ${index}` : 'Box';
  if (!box || typeof box !== 'object') {
    throw new Error(`${prefix} is invalid: expected an object`);
  }
  const b = box as Record<string, unknown>;
  if (typeof b.id !== 'string' || b.id.trim() === '') {
    const received =
      b.id === undefined
        ? 'undefined'
        : typeof b.id === 'string'
        ? 'empty string'
        : `${typeof b.id} (${JSON.stringify(b.id)})`;
    throw new Error(
      `Client rejected box: missing required string 'id' (received ${received})`
    );
  }
  return box as Box3D;
}

/**
 * Validate an array of boxes from mock or API.
 */
export function validateBoxes(boxes: unknown): Box3D[] {
  if (!Array.isArray(boxes)) {
    throw new Error('Invalid boxes response: expected an array');
  }
  return boxes.map((box, idx) => validateBox(box, idx));
}

export const api = {
  async getScenes(): Promise<SceneSummary[]> {
    if (isMockEnabled()) {
      return mockScenes;
    }
    const res = await fetch('/api/scenes');
    return handleResponse<SceneSummary[]>(res);
  },

  async getSceneMeta(scene: string): Promise<SceneMeta> {
    if (isMockEnabled()) {
      if (scene === 'scene-0103') {
        throw new ApiError(
          425,
          `Cache not ready (425). Run: topeye-prepare --scene ${scene}`
        );
      }
      if (scene !== MOCK_SCENE_ID) {
        throw new ApiError(404, `Scene '${scene}' not found (404)`);
      }
      return mockMeta;
    }
    const res = await fetch(`/api/scenes/${scene}/meta`);
    return handleResponse<SceneMeta>(res);
  },

  async getFramePoints(scene: string, frameId: string): Promise<Float32Array> {
    if (isMockEnabled()) {
      const match = frameId.match(/_(\d+)$/);
      const frameIdx = match ? parseInt(match[1], 10) : 0;
      const points = generateMockPoints(frameIdx);
      return validatePointsBuffer(points.buffer);
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/points`);
    if (!res.ok) {
      throw new ApiError(res.status, `Points for frame ${frameId} failed: ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return validatePointsBuffer(arrayBuffer);
  },

  async getFrameBevUrl(scene: string, frameId: string): Promise<string> {
    if (isMockEnabled()) {
      if (isMockNoBev()) {
        throw new ApiError(404, `BEV image for frame ${frameId} not found (404: VITE_MOCK_NO_BEV active)`);
      }
      return getMockBevImageUrl();
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/bev.png`);
    if (!res.ok) {
      throw new ApiError(res.status, `BEV for frame ${frameId} failed: ${res.status}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  async getFrameCameraImageUrl(
    scene: string,
    frameId: string,
    cam: string
  ): Promise<string> {
    if (isMockEnabled()) {
      return getMockCameraImageUrl(cam, frameId);
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/cams/${cam}.jpg`);
    if (!res.ok) {
      throw new ApiError(res.status, `Camera ${cam} for frame ${frameId} failed: ${res.status}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  async getFrameCalib(
    scene: string,
    frameId: string
  ): Promise<Record<string, CameraCalib>> {
    if (isMockEnabled()) {
      return mockCalibs;
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/calib`);
    return handleResponse<Record<string, CameraCalib>>(res);
  },

  async getFrameBoxes(
    scene: string,
    frameId: string,
    source: 'gt' | 'db' = 'gt'
  ): Promise<Box3D[]> {
    if (isMockEnabled()) {
      const match = frameId.match(/_(\d+)$/);
      const frameIdx = match ? parseInt(match[1], 10) : 0;
      return validateBoxes(getMockBoxes(frameIdx));
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/boxes?source=${source}`);
    const data = await handleResponse<unknown>(res);
    return validateBoxes(data);
  },

  async getFrameBoxAtlas(
    scene: string,
    frameId: string
  ): Promise<BoxAtlas> {
    if (isMockEnabled()) {
      if (isMockNoAtlas()) {
        throw new ApiError(404, `Box atlas for frame ${frameId} not found (404: mock no atlas)`);
      }
      const match = frameId.match(/_(\d+)$/);
      const frameIdx = match ? parseInt(match[1], 10) : 0;
      const boxes = validateBoxes(getMockBoxes(frameIdx));
      return getMockBoxAtlas(frameId, boxes);
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/box_atlas.json`);
    return handleResponse<BoxAtlas>(res);
  },

  async getFrameBoxAtlasImageUrl(
    scene: string,
    frameId: string
  ): Promise<string> {
    if (isMockEnabled()) {
      if (isMockNoAtlas()) {
        throw new ApiError(404, `Box atlas image for frame ${frameId} not found (404: mock no atlas)`);
      }
      return getMockAtlasImageUrl();
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/box_atlas.png`);
    if (!res.ok) {
      throw new ApiError(res.status, `Box atlas image for frame ${frameId} failed: ${res.status}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  async getFrameObjectsDense(
    scene: string,
    frameId: string
  ): Promise<ObjectsDenseData> {
    if (isMockEnabled()) {
      if (isMockNoDense()) {
        throw new ApiError(404, `Objects dense for frame ${frameId} not found (404: mock no dense)`);
      }
      const match = frameId.match(/_(\d+)$/);
      const frameIdx = match ? parseInt(match[1], 10) : 0;
      const boxes = validateBoxes(getMockBoxes(frameIdx));
      const dense = getMockObjectsDense(boxes);
      validateDensePointsBuffer(dense.points.buffer, dense.meta);
      return dense;
    }
    const [metaRes, binRes] = await Promise.all([
      fetch(`/api/scenes/${scene}/frames/${frameId}/objects_dense.json`),
      fetch(`/api/scenes/${scene}/frames/${frameId}/objects_dense.bin`),
    ]);
    if (metaRes.status === 404 || binRes.status === 404) {
      throw new ApiError(404, `Objects dense for frame ${frameId} not found (404)`);
    }
    const meta = await handleResponse<ObjectsDenseMeta>(metaRes);
    if (!binRes.ok) {
      throw new ApiError(binRes.status, `Objects dense binary for frame ${frameId} failed: ${binRes.status}`);
    }
    const arrayBuffer = await binRes.arrayBuffer();
    const points = validateDensePointsBuffer(arrayBuffer, meta);
    return { meta, points };
  },

  async getFramePose(scene: string, frameId: string): Promise<FramePose> {
    if (isMockEnabled()) {
      if (isMockNoSplat()) {
        throw new ApiError(404, `Pose for frame ${frameId} not found (404: mock no splat)`);
      }
      return getMockPose(frameId);
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/pose`);
    return handleResponse<FramePose>(res);
  },

  async getSceneSplatUrl(scene: string): Promise<string> {
    if (isMockEnabled()) {
      if (isMockNoSplat()) {
        throw new ApiError(404, `Splat for scene ${scene} not found (404: mock no splat)`);
      }
      return getMockSplatBlobUrl();
    }
    const res = await fetch(`/api/scenes/${scene}/splat.ply`);
    if (!res.ok) {
      throw new ApiError(res.status, `Splat for scene ${scene} failed: ${res.status}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  async getSceneSplatBuffer(scene: string): Promise<ArrayBuffer> {
    if (isMockEnabled()) {
      if (isMockNoSplat()) {
        throw new ApiError(404, `Splat buffer for scene ${scene} not found (404: mock no splat)`);
      }
      return generateMockSplatPly(1000);
    }
    const res = await fetch(`/api/scenes/${scene}/splat.ply`);
    if (!res.ok) {
      throw new ApiError(res.status, `Splat for scene ${scene} failed: ${res.status}`);
    }
    return res.arrayBuffer();
  },

  async getFramePanoMeta(scene: string, frameId: string): Promise<PanoMeta> {
    if (isMockEnabled()) {
      if (isMockNoPano()) {
        throw new ApiError(404, `Panorama metadata for frame ${frameId} not found (404: mock no pano)`);
      }
      return getMockPanoMeta();
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/pano.json`);
    return handleResponse<PanoMeta>(res);
  },

  async getFramePanoRgbUrl(scene: string, frameId: string): Promise<string> {
    if (isMockEnabled()) {
      if (isMockNoPano()) {
        throw new ApiError(404, `Panorama RGB for frame ${frameId} not found (404: mock no pano)`);
      }
      return getMockPanoRgbUrl();
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/pano_rgb.jpg`);
    if (!res.ok) {
      throw new ApiError(res.status, `Panorama RGB for frame ${frameId} failed: ${res.status}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  async getFramePanoAlphaUrl(scene: string, frameId: string): Promise<string> {
    if (isMockEnabled()) {
      if (isMockNoPano()) {
        throw new ApiError(404, `Panorama alpha for frame ${frameId} not found (404: mock no pano)`);
      }
      return getMockPanoAlphaUrl();
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/pano_alpha.png`);
    if (!res.ok) {
      throw new ApiError(res.status, `Panorama alpha for frame ${frameId} failed: ${res.status}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  async getFramePanoDepth(scene: string, frameId: string): Promise<ArrayBuffer> {
    if (isMockEnabled()) {
      if (isMockNoPano()) {
        throw new ApiError(404, `Panorama depth for frame ${frameId} not found (404: mock no pano)`);
      }
      return getMockPanoDepthBuffer();
    }
    const res = await fetch(`/api/scenes/${scene}/frames/${frameId}/pano_depth.bin`);
    if (!res.ok) {
      throw new ApiError(res.status, `Panorama depth for frame ${frameId} failed: ${res.status}`);
    }
    return res.arrayBuffer();
  },

  async getFramePanoData(scene: string, frameId: string): Promise<PanoData> {
    const [meta, depthBuffer, rgbUrl, alphaUrl] = await Promise.all([
      this.getFramePanoMeta(scene, frameId),
      this.getFramePanoDepth(scene, frameId),
      this.getFramePanoRgbUrl(scene, frameId),
      this.getFramePanoAlphaUrl(scene, frameId),
    ]);
    return { meta, depthBuffer, rgbUrl, alphaUrl };
  },
};

