// plan57: “Xem trên CARLA” for a finished CARLA export. Drives the rented GPU VM with the Brev CLI already
// logged in on this machine: start the VM when needed, copy the package and carla_replay.py, start CARLA
// (carla-env/start.sh), replay with a camera view, fetch the MP4 into the export folder, stop the VM again.
// One render at a time; its state lives in exports/<id>/carla-render.json so the page shows progress and
// elapsed time. Commands are argument arrays (execFile) built only from a hex id, a fixed view and the
// machine-local configuration — never from free text.
import { execFile } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";

const ID = /^[a-f0-9]{32}$/;
const VIEWS = ["chase", "driver"];
const SAFE_DIR = /^[\w/.~-]+$/;
const ACTIVE = ["queued", "running"];
const MIN = 60000;

/** Last meaningful lines of brev output, without its spinner redraws (\r) and colour codes. */
const lastLines = (text) => String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split(/[\r\n]+/)
  .map((l) => l.replace(/^[\u2800-\u28ff]\s*/, "").trim()).filter((l) => l && !/hang tight|instance is (starting|stopped)|^waiting\b/i.test(l)).slice(-2).join(" · ").slice(0, 300);

function failure(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

/** Default runner: `brev <args>` with a timeout; never throws, reports the exit code. */
export function brevRunner(binary = "brev") {
  return (args, { timeout = 10 * MIN } = {}) => new Promise((resolve) => {
    const child = execFile(binary, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
    // brev exec forwards stdin to the VM and waits for its end: an open pipe hangs it forever (measured 2026-10-18).
    child.stdin?.end();
  });
}

export function createCarlaRender({ workspace, config, run = brevRunner(), replayScript, pollMs = 10000, retryMs = 20000, attempts = 3 }) {
  let current = null;
  const startedAt = Date.now();
  const folder = (id) => {
    if (typeof id !== "string" || !ID.test(id)) throw failure("INVALID_INPUT", "Invalid export identity");
    const dir = join(workspace(), "exports", id);
    if (!fs.existsSync(join(dir, "job.json")) || fs.lstatSync(dir).isSymbolicLink()) throw failure("NOT_FOUND", "Không tìm thấy bản xuất");
    return dir;
  };
  const file = (dir) => join(dir, "carla-render.json");
  const write = (dir, state) => {
    const tmp = join(dir, `.carla-render-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, file(dir));
  };
  const settings = () => {
    const c = config();
    if (!c || typeof c.brev_instance !== "string" || !/^[\w.-]+$/.test(c.brev_instance) || typeof c.remote_dir !== "string" || !SAFE_DIR.test(c.remote_dir)) return null;
    return { instance: c.brev_instance, dir: c.remote_dir.replace(/\/+$/, ""), stopAfter: c.stop_after !== false };
  };

  async function vmStatus(instance) {
    const out = await run(["ls", "--json"], { timeout: 2 * MIN });
    try {
      const row = JSON.parse(out.stdout).workspaces.find((w) => w.name === instance);
      return row ? { status: row.status, healthy: row.health_status === "HEALTHY" } : { status: "MISSING", healthy: false };
    } catch { return { status: "UNKNOWN", healthy: false }; }
  }

  async function render(id, view, dir, cfg) {
    const state = { schema_version: 1, status: "running", progress: 0, step: "", view, started_at: new Date().toISOString(), finished_at: null, video: null, error: null };
    const step = (progress, label) => { Object.assign(state, { progress: Math.max(state.progress, progress), step: label }); write(dir, state); };
    /** Runs one brev call while the bar creeps from `from` to `to` over `expectMs`; non-zero exit = failure of that step. */
    const stage = async (from, to, label, args, timeout, expectMs) => {
      let shown = label;
      step(from, shown);
      const t0 = Date.now();
      const timer = setInterval(() => step(Math.min(to, from + Math.round((to - from) * Math.min(1, (Date.now() - t0) / expectMs))), shown), Math.max(pollMs, 1000));
      try {
        // Brev's SSH path drops now and then while the VM reads as healthy: retry before failing (plan57 D7).
        for (let attempt = 1; ; attempt++) {
          const out = await run(args, { timeout });
          if (out.code === 0) return out;
          if (attempt >= attempts || args[0] === "start")
            throw failure("CARLA_RENDER_FAILED", `${label}: ${lastLines(out.stderr) || lastLines(out.stdout) || `mã ${out.code}`}`);
          shown = `${label} (thử lại ${attempt + 1}/${attempts})`;
          step(from, shown);
          await new Promise((r) => setTimeout(r, retryMs));
        }
      } finally { clearInterval(timer); }
    };
    const waitFor = async (from, to, label, ok, limitMs) => {
      step(from, label);
      const t0 = Date.now();
      for (;;) {
        const s = await vmStatus(cfg.instance);
        if (ok(s)) return s;
        if (Date.now() - t0 > limitMs) throw failure("CARLA_RENDER_FAILED", `${label}: máy GPU vẫn ở trạng thái ${s.status}`);
        step(Math.min(to, from + Math.round((to - from) * (Date.now() - t0) / limitMs)), label);
        await new Promise((r) => setTimeout(r, pollMs));
      }
    };
    const remoteZip = `${cfg.dir}/scenarios/topeye/render_${id}.zip`;
    const remoteVideo = `${cfg.dir}/output/topeye/render_${id}_${view}.mp4`;
    const local = join(dir, `carla-${view}.mp4`);
    const zip = fs.readdirSync(dir).find((n) => n.endsWith(".zip") && !n.startsWith("."));
    try {
      step(2, "Kiểm máy GPU");
      let vm = await vmStatus(cfg.instance);
      if (vm.status === "MISSING") throw failure("CARLA_RENDER_FAILED", `Kiểm máy GPU: không thấy máy ${cfg.instance} trong tài khoản Brev`);
      if (vm.status === "STOPPING") vm = await waitFor(5, 9, "Chờ máy GPU tắt hẳn", (s) => s.status === "STOPPED", 10 * MIN);
      if (!(vm.status === "RUNNING" && vm.healthy)) {
        if (vm.status !== "RUNNING") await stage(10, 30, "Bật máy GPU (1–5 phút)", ["start", cfg.instance], 20 * MIN, 4 * MIN);
        await waitFor(30, 35, "Chờ máy GPU sẵn sàng", (s) => s.status === "RUNNING" && s.healthy, 10 * MIN);
      }
      await stage(38, 40, "Chép gói lên máy", ["exec", cfg.instance, `mkdir -p '${cfg.dir}/scenarios/topeye' '${cfg.dir}/output/topeye'`], 1.5 * MIN, 20000);
      await stage(40, 44, "Chép gói lên máy", ["copy", join(dir, zip), `${cfg.instance}:${remoteZip}`], 3 * MIN, 30000);
      await stage(44, 46, "Chép gói lên máy", ["copy", replayScript, `${cfg.instance}:${cfg.dir}/scenarios/topeye/carla_replay.py`], 3 * MIN, 20000);
      const server = await stage(46, 58, "Bật CARLA", ["exec", cfg.instance, `cd '${cfg.dir}' && ./start.sh 2>&1 | tail -3`], 8 * MIN, 90000);
      if (!/\bOK\b/.test(server.stdout)) throw failure("CARLA_RENDER_FAILED", `Bật CARLA: ${server.stdout.trim().split("\n").pop() || "không có phản hồi"}`);
      const replay = await stage(60, 88, "Dựng cảnh trên CARLA", ["exec", cfg.instance,
        `cd '${cfg.dir}' && docker compose run --rm -T client python scenarios/topeye/carla_replay.py scenarios/topeye/render_${id}.zip --view ${view} --video output/topeye/render_${id}_${view}.mp4 2>&1 | grep -v '^ Container' | tail -6`],
      25 * MIN, 4 * MIN);
      if (!/Replayed /.test(replay.stdout)) throw failure("CARLA_RENDER_FAILED", `Dựng cảnh trên CARLA: ${replay.stdout.trim().split("\n").pop() || "không có video"}`);
      await stage(90, 98, "Tải video về máy", ["copy", `${cfg.instance}:${remoteVideo}`, local], 10 * MIN, 60000);
      if (!fs.existsSync(local) || !fs.statSync(local).size) throw failure("CARLA_RENDER_FAILED", "Tải video về máy: không nhận được tệp");
      Object.assign(state, { status: "done", progress: 100, step: "Xong", video: `carla-${view}.mp4`, finished_at: new Date().toISOString() });
      write(dir, state);
    } catch (e) {
      Object.assign(state, { status: "failed", step: "Lỗi", finished_at: new Date().toISOString(),
        error: { code: e.code || "CARLA_RENDER_FAILED", message: String(e.message).replace(/^[A-Z_]+: /, "") } });
      try { write(dir, state); } catch { /* export deleted meanwhile */ }
    }
  }

  return {
    info() {
      const cfg = settings();
      return cfg ? { available: true, instance: cfg.instance } : { available: false, instance: null, reason: "Chưa cấu hình máy CARLA (backend/data/carla-render.json)" };
    },
    start(id, view) {
      const dir = folder(id);
      if (!VIEWS.includes(view)) throw failure("INVALID_INPUT", "Góc nhìn không hợp lệ");
      const job = JSON.parse(fs.readFileSync(join(dir, "job.json"), "utf8"));
      if (job.format !== "carla" || job.status !== "done") throw failure("INVALID_INPUT", "Chỉ xem được bản xuất CARLA đã xong");
      const cfg = settings();
      if (!cfg) throw failure("CARLA_NOT_CONFIGURED", "Chưa cấu hình máy CARLA (backend/data/carla-render.json)");
      if (current) throw failure("BUSY", "Đang dựng một kịch bản khác trên CARLA, chờ xong rồi thử lại");
      const queued = { schema_version: 1, status: "queued", progress: 0, step: "Đang chờ", view, started_at: new Date().toISOString(), finished_at: null, video: null, error: null };
      write(dir, queued);
      current = { id, done: render(id, view, dir, cfg).finally(async () => {
        current = null;
        if (cfg.stopAfter) await run(["stop", cfg.instance], { timeout: 10 * MIN });
      }) };
      return queued;
    },
    /** Render state of an export, or null; a running state left by an earlier server reads as interrupted. */
    state(id) {
      let dir;
      try { dir = folder(id); } catch { return null; }
      let state;
      try { state = JSON.parse(fs.readFileSync(file(dir), "utf8")); } catch { return null; }
      if (ACTIVE.includes(state.status) && current?.id !== id && Date.parse(state.started_at) < startedAt) {
        state = { ...state, status: "failed", step: "Lỗi", error: { code: "INTERRUPTED", message: "Máy chủ đã khởi động lại khi đang dựng cảnh" } };
        try { write(dir, state); } catch { /* ignore */ }
      }
      return state;
    },
    video(id, view) {
      const dir = folder(id);
      if (!VIEWS.includes(view)) throw failure("INVALID_INPUT", "Góc nhìn không hợp lệ");
      const path = join(dir, `carla-${view}.mp4`);
      const stat = fs.existsSync(path) && fs.lstatSync(path);
      if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw failure("NOT_FOUND", "Chưa có video");
      return { path, name: `${view === "driver" ? "trong-xe" : "sau-xe"}-${id.slice(0, 8)}.mp4` };
    },
    busy: () => !!current,
  };
}
