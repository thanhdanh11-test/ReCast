// End-to-end check of the localhost web app on a real dataset and esmini engine (plan21/22).
// Usage: node scripts/test-local-web.mjs <nuscenes-root> [evidence-dir]
import { chromium } from "playwright-core";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalServer } from "../server/local-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataset = process.argv[2] && resolve(process.argv[2]);
if (!dataset) { console.error("Usage: node scripts/test-local-web.mjs <nuscenes-root> [evidence-dir]"); process.exit(2); }
const out = resolve(process.argv[3] || fs.mkdtempSync(join(os.tmpdir(), "topeye-e2e-")));
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(join(os.tmpdir(), "topeye-regression-"));
fs.writeFileSync(join(userData, "scenario-settings.json"), JSON.stringify({ workspace: join(userData, "workspace") }));
const metadata = () => {
  const dir = fs.readdirSync(dataset).map(d => join(dataset, d)).find(d => fs.existsSync(join(d, "scene.json")));
  return Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()
    .map(f => [f, createHash("sha256").update(fs.readFileSync(join(dir, f))).digest("hex")]));
};
const ownedWorkers = () => { try { return execFileSync("pgrep", ["-P", String(process.pid), "-f", "topeye.scenario.worker"]).toString().trim().split("\n").filter(Boolean).map(Number); } catch { return []; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const before = metadata();
let workerPids = [];
const host = createLocalServer({ userData, catalogSeeds: [{ root: dataset, name: "nuScenes mini" }] });
const url = `http://127.0.0.1:${await host.listen(0)}/`;
let ok = false, report;
try {
  const steps = [], errors = [], external = [];
  const step = (name, value = true) => { steps.push([name, value]); console.error("✓", name, value === true ? "" : JSON.stringify(value)); };
  const b = await chromium.launch({ channel: process.env.TOPEYE_BROWSER_CHANNEL || "chrome" });
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("console", m => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", e => errors.push(String(e)));
  const failed = []; p.on("response", async r => { if (r.status() >= 400) failed.push([r.status(), new URL(r.url()).pathname, steps.length ? steps.at(-1)[0] : "start", await r.text().catch(() => "")]); });
  p.on("request", r => { const u = new URL(r.url()); if (!["127.0.0.1", "localhost"].includes(u.hostname) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url()); });
  const footer = () => p.locator('[aria-label="Trạng thái tác vụ"] span').first().textContent();
  const tool = async (name) => {
    const button = p.getByRole("button", { name: new RegExp(`^${name}`) });
    // plan44: the rail marks the view on screen; the "Cảnh nguồn" drawer is open only when its panel exists.
    const open = name === "Cảnh nguồn" ? await p.getByRole("complementary", { name: "Cảnh nguồn" }).count() > 0 : (await button.getAttribute("aria-pressed")) === "true";
    if (!open) await button.click();
  };
  const waitFooter = async (re, timeout = 120000) => {
    await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('[aria-label="Trạng thái tác vụ"] span')?.textContent || ""), re.source, { timeout });
    return footer();
  };
  // A job may start a frame after an action (e.g. the library read when the runner opens): settle briefly, then require idle.
  const notBusy = async () => {
    await p.waitForTimeout(150);
    await p.waitForFunction(() => !document.querySelector("[data-testid=busy-indicator]") && !document.querySelector(".sw-cancel") && !/^◌/.test(document.querySelector('[aria-label="Trạng thái tác vụ"] span')?.textContent || ""), null, { timeout: 180000 });
  };
  await p.goto(url);
  await p.getByLabel("Tên đăng nhập", { exact: true }).fill("regression-owner");
  await p.getByLabel("Mật khẩu", { exact: true }).fill("regression-test-password");
  await p.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await p.getByRole("button", { name: "Mở nuScenes mini", exact: true }).click({ timeout: 120000 });
  await p.locator(".studio").waitFor();
  await notBusy(); await p.waitForTimeout(500);
  // 1. dataset via prompt
  p.once("dialog", d => d.accept(dataset));
  await tool("Cài đặt");
  await p.getByRole("navigation", { name: "Mục cài đặt" }).getByRole("button", { name: "Dữ liệu & lưu trữ" }).click();
  await p.locator("button", { hasText: /Đổi dữ liệu|Chọn thư mục dữ liệu/ }).click();
  step("dataset", await waitFooter(/Đã đọc \d+ cảnh/));
  // Settings page (plan35): storage is measured by the server for the isolated workspace.
  await p.getByText("Bộ nhớ đệm chỉ số", { exact: true }).waitFor();
  await p.screenshot({ path: join(out, "settings-data.png") });
  await tool("Cảnh nguồn");
  const scenes = await p.getByRole("list", { name: "Danh sách cảnh" }).getByRole("button").count();
  step("scenes", scenes);
  // 2. source 0103 + extract preset + replay
  await p.getByRole("button", { name: /^scene-0103/ }).click();
  step("source", await footer());
  // Measured LiDAR, drag-to-pan on LiDAR and map, per-panel expand (plan23).
  await p.waitForFunction(() => Number(document.querySelector('[data-testid="lidar-view"][data-mode="measured"]')?.getAttribute("data-points")) > 20000, null, { timeout: 60000 });
  step("measuredLidar", Number(await p.getByTestId("lidar-view").getAttribute("data-points")));
  const dragOn = async (selector) => {
    const box = await p.locator(selector).boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 });
    await p.mouse.up();
  };
  const tilt = () => p.locator(".lidar-3d").getAttribute("data-tilt").then(Number);
  const tiltBefore = await tilt();
  const box = await p.locator(".lidar-canvas").boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 80, { steps: 8 });
  await p.mouse.up();
  const tiltDragged = await tilt();
  await p.screenshot({ path: join(out, "lidar-3d-tilt.png") });
  await p.locator(".lidar-canvas").dblclick();
  const mapBox = () => p.locator(".map-panel .sensor-view > svg").getAttribute("viewBox");
  const mapBefore = await mapBox();
  await dragOn(".map-panel .sensor-view > svg");
  step("lidar3dAndMapPan", { tiltBefore, tiltDragged, topAgain: await tilt(), mapMoved: mapBefore !== await mapBox(), captions: await p.locator(".view-workspace :is(.sensor-note, .sensor-stat, .panel-heading, .scene3d-guide, .sensor-zoom)").count() });
  step("layoutCues", { warningChip: await p.locator(".scene3d-warning-chip").count(), header: (await p.locator(".studio-header").innerText()).trim(), statusVisible: await p.locator('[aria-label="Trạng thái tác vụ"]').evaluate(e => e.getBoundingClientRect().height > 2), rail: await p.getByRole("navigation", { name: "Công cụ" }).getByRole("button").count() });
  const expandedClasses = [];
  for (const label of ["khung 3D", "khung LiDAR", "khung map"]) {
    await p.getByRole("button", { name: `Phóng to ${label}` }).click();
    expandedClasses.push(await p.locator("main.view-workspace").getAttribute("class"));
    if (label === "khung LiDAR") await p.screenshot({ path: join(out, "lidar-expanded.png") });
    await p.keyboard.press("Escape");
  }
  step("expandPanels", expandedClasses.map(c => c.match(/expanded-\w+/)?.[0]));
  // 5. Scenario Studio (plan50): “Kịch bản có sẵn” dialog → map context download (scene-0061 has a valid map)
  await tool("Cảnh nguồn");
  await p.getByRole("button", { name: /^scene-0061/ }).click();
  // The status still shows the previous scene's "Cảnh gốc" line, so wait for 0061 itself to be current.
  await p.waitForFunction(() => document.querySelector('.scene-list [aria-current="true"] strong')?.textContent === "scene-0061", null, { timeout: 90000 });
  await notBusy();
  await p.getByRole("button", { name: "Kịch bản", exact:true }).click();
  const studio = p.getByTestId("scenario-studio");
  await studio.waitFor();
  await notBusy();
  await p.waitForFunction(() => document.querySelector(".studio-create .create-scenario")?.disabled === false, null, { timeout: 180000 });
  step("libraryUi", { columns: await p.locator(".studio-page > :is(.studio-scenes,.studio-center,.studio-history)").count(), oldToolbar: await p.locator(".sw-actions, .runner-tabs, .ud-flow").count(),
    createRed: await studio.getByRole("button", { name: "Tạo kịch bản" }).evaluate(e => getComputedStyle(e).backgroundColor) });
  await studio.getByRole("button", { name: "Tạo kịch bản" }).click();
  await studio.getByRole("menuitem", { name: /Kịch bản có sẵn/ }).click();
  const dialog = p.getByRole("dialog", { name: "Tạo kịch bản" });
  await dialog.locator(".authoring-more > summary").click(); // plan52: secondary actions live under “Thêm”
  const [download] = await Promise.all([p.waitForEvent("download"), dialog.getByRole("button", { name: "Tải thông tin map" }).click()]);
  const contextFile = join(out, download.suggestedFilename());
  await download.saveAs(contextFile);
  await notBusy();
  step("mapContext", { file: download.suggestedFilename(), bytes: fs.statSync(contextFile).size });
  // 6. generate fixture xosc and import it through the dialog
  const xosc = join(out, "fixture.xosc");
  const gen = spawnSync(join(root, "backend/.venv/bin/python"), [join(root, "backend/scripts/generate_map_scenario_fixture.py"), contextFile, xosc], { cwd: join(root, "backend"), env: { ...process.env, PYTHONPATH: join(root, "backend") } });
  if (gen.status !== 0) throw new Error("fixture: " + gen.stderr);
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), dialog.getByRole("button", { name: "Chọn file .xosc" }).click()]);
  await chooser.setFiles(xosc);
  await notBusy();
  await dialog.waitFor({state:"hidden"});
  const created = p.locator(".studio-history-list li.active");
  await created.waitFor({ timeout: 90000 });
  step("create", { footer: await footer(), dialogClosed: await dialog.count() === 0, name: await created.locator("strong").textContent(), map: await p.locator('.studio-center [data-testid="map-view"]').count() });
  const layout = await p.locator(".studio-page").evaluate(el => ({ rows: el.querySelectorAll(".studio-timeline-row").length, stages: el.querySelectorAll(".studio-stage").length, oldPlayers: el.querySelectorAll(".ud-stage, .runner-center").length }));
  if (layout.rows !== 3 || layout.stages !== 1 || layout.oldPlayers !== 0) throw new Error(JSON.stringify(layout));
  const slider = studio.getByRole("slider", { name: "Thời gian", exact: true });
  await slider.focus(); await p.keyboard.press("End");
  if (Number(await slider.inputValue()) !== Number(await slider.getAttribute("max"))) throw new Error("Timeline end");
  await p.keyboard.press("Home");
  await p.screenshot({ path: join(out, "studio-timeline.png") });
  step("timelineAndLayout", layout);
  // Phân tích: trajectory metrics of the opened scenario on the metrics worker (plan33), as its only section.
  await created.getByRole("button", { name: /^Phân tích / }).click();
  const tabs = await p.getByRole("tablist", { name: "Mục phân tích" }).getByRole("tab").allTextContents();
  const metricsBox = p.locator(".studio-analysis-body");
  await metricsBox.locator(".metrics-cards").waitFor({ timeout: 180000 });
  const cards = await metricsBox.locator(".metrics-card strong").allTextContents();
  if (cards.length !== 4 || cards.includes("—") || JSON.stringify(tabs) !== '["Độ khớp quỹ đạo"]') throw new Error(`metrics ${JSON.stringify({ tabs, cards })}`);
  await p.screenshot({ path: join(out, "scenario-metrics.png") });
  step("scenarioMetrics", cards);
  await p.getByRole("button", { name: "Quay lại Studio" }).click();
  // 7. edit the XML (rename + new description), saved as a validated new package
  const xml = fs.readFileSync(xosc, "utf8");
  await created.getByRole("button", { name: /^Sửa / }).click();
  const editor = p.getByRole("dialog", { name: /^Sửa / });
  // Hand-imported .xosc has no template: XML only after the explicit advanced choice (v0.30.1).
  await editor.getByRole("button", { name: "Sửa XML (nâng cao)" }).click();
  await editor.getByRole("textbox", { name: "Tên kịch bản" }).fill("e2e-edited.xosc");
  await editor.getByRole("textbox", { name: "Nội dung OpenSCENARIO" }).fill(xml.replace(/description="[^"]*"/, 'description="E2E edited"'));
  await editor.getByRole("button", { name: "Lưu" }).click();
  await notBusy();
  await editor.waitFor({state:"hidden"});
  const edited = p.locator(".studio-history-list li", { hasText: "e2e-edited.xosc" });
  await edited.waitFor({ timeout: 90000 });
  step("edit", { footer: await footer(), listed: await edited.count(), active: (await p.locator(".studio-history-list li.active strong").textContent()) });
  // 8. Lưu → “Chỉ .xosc” → Đã xuất page → 100 % → download zip with the edited XOSC
  await edited.getByRole("button", { name: /^Lưu / }).click();
  const save = p.getByRole("dialog", { name: /^Lưu kịch bản/ });
  await save.getByRole("combobox", { name: "Định dạng xuất" }).selectOption("xosc");
  await save.getByRole("button", { name: "Xác nhận" }).click();
  await save.waitFor({ state: "hidden" });
  await p.getByRole("button", { name: "Đã xuất", exact: true }).click();
  const exportRow = p.locator(".studio-exports-table tr", { hasText: "e2e-edited.xosc" });
  await p.locator('.studio-exports-table tr[data-status="done"]', { hasText: "e2e-edited.xosc" }).waitFor({ timeout: 120000 });
  const [exported] = await Promise.all([p.waitForEvent("download"), exportRow.getByRole("link", { name: /^Tải về / }).click()]);
  const exportedFile = join(out, exported.suggestedFilename());
  await exported.saveAs(exportedFile);
  const listing = spawnSync(join(root, "backend/.venv/bin/python"), ["-I", "-c", "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);x=[n for n in z.namelist() if n.endswith('.xosc')][0];print(json.dumps({'files':sorted(z.namelist()),'hasEdit':b'description=\"E2E edited\"' in z.read(x)}))", exportedFile]);
  if (listing.status !== 0) throw new Error("zip: " + listing.stderr);
  const zipped = JSON.parse(String(listing.stdout));
  step("export", { file: exported.suggestedFilename(), ...zipped, progress: await exportRow.locator("progress").getAttribute("value") });
  await p.getByRole("button", { name: "Kịch bản", exact: true }).click();
  // 10. delete (confirm) — also leaves the owner's library as it was
  p.once("dialog", d => d.accept());
  await edited.getByRole("button", { name: /^Xoá / }).click();
  await notBusy();
  step("delete", { footer: await footer(), remaining: await edited.count() });
  ok = true;
  await b.close();
  report = { steps, errors, external, failed };
} finally {
  workerPids = ownedWorkers();
  await host.close();
  fs.rmSync(userData, { recursive: true, force: true });
}
const after = metadata();
const summary = { ...report, metadataFiles: Object.keys(before).length, metadataUnchanged: JSON.stringify(before) === JSON.stringify(after), workersLeft: workerPids.filter(alive).length, ownedWorkerPids: workerPids, evidence: out };
fs.writeFileSync(join(out, "local-web-e2e.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
// Expected error responses: the deliberate cancel (409 CANCELLED) of a running esmini job.
// Deleting a scenario while its metrics are still computing answers NOT_FOUND for that computation.
const unexpected = summary.failed.filter(([status, path, , body]) => !(status === 400 && path === "/api/mapContext" && body.includes("INVALID_MAP_GEOMETRY")) && !(status === 409 && /^\/api\/replay(Imported)?$/.test(path) && body.includes("CANCELLED"))
  && !(status === 400 && path === "/api/scenarioMetrics" && body.includes('"NOT_FOUND"')));
if (!ok || summary.steps.length !== 15 || !summary.metadataUnchanged || summary.workersLeft || summary.external.length || unexpected.length) {
  console.error("Local web E2E: FAIL");
  process.exit(1);
}
console.log("Local web E2E (real dataset, measured LiDAR, pan/expand, Studio create/analyse/edit/export/delete, dataset integrity): PASS");
