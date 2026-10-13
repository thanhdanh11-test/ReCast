import { describe, expect, it } from "vitest";
import { playbackEnd, supportedPose } from "./trajectory";
import type { Pose, Scenario } from "./types";

const pose = (t_s: number): Pose => ({ t_s, x_m: t_s, y_m: 0, z_m: 0, yaw_rad: 0, observed: true });

describe("supportedPose at the end of a source scene", () => {
  it("keeps the last pose when the timeline end is 1.7e-7 s past the 1 µs-rounded sample (scene-0061)", () => {
    const rows = [pose(19.1), pose(19.149566)];
    const scenario = { id: "s", mode: "source", interval_s: [0, 19.149566173553467], source: { scene: "scene-0061" },
      actors: [{ id: "ego", role: "ego", category: "vehicle.car", length_m: 4, width_m: 2, samples: rows }] } as Scenario;
    const end = playbackEnd(scenario, null);
    expect(supportedPose(rows, end)?.x_m).toBeCloseTo(19.149566, 6);
  });
  it("still rejects times clearly outside the samples", () => {
    const rows = [pose(1), pose(2)];
    expect(supportedPose(rows, 2.00001)).toBeNull();
    expect(supportedPose(rows, 0.99999)).toBeNull();
  });
});
