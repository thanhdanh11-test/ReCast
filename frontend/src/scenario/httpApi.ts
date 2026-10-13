import type { DesktopAPI } from "./types";

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
