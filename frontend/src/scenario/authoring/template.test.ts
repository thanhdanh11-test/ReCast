import { describe, expect, it } from "vitest";
import { GROUPS, SCENARIO_TYPES, applyType, defaultParams, newTemplate, type Params } from "./catalog";
import { mockChoose, mockInterpret, mockReply, type ChatState } from "./mockAi";
import { TEMPLATE_PROFILE, parseTemplate, validateTemplate, type ScenarioTemplate } from "./template";

const at = (bound: "min" | "max"): ((type: typeof SCENARIO_TYPES[number]) => Params) => type =>
    Object.fromEntries(type.params.map(p => [p.key, "options" in p ? p.options.at(bound === "min" ? 0 : -1)!.value : p[bound]]));

describe("scenario catalog", () => {
    it("has 20 types across the 5 groups with unique ids", () => {
        expect(SCENARIO_TYPES).toHaveLength(20);
        expect(new Set(SCENARIO_TYPES.map(t => t.id)).size).toBe(20);
        expect(new Set(SCENARIO_TYPES.map(t => t.group))).toEqual(new Set(GROUPS.map(g => g.id)));
        expect(SCENARIO_TYPES.some(t => t.id === "emergency_stop")).toBe(true);
    });
    it.each(SCENARIO_TYPES.map(t => [t.id, t] as const))("%s builds a valid template at default, min and max params", (_, type) => {
        for (const params of [defaultParams(type), at("min")(type), at("max")(type)]) {
            const template = newTemplate(type, "scene-0061", type.name, params);
            expect(validateTemplate(template), JSON.stringify(params)).toEqual([]);
            expect(template.actors.filter(a => a.role === "ego")).toHaveLength(1);
            for (const e of template.events) expect(template.actors.map(a => a.id)).toContain(e.actor);
        }
    });
    it("rebuilds from key params and clears the customized flag", () => {
        const type = SCENARIO_TYPES.find(t => t.id === "emergency_stop")!;
        const edited = { ...newTemplate(type, "s", "x"), customized: true, name: "kept" };
        const next = applyType(edited, type, { ...edited.params, gap_m: 40 });
        expect(next.customized).toBe(false);
        expect(next.name).toBe("kept");
        expect(next.actors.find(a => a.id === "lead")!.start.x_m).toBe(44.5);
    });
});

describe("validateTemplate", () => {
    const base = () => newTemplate(SCENARIO_TYPES[0], "scene-0061", "Base");
    const messages = (t: ScenarioTemplate) => validateTemplate(t).map(i => i.message);
    it("rejects two egos, duplicate ids, missing event actors and out-of-range values", () => {
        const t = base();
        t.actors.push({ ...t.actors[0] });
        t.events[0].actor = "ghost";
        t.map.duration_s = 90;
        t.actors[1].speed.target_mps = 80;
        expect(messages(t)).toEqual(expect.arrayContaining([
            "Cần đúng một xe ego (đang có {n})", "ID “{id}” bị trùng", "Tình huống {n}: đối tượng “{id}” không tồn tại",
            "Thời lượng phải trong {min}–{max} s", "{id}: vận tốc phải trong 0–{max} m/s"]));
    });
    it("limits pedestrian speed to 4 m/s and needs a route for moving actors", () => {
        const t = newTemplate(SCENARIO_TYPES.find(x => x.id === "pedestrian_crossing")!, "s", "p");
        const ped = t.actors.find(a => a.kind === "pedestrian")!;
        ped.speed.initial_mps = 5;
        ped.route = [];
        expect(messages(t)).toEqual(expect.arrayContaining(["{id}: vận tốc phải trong 0–{max} m/s", "{id}: đang di chuyển nhưng chưa có điểm lộ trình"]));
    });
    it("rejects a hard brake on a pedestrian", () => {
        const t = newTemplate(SCENARIO_TYPES.find(x => x.id === "pedestrian_crossing")!, "s", "p");
        t.events.push({ id: "e", type: "hard_brake", actor: "ped", at_s: 2, params: { decel_mps2: 4 } });
        expect(messages(t)).toContain("Tình huống {n}: người đi bộ không “phanh gấp”, hãy dùng “Dừng”");
    });
    it("round-trips through JSON and rejects other files", () => {
        const t = base();
        expect(parseTemplate(JSON.stringify(t))).toEqual(t);
        expect(() => parseTemplate(JSON.stringify({ profile: "other" }))).toThrow("topeye-scenario-template-v1");
        expect(t.profile).toBe(TEMPLATE_PROFILE);
    });
});

