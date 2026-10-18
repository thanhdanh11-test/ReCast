// Localhost-only HTTP host for Scenario Studio in a browser (plan21).
// Binds 127.0.0.1, requires a per-run token, and owns the scenario request rules.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import { join, resolve, basename, dirname, extname, sep } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createExports } from "./scenario-exports.mjs";
import { brevRunner, createCarlaRender } from "./carla-render.mjs";
import { scenarioGroups, recordScenarioGroup } from "./scenario-groups.mjs";
import { createAuth } from "./local-auth.mjs";
import { createCatalog } from "./dataset-catalog.mjs";
import { createFeedback } from "./local-feedback.mjs";
import { clearMetricsCache, emptyTrash, storageInfo } from "./local-storage.mjs";
import { createWorkerBridge, fail } from "./worker-bridge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

export const allowed = {
  scenarioGroups: ["scene"],
  recordScenarioGroup: ["group"],
  sourceScene: ["scene"],
  extract: ["scene", "actor_tokens", "start_s", "end_s"],
  variant: ["scenario_id", "target_actor", "speed_factor", "gap_offset_m"],
  export: ["scenario_id"],
  replay: ["scenario_id"],
  mapContext: ["source_id"],
  exportMapContext: ["source_id"],
  importXosc: ["source_id", "xml_base64", "file_name"],
  importTemplate: ["source_id", "template"],
  importPackage: ["source_id", "files"],
  reactiveCandidates: ["source_id"],
  importReactive: ["source_id", "event"],
  reactiveSensitivity: ["source_id", "event"],
  reactiveMetrics: ["scene", "reactions", "kinds"],
  replayErrorMetrics: ["scene"],
  esminiCheck: ["scenario_id"],
  templateFit: ["scene", "template"],
  mapStatus: [],
  exportScenario: ["scenario_id", "format"],
  listExports: [],
  deleteExport: ["id"],
  renderCarla: ["id", "view"],
  carlaRenderInfo: [],
  openImported: ["source_id", "path"],
  replayImported: ["scenario_id"],
  lidarFrame: ["scene", "time_s"],
  scenarioMetrics: ["scenario_id"],
  listImported: [],
  readImported: ["scenario_id"],
  deleteImported: ["scenario_id"],
  deleteImportedRun: ["scenario_id", "run_id"],
  chooseDataset: ["path"],
  chooseWorkspace: ["path"],
  listScenes: [],
  settings: [],
  cancelJob: [],
  storageInfo: [],
  clearMetricsCache: [],
  emptyTrash: [],
  submitFeedback: ["kind", "message", "contact", "context"],
  listFeedback: [],
};
const ID = /^[a-f0-9]{32}$/;
/** real2sim package (plan43): one .xosc + optional report.json / trajectories.csv, ≤ 7.8 MiB base64 in total. */
export const PACKAGE_BASE64_MAX = Math.floor(7.8 * 1024 * 1024);
const PACKAGE_NAME = /^(?:[^/\\\x00-\x1f]{1,115}\.xosc|report\.json|trajectories\.csv)$/;

