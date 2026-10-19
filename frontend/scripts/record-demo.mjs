// Records the recorded web demo (vite mode "demo"): drives the full app on a throwaway local server over a COPY of a
// workspace and stores every /api response under public-demo/demo-api/ (rpc/<sha256>.json, preview images, CARLA videos).
// Usage: node scripts/record-demo.mjs <workspace> [dataset name, default "CARLA Town10HD"]
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createLocalServer } from "../server/local-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [source, dataset = "CARLA Town10HD"] = process.argv.slice(2);
if (!source) throw new Error("usage: node scripts/record-demo.mjs <workspace> [dataset name]");
const out = resolve(here, "../public-demo/demo-api");
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(join(out, "..", "api"), { recursive: true, force: true });
fs.mkdirSync(join(out, "rpc"), { recursive: true });

const userData = fs.mkdtempSync(join(os.tmpdir(), "recast-demo-"));
const workspace = join(userData, "workspace");
fs.cpSync(resolve(source), workspace, { recursive: true });
fs.writeFileSync(join(userData, "scenario-settings.json"), JSON.stringify({ workspace }));
const host = createLocalServer({ userData });
const port = await host.listen(0);

// sourceScene mints a fresh id per call: keep the first answer and rewrite later ids to it, so every
// recorded request that names a source matches what the demo replays.
const aliases = new Map();
const unalias = (text) => { for (const [late, first] of aliases) text = text.replaceAll(late, first); return text; };
const firstSource = new Map();
let stored = 0;

const browser = await chromium.launch({ channel: process.env.TOPEYE_BROWSER_CHANNEL || "chrome" });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.route("**/api/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname === "/api/events" || request.resourceType() === "media") return route.continue();
  const response = await route.fetch();
  const bytes = await response.body();
  if (request.resourceType() === "image") {
    fs.mkdirSync(dirname(join(out, "..", url.pathname)), { recursive: true });
    fs.writeFileSync(join(out, "..", url.pathname), bytes);
  } else {
    const body = unalias(request.postData() ?? "");
    let text = bytes.toString("utf8");
    if (url.pathname === "/api/sourceScene" && response.ok()) {
      const id = JSON.parse(text).value.id;
      if (firstSource.has(body)) { aliases.set(id, firstSource.get(body)); text = null; }
      else firstSource.set(body, id);
    }
    if (text !== null) {
      const key = createHash("sha256").update(`${request.method()} ${url.pathname}\n${body}`).digest("hex");
      fs.writeFileSync(join(out, "rpc", `${key}.json`), JSON.stringify({ status: response.status(), body: JSON.parse(unalias(text)) }));
      stored++;
    }
  }
  return route.fulfill({ response, body: bytes });
});

const idle = () => page.waitForFunction(() => !document.querySelector("[data-testid=busy-indicator]"), null, { timeout: 180000 });
const step = (s) => console.error("✓", s);
try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByLabel("Tên đăng nhập", { exact: true }).fill("demo-owner");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("recorded-demo-58213");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await page.getByRole("button", { name: `Mở ${dataset}`, exact: true }).waitFor({ timeout: 60000 });
  await page.reload(); // the demo opens on this signed-in session answer, not the pre-account one
  await page.getByRole("button", { name: `Mở ${dataset}`, exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500); // dataset previews
  await page.getByRole("button", { name: `Mở ${dataset}`, exact: true }).click();
  const studio = page.getByTestId("scenario-studio");
  await studio.waitFor({ timeout: 180000 });
  await page.waitForFunction(() => document.querySelector(".studio-stage svg"), null, { timeout: 180000 });
  await idle();
  await studio.getByRole("button", { name: "3D", exact: true }).click();
  await page.waitForTimeout(3000);
  step(`opened ${dataset}`);

  const rows = page.locator(".studio-history-list li");
  await rows.first().waitFor({ timeout: 120000 });
  const names = (await page.locator(".studio-history-list li strong").allTextContents()).map((s) => s.trim());
  for (const [i, name] of names.entries()) {
    await rows.nth(i).locator("strong").click();
    await idle();
    await page.waitForTimeout(2500);
    const analyse = page.getByRole("button", { name: `Phân tích ${name}`, exact: true });
    if (await analyse.count()) {
      await analyse.first().click();
      await page.waitForFunction(() => !document.body.innerText.includes("Đang tính chỉ số"), null, { timeout: 300000 });
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: /^Quay lại/i }).first().click();
      await idle();
    }
    step(`scenario ${name}`);
  }

  await page.getByRole("button", { name: "Đã xuất", exact: true }).click();
  await page.locator(".studio-exports-table tbody tr").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  step(`exports: ${await page.locator(".studio-exports-table tbody tr").count()} rows`);
} finally {
  await browser.close();
  await host.close?.();
}

// Videos are <video src> (byte ranges), so they are copied as files instead of recorded.
let videos = 0;
for (const id of fs.readdirSync(join(workspace, "exports"))) {
  for (const name of fs.readdirSync(join(workspace, "exports", id)).filter((n) => /^carla-(chase|driver)\.mp4$/.test(n))) {
    fs.mkdirSync(join(out, "..", "api", "exports", id), { recursive: true });
    fs.copyFileSync(join(workspace, "exports", id, name), join(out, "..", "api", "exports", id, name));
    videos++;
  }
}
console.error(`recorded ${stored} responses, ${videos} videos → ${out}`);
process.exit(0);
