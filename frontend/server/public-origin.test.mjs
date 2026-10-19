// plan61: public mode behind a reverse proxy (one declared https origin, CLI-only account setup).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalServer } from "./local-server.mjs";

const PUBLIC = "https://demo.example";
const credentials = { username: "vps-owner", password: "only-in-test-passphrase" };

async function fixture(t, publicOrigin, prepare = () => {}) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "topeye-public-"));
  const staticDir = join(dir, "static"); fs.mkdirSync(staticDir);
  fs.writeFileSync(join(staticDir, "index.html"), "__TOPEYE_TOKEN__");
  const userData = join(dir, "user");
  prepare(userData);
  const host = createLocalServer({ staticDir, userData, catalogSeeds: [], publicOrigin,
    bridgeFactory: () => ({ busy: false, stop: async () => {}, request: async () => ({ ok: true }) }) });
  const port = await host.listen(0);
  t.after(async () => { await host.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  // fetch() cannot override Host, so requests go through http.request.
  const post = (name, body, headers = {}) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path: "/api/" + name, method: "POST",
      headers: { "Content-Type": "application/json", "X-Topeye-Token": host.token, Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = ""; res.on("data", (c) => text += c); res.on("end", () => resolve({ status: res.statusCode, cookie: res.headers["set-cookie"]?.[0] ?? "", body: text }));
    });
    req.on("error", reject); req.end(data);
  });
  return { dir, userData, post };
}

test("without a public origin, a proxied host is still rejected", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.post("auth/login", credentials, { Host: "demo.example", Origin: PUBLIC })).status, 403);
});

test("public origin admits exactly its host and origin", async (t) => {
  const f = await fixture(t, PUBLIC);
  assert.equal((await f.post("auth/login", credentials, { Host: "demo.example", Origin: PUBLIC })).status, 401);
  assert.equal((await f.post("auth/login", credentials, { Host: "demo.example", Origin: "https://evil.example" })).status, 403);
  assert.equal((await f.post("auth/login", credentials, { Host: "demo.example.evil", Origin: PUBLIC })).status, 403);
  assert.equal((await f.post("auth/login", credentials, { Host: "demo.example", Origin: "http://demo.example" })).status, 403);
});

test("invalid public origins refuse to start", () => {
  for (const value of ["http://demo.example", "https://demo.example/", "https://demo.example/app", "https://u:p@demo.example", "demo.example"])
    assert.throws(() => createLocalServer({ publicOrigin: value, catalogSeeds: [] }), /TOPEYE_PUBLIC_ORIGIN/, value);
});

test("public mode refuses web account setup and creates no account file", async (t) => {
  const f = await fixture(t, PUBLIC);
  const r = await f.post("auth/setup", credentials, { Host: "demo.example", Origin: PUBLIC });
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(r.body).code, "SETUP_DISABLED");
  assert.equal(fs.existsSync(join(f.userData, "local-account.json")), false);
});

test("session cookie is Secure only in public mode", async (t) => {
  const local = await fixture(t);
  const localCookie = (await local.post("auth/setup", credentials)).cookie;
  assert.match(localCookie, /HttpOnly/);
  assert.doesNotMatch(localCookie, /Secure/);

  // The account is made by the CLI before the public server starts (OPERATIONS §2.6).
  const pub = await fixture(t, PUBLIC, (userData) => execCli(userData, [credentials.username], credentials.password));
  const login = await pub.post("auth/login", credentials, { Host: "demo.example", Origin: PUBLIC });
  assert.equal(login.status, 200);
  assert.match(login.cookie, /; Secure/);
});

const cli = fileURLToPath(new URL("./create-account.mjs", import.meta.url));
function execCli(userData, args, input) {
  return execFileSync(process.execPath, [cli, ...args], { input: input + "\n", env: { ...process.env, TOPEYE_USER_DATA: userData } });
}

test("create-account CLI: creates a private account once, validates input", (t) => {
  const userData = fs.mkdtempSync(join(os.tmpdir(), "topeye-cli-"));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { input: input + "\n", env: { ...process.env, TOPEYE_USER_DATA: userData } });
  assert.equal(run([credentials.username], "short").status, 1);
  assert.equal(fs.existsSync(join(userData, "local-account.json")), false);
  const ok = run([credentials.username], credentials.password);
  assert.equal(ok.status, 0, ok.stderr.toString());
  assert.equal(fs.statSync(join(userData, "local-account.json")).mode & 0o777, 0o600);
  assert.doesNotMatch(ok.stdout.toString() + ok.stderr.toString(), new RegExp(credentials.password));
  assert.equal(run([credentials.username], credentials.password).status, 2);
});
