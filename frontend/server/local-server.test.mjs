import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { createLocalServer, validateArgs } from "./local-server.mjs";

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
        if (role === "main" && calls.mainBusy) throw Object.assign(new Error("BUSY: Một tác vụ đang chạy"), { code: "BUSY" });
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
