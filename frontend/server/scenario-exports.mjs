// plan50 P04: export job queue. The metrics worker validates and writes a queued job.json (`export_create`);
// this queue runs one job at a time in its own Python process (`topeye.scenario.export_job run`), so polling
// `list()` reads job.json progress while the job works. Jobs left queued/running by a dead process become
// failed INTERRUPTED; deleting moves the export folder to <workspace>/.trash, never the scenario.
import fs from "node:fs";
import { join } from "node:path";

const ID = /^[a-f0-9]{32}$/;
const ACTIVE = ["queued", "running"];

function failure(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

export function createExports({ workspace, spawnJob, timeoutMs = 120000 }) {
  const queue = [];
  let current = null;
  // A queued job written by the worker after this moment is still on its way to enqueue(), never an orphan.
  const startedAt = Date.now();
  const noLink = (path, what) => { if (fs.existsSync(path) && fs.lstatSync(path).isSymbolicLink()) throw failure("PATH_ESCAPE", `${what} không được là liên kết`); };
  const root = () => { const dir = join(workspace(), "exports"); noLink(dir, "Thư mục exports"); return dir; };
  const folder = (id) => {
    if (typeof id !== "string" || !ID.test(id)) throw failure("INVALID_INPUT", "Invalid export identity");
    const dir = join(root(), id);
    if (!fs.existsSync(join(dir, "job.json")) || fs.lstatSync(dir).isSymbolicLink()) throw failure("NOT_FOUND", "Không tìm thấy bản xuất");
    return dir;
  };
  const read = (dir) => JSON.parse(fs.readFileSync(join(dir, "job.json"), "utf8"));
  const write = (dir, job) => {
    const temporary = join(dir, `.job-node-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(job, null, 1));
    fs.renameSync(temporary, join(dir, "job.json"));
  };
  const markFailed = (dir, code, message) => {
    try {
      const job = read(dir);
      if (!ACTIVE.includes(job.status)) return;
      write(dir, { ...job, status: "failed", step: "Lỗi", finished_at: new Date().toISOString(), error: { code, message } });
    } catch { /* folder deleted meanwhile */ }
  };

  function pump() {
    if (current || !queue.length) return;
    const id = queue.shift();
    const dir = join(root(), id);
    if (!fs.existsSync(join(dir, "job.json"))) return pump();
    let timedOut = false;
    const child = spawnJob(id);
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    current = { id, child };
    const done = () => {
      clearTimeout(timer);
      if (timedOut) markFailed(dir, "TIMEOUT", "Xuất quá lâu, đã dừng");
      else markFailed(dir, "INTERRUPTED", "Tiến trình xuất dừng giữa chừng");
      current = null;
      pump();
    };
    child.once("exit", done);
    child.once("error", () => { child.removeAllListeners("exit"); done(); });
  }

  return {
    enqueue(job) {
      folder(job.id);
      queue.push(job.id);
      pump();
      return job;
    },
    list() {
      let names = [];
      try { names = fs.readdirSync(root()).filter((n) => ID.test(n)); } catch { return []; }
      const jobs = [];
      for (const id of names) {
        const dir = join(root(), id);
        let job;
        try { if (fs.lstatSync(dir).isSymbolicLink()) continue; job = read(dir); } catch { continue; }
        const inFlight = job.status === "queued" && Date.parse(job.created_at) >= startedAt;
        if (ACTIVE.includes(job.status) && current?.id !== id && !queue.includes(id) && !inFlight) {
          markFailed(dir, "INTERRUPTED", "Máy chủ đã khởi động lại khi đang xuất");
          job = read(dir);
        }
        jobs.push(job);
      }
      return jobs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
    remove(id) {
      const dir = folder(id);
      if (current?.id === id) throw failure("BUSY", "Đang xuất, chờ xong rồi xoá");
      const waiting = queue.indexOf(id);
      if (waiting >= 0) queue.splice(waiting, 1);
      const trash = join(workspace(), ".trash");
      noLink(trash, "Thùng rác");
      fs.mkdirSync(trash, { recursive: true });
      fs.renameSync(dir, join(trash, `export-${id}-${Date.now()}`));
      return { removed: true };
    },
    /** Absolute path and download name of a finished export's zip. */
    zip(id) {
      const dir = folder(id);
      const job = read(dir);
      if (job.status !== "done") throw failure("NOT_FOUND", "Bản xuất chưa xong");
      const name = fs.readdirSync(dir).find((n) => n.endsWith(".zip") && !n.startsWith("."));
      const stat = name && fs.lstatSync(join(dir, name));
      if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw failure("NOT_FOUND", "Thiếu tệp zip");
      return { path: join(dir, name), name };
    },
    stop() {
      queue.length = 0;
      current?.child.kill("SIGKILL");
    },
  };
}
