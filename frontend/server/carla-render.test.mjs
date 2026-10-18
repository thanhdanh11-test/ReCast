import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCarlaRender } from "./carla-render.mjs";

const ID = "a".repeat(32);
const CONFIG = { brev_instance: "vm1", remote_dir: "/home/ubuntu/carla-env", stop_after: true };

/** Workspace with one finished CARLA export, and a fake brev that records every call. */
function setup({ status = "STOPPED", fail, config = CONFIG } = {}) {
  const ws = fs.mkdtempSync(join(os.tmpdir(), "topeye-render-"));
  const dir = join(ws, "exports", ID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, "job.json"), JSON.stringify({ id: ID, status: "done", format: "carla", name: "x.xosc" }));
  fs.writeFileSync(join(dir, "x.zip"), "PK");
  const calls = [];
  let vm = status;
  const run = async (args) => {
    calls.push(args.join(" "));
    if (fail && args.join(" ").includes(fail)) return { code: 1, stdout: "", stderr: "boom" };
    if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ workspaces: [{ name: "vm1", status: vm, health_status: vm === "RUNNING" ? "HEALTHY" : "UNHEALTHY" }] }), stderr: "" };
    if (args[0] === "start") { vm = "RUNNING"; return { code: 0, stdout: "Your instance is ready!", stderr: "" }; }
    if (args[0] === "stop") { vm = "STOPPED"; return { code: 0, stdout: "", stderr: "" }; }
    if (args[0] === "exec" && args[2].includes("start.sh")) return { code: 0, stdout: "OK\n", stderr: "" };
    if (args[0] === "exec" && args[2].includes("--video")) return { code: 0, stdout: "Replayed 12.0 s with 3 objects.\n", stderr: "" };
    if (args[0] === "copy" && args[1].startsWith("vm1:")) { fs.writeFileSync(args[2], "mp4"); return { code: 0, stdout: "", stderr: "" }; }
    return { code: 0, stdout: "", stderr: "" };
  };
  const render = createCarlaRender({ workspace: () => ws, config: () => config, run, replayScript: "/repo/carla_replay.py", pollMs: 1, retryMs: 1 });
  return { ws, dir, calls, render };
}
const until = async (check) => { for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(check()); };

test("a stopped VM is started, the package replayed, the video fetched, then the VM stopped again", async () => {
  const { dir, calls, render } = setup();
  const seen = [];
  const first = render.start(ID, "driver");
  assert.equal(first.status, "queued");
  await until(() => { const s = render.state(ID); if (s) seen.push(s.progress); return s?.status === "done"; });
  const done = render.state(ID);
  assert.equal(done.progress, 100);
  assert.equal(done.video, "carla-driver.mp4");
  assert.ok(fs.existsSync(join(dir, "carla-driver.mp4")));
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), "progress only grows");
  assert.ok(calls.includes("start vm1"));
  const replay = calls.find((c) => c.includes("--video"));
  assert.match(replay, /--view driver/);
  assert.match(replay, new RegExp(`render_${ID}\\.zip`));
  await until(() => calls.includes("stop vm1"));
  assert.equal(render.video(ID, "driver").path, join(dir, "carla-driver.mp4"));
});

test("a running VM is reused; a failing step ends the render as failed and names the step", async () => {
  const { calls, render } = setup({ status: "RUNNING", fail: "--video" });
  render.start(ID, "chase");
  await until(() => render.state(ID)?.status === "failed");
  assert.ok(!calls.includes("start vm1"));
  assert.equal(render.state(ID).error.code, "CARLA_RENDER_FAILED");
  assert.match(render.state(ID).error.message, /Dựng cảnh trên CARLA/);
  assert.throws(() => render.video(ID, "chase"), /NOT_FOUND/);
});

