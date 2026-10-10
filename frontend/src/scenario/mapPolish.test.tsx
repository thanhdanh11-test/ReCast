// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import * as THREE from "three";
import { TacticalMap } from "./TacticalMap";
import { sourceEnvironment } from "./sourceEnvironment";
import type { Environment, Scenario } from "./types";
afterEach(cleanup);

const square = (x0: number, y0: number, s: number) => [
  [x0, y0],
  [x0 + s, y0],
  [x0 + s, y0 + s],
  [x0, y0 + s],
];
const environment: Environment = {
  polygons: [
    { kind: "drivable_area", outer: square(-50, -50, 100), holes: [] },
    { kind: "stop_line", outer: square(2, 2, 4), holes: [] },
    { kind: "ped_crossing", outer: square(-6, 2, 3), holes: [] },
  ],
  lines: [],
  buildings: [],
  trees: [
    { x: 0, y: 0, z: 0, height: 6, crown_radius: 2 },
    { x: 20, y: 20, z: 0, height: 6, crown_radius: 2 },
  ],
  poles: [{ x: 1, y: 1, z: 0, height: 8 }],
  warnings: [],
  provenance: [],
};

it("integrated map does not paint semantic stop areas (same as the 3D view)", () => {
  const scenario: Scenario = {
    id: "s",
    mode: "source",
    interval_s: [0, 1],
    source: { scene: "s", selected_interval_s: [0, 1] },
    road: { kind: "source_map" },
    environment,
    actors: [
      {
        id: "ego",
        role: "ego",
        category: "vehicle.car",
        length_m: 4,
        width_m: 2,
        samples: [
          { t_s: 0, x_m: 0, y_m: 0, z_m: 0, yaw_rad: 0, observed: true },
        ],
      },
    ],
  };
  const { container } = render(
    <TacticalMap scenario={scenario} time={0} replay={null} />,
  );
  expect(container.querySelectorAll(".map-stop_line").length).toBe(0);
  expect(container.querySelectorAll(".map-ped_crossing").length).toBe(1);
  expect(container.querySelectorAll(".map-drivable_area").length).toBe(1);
});

it("3D uses presentation-filtered trees/poles when present, raw estimates otherwise", () => {
  const counts = (env: Environment) => {
    const group = sourceEnvironment(env, 0);
    const out: number[] = [];
    group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) out.push(o.count);
    });
    return out;
  };
  // Two tree instanced meshes (trunk + crown) and one pole mesh.
  expect(counts(environment)).toEqual([2, 2, 1]);
  const filtered: Environment = {
    ...environment,
    presentation: {
      schema_version: 1,
      ground: { cell_m: 3, samples: [] },
      surfaces: environment.polygons,
      buildings: [],
      trees: [environment.trees[1]],
      poles: [],
      diagnostics: [],
    },
  };
  expect(counts(filtered)).toEqual([1, 1]);
  expect(environment.trees.length).toBe(2);
});
