import { describe, expect, it } from "vitest";
import { poseAt } from "./TrackView";
const sample = (t_s: number, x_m: number, yaw_rad: number) => ({
  t_s,
  x_m,
  y_m: 0,
  z_m: 0,
  yaw_rad,
  observed: true,
});
describe("trajectory preview interpolation", () => {
  it("uses time and follows short yaw arc through pi", () => {
    const rows = [
      sample(0, 0, (179 * Math.PI) / 180),
      sample(2, 10, (-179 * Math.PI) / 180),
    ];
    const p = poseAt(rows, 1);
    expect(p.x_m).toBe(5);
    expect(Math.abs(p.yaw_rad)).toBeCloseTo(Math.PI);
  });
  it("holds endpoints for preview scrubbing", () => {
    const rows = [sample(0, 0, 0), sample(2, 10, 0)];
    expect(poseAt(rows, -1)).toBe(rows[0]);
    expect(poseAt(rows, 3)).toBe(rows[1]);
  });
});

it("hides source participants outside observations and across gaps, preserving exact isolated observations", () => {
  const isolated = [sample(4, 8, 0)];
  expect(supportedPose(isolated, 3.99)).toBeNull();
  expect(supportedPose(isolated, 4)).toBe(isolated[0]);
  expect(supportedPose(isolated, 4.01)).toBeNull();
  const rows = [sample(1, 2, 0), sample(1.5, 3, 0), sample(4, 8, 0)];
  expect(supportedPose(rows, 1.25)?.x_m).toBe(2.5);
  expect(supportedPose(rows, 2)).toBeNull();
  expect(supportedPose(rows, 4)).toEqual(rows[2]);
});

import * as THREE from "three";
import { sourceEnvironment } from "./sourceEnvironment";
import type { Environment } from "./types";
it("preserves crosswalk holes in both pavement and stripe geometry", () => {
  const environment = {
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
    lines: [],
    buildings: [],
    trees: [],
    poles: [],
    warnings: [],
    provenance: [],
  } as Environment;
  const group = sourceEnvironment(environment, 0);
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(5, 10, -5),
    new THREE.Vector3(0, -1, 0),
  );
  expect(ray.intersectObject(group, true)).toHaveLength(0);
  ray.ray.origin.set(2, 10, -2);
  expect(ray.intersectObject(group, true).length).toBeGreaterThan(0);
});
import { scenePosition, replayRows, supportedPose } from "./trajectory";
import type { Actor, Replay } from "./types";
it("maps world forward/left/up to Three coordinates without mirroring yaw", () => {
  const p = { ...sample(0, 3, Math.PI / 2), y_m: 4, z_m: 5 };
  expect(scenePosition(p)).toEqual([3, 5, -4]);
  const forward = new THREE.Vector3(1, 0, 0).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    p.yaw_rad,
  );
  expect(forward.x).toBeCloseTo(0);
  expect(forward.z).toBeCloseTo(-1);
  const b = { ...p, t_s: 2, z_m: 9 };
  expect(poseAt([p, b], 1).z_m).toBe(7);
});
it("uses measured poses and rejects absent engine support rather than faking a held endpoint", () => {
  const actor = {
    id: "ego",
    samples: [sample(0, 0, 0), sample(1, 10, 0)],
  } as Actor;
  const replay = {
    observed: [
      { ...sample(0, 2, 0), id: "ego" },
      { ...sample(0.05, 3, 0), id: "ego" },
    ],
  } as Replay;
  expect(replayRows(actor, null)).toBe(actor.samples);
  expect(supportedPose(replayRows(actor, replay), 0.025, 0.075)?.x_m).toBe(2.5);
  expect(supportedPose(replayRows(actor, replay), 0.1, 0.075)).toBeNull();
  expect(
    supportedPose([sample(0, 0, 0), sample(0.2, 2, 0)], 0.1, 0.075),
  ).toBeNull();
  expect(replayRows({ ...actor, id: "missing" }, replay)).toEqual([]);
});

import { playbackEnd } from "./trajectory";
import type { Scenario } from "./types";
it("stops replay at the last common engine sample rather than the longer reference endpoint", () => {
  const scenario = {
    interval_s: [0, 2.599],
    actors: [{ id: "ego" }, { id: "vehicle_1" }],
  } as Scenario;
  const replay = {
    observed: [
      { id: "ego", t_s: 2.55 },
      { id: "vehicle_1", t_s: 2.5 },
    ],
  } as Replay;
  expect(playbackEnd(scenario, replay)).toBe(2.5);
  expect(playbackEnd(scenario, null)).toBe(2.599);
});

