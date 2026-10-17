import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { createExports } from "./scenario-exports.mjs";

const id = (c) => c.repeat(32);
function setup(spawnScript, timeoutMs) {
  const ws = fs.mkdtempSync(join(os.tmpdir(), "topeye-exports-"));
  const job = (i, status = "queued", created = "2026-10-17T00:00:0" + i) => {
    const dir = join(ws, "exports", i);
    fs.mkdirSync(dir, { recursive: true });
    const value = { schema_version: 1, id: i, status, progress: 0, created_at: created, files: [], error: null };
    fs.writeFileSync(join(dir, "job.json"), JSON.stringify(value));
    return value;
  };
  const started = [];
  const exports = createExports({ workspace: () => ws, timeoutMs,
    spawnJob: (jobId) => { started.push(jobId); return spawn(process.execPath, ["-e", spawnScript(join(ws, "exports", jobId))]); } });
  return { ws, job, exports, started };
}
const until = async (check) => { for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(check()); };
const finish = (dir) => `const fs=require("fs");const p=${JSON.stringify(dir)};const j=JSON.parse(fs.readFileSync(p+"/job.json"));` +
  `fs.writeFileSync(p+"/s.zip","PK");fs.writeFileSync(p+"/job.json",JSON.stringify({...j,status:"done",progress:100}));`;

test("runs jobs one at a time in order and serves the finished zip", async () => {
  const { job, exports, started } = setup(finish);
  exports.enqueue(job(id("a"), "queued", "2026-10-17T00:00:01"));
  exports.enqueue(job(id("b"), "queued", "2026-10-17T00:00:02"));
  assert.deepEqual(started, [id("a")]); // second waits for the first
  await until(() => exports.list().every((j) => j.status === "done"));
  assert.deepEqual(started, [id("a"), id("b")]);
  assert.deepEqual(exports.list().map((j) => j.id), [id("b"), id("a")]); // newest first
  assert.equal(exports.zip(id("a")).name, "s.zip");
});

test("a process that dies or overruns ends its job as failed, never running forever", async () => {
  const crash = setup(() => "process.exit(3)");
  crash.exports.enqueue(crash.job(id("c")));
  await until(() => crash.exports.list()[0].status === "failed");
  assert.equal(crash.exports.list()[0].error.code, "INTERRUPTED");
  const slow = setup(() => "setTimeout(()=>{},10000)", 100);
  slow.exports.enqueue(slow.job(id("d")));
  await until(() => slow.exports.list()[0].status === "failed");
  assert.equal(slow.exports.list()[0].error.code, "TIMEOUT");
});

test("jobs orphaned by a previous server show as interrupted", () => {
  const { job, exports } = setup(finish);
  job(id("e"), "running");
  assert.equal(exports.list()[0].status, "failed");
  assert.equal(exports.list()[0].error.code, "INTERRUPTED");
});

test("delete: busy while running, moves finished or waiting exports to .trash, rejects bad ids", async () => {
  const { ws, job, exports } = setup(() => "setTimeout(()=>{},300)");
  exports.enqueue(job(id("f")));
  exports.enqueue(job(id("0")));
  assert.throws(() => exports.remove(id("f")), /BUSY/);
  assert.deepEqual(exports.remove(id("0")), { removed: true }); // waiting job leaves the queue
  assert.equal(fs.readdirSync(join(ws, ".trash")).length, 1);
  assert.throws(() => exports.remove("../x"), /INVALID_INPUT/);
  assert.throws(() => exports.zip(id("f")), /chưa xong/);
  assert.throws(() => exports.remove(id("9")), /NOT_FOUND/);
  exports.stop();
});

test("a job the worker just queued is not an orphan before enqueue (review F2); older ones are", () => {
  const { job, exports } = setup(finish);
  job(id("1"), "queued", new Date(Date.now() + 1000).toISOString()); // written after this server started
  job(id("2"), "queued", "2020-01-01T00:00:00Z"); // left by an earlier server
  const byId = Object.fromEntries(exports.list().map((j) => [j.id, j]));
  assert.equal(byId[id("1")].status, "queued");
  assert.equal(byId[id("2")].error.code, "INTERRUPTED");
});

test("symlinked exports folder, trash or zip are refused (review F4)", () => {
  const { ws, job, exports } = setup(finish);
  const done = job(id("3"), "done");
  fs.symlinkSync(join(ws, "job.json.nope"), join(ws, "exports", done.id, "s.zip"));
  assert.throws(() => exports.zip(done.id), /NOT_FOUND/);
  const outside = fs.mkdtempSync(join(os.tmpdir(), "topeye-outside-"));
  fs.symlinkSync(outside, join(ws, ".trash"));
  assert.throws(() => exports.remove(done.id), /PATH_ESCAPE/);
  fs.renameSync(join(ws, "exports"), join(outside, "exports"));
  fs.symlinkSync(join(outside, "exports"), join(ws, "exports"));
  assert.deepEqual(exports.list(), []);
  assert.throws(() => exports.zip(done.id), /PATH_ESCAPE/);
});
