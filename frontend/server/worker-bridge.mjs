// JSONL bridge to the Python scenario worker (formerly in the Electron main process)
// (single pending request, owned process group, bounded messages).
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export function fail(code, message) {
  const e = new Error(`${code}: ${message}`);
  e.code = code;
  return e;
}

export function createWorkerBridge({ command, args = [], cwd, env, log, onProgress }) {
  let worker = null, ready = null, pending = null, shutdown = null;

  function start() {
    if (shutdown) return shutdown.then(start);
    if (worker) return ready;
    const child = spawn(command, args, { cwd, detached: true, stdio: ["pipe", "pipe", "pipe"], env });
    worker = child;
    child.stdout.setEncoding("utf8");
    child.stdin.on("error", (err) => {
      if (pending) { pending.reject(err); pending = null; }
    });
    let buffer = "";
    ready = new Promise((res, rej) => {
      const timer = setTimeout(() => { rej(fail("TIMEOUT", "Worker startup")); stop(); }, 30000);
      child.on("error", (err) => { clearTimeout(timer); if (worker === child) worker = null; rej(err); });
      child.stderr.on("data", (chunk) => log?.write(chunk));
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
          rej(fail("INVALID_INPUT", "Oversized worker message"));
          stop();
          return;
        }
        let split;
        while ((split = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, split);
          buffer = buffer.slice(split + 1);
          let msg;
          try { msg = JSON.parse(line); }
          catch { rej(fail("INTERNAL", "Invalid worker output")); stop(); return; }
          if (msg.type === "ready") { clearTimeout(timer); res(); continue; }
          if (!pending || msg.id !== pending.id) continue;
          if (msg.type === "progress") { onProgress?.(msg); continue; }
          const item = pending;
          pending = null;
          if (msg.type === "result") item.resolve(msg.value);
          else item.reject(fail(msg.code, msg.message));
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        if (worker === child) worker = null;
        rej(fail("ENGINE_FAILED", "Worker exited"));
        if (pending) { pending.reject(fail("CANCELLED", "Operation interrupted")); pending = null; }
      });
    });
    return ready;
  }

  async function stop() {
    if (shutdown) return shutdown;
    const child = worker;
    if (!child) return;
    const group = -child.pid;
    const signal = (name) => {
      try { process.kill(group, name); return true; }
      catch (e) { if (e.code === "ESRCH") return false; throw e; }
    };
    shutdown = (async () => {
      signal("SIGTERM");
      const deadline = Date.now() + 5000;
      while (signal(0) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      if (signal(0)) signal("SIGKILL");
      const killDeadline = Date.now() + 5000;
      while (signal(0) && Date.now() < killDeadline) await new Promise((r) => setTimeout(r, 50));
      if (signal(0)) throw fail("ENGINE_FAILED", "Unable to stop owned process group");
    })();
    try { await shutdown; } finally { shutdown = null; }
  }

  async function request(method, params) {
    if (pending) throw fail("BUSY", "Một tác vụ đang chạy");
    await start();
    if (pending) throw fail("BUSY", "Một tác vụ đang chạy");
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      pending = { id, resolve, reject };
      worker.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  return { request, stop, get busy() { return !!pending; }, get running() { return !!worker; } };
}
