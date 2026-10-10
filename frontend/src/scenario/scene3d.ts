import * as THREE from "three";
import type { Pose, Scenario } from "./types";
import { createGroundSupport, type GroundSupport } from "./groundSupport";
import { mapShape } from "./renderGeometry";
import { sourceEnvironment } from "./sourceEnvironment";
import { scenePosition } from "./trajectory";
export { createModelResources } from "./detailModels";
export { detailedModel as vehicleModel } from "./detailModels";
export function pathRibbon(
  rows: Pose[],
  width: number,
  color: number,
  floor: number,
): THREE.Mesh {
  const vertices: number[] = [],
    indices: number[] = [];
  rows.forEach((p, i) => {
    const normal = [-Math.sin(p.yaw_rad), Math.cos(p.yaw_rad)];
    for (const side of [-1, 1])
      vertices.push(
        p.x_m + normal[0] * width * 0.5 * side,
        floor + 0.04,
        -p.y_m - normal[1] * width * 0.5 * side,
      );
    if (i)
      indices.push(
        (i - 1) * 2,
        (i - 1) * 2 + 1,
        i * 2,
        (i - 1) * 2 + 1,
        i * 2 + 1,
        i * 2,
      );
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
}
export function roadScene(scenario: Scenario): {
  group: THREE.Group;
  floor: number;
  ground: GroundSupport;
  center: THREE.Vector3;
  radius: number;
} {
  const group = new THREE.Group(),
    ego = scenario.actors.find((a) => a.role === "ego")!;
  const all = scenario.actors.flatMap((a) => a.samples),
    bounds = new THREE.Box3().setFromPoints(
      all.map((p) => new THREE.Vector3(...scenePosition(p))),
    );
  const envelope = scenario.environment?.presentation?.bounds_m;
  const mapped = scenario.mode === "source" && envelope?.length === 4;
  const center = mapped
    ? new THREE.Vector3(
        (envelope[0] + envelope[2]) / 2,
        ego.samples[0].z_m,
        -(envelope[1] + envelope[3]) / 2,
      )
    : bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(
    24,
    mapped
      ? Math.hypot(envelope[2] - envelope[0], envelope[3] - envelope[1])
      : bounds.getSize(new THREE.Vector3()).length(),
  );
  const floor =
    Math.min(...ego.samples.map((p) => p.z_m)) -
    (scenario.mode === "imported" ? (ego.height_m ?? 1.6) / 2 : 0) -
    0.08;
  const terrain = createGroundSupport(
    scenario.mode === "source"
      ? scenario.environment?.presentation?.ground
      : undefined,
    floor,
  );
  const terrainActive = terrain.active && envelope?.length === 4;
  const flat = terrainActive
    ? new THREE.ShapeGeometry(
        mapShape(
          [
            [center.x - 800, -center.z - 800],
            [center.x + 800, -center.z - 800],
            [center.x + 800, -center.z + 800],
            [center.x - 800, -center.z + 800],
          ],
          [
            [
              [envelope[0], envelope[1]],
              [envelope[2], envelope[1]],
              [envelope[2], envelope[3]],
              [envelope[0], envelope[3]],
            ],
          ],
        ),
      )
    : new THREE.PlaneGeometry(1600, 1600);
  const ground = new THREE.Mesh(
    flat,
    new THREE.MeshStandardMaterial({ color: 0xe7e7e7, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(
    terrainActive ? 0 : center.x,
    floor - 0.06,
    terrainActive ? 0 : center.z,
  );
  group.add(ground);
  ground.receiveShadow = true;
  if (scenario.environment) {
    group.add(sourceEnvironment(scenario.environment, floor, terrain));
    return { group, floor, ground: terrain, center, radius };
  }
  const grid = new THREE.GridHelper(600, 120, 0x777777, 0x888888);
  grid.position.set(center.x, floor - 0.03, center.z);
  group.add(grid);
  const heading = scenario.road?.heading_rad ?? ego.samples[0].yaw_rad;
  const corridor = new THREE.Group();
  corridor.rotation.y = heading;
  corridor.position.y = floor;
  // Align with the same zero-lateral-offset synthetic road as OpenDRIVE export.
  const projected = all.map(
    (p) => p.x_m * Math.cos(heading) + p.y_m * Math.sin(heading),
  );
  const start = Math.min(...projected) - 90,
    end = Math.max(...projected) + 140;
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(end - start, 0.025, 20),
    new THREE.MeshStandardMaterial({ color: 0x595959, roughness: 0.95 }),
  );
  road.position.set((start + end) / 2, 0, 0);
  corridor.add(road);
  for (const z of [-10, 10]) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(end - start, 0.015, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xdddddd }),
    );
    line.position.set((start + end) / 2, 0.024, z);
    corridor.add(line);
  }
  for (let x = start; x < end; x += 7) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.015, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }),
    );
    stripe.position.set(x, 0.026, 0);
    corridor.add(stripe);
  }
  group.add(corridor);
  group.add(pathRibbon(ego.samples, ego.width_m, 0xcccccc, floor));
  for (const actor of scenario.actors.filter((a) => a.role !== "ego"))
    group.add(pathRibbon(actor.samples, 0.13, 0x999999, floor));
  return { group, floor, ground: terrain, center, radius };
}
export function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material)
      for (const m of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        materials.add(m);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
