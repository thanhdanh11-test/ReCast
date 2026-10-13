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
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  };
  const waitFooter = async (re, timeout = 120000) => {
    await p.waitForFunction((src) => new RegExp(src).test(document.querySelector('[aria-label="Trạng thái tác vụ"] span')?.textContent || ""), re.source, { timeout });
    return footer();
  };
  // A job may start a frame after an action (e.g. the library read when the runner opens): settle briefly, then require idle.
  const notBusy = async () => {
    await p.waitForTimeout(150);
    await p.waitForFunction(() => !document.querySelector("[data-testid=busy-indicator]") && !/^◌/.test(document.querySelector('[aria-label="Trạng thái tác vụ"] span')?.textContent || ""), null, { timeout: 180000 });
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
  await tool("Dữ liệu");
  await p.locator("button", { hasText: /Đổi dữ liệu|Chọn thư mục dữ liệu/ }).click();
  step("dataset", await waitFooter(/Đã đọc \d+ cảnh/));
  await tool("Cảnh nguồn");
  const scenes = await p.getByRole("list", { name: "Danh sách cảnh" }).getByRole("button").count();
  step("scenes", scenes);
  // 2. source 0103 + extract preset + replay
  await p.getByRole("button", { name: /^scene-0103/ }).click();
  step("source", await waitFooter(/Cảnh gốc: \d+/));
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
  // 5. OpenSCENARIO: create dialog → map context download (scene-0061 has a valid map)
  await tool("Cảnh nguồn");
  await p.getByRole("button", { name: /^scene-0061/ }).click();
  // The status still shows the previous scene's "Cảnh gốc" line, so wait for 0061 itself to be current.
  await p.waitForFunction(() => document.querySelector('.scene-list [aria-current="true"] strong')?.textContent === "scene-0061", null, { timeout: 90000 });
  await notBusy();
  await p.getByRole("button", { name: "OpenSCENARIO" }).click();
  await p.getByTestId("scenario-runner").waitFor();
  await notBusy();
  step("libraryUi", { checkboxes: await p.locator(".runner-list input[type=checkbox]").count(), headerButtons: await p.locator(".runner-head button").count(), createRed: await p.getByRole("button", { name: "Tạo kịch bản" }).evaluate(e => getComputedStyle(e).backgroundColor) });
  await p.getByRole("button", { name: "Tạo kịch bản" }).click();
  const dialog = p.getByRole("dialog", { name: "Tạo kịch bản" });
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
  const created = p.locator(".runner-item.active");
  step("create", { footer: await footer(), dialogClosed: await dialog.count() === 0, name: await created.locator("strong").textContent(), mapInReport: await p.locator('.runner-report [aria-label="Map 2D"] [data-testid="map-view"]').count(), runButtons: await p.getByRole("button", { name: /Chạy (lại )?kịch bản này/ }).count() });
  // Metrics of the opened scenario are computed automatically on the metrics worker (plan33).
  const metricsBox = p.locator('[aria-label="Chỉ số kịch bản"]');
  await metricsBox.locator(".metrics-cards").waitFor({ timeout: 180000 });
  const cards = await metricsBox.locator(".metrics-card strong").allTextContents();
  if (cards.length !== 4 || cards.includes("—")) throw new Error(`metrics cards ${JSON.stringify(cards)}`);
  await metricsBox.scrollIntoViewIfNeeded();
  await p.screenshot({ path: join(out, "scenario-metrics.png") });
  step("scenarioMetrics", cards);
  // 7. edit the XML (rename + new description), saved as a validated new package
  const xml = fs.readFileSync(xosc, "utf8");
  await created.getByRole("button", { name: /^Sửa / }).click();
  const editor = p.getByRole("dialog", { name: /^Sửa / });
  await editor.getByRole("textbox", { name: "Tên kịch bản" }).fill("e2e-edited.xosc");
  await editor.getByRole("textbox", { name: "Nội dung OpenSCENARIO" }).fill(xml.replace(/description="[^"]*"/, 'description="E2E edited"'));
  await editor.getByRole("button", { name: "Lưu" }).click();
  await notBusy();
  const edited = p.locator(".runner-item", { hasText: "e2e-edited.xosc" });
  step("edit", { footer: await footer(), listed: await edited.count(), active: (await p.locator(".runner-item.active strong").textContent()) });
  // 8. export downloads the stored .xosc
  const [exported] = await Promise.all([p.waitForEvent("download"), edited.getByRole("button", { name: /^Xuất / }).click()]);
  const exportedFile = join(out, exported.suggestedFilename());
  await exported.saveAs(exportedFile);
  await notBusy();
  step("export", { file: exported.suggestedFilename(), hasEdit: fs.readFileSync(exportedFile, "utf8").includes('description="E2E edited"') });
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
const unexpected = summary.failed.filter(([status, path, , body]) => !(status === 409 && /^\/api\/replay(Imported)?$/.test(path) && body.includes("CANCELLED"))
  && !(status === 400 && path === "/api/scenarioMetrics" && body.includes('"NOT_FOUND"')));
if (!ok || summary.steps.length !== 14 || !summary.metadataUnchanged || summary.workersLeft || summary.external.length || unexpected.length) {
  console.error("Local web E2E: FAIL");
  process.exit(1);
}
console.log("Local web E2E (real dataset, measured LiDAR, pan/expand, OpenSCENARIO create/edit/export/delete, dataset integrity): PASS");
