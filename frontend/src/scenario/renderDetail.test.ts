import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createModelResources, vehicleModel, disposeScene } from "./scene3d";
import { sourceEnvironment } from "./sourceEnvironment";
import { crossingDirection, joinedLine, validRing } from "./renderGeometry";
import type { Actor, Environment } from "./types";
const actor: Actor = {
  id: "car",
  role: "ego",
  category: "vehicle.car",
  length_m: 4.5,
  width_m: 1.85,
  height_m: 1.6,
  samples: [],
};
const empty: Environment = {
  polygons: [],
  lines: [],
  buildings: [],
  trees: [],
  poles: [],
  warnings: [],
  provenance: [],
};
const triangleCount = (object: THREE.Object3D) => {
  let count = 0;
  object.traverse((o) => {
    if (o instanceof THREE.Mesh)
      count +=
        (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  });
  return count;
};
const ray = (x: number, y: number) =>
  new THREE.Raycaster(
    new THREE.Vector3(x, 10, -y),
    new THREE.Vector3(0, -1, 0),
  );
describe("detailed actor geometry", () => {
  it("has cheaper distant LOD without changing pose, identity, or category", () => {
    const model = vehicleModel(actor),
      lod = model.children[0] as THREE.LOD;
    model.position.set(11, 2, -9);
    model.updateMatrixWorld(true);
    expect(lod.levels).toHaveLength(2);
    expect(triangleCount(lod.levels[0].object)).toBeGreaterThan(
      triangleCount(lod.levels[1].object) * 2,
    );
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(11, 2, 100);
    camera.updateMatrixWorld(true);
    lod.update(camera);
    expect(lod.levels[0].object.visible).toBe(false);
    expect(lod.levels[1].object.visible).toBe(true);
    expect(model.visible).toBe(true);
    expect(model.position.toArray()).toEqual([11, 2, -9]);
  });
  it.each([
    "vehicle.car",
    "vehicle.bus",
    "vehicle.bicycle",
    "vehicle.motorbike",
    "human.pedestrian.adult",
  ])(
    "fits %s within measured dimensions with smooth grayscale surfaces",
    (category) => {
      const a = { ...actor, category, role: "traffic" },
        model = vehicleModel(a, true),
        bounds = new THREE.Box3().setFromObject(model),
        size = bounds.getSize(new THREE.Vector3());
      expect(size.x).toBeLessThanOrEqual(a.length_m * 1.01);
      expect(size.z).toBeLessThanOrEqual(a.width_m * 1.01);
      expect(size.y).toBeLessThanOrEqual((a.height_m ?? 1.6) * 1.01);
      expect(bounds.min.y).toBeGreaterThanOrEqual(
        -(a.height_m ?? 1.6) / 2 - 0.02,
      );
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mat = o.material as THREE.MeshStandardMaterial;
          // Fixed front-white / rear-red lamps are the only coloured parts (plan15).
          if (mat.userData.lamp) return;
          expect(mat.color.r).toBe(mat.color.g);
          expect(mat.color.g).toBe(mat.color.b);
          expect(o.geometry.attributes.normal).toBeDefined();
        }
      });
    },
  );
  it("shares immutable geometries/materials in a scene and disposes each once", () => {
    const resources = createModelResources(),
      a = vehicleModel(actor, false, resources),
      b = vehicleModel(
        { ...actor, id: "other", length_m: 5 },
        false,
        resources,
      );
    const first = (a.children[0] as THREE.LOD).levels[0].object
        .children[0] as THREE.Mesh,
      second = (b.children[0] as THREE.LOD).levels[0].object
        .children[0] as THREE.Mesh;
    expect(first.geometry).toBe(second.geometry);
    expect(first.material).toBe(second.material);
    const g = vi.spyOn(first.geometry, "dispose"),
      m = vi.spyOn(first.material as THREE.Material, "dispose"),
      scene = new THREE.Scene();
    scene.add(a, b);
    disposeScene(scene);
    expect(g).toHaveBeenCalledTimes(1);
    expect(m).toHaveBeenCalledTimes(1);
  });
});
describe("presentation map geometry", () => {
  it("keeps genuine road holes and source JSON immutable", () => {
    const env = {
        ...empty,
        polygons: [
          {
            kind: "drivable_area",
            outer: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
            holes: [
              [
                [4, 4],
                [6, 4],
                [6, 6],
                [4, 6],
              ],
            ],
          },
        ],
      },
      before = JSON.stringify(env),
      group = sourceEnvironment(env, 0);
    group.updateMatrixWorld(true);
    expect(ray(5, 5).intersectObject(group, true)).toHaveLength(0);
    expect(ray(2, 2).intersectObject(group, true).length).toBeGreaterThan(0);
    expect(JSON.stringify(env)).toBe(before);
  });
  it("omits self-intersecting road overlays but keeps measured valid base support and diagnostics", () => {
    const env = {
        ...empty,
        polygons: [
          {
            kind: "drivable_area",
            outer: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
            holes: [],
          },
          {
            kind: "road_segment",
            outer: [
              [0, 0],
              [10, 10],
              [0, 10],
              [10, 0],
            ],
            holes: [],
          },
        ],
      },
      group = sourceEnvironment(env, 0);
    group.updateMatrixWorld(true);
    expect(group.userData.geometryDiagnostics).toHaveLength(1);
    expect(ray(5, 5).intersectObject(group, true).length).toBeGreaterThan(0);
    expect(
      validRing([
        [0, 0],
        [10, 10],
        [0, 10],
        [10, 0],
      ]),
    ).toBe(false);
  });
  it("joins a bent source divider continuously at its vertex", () => {
    const g = joinedLine(
        [
          [0, 0],
          [5, 0],
          [5, 5],
        ],
        0,
        0.2,
      ),
      mesh = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      );
    mesh.updateMatrixWorld(true);
    for (const [x, y] of [
      [4.98, -0.02],
      [5.02, 0.02],
      [5, 2],
      [2, 0],
    ])
      expect(ray(x, y).intersectObject(mesh).length).toBeGreaterThan(0);
    expect(g.attributes.position.count).toBe(6);
    expect(g.index?.count).toBe(12);
  });
  it("orients stripe direction from rotated crossing geometry while preserving its clipping holes", () => {
    const direction = crossingDirection([
      [0, 0],
      [8, 8],
      [7, 9],
      [-1, 1],
    ]);
    expect(direction.x).toBeCloseTo(Math.SQRT1_2);
    expect(direction.y).toBeCloseTo(-Math.SQRT1_2);
    const group = sourceEnvironment(
      {
        ...empty,
        polygons: [
          {
            kind: "ped_crossing",
            outer: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
            holes: [
              [
                [4, 4],
                [6, 4],
                [6, 6],
                [4, 6],
              ],
            ],
          },
        ],
      },
      0,
    );
    group.updateMatrixWorld(true);
    expect(ray(5, 5).intersectObject(group, true)).toHaveLength(0);
  });
  it("instances trees and poles instead of allocating mesh/geometry per object", () => {
    const trees = Array.from({ length: 100 }, (_, i) => ({
        x: i * 2,
        y: 0,
        z: 0,
        height: 6,
        crown_radius: 1,
      })),
      group = sourceEnvironment(
        { ...empty, trees, poles: [{ x: 0, y: 1, z: 0, height: 3 }] },
        0,
      ),
      instances = group.children.filter(
        (o) => o instanceof THREE.InstancedMesh,
      ) as THREE.InstancedMesh[];
    expect(instances).toHaveLength(3);
    expect(instances.map((o) => o.count)).toEqual([100, 100, 1]);
    expect(instances[1].geometry.attributes.position.count).toBeGreaterThan(
      300,
    );
  });
});

