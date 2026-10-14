import type { WeatherPresetId } from "../weather";
import { SCENARIO_TYPES, TYPE_BY_ID, defaultParams, newTemplate, type Params, type ScenarioType } from "./catalog";
import type { ScenarioTemplate } from "./template";

/**
 * MOCK generator for the AI tab (plan38 P01). Keyword rules only — no model, no network. P03 replaces this with a
 * server-side LLM constrained to the same template schema; the UI contract (`AiResult`) stays the same.
 */
export const MOCK_MODEL = "mock-keywords";

export interface AiResult {
    template: ScenarioTemplate;
    type: ScenarioType;
    confidence: number;
    /** Each entry is [Vietnamese key, vars] so the UI can translate it. */
    understood: [string, Record<string, string | number>][];
    assumptions: [string, Record<string, string | number>][];
}

/** Example prompts shown as chips in the AI tab. */
export const SUGGESTIONS = [
    "Xe con cắt làn trước ego ở 60 km/h, cách 10 m",
    "Xe phía trước phanh gấp khi cả hai chạy 50 km/h, cách 20 m",
    "Người đi bộ băng qua đường từ bên phải, ego chạy 40 km/h, trời mưa",
    "Trẻ em lao ra từ sau xe đỗ ven đường vào ban đêm",
    "Ego rẽ trái ở ngã tư, xe ngược chiều tới 50 km/h",
    "Xe máy cắt ngang trước ego ở giao lộ",
];

/** First match wins, so specific phrases come before generic ones. */
const RULES: [RegExp, string][] = [
    [/trẻ em|em bé|khuất|che khuất|child|occlu/i, "pedestrian_occluded"],
    [/đèn đỏ|red light/i, "red_light_runner"],
    [/rẽ trái|left turn/i, "left_turn_across"],
    [/điểm mù|blind spot/i, "ego_lane_change_blind_spot"],
    [/tách làn|cut[- ]?out/i, "cut_out"],
    [/cắt làn|chen làn|cut[- ]?in/i, "cut_in"],
    [/nhập làn|hợp làn|merge/i, "merge"],
    [/ngược chiều|lấn làn|oncoming|head[- ]?on/i, "oncoming_encroach"],
    [/(xe đạp|xe máy|bicycle|cyclist|motorbike|motorcycle).*(băng|cắt ngang|cross)|(băng|cắt ngang|cross).*(xe đạp|xe máy|bicycle|cyclist|motorbike)/i, "cyclist_crossing"],
    [/xe đạp|cyclist|bicycle/i, "cyclist_along"],
    [/người đi bộ.*(dọc|mép)|walk(ing)? along/i, "pedestrian_along"],
    [/người đi bộ|băng qua|pedestrian|crosswalk/i, "pedestrian_crossing"],
    [/giao lộ|ngã tư|cắt ngang|intersection|junction/i, "crossing_path"],
    [/ùn tắc|dừng[- ]đi|stop[- ]and[- ]go|kẹt xe/i, "stop_and_go"],
    [/hàng xe|đuôi|queue/i, "queue_tail"],
    [/vật cản|xe hỏng|obstacle|tránh/i, "obstacle_avoid"],
    [/đứng yên|đang dừng|stationary|stopped/i, "stationary_lead"],
    [/chạy chậm|xe chậm|slow/i, "slow_lead"],
    [/phanh|dừng khẩn|khẩn cấp|brake|emergency/i, "emergency_stop"],
];
const WEATHER: [RegExp, WeatherPresetId, string][] = [
    [/mưa to|mưa lớn|heavy rain/i, "HardRainNoon", "Mưa to"],
    [/mưa|rain/i, "MidRainyNoon", "Mưa"],
    [/đêm|tối|night/i, "ClearNight", "Ban đêm"],
    [/hoàng hôn|chiều tối|sunset|dusk/i, "ClearSunset", "Hoàng hôn"],
    [/bão bụi|dust/i, "DustStorm", "Bão bụi"],
    [/nhiều mây|âm u|cloud/i, "CloudyNoon", "Nhiều mây"],
];
const NIGHT_RAIN: WeatherPresetId = "HardRainNight";

