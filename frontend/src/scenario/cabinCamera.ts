import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Actor, Pose } from "./types";

/** Lightweight bonnet visible below the road in driver view; no change to actor geometry. */
export function createCabinHood(): THREE.Mesh {
  const vertices: number[] = [], indices: number[] = [];
  const rows = [
    [0.55, -0.62, 1.02],
    [1.0, -0.65, 0.99],
    [1.7, -0.78, 0.92],
    [2.2, -0.92, 0.83],
  ];
  for (const [distance, height, width] of rows) {
    for (const side of [-1, -0.75, 0, 0.75, 1])
      vertices.push(side * width, height + (1 - Math.abs(side)) * 0.055, -distance);
  }
  for (let row = 0; row < rows.length - 1; row++) {
    for (let col = 0; col < 4; col++) {
      const a = row * 5 + col, b = a + 5;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const hood = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xda291c, roughness: 0.42, metalness: 0.15, side: THREE.DoubleSide,
  }));
  hood.name = "cabin-hood";
  hood.visible = false;
  return hood;
}

/**
 * Driver-eye camera for the ego: 1.2 m above the displayed ground, 5 % of the length ahead of
 * the box centre, looking 25 m along the current yaw and slightly down. `display` is the ego
 * model position in scene coordinates (ground reference, or box centre when `poseAtCenter`).
 */
export function cabinCamera(
  egoPose: Pose,
  ego: Actor,
  display: [number, number, number],
  poseAtCenter: boolean,
): { position: [number, number, number]; target: [number, number, number] } {
  const height = ego.height_m ?? 1.6,
    ground = display[1] - (poseAtCenter ? height / 2 : 0),
    c = Math.cos(egoPose.yaw_rad),
    s = Math.sin(egoPose.yaw_rad),
    ahead = 0.05 * ego.length_m;
  const position: [number, number, number] = [
    display[0] + c * ahead,
    ground + 1.2,
    display[2] - s * ahead,
  ];
  return {
    position,
    target: [position[0] + c * 25, position[1] - 0.6, position[2] - s * 25],
  };
}

/** Enter/leave the driver view: orbiting is disabled inside (dragging would leave the cabin). */
export function setCabinMode(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  on: boolean,
) {
  controls.enabled = !on;
  camera.fov = on ? 70 : 48;
  camera.updateProjectionMatrix();
}

/**
 * Per-frame driver view. Never call `controls.update()` in the cabin: its polar clamp
 * (maxPolarAngle) would lift the eye ~1 m above the 25 m / −0.6 m look-ahead.
 */
export function applyCabinView(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  egoMesh: THREE.Object3D,
  view: ReturnType<typeof cabinCamera>,
) {
  camera.position.set(...view.position);
  controls.target.set(...view.target);
  camera.lookAt(controls.target);
  egoMesh.visible = false; // The camera sits inside the ego body.
}
