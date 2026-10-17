import { CARLA_WEATHER_VALUES, type WeatherPresetId } from "../weather";

/**
 * Scenario template (plan38, contract specs/01-CONTRACTS.md): high-level, user-editable parameters that a later
 * compiler (backend `topeye/scenario/template.py`) turns into the only accepted XOSC profile `topeye-map-trajectories-v1`.
 * Coordinates are in a curvilinear ego frame laid along the measured source ego path: x = metres along it from
 * `map.placement.start_m`, y = metres to its left (+ `placement.lateral_m`), yaw degrees CCW relative to it.
 */
export const TEMPLATE_PROFILE = "topeye-scenario-template-v1";

export type ActorKind = "car" | "truck" | "bus" | "motorcycle" | "bicycle" | "pedestrian";
export const ACTOR_KINDS: ActorKind[] = ["car", "truck", "bus", "motorcycle", "bicycle", "pedestrian"];
export const KIND_LABEL: Record<ActorKind, string> = { car: "Xe con", truck: "Xe tải", bus: "Xe buýt", motorcycle: "Xe máy", bicycle: "Xe đạp", pedestrian: "Người đi bộ" };
export const KIND_SIZE: Record<ActorKind, [length: number, width: number, height: number]> = {
    car: [4.5, 1.8, 1.5], truck: [8, 2.5, 3.2], bus: [12, 2.55, 3.2], motorcycle: [2.1, 0.8, 1.4], bicycle: [1.8, 0.6, 1.7], pedestrian: [0.5, 0.5, 1.75],
};

export interface Point { x_m: number; y_m: number }
export interface Pose extends Point { yaw_deg: number }
export interface SpeedProfile { initial_mps: number; target_mps: number; accel_mps2: number }
export interface TemplateActor {
    id: string; role: "ego" | "traffic"; kind: ActorKind;
    length_m: number; width_m: number; height_m: number;
    start: Pose; route: Point[]; speed: SpeedProfile; start_delay_s: number;
    /** Added by the user (not by the type preset): kept when key params regenerate the preset part. */
    manual?: boolean;
}

export type EventType = "hard_brake" | "lane_change" | "stop" | "accelerate";
export const EVENT_TYPES: EventType[] = ["hard_brake", "lane_change", "stop", "accelerate"];
/** Per-type parameters with [label, unit, min, max]; the compiler (P02) reads exactly these keys. */
export const EVENT_PARAMS: Record<EventType, Record<string, [label: string, unit: string, min: number, max: number]>> = {
    hard_brake: { decel_mps2: ["Giảm tốc", "m/s²", 0.5, 12] },
    lane_change: { lateral_m: ["Dịch ngang (+ sang trái)", "m", -7, 7], duration_s: ["Thời gian chuyển làn", "s", 0.5, 10] },
    stop: { decel_mps2: ["Giảm tốc", "m/s²", 0.5, 12] },
    accelerate: { target_mps: ["Vận tốc đích", "m/s", 0, 55], accel_mps2: ["Gia tốc", "m/s²", 0.1, 12] },
};
/** A pedestrian can stop but not "hard brake" (vehicle manoeuvre); the backend enforces the same rule. */
export const eventTypesFor = (kind: ActorKind | undefined): EventType[] => kind === "pedestrian" ? EVENT_TYPES.filter(type => type !== "hard_brake") : EVENT_TYPES;
export const EVENT_LABEL: Record<EventType, string> = { hard_brake: "Phanh gấp", lane_change: "Chuyển làn", stop: "Dừng", accelerate: "Tăng tốc" };
export interface TemplateEvent { id: string; type: EventType; actor: string; at_s: number; params: Record<string, number>; manual?: boolean }

/**
 * Where the ego frame starts on the source ego path, and a sideways shift of the whole scenario. With `auto`, the
 * worker tries other start points (nearest first, both sides) when this one leaves the map, hits an obstacle or breaks
 * dynamics. `mirror` swaps left/right: presets assume right-hand traffic, left-hand traffic (Singapore) needs it.
 */
export interface Placement { start_m: number; lateral_m: number; auto: boolean; mirror: boolean }
export const DEFAULT_PLACEMENT: Placement = { start_m: 0, lateral_m: 0, auto: true, mirror: false };

