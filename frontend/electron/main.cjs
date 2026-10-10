const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn } = require("node:child_process");
const { join, resolve } = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
let window, worker, pending, ready, settings, log;
let stopping = false;
let nativeOperation = false;
let shutdown;
const root = resolve(__dirname, "../..");
const workerPath = () =>
  app.isPackaged
    ? join(process.resourcesPath, "worker", "topeye-worker")
    : join(root, "backend", ".venv", "bin", "python");
const enginePath = () =>
  app.isPackaged
    ? join(process.resourcesPath, "engine", "libesminiLib.dylib")
    : join(
        root,
        "backend",
        ".tools",
        "esmini",
        "build",
        "EnvironmentSimulator",
        "Libraries",
        "esminiLib",
        "libesminiLib.dylib",
      );
function fail(code, message) {
  const e = new Error(`${code}: ${message}`);
  e.code = code;
  return e;
}
function saveSettings() {
  const path = join(app.getPath("userData"), "scenario-settings.json");
  const temporary = path + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(settings), {
    flag: "wx",
    mode: 0o600,
  });
  fs.renameSync(temporary, path);
}
function startWorker() {
  if (shutdown) return shutdown.then(startWorker);
  if (worker) return ready;
  const args = app.isPackaged ? [] : ["-m", "topeye.scenario.worker"];
  const child = spawn(workerPath(), args, {
    cwd: app.getPath("userData"),
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PYTHONPATH: join(root, "backend"),
      PYTHONUNBUFFERED: "1",
    },
  });
  worker = child;
  child.stdout.setEncoding("utf8");
  child.stdin.on("error", (err) => {
    if (pending) {
      pending.reject(err);
      pending = null;
    }
  });
  let buffer = "";
  ready = new Promise((res, rej) => {
    const timer = setTimeout(() => {
      rej(fail("TIMEOUT", "Worker startup"));
      stopWorker();
    }, 30000);
    child.on("error", (err) => {
      clearTimeout(timer);
      if (worker === child) worker = null;
      rej(err);
    });
    child.stderr.on("data", (chunk) => log.write(chunk));
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
        rej(fail("INVALID_INPUT", "Oversized worker message"));
        stopWorker();
        return;
      }
      let split;
      while ((split = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, split);
        buffer = buffer.slice(split + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          rej(fail("INTERNAL", "Invalid worker output"));
          stopWorker();
          return;
        }
        if (msg.type === "ready") {
          clearTimeout(timer);
          res();
          continue;
        }
        if (!pending || msg.id !== pending.id) continue;
        if (msg.type === "progress") {
          window?.webContents.send("scenario:progress", msg);
          continue;
        }
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
      if (pending) {
        pending.reject(fail("CANCELLED", "Operation interrupted"));
        pending = null;
      }
    });
  });
  return ready;
}
async function stopWorker() {
  if (shutdown) return shutdown;
  const child = worker;
  if (!child) return;
  const group = -child.pid;
  const signal = (name) => {
    try {
      process.kill(group, name);
      return true;
    } catch (e) {
      if (e.code === "ESRCH") return false;
      throw e;
    }
  };
  shutdown = (async () => {
    signal("SIGTERM");
    const deadline = Date.now() + 5000;
    while (signal(0) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (signal(0)) signal("SIGKILL");
    const killDeadline = Date.now() + 5000;
    while (signal(0) && Date.now() < killDeadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (signal(0))
      throw fail("ENGINE_FAILED", "Unable to stop owned process group");
  })();
  try {
    await shutdown;
  } finally {
    shutdown = null;
  }
}
async function call(method, args = {}) {
  if (pending) throw fail("BUSY", "Một tác vụ đang chạy");
  if (!settings.dataset)
    throw fail("DATASET_INVALID", "Chọn thư mục nuScenes trước");
  await startWorker();
  if (pending) throw fail("BUSY", "Một tác vụ đang chạy");
  return new Promise((resolveResult, reject) => {
    const id = crypto.randomUUID();
    pending = { id, resolve: resolveResult, reject };
    worker.stdin.write(
      JSON.stringify({
        id,
        method,
        params: {
          ...args,
          dataset: settings.dataset,
          dataset_version: settings.datasetVersion || null,
          workspace: settings.workspace,
          engine: enginePath(),
        },
      }) + "\n",
    );
  });
}
const allowed = {
  sourceScene: ["scene"],
  extract: ["scene", "actor_tokens", "start_s", "end_s"],
  variant: ["scenario_id", "target_actor", "speed_factor", "gap_offset_m"],
  export: ["scenario_id"],
  replay: ["scenario_id"],
  mapContext: ["source_id"],
  exportMapContext: ["source_id"],
  importXosc: ["source_id"],
  openImported: ["source_id"],
  replayImported: ["scenario_id"],
};
function validateArgs(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw fail("INVALID_INPUT", "Invalid request");
  if (!allowed[name] || Object.keys(args).some((k) => !allowed[name].includes(k)))
    throw fail("INVALID_INPUT", "Unknown field");
  if (JSON.stringify(args).length > 65536)
    throw fail("INVALID_INPUT", "Request too large");
  if (["mapContext", "exportMapContext", "importXosc", "openImported"].includes(name) &&
      (typeof args.source_id !== "string" || !/^[a-f0-9]{32}$/.test(args.source_id)))
    throw fail("INVALID_INPUT", "Invalid source identity");
  if (name === "replayImported" &&
      (typeof args.scenario_id !== "string" || !/^[a-f0-9]{32}$/.test(args.scenario_id)))
    throw fail("INVALID_INPUT", "Invalid scenario identity");
  return args;
}
app.whenReady().then(() => {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  try {
    settings = JSON.parse(
      fs.readFileSync(join(dir, "scenario-settings.json"), "utf8"),
    );
  } catch {
    settings = {};
  }
  settings.workspace ||= join(app.getPath("documents"), "Topeye Projects");
  log = fs.createWriteStream(join(dir, "scenario-worker.log"), { flags: "a" });
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1050,
    minHeight: 720,
    title: "Topeye · Scenario Studio",
    backgroundColor: "#f4f5f7",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const html = app.isPackaged
    ? join(app.getAppPath(), "dist", "scenario.html")
    : join(root, "frontend", "dist", "scenario.html");
  window.loadFile(html);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  for (const name of [
    "chooseDataset",
    "chooseWorkspace",
    "listScenes",
    "sourceScene",
    "extract",
    "export",
    "variant",
    "replay",
    "cancelJob",
    "settings",
    "mapContext",
    "exportMapContext",
    "importXosc",
    "openImported",
    "replayImported",
  ]) {
    ipcMain.handle("scenario:" + name, async (event, args) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw fail("FORBIDDEN", "Invalid sender");
      if (nativeOperation && !["cancelJob", "settings"].includes(name))
        throw fail("BUSY", "Một hộp thoại đang mở");
      const ownsNative = ["chooseDataset", "chooseWorkspace", "exportMapContext", "importXosc", "openImported"].includes(name);
      if (ownsNative) nativeOperation = true;
      try {
      if (name === "cancelJob") {
        await stopWorker();
        return true;
      }
      if (name === "settings")
        return {
          dataset: settings.dataset
            ? require("node:path").basename(settings.dataset)
            : null,
          datasetVersion: settings.datasetVersion || null,
          workspace: settings.workspace,
          engineAvailable: fs.existsSync(enginePath()),
          version: app.isPackaged
            ? app.getVersion()
            : require("../package.json").version,
        };
      if (name === "chooseWorkspace") {
        if (pending) throw fail("BUSY", "Dừng tác vụ trước khi đổi thư mục");
        const choice = await dialog.showOpenDialog(window, {
          properties: ["openDirectory", "createDirectory"],
        });
        if (choice.canceled) return null;
        const path = fs.realpathSync(choice.filePaths[0]);
        settings.workspace = path;
        saveSettings();
        return { name: require("node:path").basename(path) };
      }
      if (name === "chooseDataset") {
        if (pending) throw fail("BUSY", "Dừng tác vụ trước khi đổi thư mục");
        const choice = await dialog.showOpenDialog(window, {
          properties: ["openDirectory"],
        });
        if (choice.canceled) return null;
        const path = fs.realpathSync(choice.filePaths[0]);
        await startWorker();
        if (pending) throw fail("BUSY", "Một tác vụ đang chạy");
        const result = await new Promise((resolveResult, reject) => {
          const id = crypto.randomUUID();
          pending = { id, resolve: resolveResult, reject };
          worker.stdin.write(
            JSON.stringify({
              id,
              method: "inspect_dataset",
              params: {
                dataset: path,
                workspace: settings.workspace || "",
                engine: enginePath(),
              },
            }) + "\n",
          );
        });
        settings.dataset = result.root;
        settings.datasetVersion = result.version;
        saveSettings();
        return { name: require("node:path").basename(result.root), version: result.version, scenes: result.scenes };
      }
      if (["mapContext", "exportMapContext", "importXosc", "openImported", "replayImported"].includes(name)) {
        const checked = validateArgs(name, args);
        if (pending) throw fail("BUSY", "Dừng tác vụ trước khi nạp kịch bản");
        if (name === "mapContext") return call("map_context", checked);
        if (name === "replayImported") return call("replay_imported", checked);
        if (name === "exportMapContext") {
          const context = await call("map_context", checked);
          const selected = await dialog.showSaveDialog(window, {
            title: "Xuất thông tin map cho trình tạo kịch bản",
            defaultPath: `topeye-${context.scene}-map.json`,
            filters: [{ name: "Map context", extensions: ["json"] }],
          });
          if (selected.canceled || !selected.filePath) return null;
          const target = resolve(selected.filePath);
          const parent = fs.realpathSync(require("node:path").dirname(target));
          const canonical = join(parent, require("node:path").basename(target));
          const dataset = fs.realpathSync(settings.dataset);
          if (canonical === dataset || canonical.startsWith(dataset + require("node:path").sep))
            throw fail("PATH_ESCAPE", "Không ghi vào dữ liệu nguồn");
          if (fs.existsSync(canonical) && fs.lstatSync(canonical).isSymbolicLink())
            throw fail("PATH_ESCAPE", "Không ghi qua liên kết file");
          const temp = canonical + "." + crypto.randomUUID() + ".tmp";
          try {
            fs.writeFileSync(temp, JSON.stringify(context, null, 2), {flag:"wx", mode:0o600});
            fs.renameSync(temp, canonical);
          } finally {
            if (fs.existsSync(temp)) fs.unlinkSync(temp);
          }
          return {path: canonical};
        }
        const selected = await dialog.showOpenDialog(window, {
          title: name === "openImported" ? "Mở gói kịch bản đã nạp" : "Nạp OpenSCENARIO",
          properties: [name === "openImported" ? "openDirectory" : "openFile"],
          ...(name === "importXosc" ? {filters:[{name:"OpenSCENARIO",extensions:["xosc"]}]} : {}),
        });
        if (selected.canceled || !selected.filePaths.length) return null;
        if (name === "openImported")
          return call("open_imported", {...checked, package_path: fs.realpathSync(selected.filePaths[0])});
        // Bound native file input before crossing the private JSONL boundary.
        const fd = fs.openSync(selected.filePaths[0], fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        let bytes;
        try {
          const stat = fs.fstatSync(fd);
          if (!stat.isFile() || stat.size > 2097152) throw fail("RESOURCE_LIMIT", "XOSC tối đa 2 MiB");
          bytes = Buffer.alloc(stat.size);
          let offset = 0;
          while (offset < bytes.length) {
            const read = fs.readSync(fd, bytes, offset, bytes.length-offset, offset);
            if (!read) throw fail("IO_ERROR", "File thay đổi khi đang đọc");
            offset += read;
          }
          if (fs.fstatSync(fd).size !== stat.size) throw fail("IO_ERROR", "File thay đổi khi đang đọc");
        } finally { fs.closeSync(fd); }
        return call("import_xosc", {...checked, xml_base64: bytes.toString("base64")});
      }
      if (name === "listScenes") return call("list_scenes");
      return call(
        name === "sourceScene" ? "source_scene" : name,
        validateArgs(name, args),
      );
      } finally {
        if (ownsNative) nativeOperation = false;
      }
    });
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if ((worker || shutdown) && !stopping) {
    event.preventDefault();
    stopping = true;
    stopWorker().finally(() => app.quit());
  }
});