test("rejects bad input, a second render while busy, an unfinished export and a missing configuration", async () => {
  const { dir, render } = setup({ status: "RUNNING" });
  assert.throws(() => render.start("../x", "chase"), /INVALID_INPUT/);
  assert.throws(() => render.start(ID, "roof"), /INVALID_INPUT/);
  render.start(ID, "chase");
  assert.throws(() => render.start(ID, "driver"), /BUSY/);
  await until(() => render.state(ID)?.status === "done");
  fs.writeFileSync(join(dir, "job.json"), JSON.stringify({ id: ID, status: "done", format: "xosc" }));
  assert.throws(() => render.start(ID, "chase"), /INVALID_INPUT/);
  const off = setup({ config: null });
  assert.equal(off.render.info().available, false);
  assert.throws(() => off.render.start(ID, "chase"), /CARLA_NOT_CONFIGURED/);
});

test("a render left running by an earlier server reads as interrupted", () => {
  const { dir, render } = setup();
  fs.writeFileSync(join(dir, "carla-render.json"), JSON.stringify({ schema_version: 1, status: "running", progress: 40, step: "x", view: "chase", started_at: "2020-01-01T00:00:00Z" }));
  assert.equal(render.state(ID).status, "failed");
  assert.equal(render.state(ID).error.code, "INTERRUPTED");
});

test("a flaky SSH step is retried before the render fails, and the failure quotes brev", async () => {
  const flaky = setup({ status: "RUNNING" });
  let copies = 0;
  const base = flaky.render;
  const ws = fs.mkdtempSync(join(os.tmpdir(), "topeye-render-flaky-"));
  fs.cpSync(flaky.ws, ws, { recursive: true });
  const calls = [];
  const run = async (args) => {
    calls.push(args.join(" "));
    if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ workspaces: [{ name: "vm1", status: "RUNNING", health_status: "HEALTHY" }] }), stderr: "" };
    if (args[0] === "copy" && !args[1].startsWith("vm1:") && args[1].endsWith(".zip") && ++copies < 3)
      return { code: 1, stdout: "⣽ waiting for SSH connection to be available \u001b[K\rSSH to vm1 was not available after 3 attempts", stderr: "" };
    if (args[0] === "exec" && args[2].includes("start.sh")) return { code: 0, stdout: "OK\n", stderr: "" };
    if (args[0] === "exec" && args[2].includes("--video")) return { code: 0, stdout: "Replayed 1.0 s with 1 objects.\n", stderr: "" };
    if (args[0] === "copy" && args[1].startsWith("vm1:")) { fs.writeFileSync(args[2], "mp4"); return { code: 0, stdout: "", stderr: "" }; }
    return { code: 0, stdout: "", stderr: "" };
  };
  const render = createCarlaRender({ workspace: () => ws, config: () => CONFIG, run, replayScript: "/r.py", pollMs: 1, retryMs: 1 });
  render.start(ID, "chase");
  await until(() => render.state(ID)?.status === "done");
  assert.equal(copies, 3);
  void base;
  let always = 0;
  const broken = createCarlaRender({ workspace: () => ws, config: () => CONFIG, pollMs: 1, retryMs: 1, replayScript: "/r.py",
    run: async (args) => args[0] === "ls" ? run(args) : args[0] === "exec" ? ((always += 1), { code: 1, stdout: "⣽ waiting \u001b[K\rSSH to vm1 was not available after 3 attempts", stderr: "" }) : run(args) });
  await until(() => !render.busy());
  broken.start(ID, "chase");
  await until(() => broken.state(ID)?.status === "failed");
  assert.equal(always, 3);
  assert.match(broken.state(ID).error.message, /Chép gói lên máy: SSH to vm1 was not available after 3 attempts/);
});

test("the brev runner closes stdin, so brev exec never waits for input", async () => {
  const { brevRunner } = await import("./carla-render.mjs");
  // `cat` stands in for brev: it only exits once stdin is closed.
  const out = await brevRunner("cat")([], { timeout: 3000 });
  assert.equal(out.code, 0);
});
