// Full local login/catalog integration with isolated account, settings and workspace.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createLocalServer } from "../server/local-server.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.argv[2] || join(root,"planning/34_2026-10-13_dataset-intake/evidence/access"));
fs.mkdirSync(out, { recursive:true });
const userData = fs.mkdtempSync(join(os.tmpdir(),"topeye-access-e2e-"));
fs.writeFileSync(join(userData,"scenario-settings.json"),JSON.stringify({workspace:join(userData,"workspace")}));
const host = createLocalServer({userData});
const port = await host.listen(0);
const url = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({channel:process.env.TOPEYE_BROWSER_CHANNEL || "chrome"});
const report = {steps:[], errors:[], sizes:[]};
try {
 const context = await browser.newContext({viewport:{width:1360,height:900}});
 const page = await context.newPage();
 page.on("pageerror",e=>report.errors.push(String(e)));
 page.on("console",m=>{if(m.type()==="error" && !(m.location().url.endsWith("/api/catalog/add") && m.text().includes("400")))report.errors.push(m.text());});
 await page.goto(url);
 await page.getByRole("button",{name:"Tạo tài khoản",exact:true}).waitFor();
 await page.screenshot({path:join(out,"account-setup.png")});
 await page.getByLabel("Tên đăng nhập",{exact:true}).fill("e2e-owner");
 await page.getByLabel("Mật khẩu",{exact:true}).fill("e2e-only-password-38492");
 await page.getByRole("button",{name:"Tạo tài khoản",exact:true}).click();
 await page.getByRole("button",{name:"Mở nuScenes mini",exact:true}).waitFor({timeout:120000});
 report.steps.push("setup and authenticated catalog");
 for(const viewport of [{width:1360,height:900},{width:1050,height:720},{width:390,height:844}]) {
  await page.setViewportSize(viewport);
  // Tiles have fixed CSS sizes; wait for the catalog to settle instead of measuring mid-render.
  await page.waitForFunction(()=>{const r=[...document.querySelectorAll(".dataset-tile")].map(e=>e.getBoundingClientRect());return r.length>=3&&r.every(s=>Math.abs(s.width-r[0].width)<1&&s.height===r[0].height);},null,{timeout:10000}).catch(()=>{});
  const sizes = await page.locator(".dataset-tile").evaluateAll(els=>els.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
  assert.ok(sizes.length>=3);
  assert.ok(sizes.every(s=>Math.abs(s.width-sizes[0].width)<1 && s.height===sizes[0].height));
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false);
  report.sizes.push({viewport,tiles:sizes});
  await page.screenshot({path:join(out,`catalog-${viewport.width}.png`),fullPage:true});
 }
 await page.setViewportSize({width:1360,height:900});
 const plus=page.locator(".dataset-add");
 await plus.click();
 const dialog=page.getByRole("dialog",{name:"Thêm dữ liệu của bạn"});
 await dialog.getByLabel("Đường dẫn thư mục").fill(join(userData,"missing"));
 await dialog.getByRole("button",{name:"Thêm vào thư viện"}).click();
 await dialog.getByRole("alert").waitFor();
 report.steps.push("invalid dataset rejected");
 await dialog.getByRole("button",{name:"Đóng nhập dữ liệu"}).click();
 for (const name of ["nuScenes mini","Argoverse 2 Sensor"]) {
  await page.getByRole("button",{name:`Mở ${name}`,exact:true}).click();
  await page.locator('[data-testid="lidar-view"][data-mode="measured"]').waitFor({timeout:180000});
  await page.waitForFunction(()=>Number(document.querySelector('[data-testid="lidar-view"]')?.getAttribute("data-points"))>0,null,{timeout:180000});
  await page.waitForFunction(()=>!document.querySelector('[data-testid="busy-indicator"]'),null,{timeout:180000});
  const points=Number(await page.getByTestId("lidar-view").getAttribute("data-points"));
  assert.ok(points>20000);
  await page.screenshot({path:join(out,name.startsWith("nu")?"studio-nuscenes.png":"studio-av2.png")});
  report.steps.push({dataset:name,points});
  await page.getByRole("button",{name:"Thư viện map",exact:true}).click();
  await page.getByRole("button",{name:`Mở ${name}`,exact:true}).waitFor();
 }
 await page.getByRole("button",{name:"Đăng xuất",exact:true}).click();
 await page.getByRole("button",{name:"Đăng nhập",exact:true}).waitFor();
 const token=await page.locator('meta[name="topeye-token"]').getAttribute("content");
 const denied=await context.request.post(url+"/api/settings",{headers:{"X-Topeye-Token":token},data:{}});
 assert.equal(denied.status(),401);
 await page.screenshot({path:join(out,"login.png")});
 await page.getByLabel("Tên đăng nhập",{exact:true}).fill("e2e-owner");
 await page.getByLabel("Mật khẩu",{exact:true}).fill("e2e-only-password-38492");
 await page.getByRole("button",{name:"Đăng nhập",exact:true}).click();
 await page.getByRole("button",{name:"Mở nuScenes mini",exact:true}).waitFor();
 await page.reload();
 await page.getByRole("button",{name:"Mở nuScenes mini",exact:true}).waitFor();
 report.steps.push("logout denies API; login and reload preserve session");
 assert.equal(report.errors.length,0,report.errors.join("\n"));
 report.pass=true;
} finally {
 fs.writeFileSync(join(out,"access-e2e.json"),JSON.stringify(report,null,2));
 await browser.close(); await host.close();
 fs.rmSync(userData,{recursive:true,force:true});
}
console.log(JSON.stringify(report,null,2));
