import { describe, expect, it, vi } from "vitest";
import { createStaticApi, type WebManifest } from "./staticApi";
import { variantKey } from "./demoKeys";

const args = { scene: "scene-0103", actor_tokens: ["ec0e6425eae2442698ff7b43d405d279"], start_s: 8, end_s: 13 };
const variant = { scenario_id: "scenario-1", target_actor: "vehicle_1", speed_factor: 0.8, gap_offset_m: 2 };
async function fixture() {
  const manifest: WebManifest = {
    schema: "topeye-web-demo-v1", app_version: "0.12.4", generated_at: "2026-10-12T00:00:00+07:00",
    dataset: { name: "nuScenes", version: "v1.0-mini", license: "CC BY-NC-SA 4.0" },
    engine: { name: "esmini", version: "3.9.0" },
    extracts: [{ ...args, key: "9d2fcd08469d0aea", scenario_id: "scenario-1" }],
    variants: [{ ...variant, key: await variantKey("scenario-1", "vehicle_1", 0.8, 2), result_id: "variant-1" }],
    replays: ["scenario-1"], skipped: [], files: {},
  };
  const scenario = { id: "scenario-1", actors: [], interval_s: [8, 13], source: { scene: args.scene } };
  const replay = { observed: [], report: { status: "pass" } };
  const files: Record<string, unknown> = {
    "/demo/data/manifest.json": manifest,
    "/demo/data/scenes.json": [{ scene: args.scene, tracks: [] }],
    [`/demo/data/source/${args.scene}.json`]: scenario,
    "/demo/data/extract/9d2fcd08469d0aea.json": scenario,
    [`/demo/data/variant/${manifest.variants[0].key}.json`]: { ...scenario, id: "variant-1" },
    "/demo/data/replay/scenario-1.json": replay,
  };
  const fetcher = vi.fn<typeof fetch>(async input => new Response(JSON.stringify(files[String(input)]), { status: String(input) in files ? 200 : 404 }));
  return { api: createStaticApi("/demo/data/", fetcher), manifest, scenario, replay, fetcher, files };
}

describe("static demo DesktopAPI", () => {
  it("loads settings and caches manifest for listed combinations", async () => {
    const { api, fetcher, manifest } = await fixture();
    expect(api.demoVariants("scenario-1")).toEqual([]);
    expect(await api.settings()).toEqual({ dataset: "nuScenes v1.0-mini (demo)", datasetVersion: "v1.0-mini", workspace: "", engineAvailable: false, version: "0.12.4", mode: "web-demo" });
    expect(api.demoVariants("scenario-1")).toEqual(manifest.variants);
    const copy = api.demoVariants("scenario-1"); copy[0].speed_factor = 99;
    expect(api.demoVariants("scenario-1")[0].speed_factor).toBe(0.8);
    expect(api.demoVariants("unknown")).toEqual([]);
    await api.settings();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("serves scenes, source, extract, variant and replay from their exact paths", async () => {
    const { api, scenario, replay, files, fetcher } = await fixture();
    expect(await api.listScenes()).toEqual(files["/demo/data/scenes.json"]);
    expect(await api.sourceScene({ scene: args.scene })).toEqual(scenario);
    expect(await api.extract(args)).toEqual(scenario);
    expect(await api.variant(variant)).toEqual({ ...scenario, id: "variant-1" });
    expect(await api.replay({ scenario_id: "scenario-1" })).toEqual(replay);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      "/demo/data/scenes.json", `/demo/data/source/${args.scene}.json`, "/demo/data/manifest.json",
      "/demo/data/extract/9d2fcd08469d0aea.json", expect.stringMatching(/^\/demo\/data\/variant\/[a-f0-9]{16}\.json$/), "/demo/data/replay/scenario-1.json",
    ]);
  });
  it.each(["chooseDataset", "chooseWorkspace", "mapContext", "export", "exportMapContext", "importXosc", "openImported", "replayImported"] as const)("rejects desktop-only %s without fetching", async method => {
    const { api, fetcher } = await fixture();
    await expect(api[method]({ scenario_id: "s", source_id: "s" })).rejects.toMatchObject({ code: "WEB_DEMO_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects unlisted extract, variant and replay without requesting their files", async () => {
    const { api, fetcher } = await fixture();
    await expect(api.extract({ ...args, end_s: 999 })).rejects.toMatchObject({ code: "WEB_DEMO_UNAVAILABLE" });
    await expect(api.variant({ ...variant, speed_factor: 99 })).rejects.toMatchObject({ code: "WEB_DEMO_UNAVAILABLE" });
    await expect(api.replay({ scenario_id: "absent" })).rejects.toMatchObject({ code: "WEB_DEMO_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports a missing filename", async () => {
    const { api } = await fixture();
    await expect(api.sourceScene({ scene: "missing" })).rejects.toMatchObject({ code: "WEB_DATA_MISSING", message: expect.stringContaining("source/missing.json") });
  });
  it("maps invalid JSON to corrupt data", async () => {
    const api = createStaticApi("/data", vi.fn<typeof fetch>(async () => new Response("{broken")));
    await expect(api.listScenes()).rejects.toMatchObject({ code: "WEB_DATA_CORRUPT" });
  });
  it.each([null, { schema: "wrong" }, { schema: "topeye-web-demo-v1", app_version: "1" }])("rejects invalid manifest %j", async data => {
    const api = createStaticApi("/data", vi.fn<typeof fetch>(async () => new Response(JSON.stringify(data))));
    await expect(api.settings()).rejects.toMatchObject({ code: "WEB_DATA_CORRUPT" });
  });
  it("maps offline and HTTP errors to retryable NETWORK errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("[]"));
    const api = createStaticApi("/data", fetcher);
    await expect(api.listScenes()).rejects.toMatchObject({ code: "NETWORK" });
    await expect(api.listScenes()).rejects.toMatchObject({ code: "NETWORK" });
    expect(await api.listScenes()).toEqual([]);
  });
  it("emits progress and supports unsubscribe", async () => {
    const { api } = await fixture();
    const listener = vi.fn(); const unsubscribe = api.onProgress(listener);
    await api.listScenes();
    expect(listener.mock.calls).toEqual([[{ phase: "Đang tải dữ liệu", completed: 0, total: 1 }], [{ phase: "Đang tải dữ liệu", completed: 1, total: 1 }]]);
    unsubscribe(); await api.listScenes(); expect(listener).toHaveBeenCalledTimes(2);
  });
  it("aborts pending fetches and permits a fresh request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })).mockResolvedValueOnce(new Response("[]"));
    const api = createStaticApi("/data", fetcher);
    const pending = api.listScenes();
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await api.cancelJob()).toBe(true); await rejected;
    expect(await api.listScenes()).toEqual([]);
    expect(await api.cancelJob()).toBe(true);
  });
  it("does not continue manifest-to-data work after cancellation even if transport ignores abort", async () => {
    const { manifest } = await fixture();
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise(done => { resolve = done; }));
    const api = createStaticApi("/data", fetcher);
    const pending = api.extract(args);
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await api.cancelJob(); resolve(new Response(JSON.stringify(manifest))); await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(api.demoVariants("scenario-1")).toEqual([]);
  });
});
