// plan56: a CARLA town recorded as a nuScenes-format dataset opens as a scene in the app, takes a “Tự tạo”
// reaction pair, and exports a CARLA package that references the town itself.
// Usage: node scripts/test-carla-town.mjs [evidence-dir]   (needs the "CARLA Town10HD" catalog seed)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createLocalServer } from "../server/local-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.argv[2] || join(root, "planning/56_2026-10-18_carla-town-scene/evidence/browser"));
fs.mkdirSync(out, { recursive: true });
const SCENE = "carla-town10hd";
const userData = fs.mkdtempSync(join(os.tmpdir(), "topeye-carla-town-"));
const workspace = join(userData, "workspace");
fs.writeFileSync(join(userData, "scenario-settings.json"), JSON.stringify({ workspace }));
const host = createLocalServer({ userData });
const port = await host.listen(0);
const browser = await chromium.launch({ channel: process.env.TOPEYE_BROWSER_CHANNEL || "chrome" });
const report = { steps: [], errors: [] };
let page;
const studio = () => page.getByTestId("scenario-studio");
const step = (s) => { report.steps.push(s); console.error("✓", s); };
try {
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => report.errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByLabel("Tên đăng nhập", { exact: true }).fill("carla-owner");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("carla-town-test-58213");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  let t = Date.now();
  await page.getByRole("button", { name: "Mở CARLA Town10HD", exact: true }).click({ timeout: 180000 });
  await studio().waitFor({ timeout: 180000 });
  await page.waitForFunction((s) => document.querySelector('.studio-scenes [aria-current="true"] strong')?.textContent === s, SCENE, { timeout: 180000 });
  await page.waitForFunction(() => document.querySelector(".studio-stage svg") && !document.querySelector("[data-testid=busy-indicator]"), null, { timeout: 180000 });
  step(`dataset → ${SCENE} on the 2D map in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  await page.screenshot({ path: join(out, "01-town-2d.png") });
  await studio().getByRole("button", { name: "3D", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".studio-3d canvas") && !document.querySelector("[data-testid=busy-indicator]"), null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, "02-town-3d.png") });
  await studio().getByRole("button", { name: "2D", exact: true }).click();
  step("3D view of the town (structures estimated from the CARLA LiDAR)");

  const candidates = await page.evaluate(async (scene) => {
    const source = await window.scenarioApp.sourceScene({ scene });
    return (await window.scenarioApp.reactiveCandidates({ source_id: source.id })).candidates;
  }, SCENE);
  const actor = candidates.find((c) => c.kinds?.brake && c.followers.includes("ego")) ?? candidates.find((c) => c.kinds?.brake);
  assert.ok(actor, `a vehicle can brake (${candidates.length} candidates)`);
  step(`${candidates.length} reaction candidates; brake on ${actor.actor_id}`);
  await page.waitForFunction(() => document.querySelector(".studio-create .create-scenario")?.disabled === false, null, { timeout: 180000 });
  await studio().getByRole("button", { name: "Tạo kịch bản" }).click();
  await studio().getByRole("menuitem", { name: /Tự tạo/ }).click();
  await page.getByRole("button", { name: "Chi tiết", exact: true }).click();
  await page.getByRole("combobox", { name: "Xe gây sự kiện" }).selectOption(actor.actor_id);
  await page.getByRole("button", { name: "Tiếp: chọn tình huống" }).click();
  await page.getByRole("button", { name: "Phanh", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Chạy baseline và pilot") && !b.disabled), null, { timeout: 90000 });
  const pilotPromise = page.waitForResponse((r) => r.url().endsWith("/api/importReactive") && r.request().postDataJSON().event.react, { timeout: 180000 });
  await page.getByRole("button", { name: "Chạy baseline và pilot" }).click();
  const pilot = (await (await pilotPromise).json()).value;
  await page.getByText("Đã lưu baseline và pilot vào lịch sử.").waitFor({ timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-overlay-actor]").length > 0, null, { timeout: 60000 });
  await page.screenshot({ path: join(out, "03-town-pair.png") });
  step(`“Tự tạo” brake pair: valid=${pilot.report?.valid} · ${pilot.report?.topeye?.summary ?? ""}`);

  const job = await page.evaluate((id) => window.scenarioApp.exportScenario({ scenario_id: id, format: "carla" }), pilot.id);
  let done;
  for (let i = 0; i < 120 && !done; i++) {
    await page.waitForTimeout(1000);
    const row = (await page.evaluate(() => window.scenarioApp.listExports())).find((j) => j.id === job.id);
    if (row && ["done", "failed"].includes(row.status)) done = row;
  }
  assert.equal(done?.status, "done", JSON.stringify(done?.error));
  const names = done.files.map((f) => f.name).sort();
  assert.ok(!names.some((n) => n.endsWith(".xodr")), "a town package has no generated .xodr");
  const files = join(workspace, "exports", job.id, "files");
  const manifest = JSON.parse(fs.readFileSync(join(files, "manifest.json"), "utf8"));
  assert.equal(manifest.carla_town.town, "Town10HD_Opt");
  const xosc = fs.readFileSync(join(files, names.find((n) => n.endsWith(".xosc"))), "utf8");
  assert.ok(xosc.includes('LogicFile filepath="Town10HD_Opt"'));
  const zip = fs.readdirSync(join(workspace, "exports", job.id)).find((n) => n.endsWith(".zip"));
  fs.copyFileSync(join(workspace, "exports", job.id, zip), join(out, zip));
  report.zip = join(out, zip);
  step(`CARLA export: ${names.join(", ")} → LogicFile Town10HD_Opt, origin ${manifest.carla_town.origin.map((v) => v.toFixed(1)).join(", ")}`);
  assert.deepEqual(report.errors, []);
  report.pass = true;
} catch (error) {
  report.failure = String(error);
  if (page) await page.screenshot({ path: join(out, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  await host.close?.();
  fs.writeFileSync(join(out, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}
