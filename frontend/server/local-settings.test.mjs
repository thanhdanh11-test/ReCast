import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { clearMetricsCache, emptyTrash, storageInfo } from "./local-storage.mjs";
import { createFeedback } from "./local-feedback.mjs";

const ID = "a".repeat(32);
function workspace(t) {
  const ws = fs.mkdtempSync(join(os.tmpdir(), "topeye-storage-"));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  fs.mkdirSync(join(ws, ID, "metrics"), { recursive: true });
  fs.writeFileSync(join(ws, ID, "scenario.json"), "x".repeat(100));
  fs.writeFileSync(join(ws, ID, "metrics", "scene-metrics-v3.json"), "m".repeat(40));
  fs.mkdirSync(join(ws, ".trash", "old"), { recursive: true });
  fs.writeFileSync(join(ws, ".trash", "old", "f"), "t".repeat(7));
  return ws;
}
test("storage info counts scenarios, metrics cache and trash separately", t => {
  const ws = workspace(t);
  assert.deepEqual(storageInfo(ws), { workspace: ws, scenarios: 1, scenarioBytes: 100, metricsBytes: 40, trashBytes: 7, trashItems: 1 });
});
test("clearing the metrics cache keeps scenario packages; emptying trash touches only .trash", t => {
  const ws = workspace(t);
  const outside = fs.mkdtempSync(join(os.tmpdir(), "topeye-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(join(outside, "keep"), "k");
  fs.symlinkSync(outside, join(ws, "b".repeat(32))); // a link named like a scenario must not be followed
  assert.deepEqual(clearMetricsCache(ws), { removed: 1 });
  assert.ok(fs.existsSync(join(ws, ID, "scenario.json")));
  assert.ok(!fs.existsSync(join(ws, ID, "metrics")));
  assert.deepEqual(emptyTrash(ws), { removed: 1 });
  assert.deepEqual(fs.readdirSync(join(ws, ".trash")), []);
  assert.ok(fs.existsSync(join(outside, "keep")));
  assert.deepEqual(emptyTrash(join(ws, "missing")), { removed: 0 });
});
test("feedback is validated, stored privately and listed newest first", t => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "topeye-feedback-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = Date.parse("2026-10-13T10:00:00Z");
  const fb = createFeedback({ dir: join(dir, "feedback"), now: () => new Date(clock += 1000) });
  assert.throws(() => fb.submit({ kind: "bug", message: "  " }), { code: "INVALID_INPUT" });
  assert.throws(() => fb.submit({ kind: "spam", message: "x" }), { code: "INVALID_INPUT" });
  assert.throws(() => fb.submit({ kind: "bug", message: "x", context: { cookie: "s" } }), { code: "INVALID_INPUT" });
  assert.throws(() => fb.submit({ kind: "bug", message: "x".repeat(4001) }), { code: "INVALID_INPUT" });
  const first = fb.submit({ kind: "bug", message: " LiDAR trống ", contact: "a@b.c", context: { version: "0.25.0", scene: "scene-0061" } });
  fb.submit({ kind: "idea", message: "Thêm phím tắt" });
  const list = fb.list();
  assert.deepEqual(list.map(e => e.kind), ["idea", "bug"]);
  assert.equal(list[1].message, "LiDAR trống");
  assert.deepEqual(list[1].context, { version: "0.25.0", scene: "scene-0061" });
  assert.equal(fs.statSync(join(dir, "feedback", `${first.id}.json`)).mode & 0o777, 0o600);
});
