import { expect, it } from "vitest";
import { allKinds, source } from "../reactive/fixtures";
import { initialParams, reactionChoice } from "./model";
it("chooses a real start window when a vehicle only supports right lane changes", () => {
  const candidate = { ...allKinds, kinds: { lane_change: { windows_by_change: { "right:6": [[2, 4] as [number, number]] } } } };
  const params = initialParams(candidate, "lane_change");
  expect(params).toMatchObject({ direction: "right", duration: 6 });
  expect(reactionChoice(candidate, "lane_change", params, 0, source).event).toMatchObject({ kind: "lane_change", t0_s: 2, direction: "right", duration_s: 6 });
});

import { guidedCandidates, guidedOptions } from "./guidance";
it("never recommends a vehicle whose followers exclude ego", () => {
  expect(guidedCandidates([{ ...allKinds, followers: ["other"] }], "brake", source)).toEqual([]);
});
it("offers only supported right-lane presets and actual event windows", () => {
  const c = { ...allKinds, kinds: { lane_change: { windows_by_change: { "right:6": [[2, 4] as [number, number]] } } } };
  const options = guidedOptions(c, "lane_change", source);
  expect(options).toHaveLength(1);
  expect(options[0]).toMatchObject({ params: { direction: "right", duration: 6 }, time: 2 });
  expect(guidedOptions(c, "accelerate", source)).toEqual([]);
});
