/** Match the exporter's compact, UTF-8 JSON key contract. */
async function key(values: unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(values));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export function extractKey(scene: string, actorTokens: string[], start: number, end: number): Promise<string> {
  return key([scene, [...actorTokens].sort(), start, end]);
}

export function variantKey(scenarioId: string, targetActor: string, speedFactor: number, gapOffset: number): Promise<string> {
  return key([scenarioId, targetActor, speedFactor, gapOffset]);
}
