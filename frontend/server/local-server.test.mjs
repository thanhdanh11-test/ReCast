import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { createLocalServer, statusFor, validateArgs } from "./local-server.mjs";

function fixture(t, calls = []) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "topeye-local-"));
  const staticDir = join(dir, "static");
  fs.mkdirSync(staticDir);
  fs.writeFileSync(join(staticDir, "index.html"), '<meta name="topeye-token" content="__TOPEYE_TOKEN__">');
  fs.writeFileSync(join(dir, "secret.txt"), "secret");
  const dataset = join(dir, "dataset");
  fs.mkdirSync(dataset);
  const host = createLocalServer({
    staticDir, userData: join(dir, "user"), catalogSeeds: [], engine: join(dir, "missing.dylib"), version: "test",
    bridgeFactory: ({ role = "main" }) => ({
      get busy() { return role === "main" && calls.mainBusy === true; },
      stop: async () => {},
      request: async (method, params) => {
        if (role === "main" && calls.mainBusy && !calls.queueReadonly) throw Object.assign(new Error("BUSY: Một tác vụ đang chạy"), { code: "BUSY" });
        calls.push({ method, params, role });
        return method === "inspect_dataset" ? { root: params.dataset, version: "v1.0-mini", scenes: [] } : { ok: method };
      },
    }),
  });
  t.after(() => host.close());
  return { host, dataset, dir };
}
async function start(t, calls) {
  const f = fixture(t, calls);
  const port = await f.host.listen(0);
  const url = `http://127.0.0.1:${port}`;
  let cookie = "";
  const post = (name, body = {}, headers = {}) => fetch(`${url}/api/${name}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-Topeye-Token": f.host.token, Cookie: cookie, ...headers },
  });
  const setup = await post("auth/setup", { username: "test-owner", password: "test-only-passphrase" });
  assert.equal(setup.status, 200);
  cookie = setup.headers.get("set-cookie").split(";")[0];
  return { ...f, port, url, post, cookie };
}

test("binds loopback only", async (t) => {
  const { host } = await start(t);
  assert.equal(host.server.address().address, "127.0.0.1");
});

test("index embeds the per-run token", async (t) => {
  const { url, host } = await start(t);
  const html = await (await fetch(url + "/")).text();
  assert.ok(html.includes(host.token));
  assert.equal(host.token.length, 64);
});

test("rejects missing or wrong token", async (t) => {
  const { post } = await start(t);
  assert.equal((await post("settings", {}, { "X-Topeye-Token": "" })).status, 403);
  assert.equal((await post("settings", {}, { "X-Topeye-Token": "0".repeat(64) })).status, 403);
  assert.equal((await post("settings")).status, 200);
});

test("rejects foreign Origin and Host (DNS rebinding)", async (t) => {
  const { post, port } = await start(t);
  assert.equal((await post("settings", {}, { Origin: "http://evil.example" })).status, 403);
  const http = await import("node:http");
  const status = await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/", headers: { Host: "evil.example" } }, (res) => resolve(res.statusCode));
    req.end();
  });
  assert.equal(status, 403);
});

test("event stream needs the token", async (t) => {
  const { url, host, cookie } = await start(t);
  assert.equal((await fetch(`${url}/api/events?token=bad`)).status, 403);
  const ok = await fetch(`${url}/api/events?token=${host.token}`, { headers: { Cookie: cookie } });
  assert.equal(ok.status, 200);
  await ok.body.cancel();
});

test("static files cannot escape the build directory", async (t) => {
  const { url } = await start(t);
  for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt"])
    assert.equal((await fetch(url + path)).status, 404, path);
});

test("unknown fields and methods are rejected", async (t) => {
  const { post } = await start(t);
  const r = await post("sourceScene", { scene: "scene-0061", path: "/etc" });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "INVALID_INPUT");
  assert.equal((await post("readFile", { path: "/etc/passwd" })).status, 404);
});

test("worker calls require a dataset, then carry server-owned params", async (t) => {
  const calls = [];
  const { post, dataset } = await start(t, calls);
  assert.equal((await (await post("listScenes")).json()).code, "DATASET_INVALID");
  const chosen = await (await post("chooseDataset", { path: dataset })).json();
  assert.equal(chosen.value.version, "v1.0-mini");
  await post("sourceScene", { scene: "scene-0061" });
  const last = calls.at(-1);
  assert.equal(last.method, "source_scene");
  assert.equal(last.params.dataset, fs.realpathSync(dataset));
  assert.ok("engine" in last.params && "workspace" in last.params);
});

test("chooseDataset rejects a missing directory", async (t) => {
  const { post, dir } = await start(t);
  const r = await post("chooseDataset", { path: join(dir, "nope") });
  assert.equal(r.status, 400);
});

test("openImported refuses packages inside the dataset", async (t) => {
  const { post, dataset } = await start(t);
  await post("chooseDataset", { path: dataset });
  const r = await post("openImported", { source_id: "a".repeat(32), path: dataset });
  assert.equal((await r.json()).code, "PATH_ESCAPE");
});

test("importXosc bounds payload and identity", async (t) => {
  const { post, dataset } = await start(t);
  await post("chooseDataset", { path: dataset });
  const big = Buffer.alloc(2097153, 65).toString("base64");
  assert.equal((await (await post("importXosc", { source_id: "a".repeat(32), xml_base64: big })).json()).code, "RESOURCE_LIMIT");
  assert.equal((await (await post("importXosc", { source_id: "x", xml_base64: "" })).json()).code, "INVALID_INPUT");
});

test("validateArgs enforces the request allowlist", () => {
  assert.throws(() => validateArgs("replayImported", { scenario_id: "../x" }), /Invalid scenario identity/);
  assert.throws(() => validateArgs("extract", []), /Invalid request/);
  // plan50 exports
  assert.doesNotThrow(() => validateArgs("exportScenario", { scenario_id: "a".repeat(32), format: "carla" }));
  assert.throws(() => validateArgs("exportScenario", { scenario_id: "a".repeat(32), format: "zip" }), /Invalid export format/);
  assert.throws(() => validateArgs("exportScenario", { scenario_id: "../x", format: "xosc" }), /Invalid scenario/);
  assert.throws(() => validateArgs("deleteExport", { id: "../../x" }), /Invalid export identity/);
  assert.throws(() => validateArgs("listExports", { path: "/" }), /Unknown field/);
  assert.doesNotThrow(() => validateArgs("extract", { scene: "s", actor_tokens: [], start_s: 1, end_s: 2 }));
});

test("lidarFrame validates input and uses its own worker while the main worker is busy", async (t) => {
  const calls = [];
  const { post, dataset } = await start(t, calls);
  await post("chooseDataset", { path: dataset });
  for (const bad of [{ scene: "../x", time_s: 1 }, { scene: "scene-0103", time_s: "1" }, { scene: "scene-0103" }, { scene: "scene-0103", time_s: 1, path: "/" }])
    assert.equal((await post("lidarFrame", bad)).status, 400, JSON.stringify(bad));
  calls.mainBusy = true;
  assert.equal((await post("listScenes")).status, 409);
  const ok = await post("lidarFrame", { scene: "scene-0103", time_s: 6 });
  assert.equal(ok.status, 200);
  const last = calls.at(-1);
  assert.deepEqual([last.method, last.role, last.params.scene, last.params.time_s], ["lidar_frame", "lidar", "scene-0103", 6]);
});

test("library listing and named imports pass through the allowlist", async (t) => {
  const calls = [];
  const { post, dataset } = await start(t, calls);
  await post("chooseDataset", { path: dataset });
  assert.equal((await post("listImported", { path: "/" })).status, 400);
  assert.equal((await post("listImported")).status, 200);
  assert.equal(calls.at(-1).method, "list_imported");
  const xml_base64 = Buffer.from("<x/>").toString("base64");
  assert.equal((await post("importXosc", { source_id: "a".repeat(32), xml_base64, file_name: "x".repeat(241) })).status, 400);
  await post("importXosc", { source_id: "a".repeat(32), xml_base64, file_name: "cut-in.xosc" });
  assert.equal(calls.at(-1).params.file_name, "cut-in.xosc");
});

test("importTemplate forwards a bounded template object to the worker", async (t) => {
  const calls = [];
  const { post, dataset } = await start(t, calls);
  await post("chooseDataset", { path: dataset });
  for (const bad of [{ source_id: "x", template: {} }, { source_id: "a".repeat(32), template: [] }, { source_id: "a".repeat(32), template: "t" },
    { source_id: "a".repeat(32), template: { name: "x".repeat(300 * 1024) } }, { source_id: "a".repeat(32), template: {}, path: "/" }])
    assert.equal((await post("importTemplate", bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  const template = { profile: "topeye-scenario-template-v1", name: "cut-in" };
  assert.equal((await post("importTemplate", { source_id: "a".repeat(32), template })).status, 200);
  assert.deepEqual([calls.at(-1).method, calls.at(-1).params.template], ["import_template", template]);
});

test("importPackage forwards a bounded real2sim package to the main worker", async (t) => {
  const calls = [];
  const { post, dataset } = await start(t, calls);
  await post("chooseDataset", { path: dataset });
  const b64 = Buffer.from("<x/>").toString("base64");
  const id = "a".repeat(32);
  for (const files of [[], [{ name: "report.json", data_base64: b64 }], [{ name: "a.xosc", data_base64: b64 }, { name: "b.xosc", data_base64: b64 }],
    [{ name: "../a.xosc", data_base64: b64 }], [{ name: "map.xodr", data_base64: b64 }], [{ name: "a.xosc", data_base64: "!!" }],
    [{ name: "a.xosc", data_base64: b64, path: "/" }], [{ name: "a.xosc", data_base64: b64 }, { name: "report.json", data_base64: b64 }, { name: "report.json", data_base64: b64 }]])
    assert.equal((await post("importPackage", { source_id: id, files })).status, 400, JSON.stringify(files).slice(0, 80));
  assert.equal((await post("importPackage", { source_id: "x", files: [{ name: "a.xosc", data_base64: b64 }] })).status, 400);
  const files = [{ name: "car_013.xosc", data_base64: b64 }, { name: "report.json", data_base64: b64 }, { name: "trajectories.csv", data_base64: b64 }];
  assert.equal((await post("importPackage", { source_id: id, files })).status, 200);
  assert.deepEqual([calls.at(-1).method, calls.at(-1).params.files.length], ["import_package", 3]);
  // Larger than the usual 4 MiB body but within the package budget is accepted; beyond it is refused.
  const big = "A".repeat(5 * 1024 * 1024);
  assert.equal((await post("importPackage", { source_id: id, files: [{ name: "a.xosc", data_base64: big }] })).status, 200);
  assert.equal((await post("importPackage", { source_id: id, files: [{ name: "a.xosc", data_base64: "A".repeat(8 * 1024 * 1024) }] })).status, 400);
});

test("reactiveCandidates and importReactive route to the main worker with a bounded event object", async (t) => {
  const calls = [];
  const { post, dataset } = await start(t, calls);
  await post("chooseDataset", { path: dataset });
  const id = "a".repeat(32);
  const event = { actor_id: "a1", t0_s: 2, decel_mps2: 4, target: "stop", dwell_s: 0, react: true, reaction_s: 1 };
  for (const bad of [{ source_id: id }, { source_id: id, event: [] }, { source_id: id, event: "e" }, { source_id: id, event: null },
    { source_id: "x", event }, { source_id: id, event, path: "/" }])
    assert.equal((await post("importReactive", bad)).status, 400, JSON.stringify(bad));
  // Over the 64 KiB argument budget: refused like every other bounded call (INVALID_INPUT "Request too large").
  assert.equal((await post("importReactive", { source_id: id, event: { actor_id: "x".repeat(65 * 1024) } })).status, 400);
  assert.equal((await post("reactiveCandidates", { source_id: "x" })).status, 400);
  assert.equal((await post("reactiveCandidates", { source_id: id, event })).status, 400);
  assert.equal((await post("reactiveCandidates", { source_id: id })).status, 200);
  assert.deepEqual([calls.at(-1).method, calls.at(-1).role, calls.at(-1).params.source_id], ["reactive_candidates", "main", id]);
  assert.equal((await post("importReactive", { source_id: id, event })).status, 200);
  assert.deepEqual([calls.at(-1).method, calls.at(-1).params.source_id, calls.at(-1).params.event], ["import_reactive", id, event]);
  calls.mainBusy = true;
  calls.queueReadonly=true;
  assert.equal((await post("reactiveCandidates",{source_id:id})).status,200);
  assert.equal((await post("mapContext",{source_id:id})).status,200);
  assert.equal((await post("importReactive",{source_id:id,event})).status,409);

});

test("plan46: reactiveSensitivity on the main worker; scene metrics and esminiCheck on the metrics worker", async (t) => {
  const calls = [];
  const { post, dataset } = await start(t, calls);
  await post("chooseDataset", { path: dataset });
  const id = "a".repeat(32);
  const event = { actor_id: "a1", t0_s: 2, decel_mps2: 4, target: "stop", dwell_s: 0, react: true, reaction_s: 1 };
  for (const [name, bad] of [
    ["reactiveSensitivity", { source_id: id }], ["reactiveSensitivity", { source_id: id, event: [] }], ["reactiveSensitivity", { source_id: "x", event }],
    ["reactiveSensitivity", { source_id: id, event: { actor_id: "x".repeat(65 * 1024) } }],
    ["reactiveMetrics", {}], ["reactiveMetrics", { scene: "../x" }], ["reactiveMetrics", { scene: "scene-0061", reactions: [] }],
    ["reactiveMetrics", { scene: "scene-0061", reactions: [0.7, 1, 1.5, 2] }], ["reactiveMetrics", { scene: "scene-0061", reactions: [0.2] }],
    ["reactiveMetrics", { scene: "scene-0061", reactions: [3.5] }], ["reactiveMetrics", { scene: "scene-0061", reactions: ["1"] }],
    ["reactiveMetrics", { scene: "scene-0061", reactions: 1 }], ["reactiveMetrics", { scene: "scene-0061", source_id: id }],
    ["reactiveMetrics", { scene: "scene-0061", kinds: [] }], ["reactiveMetrics", { scene: "scene-0061", kinds: ["brake", "brake"] }],
    ["reactiveMetrics", { scene: "scene-0061", kinds: ["swerve"] }], ["reactiveMetrics", { scene: "scene-0061", kinds: "brake" }],
    ["replayErrorMetrics", { scene: "x".repeat(65) }], ["replayErrorMetrics", { scene: "scene-0061", reactions: [1] }],
    ["esminiCheck", { scenario_id: "../x" }], ["esminiCheck", { scenario_id: "A".repeat(32) }], ["esminiCheck", { scenario_id: id, scene: "scene-0061" }]])
    assert.equal((await post(name, bad)).status, 400, `${name} ${JSON.stringify(bad).slice(0, 80)}`);
  assert.equal(calls.filter((c) => c.method !== "inspect_dataset").length, 0);
  assert.equal((await post("reactiveSensitivity", { source_id: id, event })).status, 200);
  assert.deepEqual([calls.at(-1).method, calls.at(-1).role, calls.at(-1).params.event], ["reactive_sensitivity", "main", event]);
  calls.mainBusy = true;
  assert.equal((await post("reactiveSensitivity", { source_id: id, event })).status, 409);
  // The metrics worker stays available while the main worker is busy.
  for (const [name, body, method] of [["reactiveMetrics", { scene: "scene-0061", reactions: [0.7, 1, 1.5] }, "reactive_metrics"],
    ["reactiveMetrics", { scene: "scene-0061" }, "reactive_metrics"],
    ["reactiveMetrics", { scene: "scene-0061", kinds: ["brake", "accelerate", "stopline", "lane_change"] }, "reactive_metrics"], ["replayErrorMetrics", { scene: "scene-0061" }, "replay_error_metrics"],
    ["esminiCheck", { scenario_id: id }, "esmini_check"]]) {
    assert.equal((await post(name, body)).status, 200, name);
    assert.deepEqual([calls.at(-1).method, calls.at(-1).role], [method, "metrics"]);
    for (const [k, v] of Object.entries(body)) assert.deepEqual(calls.at(-1).params[k], v);
  }
});

test("templateFit probes a scene on the metrics worker", async (t) => {
  const calls = [];
  const { post, dataset } = await start(t, calls);
  await post("chooseDataset", { path: dataset });
  for (const bad of [{ scene: "../x", template: {} }, { scene: "scene-0061", template: [] }, { scene: "scene-0061" }, { scene: "scene-0061", template: {}, source_id: "a".repeat(32) }])
    assert.equal((await post("templateFit", bad)).status, 400, JSON.stringify(bad));
  calls.mainBusy = true;
  assert.equal((await post("templateFit", { scene: "scene-0061", template: { name: "x" } })).status, 200);
  assert.deepEqual([calls.at(-1).method, calls.at(-1).role, calls.at(-1).params.scene], ["template_fit", "metrics", "scene-0061"]);
});

test("read/delete library packages only by scenario id", async (t) => {
  const calls = [];
  const { post, dataset } = await start(t, calls);
  await post("chooseDataset", { path: dataset });
  for (const name of ["readImported", "deleteImported"]) {
    assert.equal((await post(name, { scenario_id: "../../etc" })).status, 400);
    assert.equal((await post(name, { scenario_id: "a".repeat(32), path: "/" })).status, 400);
    assert.equal((await post(name, { scenario_id: "a".repeat(32) })).status, 200);
  }
  assert.deepEqual(calls.slice(-2).map(c => [c.method, c.params.scenario_id]), [["read_imported", "a".repeat(32)], ["delete_imported", "a".repeat(32)]]);
});

test("worker bridge queues concurrent requests instead of refusing them", async () => {
  const { createWorkerBridge } = await import("./worker-bridge.mjs");
  // Tiny JSONL echo worker: answers each request after 30 ms.
  const script = `process.stdout.write(JSON.stringify({type:"ready"})+"\\n");let b="";process.stdin.on("data",d=>{b+=d;let i;while((i=b.indexOf("\\n"))>=0){const m=JSON.parse(b.slice(0,i));b=b.slice(i+1);setTimeout(()=>process.stdout.write(JSON.stringify({id:m.id,type:"result",value:m.method})+"\\n"),30);}});`;
  const bridge = createWorkerBridge({ command: process.execPath, args: ["-e", script], env: process.env });
  try {
    const results = await Promise.all(["a", "b", "c"].map((m) => bridge.request(m, {})));
    assert.deepEqual(results, ["a", "b", "c"]);
    const slow = bridge.request("x", {}).catch((e) => e), queued = bridge.request("y", {}).catch((e) => e);
    await bridge.stop();
    assert.match(String(await queued), /CANCELLED/);
    assert.match(String(await slow), /CANCELLED|ENGINE_FAILED/);
  } finally { await bridge.stop(); }
});

test("scenarioMetrics validates the scenario id and runs on its own worker", async (t) => {
  const calls = [];
  const { post, dataset } = await start(t, calls);
  await post("chooseDataset", { path: dataset });
  const id = "a".repeat(32);
  assert.equal((await post("scenarioMetrics", { scenario_id: "../x" })).status, 400);
  assert.equal((await post("scenarioMetrics", { scenario_id: id, extra: 1 })).status, 400);
  assert.equal((await post("scenarioMetrics", { scenario_id: id })).status, 200);
  assert.deepEqual([calls.at(-1).method, calls.at(-1).role, calls.at(-1).params.scenario_id], ["scenario_metrics", "metrics", id]);
});

test("run deletion validates both scoped identities", () => {
  const args = { scenario_id: "a".repeat(32), run_id: "b".repeat(32) };
  assert.doesNotThrow(() => validateArgs("deleteImportedRun", args));
  assert.throws(() => validateArgs("deleteImportedRun", { ...args, run_id: "../other" }), /Invalid run identity/);
  assert.throws(() => validateArgs("deleteImportedRun", { ...args, scenario_id: "../other" }), /Invalid scenario identity/);
  assert.throws(() => validateArgs("deleteImportedRun", { ...args, path: "/tmp" }), /Unknown field/);
});
test("reopens the same dataset read-only during a pending worker without allowing a dataset change",async t=>{
 const calls=[];const {post,dataset,dir}=await start(t,calls);
 assert.equal((await post("chooseDataset",{path:dataset})).status,200);
 calls.mainBusy=true;calls.queueReadonly=true;
 assert.equal((await post("chooseDataset",{path:dataset})).status,200);
 assert.equal(calls.at(-1).method,"list_scenes");
 const other=join(dir,"other-dataset");fs.mkdirSync(other);
 assert.equal((await post("chooseDataset",{path:other})).status,409);
});

test("plan50: an unreadable export zip is a 404, never a crashed server (review F1)", async () => {
  const root = fs.mkdtempSync(join(os.tmpdir(), "topeye-zip-"));
  const ws = join(root, "ws"), userData = join(root, "user");
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(join(userData, "scenario-settings.json"), JSON.stringify({ workspace: ws, dataset: "/nonexistent", datasetVersion: "v1.0-mini" }));
  const make = (id, kind) => {
    const dir = join(ws, "exports", id); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, "job.json"), JSON.stringify({ id, status: "done", progress: 100, created_at: "2030-01-01T00:00:00Z" }));
    if (kind === "dir") fs.mkdirSync(join(dir, "s.zip"));
    else if (kind === "perm") { fs.writeFileSync(join(dir, "s.zip"), "PK"); fs.chmodSync(join(dir, "s.zip"), 0o000); }
    else if (kind === "link") { fs.writeFileSync(join(root, "secret.txt"), "TOP-SECRET"); fs.symlinkSync(join(root, "secret.txt"), join(dir, "s.zip")); }
    else fs.writeFileSync(join(dir, "s.zip"), "PK-OK");
  };
  const ids = { dir: "1".repeat(32), perm: "2".repeat(32), link: "3".repeat(32), ok: "4".repeat(32) };
  for (const [kind, id] of Object.entries(ids)) make(id, kind);
  const host = createLocalServer({ staticDir: root, userData, catalogSeeds: [], version: "t", bridgeFactory: () => ({ busy: false, stop: async () => {}, request: async () => ({}) }) });
  const port = await host.listen(0);
  try {
    const setup = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, { method: "POST", body: JSON.stringify({ username: "zip-owner", password: "zip-only-passphrase" }), headers: { "Content-Type": "application/json", "X-Topeye-Token": host.token } });
    const cookie = setup.headers.get("set-cookie").split(";")[0];
    const get = (id) => fetch(`http://127.0.0.1:${port}/api/exports/${id}.zip?token=${host.token}`, { headers: { Cookie: cookie } });
    for (const kind of ["dir", "perm", "link"]) assert.equal((await get(ids[kind])).status, 404, kind);
    const ok = await get(ids.ok);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "PK-OK");
  } finally { await host.close(); fs.chmodSync(join(ws, "exports", ids.perm, "s.zip"), 0o600); fs.rmSync(root, { recursive: true, force: true }); }
});

test("plan52: user input rejected by the worker is 400; only server/worker failures are 500", () => {
  for (const code of ["STATIC_OBSTACLE", "OUTSIDE_SURFACE", "DYNAMIC_LIMIT", "INVALID_TEMPLATE", "EVENT_NOT_ALLOWED", "EGO_COLLISION", "INVALID_INPUT"]) assert.equal(statusFor(code), 400, code);
  for (const code of ["INTERNAL", "IO_ERROR", "ENGINE_FAILED", "TIMEOUT", undefined, "weird code"]) assert.equal(statusFor(code), 500, String(code));
  assert.equal(statusFor("BUSY"), 409);
  assert.equal(statusFor("UNAUTHENTICATED"), 401);
});
