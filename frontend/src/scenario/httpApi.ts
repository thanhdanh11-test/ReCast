import type { DesktopAPI, PackageSelection } from "./types";
import type { ReactiveKind } from "./reactiveTypes";

type Doc = Pick<Document, "createElement" | "querySelector" | "body">;
export interface HttpApiOptions {
  base?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  prompt?: (message: string) => string | null;
  doc?: Doc;
  eventSource?: (url: string) => Pick<EventSource, "onmessage" | "close">;
}

const MAX_XOSC = 2 * 1024 * 1024;
function failure(code: string, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

/** Read one user-picked file through a transient <input type=file>; null when cancelled. */
function pickFile(doc: Doc, accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => { resolve(input.files?.[0] ?? null); input.remove(); });
    input.addEventListener("cancel", () => { resolve(null); input.remove(); });
    doc.body.appendChild(input);
    input.click();
  });
}

/** Read every file of a user-picked folder (webkitdirectory); null when cancelled. */
function pickFolder(doc: Doc): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.style.display = "none";
    input.addEventListener("change", () => { resolve(input.files ? Array.from(input.files) : null); input.remove(); });
    input.addEventListener("cancel", () => { resolve(null); input.remove(); });
    doc.body.appendChild(input);
    input.click();
  });
}

/** real2sim package limits (plan43 01-CONTRACTS §1); the worker checks them again. */
const PACKAGE_LIMITS: Record<string, number> = { xosc: 4 * 1024 * 1024, "report.json": 256 * 1024, "trajectories.csv": 1536 * 1024 };

