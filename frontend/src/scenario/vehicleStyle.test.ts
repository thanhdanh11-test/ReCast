import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { vehicleClass } from "./vehicleClass";
import { NEUTRAL_PALETTE } from "./vehicleMaterials";
import { createModelResources, detailedModel } from "./detailModels";
import { parseActorTemplate } from "./assetModels";
import { loadVinfastTemplate } from "./vinfastModels";
import type { Actor } from "./types";

const actor = (category: string, extra: Partial<Actor> = {}): Actor => ({
  id: category,
  role: "traffic",
  category,
  length_m: 10,
  width_m: 2.5,
  height_m: 3,
  samples: [],
  ...extra,
});

/** World-space x-extent of every lamp mesh per side, for the highest-detail visible level. */
function lampExtents(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const sides: Record<string, THREE.Box3[]> = { front: [], rear: [] };
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const side = (o.material as THREE.Material).userData.lamp;
    if (side) sides[side].push(new THREE.Box3().setFromObject(o));
  });
  return sides;
}

describe("vehicle classes", () => {
  it.each([
    ["vehicle.car", "car"],
    ["vehicle.truck", "truck"],
    ["vehicle.bus.rigid", "bus"],
    ["vehicle.bus.bendy", "bus"],
    ["vehicle.trailer", "heavy"],
    ["vehicle.construction", "heavy"],
    ["vehicle.motorcycle", "motorcycle"],
    ["vehicle.bicycle", "bicycle"],
    ["human.pedestrian.adult", "pedestrian"],
    ["human.pedestrian.child", "pedestrian"],
    ["human.pedestrian.construction_worker", "pedestrian"],
    ["human.pedestrian.personal_mobility", "pedestrian"],
    ["human.pedestrian.police_officer", "pedestrian"],
    ["movable_object.barrier", "object"],
    ["movable_object.debris", "object"],
    ["movable_object.pushable_pullable", "object"],
    ["movable_object.trafficcone", "object"],
    ["static_object.bicycle_rack", "object"],
    ["vehicle.bus", "bus"],
    ["vehicle.motorbike", "motorcycle"],
    ["human.pedestrian", "pedestrian"],
    ["vehicle.emergency.police", "other"],
    ["animal", "other"],
  ])("%s → %s", (category, expected) => {
    expect(vehicleClass(category)).toBe(expected);
  });
});

describe("procedural vehicle style and lamps", () => {
  it.each([
    ["vehicle.car", "car", { length_m: 4.5, width_m: 1.9, height_m: 1.6 }],
    // Category, not height, selects the body: a tall van-like car stays a car.
    ["vehicle.car", "car", { length_m: 5, width_m: 2, height_m: 2.3 }],
    ["vehicle.bus.rigid", "bus", {}],
    ["vehicle.bus.bendy", "bus", { length_m: 18 }],
    ["vehicle.truck", "truck", { length_m: 7, height_m: 3.2 }],
    ["vehicle.trailer", "truck", {}],
    ["vehicle.construction", "truck", { length_m: 6 }],
  ] as const)(
    "%s uses the %s template with front-white/rear-red lamps",
    (category, part, extra) => {
      const a = actor(category, extra as Partial<Actor>);
      const root = detailedModel(a, true, createModelResources());
      const lod = root.children[0] as THREE.LOD;
      for (const level of lod.levels) {
        const parts = new Set<string>();
        level.object.traverse((o) => {
          if (o instanceof THREE.Mesh) parts.add(o.userData.modelPart);
        });
        expect([...parts]).toEqual([part]);
        const { front, rear } = lampExtents(level.object);
        expect(front.length).toBeGreaterThan(0);
        expect(rear.length).toBeGreaterThan(0);
        for (const box of front)
          expect(box.min.x).toBeGreaterThan(a.length_m * 0.4);
        for (const box of rear)
          expect(box.max.x).toBeLessThan(-a.length_m * 0.4);
      }
    },
  );
  it("bus/truck bodies use the GLB car palette", () => {
    const colors = new Set<number>();
    for (const category of ["vehicle.bus.rigid", "vehicle.truck"])
      detailedModel(actor(category), true, createModelResources()).traverse(
        (o) => {
          if (o instanceof THREE.Mesh) {
            const m = o.material as THREE.MeshStandardMaterial;
            if (!m.userData.lamp) colors.add(m.color.getHex());
          }
        },
      );
    for (const c of colors) expect(Object.values(NEUTRAL_PALETTE)).toContain(c);
    expect(colors).toContain(NEUTRAL_PALETTE.paint);
    expect(colors).toContain(NEUTRAL_PALETTE.glass);
  });
  it("lamp materials are white at the front and red at the rear", () => {
    const sides: Record<string, number> = {};
    detailedModel(actor("vehicle.car"), true, createModelResources()).traverse(
      (o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.MeshStandardMaterial;
          if (m.userData.lamp) sides[m.userData.lamp] = m.color.getHex();
        }
      },
    );
    expect(sides.front).toBe(0xf4f4f4);
    expect(sides.rear).toBe(0xb3121a);
  });
});

