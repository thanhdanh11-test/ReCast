// plan50 Scenario Studio, real one-scene authoring with a temporary account and workspace: “Tự tạo” for the four
// reaction kinds, “Kịch bản có sẵn” template + .xosc + real2sim folder, durable baseline/pilot groups after a reload,
// baseline (dashed) and pilot on one 2D map, and the analysis sections of a reaction.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import { createLocalServer } from "../server/local-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.argv[2] || join(root, "planning/50_2026-10-17_scenario-studio/evidence/browser"));
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(join(os.tmpdir(), "topeye-unified-demo-"));
fs.writeFileSync(join(userData, "scenario-settings.json"), JSON.stringify({ workspace: join(userData, "workspace") }));
const host = createLocalServer({ userData });
const port = await host.listen(0);
const browser = await chromium.launch({ channel: process.env.TOPEYE_BROWSER_CHANNEL || "chrome" });
let page;
const report = { url: `http://127.0.0.1:${port}/`, steps: [], errors: [], pairs: [] };
const studio = () => page.getByTestId("scenario-studio");
const rows = () => page.locator(".studio-history-list li");
async function openCreate(kind) {
  await page.waitForFunction(() => document.querySelector(".studio-create .create-scenario")?.disabled === false, null, { timeout: 180000 });
  await studio().getByRole("button", { name: "Tạo kịch bản" }).click();
  await studio().getByRole("menuitem", { name: kind }).click();
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page = await context.newPage();
  page.on("pageerror", error => report.errors.push(String(error)));
  page.on("console", item => { if (item.type() === "error" && !(item.location().url.endsWith("/api/mapContext") && item.text().includes("400 (Bad Request)"))) report.errors.push(item.text()); });
  await page.goto(report.url);
  await page.getByLabel("Tên đăng nhập", { exact: true }).fill("demo-owner");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("unified-demo-test-38492");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await page.getByRole("button", { name: "Mở nuScenes mini", exact: true }).click();
  await studio().waitFor({ timeout: 180000 });
  await studio().getByRole("button", { name: /^scene-0061/ }).click();
  await page.waitForFunction(() => document.querySelector('.studio-scenes [aria-current="true"] strong')?.textContent === "scene-0061", null, { timeout: 180000 });
  await page.screenshot({ path: join(out, "01-studio.png") });
  await openCreate(/Tự tạo/);
  await page.screenshot({ path: join(out, "02-custom-guided.png") });
  await page.getByRole("button", { name: "Quay lại Studio" }).click();
  report.steps.push("three-column Studio; “Tự tạo” opens the guided reaction flow and returns");

  const available = await page.evaluate(async () => {
    const source = await window.scenarioApp.sourceScene({ scene: "scene-0061" });
    return (await window.scenarioApp.reactiveCandidates({ source_id: source.id })).candidates;
  });
  for (const [kind, label] of [["brake", "Phanh"], ["lane_change", "Chuyển làn"], ["accelerate", "Tăng tốc"], ["stopline", "Dừng ở vạch"]]) {
    const actor = available.find(c => c.kinds?.[kind] && c.followers.includes("ego")) ?? available.find(c => c.kinds?.[kind]); assert.ok(actor, `${kind} has a vehicle`);
    await openCreate(/Tự tạo/);
    await page.getByRole("button", { name: "Chi tiết", exact: true }).click();
    await page.getByRole("combobox", { name: "Xe gây sự kiện" }).selectOption(actor.actor_id);
    await page.getByRole("button", { name: "Tiếp: chọn tình huống" }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent?.includes("Chạy baseline và pilot") && !b.disabled), null, { timeout: 60000 })
      .catch(() => { throw new Error(`${kind} initializes an offered combination`); });
    const baselinePromise = page.waitForResponse(r => r.url().endsWith("/api/importReactive") && !r.request().postDataJSON().event.react, { timeout: 180000 });
    const pilotPromise = page.waitForResponse(r => r.url().endsWith("/api/importReactive") && r.request().postDataJSON().event.react, { timeout: 180000 });
    await page.getByRole("button", { name: "Chạy baseline và pilot" }).click();
    const baseline = (await (await baselinePromise).json()).value, pilot = (await (await pilotPromise).json()).value;
    assert.ok(baseline && pilot, `${kind} produces both variants`);
    assert.equal(baseline.report.drivers.react, false); assert.equal(pilot.report.drivers.react, true); assert.notEqual(baseline.id, pilot.id);
    await page.getByText("Đã lưu baseline và pilot vào lịch sử.").waitFor({ timeout: 120000 });
    await page.locator(".studio-history-list li.active").waitFor({ timeout: 120000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-overlay-actor]").length > 0, null, { timeout: 60000 });
    const slider = studio().getByRole("slider", { name: "Thời gian", exact: true });
    await slider.fill("5");
    assert.equal(await studio().getByTestId("map-view").getAttribute("data-time"), "5");
    const timeline = await page.locator(".studio-timeline").evaluate(el => ({ rows: el.querySelectorAll(".studio-timeline-row").length, baseline: el.querySelectorAll(".studio-span-baseline").length, marks: [...el.querySelectorAll(".studio-mark em")].map(e => e.textContent) }));
    assert.ok(timeline.rows > 1 && timeline.marks.includes("Tình huống"), JSON.stringify(timeline));
    report.pairs.push({ kind, baseline: baseline.id, pilot: pilot.id, timeline });
    if (kind === "brake") await page.screenshot({ path: join(out, "03-pair-2d.png") });
    report.steps.push(`${kind}: two real packages, one history row, baseline dashed + pilot on one map at 5 s`);
  }
  await page.waitForFunction(() => document.querySelectorAll(".studio-history-list li").length === 4, null, { timeout: 30000 });

  await openCreate(/Kịch bản có sẵn/);
  const dialog = page.getByRole("dialog", { name: "Tạo kịch bản", exact: true });
  assert.equal(await dialog.getByRole("button", { name: /^Chọn loại / }).count(), 20);
  await dialog.getByRole("button", { name: "Chọn loại Tự do / tuỳ chỉnh" }).click();
  for (const [name, val] of [["Vận tốc ego", "10"], ["Thời lượng", "6"]]) {
    const s = dialog.getByRole("slider", { name });
    if (await s.count()) await s.evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, val);
  }
  const templatePromise = page.waitForResponse(r => r.url().endsWith("/api/importTemplate"), { timeout: 180000 });
  await dialog.getByRole("button", { name: "Tạo từ template" }).click();
  const templateResponse = await templatePromise;
  assert.equal(templateResponse.ok(), true, JSON.stringify(await templateResponse.json()));
  await dialog.waitFor({ state: "hidden" });
  report.steps.push("Kịch bản có sẵn → 20 templates → real compiler → opened in the Studio");

  const map = await page.evaluate(async () => {
    const source = await window.scenarioApp.sourceScene({ scene: "scene-0061" });
    return window.scenarioApp.mapContext({ source_id: source.id });
  });
  const mapFile = join(out, "map-context.json"), xoscFile = join(out, "ordinary-fixture.xosc"); fs.writeFileSync(mapFile, JSON.stringify(map));
  const generated = spawnSync(join(root, "backend/.venv/bin/python"), [join(root, "backend/scripts/generate_map_scenario_fixture.py"), mapFile, xoscFile], { cwd: join(root, "backend"), env: { ...process.env, PYTHONPATH: join(root, "backend") } });
  assert.equal(generated.status, 0, String(generated.stderr));
  await openCreate(/Kịch bản có sẵn/);
  const chooserPromise = page.waitForEvent("filechooser"); await dialog.getByRole("button", { name: "Chọn file .xosc" }).click();
  const importPromise = page.waitForResponse(r => r.url().endsWith("/api/importXosc"), { timeout: 180000 });
  await (await chooserPromise).setFiles(xoscFile); assert.equal((await importPromise).ok(), true);
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelectorAll(".studio-history-list li").length === 6, null, { timeout: 60000 });
  const groups = await page.evaluate(() => window.scenarioApp.scenarioGroups({ scene: "scene-0061" }));
  assert.equal(groups.length, 4);
  report.steps.push("ten packages, four durable groups ⇒ six history rows (template, .xosc, four reactions)");

  await page.reload();
  await page.getByRole("button", { name: "Mở nuScenes mini", exact: true }).click();
  await studio().getByRole("button", { name: /^scene-0061/ }).click();
  await page.waitForFunction(() => document.querySelectorAll(".studio-history-list li").length === 6, null, { timeout: 180000 });
  const pilotName = await page.evaluate(async id => (await window.scenarioApp.listImported()).find(r => r.scenario_id === id)?.name, groups[0].pilot_id);
  await rows().filter({ has: page.locator(`strong[title="${pilotName}"]`) }).first().locator(".studio-history-main").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-overlay-actor]").length > 0, null, { timeout: 120000 });
  await page.getByRole("button", { name: "Cảnh nguồn", exact: true }).click();
  await page.getByRole("button", { name: "Kịch bản", exact: true }).click();
  assert.ok(await page.locator("[data-overlay-actor]").count() > 0);
  report.steps.push("baseline/pilot reopened together after a full page reload and a view round trip");

  await rows().filter({ has: page.locator(`strong[title="${pilotName}"]`) }).first().getByRole("button", { name: /^Phân tích / }).click();
  const tabs = await page.getByRole("tablist", { name: "Mục phân tích" }).getByRole("tab").allTextContents();
  assert.deepEqual(tabs, ["Tổng quan", "Khoảng cách & tốc độ", "Baseline vs Pilot", "Phanh / gia tốc từng xe", "Báo cáo đầy đủ", "esmini"]);
  for (const tab of tabs.slice(0, 4)) { await page.getByRole("tab", { name: tab, exact: true }).click(); await page.screenshot({ path: join(out, `04-analysis-${tabs.indexOf(tab)}.png`) }); }
  await page.getByRole("button", { name: "Quay lại Studio" }).click();
  report.steps.push(`analysis of a reaction offers ${tabs.join(" · ")}`);

  await openCreate(/Kịch bản có sẵn/);
  const folderChooser = page.waitForEvent("filechooser"); await dialog.getByRole("button", { name: "Nạp gói real2sim", exact: true }).click();
  const packageResponse = page.waitForResponse(r => r.url().endsWith("/api/importPackage"), { timeout: 180000 });
  await (await folderChooser).setFiles(join(userData, "workspace", groups[0].baseline_id, "import"));
  assert.equal((await packageResponse).status(), 200); await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelectorAll(".studio-history-list li").length === 7, null, { timeout: 60000 });
  assert.equal(await page.locator(".studio-history-list li.active .studio-kind-real2sim").count(), 1);
  assert.equal(await page.locator(".studio-history-list li.active").getByRole("button", { name: /^Sửa / }).isDisabled(), true);
  report.steps.push("real2sim directory imports through its own parser as a seventh, view-only row");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(out, "05-mobile.png"), fullPage: true });
  assert.equal(report.errors.length, 0, report.errors.join("\n")); report.pass = true;
} catch (error) {
  report.failure = String(error); if (page) await page.screenshot({ path: join(out, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(join(out, "result.json"), JSON.stringify(report, null, 2));
  await browser.close(); await host.close(); fs.rmSync(userData, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
