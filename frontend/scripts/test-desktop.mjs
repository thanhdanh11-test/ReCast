import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const appPath = resolve(process.argv[2]),
  dataset = resolve(process.argv[3]),
  evidence = resolve(process.argv[4]);
const workspace = mkdtempSync(join(tmpdir(), "topeye-installed-projects-"));
const metadata = join(dataset, "v1.0-mini");
function hashes() {
  return Object.fromEntries(
    readdirSync(metadata)
      .filter((n) => n.endsWith(".json"))
      .map((n) => [
        n,
        createHash("sha256")
          .update(readFileSync(join(metadata, n)))
          .digest("hex"),
      ]),
  );
}
const before = hashes();
const isolatedUserData = mkdtempSync(join(tmpdir(), "topeye-test-profile-"));
const app = await electron.launch({
  args: ["--user-data-dir=" + isolatedUserData],
  executablePath: appPath,
  cwd: tmpdir(),
  env: {
    ...process.env,
    PATH: "/usr/bin:/bin",
    PYTHONPATH: "",
    ELECTRON_RUN_AS_NODE: "",
  },
  timeout: 30000,
});
const errors = [];
let result,
  owned = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(120000);
  await app.evaluate(
    ({ app }, path) => app.setPath("userData", path),
    isolatedUserData,
  );
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.getByRole("heading", { name: /Scenario Studio|scene-/ }).waitFor();
  const paths = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    path: app.getAppPath(),
    version: app.getVersion(),
    userData: app.getPath("userData"),
  }));
  assert(paths.packaged);
  assert(!paths.path.includes("/topeye/"));
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, workspace);
  await page.getByRole("button", { name: "Thư mục lưu", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Đã cập nhật nơi lưu" })
    .waitFor();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, dataset);
  await page.locator(".dataset-button").click();
  await page
    .getByRole("status")
    .filter({ hasText: "Đã đọc 10 cảnh" })
    .waitFor();
  await page.getByLabel("Cảnh đang xem", {exact:true}).selectOption("scene-0103");
  await page.locator(".studio-status").filter({hasText:"Cảnh gốc:"}).waitFor();
  assert.equal(await page.locator(".scene3d").getAttribute("data-source"), "source");
  assert(await page.getByRole("button", { name: "Xuất kịch bản ↗", exact: true }).isDisabled());
  const mapStart = await page.locator(".map-ego").getAttribute("d");
  const scanStart = await page.locator("[data-testid=lidar-view] svg").innerHTML();
  const sourceStartX = Number(await page.locator(".scene3d").getAttribute("data-ego-x"));
  await page.getByRole("slider", { name:"Thời gian mô phỏng" }).fill("5");
  await page.waitForFunction((x) => Math.abs(Number(document.querySelector(".scene3d").dataset.egoX) - x) > 1, sourceStartX);
  assert.equal(await page.locator(".scene3d-error").count(), 0);
  await page.screenshot({ path: join(evidence, "installed-source.png") });
  assert.notEqual(await page.locator(".map-ego").getAttribute("d"), mapStart);
  assert.notEqual(await page.locator("[data-testid=lidar-view] svg").innerHTML(), scanStart);
  const layouts=[];
  for(const [width,height] of [[1360,900],[1050,720]]) {
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),[width,height]);
    await page.waitForFunction(w=>window.outerWidth===w,width);
    const bounds=await page.evaluate(()=>{
      const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
      return {canvas:box('.scene3d canvas'),host:box('.primary-view .panel-content'),controls:box('.camera-controls'),lidar:box('[data-testid=lidar-view] svg'),map:box('[data-testid=map-view] svg'),viewport:{width:innerWidth,height:innerHeight},bodyWidth:document.body.scrollWidth};
    });
    assert(bounds.canvas.width>250 && bounds.canvas.height>250);
    assert(bounds.controls.y>=bounds.host.y && bounds.controls.bottom<=bounds.host.bottom);
    assert(bounds.controls.right<=bounds.host.right);
    assert(bounds.lidar.height>100 && bounds.map.height>100);
    assert(bounds.bodyWidth<=bounds.viewport.width);
    layouts.push({width,height,...bounds});
    await page.screenshot({path:join(evidence,`sensor-views-${width}.png`)});
  }
  await page.getByRole('checkbox',{name:'Hiển thị map tích hợp'}).uncheck();
  assert.equal(await page.locator('[data-testid=map-view]').count(),0);
  await page.getByRole('checkbox',{name:'Hiển thị map tích hợp'}).check();
  await page.locator('.actor-picker summary').click();
  assert.equal(await page.locator('.actor-list input').count(),58);
  await page.locator('.actor-picker summary').click();
  writeFileSync(join(evidence,'sensor-views.json'),JSON.stringify({layouts,mapMoves:true,lidarChanges:true,mapToggle:true,allTracks:58},null,2));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1360,900));

  await page.getByRole("button", { name: "Toàn cảnh", exact: true }).click();
  await page.screenshot({ path: join(evidence, "installed-source-overview.png") });
  await page.getByRole("button", { name: "Bám xe", exact: true }).click();
  await page
    .getByRole("button", { name: "Trích đoạn thử nghiệm", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Đã trích quỹ đạo" })
    .waitFor();
  await page
    .getByRole("button", { name: "Xuất kịch bản ↗", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "Đã xuất:" }).waitFor();
  await page
    .getByRole("button", { name: "Chạy phát lại", exact: true })
    .click();
  await page.locator(".replay-result strong").filter({hasText:"Đạt ngưỡng kiểm chứng"}).waitFor();
  assert.equal(await page.locator(".replay-result p").count(), 2);
  await page.locator(".scene3d canvas").waitFor();
  const gpu = await page.locator(".scene3d canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2");
    return {
      webgl2: !!gl,
      width: canvas.width,
      height: canvas.height,
      maxTextureSize: gl?.getParameter(gl.MAX_TEXTURE_SIZE),
    };
  });
  assert(gpu.webgl2 && gpu.width > 200 && gpu.height > 200);
  assert.equal(
    await page.locator(".scene3d").getAttribute("data-source"),
    "esmini",
  );
  const startX = Number(
    await page.locator(".scene3d").getAttribute("data-ego-x"),
  );
  await page.getByRole("slider", { name:"Thời gian mô phỏng" }).fill("1");
  await page.waitForFunction(
    (x) =>
      Math.abs(Number(document.querySelector(".scene3d").dataset.egoX) - x) >
      0.1,
    startX,
  );
  await page.getByRole("button", { name: "Toàn cảnh", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Toàn cảnh", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: join(evidence, "installed-overview.png") });
  await page.getByRole("button", { name: "Bám xe", exact: true }).click();
  assert.equal(await page.locator(".scene3d canvas").count(), 1);
  writeFileSync(
    join(evidence, "viewport3d.json"),
    JSON.stringify(
      {
        gpu,
        source: "esmini",
        seekMoved: true,
        cameraControls: true,
        canvasCount: 1,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: join(evidence, "installed-baseline.png") });
  await page.getByRole("button", { name: "Phát mô phỏng", exact: true }).click();
  await page
    .getByRole("button", { name: "Phát mô phỏng", exact: true })
    .waitFor();
  assert.equal(await page.locator(".scene3d-error").count(), 0);
  const area = await page.locator(".scene3d canvas").boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    area.x + area.width / 2 + 55,
    area.y + area.height / 2 + 15,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.locator(".scene3d-guide").filter({ hasText: "Tự do" }).waitFor();
  await page.getByRole("button", { name: "Bám xe", exact: true }).click();
  await page.getByRole("slider", { name:"Hệ số tốc độ" }).fill("1.2");
  await page.getByRole("button", { name: "Tạo biến thể", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Biến thể đã sẵn sàng" })
    .waitFor();
  await page
    .getByRole("button", { name: "Chạy phát lại", exact: true })
    .click();
  await page.locator(".replay-result strong").filter({hasText:"Đạt ngưỡng kiểm chứng"}).waitFor();
  assert.equal(await page.locator(".scene3d canvas").count(), 1);
  await page.screenshot({ path: join(evidence, "installed-variant.png") });
  const security = await page.evaluate(() => ({
    node: typeof window.require,
    rawIPC: typeof window.ipcRenderer,
    methods: Object.keys(window.scenarioApp),
  }));
  assert.equal(security.node, "undefined");
  assert.equal(security.rawIPC, "undefined");
  const projects = readdirSync(workspace);
  assert.equal(projects.length, 2);
  const reports = projects.map((id) => {
    const runs = join(workspace, id, "runs");
    const run = readdirSync(runs)[0];
    return JSON.parse(readFileSync(join(runs, run, "report.json")));
  });
  assert(
    reports.every((r) => r.status === "pass" && r.validity.engine_completed),
  );
  const cancelled = await page.evaluate(async () => {
    const api = window.scenarioApp;
    const scenario = await api.extract({
      scene: "scene-0103",
      actor_tokens: ["ec0e6425eae2442698ff7b43d405d279"],
      start_s: 8,
      end_s: 13,
    });
    return Promise.allSettled([
      api.replay({ scenario_id: scenario.id }),
      api.cancelJob(),
    ]).then((results) =>
      results.map((r) => ({
        status: r.status,
        value: r.status === "fulfilled" ? r.value : String(r.reason),
      })),
    );
  });
  assert.equal(cancelled[0].status, "rejected");
  assert.equal(cancelled[1].status, "fulfilled");
  await page.evaluate(() => window.scenarioApp.listScenes());
  const markerStates = readdirSync(workspace).flatMap((id) => {
    try {
      return readdirSync(join(workspace, id, "runs")).map(
        (run) =>
          JSON.parse(
            readFileSync(join(workspace, id, "runs", run, "status.json")),
          ).status,
      );
    } catch {
      return [];
    }
  });
  assert(!markerStates.includes("running"));
  const after = hashes();
  assert.deepEqual(after, before);
  assert.deepEqual(errors, []);
  const workerPrefix = join(dirname(dirname(appPath)), "Resources", "worker");
  owned = execFileSync("/bin/ps", ["-ax", "-o", "pid=,ppid=,command="], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(
      (s) =>
        s.includes(workerPrefix) &&
        Number(s.trim().split(/\s+/)[1]) === app.process().pid,
    )
    .map((s) => Number(s.trim().split(/\s+/)[0]));
  assert(owned.length >= 1);
  result = {
    paths,
    appPid: app.process().pid,
    workspace,
    launchCwd: tmpdir(),
    launchPath: "/usr/bin:/bin",
    nativePicker:
      "dialog result injected; native sheet visually observed separately",
    reports,
    security,
    cancelled,
    markerStates,
    metadataUnchanged: true,
    sourceScene: { loaded: true, seekMoved: true, exportDisabled: true, cameraControls: true },
    metadataFiles: Object.keys(before).length,
    rendererErrors: errors,
    ownedPids: owned,
  };
} finally {
  await app.close();
}
const deadline = Date.now() + 12000;
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === "ESRCH") return false;
    throw e;
  }
}
while (owned.some(alive) && Date.now() < deadline)
  await new Promise((r) => setTimeout(r, 50));
writeFileSync(
  join(evidence, "installed-lifecycle.json"),
  JSON.stringify(
    { appPid: result?.appPid, owned, alive: owned.filter(alive) },
    null,
    2,
  ),
);
assert(
  owned.every((pid) => !alive(pid)),
  "Owned process survived app.close",
);
writeFileSync(
  join(evidence, "installed-app.json"),
  JSON.stringify({ ...result, ownedChildrenGone: true }, null, 2),
);
console.log(
  "Installed desktop flow, real engine, cancellation and dataset integrity: PASS",
);
