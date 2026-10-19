import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEMO_ONLY, demoKey, installDemoFetch } from "./demoFetch";

const origin = "https://demo.example";
const key = (method: string, path: string, body: string) =>
  createHash("sha256").update(`${method} ${path}\n${body}`).digest("hex");

function host(files: Record<string, unknown>) {
  const calls: string[] = [];
  const h = {
    location: { origin },
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return url in files ? Response.json(files[url]) : new Response("", { status: 404 });
    }) as typeof fetch,
  };
  installDemoFetch(h);
  return { h, calls };
}

describe("recorded demo fetch", () => {
  it("keys requests exactly like the recorder (sha256 of method, path and body)", async () => {
    expect(await demoKey("POST", "/api/listImported", "{}")).toBe(key("POST", "/api/listImported", "{}"));
  });

  it("answers a recorded call with its stored status and body", async () => {
    const body = JSON.stringify({ scene: "carla-town10hd" });
    const { h } = host({ [`demo-api/rpc/${key("POST", "/api/sourceScene", body)}.json`]: { status: 200, body: { value: { id: "s1" } } } });
    const response = await h.fetch(`${origin}/api/sourceScene`, { method: "POST", body });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: { id: "s1" } });
  });

  it("keys GET calls without a body and keeps recorded errors", async () => {
    const { h } = host({ [`demo-api/rpc/${key("GET", "/api/auth/session", "")}.json`]: { status: 401, body: { code: "UNAUTHENTICATED" } } });
    const response = await h.fetch(`${origin}/api/auth/session?x=1`);
    expect(response.status).toBe(401);
  });

  it("returns DEMO_ONLY for an unrecorded call without touching the network", async () => {
    const { h, calls } = host({});
    const response = await h.fetch(`${origin}/api/deleteImported`, { method: "POST", body: "{}" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(DEMO_ONLY);
    expect(calls.every(url => url.startsWith("demo-api/rpc/"))).toBe(true);
  });

  it("treats a host's HTML fallback page as unrecorded", async () => {
    const h = { location: { origin }, fetch: (async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })) as typeof fetch };
    installDemoFetch(h);
    expect((await h.fetch(`${origin}/api/deleteImported`, { method: "POST", body: "{}" })).status).toBe(409);
  });

  it("passes other URLs through", async () => {
    const { h, calls } = host({ "https://cdn.example/a.json": { ok: 1 } });
    expect(await (await h.fetch("https://cdn.example/a.json")).json()).toEqual({ ok: 1 });
    expect(calls).toEqual(["https://cdn.example/a.json"]);
  });
});
