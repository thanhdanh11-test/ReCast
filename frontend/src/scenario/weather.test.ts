import { describe, expect, it } from "vitest";
import { CARLA_WEATHER_VALUES, defaultEnvironmentSettings, environmentSettingsFor, isValidEnvironmentSettings, WEATHER_PARAMETER_KEYS } from "./weather";

describe("CARLA weather contract", () => {
    it("preserves all 22 official 14-parameter presets including unusual night values", () => {
        expect(Object.keys(CARLA_WEATHER_VALUES)).toHaveLength(22);
        for (const preset of Object.keys(CARLA_WEATHER_VALUES) as (keyof typeof CARLA_WEATHER_VALUES)[]) {
            const settings = environmentSettingsFor(preset);
            expect(isValidEnvironmentSettings(settings)).toBe(true);
            expect(WEATHER_PARAMETER_KEYS.map(key => settings.weather[key])).toEqual([...CARLA_WEATHER_VALUES[preset]]);
        }
        expect(environmentSettingsFor("ClearNight").weather).toMatchObject({ fog_distance: 75, fog_falloff: 1, sun_altitude_angle: -90 });
        expect(environmentSettingsFor("WetCloudyNight").weather).toMatchObject({ fog_distance: .75, fog_falloff: .1, wetness: 60 });
        expect(environmentSettingsFor("DustStorm").weather.dust_storm).toBe(100);
    });
    it("rejects malformed parameters, unknown presets and quality while preserving independent settings", () => {
        const settings = defaultEnvironmentSettings();
        expect(settings.preset).toBe("ClearNoon");
        for (const value of [NaN, Infinity, -1, 101]) expect(isValidEnvironmentSettings({...settings, weather: {...settings.weather, precipitation: value}})).toBe(false);
        expect(isValidEnvironmentSettings({...settings, preset: "Default"})).toBe(false);
        expect(isValidEnvironmentSettings({...settings, weather: {...settings.weather, sun_azimuth_angle: -2}})).toBe(false);
        expect(isValidEnvironmentSettings({...settings, quality: "unknown"})).toBe(false);
        settings.weather.precipitation = 99;
        expect(defaultEnvironmentSettings().weather.precipitation).toBe(0);
    });
});
