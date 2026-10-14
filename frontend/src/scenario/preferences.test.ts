import { describe, expect, it } from "vitest";
import { defaultPreferences, formatSpeed, parsePreferences } from "./preferences";
import { pointRgb, heightRgb } from "./measuredLidar";
import { translate } from "./i18n";
import { advancePlayback } from "./playback";

describe("preferences", () => {
    it("falls back per field, keeping valid neighbours", () => {
        expect(parsePreferences(null)).toEqual(defaultPreferences);
        const p = parsePreferences({ appearance: "light", quality: "ultra", playbackRate: 2, lidarPointSize: 7, language: "en", shadows: "yes" });
        expect(p).toMatchObject({ appearance: "light", quality: "auto", playbackRate: 2, lidarPointSize: 2, language: "en", shadows: true });
    });
    it("formats speed in km/h or m/s", () => {
        expect(formatSpeed(10, "kmh")).toEqual({ value: "36", unit: "km/h" });
        expect(formatSpeed(10, "ms")).toEqual({ value: "10.0", unit: "m/s" });
    });
    it("colours LiDAR points by the chosen channel", () => {
        expect(pointRgb("height", 50, 0, 1.2, 0)).toEqual(heightRgb(1.2));
        expect(pointRgb("intensity", 0, 0, 0, 0)).toEqual(heightRgb(-0.5));
        expect(pointRgb("intensity", 0, 0, 0, 255)).toEqual(heightRgb(3.5));
        expect(pointRgb("distance", 0, 0, 0, 0)).toEqual(heightRgb(3.5));
        expect(pointRgb("distance", 80, 0, 0, 0)).toEqual(heightRgb(-0.5));
    });
    it("translates with placeholders and keeps Vietnamese as default", () => {
        expect(translate("vi", "{n} mục", { n: 3 })).toBe("3 mục");
        expect(translate("en", "Cài đặt")).toBe("Settings");
        expect(translate("en", "{n} mục", { n: 3 })).toBe("3 items");
    });
    it("advances playback at the chosen rate and loops or stops at the end", () => {
        expect(advancePlayback(1, 0.04, 2, 10, false)).toEqual({ time: 1.08, done: false });
        expect(advancePlayback(1, 0.04, 0.5, 10, false)).toEqual({ time: 1.02, done: false });
        expect(advancePlayback(9.99, 0.04, 1, 10, false)).toEqual({ time: 10, done: true });
        expect(advancePlayback(9.99, 0.04, 1, 10, true)).toEqual({ time: 0, done: false });
        expect(advancePlayback(0, 0.04, 1, 0, true)).toEqual({ time: 0, done: true });
    });
});