describe("inclusive ring topology regression", () => {
  it.each([
    [
      "independent pinch",
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [2, 2],
        [0, 4],
        [2, 2],
      ],
    ],
    [
      "independent collinear overlap",
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [2, 4],
        [2, 0],
      ],
    ],
    [
      "zero length edge",
      [
        [0, 0],
        [4, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    ],
    [
      "nonadjacent edge endpoint touch",
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [2, 0],
        [0, 4],
      ],
    ],
    [
      "adjacent collinear reversal",
      [
        [0, 0],
        [4, 0],
        [2, 0],
        [4, 4],
        [0, 4],
      ],
    ],
  ])("rejects %s and emits a presentation diagnostic", (_name, points) => {
    expect(validRing(points)).toBe(false);
    const env = {
      ...empty,
      polygons: [{ kind: "road_segment", outer: points, holes: [] }],
    };
    const snapshot = JSON.stringify(env);
    const group = sourceEnvironment(env, 0);
    expect(group.userData.geometryDiagnostics).toHaveLength(1);
    expect(group.children).toHaveLength(0);
    expect(JSON.stringify(env)).toBe(snapshot);
  });
  it.each([
    [
      [0, 0],
      [4, 0],
      [0, 4],
    ],
    [
      [0, 0],
      [4, 0],
      [0, 4],
      [0, 0],
    ],
    [
      [0, 0],
      [2, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  ])(
    "accepts triangles, conventional closure and straight adjacent segments",
    (...points) => {
      expect(validRing(points)).toBe(true);
    },
  );
});

describe("semantic stop regions", () => {
  it("does not paint a stop area white or fill a genuine road hole", () => {
    const env: Environment = {
      ...empty,
      polygons: [
        {
          kind: "drivable_area",
          outer: [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          holes: [
            [
              [4, 4],
              [6, 4],
              [6, 6],
              [4, 6],
            ],
          ],
        },
        {
          kind: "stop_line",
          outer: [
            [2, 2],
            [8, 2],
            [8, 8],
            [2, 8],
          ],
          holes: [],
        },
      ],
    };
    const before = JSON.stringify(env),
      group = sourceEnvironment(env, 0);
    group.updateMatrixWorld(true);
    const hits = ray(3, 3).intersectObject(group, true);
    expect(hits.length).toBeGreaterThan(0);
    expect((hits[0].object as THREE.Mesh).material).toMatchObject({
      userData: { roadSurface: true },
    });
    expect(ray(5, 5).intersectObject(group, true)).toHaveLength(0);
    expect(JSON.stringify(env)).toBe(before);
    const scene = new THREE.Scene();
    scene.add(group);
    disposeScene(scene);
  });
});
