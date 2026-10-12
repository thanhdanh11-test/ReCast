import { describe, expect, it } from "vitest";
import vectors from "./__fixtures__/web-demo/keys.json";
import { extractKey, variantKey } from "./demoKeys";

describe("Python / Web Crypto key parity", () => {
  it.each(vectors.vectors)("matches $kind vector $key", async vector => {
    const result = vector.kind === "extract"
      ? await extractKey(...vector.args as [string, string[], number, number])
      : await variantKey(...vector.args as [string, string, number, number]);
    expect(result).toBe(vector.key);
  });
  it("sorts tokens without mutating caller selection", async () => {
    const tokens = ["b", "a"];
    expect(await extractKey("scene-0061", tokens, 0, 2.5)).toBe(await extractKey("scene-0061", ["a", "b"], 0, 2.5));
    expect(tokens).toEqual(["b", "a"]);
  });
});