describe("bundled GLB lamps", () => {
  const bytes = (name: string) => {
    const b = readFileSync(
      new URL(`./assets/models/${name}.glb`, import.meta.url),
    );
    return b.buffer.slice(
      b.byteOffset,
      b.byteOffset + b.byteLength,
    ) as ArrayBuffer;
  };
  it.each(["traffic-sedan", "traffic-suv"])(
    "%s splits headlights front and taillights rear",
    async (name) => {
      const pair = await parseActorTemplate(bytes(name), name);
      for (const group of [pair.high, pair.distant]) {
        const { front, rear } = lampExtents(group);
        expect(front.length).toBeGreaterThan(0);
        expect(rear.length).toBeGreaterThan(0);
        for (const box of front) expect(box.min.x).toBeGreaterThan(0);
        for (const box of rear) expect(box.max.x).toBeLessThan(0);
      }
    },
  );
  it("VinFast VF3 single light material is split by position", async () => {
    const pair = await loadVinfastTemplate();
    for (const group of [pair.high, pair.distant]) {
      const { front, rear } = lampExtents(group);
      expect(front.length).toBeGreaterThan(0);
      expect(rear.length).toBeGreaterThan(0);
      for (const box of front) expect(box.min.x).toBeGreaterThanOrEqual(0);
      for (const box of rear) expect(box.max.x).toBeLessThanOrEqual(0);
    }
  });
});

describe("bus/truck lamps and windscreens are visible from outside", () => {
  /** First surface hit by a ray shot along ∓x at the given local point from outside the body. */
  const firstHit = (
    root: THREE.Object3D,
    y: number,
    z: number,
    side: 1 | -1,
  ) => {
    root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(side * 50, y, z),
      new THREE.Vector3(-side, 0, 0),
    );
    const hits = ray.intersectObject(root, true);
    return hits[0]?.object as THREE.Mesh | undefined;
  };
  it.each([
    "vehicle.bus.rigid",
    "vehicle.bus.bendy",
    "vehicle.truck",
    "vehicle.trailer",
  ])("%s: lamp and windscreen are the first surfaces hit", (category) => {
    const a = actor(
      category,
      category.endsWith("bendy") ? { length_m: 18 } : {},
    );
    const root = detailedModel(a, true, createModelResources());
    root.updateMatrixWorld(true); // scaled world boxes before probing
    const lod = root.children[0] as THREE.LOD;
    for (const level of lod.levels) {
      const lamps: THREE.Mesh[] = [];
      level.object.traverse((o) => {
        if (
          o instanceof THREE.Mesh &&
          (o.material as THREE.Material).userData.lamp
        )
          lamps.push(o);
      });
      for (const mesh of lamps) {
        const box = new THREE.Box3().setFromObject(mesh);
        // Lamp meshes merge both lamps of a side; probe each lamp at its own z.
        for (const z of [box.min.z + 0.05, box.max.z - 0.05]) {
          const side =
            (mesh.material as THREE.Material).userData.lamp === "front"
              ? 1
              : -1;
          const hit = firstHit(
            level.object,
            (box.min.y + box.max.y) / 2,
            z,
            side,
          );
          expect(
            (hit?.material as THREE.Material | undefined)?.userData.lamp,
          ).toBe((mesh.material as THREE.Material).userData.lamp);
        }
      }
      // Side windows, rear window (bus) and doors must also face outward, not sit inside paint.
      const h = a.height_m ?? 1.6,
        y = (u: number) => -h / 2 + u * h;
      const sideRay = (x: number, yu: number, side: 1 | -1) => {
        const hits = new THREE.Raycaster(
          new THREE.Vector3(x, y(yu), side * 50),
          new THREE.Vector3(0, 0, -side),
        ).intersectObject(level.object, true);
        return (hits[0]?.object as THREE.Mesh | undefined)?.material as
          THREE.MeshStandardMaterial | undefined;
      };
      const bus = category.startsWith("vehicle.bus");
      for (const side of [1, -1] as const)
        expect(
          sideRay(
            (bus ? -0.2 : 0.4) * a.length_m,
            bus ? 0.705 : 0.67,
            side,
          )?.color.getHex(),
        ).toBe(NEUTRAL_PALETTE.glass);
      if (bus) {
        expect(sideRay(-0.05 * a.length_m, 0.3, 1)?.color.getHex()).toBe(
          NEUTRAL_PALETTE.trim,
        );
        const rear = new THREE.Raycaster(
          new THREE.Vector3(-50, y(0.75), 0),
          new THREE.Vector3(1, 0, 0),
        ).intersectObject(level.object, true)[0];
        expect(
          (
            (rear?.object as THREE.Mesh).material as THREE.MeshStandardMaterial
          ).color.getHex(),
        ).toBe(NEUTRAL_PALETTE.glass);
      }
      const glass = firstHit(
        level.object,
        -(a.height_m ?? 1.6) / 2 + 0.66 * (a.height_m ?? 1.6),
        0,
        1,
      );
      expect(
        (glass?.material as THREE.MeshStandardMaterial).color.getHex(),
      ).toBe(NEUTRAL_PALETTE.glass);
    }
  });
});
