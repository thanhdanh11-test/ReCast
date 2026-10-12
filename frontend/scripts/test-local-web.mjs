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
const userData = join(os.homedir(), "Library", "Application Support", "Topeye");
const metadata = () => {
  const dir = fs.readdirSync(dataset).map(d => join(dataset, d)).find(d => fs.existsSync(join(d, "scene.json")));
  return Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()
    .map(f => [f, createHash("sha256").update(fs.readFileSync(join(dir, f))).digest("hex")]));
};
const workers = () => { try { return execFileSync("pgrep", ["-f", "topeye.scenario.worker"]).toString().trim().split("\n").filter(Boolean).length; } catch { return 0; } };
const before = metadata();
const host = createLocalServer();
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
  const footer = () => p.locator("footer span").first().textContent();
  const waitFooter = async (re, timeout = 120000) => {
    await p.waitForFunction((src) => new RegExp(src).test(document.querySelector("footer span")?.textContent || ""), re.source, { timeout });
    return footer();
  };
  const notBusy = () => p.waitForFunction(() => !/^◌/.test(document.querySelector("footer span")?.textContent || ""), null, { timeout: 180000 });
  await p.goto(url);
  await notBusy(); await p.waitForTimeout(500);
  // 1. dataset via prompt
  p.once("dialog", d => d.accept(dataset));
  await p.locator("button", { hasText: /Đổi dữ liệu|Chọn thư mục nuScenes/ }).click();
  step("dataset", await waitFooter(/Đã đọc \d+ cảnh/));
  const scenes = await p.getByLabel("Cảnh đang xem").locator("option").count();
  step("scenes", scenes);
  // 2. source 0103 + extract preset + replay
  await p.getByLabel("Cảnh đang xem").selectOption("scene-0103");
  step("source", await waitFooter(/Cảnh gốc: \d+/));
  await p.getByRole("button", { name: "Trích đoạn thử nghiệm" }).click();
  step("extract", await waitFooter(/Đã trích/));
  await p.getByRole("button", { name: "Chạy phát lại" }).click();
  await waitFooter(/Đã lưu kết quả phát lại/, 180000);
  step("replay", { label: await p.locator(".primary-view .panel-heading span").textContent(), result: await p.locator(".replay-result strong").first().textContent() });
  await p.screenshot({ path: join(out, "local-replay.png") });
  // 3. variant 1.2x (free slider) + replay
  await p.getByLabel("Hệ số tốc độ").fill("1.2");
  await p.getByRole("button", { name: "Tạo biến thể" }).click();
  step("variant", await waitFooter(/Biến thể đã sẵn sàng/));
  await p.getByRole("button", { name: "Chạy phát lại" }).click();
  await waitFooter(/Đã lưu kết quả phát lại/, 180000);
  step("variantReplay", await p.locator(".replay-result strong").first().textContent());
  // 4. export bundle on disk
  await p.getByRole("button", { name: /Xuất kịch bản/ }).click();
  const exported = (await waitFooter(/Đã xuất: /)).replace("Đã xuất: ", "").trim();
  step("export", { path: exported, xosc: fs.existsSync(join(exported, "scenario.xosc")) || fs.existsSync(join(exported, "bundle", "scenario.xosc")) });
  // 5. map context download (scene-0061 has valid map)
  await p.getByLabel("Cảnh đang xem").selectOption("scene-0061");
  await waitFooter(/Cảnh gốc: \d+/);
  if ((await p.locator("button.header-import-trigger").getAttribute("aria-expanded")) !== "true") await p.locator("button.header-import-trigger").click();
  const [download] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Xuất thông tin map" }).click()]);
  const contextFile = join(out, download.suggestedFilename());
  await download.saveAs(contextFile);
  await notBusy();
  step("mapContext", { file: download.suggestedFilename(), bytes: fs.statSync(contextFile).size });
  // 6. generate fixture xosc and import by upload
  const xosc = join(out, "fixture.xosc");
  const gen = spawnSync(join(root, "backend/.venv/bin/python"), [join(root, "backend/scripts/generate_map_scenario_fixture.py"), contextFile, xosc], { cwd: join(root, "backend"), env: { ...process.env, PYTHONPATH: join(root, "backend") } });
  if (gen.status !== 0) throw new Error("fixture: " + gen.stderr);
  if ((await p.locator("button.header-import-trigger").getAttribute("aria-expanded")) !== "true") await p.locator("button.header-import-trigger").click();
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.getByRole("button", { name: "Nạp OpenSCENARIO" }).click()]);
  await chooser.setFiles(xosc);
  await notBusy();
  step("import", await footer());
  await p.getByRole("button", { name: "Chạy kịch bản đã nạp" }).click();
  await notBusy();
  step("importedReplay", { footer: await footer(), result: await p.locator(".replay-result strong").first().textContent() });
  // 7. reopen saved import by prompt path
  const ws = JSON.parse(fs.readFileSync(join(userData, "scenario-settings.json"), "utf8")).workspace;
  const imports = fs.readdirSync(ws).map(d => join(ws, d, "import")).filter(d => fs.existsSync(d)).sort((a, c) => fs.statSync(c).mtimeMs - fs.statSync(a).mtimeMs);
  if ((await p.locator("button.header-import-trigger").getAttribute("aria-expanded")) !== "true") await p.locator("button.header-import-trigger").click();
  p.once("dialog", d => d.accept(imports[0]));
  await p.getByRole("button", { name: "Mở kịch bản đã lưu" }).click();
  await notBusy();
  step("openImported", await footer());
  // 8. cancel mid-replay
  await p.getByLabel("Cảnh đang xem").selectOption("scene-0103");
  await waitFooter(/Cảnh gốc: \d+/);
  await p.getByRole("button", { name: "Trích đoạn thử nghiệm" }).click();
  await waitFooter(/Đã trích/);
  await p.getByRole("button", { name: "Chạy phát lại" }).click();
  await p.getByRole("button", { name: "Huỷ tác vụ" }).click({ timeout: 5000 });
  step("cancel", await waitFooter(/Đã huỷ/));
  // recover after cancel
  await p.getByRole("button", { name: "Trích đoạn thử nghiệm" }).click();
  step("afterCancel", await waitFooter(/Đã trích/));
  ok = true;
  await b.close();
  report = { steps, errors, external, failed };
} finally {
  await host.close();
}
const after = metadata();
const summary = { ...report, metadataFiles: Object.keys(before).length, metadataUnchanged: JSON.stringify(before) === JSON.stringify(after), workersLeft: workers(), evidence: out };
fs.writeFileSync(join(out, "local-web-e2e.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
const unexpected = summary.failed.filter(([status, path]) => !(status === 409 && path === "/api/replay"));
if (!ok || summary.steps.length !== 14 || !summary.metadataUnchanged || summary.workersLeft || summary.external.length || unexpected.length) {
  console.error("Local web E2E: FAIL");
  process.exit(1);
}
console.log("Local web E2E (real dataset, esmini, import/export, cancel, dataset integrity): PASS");
