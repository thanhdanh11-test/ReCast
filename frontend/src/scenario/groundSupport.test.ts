import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  createGroundSupport,
  contactPosition,
  drapeGeometry,
  contactTilt,
} from "./groundSupport";
const actor = {
  id: "car",
  role: "traffic",
  category: "vehicle.car",
  length_m: 4,
  width_m: 2,
  height_m: 2,
  samples: [],
};
const pose = { t_s: 0, x_m: 1, y_m: 1, z_m: 1.8, yaw_rad: 0, observed: true };
const ground = createGroundSupport(
  {
    cell_m: 3,
    samples: [
      [0, 0, 0.4, 12, 0.01],
      [3, 0, 0.4, 12, 0.01],
      [0, 3, 0.4, 12, 0.01],
      [3, 3, 0.4, 12, 0.01],
    ],
  },
  -0.08,
);
describe("measured terrain support", () => {
  it("grounds source model feet without modifying original poses or replay/import height", () => {
    const before = JSON.stringify(pose);
    expect(contactPosition(actor, pose, "source", ground, -1)[1]).toBeCloseTo(
      1.4,
    );
    for (const mode of ["imported", "replay", undefined])
      expect(contactPosition(actor, pose, mode, ground, -1)).toEqual([
        1, 1.8, -1,
      ]);
    expect(JSON.stringify(pose)).toBe(before);
  });
  it("keeps source display contact while refusing distant, malformed and multilevel measured support", () => {
    expect(
      contactPosition(actor, { ...pose, z_m: 8 }, "source", ground, -1)[1],
    ).toBeCloseTo(1.4);
    expect(ground.heightAt(40, 40)).toBeNull();
    expect(ground.surfaceAt(40, 40)).toBe(-0.08);
    expect(
      createGroundSupport(
        {
          cell_m: 3,
          samples: [
            [0, 0, 0, 2, 0.01],
            [0, 0, 0, 20, 5],
          ],
        },
        0,
      ).heightAt(0, 0),
    ).toBeNull();
    expect(
      createGroundSupport(
        {
          cell_m: 3,
          samples: [
            [0, 0, 0, 20, 0.01],
            [0.1, 0.1, 5, 20, 0.01],
          ],
        },
        0,
      ).heightAt(0, 0),
    ).toBeNull();
  });
  it("subdivides and drapes surfaces while preserving the original geometry", () => {
    const original = new THREE.PlaneGeometry(12, 12);
    original.rotateX(-Math.PI / 2);
    const bytes = original.attributes.position.array.slice();
    const flat = { heightAt: () => 0.4, surfaceAt: () => 0.4 },
      result = drapeGeometry(original, flat, 0.03);
    expect(result.attributes.position.count).toBeGreaterThan(
      original.attributes.position.count,
    );
    for (let i = 0; i < result.attributes.position.count; i++)
      expect(result.attributes.position.getY(i)).toBeCloseTo(0.43);
    expect(Array.from(original.attributes.position.array)).toEqual(
      Array.from(bytes),
    );
    expect(() => drapeGeometry(original, flat, 0, 1)).toThrow("budget");
    original.dispose();
    result.dispose();
  });
  it("subdivides adaptively: coarse on planar terrain, fine where it curves", () => {
    const plane = new THREE.PlaneGeometry(200, 200);
    plane.rotateX(-Math.PI / 2);
    const flat = { heightAt: () => 0.4, surfaceAt: () => 0.4 };
    const coarse = drapeGeometry(plane, flat, 0);
    // A uniform 1 m mesh exceeds the 100k default budget here; planar terrain stays at the 4 m cap.
    expect(coarse.attributes.position.count / 3).toBeLessThan(20000);
    const height = (x: number, y: number) => 0.6 * Math.sin(x / 3) + 0.1 * y;
    const curved = { heightAt: height, surfaceAt: height };
    const draped = drapeGeometry(plane, curved, 0, 250000);
    const p = draped.attributes.position;
    let worst = 0;
    for (let i = 0; i < p.count; i += 3) {
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
        z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3,
        y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      worst = Math.max(worst, Math.abs(y - height(x, -z)));
    }
    expect(worst).toBeLessThan(0.05);
    plane.dispose();
    coarse.dispose();
    draped.dispose();
  });
  it("keeps adaptive drapes crack-free inside a mesh and across adjacent surfaces", () => {
    // Steep localized bump: the case where per-triangle adaptive splits left T-junction cracks.
    const height = (x: number, y: number) =>
      1.5 * Math.exp(-((x - 3) ** 2 + (y - 2) ** 2) / 6);
    const ground = { heightAt: height, surfaceAt: height };
    const rect = (x0: number, x1: number) => {
      const g = new THREE.ShapeGeometry(
        new THREE.Shape([
          new THREE.Vector2(x0, -12),
          new THREE.Vector2(x1, -12),
          new THREE.Vector2(x1, 12),
          new THREE.Vector2(x0, 12),
        ]),
      );
      g.rotateX(-Math.PI / 2);
      const draped = drapeGeometry(g, ground, 0, 250000);
      g.dispose();
      return draped;
    };
    const key = (x: number, z: number) => `${x.toFixed(4)},${z.toFixed(4)}`;
    const edges = (g: THREE.BufferGeometry) => {
      const p = g.attributes.position,
        count = new Map<string, number>();
      for (let i = 0; i < p.count; i += 3)
        for (let j = 0; j < 3; j++) {
          const a = key(p.getX(i + j), p.getZ(i + j)),
            b = key(p.getX(i + ((j + 1) % 3)), p.getZ(i + ((j + 1) % 3)));
          const k = a < b ? `${a}|${b}` : `${b}|${a}`;
          count.set(k, (count.get(k) ?? 0) + 1);
        }
      return count;
    };
    const left = rect(-12, 3),
      right = rect(3, 18);
    for (const [g, x0, x1] of [
      [left, -12, 3],
      [right, 3, 18],
    ] as const) {
      // Every edge seen once must be on the outer boundary; an interior one is a T-junction.
      for (const [k, n] of edges(g)) {
        if (n !== 1) continue;
        const [[ax, az], [bx, bz]] = k
          .split("|")
          .map((s) => s.split(",").map(Number));
        const onX = (x: number) => ax === x && bx === x,
          onZ = (z: number) => az === z && bz === z;
        expect(onX(x0) || onX(x1) || onZ(-12) || onZ(12), k).toBe(true);
      }
    }
    // Shared boundary x=3 must be split identically by both surfaces.
    const seam = (g: THREE.BufferGeometry) =>
      [...edges(g).keys()]
        .filter((k) => k.split("|").every((s) => s.startsWith("3.0000,")))
        .sort();
    expect(seam(left)).toEqual(seam(right));
    expect(seam(left).length).toBeGreaterThan(6);
    left.dispose();
    right.dispose();
  });
});

