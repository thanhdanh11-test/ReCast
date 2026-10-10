// CARLA 0.9.15 WeatherParameters.cpp, Copyright 2017 CVC/UAB, MIT license.
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
// Source: https://github.com/carla-simulator/carla/blob/0.9.15/LibCarla/source/carla/rpc/WeatherParameters.cpp
export type SceneQuality = "auto" | "high" | "balanced";
export const CARLA_WEATHER_VALUES = {
  "ClearNoon": [
    5.0,
    0.0,
    0.0,
    10.0,
    -1.0,
    45.0,
    2.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "CloudyNoon": [
    60.0,
    0.0,
    0.0,
    10.0,
    -1.0,
    45.0,
    3.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "WetNoon": [
    5.0,
    0.0,
    50.0,
    10.0,
    -1.0,
    45.0,
    3.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "WetCloudyNoon": [
    60.0,
    0.0,
    50.0,
    10.0,
    -1.0,
    45.0,
    3.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "MidRainyNoon": [
    60.0,
    60.0,
    60.0,
    60.0,
    -1.0,
    45.0,
    3.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "HardRainNoon": [
    100.0,
    100.0,
    90.0,
    100.0,
    -1.0,
    45.0,
    7.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "SoftRainNoon": [
    20.0,
    30.0,
    50.0,
    30.0,
    -1.0,
    45.0,
    3.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "ClearSunset": [
    5.0,
    0.0,
    0.0,
    10.0,
    -1.0,
    15.0,
    2.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "CloudySunset": [
    60.0,
    0.0,
    0.0,
    10.0,
    -1.0,
    15.0,
    3.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "WetSunset": [
    5.0,
    0.0,
    50.0,
    10.0,
    -1.0,
    15.0,
    2.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "WetCloudySunset": [
    60.0,
    0.0,
    50.0,
    10.0,
    -1.0,
    15.0,
    2.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "MidRainSunset": [
    60.0,
    60.0,
    60.0,
    60.0,
    -1.0,
    15.0,
    3.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "HardRainSunset": [
    100.0,
    100.0,
    90.0,
    100.0,
    -1.0,
    15.0,
    7.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "SoftRainSunset": [
    20.0,
    30.0,
    50.0,
    30.0,
    -1.0,
    15.0,
    2.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "ClearNight": [
    5.0,
    0.0,
    0.0,
    10.0,
    -1.0,
    -90.0,
    60.0,
    75.0,
    1.0,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "CloudyNight": [
    60.0,
    0.0,
    0.0,
    10.0,
    -1.0,
    -90.0,
    60.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "WetNight": [
    5.0,
    0.0,
    50.0,
    10.0,
    -1.0,
    -90.0,
    60.0,
    75.0,
    1.0,
    60.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "WetCloudyNight": [
    60.0,
    0.0,
    50.0,
    10.0,
    -1.0,
    -90.0,
    60.0,
    0.75,
    0.1,
    60.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "SoftRainNight": [
    60.0,
    30.0,
    50.0,
    30.0,
    -1.0,
    -90.0,
    60.0,
    0.75,
    0.1,
    60.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "MidRainyNight": [
    80.0,
    60.0,
    60.0,
    60.0,
    -1.0,
    -90.0,
    60.0,
    0.75,
    0.1,
    80.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "HardRainNight": [
    100.0,
    100.0,
    90.0,
    100.0,
    -1.0,
    -90.0,
    100.0,
    0.75,
    0.1,
    100.0,
    1.0,
    0.03,
    0.0331,
    0.0
  ],
  "DustStorm": [
    100.0,
    0.0,
    0.0,
    100.0,
    -1.0,
    45.0,
    2.0,
    0.75,
    0.1,
    0.0,
    1.0,
    0.03,
    0.0331,
    100.0
  ]
} as const;
export type WeatherPresetId = keyof typeof CARLA_WEATHER_VALUES;
export const WEATHER_PARAMETER_KEYS = ["cloudiness", "precipitation", "precipitation_deposits", "wind_intensity", "sun_azimuth_angle", "sun_altitude_angle", "fog_density", "fog_distance", "fog_falloff", "wetness", "scattering_intensity", "mie_scattering_scale", "rayleigh_scattering_scale", "dust_storm"] as const;
export type CarlaWeatherParameters = Record<typeof WEATHER_PARAMETER_KEYS[number], number>;
export interface SceneEnvironmentSettings {
    schema: "topeye-scene-environment-v1";
    carlaVersion: "0.9.15";
    preset: WeatherPresetId;
    weather: CarlaWeatherParameters;
    quality: SceneQuality;
}
export function environmentSettingsFor(preset: WeatherPresetId, quality: SceneQuality = "auto"): SceneEnvironmentSettings {
    const values = CARLA_WEATHER_VALUES[preset];
    if (!Object.hasOwn(CARLA_WEATHER_VALUES, preset) || !values || !["auto", "high", "balanced"].includes(quality)) throw new Error("INVALID_ENVIRONMENT_SETTINGS");
    return { schema: "topeye-scene-environment-v1", carlaVersion: "0.9.15", preset, quality,
        weather: Object.fromEntries(WEATHER_PARAMETER_KEYS.map((key, index) => [key, values[index]])) as CarlaWeatherParameters };
}
export const defaultEnvironmentSettings = () => environmentSettingsFor("ClearNoon");
export function isValidEnvironmentSettings(value: unknown): value is SceneEnvironmentSettings {
    if (!value || typeof value !== "object") return false;
    const settings = value as SceneEnvironmentSettings;
    if (settings.schema !== "topeye-scene-environment-v1" || settings.carlaVersion !== "0.9.15" ||
        !Object.hasOwn(CARLA_WEATHER_VALUES, settings.preset) || !["auto", "high", "balanced"].includes(settings.quality) ||
        !settings.weather || typeof settings.weather !== "object") return false;
    return WEATHER_PARAMETER_KEYS.every(key => {
        const number = settings.weather[key];
        if (!Number.isFinite(number)) return false;
        if (key === "sun_azimuth_angle") return number === -1 || (number >= 0 && number <= 360);
        if (key === "sun_altitude_angle") return number >= -90 && number <= 90;
        if (["cloudiness", "precipitation", "precipitation_deposits", "wind_intensity", "wetness", "fog_density", "dust_storm"].includes(key)) return number >= 0 && number <= 100;
        return number >= 0;
    });
}