export interface ScenarioTemplate {
    profile: typeof TEMPLATE_PROFILE;
    name: string; description: string; tags: string[];
    scenario_type: string; params: Record<string, number | string>;
    /** True once parts 4–6 were edited by hand; changing key params then regenerates (and overwrites) them. */
    customized: boolean;
    /** ego_react (plan52, default true): the ego brakes for whatever blocks its lane instead of driving through it. */
    map: { scene: string; placement: Placement; duration_s: number; sample_hz: number; ego_react?: boolean };
    /** Presentation only: the XOSC profile carries no weather. */
    environment: { weather_preset: WeatherPresetId };
    actors: TemplateActor[];
    events: TemplateEvent[];
    expect: { min_ttc_s: number; min_gap_m: number; no_contact: boolean };
    provenance: { mode: "template" | "ai"; prompt?: string; model?: string; created_at: string };
}

/** Profile limits mirrored from docs/scenario.md (XOSC import gate); the backend stays the authority. */
export const LIMITS = {
    duration_s: [2, 60], sample_hz: [1, 20], start_m: [-200, 500], lateral_m: [-10, 10], actors: [1, 32], name: 120,
    vehicle_speed_mps: 55, pedestrian_speed_mps: 4, vehicle_accel_mps2: 12, pedestrian_accel_mps2: 6, size_m: [0.1, 20],
} as const;
/** Same as the backend: XOSC entity names must start with a letter. */
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export interface Issue { path: string; message: string; vars?: Record<string, string | number> }

const inRange = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;

