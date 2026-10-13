// Local account; credentials never leave the loopback host or enter browser storage.
import fs from "node:fs";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
const COOKIE = "topeye_session";
const TTL = 8 * 60 * 60 * 1000;
const WINDOW = 15 * 60 * 1000;
const error = (code, message) => Object.assign(new Error(message), { code });
const cookie = (value, age) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`;

export function createAuth({ path, now = Date.now }) {
  let account = null;
  try {
    account = JSON.parse(fs.readFileSync(path, "utf8"));
    if (account.schemaVersion !== 1 || typeof account.username !== "string" ||
        !/^[a-f0-9]{32}$/.test(account.salt) || !/^[a-f0-9]{128}$/.test(account.hash)) throw new Error("Invalid account file");
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  const sessions = new Map();
  let failed = [];
  let settingUp = false;
  const derive = (password, salt) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const id = (req) => {
    const values = String(req.headers.cookie || "").split(";").map(v => v.trim()).filter(v => v.startsWith(COOKIE + "="));
    return values.length === 1 ? values[0].slice(COOKIE.length + 1) : "";
  };
  const authenticated = (req) => {
    for (const [key, expiry] of sessions) if (expiry <= now()) sessions.delete(key);
    return sessions.has(id(req));
  };
  const status = (req) => ({ configured: !!account, authenticated: authenticated(req), ...(authenticated(req) ? { username: account.username } : {}) });
  const credentials = (args) => {
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(k => !["username", "password"].includes(k)) ||
        typeof args.username !== "string" || !/^[A-Za-z0-9_.-]{3,64}$/.test(args.username) ||
        typeof args.password !== "string" || args.password.length < 12 || args.password.length > 128)
      throw error("INVALID_INPUT", "Tên đăng nhập 3–64 ký tự (chữ, số, dấu . _ -); mật khẩu 12–128 ký tự.");
    return args;
  };
  const issue = (res) => {
    const key = randomBytes(32).toString("hex");
    for (const [id, expiry] of sessions) if (expiry <= now()) sessions.delete(id);
    if (sessions.size >= 16) sessions.delete(sessions.keys().next().value);
    sessions.set(key, now() + TTL);
    res.setHeader("Set-Cookie", cookie(key, TTL / 1000));
    return { configured: true, authenticated: true, username: account.username };
  };
  return {
    authenticated, status,
    async setup(args, res) {
      if (account || settingUp) throw error("ACCOUNT_EXISTS", "Tài khoản đã được tạo. Hãy đăng nhập.");
      const { username, password } = credentials(args);
      settingUp = true;
      try {
        const salt = randomBytes(16).toString("hex");
        const next = { schemaVersion: 1, username, salt, hash: (await derive(password, salt)).toString("hex") };
        try { fs.writeFileSync(path, JSON.stringify(next), { flag: "wx", mode: 0o600 }); }
        catch (e) { if (e.code === "EEXIST") throw error("ACCOUNT_EXISTS", "Tài khoản đã được tạo."); throw e; }
        account = next;
        return issue(res);
      } finally { settingUp = false; }
    },
    async login(args, res) {
      const { username, password } = credentials(args);
      failed = failed.filter(t => now() - t < WINDOW);
      if (failed.length >= 5) throw error("RATE_LIMITED", "Quá nhiều lần thử. Vui lòng thử lại sau 15 phút.");
      // Reserve an attempt before async hashing so concurrent requests cannot bypass the limit.
      failed.push(now());
      const hash = await derive(password, account?.salt || "0".repeat(32));
      const match = timingSafeEqual(hash, Buffer.from(account?.hash || "0".repeat(128), "hex"));
      if (!account || !match || username !== account.username) throw error("INVALID_CREDENTIALS", "Tên đăng nhập hoặc mật khẩu không đúng.");
      failed = [];
      return issue(res);
    },
    logout(req, res) {
      sessions.delete(id(req));
      res.setHeader("Set-Cookie", cookie("", 0));
      return { configured: !!account, authenticated: false };
    },
  };
}