export function validateArgs(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw fail("INVALID_INPUT", "Invalid request");
  if (!allowed[name] || Object.keys(args).some((k) => !allowed[name].includes(k))) throw fail("INVALID_INPUT", "Unknown field");
  const limit = name === "importXosc" ? 3 * 1024 * 1024 : name === "importPackage" ? PACKAGE_BASE64_MAX + 65536 : ["importTemplate", "templateFit"].includes(name) ? 256 * 1024 : 65536;
  if (JSON.stringify(args).length > limit) throw fail("INVALID_INPUT", "Request too large");
  if (["mapContext", "exportMapContext", "importXosc", "importTemplate", "importPackage", "openImported", "reactiveCandidates", "importReactive", "reactiveSensitivity"].includes(name) &&
      (typeof args.source_id !== "string" || !ID.test(args.source_id)))
    throw fail("INVALID_INPUT", "Invalid source identity");
  if (["replayImported", "readImported", "deleteImported", "deleteImportedRun"].includes(name) && (typeof args.scenario_id !== "string" || !ID.test(args.scenario_id)))
    throw fail("INVALID_INPUT", "Invalid scenario identity");
  if (["chooseDataset", "chooseWorkspace", "openImported"].includes(name) &&
      (typeof args.path !== "string" || !args.path.trim() || args.path.length > 4096))
    throw fail("INVALID_INPUT", "Invalid path");
  if (name === "deleteImportedRun" && (typeof args.run_id !== "string" || !ID.test(args.run_id))) throw fail("INVALID_INPUT", "Invalid run identity");
  if (name === "lidarFrame" && (typeof args.scene !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(args.scene) ||
      typeof args.time_s !== "number" || !Number.isFinite(args.time_s)))
    throw fail("INVALID_INPUT", "Invalid LiDAR request");
  if (["scenarioMetrics", "esminiCheck", "exportScenario"].includes(name) && (typeof args.scenario_id !== "string" || !/^[a-f0-9]{32}$/.test(args.scenario_id)))
    throw fail("INVALID_INPUT", "Invalid scenario");
  if (name === "exportScenario" && !["carla", "xosc"].includes(args.format)) throw fail("INVALID_INPUT", "Invalid export format");
  if (["deleteExport", "renderCarla"].includes(name) && (typeof args.id !== "string" || !ID.test(args.id))) throw fail("INVALID_INPUT", "Invalid export identity");
  if (name === "renderCarla" && !["chase", "driver"].includes(args.view)) throw fail("INVALID_INPUT", "Invalid view");
  // Template content is checked field by field in the worker (topeye/scenario/template.py).
  if (["importTemplate", "templateFit"].includes(name) && (!args.template || typeof args.template !== "object" || Array.isArray(args.template)))
    throw fail("INVALID_INPUT", "Invalid template");
  if (["importReactive", "reactiveSensitivity"].includes(name) && (!args.event || typeof args.event !== "object" || Array.isArray(args.event)))
    throw fail("INVALID_INPUT", "Invalid event");
  if (["templateFit", "reactiveMetrics", "replayErrorMetrics"].includes(name) && (typeof args.scene !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(args.scene)))
    throw fail("INVALID_INPUT", "Invalid scene");
  // plan46 C1: at most 3 reaction times in [0.3; 3] s (the worker defaults to [1.0]).
  if (name === "reactiveMetrics" && args.reactions !== undefined && (!Array.isArray(args.reactions) || args.reactions.length < 1 || args.reactions.length > 3 ||
      args.reactions.some((r) => typeof r !== "number" || !Number.isFinite(r) || r < 0.3 || r > 3)))
    throw fail("INVALID_INPUT", "Invalid reactions");
  // plan47 C5: 1–4 distinct event kinds (the worker defaults to ["brake"]).
  if (name === "reactiveMetrics" && args.kinds !== undefined && (!Array.isArray(args.kinds) || args.kinds.length < 1 || args.kinds.length > 4 ||
      new Set(args.kinds).size !== args.kinds.length || args.kinds.some((k) => !["brake", "accelerate", "stopline", "lane_change"].includes(k))))
    throw fail("INVALID_INPUT", "Invalid kinds");
  if (name === "importXosc" && args.file_name !== undefined && (typeof args.file_name !== "string" || args.file_name.length > 240))
    throw fail("INVALID_INPUT", "Invalid file name");
  if (name === "importXosc" && (typeof args.xml_base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(args.xml_base64)))
    throw fail("INVALID_INPUT", "Invalid XOSC payload");
  if (name === "importPackage") {
    const files = args.files;
    if (!Array.isArray(files) || files.length < 1 || files.length > 3) throw fail("INVALID_INPUT", "Gói real2sim gồm 1–3 file");
    const names = new Set();
    let total = 0;
    for (const f of files) {
      if (!f || typeof f !== "object" || Object.keys(f).some((k) => !["name", "data_base64"].includes(k)) ||
          typeof f.name !== "string" || !PACKAGE_NAME.test(f.name) || names.has(f.name) ||
          typeof f.data_base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data_base64))
        throw fail("INVALID_INPUT", "Invalid package file");
      names.add(f.name);
      total += f.data_base64.length;
    }
    if ([...names].filter((n) => n.endsWith(".xosc")).length !== 1) throw fail("INVALID_INPUT", "Gói phải có đúng 1 file .xosc");
    if (total > PACKAGE_BASE64_MAX) throw fail("RESOURCE_LIMIT", "Gói real2sim quá lớn");
  }
  return args;
}

