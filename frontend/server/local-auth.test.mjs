import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { createAuth } from "./local-auth.mjs";
const credentials = { username: "test-user", password: "test-only-passphrase-4831" };
function fixture(t) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "topeye-auth-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "account.json");
  let timestamp = 1000000;
  const options = { path, now: () => timestamp };
  const auth = createAuth(options);
  let cookie;
  const res = { setHeader: (_name, value) => cookie = value };
  return { auth, res, path, options, request: () => ({ headers: { cookie: cookie?.split(";")[0] } }), advance: ms => timestamp += ms, cookie: () => cookie };
}
test("setup hashes credentials privately, issues HttpOnly session, and cannot overwrite account", async t => {
  const f = fixture(t);
  assert.deepEqual(f.auth.status({ headers: {} }), { configured: false, authenticated: false });
  assert.equal((await f.auth.setup(credentials, f.res)).authenticated, true);
  const raw = fs.readFileSync(f.path, "utf8");
  assert.ok(!raw.includes(credentials.password));
  assert.equal(JSON.parse(raw).hash.length, 128);
  assert.equal(fs.statSync(f.path).mode & 0o777, 0o600);
  assert.match(f.cookie(), /HttpOnly; SameSite=Strict/);
  assert.equal(f.auth.authenticated(f.request()), true);
  await assert.rejects(f.auth.setup(credentials, f.res), { code: "ACCOUNT_EXISTS" });
  assert.equal(fs.readFileSync(f.path, "utf8"), raw);
});
test("logout, expiry and restart revoke sessions", async t => {
  const f = fixture(t);
  await f.auth.setup(credentials, f.res);
  const req = f.request();
  assert.equal(createAuth(f.options).authenticated(req), false);
  f.auth.logout(req, f.res);
  assert.equal(f.auth.authenticated(req), false);
  await f.auth.login(credentials, f.res);
  f.advance(8 * 60 * 60 * 1000);
  assert.equal(f.auth.authenticated(f.request()), false);
});
test("parallel wrong passwords cannot bypass five-attempt throttle; cooldown expires", async t => {
  const f = fixture(t);
  await f.auth.setup(credentials, f.res);
  const wrong = { ...credentials, password: "wrong-password-long-enough" };
  const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => f.auth.login(wrong, f.res)));
  const codes = attempts.map(r => r.reason?.code);
  assert.equal(codes.filter(c => c === "INVALID_CREDENTIALS").length, 5);
  assert.equal(codes.filter(c => c === "RATE_LIMITED").length, 5);
  await assert.rejects(f.auth.login(credentials, f.res), { code: "RATE_LIMITED" });
  f.advance(15 * 60 * 1000);
  assert.equal((await f.auth.login(credentials, f.res)).authenticated, true);
});
test("setup race has exactly one winner", async t => {
  const f = fixture(t);
  const results = await Promise.allSettled([f.auth.setup(credentials, f.res), f.auth.setup({ ...credentials, username: "other-user" }, f.res)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected" && r.reason.code === "ACCOUNT_EXISTS").length, 1);
});
test("rejects malformed credentials and corrupt persisted account; no fallback to setup", async t => {
  const f = fixture(t);
  for (const args of [null, [], { ...credentials, username: "../../owner" }, { ...credentials, password: "short" }, { ...credentials, admin: true }])
    await assert.rejects(f.auth.setup(args, f.res), { code: "INVALID_INPUT" });
  assert.equal(fs.existsSync(f.path), false);
  fs.writeFileSync(f.path, '{}');
  assert.throws(() => createAuth(f.options), /Invalid account file/);
});
test("unknown username and wrong password share the same error", async t => {
  const f = fixture(t);
  await f.auth.setup(credentials, f.res);
  const messages = [];
  for (const args of [{ ...credentials, username: "unknown-user" }, { ...credentials, password: "another-wrong-passphrase" }]) {
    try { await f.auth.login(args, f.res); } catch (e) { messages.push([e.code, e.message]); }
  }
  assert.deepEqual(messages[0], messages[1]);
});
test("password change verifies the current password, revokes other sessions and keeps the caller signed in", async t => {
  const f = fixture(t);
  await f.auth.setup(credentials, f.res);
  const other = f.request();
  await f.auth.login(credentials, f.res);
  const caller = f.request();
  const next = "brand-new-passphrase-9921";
  await assert.rejects(f.auth.changePassword(caller, { current: "wrong-password-long-enough", next }, f.res), { code: "INVALID_CREDENTIALS" });
  await assert.rejects(f.auth.changePassword(caller, { current: credentials.password, next: "short" }, f.res), { code: "INVALID_INPUT" });
  assert.deepEqual(await f.auth.changePassword(caller, { current: credentials.password, next }, f.res), { ok: true });
  assert.equal(f.auth.authenticated(other), false);
  assert.equal(f.auth.authenticated(caller), false);
  assert.equal(f.auth.authenticated(f.request()), true); // rotated cookie
  assert.equal(fs.statSync(f.path).mode & 0o777, 0o600);
  await assert.rejects(f.auth.login(credentials, f.res), { code: "INVALID_CREDENTIALS" });
  assert.equal((await createAuth(f.options).login({ ...credentials, password: next }, f.res)).authenticated, true);
});
test("password change shares the five-attempt throttle", async t => {
  const f = fixture(t);
  await f.auth.setup(credentials, f.res);
  const caller = f.request();
  for (let i = 0; i < 5; i++)
    await assert.rejects(f.auth.changePassword(caller, { current: "wrong-password-long-enough", next: "brand-new-passphrase-9921" }, f.res), { code: "INVALID_CREDENTIALS" });
  await assert.rejects(f.auth.changePassword(caller, { current: credentials.password, next: "brand-new-passphrase-9921" }, f.res), { code: "RATE_LIMITED" });
});
test("session hours persist and bound new sessions only to the chosen lifetime", async t => {
  const f = fixture(t);
  await f.auth.setup(credentials, f.res);
  assert.throws(() => f.auth.setSessionHours({ hours: 3 }), { code: "INVALID_INPUT" });
  assert.deepEqual(f.auth.setSessionHours({ hours: 1 }), { hours: 1 });
  assert.equal(createAuth(f.options).status({ headers: {} }).configured, true);
  await f.auth.login(credentials, f.res);
  assert.match(f.cookie(), /Max-Age=3600/);
  assert.equal(f.auth.status(f.request()).sessionHours, 1);
  f.advance(60 * 60 * 1000);
  assert.equal(f.auth.authenticated(f.request()), false);
});