it("uses the same terrain elevation for the actual road surface", async () => {
  const { sourceEnvironment } = await import("./sourceEnvironment");
  const poly = {
    kind: "drivable_area",
    outer: [
      [0, 0],
      [6, 0],
      [6, 6],
      [0, 6],
    ],
    holes: [],
  };
  const env = {
    polygons: [poly],
    lines: [],
    buildings: [],
    trees: [],
    poles: [],
    warnings: [],
    provenance: [],
    presentation: {
      schema_version: 1 as const,
      ground: {
        cell_m: 3,
        samples: [
          [0, 0, 0.4, 12, 0.01],
          [3, 0, 0.4, 12, 0.01],
          [0, 3, 0.4, 12, 0.01],
          [3, 3, 0.4, 12, 0.01],
        ],
      },
      surfaces: [poly],
      buildings: [],
      diagnostics: [],
    },
  };
  const group = sourceEnvironment(env, 0);
  group.updateMatrixWorld(true);
  const hits = new THREE.Raycaster(
    new THREE.Vector3(1, 10, -1),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(group, true);
  expect(hits[0].point.y).toBeCloseTo(0.4);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
});

it("interpolates an observed ego blind spot but refuses one-sided distant extrapolation", () => {
  const ring = {
    cell_m: 3,
    samples: [
      [-4, -4, 0, 20, 0.01],
      [-4, 4, 0, 20, 0.01],
      [4, 4, 0, 20, 0.01],
      [4, -4, 0, 20, 0.01],
    ],
  };
  expect(createGroundSupport(ring, 0).heightAt(0, 0)).toBe(0);
  expect(
    createGroundSupport(
      { ...ring, samples: ring.samples.filter((p) => p[0] > 0) },
      0,
    ).heightAt(0, 0),
  ).toBeNull();
});

it("fades unsupported surface smoothly and estimates source vehicle tilt only", () => {
  const g = createGroundSupport(
    { cell_m: 3, samples: [[0, 0, 1, 20, 0.01]] },
    0,
  );
  expect(Math.abs(g.surfaceAt(7.7, 0) - g.surfaceAt(7.8, 0))).toBeLessThan(0.1);
  const slope = {
    heightAt: (x: number, y: number) => 0.05 * x + 0.04 * y,
    surfaceAt: (x: number, y: number) => 0.05 * x + 0.04 * y,
  };
  const tilt = contactTilt(actor, { ...pose, z_m: 1 }, "source", slope, -1);
  expect(tilt[0]).toBeGreaterThan(0);
  expect(tilt[1]).toBeGreaterThan(0);
  expect(contactTilt(actor, pose, "replay", slope, -1)).toEqual([0, 0]);
});

it("cuts the flat backdrop out of supported low terrain instead of covering the road", async () => {
  const { roadScene, disposeScene } = await import("./scene3d");
  const p = {
    kind: "drivable_area",
    outer: [
      [0, 0],
      [6, 0],
      [6, 6],
      [0, 6],
    ],
    holes: [],
  };
  const env = {
    polygons: [p],
    lines: [],
    buildings: [],
    trees: [],
    poles: [],
    warnings: [],
    provenance: [],
    presentation: {
      schema_version: 1 as const,
      bounds_m: [0, 0, 6, 6],
      ground: {
        cell_m: 3,
        samples: [
          [0, 0, -0.6, 20, 0.01],
          [3, 0, -0.6, 20, 0.01],
          [0, 3, -0.6, 20, 0.01],
          [3, 3, -0.6, 20, 0.01],
        ],
      },
      surfaces: [p],
      buildings: [],
      diagnostics: [],
    },
  };
  const scenario = {
    id: "source",
    mode: "source" as const,
    interval_s: [0, 1] as [number, number],
    source: { scene: "test" },
    actors: [{ ...actor, role: "ego", samples: [{ ...pose, z_m: 0 }] }],
    environment: env,
  };
  const road = roadScene(scenario);
  road.group.updateMatrixWorld(true);
  const hits = new THREE.Raycaster(
    new THREE.Vector3(1, 10, -1),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(road.group, true);
  expect(hits[0].point.y).toBeCloseTo(-0.6);
  const scene = new THREE.Scene();
  scene.add(road.group);
  disposeScene(scene);
});

it("reports terrain drape fallbacks in the contact notice, never as source-map errors", async () => {
  const { sourceEnvironment, environmentIssues, formatContactNotice } =
    await import("./sourceEnvironment");
  const poly = {
    kind: "drivable_area",
    outer: [
      [0, 0],
      [6, 0],
      [6, 6],
      [0, 6],
    ],
    holes: [],
  };
  const env = {
    polygons: [poly],
    lines: [],
    buildings: [],
    trees: [],
    poles: [],
    warnings: [],
    provenance: [],
    presentation: {
      schema_version: 1 as const,
      ground: { cell_m: 3, samples: [[0, 0, 0.4, 12, 0.01]] },
      surfaces: [poly],
      buildings: [],
      diagnostics: [],
    },
  };
  const failing = {
    heightAt: () => 0.4,
    surfaceAt: () => {
      throw new Error("Terrain subdivision budget exceeded");
    },
  };
  const group = sourceEnvironment(env, 0, failing);
  expect(group.userData.geometryDiagnostics).toEqual([]);
  expect(group.userData.terrainDiagnostics).toEqual([
    "Terrain drape failed (Terrain subdivision budget exceeded); flat fallback retained",
  ]);
  const issues = environmentIssues(group);
  expect(issues).toEqual({ geometryIssues: 0, flatFallbacks: 1 });
  expect(formatContactNotice(5, 2, issues.flatFallbacks)).toBe(
    "Cao độ hiển thị theo nền ước lượng LiDAR / hộp 3D · 5 đối tượng có hỗ trợ · 2 bám nền hiển thị dự phòng (chưa đủ hỗ trợ đo) · 1 mặt nền phẳng dự phòng (không dựng được lưới địa hình)",
  );
  expect(formatContactNotice(5, 0, 0)).toBe(
    "Cao độ hiển thị theo nền ước lượng LiDAR / hộp 3D · 5 đối tượng có hỗ trợ",
  );
  const healthy = sourceEnvironment(env, 0);
  expect(environmentIssues(healthy)).toEqual({
    geometryIssues: 0,
    flatFallbacks: 0,
  });
  for (const g of [group, healthy])
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
});

it("keeps source models on the displayed surface when support is missing or annotation height differs", () => {
  const backdrop = { active: true, heightAt: () => null, surfaceAt: () => -0.08 };
  const elevated = { ...pose, z_m: 4.889 };
  for (const support of [backdrop, { ...backdrop, heightAt: () => 0.2, surfaceAt: () => 0.2 }]) {
    const foot = -0.8025;
    const placed = contactPosition(actor, elevated, "source", support, foot);
    expect(placed[1] + foot).toBeCloseTo(support.surfaceAt(), 10);
    expect(contactPosition(actor, elevated, "imported", support, foot)).toEqual([1, 4.889, -1]);
    expect(contactPosition(actor, elevated, "replay", support, foot)).toEqual([1, 4.889, -1]);
  }
  expect(elevated.z_m).toBe(4.889);
});

it("evaluates footprint contact after model rotation, without changing replay placement", () => {
  const display = { heightAt: () => 0, surfaceAt: () => 0 };
  const tilt: [number, number] = [0.12, -0.09];
  const placed = contactPosition(actor, pose, "source", display, -1, tilt);
  const underside = [];
  for (const x of [-actor.length_m * 0.3, actor.length_m * 0.3])
    for (const z of [-actor.width_m * 0.4, actor.width_m * 0.4]) {
      const corner = new THREE.Vector3(x, -1, z).applyEuler(new THREE.Euler(tilt[0], pose.yaw_rad, tilt[1], "YZX"));
      underside.push(placed[1] + corner.y);
    }
  expect(Math.min(...underside)).toBeCloseTo(0, 10);
  expect(contactPosition(actor, pose, "replay", display, -1, tilt)).toEqual([1, 1.8, -1]);
});

it("uses the wheel support rectangle instead of lifting the wheels for body overhang terrain", () => {
  const curve = { heightAt: () => null, surfaceAt: (x: number) => Math.abs(x) > 1.3 ? 1 : 0 };
  const centred = { ...pose, x_m: 0, y_m: 0 };
  expect(contactPosition(actor, centred, "source", curve, -1)[1]).toBe(1);
});
