import { useEffect, useRef, useState } from 'react';
import type { LidarFrame, Scenario } from './types';

export interface LidarRequest { scene: string; time_s: number }
export interface DecodedLidar { frame: LidarFrame; xyz: Int16Array; intensity: Uint8Array }

/**
 * Source-scene time at which measured LiDAR describes what the scenario shows, or null when no
 * measurement exists: variants move actors and imported XOSC actors are not in the recording.
 */
export function measuredLidarRequest(scenario: Scenario | null, time: number): LidarRequest | null {
  if (!scenario || scenario.mode === 'imported' || !scenario.source?.scene) return null;
  if (scenario.mode === 'source') return { scene: scenario.source.scene, time_s: time };
  const variant = scenario.variant;
  if (variant && (variant.speed_factor !== 1 || variant.gap_offset_m !== 0)) return null;
  const start = scenario.source.selected_interval_s?.[0];
  return start === undefined ? null : { scene: scenario.source.scene, time_s: start + time };
}

function bytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function decodeLidar(frame: LidarFrame): DecodedLidar {
  const raw = bytes(frame.xyz_cm_b64);
  const xyz = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const intensity = bytes(frame.intensity_b64);
  if (xyz.length !== frame.count * 3 || intensity.length !== frame.count) throw new Error('LIDAR_CORRUPT: kích thước điểm không khớp');
  return { frame, xyz, intensity };
}

const CACHE = 48;
const sweepKey = (r: LidarRequest) => `${r.scene}@${Math.round(r.time_s * 20)}`;

/**
 * Keeps at most one LiDAR read in flight; while one runs only the latest timeline request is
 * remembered, and results for superseded scenes are dropped. Recent sweeps are cached (LRU).
 */
export function useMeasuredLidar(load: ((r: LidarRequest) => Promise<LidarFrame>) | undefined, request: LidarRequest | null) {
  const [state, setState] = useState<{ data: DecodedLidar | null; error: string | null; unsupported: boolean }>({ data: null, error: null, unsupported: false });
  const cache = useRef(new Map<string, DecodedLidar>());
  const inFlight = useRef(false);
  const latest = useRef<LidarRequest | null>(null);
  const scene = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    latest.current = request;
    if (!request || !load) return;
    if (scene.current !== request.scene) { scene.current = request.scene; setState({ data: null, error: null, unsupported: false }); }
    const pump = () => {
      const next = latest.current;
      if (!next || inFlight.current || !alive.current) return;
      const key = sweepKey(next), hit = cache.current.get(key);
      if (hit) {
        cache.current.delete(key); cache.current.set(key, hit);
        setState({ data: hit, error: null, unsupported: false });
        return;
      }
      inFlight.current = true;
      load(next).then(frame => {
        const decoded = decodeLidar(frame);
        cache.current.set(key, decoded);
        while (cache.current.size > CACHE) cache.current.delete(cache.current.keys().next().value!);
        if (alive.current && scene.current === next.scene) setState({ data: decoded, error: null, unsupported: false });
      }, (e: unknown) => {
        const message = String(e instanceof Error ? e.message : e);
        if (!alive.current || scene.current !== next.scene || /^BUSY/.test(message)) return;
        setState(s => ({ data: /^LIDAR_UNAVAILABLE/.test(message) ? null : s.data, error: message, unsupported: /^WEB_DEMO_UNAVAILABLE/.test(message) }));
      }).finally(() => {
        inFlight.current = false;
        const current = latest.current;
        if (current && sweepKey(current) !== key) pump();
      });
    };
    pump();
  }, [load, request?.scene, request ? Math.round(request.time_s * 20) : null]);
  return state;
}

const STOPS: [number, number, number][] = [[40, 90, 160], [60, 190, 190], [235, 215, 90], [235, 90, 70]];
/** Height ramp (0–255 RGB) in metres above the ego frame origin (ground ≈ 0, 3.5 m = red). */
export function heightRgb(z: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (z + 0.5) / 4));
  const f = t * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(f)), k = f - i;
  return STOPS[i].map((v, j) => Math.round(v + (STOPS[i + 1][j] - v) * k)) as [number, number, number];
}

/** Point colour (0–255 RGB) for Cài đặt › LiDAR: height above ego ground, return intensity, or range. */
export function pointRgb(mode: "height" | "intensity" | "distance", x: number, y: number, z: number, intensity: number): [number, number, number] {
  if (mode === "intensity") return heightRgb(-0.5 + 4 * Math.min(1, intensity / 100));
  if (mode === "distance") return heightRgb(3.5 - 4 * Math.min(1, Math.hypot(x, y) / 80));
  return heightRgb(z);
}
