export interface Session { configured: boolean; authenticated: boolean; username?: string }
export interface DatasetEntry {
  id: string; name: string; format: "nuscenes" | "av2"; root: string;
  sceneCount: number; regions: string[]; status: "ready" | "unavailable"; previewUrl?: string; error?: string;
}
export async function accessCall<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const token = document.querySelector<HTMLMetaElement>('meta[name="topeye-token"]')?.content || "";
  const response = await fetch(`/api/${name}`, {
    method: args === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Topeye-Token": token },
    ...(args !== undefined ? { body: JSON.stringify(args) } : {}),
  });
  const body = await response.json();
  if (!response.ok) {
    if (body.code === "UNAUTHENTICATED") window.dispatchEvent(new Event("topeye-session-expired"));
    throw Object.assign(new Error(body.message || "Không thể kết nối ứng dụng"), { code: body.code });
  }
  return body.value as T;
}
