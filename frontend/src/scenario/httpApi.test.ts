import { describe, expect, it, vi } from "vitest";
import { createHttpApi, readPackage } from "./httpApi";

function response(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}
const doc = { querySelector: () => null, createElement: () => ({}), body: { appendChild() {} } } as never;

describe("createHttpApi", () => {
  it("posts JSON with the token and unwraps value", async () => {
    const fetchImpl = vi.fn(async () => response(200, { value: [{ scene: "scene-0061" }] }));
    const api = createHttpApi({ token: "t".repeat(64), fetchImpl, doc });
    await expect(api.listScenes()).resolves.toEqual([{ scene: "scene-0061" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/listScenes");
    expect((init.headers as Record<string, string>)["X-Topeye-Token"]).toBe("t".repeat(64));
  });
  it("turns server errors into the shared error string", async () => {
    const api = createHttpApi({ token: "x", fetchImpl: async () => response(409, { code: "BUSY", message: "Một tác vụ đang chạy" }), doc });
    await expect(api.replay({ scenario_id: "a" })).rejects.toThrow("BUSY: Một tác vụ đang chạy");
  });
  it("reports a stopped server as NETWORK", async () => {
    const api = createHttpApi({ token: "x", fetchImpl: async () => { throw new TypeError("fetch failed"); }, doc });
    await expect(api.settings()).rejects.toThrow(/^NETWORK/);
  });
  it("cancelled path prompts behave like a cancelled dialog", async () => {
    const fetchImpl = vi.fn();
    const api = createHttpApi({ token: "x", fetchImpl, prompt: () => null, doc });
    await expect(api.chooseDataset()).resolves.toBeNull();
    await expect(api.chooseWorkspace()).resolves.toBeNull();
    await expect(api.openImported({ source_id: "a".repeat(32) })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("sends the typed dataset path", async () => {
    const fetchImpl = vi.fn(async () => response(200, { value: { name: "nuscenes", version: "v1.0-mini", scenes: [] } }));
    const api = createHttpApi({ token: "x", fetchImpl, prompt: () => "  ~/data/nuscenes ", doc });
    await api.chooseDataset();
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ path: "~/data/nuscenes" });
  });
  it("streams progress from the token-guarded event source", () => {
    const source = { onmessage: null as null | ((e: MessageEvent) => void), close: vi.fn() };
    const eventSource = vi.fn(() => source);
    const api = createHttpApi({ token: "abc", fetchImpl: vi.fn(), doc, eventSource });
    const seen: unknown[] = [];
    const off = api.onProgress((p) => seen.push(p));
    source.onmessage!({ data: JSON.stringify({ phase: "x", completed: 1, total: 2 }) } as MessageEvent);
    source.onmessage!({ data: "{" } as MessageEvent);
    off();
    expect(eventSource).toHaveBeenCalledWith("/api/events?token=abc");
    expect(seen).toEqual([{ phase: "x", completed: 1, total: 2 }]);
    expect(source.close).toHaveBeenCalled();
  });
});

describe("readPackage (plan43)", () => {
  const file = (path: string, body: string) => Object.assign(new File([body], path.split("/").at(-1)!), { webkitRelativePath: path }) as File;
  it("keeps the folder's xosc, report and csv, reads the scene and lists skipped files", async () => {
    const picked = await readPackage([
      file("car_013/car_013.xosc", "<OpenSCENARIO/>"),
      file("car_013/report.json", JSON.stringify({ scene: "scene-1077" })),
      file("car_013/trajectories.csv", "scene,time_s"),
      file("car_013/scene-1077_map.xodr", "<OpenDRIVE/>"),
      file("car_013/nested/report.json", "{}"),
    ]);
    expect(picked.files.map(f => f.name)).toEqual(["car_013.xosc", "report.json", "trajectories.csv"]);
    expect(atob(picked.files[0].data_base64)).toBe("<OpenSCENARIO/>");
    expect(picked.scene).toBe("scene-1077");
    expect(picked.skipped).toEqual(["scene-1077_map.xodr", "report.json"]);
  });
  it("needs exactly one xosc and ignores an unusable scene", async () => {
    await expect(readPackage([file("p/report.json", "{}")])).rejects.toThrow(/đúng 1 file .xosc/);
    const picked = await readPackage([file("p/a.xosc", "x"), file("p/report.json", '{"scene":"../x"}')]);
    expect(picked.scene).toBeNull();
  });
});
