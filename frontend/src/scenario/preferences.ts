import { useEffect, useState } from "react";
import type { SceneQuality } from "./weather";

/** Per-viewer display preferences (Cài đặt). Browser storage may be missing or blocked: defaults then. */
export type Appearance = "dark" | "light" | "system";
export type CameraMode = "follow" | "overview" | "cabin";
export type LidarColor = "height" | "intensity" | "distance";
export type Language = "vi" | "en";
export interface Preferences {
    appearance: Appearance;
    quality: SceneQuality;
    camera: CameraMode;
    shadows: boolean;
    corridor: boolean;
    lidarColor: LidarColor;
    lidarPointSize: 1 | 2 | 3;
    playbackRate: 0.5 | 1 | 2;
    autoplay: boolean;
    loop: boolean;
    speedUnit: "kmh" | "ms";
    language: Language;
}

const KEY = "topeye.preferences.v1";
export const PREFERENCES_EVENT = "topeye-preferences";
export const defaultPreferences: Preferences = {
    appearance: "dark", quality: "auto", camera: "follow", shadows: true, corridor: true,
    lidarColor: "height", lidarPointSize: 2, playbackRate: 1, autoplay: false, loop: false, speedUnit: "kmh", language: "vi",
};
const CHOICES: { [K in keyof Preferences]: readonly Preferences[K][] } = {
    appearance: ["dark", "light", "system"], quality: ["auto", "high", "balanced"], camera: ["follow", "overview", "cabin"],
    shadows: [true, false], corridor: [true, false], lidarColor: ["height", "intensity", "distance"], lidarPointSize: [1, 2, 3],
    playbackRate: [0.5, 1, 2], autoplay: [true, false], loop: [true, false], speedUnit: ["kmh", "ms"], language: ["vi", "en"],
};

/** Each field falls back to its default on its own, so one bad value never resets the rest. */
export function parsePreferences(raw: unknown): Preferences {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const out = { ...defaultPreferences } as Record<string, unknown>;
    for (const key of Object.keys(CHOICES) as (keyof Preferences)[])
        if ((CHOICES[key] as readonly unknown[]).includes(value[key])) out[key] = value[key];
    return out as unknown as Preferences;
}

export function loadPreferences(): Preferences {
    try {
        return parsePreferences(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
    } catch {
        return defaultPreferences;
    }
}

export function savePreferences(preferences: Preferences) {
    try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* preference simply not remembered */ }
    // Screens outside the studio (login, library) follow the language without a reload.
    window.dispatchEvent(new Event(PREFERENCES_EVENT));
}

/** Speed in the chosen unit, rounded for the HUD. */
export function formatSpeed(metersPerSecond: number, unit: Preferences["speedUnit"]): { value: string; unit: string } {
    return unit === "ms" ? { value: metersPerSecond.toFixed(1), unit: "m/s" } : { value: (metersPerSecond * 3.6).toFixed(0), unit: "km/h" };
}

/** Resolves "system" through prefers-color-scheme and follows OS changes live. */
export function useResolvedTheme(appearance: Appearance): "dark" | "light" {
    const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
    const [systemLight, setSystemLight] = useState(() => query?.matches ?? false);
    useEffect(() => {
        if (!query) return;
        const change = () => setSystemLight(query.matches);
        query.addEventListener("change", change);
        return () => query.removeEventListener("change", change);
    }, [query?.media]); // eslint-disable-line react-hooks/exhaustive-deps
    return appearance === "system" ? (systemLight ? "light" : "dark") : appearance;
}
