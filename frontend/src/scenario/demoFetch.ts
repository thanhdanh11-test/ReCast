/**
 * Recorded web demo: same-origin `/api/*` calls are answered from responses captured on a real local server
 * (`scripts/record-demo.mjs`), so the full app runs on a static host. A call that was not recorded gets
 * DEMO_ONLY instead of reaching the network.
 */
export const DEMO_ONLY = { code: "DEMO_ONLY", message: "Bản demo chỉ phát lại các thao tác đã ghi sẵn; tính năng này có trong app đầy đủ." };

/** Shared with the recorder: sha256 of `<METHOD> <pathname>\n<body>` as hex. */
export async function demoKey(method: string, pathname: string, body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${method} ${pathname}\n${body}`));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

type FetchHost = { fetch: typeof fetch; location: { origin: string } };

export function installDemoFetch(host: FetchHost, recordings = "demo-api/rpc/"): void {
  const real = host.fetch.bind(host);
  host.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url, host.location.origin);
    if (url.origin !== host.location.origin || !url.pathname.startsWith("/api/")) return real(input, init);
    const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
    const recorded = await real(`${recordings}${await demoKey(request.method, url.pathname, body)}.json`);
    // Static hosts may answer a missing file with the SPA index (200 text/html): only JSON is a recording.
    if (!recorded.ok || !recorded.headers.get("content-type")?.includes("json")) return Response.json(DEMO_ONLY, { status: 409 });
    const { status, body: value } = await recorded.json() as { status: number; body: unknown };
    return Response.json(value, { status });
  };
}
