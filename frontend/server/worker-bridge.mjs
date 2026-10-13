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
    const exited = () => child.exitCode !== null || child.signalCode !== null;
    const signal = (name) => {
      try { process.kill(group, name); return true; }
      catch (e) {
        if (e.code === "ESRCH") return false;
        if (e.code !== "EPERM") throw e;
        // macOS answers EPERM for a group whose leader has exited (possibly still an unreaped
        // zombie). Fall back to the leader itself; the stop loop keeps polling until Node reaps it.
        if (exited()) return false;
        try { process.kill(child.pid, name); return true; }
        catch (inner) { if (inner.code === "ESRCH") return false; throw inner; }
      }
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

  // Requests are queued, not refused: two tabs (or a reload during a slow call) must not get BUSY.
  // `current` is claimed synchronously so only one request is ever dispatched; stop() rejects all.
  let queue = [];
  let current = null;
  function pump() {
    if (current || !queue.length) return;
    const item = (current = queue.shift());
    const done = () => { if (current === item) current = null; setTimeout(pump); };
    start().then(() => {
      if (item.cancelled) return done();
      const id = randomUUID();
      pending = { id, resolve: (v) => { item.resolve(v); done(); }, reject: (e) => { item.reject(e); done(); } };
      worker.stdin.write(JSON.stringify({ id, method: item.method, params: item.params }) + "\n");
    }, (e) => { item.reject(e); done(); });
  }
  function request(method, params) {
    return new Promise((resolve, reject) => { queue.push({ method, params, resolve, reject }); pump(); });
  }
  async function stopAll() {
    const dropped = queue; queue = [];
    for (const item of dropped) item.reject(fail("CANCELLED", "Operation interrupted"));
    if (current && !pending) { current.cancelled = true; current.reject(fail("CANCELLED", "Operation interrupted")); }
    await stop();
  }

  return { request, stop: stopAll, get busy() { return !!current || queue.length > 0; }, get running() { return !!worker; } };
}
