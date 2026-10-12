import type { DesktopAPI, Replay, Scenario, Scene } from "./types";
import { extractKey, variantKey } from "./demoKeys";

export interface DemoVariant {
  key: string;
  scenario_id: string;
  target_actor: string;
  speed_factor: number;
  gap_offset_m: number;
  result_id: string;
}
export interface WebManifest {
  schema: "topeye-web-demo-v1";
  app_version: string;
  generated_at: string;
  dataset: { name: "nuScenes"; version: "v1.0-mini"; license: "CC BY-NC-SA 4.0" };
  engine: { name: "esmini"; version: "3.9.0" };
  extracts: { key: string; scene: string; actor_tokens: string[]; start_s: number; end_s: number; scenario_id: string }[];
  variants: DemoVariant[];
  replays: string[];
  skipped: { key: string; reason: string }[];
  files: Record<string, string>;
}
type DemoHelpers = { demoVariants(scenarioId: string): DemoVariant[] };
declare global { interface Window { scenarioDemo?: DemoHelpers } }

function failure(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}
const unavailable = async (): Promise<never> => {
  throw failure("WEB_DEMO_UNAVAILABLE", "Chỉ có ở bản đầy đủ (npm run web:local)");
};

export function createStaticApi(base: string, fetchImpl: typeof fetch = fetch): DesktopAPI & DemoHelpers {
  let manifest: WebManifest | undefined;
  const active = new Set<AbortController>();
  const listeners = new Set<Parameters<DesktopAPI["onProgress"]>[0]>();
  const check = (signal: AbortSignal) => {
    if (signal.aborted) throw failure("CANCELLED", "Đã huỷ tác vụ");
  };
  const progress = (completed: number) => {
    for (const callback of listeners) callback({ phase: "Đang tải dữ liệu", completed, total: 1 });
  };
  async function job<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    active.add(controller);
    try { return await work(controller.signal); }
    finally { active.delete(controller); }
  }
  async function read<T>(file: string, signal: AbortSignal): Promise<T> {
    check(signal);
    progress(0);
    let response: Response;
    try {
      response = await fetchImpl(`${base.replace(/\/$/, "")}/${file}`, { signal });
    } catch {
      check(signal);
      throw failure("NETWORK", `Không tải được ${file}; hãy thử lại`);
    }
    check(signal);
    if (response.status === 404) throw failure("WEB_DATA_MISSING", file);
    if (!response.ok) throw failure("NETWORK", `${file} (HTTP ${response.status}); hãy thử lại`);
    let data: T;
    try { data = await response.json() as T; }
    catch {
      check(signal);
      throw failure("WEB_DATA_CORRUPT", file);
    }
    check(signal);
    progress(1);
    return data;
  }
  async function getManifest(signal: AbortSignal): Promise<WebManifest> {
    check(signal);
    if (!manifest) {
      const data = await read<WebManifest>("manifest.json", signal);
      if (!data || data.schema !== "topeye-web-demo-v1" || typeof data.app_version !== "string"
          || !Array.isArray(data.extracts) || !Array.isArray(data.variants) || !Array.isArray(data.replays)) {
        throw failure("WEB_DATA_CORRUPT", "manifest.json");
      }
      manifest = data;
    }
    return manifest;
  }
  function absent(): never {
    throw failure("WEB_DEMO_UNAVAILABLE", "Tổ hợp này chưa có trong bản demo");
  }
  return {
    settings: () => job(async signal => ({
      dataset: "nuScenes v1.0-mini (demo)", datasetVersion: "v1.0-mini", workspace: "",
      engineAvailable: false, version: (await getManifest(signal)).app_version, mode: "web-demo",
    })),
    listScenes: () => job(signal => read<Scene[]>("scenes.json", signal)),
    sourceScene: ({ scene }) => job(signal => read<Scenario>(`source/${encodeURIComponent(scene)}.json`, signal)),
    extract: args => job(async signal => {
      const data = await getManifest(signal);
      const key = await extractKey(args.scene, args.actor_tokens, args.start_s, args.end_s);
      check(signal);
      if (!data.extracts.some(entry => entry.key === key)) absent();
      return read<Scenario>(`extract/${key}.json`, signal);
    }),
    variant: args => job(async signal => {
      const data = await getManifest(signal);
      const key = await variantKey(args.scenario_id, args.target_actor, args.speed_factor, args.gap_offset_m);
      check(signal);
      if (!data.variants.some(entry => entry.key === key)) absent();
      return read<Scenario>(`variant/${key}.json`, signal);
    }),
    replay: ({ scenario_id }) => job(async signal => {
      if (!(await getManifest(signal)).replays.includes(scenario_id)) absent();
      return read<Replay>(`replay/${encodeURIComponent(scenario_id)}.json`, signal);
    }),
    mapContext: unavailable, chooseDataset: unavailable, chooseWorkspace: unavailable,
    export: unavailable, exportMapContext: unavailable, importXosc: unavailable,
    openImported: unavailable, replayImported: unavailable,
    cancelJob: async () => { for (const controller of active) controller.abort(); return true; },
    onProgress: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    demoVariants: scenarioId => (manifest?.variants ?? []).filter(entry => entry.scenario_id === scenarioId).map(entry => ({ ...entry })),
  };
}
