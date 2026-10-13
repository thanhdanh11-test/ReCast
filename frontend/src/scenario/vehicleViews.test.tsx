// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyCabinView, cabinCamera, createCabinHood, setCabinMode } from "./cabinCamera";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createDrivingOverlay } from "./drivingOverlay";
import { TacticalMap } from "./TacticalMap";
import { LidarView } from "./LidarView";
import type { Actor, Scenario } from "./types";
afterEach(cleanup);

const ego: Actor = {
  id: "ego",
  role: "ego",
  category: "vehicle.car",
  length_m: 4,
  width_m: 1.8,
  height_m: 1.6,
  samples: [{ t_s: 0, x_m: 0, y_m: 0, z_m: 0, yaw_rad: 0, observed: true }],
};

describe("cabin camera", () => {
  it.each([
    [0, false],
    [Math.PI / 2, false],
    [0.7, true],
  ])(
    "puts the eye inside the ego at driver height looking along yaw %f (center pose %s)",
    (yaw, center) => {
      const pose = {
        t_s: 0,
        x_m: 3,
        y_m: -2,
        z_m: 0,
        yaw_rad: yaw,
        observed: true,
      };
      const display: [number, number, number] = [3, center ? 0.8 : 0, 2];
      const { position, target } = cabinCamera(pose, ego, display, center);
      const ground = center ? display[1] - 0.8 : display[1];
      expect(position[1] - ground).toBeCloseTo(1.2);
      // Inside the ego footprint (scene x = world x, scene z = -world y).
      const dx = position[0] - display[0],
        dz = position[2] - display[2];
      const along = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const lateral = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      expect(Math.abs(along)).toBeLessThan(ego.length_m / 2);
      expect(Math.abs(lateral)).toBeLessThan(ego.width_m / 2);
      const fx = target[0] - position[0],
        fz = target[2] - position[2];
      expect(Math.hypot(fx, fz)).toBeCloseTo(25);
      expect(fx / 25).toBeCloseTo(Math.cos(yaw));
      expect(fz / 25).toBeCloseTo(-Math.sin(yaw));
      expect(target[1]).toBeCloseTo(position[1] - 0.6);
    },
  );
});

describe("cabin mode wiring", () => {
  it("keeps the driver eye at 1.2 m despite orbit polar clamps, hides the ego and restores on exit", () => {
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1600),
      controls = new OrbitControls(camera, document.createElement("div"));
    controls.maxPolarAngle = Math.PI * 0.48; // TrackView's orbit limit
    const egoMesh = new THREE.Object3D();
    setCabinMode(camera, controls, true);
    expect(controls.enabled).toBe(false);
    expect(camera.fov).toBe(70);
    const view = cabinCamera(
      { t_s: 0, x_m: 10, y_m: 5, z_m: 0, yaw_rad: 0.3, observed: true },
      ego,
      [10, 0, -5],
      false,
    );
    for (let frame = 0; frame < 3; frame++)
      applyCabinView(camera, controls, egoMesh, view);
    expect(camera.position.y).toBeCloseTo(1.2, 6);
    expect(camera.position.x).toBeCloseTo(view.position[0], 6);
    expect(egoMesh.visible).toBe(false);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    expect(forward.x).toBeCloseTo(Math.cos(0.3), 2);
    setCabinMode(camera, controls, false);
    expect(controls.enabled).toBe(true);
    expect(camera.fov).toBe(48);
    controls.dispose();
  });
});

