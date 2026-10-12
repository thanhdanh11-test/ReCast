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
    staticDir, userData: join(dir, "user"), engine: join(dir, "missing.dylib"), version: "test",
    bridgeFactory: () => ({
      busy: false,
      stop: async () => {},
      request: async (method, params) => {
        calls.push({ method, params });
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
  const post = (name, body = {}, headers = {}) => fetch(`${url}/api/${name}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-Topeye-Token": f.host.token, ...headers },
  });
  return { ...f, port, url, post };
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
  const { url, host } = await start(t);
  assert.equal((await fetch(`${url}/api/events?token=bad`)).status, 403);
  const ok = await fetch(`${url}/api/events?token=${host.token}`);
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
