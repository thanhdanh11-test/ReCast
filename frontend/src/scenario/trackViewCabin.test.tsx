// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as THREE from "three";

// Real TrackView + real OrbitControls; only WebGL output is replaced so frames can be stepped.
const rendered: { scene: THREE.Scene; camera: THREE.PerspectiveCamera }[] = [];
vi.mock("three", async (original) => {
  const T = await original<typeof import("three")>();
  class FakeRenderer {
    domElement = document.createElement("canvas");
    shadowMap = { enabled: false, type: 0 };
    info = {
      render: { calls: 0, triangles: 0 },
      memory: { geometries: 0, textures: 0 },
    };
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    dispose() {}
    forceContextLoss() {}
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
      rendered.push({ scene, camera });
    }
  }
  return { ...T, WebGLRenderer: FakeRenderer };
});
vi.mock("./assetModels", async (original) => ({
  ...(await original<typeof import("./assetModels")>()),
  loadActorTemplates: () => new Promise(() => {}),
}));
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TrackView } from "./TrackView";
import type { Scenario } from "./types";

const pose = (t_s: number, x_m: number) => ({
  t_s,
  x_m,
  y_m: 0,
  z_m: 0,
  yaw_rad: 0,
  observed: true,
});
const actor = (
  id: string,
  role: string,
  category: string,
  x0: number,
  length_m: number,
  height_m: number,
) => ({
  id,
  role,
  category,
  length_m,
  width_m: 2,
  height_m,
  samples: Array.from({ length: 21 }, (_, i) => pose(i, x0 + i * 2)),
});
const scenario = (id: string, mode?: "imported"): Scenario =>
  ({
    id,
    mode,
    interval_s: [0, 20],
    source: { scene: id, selected_interval_s: [0, 20] },
    road: { kind: "straight", heading_rad: 0 },
    actors: [
      actor("ego", "ego", "vehicle.car", 0, 4, 1.6),
      actor("lead", "traffic", "vehicle.bus", 30, 12, 3.2),
    ],
  }) as unknown as Scenario;

let queue: FrameRequestCallback[] = [];
let now = 1000;
beforeEach(() => {
  rendered.length = 0;
  queue = [];
  now = 1000;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    queue.push(cb),
  );
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const frames = (n: number) => {
  for (let i = 0; i < n; i++) {
    now += 16.7;
    const q = queue;
    queue = [];
    act(() => q.forEach((f) => f(now)));
  }
};
const host = () => document.querySelector(".scene3d-canvas") as HTMLElement;
const camera = () => rendered.at(-1)!.camera;
const press = (name: string) =>
  act(() => void fireEvent.click(screen.getByRole("button", { name })));

describe("TrackView cabin wiring", () => {
  it("renders the driver eye at 1.2 m without orbit updates, and restores modes on exit", () => {
    const update = vi.spyOn(OrbitControls.prototype, "update");
    const s = scenario("a");
    const { rerender } = render(
      <TrackView scenario={s} time={5} replay={null} />,
    );
    frames(3);
    press("Trong xe");
    frames(2);
    const before = update.mock.calls.length;
    for (let k = 0; k < 30; k++) {
      rerender(<TrackView scenario={s} time={5 + k * 0.05} replay={null} />);
      frames(1);
      expect(camera().position.y).toBeCloseTo(1.2, 6);
      expect(host().dataset.cabinEyeM).toBe("1.20");
    }
    expect(update.mock.calls.length).toBe(before);
    expect(camera().fov).toBe(70);
    for (const [button, mode] of [
      ["Bám xe", "follow"],
      ["Trong xe", "cabin"],
      ["Toàn cảnh", "overview"],
    ] as const) {
      press(button);
      frames(2);
      expect(host().dataset.cameraMode).toBe(mode);
      expect(camera().fov).toBe(mode === "cabin" ? 70 : 48);
      if (mode !== "cabin") expect(host().dataset.cabinEyeM).toBeUndefined();
    }
  });
  it("starts a new scene outside the cabin", () => {
    const { rerender } = render(
      <TrackView scenario={scenario("a")} time={5} replay={null} />,
    );
    frames(2);
    press("Trong xe");
    frames(2);
    rerender(<TrackView scenario={scenario("b")} time={5} replay={null} />);
    frames(2);
    expect(camera().fov).toBe(48);
    expect(host().dataset.cabinEyeM).toBeUndefined();
    expect(
      screen
        .getByRole("button", { name: "Bám xe" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
  it("keeps the eye 1.2 m above the displayed ground for centre-pose imported scenes", () => {
    render(
      <TrackView
        scenario={scenario("imp", "imported")}
        time={5}
        replay={null}
      />,
    );
    frames(2);
    press("Trong xe");
    frames(2);
    expect(host().dataset.cabinEyeM).toBe("1.20");
  });
});
