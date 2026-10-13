import { useEffect, useState } from "react";
import type { SceneQuality } from "./weather";

/** Per-viewer display preferences (Cài đặt). Browser storage may be missing or blocked: defaults then. */
export type Appearance = "dark" | "light" | "system";
export interface Preferences { appearance: Appearance; quality: SceneQuality }

const KEY = "topeye.preferences.v1";
export const defaultPreferences: Preferences = { appearance: "dark", quality: "auto" };

export function loadPreferences(): Preferences {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Preferences>;
        return {
            appearance: raw.appearance === "light" || raw.appearance === "system" ? raw.appearance : "dark",
            quality: raw.quality === "high" || raw.quality === "balanced" ? raw.quality : "auto",
        };
    } catch {
        return defaultPreferences;
    }
}

export function savePreferences(preferences: Preferences) {
    try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* preference simply not remembered */ }
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
