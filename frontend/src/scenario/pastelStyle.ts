import * as THREE from "three";

const palette = new Map([
  [0xe7e7e7, 0xe9e7e0], [0x626262, 0x929299], [0xcdcdcd, 0xf1f0e9],
  [0xdadada, 0xe8e4d7], [0x999999, 0x9b9f88], [0xbebebe, 0xc4cfa9],
  [0xb8b8b8, 0x8a949c], [0x7d8288, 0xa7b4bd], [0x777777, 0xbac1b2],
  [0xf7f7f7, 0xf9f8f2], [0xfafafa, 0xf9f8f2],
]);

export function pastelColor(color: number): number {
  return palette.get(color) ?? color;
}

/** More depth precision at map scale, without clipping the cabin or nearby vehicles. */
export function updateMapCameraDepth(camera: THREE.PerspectiveCamera, target: THREE.Vector3, cabin: boolean) {
  const near = cabin ? 0.1 : Math.max(0.1, Math.min(25, camera.position.distanceTo(target) / 50));
  if (camera.near !== near) {
    camera.near = near;
    camera.updateProjectionMatrix();
  }
}