const numbers = (text: string, unit: RegExp) => [...text.matchAll(new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*(?:${unit.source})`, "gi"))].map(m => Number(m[1].replace(",", ".")));

/** Scenario type named by the text, or undefined. */
export const detectType = (text: string) => RULES.find(([re]) => re.test(text))?.[1];

interface Basis { type: ScenarioType; params: Params; weather?: WeatherPresetId; prompts: string[] }

/** Fills params/weather of `basis.type` from the numbers, options and weather words in `text`. */
function interpret(text: string, scene: string, basis: Basis, now: Date, recognised: boolean): AiResult & { filled: number } {
    const { type } = basis;
    const params: Params = { ...basis.params };
    const understood: AiResult["understood"] = [];
    const assumptions: AiResult["assumptions"] = [];
    let filled = 0;
    // Speeds in order of appearance: ego first, then the other road user; distances and times fill the first slot of each unit.
    const fill = (unitKey: string, values: number[]) => {
        const slots = type.params.filter(p => "unit" in p && p.unit === unitKey);
        values.slice(0, slots.length).forEach((v, i) => {
            const slot = slots[i] as Extract<typeof slots[number], { unit: string }>;
            const value = Math.min(slot.max, Math.max(slot.min, v));
            params[slot.key] = value;
            filled++;
            understood.push(["{label}: {value} {unit}", { label: slot.label, value, unit: slot.unit }]);
            if (value !== v) assumptions.push(["{label} {value} {unit} ngoài giới hạn, đã đưa về {clamped}", { label: slot.label, value: v, unit: slot.unit, clamped: value }]);
        });
    };
    fill("km/h", numbers(text, /km\/h|kmh|km/));
    fill("m", numbers(text, /m(?![\/a-zà-ỹ])|mét/));
    fill("s", numbers(text, /giây|s\b|sec/));
    for (const p of type.params) if ("options" in p) {
        const hit = p.options.find(o => text.toLowerCase().includes(o.label.toLowerCase()));
        if (hit) { params[p.key] = hit.value; understood.push(["{label}: {value}", { label: p.label, value: hit.label }]); filled++; }
    }
    const prompts = [...basis.prompts, text];
    const template = newTemplate(type, scene, prompts[0].length > 60 ? `${prompts[0].slice(0, 57)}…` : prompts[0] || type.name, params);
    template.environment.weather_preset = basis.weather ?? template.environment.weather_preset;
    const weather = WEATHER.filter(([re]) => re.test(text));
    if (weather.length) {
        const rainy = weather.some(([, id]) => id.includes("Rain")), night = weather.some(([, id]) => id.includes("Night"));
        template.environment.weather_preset = rainy && night ? NIGHT_RAIN : weather[0][1];
        understood.push(["Thời tiết: {value}", { value: weather.map(([, , label]) => label).join(", ") }]);
        filled++;
    }
    template.description = prompts.join("\n");
    template.tags = [...template.tags, "ai"];
    template.provenance = { mode: "ai", prompt: prompts.join("\n"), model: MOCK_MODEL, created_at: now.toISOString() };
    const confidence = recognised ? Math.min(0.95, 0.7 + 0.05 * filled) : 0.3;
    return { template, type, confidence, understood, assumptions, filled };
}

/** One-shot interpretation of a prompt (first chat turn). */
export function mockInterpret(prompt: string, scene: string, now = new Date(), forced?: ScenarioType): AiResult {
    const text = prompt.trim();
    const typeId = detectType(text);
    const type = forced ?? TYPE_BY_ID.get(typeId ?? "") ?? SCENARIO_TYPES.find(t => t.id === "free_drive")!;
    const { filled: _, ...result } = interpret(text, scene, { type, params: defaultParams(type), prompts: [] }, now, Boolean(forced || typeId));
    result.understood.unshift(["Loại kịch bản: {name}", { name: type.name }]);
    for (const p of type.params) if (!result.understood.some(([, v]) => v.label === p.label)) result.assumptions.push(["Dùng mặc định cho {label}", { label: p.label }]);
    if (!forced && !typeId) result.assumptions.unshift(["Không nhận ra loại tình huống; dùng kịch bản tự do", {}]);
    result.assumptions.push(["Đặt từ đầu quỹ đạo xe ego nguồn; chỉnh ở phần Map & thời lượng", {}]);
    return result;
}

/** A reply in the AI chat: text plus optional scenario result and clickable choices. */
export type ChatAction = { kind: "open" } | { kind: "types" } | { kind: "type"; typeId: string } | { kind: "prompt"; text: string };
export interface ChatChoice { label: string; vars?: Record<string, string>; action: ChatAction }
export interface AiReply { text: [string, Record<string, string | number>]; result?: AiResult; choices: ChatChoice[] }
export interface ChatState { result: AiResult | null; prompts: string[] }

const POPULAR = ["emergency_stop", "cut_in", "pedestrian_crossing", "left_turn_across", "stop_and_go", "obstacle_avoid"];
const typeChoice = (id: string): ChatChoice => ({ label: TYPE_BY_ID.get(id)!.name, action: { kind: "type", typeId: id } });
const resultChoices: ChatChoice[] = [{ label: "Mở trong template để chỉnh", action: { kind: "open" } }, { label: "Chọn loại khác", action: { kind: "types" } }];

/**
 * Mock chat turn. A message naming a scenario type starts over; otherwise it refines the current scenario; with no
 * current scenario and no recognised type the assistant asks the user to pick a type.
 */
export function mockReply(message: string, scene: string, state: ChatState, now = new Date()): AiReply {
    const text = message.trim();
    const typeId = detectType(text);
    if (typeId) {
        const result = mockInterpret(text, scene, now);
        return { text: ["Mình hiểu đây là kịch bản “{name}”. Mình đã điền các thông số bên dưới; bạn có thể nhắn thêm để chỉnh (ví dụ “ego 60 km/h”, “trời mưa”).", { name: result.type.name }], result, choices: resultChoices };
    }
    if (state.result) {
        const { filled, ...result } = interpret(text, scene, { type: state.result.type, params: state.result.template.params, weather: state.result.template.environment.weather_preset, prompts: state.prompts }, now, true);
        if (!filled) return { text: ["Mình chưa thấy thông số nào mới. Bạn có thể nói ví dụ “ego 60 km/h”, “cách 15 m”, “phanh lúc 3 giây” hoặc “ban đêm”.", {}], choices: resultChoices };
        result.confidence = state.result.confidence;
        return { text: ["Đã cập nhật kịch bản “{name}”.", { name: result.type.name }], result, choices: resultChoices };
    }
    return { text: ["Mình chưa nhận ra tình huống bạn muốn. Bạn chọn một loại dưới đây, hoặc mô tả rõ hơn (ai làm gì, tốc độ, khoảng cách).", {}], choices: POPULAR.map(typeChoice) };
}

/** Reply to a clicked choice that needs the assistant (picking a type, listing types). */
export function mockChoose(action: Exclude<ChatAction, { kind: "open" } | { kind: "prompt" }>, scene: string, state: ChatState, now = new Date()): AiReply {
    if (action.kind === "types") {
        const current = state.result?.type;
        const ids = [...SCENARIO_TYPES.filter(t => t.group === current?.group && t.id !== current?.id).map(t => t.id), ...POPULAR.filter(id => id !== current?.id)];
        return { text: ["Bạn muốn loại kịch bản nào?", {}], choices: [...new Set(ids)].slice(0, 8).map(typeChoice) };
    }
    const type = TYPE_BY_ID.get(action.typeId)!;
    const result = mockInterpret(state.prompts.join("\n"), scene, now, type);
    return { text: ["Đã chọn “{name}”. Mình giữ lại các thông số bạn đã nêu, phần còn lại dùng mặc định.", { name: type.name }], result, choices: resultChoices };
}

/** Async like the real P03 call, so the chat shows the typing state. */
export function delayed<T>(value: () => T, delayMs = 700): Promise<T> {
    return new Promise(resolve => setTimeout(() => resolve(value()), delayMs));
}
