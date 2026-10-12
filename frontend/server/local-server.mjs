// Localhost-only HTTP host for Scenario Studio in a browser (plan21).
// Binds 127.0.0.1, requires a per-run token, and owns the scenario request rules.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import { join, resolve, basename, dirname, extname, sep } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createWorkerBridge, fail } from "./worker-bridge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

export const allowed = {
  sourceScene: ["scene"],
  extract: ["scene", "actor_tokens", "start_s", "end_s"],
  variant: ["scenario_id", "target_actor", "speed_factor", "gap_offset_m"],
  export: ["scenario_id"],
  replay: ["scenario_id"],
  mapContext: ["source_id"],
  exportMapContext: ["source_id"],
  importXosc: ["source_id", "xml_base64"],
  openImported: ["source_id", "path"],
  replayImported: ["scenario_id"],
  chooseDataset: ["path"],
  chooseWorkspace: ["path"],
  listScenes: [],
  settings: [],
  cancelJob: [],
};
const ID = /^[a-f0-9]{32}$/;

export function validateArgs(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw fail("INVALID_INPUT", "Invalid request");
  if (!allowed[name] || Object.keys(args).some((k) => !allowed[name].includes(k))) throw fail("INVALID_INPUT", "Unknown field");
  const limit = name === "importXosc" ? 3 * 1024 * 1024 : 65536;
  if (JSON.stringify(args).length > limit) throw fail("INVALID_INPUT", "Request too large");
  if (["mapContext", "exportMapContext", "importXosc", "openImported"].includes(name) &&
      (typeof args.source_id !== "string" || !ID.test(args.source_id)))
    throw fail("INVALID_INPUT", "Invalid source identity");
  if (name === "replayImported" && (typeof args.scenario_id !== "string" || !ID.test(args.scenario_id)))
    throw fail("INVALID_INPUT", "Invalid scenario identity");
  if (["chooseDataset", "chooseWorkspace", "openImported"].includes(name) &&
      (typeof args.path !== "string" || !args.path.trim() || args.path.length > 4096))
    throw fail("INVALID_INPUT", "Invalid path");
  if (name === "importXosc" && (typeof args.xml_base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(args.xml_base64)))
    throw fail("INVALID_INPUT", "Invalid XOSC payload");
  return args;
}

const statusFor = (code) =>
  code === "FORBIDDEN" ? 403 : ["BUSY", "CANCELLED"].includes(code) ? 409 :
  ["INVALID_INPUT", "RESOURCE_LIMIT", "PATH_ESCAPE", "DATASET_INVALID", "NOT_FOUND"].includes(code) ? 400 : 500;

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".glb": "model/gltf-binary" };

function expandHome(path) {
  return path.trim().replace(/^~(?=$|\/)/, os.homedir());
}

export function createLocalServer({
  staticDir = join(root, "frontend", "dist-local"),
  userData = join(os.homedir(), "Library", "Application Support", "Topeye"),
  python = join(root, "backend", ".venv", "bin", "python"),
  engine = join(root, "backend", ".tools", "esmini", "build", "EnvironmentSimulator", "Libraries", "esminiLib", "libesminiLib.dylib"),
  version = JSON.parse(fs.readFileSync(join(root, "frontend", "package.json"), "utf8")).version,
  bridgeFactory = createWorkerBridge,
} = {}) {
  const token = randomBytes(32).toString("hex");
  fs.mkdirSync(userData, { recursive: true });
  const settingsPath = join(userData, "scenario-settings.json");
  let settings;
  try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { settings = {}; }
  settings.workspace ||= join(os.homedir(), "Documents", "Topeye Projects");
  const saveSettings = () => {
    const temporary = settingsPath + "." + randomUUID() + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(settings), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, settingsPath);
  };
  const clients = new Set();
  const log = fs.createWriteStream(join(userData, "scenario-worker.log"), { flags: "a" });
  const bridge = bridgeFactory({
    command: python,
    args: ["-m", "topeye.scenario.worker"],
    cwd: userData,
    env: { ...process.env, PYTHONPATH: join(root, "backend"), PYTHONUNBUFFERED: "1" },
    log,
    onProgress: (msg) => {
      const line = `data: ${JSON.stringify({ phase: msg.phase, completed: msg.completed, total: msg.total })}\n\n`;
      for (const res of clients) res.write(line);
    },
  });
  const params = (args) => ({
    ...args,
    dataset: settings.dataset,
    dataset_version: settings.datasetVersion || null,
    workspace: settings.workspace,
    engine,
  });
  const call = (method, args = {}) => {
    if (!settings.dataset) throw fail("DATASET_INVALID", "Chọn thư mục nuScenes trước");
    return bridge.request(method, params(args));
  };
  const realDir = (input) => {
    let path;
    try { path = fs.realpathSync(expandHome(input)); } catch { throw fail("NOT_FOUND", "Không tìm thấy thư mục"); }
    if (!fs.statSync(path).isDirectory()) throw fail("INVALID_INPUT", "Cần một thư mục");
    return path;
  };

  async function handle(name, args) {
    const checked = validateArgs(name, args);
    if (name === "cancelJob") { await bridge.stop(); return true; }
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
      if (bridge.busy) throw fail("BUSY", "Dừng tác vụ trước khi đổi thư mục");
      const path = realDir(checked.path);
      const result = await bridge.request("inspect_dataset", { dataset: path, workspace: settings.workspace || "", engine });
      settings.dataset = result.root;
      settings.datasetVersion = result.version;
      saveSettings();
      return { name: basename(result.root), version: result.version, scenes: result.scenes };
    }
    if (bridge.busy && ["mapContext", "exportMapContext", "importXosc", "openImported", "replayImported"].includes(name))
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
      return call("import_xosc", { source_id: checked.source_id, xml_base64: bytes.toString("base64") });
    }
    if (name === "listScenes") return call("list_scenes");
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
    const port = server.address().port;
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
      return serveStatic(req, res, url.pathname);
    }
    if (url.pathname === "/api/events" && req.method === "GET") {
      if (url.searchParams.get("token") !== token) return send(403, { code: "FORBIDDEN", message: "Invalid token" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(": ok\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method !== "POST") return send(405, { code: "INVALID_INPUT", message: "Method not allowed" });
    if (req.headers["x-topeye-token"] !== token) return send(403, { code: "FORBIDDEN", message: "Invalid token" });
    const name = url.pathname.slice("/api/".length);
    if (!Object.hasOwn(allowed, name)) return send(404, { code: "NOT_FOUND", message: "Unknown method" });
    let raw = "";
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) return send(400, { code: "INVALID_INPUT", message: "Request too large" });
      raw += chunk;
    }
    let args;
    try { args = raw ? JSON.parse(raw) : {}; } catch { return send(400, { code: "INVALID_INPUT", message: "Invalid JSON" }); }
    try { send(200, { value: await handle(name, args) }); }
    catch (e) {
      const code = e.code && /^[A-Z_]+$/.test(e.code) ? e.code : "INTERNAL";
      const message = String(e.message || e).replace(/^[A-Z_]+: /, "");
      send(statusFor(code), { code, message });
    }
  });

  async function close() {
    for (const res of clients) res.end();
    await bridge.stop();
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
    console.log(`Topeye local web: ${url}`);
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