describe("gap corridor fades from ego to the lead vehicle", () => {
  const pose = (t_s: number, x_m: number) => ({
    t_s,
    x_m,
    y_m: 0,
    z_m: 0,
    yaw_rad: 0,
    observed: true,
  });
  const rows = Array.from({ length: 101 }, (_, i) => pose(i * 0.1, i));
  const alphas = (corridor: THREE.Mesh) => {
    const c = corridor.geometry.attributes.color,
      p = corridor.geometry.attributes.position,
      n = corridor.geometry.drawRange.count / 6 + 1;
    return Array.from({ length: n }, (_, i) => ({
      x: p.getX(i * 2),
      a: c.getW(i * 2),
      b: c.getW(i * 2 + 1),
    }));
  };
  it("stops exactly at the lead distance and fades monotonically", () => {
    const scene = new THREE.Scene(),
      overlay = createDrivingOverlay(scene, 0, 2),
      corridor = scene.children[0] as THREE.Mesh;
    overlay.update(pose(0, 0), rows, 1, pose(2.4, 24), 22.5);
    const rowsOut = alphas(corridor);
    expect(rowsOut[0].a).toBeCloseTo(0.6);
    expect(rowsOut.at(-1)!.x).toBeCloseTo(22.5);
    expect(rowsOut.at(-1)!.a).toBeCloseTo(0, 3);
    for (let i = 1; i < rowsOut.length; i++) {
      expect(rowsOut[i].a).toBeLessThanOrEqual(rowsOut[i - 1].a);
      expect(rowsOut[i].a).toBeCloseTo(rowsOut[i].b);
    }
    expect((corridor.material as THREE.MeshBasicMaterial).vertexColors).toBe(
      true,
    );
  });
  it("without a lead vehicle fades over the 60 m reference path", () => {
    const scene = new THREE.Scene(),
      overlay = createDrivingOverlay(scene, 0, 2),
      corridor = scene.children[0] as THREE.Mesh;
    overlay.update(pose(0, 0), rows, 1);
    const rowsOut = alphas(corridor);
    expect(rowsOut.at(-1)!.x).toBeCloseTo(60);
    expect(rowsOut.at(-1)!.a).toBeCloseTo(0, 3);
    expect(rowsOut[Math.floor(rowsOut.length / 2)].a).toBeGreaterThan(0.1);
  });
});

describe("integrated map class colours", () => {
  const actorAt = (id: string, category: string, x: number): Actor => ({
    id,
    role: "traffic",
    category,
    length_m: 4,
    width_m: 2,
    samples: [{ t_s: 0, x_m: x, y_m: 0, z_m: 0, yaw_rad: 0, observed: true }],
  });
  const scenario: Scenario = {
    id: "map-classes",
    mode: "source",
    interval_s: [0, 1],
    source: { scene: "test", selected_interval_s: [0, 1] },
    road: { kind: "source_map" },
    actors: [
      ego,
      actorAt("c", "vehicle.car", 8),
      actorAt("b", "vehicle.bus.rigid", 16),
      actorAt("p", "human.pedestrian.adult", 24),
      // Present in the scene but outside the 130 m map frame: not in the legend.
      actorAt("t", "vehicle.truck", 400),
    ],
    environment: {
      polygons: [
        {
          kind: "drivable_area",
          outer: [
            [-100, -100],
            [100, -100],
            [100, 100],
            [-100, 100],
          ],
          holes: [],
        },
      ],
      lines: [],
      buildings: [],
      trees: [],
      poles: [],
      warnings: [],
      provenance: [],
    },
  };
  it("colours actors by class and lists only present classes after the ego", () => {
    const { container } = render(
      <TacticalMap scenario={scenario} time={0} replay={null} />,
    );
    expect(container.querySelectorAll("svg .map-class-car").length).toBe(1);
    expect(container.querySelectorAll("svg .map-class-bus").length).toBe(1);
    expect(container.querySelectorAll("svg .map-class-pedestrian").length).toBe(
      1,
    );
    expect(container.querySelectorAll("svg .map-ego").length).toBe(1);
    expect(
      container.querySelector("svg .map-ego")!.getAttribute("class"),
    ).not.toContain("map-class-");
    // Legend swatches must not reuse map shape classes (selectors stay unambiguous).
    expect(container.querySelectorAll(".map-ego").length).toBe(1);
    expect(container.querySelectorAll(".map-class-car").length).toBe(1);
    const legend = screen.getByTestId("map-legend");
    expect(
      [...legend.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["Xe ego", "Xe con", "Xe buýt", "Người đi bộ"]);
  });
  it("keeps LiDAR uncoloured by class", () => {
    const { container } = render(
      <LidarView scenario={scenario} time={0} replay={null} />,
    );
    expect(container.innerHTML).not.toContain("map-class-");
  });
});


describe("visible cabin bonnet", () => {
  it.each([1, 2, 3])("stays in the lower quarter at viewport aspect %s", (aspect) => {
    const camera = new THREE.PerspectiveCamera(70, aspect, .1, 1600);
    const hood = createCabinHood();
    const positions = hood.geometry.attributes.position;
    const projected = Array.from({length:positions.count}, (_, i) => new THREE.Vector3().fromBufferAttribute(positions, i).project(camera));
    expect(projected.every(p => Number.isFinite(p.y) && p.y < -.5 && p.z > -1 && p.z < 1)).toBe(true);
    expect(projected.some(p => p.y > -1 && Math.abs(p.x) < 1)).toBe(true);
    expect(hood.geometry.index!.count / 3).toBe(24);
    expect(hood.visible).toBe(false);
    hood.geometry.dispose();
    (hood.material as THREE.Material).dispose();
  });
});