import { vehicleModel, roadScene, disposeScene } from "./scene3d";
it("renders pedestrian geometry and distinct ego appearance on imported map without a synthetic road contract", () => {
  const pedestrian: Actor = {
    id: "walker",
    role: "traffic",
    category: "human.pedestrian.adult",
    length_m: 0.6,
    width_m: 0.5,
    height_m: 1.8,
    samples: [sample(0, 5, 0), sample(2, 7, 0)],
  };
  const walker = vehicleModel(pedestrian);
  expect(
    (
      (walker.children[0] as THREE.LOD).levels[0].object
        .children[0] as THREE.Mesh
    ).userData.modelPart,
  ).toBe("person");
  const ego = vehicleModel({
    ...pedestrian,
    id: "ego",
    role: "ego",
    category: "vehicle.car",
    length_m: 4,
    width_m: 2,
  });
  const egoPaint = (
    (ego.children[0] as THREE.LOD).levels[0].object.children[0] as THREE.Mesh
  ).material as THREE.MeshStandardMaterial;
  const walkerPaint = (
    (walker.children[0] as THREE.LOD).levels[0].object.children[0] as THREE.Mesh
  ).material as THREE.MeshStandardMaterial;
  expect(egoPaint.color.getHex()).not.toBe(walkerPaint.color.getHex());
  const scenario: Scenario = {
    id: "import",
    mode: "imported",
    interval_s: [0, 2],
    source: { scene: "map" },
    actors: [{ ...pedestrian, id: "ego", role: "ego" }, pedestrian],
    environment: {
      polygons: [],
      lines: [],
      buildings: [],
      trees: [],
      poles: [],
      warnings: [],
      provenance: [],
    },
  };
  const road = roadScene(scenario);
  expect(road.radius).toBeGreaterThanOrEqual(24);
  const cleanupScene = new THREE.Scene();
  cleanupScene.add(road.group, walker, ego);
  disposeScene(cleanupScene);
});

it("centers imported ego geometry and floor while preserving source/legacy ground-origin ego", () => {
  const ego: Actor = {
    id: "ego",
    role: "ego",
    category: "vehicle.car",
    length_m: 4,
    width_m: 2,
    height_m: 2,
    samples: [
      { ...sample(0, 0, 0), z_m: 3 },
      { ...sample(2, 1, 0), z_m: 3 },
    ],
  };
  const legacy = vehicleModel(ego),
    imported = vehicleModel(ego, true);
  const legacyBounds = new THREE.Box3().setFromObject(legacy),
    importedBounds = new THREE.Box3().setFromObject(imported);
  expect(importedBounds.min.y).toBeCloseTo(legacyBounds.min.y - 1);
  expect(importedBounds.max.y).toBeCloseTo(legacyBounds.max.y - 1);
  const scenario: Scenario = {
    id: "test",
    mode: "imported",
    interval_s: [0, 2],
    source: { scene: "test" },
    actors: [ego],
    environment: {
      polygons: [],
      lines: [],
      buildings: [],
      trees: [],
      poles: [],
      warnings: [],
      provenance: [],
    },
  };
  const importedRoad = roadScene(scenario);
  expect(importedRoad.floor).toBeCloseTo(1.92);
  const sourceRoad = roadScene({ ...scenario, mode: "source" }),
    legacyRoad = roadScene({ ...scenario, mode: undefined });
  expect(sourceRoad.floor).toBeCloseTo(2.92);
  expect(legacyRoad.floor).toBeCloseTo(2.92);
  const cleanupScene = new THREE.Scene();
  cleanupScene.add(
    importedRoad.group,
    sourceRoad.group,
    legacyRoad.group,
    legacy,
    imported,
  );
  disposeScene(cleanupScene);
});
it("renders imported motorbike using the same two-wheel model as motorcycle", () => {
  const bike: Actor = {
    id: "bike",
    role: "traffic",
    category: "vehicle.motorbike",
    length_m: 2,
    width_m: 0.7,
    height_m: 1.4,
    samples: [sample(0, 0, 0)],
  };
  const model = vehicleModel(bike);
  const motorcycle = vehicleModel({ ...bike, category: "vehicle.motorcycle" });
  expect(
    (
      (model.children[0] as THREE.LOD).levels[0].object
        .children[0] as THREE.Mesh
    ).geometry.attributes.position.count,
  ).toBe(
    (
      (motorcycle.children[0] as THREE.LOD).levels[0].object
        .children[0] as THREE.Mesh
    ).geometry.attributes.position.count,
  );
  expect(
    (
      (model.children[0] as THREE.LOD).levels[0].object
        .children[0] as THREE.Mesh
    ).userData.modelPart,
  ).toBe("bike");
  const cleanupScene = new THREE.Scene();
  cleanupScene.add(model);
  disposeScene(cleanupScene);
});
