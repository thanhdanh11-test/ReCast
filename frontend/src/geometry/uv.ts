import { BoxAtlasEntry, FaceEntry, FaceName } from '../api/types';

/**
 * 4 corners for each face in local box coordinates per SPEC-P05 §2:
 * Coordinate system: x front (l), y left (w), z up (h). Origin at center.
 * Counter-clockwise order when viewed from outside:
 * c0 = bottom-left, c1 = bottom-right, c2 = top-right, c3 = top-left.
 * Texture: row 0 of image is edge c3-c2.
 */
export function getFaceCornersInBox(
  face: FaceName,
  l: number,
  w: number,
  h: number
): [[number, number, number], [number, number, number], [number, number, number], [number, number, number]] {
  const hl = l / 2;
  const hw = w / 2;
  const hh = h / 2;

  switch (face) {
    case 'front': // +x
      return [
        [+hl, -hw, -hh], // c0: bottom-left (right side of vehicle)
        [+hl, +hw, -hh], // c1: bottom-right (left side of vehicle)
        [+hl, +hw, +hh], // c2: top-right
        [+hl, -hw, +hh], // c3: top-left
      ];
    case 'back': // -x
      return [
        [-hl, +hw, -hh], // c0: bottom-left (left side of vehicle)
        [-hl, -hw, -hh], // c1: bottom-right (right side of vehicle)
        [-hl, -hw, +hh], // c2: top-right
        [-hl, +hw, +hh], // c3: top-left
      ];
    case 'left': // +y
      return [
        [+hl, +hw, -hh], // c0: bottom-left (front of vehicle)
        [-hl, +hw, -hh], // c1: bottom-right (back of vehicle)
        [-hl, +hw, +hh], // c2: top-right
        [+hl, +hw, +hh], // c3: top-left
      ];
    case 'right': // -y
      return [
        [-hl, -hw, -hh], // c0: bottom-left (back of vehicle)
        [+hl, -hw, -hh], // c1: bottom-right (front of vehicle)
        [+hl, -hw, +hh], // c2: top-right
        [-hl, -hw, +hh], // c3: top-left
      ];
    case 'top': // +z
      return [
        [-hl, +hw, +hh], // c0: bottom-left (back-left)
        [-hl, -hw, +hh], // c1: bottom-right (back-right)
        [+hl, -hw, +hh], // c2: top-right (front-right)
        [+hl, +hw, +hh], // c3: top-left (front-left)
      ];
  }
}

/**
 * Compute cross product of two 3D vectors: a x b
 */
export function crossProduct(
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Check outward normal of face: (c1 - c0) x (c3 - c0)
 * per SPEC-P05 §2: must point outward for all 5 faces.
 */
export function getFaceOutwardNormal(
  face: FaceName,
  l: number = 1,
  w: number = 1,
  h: number = 1
): [number, number, number] {
  const [c0, c1, , c3] = getFaceCornersInBox(face, l, w, h);
  const v1: [number, number, number] = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
  const v3: [number, number, number] = [c3[0] - c0[0], c3[1] - c0[1], c3[2] - c0[2]];
  return crossProduct(v1, v3);
}

export type CornerName = 'c0' | 'c1' | 'c2' | 'c3';

/**
 * Mapping between Three.js BoxGeometry vertices for each face and SPEC-P05 §2 corners.
 *
 * In Three.js BoxGeometry(l, w, h):
 * Face 0 (+X front): v0 (+w/2, +h/2) = c2, v1 (+w/2, -h/2) = c1, v2 (-w/2, +h/2) = c3, v3 (-w/2, -h/2) = c0
 * Face 1 (-X back):  v0 (+w/2, -h/2) = c0, v1 (+w/2, +h/2) = c3, v2 (-w/2, -h/2) = c1, v3 (-w/2, +h/2) = c2
 * Face 2 (+Y left):  v0 (-l/2, -h/2) = c1, v1 (+l/2, -h/2) = c0, v2 (-l/2, +h/2) = c2, v3 (+l/2, +h/2) = c3
 * Face 3 (-Y right): v0 (-l/2, +h/2) = c3, v1 (+l/2, +h/2) = c2, v2 (-l/2, -h/2) = c0, v3 (+l/2, -h/2) = c1
 * Face 4 (+Z top):   v0 (+w/2, +h/2) = c0, v1 (+l/2, +w/2) = c3, v2 (-w/2, -h/2) = c1, v3 (+l/2, -w/2) = c2
 * Face 5 (-Z bottom): untextured (zeros)
 */
export const THREE_BOX_CORNER_ORDER: Record<
  'front' | 'back' | 'left' | 'right' | 'top',
  [CornerName, CornerName, CornerName, CornerName]
> = {
  front: ['c2', 'c1', 'c3', 'c0'],
  back: ['c0', 'c3', 'c1', 'c2'],
  left: ['c1', 'c0', 'c2', 'c3'],
  right: ['c3', 'c2', 'c0', 'c1'],
  top: ['c0', 'c3', 'c1', 'c2'],
};

/**
 * Pure function mapping face atlas entries to Three.js BoxGeometry UV attributes.
 *
 * @param entry BoxAtlasEntry or face dictionary with face UVs
 * @param atlasW Width of the atlas image in pixels
 * @param atlasH Height of the atlas image in pixels
 * @returns Float32Array of 48 numbers (24 vertices * 2 UV coordinates)
 */
export function faceUVs(
  entry: BoxAtlasEntry | Partial<Record<FaceName, FaceEntry>> | null | undefined,
  atlasW: number,
  atlasH: number
): Float32Array {
  const result = new Float32Array(48); // 6 faces * 4 vertices * 2 coords
  if (!entry || atlasW <= 0 || atlasH <= 0) {
    return result;
  }

  // Extract faces object
  const faces: Partial<Record<FaceName, FaceEntry>> =
    'faces' in entry && entry.faces ? entry.faces : (entry as Partial<Record<FaceName, FaceEntry>>);

  const faceNames: FaceName[] = ['front', 'back', 'left', 'right', 'top'];

  for (let f = 0; f < faceNames.length; f++) {
    const faceName = faceNames[f];
    const faceData = faces[faceName];
    if (!faceData || !faceData.uv || faceData.uv.length < 4) {
      continue;
    }

    const [u0, v0, u1, v1] = faceData.uv;

    // Normalized UV coordinates in WebGL standard (V=0 is bottom, V=1 is top):
    const uMin = u0 / atlasW;
    const uMax = u1 / atlasW;
    const vBottom = (atlasH - v1) / atlasH;
    const vTop = (atlasH - v0) / atlasH;

    // Corner UVs:
    // c0 = bottom-left, c1 = bottom-right, c2 = top-right, c3 = top-left
    const cornerUVs: Record<CornerName, [number, number]> = {
      c0: [uMin, vBottom],
      c1: [uMax, vBottom],
      c2: [uMax, vTop],
      c3: [uMin, vTop],
    };

    const vertexCorners = THREE_BOX_CORNER_ORDER[faceName];
    const baseOffset = f * 8; // 4 vertices * 2 coords per face

    for (let v = 0; v < 4; v++) {
      const corner = vertexCorners[v];
      const [u, vCoord] = cornerUVs[corner];
      result[baseOffset + v * 2 + 0] = u;
      result[baseOffset + v * 2 + 1] = vCoord;
    }
  }

  // Face 5 is bottom face: remains all 0s in result

  return result;
}
