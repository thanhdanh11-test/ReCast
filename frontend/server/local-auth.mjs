// Local account; credentials never leave the loopback host or enter browser storage.
import fs from "node:fs";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
const COOKIE = "topeye_session";
const HOURS = [1, 8, 24, 168];
const HOUR = 60 * 60 * 1000;
const WINDOW = 15 * 60 * 1000;
const error = (code, message) => Object.assign(new Error(message), { code });
const cookie = (value, age) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`;

export function createAuth({ path, now = Date.now }) {
  let account = null;
  try {
    account = JSON.parse(fs.readFileSync(path, "utf8"));
    if (account.schemaVersion !== 1 || typeof account.username !== "string" ||
        !/^[a-f0-9]{32}$/.test(account.salt) || !/^[a-f0-9]{128}$/.test(account.hash) ||
        (account.sessionHours !== undefined && !HOURS.includes(account.sessionHours))) throw new Error("Invalid account file");
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
  const hours = () => account?.sessionHours ?? 8;
  const status = (req) => ({ configured: !!account, authenticated: authenticated(req), ...(authenticated(req) ? { username: account.username, sessionHours: hours() } : {}) });
  // Atomic replace keeps a readable account file if the process dies mid-write.
  const save = (next) => {
    const tmp = `${path}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(tmp, path);
    account = next;
  };
  const password = (value) => {
    if (typeof value !== "string" || value.length < 12 || value.length > 128) throw error("INVALID_INPUT", "Mật khẩu 12–128 ký tự.");
    return value;
  };
  const limited = () => {
    failed = failed.filter(t => now() - t < WINDOW);
    if (failed.length >= 5) throw error("RATE_LIMITED", "Quá nhiều lần thử. Vui lòng thử lại sau 15 phút.");
  };
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
    const ttl = hours() * HOUR;
    sessions.set(key, now() + ttl);
    res.setHeader("Set-Cookie", cookie(key, ttl / 1000));
    return { configured: true, authenticated: true, username: account.username, sessionHours: hours() };
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
      limited();
      // Reserve an attempt before async hashing so concurrent requests cannot bypass the limit.
      failed.push(now());
      const hash = await derive(password, account?.salt || "0".repeat(32));
      const match = timingSafeEqual(hash, Buffer.from(account?.hash || "0".repeat(128), "hex"));
      if (!account || !match || username !== account.username) throw error("INVALID_CREDENTIALS", "Tên đăng nhập hoặc mật khẩu không đúng.");
      failed = [];
      return issue(res);
    },
    /** Verifies the current password (shared rate limit), then revokes every other session. */
    async changePassword(req, args, res) {
      if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(k => !["current", "next"].includes(k)))
        throw error("INVALID_INPUT", "Thiếu mật khẩu.");
      const current = password(args.current), next = password(args.next);
      limited();
      failed.push(now());
      const hash = await derive(current, account.salt);
      if (!timingSafeEqual(hash, Buffer.from(account.hash, "hex"))) throw error("INVALID_CREDENTIALS", "Mật khẩu hiện tại không đúng.");
      failed = [];
      if (!authenticated(req)) throw error("UNAUTHENTICATED", "Phiên đăng nhập đã kết thúc");
      const salt = randomBytes(16).toString("hex");
      save({ ...account, salt, hash: (await derive(next, salt)).toString("hex") });
      sessions.clear();
      issue(res);
      return { ok: true };
    },
    setSessionHours(args) {
      if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(k => k !== "hours") || !HOURS.includes(args.hours))
        throw error("INVALID_INPUT", "Thời gian phiên chỉ nhận 1, 8, 24 hoặc 168 giờ.");
      save({ ...account, sessionHours: args.hours });
      return { hours: args.hours };
    },
    logout(req, res) {
      sessions.delete(id(req));
      res.setHeader("Set-Cookie", cookie("", 0));
      return { configured: !!account, authenticated: false };
    },
  };
}