// plan52: a worker ScenarioError code is the user's input being rejected (400); only failures of the server or
// the worker themselves are 500.
const SERVER_FAILURES = ["INTERNAL", "IO_ERROR", "ENGINE_FAILED", "ENGINE_MISSING", "ESMINI_FAILED", "ESMINI_MISSING", "ESMINI_BUILD_VERSION", "TIMEOUT", "HASH_MISMATCH", "LIDAR_UNAVAILABLE"];
export const statusFor = (code) =>
  code === "UNAUTHENTICATED" || code === "INVALID_CREDENTIALS" ? 401 : code === "RATE_LIMITED" ? 429 : code === "ACCOUNT_EXISTS" ? 409 : code === "FORBIDDEN" ? 403 : ["BUSY", "CANCELLED"].includes(code) ? 409 :
  !code || SERVER_FAILURES.includes(code) || !/^[A-Z][A-Z0-9_]+$/.test(code) ? 500 : 400;

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".glb": "model/gltf-binary" };

function expandHome(path) {
  return path.trim().replace(/^~(?=$|\/)/, os.homedir());
}

// The app was renamed Topeye → Recast; machines that already have the old folder keep using it.
function brandDir(parent, name, legacyName) {
  const legacy = join(parent, legacyName);
  return !fs.existsSync(join(parent, name)) && fs.existsSync(legacy) ? legacy : join(parent, name);
}

