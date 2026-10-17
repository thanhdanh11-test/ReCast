// Real one-scene integration of the isolated unified demo, with a temporary account and workspace.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import { createLocalServer } from "../server/local-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.argv[2] || join(root, "planning/48_2026-10-15_unified-scenario-demo/evidence/guided"));
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(join(os.tmpdir(), "topeye-unified-demo-"));
fs.writeFileSync(join(userData, "scenario-settings.json"), JSON.stringify({ workspace: join(userData, "workspace") }));
const host = createLocalServer({ userData });
const port = await host.listen(0);
const browser = await chromium.launch({ channel: process.env.TOPEYE_BROWSER_CHANNEL || "chrome" });
let page;
const mainweb = process.argv.includes("--mainweb");
const report = { url: `http://127.0.0.1:${port}/${mainweb ? "" : "?unified-demo=1"}`, steps: [], errors: [], created: null, downloaded: null };
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
  await page.getByRole("heading", { name: "Kịch bản", exact:true, level:1 }).waitFor({ timeout:180000 });
  await page.getByRole("button", { name: "Chi tiết", exact:true }).waitFor();
  await page.getByRole("combobox", { name:"Cảnh đang chọn" }).selectOption("scene-0061");
  report.steps.push("one main workspace with shared source scene picker");
  await page.locator('.ud-stage [data-pick-actor="ego"]').waitFor({ timeout: 180000 });
  await page.getByRole("button", { name: /Xe phía trước phanh/ }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".ud-intents button")?.disabled);
  await page.screenshot({ path: join(out, "beginner-01-intents.png") });
  await page.getByRole("button", { name: /Xe phía trước phanh/ }).click();
  await page.getByRole("button", { name: "Dùng xe này" }).click();
  await page.screenshot({ path: join(out, "beginner-03-options.png") });
  const guidedBaseline = page.waitForResponse(r => r.url().endsWith("/api/importReactive") && r.request().postDataJSON()?.event?.react === false, { timeout: 180000 });
  const guidedPilot = page.waitForResponse(r => r.url().endsWith("/api/importReactive") && r.request().postDataJSON()?.event?.react === true, { timeout: 180000 });
  await page.getByRole("button", { name: "Xem xe của tôi phản ứng" }).click();
  const guidedResponses = await Promise.all([guidedBaseline, guidedPilot]);
  for (const response of guidedResponses) assert.equal(response.status(), 200);
  await page.getByRole("button", { name: "Không bật phản ứng", exact: true }).waitFor();
  assert.equal(await page.locator('.ud-stage [data-testid="map-view"]').count(), 2);
  await page.screenshot({ path: join(out, "beginner-04-results.png") });
  report.steps.push("beginner default: intent, ego-followed suggested vehicle, feasible preset, two real reaction packages");
  await page.getByRole("button", { name: "Chi tiết", exact: true }).click();
  await page.getByRole("button",{name:"Thử phản ứng",exact:true}).click();
  await page.locator('.ud-stage [data-pick-actor="ego"]').click();
  await page.getByText("Đã chọn ego để thiết kế").waitFor();
  const available = await page.evaluate(async () => {
    const source = await window.scenarioApp.sourceScene({ scene: "scene-0061" });
    return (await window.scenarioApp.reactiveCandidates({ source_id: source.id })).candidates;
  });
  report.steps.push("real ego click shows template design role");
  await page.screenshot({ path: join(out, "01-choose-ego.png") });

  for (const [kind, label] of [["brake", "Phanh"], ["lane_change", "Chuyển làn"], ["accelerate", "Tăng tốc"], ["stopline", "Dừng ở vạch"]]) {
    const actor = available.find(c => c.kinds?.[kind] && c.followers.includes("ego")) ?? available.find(c => c.kinds?.[kind]); assert.ok(actor);
    if (kind === "brake") await page.locator(`.ud-stage [data-pick-actor="${actor.actor_id}"]`).click();
    else {
      await page.getByRole("button", { name: "Thiết kế tình huống khác" }).click();
      await page.getByRole("combobox", { name: "Xe gây sự kiện" }).selectOption(actor.actor_id);
    }
    await page.getByRole("button", { name: "Tiếp: chọn tình huống" }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Chạy baseline và pilot" }).isEnabled(), true, `${kind} initializes an offered combination`);
    const baselinePromise = page.waitForResponse(r => r.url().endsWith("/api/importReactive") && !r.request().postDataJSON().event.react, { timeout: 180000 });
    const pilotPromise = page.waitForResponse(r => r.url().endsWith("/api/importReactive") && r.request().postDataJSON().event.react, { timeout: 180000 });
    await page.getByRole("button", { name: "Chạy baseline và pilot" }).click();
    const baseline = (await (await baselinePromise).json()).value;
    const pilot = (await (await pilotPromise).json()).value;
    assert.ok(baseline && pilot, `${kind} produces both variants`);
    assert.equal(baseline.report.drivers.react, false); assert.equal(pilot.report.drivers.react, true);
    assert.notEqual(baseline.id, pilot.id);
    await page.getByRole("button", { name: "Đặt cạnh nhau" }).waitFor();
    await page.getByRole("button", { name: "Tiếp: lưu và xuất" }).waitFor();
    const slider = page.getByRole("slider", { name: "Thời gian", exact:true });
    await slider.evaluate(el => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "5"); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.deepEqual(await page.locator('.ud-stage [data-testid="map-view"]').evaluateAll(nodes => nodes.map(n => Number(n.dataset.time))), [5, 5]);
    if (kind === "brake") {
      const a = baseline.actors.find(a => a.role === "ego").samples;
      const b = pilot.actors.find(a => a.role === "ego").samples;
      report.egoTrajectoryDifference = JSON.stringify(a) !== JSON.stringify(b);
      // This selected event may affect another follower; validate actual trajectories and report rather than promise ego reacts.
      report.baseline = baseline.id; report.pilot = pilot.id;
      await page.screenshot({ path: join(out, "04-pair.png") });
      await page.getByRole("button", { name: "Baseline", exact: true }).click();
      assert.equal(await page.locator('.ud-stage [data-testid="map-view"]').count(), 1);
      await page.getByRole("button", { name: "Pilot", exact: true }).click();
      await page.getByRole("button", { name: "Đặt cạnh nhau" }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.locator(".unified-demo").evaluate(el => el.scrollWidth - el.clientWidth);
      assert.ok(overflow <= 1, `mobile overflow ${overflow}`);
      await page.screenshot({ path: join(out, "mobile.png"), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    report.steps.push(`${kind}: two real packages, same event, synchronized maps at 5s`);
  }
  await page.getByRole("button", { name: "Tiếp: lưu và xuất" }).click();
  await page.getByText("Đã tự lưu vào thư viện").waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất baseline .xosc" }).click();
  const download = await downloadPromise; report.downloaded = download.suggestedFilename();
  await download.saveAs(join(out, "baseline.xosc")); assert.match(fs.readFileSync(join(out, "baseline.xosc"), "utf8"), /OpenSCENARIO/);
  report.steps.push("step five exports actual baseline XOSC; ten snapshots auto-saved");
  await page.screenshot({ path: join(out, "05-export.png") });

  await page.getByRole("button", { name: "Tạo tình huống mới" }).click();
  await page.getByRole("button", { name: /Xe của tôi · ego/ }).click();
  await page.getByRole("button", { name: "Tiếp: chọn tình huống" }).click();
  assert.equal(await page.getByRole("button", { name: /^Chọn loại / }).count(), 20);
  await page.screenshot({ path: join(out, "02-templates.png") });
  await page.getByRole("button", { name: "Chọn loại Tự do / tuỳ chỉnh" }).click();
  for (const [name, val] of [["Vận tốc ego", "10"], ["Thời lượng", "6"]]) {
    const s = page.getByRole("slider", { name });
    await s.evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, val);
  }
  await page.screenshot({ path: join(out, "03-template-params.png") });
  const templatePromise = page.waitForResponse(r => r.url().endsWith("/api/importTemplate"), { timeout: 180000 });
  await page.getByRole("button", { name: "Tạo kịch bản trên map" }).click();
  const templateResponse = await templatePromise;
  assert.equal(templateResponse.ok(), true, JSON.stringify(await templateResponse.json()));
  await page.getByRole("button", { name: "Tiếp: lưu và xuất" }).waitFor();
  assert.equal(await page.getByLabel("Baseline và pilot", { exact: true }).count(), 0);
  report.steps.push("ego -> 20 templates -> customize 10km/h, 6s -> real compiler -> map playback");

  const map = await page.evaluate(async () => {
    const source = await window.scenarioApp.sourceScene({ scene: "scene-0061" });
    return window.scenarioApp.mapContext({ source_id: source.id });
  });
  const mapFile = join(out, "map-context.json"), xoscFile = join(out, "ordinary-fixture.xosc"); fs.writeFileSync(mapFile, JSON.stringify(map));
  const generated = spawnSync(join(root, "backend/.venv/bin/python"), [join(root, "backend/scripts/generate_map_scenario_fixture.py"), mapFile, xoscFile], { cwd: join(root, "backend"), env: { ...process.env, PYTHONPATH: join(root, "backend") } });
  assert.equal(generated.status, 0, String(generated.stderr));
  const chooserPromise = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "Nạp tệp .xosc" }).click();
  const importPromise = page.waitForResponse(r => r.url().endsWith("/api/importXosc"), { timeout: 180000 });
  await (await chooserPromise).setFiles(xoscFile); assert.equal((await importPromise).ok(), true);
  await page.getByRole("button", { name: "Tiếp: lưu và xuất" }).waitFor();
  await page.getByRole("tab", {name:"Thư viện",exact:true}).click();
  await page.locator(".runner-item-main").nth(11).waitFor();
  assert.equal(await page.locator(".runner-item-main").count(),12);
  const groups=await page.evaluate(()=>window.scenarioApp.scenarioGroups({scene:"scene-0061"}));
  assert.equal(groups.length,5);
  const group=groups[0];
  await page.reload();
  await page.getByRole("button", {name:"Mở nuScenes mini",exact:true}).click();
  await page.getByRole("combobox", {name:"Cảnh đang chọn"}).selectOption("scene-0061");
  await page.locator(".runner-item-main").nth(11).waitFor({timeout:180000});
  const reopenedIndex=await page.evaluate(async id=>{const rows=await window.scenarioApp.listImported();return rows.filter(r=>r.scene==="scene-0061").findIndex(r=>r.scenario_id===id);},group.pilot_id);
  assert.ok(reopenedIndex>=0);await page.locator(".runner-item-main").nth(reopenedIndex).click();
  await page.getByRole("button", {name:"Đặt cạnh nhau",exact:true}).waitFor();
  assert.equal(await page.locator('.ud-stage [data-testid="map-view"]').count(),2);
  report.steps.push("twelve packages, five durable groups; baseline/pilot reopened together after full page reload");
  await page.getByRole("button", {name:"Cảnh nguồn",exact:true}).click();
  await page.getByRole("button", {name:"Kịch bản",exact:true}).click();
  assert.equal(await page.locator('.ud-stage [data-testid="map-view"]').count(),2);
  await page.screenshot({path:join(out,"durable-pair.png")});
  await page.getByRole("button",{name:"Tạo kịch bản",exact:true}).click();
  const packageDialog=page.getByRole("dialog",{name:"Tạo kịch bản",exact:true});
  const folderChooser=page.waitForEvent("filechooser");await packageDialog.getByRole("button",{name:"Nạp gói real2sim",exact:true}).click();
  const packageResponse=page.waitForResponse(r=>r.url().endsWith("/api/importPackage"),{timeout:180000});
  await (await folderChooser).setFiles(join(userData,"workspace",group.baseline_id,"import"));
  assert.equal((await packageResponse).status(),200);await packageDialog.waitFor({state:"hidden"});
  assert.equal(await page.locator(".runner-item-main").count(),13);
  assert.equal(await page.locator('.ud-stage [data-testid="map-view"]').count(),1);
  report.steps.push("real2sim directory imports through distinct parser as standalone thirteenth package");
  assert.equal(report.errors.length, 0, report.errors.join("\n")); report.pass = true;
} catch (error) {
  report.failure = String(error); if (page) await page.screenshot({ path: join(out, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(join(out, "result.json"), JSON.stringify(report, null, 2));
  await browser.close(); await host.close(); fs.rmSync(userData, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