export function validateTemplate(t: ScenarioTemplate): Issue[] {
    const out: Issue[] = [];
    const add = (path: string, message: string, vars?: Issue["vars"]) => out.push({ path, message, vars });
    if (t.profile !== TEMPLATE_PROFILE) add("profile", "Sai profile template");
    if (!t.name.trim() || t.name.length > LIMITS.name) add("name", "Tên phải có 1–{max} ký tự", { max: LIMITS.name });
    if (!t.map.scene) add("map.scene", "Chưa chọn map");
    const [dMin, dMax] = LIMITS.duration_s;
    if (!inRange(t.map.duration_s, dMin, dMax)) add("map.duration_s", "Thời lượng phải trong {min}–{max} s", { min: dMin, max: dMax });
    if (!inRange(t.map.sample_hz, LIMITS.sample_hz[0], LIMITS.sample_hz[1])) add("map.sample_hz", "Tần số mẫu phải trong {min}–{max} Hz", { min: LIMITS.sample_hz[0], max: LIMITS.sample_hz[1] });
    if (Number.isFinite(t.map.sample_hz) && !Number.isInteger(t.map.sample_hz)) add("map.sample_hz", "Tần số mẫu phải là số nguyên");
    if (!inRange(t.map.placement.start_m, LIMITS.start_m[0], LIMITS.start_m[1])) add("map.placement.start_m", "Điểm bắt đầu phải trong {min}–{max} m", { min: LIMITS.start_m[0], max: LIMITS.start_m[1] });
    if (!inRange(t.map.placement.lateral_m, LIMITS.lateral_m[0], LIMITS.lateral_m[1])) add("map.placement.lateral_m", "Lệch ngang phải trong {min}–{max} m", { min: LIMITS.lateral_m[0], max: LIMITS.lateral_m[1] });
    if (!(t.environment.weather_preset in CARLA_WEATHER_VALUES)) add("environment.weather_preset", "Thời tiết không hợp lệ");
    if (!inRange(t.actors.length, LIMITS.actors[0], LIMITS.actors[1])) add("actors", "Số đối tượng phải trong {min}–{max}", { min: LIMITS.actors[0], max: LIMITS.actors[1] });
    const egos = t.actors.filter(a => a.role === "ego").length;
    if (egos !== 1) add("actors", "Cần đúng một xe ego (đang có {n})", { n: egos });
    const ids = new Set<string>();
    t.actors.forEach((a, i) => {
        const p = `actors[${i}]`;
        if (!ID.test(a.id)) add(`${p}.id`, "ID “{id}” phải bắt đầu bằng chữ, chỉ gồm chữ, số, _ hoặc - (tối đa 32)", { id: a.id });
        else if (ids.has(a.id)) add(`${p}.id`, "ID “{id}” bị trùng", { id: a.id });
        ids.add(a.id);
        if (a.role === "ego" && a.kind === "pedestrian") add(`${p}.kind`, "Ego phải là phương tiện");
        for (const key of ["length_m", "width_m", "height_m"] as const)
            if (!inRange(a[key], LIMITS.size_m[0], LIMITS.size_m[1])) add(`${p}.${key}`, "{id}: kích thước phải trong {min}–{max} m", { id: a.id, min: LIMITS.size_m[0], max: LIMITS.size_m[1] });
        const walker = a.kind === "pedestrian";
        const vMax = walker ? LIMITS.pedestrian_speed_mps : LIMITS.vehicle_speed_mps;
        const aMax = walker ? LIMITS.pedestrian_accel_mps2 : LIMITS.vehicle_accel_mps2;
        if (!inRange(a.speed.initial_mps, 0, vMax) || !inRange(a.speed.target_mps, 0, vMax)) add(`${p}.speed`, "{id}: vận tốc phải trong 0–{max} m/s", { id: a.id, max: vMax });
        if (!inRange(a.speed.accel_mps2, 0, aMax)) add(`${p}.speed.accel_mps2`, "{id}: gia tốc phải trong 0–{max} m/s²", { id: a.id, max: aMax });
        if (!inRange(a.start_delay_s, 0, t.map.duration_s)) add(`${p}.start_delay_s`, "{id}: thời điểm xuất phát phải nằm trong thời lượng", { id: a.id });
        if (![a.start, ...a.route].every(q => Number.isFinite(q.x_m) && Number.isFinite(q.y_m))) add(`${p}.route`, "{id}: toạ độ không hợp lệ", { id: a.id });
        if (a.route.length === 0 && Math.max(a.speed.initial_mps, a.speed.target_mps) > 0) add(`${p}.route`, "{id}: đang di chuyển nhưng chưa có điểm lộ trình", { id: a.id });
    });
    t.events.forEach((e, i) => {
        const p = `events[${i}]`;
        if (!ids.has(e.actor)) add(`${p}.actor`, "Tình huống {n}: đối tượng “{id}” không tồn tại", { n: i + 1, id: e.actor });
        else if (!eventTypesFor(t.actors.find(a => a.id === e.actor)?.kind).includes(e.type)) add(`${p}.type`, "Tình huống {n}: người đi bộ không “phanh gấp”, hãy dùng “Dừng”", { n: i + 1 });
        if (!inRange(e.at_s, 0, t.map.duration_s)) add(`${p}.at_s`, "Tình huống {n}: thời điểm phải nằm trong thời lượng", { n: i + 1 });
        for (const [key, [, , min, max]] of Object.entries(EVENT_PARAMS[e.type] ?? {}))
            if (!inRange(e.params[key], min, max)) add(`${p}.params.${key}`, "Tình huống {n}: tham số {key} phải trong {min}–{max}", { n: i + 1, key, min, max });
    });
    if (!inRange(t.expect.min_ttc_s, 0, 20)) add("expect.min_ttc_s", "TTC tối thiểu phải trong 0–20 s");
    if (!inRange(t.expect.min_gap_m, 0, 100)) add("expect.min_gap_m", "Khoảng cách tối thiểu phải trong 0–100 m");
    return out;
}

/** Dimensions for a kind, keeping the rest of the actor; used when the user switches kind. */
export function withKind(actor: TemplateActor, kind: ActorKind): TemplateActor {
    const [length_m, width_m, height_m] = KIND_SIZE[kind];
    return { ...actor, kind, length_m, width_m, height_m };
}

export const TEMPLATE_FILE_ERROR = "File không phải template topeye-scenario-template-v1";
/** Parses an uploaded template; throws with a Vietnamese message (an i18n key) when it is not this profile. */
export function parseTemplate(text: string): ScenarioTemplate {
    const value = JSON.parse(text) as Partial<ScenarioTemplate>;
    if (!value || value.profile !== TEMPLATE_PROFILE || !Array.isArray(value.actors) || !Array.isArray(value.events) || !value.map || !value.expect)
        throw new Error(TEMPLATE_FILE_ERROR);
    const map = value.map as ScenarioTemplate["map"] & { anchor?: unknown };
    const { anchor: _, ...rest } = map;
    return { ...value, map: { ...rest, placement: { ...DEFAULT_PLACEMENT, ...map.placement } } } as ScenarioTemplate;
}