export function createLocalServer({
  staticDir = join(root, "frontend", "dist-local"),
  userData = brandDir(join(os.homedir(), "Library", "Application Support"), "Recast", "Topeye"),
  python = join(root, "backend", ".venv", "bin", "python"),
  engine = join(root, "backend", ".tools", "esmini", "build", "EnvironmentSimulator", "Libraries", "esminiLib", "libesminiLib.dylib"),
  version = JSON.parse(fs.readFileSync(join(root, "frontend", "package.json"), "utf8")).version,
  bridgeFactory = createWorkerBridge,
  catalogSeeds = fs.existsSync(join(root, "backend/data/dataset-library.json")) ? JSON.parse(fs.readFileSync(join(root, "backend/data/dataset-library.json"), "utf8")) : [],
  // plan57: machine-local CARLA VM settings (absent = “Xem trên CARLA” disabled) and the Brev runner.
  carlaConfig = () => { try { return JSON.parse(fs.readFileSync(join(root, "backend/data/carla-render.json"), "utf8")); } catch { return null; } },
  carlaRun = brevRunner(),
} = {}) {
  const token = randomBytes(32).toString("hex");
  fs.mkdirSync(userData, { recursive: true });
  const auth = createAuth({ path: join(userData, "local-account.json") });
  const feedback = createFeedback({ dir: join(userData, "feedback") });
  const settingsPath = join(userData, "scenario-settings.json");
  let settings;
  try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { settings = {}; }
  settings.workspace ||= brandDir(join(os.homedir(), "Documents"), "Recast Projects", "Topeye Projects");
  const saveSettings = () => {
    const temporary = settingsPath + "." + randomUUID() + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(settings), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, settingsPath);
  };
  const clients = new Map();
  const log = fs.createWriteStream(join(userData, "scenario-worker.log"), { flags: "a" });
  const workerOptions = {
    command: python,
    args: ["-m", "topeye.scenario.worker"],
    cwd: userData,
    env: { ...process.env, PYTHONPATH: join(root, "backend"), PYTHONUNBUFFERED: "1" },
    log,
  };
  const bridge = bridgeFactory({
    ...workerOptions,
    onProgress: (msg) => {
      const line = `data: ${JSON.stringify({ phase: msg.phase, completed: msg.completed, total: msg.total })}\n\n`;
      for (const [res, req] of clients) {
        if (auth.authenticated(req)) res.write(line); else { res.end(); clients.delete(res); }
      }
    },
  });
  // Separate worker so timeline LiDAR reads never contend with (or are cancelled with) scenario jobs.
  const lidarBridge = bridgeFactory({ ...workerOptions, role: "lidar" });
  // Scenario metrics run esmini for seconds; a third worker keeps viewing responsive meanwhile.
  const metricsBridge = bridgeFactory({ ...workerOptions, role: "metrics" });
  // plan50: export jobs run one at a time in their own process (progress read from job.json).
  const exportsQueue = createExports({
    workspace: () => settings.workspace,
    spawnJob: (id) => {
      const child = spawn(python, ["-m", "topeye.scenario.export_job", "run", "--workspace", settings.workspace,
        "--dataset", settings.dataset, "--dataset-version", settings.datasetVersion || "v1.0-mini", "--job", id, "--version", version],
      { cwd: userData, env: workerOptions.env, stdio: ["ignore", "ignore", "pipe"] });
      child.stderr.on("data", (chunk) => log.write(chunk));
      return child;
    },
  });
  const carlaRender = createCarlaRender({ workspace: () => settings.workspace, config: carlaConfig, run: carlaRun,
    replayScript: join(root, "backend", "scripts", "carla_replay.py") });
  const params = (args) => ({
    ...args,
    dataset: settings.dataset,
    dataset_version: settings.datasetVersion || null,
    workspace: settings.workspace,
    engine,
  });
  const call = (method, args = {}, worker = bridge) => {
    if (!settings.dataset) throw fail("DATASET_INVALID", "Chọn thư mục nuScenes trước");
    return worker.request(method, params(args));
  };
  const realDir = (input) => {
    let path;
    try { path = fs.realpathSync(expandHome(input)); } catch { throw fail("NOT_FOUND", "Không tìm thấy thư mục"); }
    if (!fs.statSync(path).isDirectory()) throw fail("INVALID_INPUT", "Cần một thư mục");
    return path;
  };

  const inspect = async (input) => {
    const path = realDir(input);
    return bridge.request("inspect_dataset", { dataset: path, workspace: settings.workspace || "", engine });
  };
  const catalog = createCatalog({ path: join(userData, "dataset-catalog.json"),
    seeds: [...catalogSeeds, ...(settings.dataset ? [{ root: settings.dataset }] : [])], inspect });

  async function handle(name, args, authorize = () => {}) {
    authorize();
    const checked = validateArgs(name, args);
    if (name === "cancelJob") { await bridge.stop(); return true; }
    if (name === "scenarioGroups") return scenarioGroups(settings.workspace).filter(g => g.scene === checked.scene);
    if (name === "recordScenarioGroup") return recordScenarioGroup(settings.workspace, checked.group);
    if (name === "settings")
      return { dataset: settings.dataset ? basename(settings.dataset) : null, datasetVersion: settings.datasetVersion || null,
        workspace: settings.workspace, engineAvailable: fs.existsSync(engine), version, mode: "local-web" };
    if (name === "chooseWorkspace") {
      if (bridge.busy) throw fail("BUSY", "Dừng tác vụ trước khi đổi thư mục");
      fs.mkdirSync(expandHome(checked.path), { recursive: true });
      const path = realDir(checked.path);
      settings.workspace = path;
      saveSettings();
      return { name: basename(path) };
    }
    if (name === "chooseDataset") {
      const path = realDir(checked.path);
      // Reopening the selected dataset after reload is read-only, even while its metrics finish.
      if (settings.dataset && path === fs.realpathSync(settings.dataset)) {
        const scenes = await call("list_scenes");authorize();
        return {name:basename(path),version:settings.datasetVersion,scenes};
      }
      if (bridge.busy || lidarBridge.busy || metricsBridge.busy) throw fail("BUSY", "Dừng tác vụ trước khi đổi dữ liệu");
      const result = await bridge.request("inspect_dataset", { dataset: path, workspace: settings.workspace || "", engine });
      authorize();
      settings.dataset = result.root;
      settings.datasetVersion = result.version;
      saveSettings();
      return { name: basename(result.root), version: result.version, scenes: result.scenes };
    }
    // reactiveSensitivity only simulates (nothing saved): it queues like other reads (plan52 pre-checks call it often).
    if (bridge.busy && ["importXosc", "importTemplate", "importPackage", "replayImported", "deleteImported", "deleteImportedRun", "importReactive"].includes(name))
      throw fail("BUSY", "Dừng tác vụ trước khi nạp kịch bản");
    if (name === "mapContext" || name === "exportMapContext") return call("map_context", { source_id: checked.source_id });
    if (name === "replayImported") return call("replay_imported", checked);
    if (name === "openImported") {
      const path = realDir(checked.path);
      const dataset = settings.dataset && fs.realpathSync(settings.dataset);
      if (dataset && (path === dataset || path.startsWith(dataset + sep))) throw fail("PATH_ESCAPE", "Không mở trong dữ liệu nguồn");
      return call("open_imported", { source_id: checked.source_id, package_path: path });
    }
    if (name === "importXosc") {
      const bytes = Buffer.from(checked.xml_base64, "base64");
      if (bytes.length > 2097152) throw fail("RESOURCE_LIMIT", "XOSC tối đa 2 MiB");
      return call("import_xosc", { source_id: checked.source_id, xml_base64: bytes.toString("base64"), ...(checked.file_name ? { file_name: checked.file_name } : {}) });
    }
    if (name === "importTemplate") return call("import_template", checked);
    if (name === "importPackage") return call("import_package", checked);
    if (name === "reactiveCandidates") return call("reactive_candidates", checked);
    if (name === "importReactive") return call("import_reactive", checked);
    if (name === "reactiveSensitivity") return call("reactive_sensitivity", checked);
    // plan46 scene metrics and esmini checks: read-only, on the metrics worker.
    if (name === "reactiveMetrics") return call("reactive_metrics", checked, metricsBridge);
    if (name === "replayErrorMetrics") return call("replay_error_metrics", checked, metricsBridge);
    if (name === "esminiCheck") return call("esmini_check", checked, metricsBridge);
    // Read-only map suitability probe; queued on the metrics worker so the main worker stays free.
    if (name === "templateFit") return call("template_fit", checked, metricsBridge);
    if (name === "mapStatus") return call("map_status", checked, metricsBridge);
    if (name === "exportScenario") return exportsQueue.enqueue(await call("export_create", checked, metricsBridge));
    if (name === "listExports") return exportsQueue.list().map((job) => ({ ...job, carla_render: carlaRender.state(job.id) }));
    if (name === "carlaRenderInfo") return carlaRender.info();
    if (name === "renderCarla") return carlaRender.start(checked.id, checked.view);
    if (name === "deleteExport") return exportsQueue.remove(checked.id);
    if (name === "lidarFrame") return call("lidar_frame", checked, lidarBridge);
    if (name === "scenarioMetrics") return call("scenario_metrics", checked, metricsBridge);
    // plan52: read-only listing on the (mostly idle) LiDAR worker: it no longer waits behind imports/replays.
    if (name === "listImported") return call("list_imported", { readonly: true }, lidarBridge);
    if (name === "readImported") return call("read_imported", checked);
    if (name === "deleteImportedRun") return call("delete_imported_run", checked);
    if (name === "deleteImported") return call("delete_imported", checked);
    if (name === "listScenes") return call("list_scenes");
    if (name === "storageInfo") return storageInfo(settings.workspace);
    if (name === "clearMetricsCache") {
      if (metricsBridge.busy) throw fail("BUSY", "Đang tính chỉ số; thử lại sau");
      return clearMetricsCache(settings.workspace);
    }
    if (name === "emptyTrash") {
      if (bridge.busy) throw fail("BUSY", "Dừng tác vụ trước khi dọn thùng rác");
      return emptyTrash(settings.workspace);
    }
    if (name === "submitFeedback") return feedback.submit(checked);
    if (name === "listFeedback") return feedback.list();
    return call(name === "sourceScene" ? "source_scene" : name, checked);
  }

  function serveStatic(req, res, pathname) {
    const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    const base = fs.realpathSync(staticDir);
    let file;
    try { file = fs.realpathSync(join(base, relative)); } catch { res.writeHead(404).end(); return; }
    if (!(file === base || file.startsWith(base + sep)) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    let body = fs.readFileSync(file);
    if (file === join(base, "index.html"))
      body = Buffer.from(body.toString("utf8").replace("__TOPEYE_TOKEN__", token));
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    res.end(body);
  }

  const server = http.createServer(async (req, res) => {
    // A keep-alive request can still arrive after close(); address() is null then and must not crash the process.
    const port = server.address()?.port;
    if (!port) { res.writeHead(503, { Connection: "close" }).end(); return; }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const hostOk = [`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host || "");
    const origin = req.headers.origin;
    const originOk = !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(value));
    };
    if (!hostOk || !originOk) return send(403, { code: "FORBIDDEN", message: "Invalid host or origin" });
    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET") return send(405, { code: "INVALID_INPUT", message: "Method not allowed" });
      try { return serveStatic(req, res, url.pathname); }
      catch { return send(400, { code: "INVALID_INPUT", message: "Invalid static path" }); }
    }
    // Preview URLs are server-owned catalog IDs; never accept an arbitrary file path.
    if (url.pathname.startsWith("/api/catalog/preview/") && req.method === "GET") {
      if (!auth.authenticated(req)) return send(401, { code: "UNAUTHENTICATED", message: "Vui lòng đăng nhập" });
      try {
        const preview = catalog.preview(url.pathname.slice("/api/catalog/preview/".length));
        res.writeHead(200, { "Content-Type": preview.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        return res.end(preview.bytes);
      } catch { return send(404, { code: "NOT_FOUND", message: "Không có ảnh xem trước" }); }
    }
    if (url.pathname === "/api/auth/session" && req.method === "GET") {
      if (req.headers["x-topeye-token"] !== token) return send(403, { code: "FORBIDDEN", message: "Invalid token" });
      return send(200, { value: auth.status(req) });
    }
    if (url.pathname === "/api/catalog" && req.method === "GET") {
      if (req.headers["x-topeye-token"] !== token) return send(403, { code: "FORBIDDEN", message: "Invalid token" });
      if (!auth.authenticated(req)) return send(401, { code: "UNAUTHENTICATED", message: "Vui lòng đăng nhập" });
      try {
        const value = await catalog.list();
        if (!auth.authenticated(req)) return send(401, { code: "UNAUTHENTICATED", message: "Phiên đăng nhập đã kết thúc" });
        return send(200, { value });
      }
      catch (e) { return send(statusFor(e.code), { code: e.code || "INTERNAL", message: "Không đọc được thư viện dữ liệu" }); }
    }
    // plan50: download a finished export; token in the query like /api/events (a link cannot send headers).
    const exportZip = /^\/api\/exports\/([a-f0-9]{32})\.zip$/.exec(url.pathname);
    if (exportZip && req.method === "GET") {
      if (url.searchParams.get("token") !== token) return send(403, { code: "FORBIDDEN", message: "Invalid token" });
      if (!auth.authenticated(req)) return send(401, { code: "UNAUTHENTICATED", message: "Vui lòng đăng nhập" });
      let zip;
      try { zip = exportsQueue.zip(exportZip[1]); } catch (e) { return send(404, { code: "NOT_FOUND", message: String(e.message).replace(/^[A-Z_]+: /, "") }); }
      // Open before the 200 header: an unreadable file is a 404, and a stream error ends this response, never the server.
      let handle;
      try { handle = fs.openSync(zip.path, "r"); } catch { return send(404, { code: "NOT_FOUND", message: "Không đọc được tệp zip" }); }
      res.writeHead(200, { "Content-Type": "application/zip", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="${zip.name}"` });
      return fs.createReadStream(null, { fd: handle }).on("error", () => res.destroy()).pipe(res);
    }
    // plan57: the CARLA video of an export (inline for the player, `download` attribute for saving).
    const carlaVideo = /^\/api\/exports\/([a-f0-9]{32})\/carla-(chase|driver)\.mp4$/.exec(url.pathname);
    if (carlaVideo && req.method === "GET") {
      if (url.searchParams.get("token") !== token) return send(403, { code: "FORBIDDEN", message: "Invalid token" });
      if (!auth.authenticated(req)) return send(401, { code: "UNAUTHENTICATED", message: "Vui lòng đăng nhập" });
      let video;
      try { video = carlaRender.video(carlaVideo[1], carlaVideo[2]); } catch (e) { return send(404, { code: "NOT_FOUND", message: String(e.message).replace(/^[A-Z_]+: /, "") }); }
      let handle;
      try { handle = fs.openSync(video.path, "r"); } catch { return send(404, { code: "NOT_FOUND", message: "Không đọc được video" }); }
      const size = fs.fstatSync(handle).size;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      const headers = { "Content-Type": "video/mp4", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes",
        "Content-Disposition": `inline; filename="${video.name}"` };
      if (range && (range[1] || range[2])) {  // the <video> element seeks with byte ranges
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start > end || start >= size) { fs.closeSync(handle); res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
        return fs.createReadStream(null, { fd: handle, start, end }).on("error", () => res.destroy()).pipe(res);
      }
      res.writeHead(200, { ...headers, "Content-Length": size });
      return fs.createReadStream(null, { fd: handle }).on("error", () => res.destroy()).pipe(res);
    }
    if (url.pathname === "/api/events" && req.method === "GET") {
      if (url.searchParams.get("token") !== token) return send(403, { code: "FORBIDDEN", message: "Invalid token" });
      if (!auth.authenticated(req)) return send(401, { code: "UNAUTHENTICATED", message: "Vui lòng đăng nhập" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(": ok\n\n");
      clients.set(res, req);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method !== "POST") return send(405, { code: "INVALID_INPUT", message: "Method not allowed" });
    if (req.headers["x-topeye-token"] !== token) return send(403, { code: "FORBIDDEN", message: "Invalid token" });
    const name = url.pathname.slice("/api/".length);
    const authMethod = ["auth/setup", "auth/login", "auth/logout"].includes(name);
    const accountMethod = ["auth/password", "auth/sessionHours"].includes(name);
    const catalogMethod = ["catalog/add", "catalog/select"].includes(name);
    if (!authMethod && !auth.authenticated(req)) return send(401, { code: "UNAUTHENTICATED", message: "Vui lòng đăng nhập" });
    if (!authMethod && !catalogMethod && !accountMethod && !Object.hasOwn(allowed, name)) return send(404, { code: "NOT_FOUND", message: "Unknown method" });
    let raw = "";
    let size = 0;
    let tooLarge = false;
    const maxBody = name === "importPackage" ? PACKAGE_BASE64_MAX + 128 * 1024 : 4 * 1024 * 1024;
    try { for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBody) tooLarge = true;
      if (!tooLarge) raw += chunk;
    } } catch {
      if (!res.destroyed) send(400, { code: "INVALID_INPUT", message: "Incomplete request body" });
      return;
    }
    if (tooLarge) return send(400, { code: "INVALID_INPUT", message: "Request too large" });
    let args;
    try { args = raw ? JSON.parse(raw) : {}; } catch { return send(400, { code: "INVALID_INPUT", message: "Invalid JSON" }); }
    try {
      const authorize = () => { if (!auth.authenticated(req)) throw fail("UNAUTHENTICATED", "Phiên đăng nhập đã kết thúc"); };
      if (!authMethod) authorize();
      let value;
      if (name === "auth/setup") value = await auth.setup(args, res);
      else if (name === "auth/login") value = await auth.login(args, res);
      else if (name === "auth/logout") {
        value = auth.logout(req, res);
        for (const [client, request] of clients) if (!auth.authenticated(request)) { client.end(); clients.delete(client); }
      } else if (name === "auth/password") {
        value = await auth.changePassword(req, args, res);
        for (const [client, request] of clients) if (!auth.authenticated(request)) { client.end(); clients.delete(client); }
      } else if (name === "auth/sessionHours") {
        value = auth.setSessionHours(args);
      } else if (catalogMethod) {
        const keys = name === "catalog/add" ? ["path", "name"] : ["id"];
        if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(k => !keys.includes(k))) throw fail("INVALID_INPUT", "Invalid catalog input");
        if (name === "catalog/add") value = await catalog.add(args.path, args.name, authorize);
        else value = await handle("chooseDataset", { path: catalog.get(args.id).root }, authorize);
      } else value = await handle(name, args, authorize);
      // A password change rotates this session: the request's old cookie is expected to be gone.
      if (!authMethod && !accountMethod && !auth.authenticated(req)) return send(401, { code: "UNAUTHENTICATED", message: "Phiên đăng nhập đã kết thúc" });
      send(200, { value });
    }
    catch (e) {
      const code = e.code && /^[A-Z_]+$/.test(e.code) ? e.code : "INTERNAL";
      const message = String(e.message || e).replace(/^[A-Z_]+: /, "");
      send(statusFor(code), { code, message });
    }
  });

  async function close() {
    for (const res of clients.keys()) res.end();
    exportsQueue.stop();
    await Promise.all([bridge.stop(), lidarBridge.stop(), metricsBridge.stop()]);
    await new Promise((r) => server.close(r));
    log.end();
  }
  return { server, token, close, listen: (port = 5180) => new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(port, "127.0.0.1", () => res(server.address().port));
  }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = createLocalServer();
  const requested = Number(process.env.TOPEYE_PORT || 5180);
  host.listen(requested).then((port) => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Recast local web: ${url}`);
    if (!process.env.TOPEYE_NO_OPEN) spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  }).catch((e) => {
    console.error(e.code === "EADDRINUSE" ? `Cổng ${requested} đang bận; đặt TOPEYE_PORT khác.` : e);
    process.exit(1);
  });
  let closing = false;
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
    if (closing) return;
    closing = true;
    host.close().finally(() => process.exit(0));
  });
}