describe("mock AI", () => {
    it("maps a Vietnamese prompt to a type, speeds, distance and weather", () => {
        const r = mockInterpret("Xe con cắt làn trước ego ở 60 km/h, xe kia 45 km/h, cách 10 m, trời mưa", "scene-0061", new Date(0));
        expect(r.type.id).toBe("cut_in");
        expect(r.template.params).toMatchObject({ ego_kmh: 60, cutter_kmh: 45, gap_m: 10 });
        expect(r.template.environment.weather_preset).toBe("MidRainyNoon");
        expect(r.template.provenance).toMatchObject({ mode: "ai", model: "mock-keywords" });
        expect(r.confidence).toBeGreaterThanOrEqual(0.7);
        expect(validateTemplate(r.template)).toEqual([]);
    });
    it.each([["Trẻ em lao ra từ sau xe đỗ", "pedestrian_occluded"], ["Xe phía trước phanh gấp", "emergency_stop"], ["Ego rẽ trái ở ngã tư", "left_turn_across"],
        ["Xe máy cắt ngang trước ego", "cyclist_crossing"], ["A pedestrian crossing at night", "pedestrian_crossing"]])("%s → %s", (prompt, id) => {
        expect(mockInterpret(prompt, "s").type.id).toBe(id);
    });
    it("clamps out-of-range numbers and falls back to free drive with low confidence", () => {
        const fast = mockInterpret("Xe phía trước phanh gấp, ego 300 km/h", "s");
        expect(fast.template.params.ego_kmh).toBe(130);
        expect(fast.assumptions.some(([k]) => k.includes("ngoài giới hạn"))).toBe(true);
        const vague = mockInterpret("một ngày đẹp trời", "s");
        expect(vague.type.id).toBe("free_drive");
        expect(vague.confidence).toBeLessThan(0.5);
    });
});

describe("mock AI chat", () => {
    const empty: ChatState = { result: null, prompts: [] };
    it("answers a recognised prompt with a result and open/change choices", () => {
        const r = mockReply("Xe phía trước phanh gấp, ego 60 km/h", "s", empty);
        expect(r.result?.type.id).toBe("emergency_stop");
        expect(r.choices.map(c => c.action.kind)).toEqual(["open", "types"]);
    });
    it("refines the current scenario from a follow-up without a type", () => {
        const first = mockReply("Xe cắt làn trước ego", "s", empty);
        const next = mockReply("ego 80 km/h, ban đêm", "s", { result: first.result!, prompts: ["Xe cắt làn trước ego"] });
        expect(next.result?.type.id).toBe("cut_in");
        expect(next.result?.template.params.ego_kmh).toBe(80);
        expect(next.result?.template.environment.weather_preset).toBe("ClearNight");
        expect(next.text[0]).toBe("Đã cập nhật kịch bản “{name}”.");
        expect(mockReply("cảm ơn", "s", { result: first.result!, prompts: [] }).result).toBeUndefined();
    });
    it("offers type choices when the idea is unclear, keeping stated values for the chosen type", () => {
        const r = mockReply("một tình huống 45 km/h", "s", empty);
        expect(r.result).toBeUndefined();
        expect(r.choices.every(c => c.action.kind === "type")).toBe(true);
        const chosen = mockChoose({ kind: "type", typeId: "slow_lead" }, "s", { result: null, prompts: ["một tình huống 45 km/h"] });
        expect(chosen.result?.type.id).toBe("slow_lead");
        expect(chosen.result?.template.params.ego_kmh).toBe(45);
        const others = mockChoose({ kind: "types" }, "s", { result: chosen.result!, prompts: [] });
        expect(others.choices.map(c => c.action)).not.toContainEqual({ kind: "type", typeId: "slow_lead" });
    });
});
