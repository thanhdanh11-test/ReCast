import * as THREE from 'three';

/**
 * Convert a 4x4 row-major number[][] matrix to THREE.Matrix4.
 * Three.js Matrix4.set takes parameters in row-major order:
 * set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44)
 */
export function matrix4FromRowMajor(T: number[][]): THREE.Matrix4 {
  if (!Array.isArray(T) || T.length !== 4) {
    throw new Error('Invalid matrix: must have 4 rows');
  }
  for (let r = 0; r < 4; r++) {
    if (!Array.isArray(T[r]) || T[r].length !== 4) {
      throw new Error(`Invalid matrix: row ${r} must have 4 columns`);
    }
  }

  const mat = new THREE.Matrix4();
  mat.set(
    T[0][0], T[0][1], T[0][2], T[0][3],
    T[1][0], T[1][1], T[1][2], T[1][3],
    T[2][0], T[2][1], T[2][2], T[2][3],
    T[3][0], T[3][1], T[3][2], T[3][3]
  );
  return mat;
}

/**
 * Invert a 4x4 T_world_lidar matrix.
 * Returns the THREE.Matrix4 inverse: (T_world_lidar)^(-1).
 * Maps points from scene_world coordinate system back to LIDAR_TOP frame.
 */
export function invertPose(T_world_lidar: number[][]): THREE.Matrix4 {
  const mat = matrix4FromRowMajor(T_world_lidar);
  return mat.invert();
}

/**
 * Invert a 4x4 T_world_lidar matrix and return as row-major number[][].
 */
export function invertPoseToArray(T_world_lidar: number[][]): number[][] {
  const inv = invertPose(T_world_lidar);
  const el = inv.elements;
  // Three.js elements are stored column-major:
  // el[0]=m00, el[1]=m10, el[2]=m20, el[3]=m30
  // el[4]=m01, el[5]=m11, el[6]=m21, el[7]=m31
  // el[8]=m02, el[9]=m12, el[10]=m22, el[11]=m32
  // el[12]=m03, el[13]=m13, el[14]=m23, el[15]=m33
  return [
    [el[0], el[4], el[8], el[12]],
    [el[1], el[5], el[9], el[13]],
    [el[2], el[6], el[10], el[14]],
    [el[3], el[7], el[11], el[15]],
  ];
}

/**
 * Transform a 3D point [x, y, z] using a 4x4 matrix (number[][] or THREE.Matrix4).
 */
export function transformPoint(
  p: [number, number, number],
  T: number[][] | THREE.Matrix4
): [number, number, number] {
  const mat = T instanceof THREE.Matrix4 ? T : matrix4FromRowMajor(T);
  const vec = new THREE.Vector3(p[0], p[1], p[2]);
  vec.applyMatrix4(mat);
  return [vec.x, vec.y, vec.z];
}

/**
 * Apply inverse(T_world_lidar) transformation to a THREE.Object3D (such as Splat group/mesh).
 * Decomposes the inverse matrix into position, quaternion, scale and updates matrixWorld.
 */
export function applyPoseInverseToObject(
  object: THREE.Object3D,
  T_world_lidar: number[][]
): void {
  const inv = invertPose(T_world_lidar);
  inv.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrixWorld(true);
}