/** Keeps the package files of a folder (one .xosc, report.json, trajectories.csv) and reads the report's scene. */
export async function readPackage(files: File[]): Promise<PackageSelection> {
  const top = files.filter(f => !(f.webkitRelativePath || f.name).split("/").slice(1, -1).length); // folder root only
  const xosc = top.filter(f => f.name.toLowerCase().endsWith(".xosc"));
  if (xosc.length !== 1) throw failure("INVALID_INPUT", `Thư mục phải có đúng 1 file .xosc (đang có ${xosc.length})`);
  const kept = [...xosc, ...top.filter(f => f.name === "report.json" || f.name === "trajectories.csv")];
  const skipped = files.filter(f => !kept.includes(f)).map(f => f.name);
  let scene: string | null = null;
  const out = [];
  for (const f of kept) {
    const limit = PACKAGE_LIMITS[f === xosc[0] ? "xosc" : f.name];
    if (f.size > limit) throw failure("RESOURCE_LIMIT", `${f.name} vượt ${Math.round(limit / 1024)} KiB`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (f.name === "report.json") {
      try {
        const value = (JSON.parse(new TextDecoder().decode(bytes)) as { scene?: unknown }).scene;
        if (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) scene = value;
      } catch { /* the worker reports the malformed file */ }
    }
    const name = f === xosc[0] && !/^[^/\\\x00-\x1f]{1,115}\.xosc$/.test(f.name) ? "package.xosc" : f.name;
    out.push({ name, data_base64: toBase64(bytes) });
  }
  return { files: out, scene, skipped };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** DesktopAPI over the localhost server in frontend/server/local-server.mjs. */
export function createHttpApi(options: HttpApiOptions = {}): DesktopAPI {
  const doc = options.doc ?? document;
  const base = options.base ?? "/api";
  const token = options.token ?? doc.querySelector<HTMLMetaElement>('meta[name="topeye-token"]')?.content ?? "";
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const ask = options.prompt ?? ((message: string) => window.prompt(message));
  const openEvents = options.eventSource ?? ((url: string) => new EventSource(url));

  async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Topeye-Token": token },
        body: JSON.stringify(args),
      });
    } catch {
      throw failure("NETWORK", "Không kết nối được server cục bộ; kiểm tra `npm run web:local` còn chạy");
    }
    let body: { value?: T; code?: string; message?: string };
    try { body = await response.json(); }
    catch { throw failure("INTERNAL", `Phản hồi không hợp lệ (HTTP ${response.status})`); }
    if (!response.ok) {
      if (body.code === "UNAUTHENTICATED" && typeof window !== "undefined") window.dispatchEvent(new Event("topeye-session-expired"));
      throw failure(body.code || "INTERNAL", body.message || `HTTP ${response.status}`);
    }
    return body.value as T;
  }
  const askPath = (message: string) => {
    const value = ask(message);
    return value && value.trim() ? value.trim() : null;
  };

  return {
    scenarioGroups: args => call("scenarioGroups", args),
    recordScenarioGroup: args => call("recordScenarioGroup", args),
    settings: () => call("settings"),
    listScenes: () => call("listScenes"),
    sourceScene: (args) => call("sourceScene", args),
    extract: (args) => call("extract", args),
    variant: (args) => call("variant", args),
    export: (args) => call("export", args),
    replay: (args) => call("replay", args),
    mapContext: (args) => call("mapContext", args),
    replayImported: (args) => call("replayImported", args),
    lidarFrame: (args) => call("lidarFrame", args),
    scenarioMetrics: (args) => call("scenarioMetrics", args),
    storageInfo: () => call("storageInfo"),
    clearMetricsCache: () => call("clearMetricsCache"),
    emptyTrash: () => call("emptyTrash"),
    submitFeedback: (args) => call("submitFeedback", args),
    listFeedback: () => call("listFeedback"),
    cancelJob: () => call("cancelJob"),
    chooseDataset: async () => {
      const path = askPath("Đường dẫn thư mục nuScenes hoặc Argoverse 2 Sensor:");
      return path ? call("chooseDataset", { path }) : null;
    },
    chooseWorkspace: async () => {
      const path = askPath("Đường dẫn thư mục lưu kịch bản:");
      return path ? call("chooseWorkspace", { path }) : null;
    },
    listImported: () => call("listImported"),
    openImported: async ({ source_id, path: known }) => {
      const path = known ?? askPath("Đường dẫn thư mục import/ của kịch bản đã lưu:");
      return path ? call("openImported", { source_id, path }) : null;
    },
    readImported: (args) => call("readImported", args),
    deleteImportedRun: (args) => call("deleteImportedRun", args),
    deleteImported: (args) => call("deleteImported", args),
    importXosc: async ({ source_id, xml, file_name }) => {
      if (xml !== undefined) {
        const bytes = new TextEncoder().encode(xml);
        if (bytes.length > MAX_XOSC) throw failure("RESOURCE_LIMIT", "XOSC tối đa 2 MiB");
        return call("importXosc", { source_id, xml_base64: toBase64(bytes), ...(file_name ? { file_name } : {}) });
      }
      const file = await pickFile(doc, ".xosc");
      if (!file) return null;
      if (file.size > MAX_XOSC) throw failure("RESOURCE_LIMIT", "XOSC tối đa 2 MiB");
      const xml_base64 = toBase64(new Uint8Array(await file.arrayBuffer()));
      return call("importXosc", { source_id, xml_base64, file_name: file.name });
    },
    importTemplate: (args) => call("importTemplate", args),
    pickPackage: async () => {
      const files = await pickFolder(doc);
      return files?.length ? readPackage(files) : null;
    },
    importPackage: (args) => call("importPackage", args),
    reactiveCandidates: (args) => call("reactiveCandidates", args),
    importReactive: (args) => call("importReactive", args),
    reactiveSensitivity: (args) => call("reactiveSensitivity", args),
    // Overloaded by `kinds` (plan47 C5): the worker answers the shape that matches the request.
    reactiveMetrics: (args: { scene: string; reactions?: number[]; kinds?: ReactiveKind[] }) => call<never>("reactiveMetrics", args),
    replayErrorMetrics: (args) => call("replayErrorMetrics", args),
    esminiCheck: (args) => call("esminiCheck", args),
    templateFit: (args) => call("templateFit", args),
    mapStatus: () => call("mapStatus", {}),
    exportMapContext: async ({ source_id }) => {
      const context = await call<{ scene: string }>("exportMapContext", { source_id });
      const name = `topeye-${context.scene}-map.json`;
      const url = URL.createObjectURL(new Blob([JSON.stringify(context, null, 2)], { type: "application/json" }));
      const link = doc.createElement("a");
      link.href = url;
      link.download = name;
      doc.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return { path: `${name} (thư mục Tải về)` };
    },
    onProgress: (callback) => {
      const source = openEvents(`${base}/events?token=${encodeURIComponent(token)}`);
      source.onmessage = (event: MessageEvent) => {
        try { callback(JSON.parse(event.data)); } catch { /* ignore malformed progress */ }
      };
      return () => source.close();
    },
  };
}
