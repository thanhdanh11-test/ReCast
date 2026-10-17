import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCatalog } from "./dataset-catalog.mjs";

test("plan52: the catalog is nuScenes-only — Argoverse 2 is refused and an old entry is hidden, files untouched", async () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "topeye-catalog-"));
  const nus = join(dir, "nuscenes"), av2 = join(dir, "av2");
  fs.mkdirSync(nus); fs.mkdirSync(av2);
  const path = join(dir, "catalog.json");
  fs.writeFileSync(path, JSON.stringify({ schemaVersion: 1, entries: [
    { id: "a".repeat(24), root: av2, name: "Argoverse 2", format: "av2", sceneCount: 10, regions: [], status: "ready" },
  ] }));
  const inspect = async (root) => root === av2 ? { root, version: "av2-sensor", scenes: [{}] } : { root, version: "v1.0-mini", scenes: [{}, {}] };
  const catalog = createCatalog({ path, seeds: [{ root: nus, name: "nuScenes mini" }], inspect });
  const listed = await catalog.list();
  assert.deepEqual(listed.map((e) => [e.name, e.format]), [["nuScenes mini", "nuscenes"]]);
  assert.throws(() => catalog.get("a".repeat(24)), /NOT_FOUND/);
  await assert.rejects(catalog.add(av2), /DATASET_INVALID/);
  assert.ok(fs.existsSync(av2));
  assert.equal(JSON.parse(fs.readFileSync(path, "utf8")).entries.filter((e) => e.format === "av2").length, 1); // kept, just hidden
});
