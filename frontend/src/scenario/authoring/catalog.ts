import type { LucideIcon } from "lucide-react";
import { ArrowLeftRight, Bike, Car, CarFront, CircleSlash, Construction, Footprints, GitMerge, Layers, MoveLeft, OctagonAlert, PersonStanding, Route, Siren, Split, TrafficCone, CornerUpLeft, Waypoints, Eye } from "lucide-react";
import { DEFAULT_PLACEMENT, KIND_SIZE, TEMPLATE_PROFILE, type ActorKind, type ScenarioTemplate, type TemplateActor, type TemplateEvent } from "./template";

/**
 * Scenario-type catalog (plan38 SPEC-P01 §2): each type is a preset that builds parts 4–7 of the template from a
 * few key params. Typology follows Euro NCAP AEB/LSS and the NHTSA pre-crash scenarios. Geometry is in the ego
 * frame along the source ego path (lane width 3.5 m, ego lane y=0, left lane y=+3.5); lane_change lateral_m is
 * positive to the actor's own left (an oncoming car encroaching on the ego lane moves to its left).
 */
export type GroupId = "following" | "lane" | "vru" | "junction" | "other";
export const GROUPS: { id: GroupId; label: string }[] = [
    { id: "following", label: "Theo sau xe trước" }, { id: "lane", label: "Chuyển làn" }, { id: "vru", label: "Người & xe hai bánh" },
    { id: "junction", label: "Giao lộ" }, { id: "other", label: "Ngược chiều & khác" },
];
/** Road drawn behind the schematic preview. */
export type Layout = "straight" | "two_lane" | "two_way" | "ramp" | "junction";

export type ParamDef =
    | { key: string; label: string; unit: string; min: number; max: number; step: number; default: number }
    | { key: string; label: string; options: { value: string; label: string }[]; default: string };
export type Params = Record<string, number | string>;
type Built = Pick<ScenarioTemplate, "actors" | "events" | "expect"> & { duration_s: number };

export interface ScenarioType {
    id: string; group: GroupId; name: string; summary: string; requires: string; layout: Layout; icon: LucideIcon;
    params: ParamDef[]; build: (p: Params) => Built;
}

const LANE = 3.5;
const ms = (kmh: number) => kmh / 3.6;
const round = (v: number) => Math.round(v * 100) / 100;
const clampDuration = (s: number) => Math.min(60, Math.max(2, Math.ceil(s)));
const n = (p: Params, key: string) => Number(p[key]);
function actor(id: string, kind: ActorKind, start: [number, number, number], route: [number, number][], speed: [number, number, number], role: "ego" | "traffic" = "traffic", delay = 0): TemplateActor {
    const [length_m, width_m, height_m] = KIND_SIZE[kind];
    return {
        id, role, kind, length_m, width_m, height_m, start_delay_s: delay,
        start: { x_m: round(start[0]), y_m: round(start[1]), yaw_deg: start[2] },
        // Routes only set direction past their end (the compiler extends the last segment); keep them in ±480 m.
        route: route.map(([x, y]) => ({ x_m: round(Math.max(-480, Math.min(480, x))), y_m: round(y) })),
        speed: { initial_mps: round(speed[0]), target_mps: round(speed[1]), accel_mps2: speed[2] },
    };
}
/** Ego driving straight in its lane for the whole scenario at constant speed. */
const ego = (kmh: number, duration: number, route?: [number, number][]) =>
    actor("ego", "car", [0, 0, 0], route ?? [[ms(kmh) * duration + 10, 0]], [ms(kmh), ms(kmh), 0], "ego");
const event = (id: string, type: TemplateEvent["type"], actorId: string, at_s: number, params: Record<string, number>): TemplateEvent => ({ id, type, actor: actorId, at_s: round(at_s), params });
const speed = (key: string, label: string, def: number, min = 5, max = 130): ParamDef => ({ key, label, unit: "km/h", min, max, step: 5, default: def });
const dist = (key: string, label: string, def: number, min: number, max: number): ParamDef => ({ key, label, unit: "m", min, max, step: 1, default: def });
const time = (key: string, label: string, def: number, min = 0.5, max = 20): ParamDef => ({ key, label, unit: "s", min, max, step: 0.5, default: def });
const expectSafe = (min_ttc_s = 1.5, min_gap_m = 2) => ({ min_ttc_s, min_gap_m, no_contact: true });

/** Pedestrian/cyclist crossing from the curb so that, if ego keeps its speed, it reaches the impact point together. */
function crossing(p: Params, kind: ActorKind, vKey: string, ego_kmh: number, at: number, impactPct: number, curb = 5) {
    const side = p.side === "left" ? 1 : -1;
    const v = ms(n(p, vKey));
    const egoHalf = KIND_SIZE.car[1] / 2;
    const impactY = side * (egoHalf - (impactPct / 100) * KIND_SIZE.car[1]);
    const travel = Math.abs(side * curb - impactY);
    const meet = at + travel / v;
    const x = ms(ego_kmh) * meet + KIND_SIZE.car[0] / 2;
    const duration = clampDuration(meet + 3);
    const yaw = side > 0 ? -90 : 90;
    return { x, duration, walker: actor(kind === "pedestrian" ? "ped" : "rider", kind, [x, side * curb, yaw], [[x, -side * curb]], [v, v, 0], "traffic", at) };
}

export const SCENARIO_TYPES: ScenarioType[] = [
    {
        id: "emergency_stop", group: "following", name: "Dừng khẩn cấp", summary: "Xe phía trước phanh gấp, ego phải dừng kịp.", requires: "Đường thẳng", layout: "straight", icon: Siren,
        params: [speed("ego_kmh", "Vận tốc ego", 50), speed("lead_kmh", "Vận tốc xe trước", 50), dist("gap_m", "Khoảng cách ban đầu", 20, 5, 80),
            { key: "decel_mps2", label: "Giảm tốc xe trước", unit: "m/s²", min: 2, max: 10, step: 0.5, default: 6 }, time("brake_at_s", "Thời điểm phanh", 4)],
        build: p => {
            const d = clampDuration(n(p, "brake_at_s") + 8), lead = ms(n(p, "lead_kmh")), gap = n(p, "gap_m") + KIND_SIZE.car[0];
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("lead", "car", [gap, 0, 0], [[gap + lead * d + 10, 0]], [lead, lead, 0])],
                events: [event("brake", "hard_brake", "lead", n(p, "brake_at_s"), { decel_mps2: n(p, "decel_mps2") })], expect: expectSafe() };
        },
    },
    {
        id: "stationary_lead", group: "following", name: "Xe đứng yên giữa làn", summary: "Ego tiếp cận một xe đang dừng trong làn.", requires: "Đường thẳng", layout: "straight", icon: CircleSlash,
        params: [speed("ego_kmh", "Vận tốc ego", 50), dist("gap_m", "Khoảng cách ban đầu", 60, 10, 150)],
        build: p => {
            const v = ms(n(p, "ego_kmh")), d = clampDuration(n(p, "gap_m") / v + 4);
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("stopped", "car", [n(p, "gap_m") + KIND_SIZE.car[0], 0, 0], [], [0, 0, 0])], events: [], expect: expectSafe() };
        },
    },
    {
        id: "slow_lead", group: "following", name: "Tiếp cận xe chạy chậm", summary: "Xe trước chạy chậm hơn ego cùng làn.", requires: "Đường thẳng", layout: "straight", icon: CarFront,
        params: [speed("ego_kmh", "Vận tốc ego", 60), speed("lead_kmh", "Vận tốc xe trước", 20), dist("gap_m", "Khoảng cách ban đầu", 40, 10, 120)],
        build: p => {
            const lead = ms(n(p, "lead_kmh")), rel = Math.max(0.5, ms(n(p, "ego_kmh")) - lead), d = clampDuration(n(p, "gap_m") / rel + 3), x = n(p, "gap_m") + KIND_SIZE.car[0];
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("lead", "car", [x, 0, 0], [[x + lead * d + 10, 0]], [lead, lead, 0])], events: [], expect: expectSafe() };
        },
    },
    {
        id: "stop_and_go", group: "following", name: "Dừng – đi khi ùn tắc", summary: "Xe trước liên tục dừng rồi chạy lại (ACC/ùn tắc).", requires: "Đường thẳng", layout: "straight", icon: TrafficCone,
        params: [{ key: "cycles", label: "Số lần dừng", unit: "lần", min: 1, max: 3, step: 1, default: 2 }, speed("max_kmh", "Vận tốc tối đa", 30, 10, 60), time("stop_s", "Thời gian dừng", 3, 1, 8)],
        build: p => {
            const v = ms(n(p, "max_kmh")), cycles = n(p, "cycles"), period = 4 + n(p, "stop_s") + 3, d = clampDuration(cycles * period + 4);
            const events = Array.from({ length: cycles }, (_, i) => [event(`stop${i + 1}`, "stop", "lead", 3 + i * period, { decel_mps2: 3 }),
                event(`go${i + 1}`, "accelerate", "lead", 3 + i * period + 3 + n(p, "stop_s"), { target_mps: round(v), accel_mps2: 2 })]).flat();
            return { duration_s: d, actors: [ego(n(p, "max_kmh"), d), actor("lead", "car", [15, 0, 0], [[15 + v * d + 10, 0]], [v, v, 0])], events, expect: expectSafe(2, 2) };
        },
    },
    {
        id: "queue_tail", group: "following", name: "Tiếp cận đuôi hàng xe", summary: "Một hàng xe đứng yên phía trước, ego phải dừng sau xe cuối.", requires: "Đường thẳng", layout: "straight", icon: Layers,
        params: [{ key: "vehicles", label: "Số xe trong hàng", unit: "xe", min: 1, max: 6, step: 1, default: 3 }, speed("ego_kmh", "Vận tốc ego", 50), dist("gap_m", "Khoảng cách tới đuôi hàng", 60, 15, 150)],
        build: p => {
            const v = ms(n(p, "ego_kmh")), d = clampDuration(n(p, "gap_m") / v + 4), x0 = n(p, "gap_m") + KIND_SIZE.car[0];
            const queue = Array.from({ length: n(p, "vehicles") }, (_, i) => actor(`queue${i + 1}`, "car", [x0 + i * 7, 0, 0], [], [0, 0, 0]));
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), ...queue], events: [], expect: expectSafe() };
        },
    },
    {
        id: "cut_in", group: "lane", name: "Xe cắt làn", summary: "Xe ở làn bên cắt vào ngay trước ego.", requires: "≥ 2 làn cùng chiều", layout: "two_lane", icon: ArrowLeftRight,
        params: [speed("ego_kmh", "Vận tốc ego", 60), speed("cutter_kmh", "Vận tốc xe cắt làn", 50), dist("gap_m", "Khoảng cách khi cắt", 12, 3, 40),
            time("lc_s", "Thời gian chuyển làn", 2, 1, 5), time("at_s", "Thời điểm cắt làn", 3)],
        build: p => {
            const ve = ms(n(p, "ego_kmh")), vc = ms(n(p, "cutter_kmh")), at = n(p, "at_s"), d = clampDuration(at + n(p, "lc_s") + 6);
            const x = ve * at + n(p, "gap_m") + KIND_SIZE.car[0] - vc * at;
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("cutter", "car", [x, LANE, 0], [[x + vc * d + 10, LANE]], [vc, vc, 0])],
                events: [event("cut", "lane_change", "cutter", at, { lateral_m: -LANE, duration_s: n(p, "lc_s") })], expect: expectSafe(1.2, 2) };
        },
    },
    {
        id: "cut_out", group: "lane", name: "Xe trước tách làn", summary: "Xe trước đổi làn, để lộ vật cản đứng yên trước ego.", requires: "≥ 2 làn cùng chiều", layout: "two_lane", icon: Split,
        params: [speed("ego_kmh", "Vận tốc ego", 50), dist("obstacle_m", "Vị trí vật cản", 70, 30, 150), time("at_s", "Thời điểm tách làn", 3)],
        build: p => {
            const v = ms(n(p, "ego_kmh")), d = clampDuration(Math.max(n(p, "obstacle_m") / v, n(p, "at_s")) + 4), lead = 20 + KIND_SIZE.car[0];
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("lead", "car", [lead, 0, 0], [[lead + v * d + 10, 0]], [v, v, 0]),
                actor("obstacle", "car", [n(p, "obstacle_m"), 0, 0], [], [0, 0, 0])],
                events: [event("out", "lane_change", "lead", n(p, "at_s"), { lateral_m: LANE, duration_s: 2 })], expect: expectSafe() };
        },
    },
    {
        id: "ego_lane_change_blind_spot", group: "lane", name: "Đổi làn khi có xe ở điểm mù", summary: "Ego chuyển làn trong khi có xe đang tới ở làn bên.", requires: "≥ 2 làn cùng chiều", layout: "two_lane", icon: Eye,
        params: [speed("ego_kmh", "Vận tốc ego", 60), speed("rear_kmh", "Vận tốc xe làn bên", 75), dist("rear_m", "Xe làn bên ở phía sau", 6, 0, 40), time("at_s", "Thời điểm ego đổi làn", 2)],
        build: p => {
            const vr = ms(n(p, "rear_kmh")), d = clampDuration(n(p, "at_s") + 8);
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("rear", "car", [-n(p, "rear_m"), LANE, 0], [[-n(p, "rear_m") + vr * d + 10, LANE]], [vr, vr, 0])],
                events: [event("ego_lc", "lane_change", "ego", n(p, "at_s"), { lateral_m: LANE, duration_s: 2.5 })], expect: expectSafe(1.5, 1) };
        },
    },
    {
        id: "merge", group: "lane", name: "Nhập làn", summary: "Ego từ làn nhập chen vào dòng xe chính.", requires: "Làn nhập / đường nhánh", layout: "ramp", icon: GitMerge,
        params: [speed("ego_kmh", "Vận tốc ego", 50), speed("main_kmh", "Vận tốc dòng chính", 60), dist("gap_m", "Khe trống giữa hai xe", 25, 8, 60)],
        build: p => {
            const vm = ms(n(p, "main_kmh")), d = clampDuration(10), xm = n(p, "gap_m") / 2;
            const route: [number, number][] = [[30, -LANE], [55, 0], [ms(n(p, "ego_kmh")) * d + 30, 0]];
            return { duration_s: d, actors: [actor("ego", "car", [0, -LANE, 0], route, [ms(n(p, "ego_kmh")), ms(n(p, "ego_kmh")), 0], "ego"),
                actor("main1", "car", [xm, 0, 0], [[xm + vm * d + 10, 0]], [vm, vm, 0]), actor("main2", "car", [-xm, 0, 0], [[-xm + vm * d + 10, 0]], [vm, vm, 0])],
                events: [], expect: expectSafe(1.5, 2) };
        },
    },
    {
        id: "pedestrian_crossing", group: "vru", name: "Người đi bộ băng qua", summary: "Người đi bộ băng qua đường trước ego.", requires: "Vạch qua đường", layout: "straight", icon: Footprints,
        params: [speed("ego_kmh", "Vận tốc ego", 40, 10, 80), { key: "ped_kmh", label: "Vận tốc người đi bộ", unit: "km/h", min: 2, max: 14, step: 1, default: 5 },
            { key: "side", label: "Xuất phát từ", options: [{ value: "right", label: "Bên phải" }, { value: "left", label: "Bên trái" }], default: "right" },
            { key: "impact_pct", label: "Điểm va chạm trên đầu xe", unit: "%", min: 25, max: 75, step: 25, default: 50 }, time("at_s", "Thời điểm bước xuống", 2)],
        build: p => {
            const c = crossing(p, "pedestrian", "ped_kmh", n(p, "ego_kmh"), n(p, "at_s"), n(p, "impact_pct"));
            return { duration_s: c.duration, actors: [ego(n(p, "ego_kmh"), c.duration), c.walker], events: [], expect: expectSafe(1.5, 1) };
        },
    },
    {
        id: "pedestrian_occluded", group: "vru", name: "Trẻ em lao ra sau xe đỗ", summary: "Trẻ em chạy ra từ sau xe đỗ ven đường, bị che tầm nhìn.", requires: "Lề đường", layout: "straight", icon: PersonStanding,
        params: [speed("ego_kmh", "Vận tốc ego", 30, 10, 60), { key: "ped_kmh", label: "Vận tốc trẻ em", unit: "km/h", min: 3, max: 14, step: 1, default: 8 }, time("at_s", "Thời điểm lao ra", 2)],
        build: p => {
            const c = crossing({ ...p, side: "right", impact_pct: 50 }, "pedestrian", "ped_kmh", n(p, "ego_kmh"), n(p, "at_s"), 50, 3);
            const child = { ...c.walker, id: "child", length_m: 0.4, width_m: 0.4, height_m: 1.2 };
            return { duration_s: c.duration, actors: [ego(n(p, "ego_kmh"), c.duration), child, actor("parked", "car", [c.x - 4, -LANE + 0.3, 0], [], [0, 0, 0])], events: [], expect: expectSafe(1.5, 1) };
        },
    },
    {
        id: "pedestrian_along", group: "vru", name: "Người đi dọc mép đường", summary: "Người đi bộ đi cùng chiều sát mép làn của ego.", requires: "Lề đường", layout: "straight", icon: MoveLeft,
        params: [speed("ego_kmh", "Vận tốc ego", 50, 10, 80), { key: "ped_kmh", label: "Vận tốc người đi bộ", unit: "km/h", min: 2, max: 14, step: 1, default: 5 },
            dist("ahead_m", "Ở phía trước ego", 50, 15, 120), { key: "offset_m", label: "Lệch ngang so với tim làn", unit: "m", min: 1, max: 3, step: 0.25, default: 1.75 }],
        build: p => {
            const v = ms(n(p, "ped_kmh")), d = clampDuration(n(p, "ahead_m") / Math.max(1, ms(n(p, "ego_kmh")) - v) + 3), y = -n(p, "offset_m");
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("ped", "pedestrian", [n(p, "ahead_m"), y, 0], [[n(p, "ahead_m") + v * d + 1, y]], [v, v, 0])], events: [], expect: expectSafe(2, 1) };
        },
    },
    {
        id: "cyclist_crossing", group: "vru", name: "Xe hai bánh băng ngang", summary: "Xe đạp hoặc xe máy cắt ngang trước ego.", requires: "Điểm giao cắt", layout: "straight", icon: Bike,
        params: [{ key: "kind", label: "Loại xe", options: [{ value: "bicycle", label: "Xe đạp" }, { value: "motorcycle", label: "Xe máy" }], default: "bicycle" },
            speed("ego_kmh", "Vận tốc ego", 40, 10, 80), speed("rider_kmh", "Vận tốc xe hai bánh", 15, 5, 50),
            { key: "side", label: "Xuất phát từ", options: [{ value: "right", label: "Bên phải" }, { value: "left", label: "Bên trái" }], default: "right" }, time("at_s", "Thời điểm xuất phát", 2)],
        build: p => {
            const kind = p.kind === "motorcycle" ? "motorcycle" : "bicycle";
            const c = crossing(p, kind, "rider_kmh", n(p, "ego_kmh"), n(p, "at_s"), 50, 8);
            return { duration_s: c.duration, actors: [ego(n(p, "ego_kmh"), c.duration), c.walker], events: [], expect: expectSafe(1.5, 1) };
        },
    },
    {
        id: "cyclist_along", group: "vru", name: "Xe đạp đi cùng chiều", summary: "Ego vượt một xe đạp đi phía trước trong cùng làn.", requires: "Đường thẳng", layout: "straight", icon: Bike,
        params: [speed("ego_kmh", "Vận tốc ego", 50, 10, 80), speed("rider_kmh", "Vận tốc xe đạp", 15, 5, 35), dist("ahead_m", "Ở phía trước ego", 30, 10, 100),
            { key: "offset_m", label: "Lệch ngang so với tim làn", unit: "m", min: 0, max: 1.5, step: 0.25, default: 1 }],
        build: p => {
            const v = ms(n(p, "rider_kmh")), d = clampDuration(n(p, "ahead_m") / Math.max(1, ms(n(p, "ego_kmh")) - v) + 4), y = -n(p, "offset_m");
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("cyclist", "bicycle", [n(p, "ahead_m"), y, 0], [[n(p, "ahead_m") + v * d + 5, y]], [v, v, 0])], events: [], expect: expectSafe(2, 1.5) };
        },
    },
    {
        id: "left_turn_across", group: "junction", name: "Rẽ trái cắt hướng xe ngược chiều", summary: "Ego rẽ trái tại giao lộ khi xe ngược chiều đang tới.", requires: "Giao lộ", layout: "junction", icon: CornerUpLeft,
        params: [speed("ego_kmh", "Vận tốc ego khi rẽ", 25, 10, 40), speed("oncoming_kmh", "Vận tốc xe ngược chiều", 50, 20, 80), dist("oncoming_m", "Xe ngược chiều cách giao lộ", 60, 20, 120)],
        build: p => {
            const vo = ms(n(p, "oncoming_kmh")), d = clampDuration(10), start = 30 + n(p, "oncoming_m");
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d, [[22, 0], [30, LANE / 2], [33, 10], [33, 40]]),
                actor("oncoming", "car", [start, LANE, 180], [[start - vo * d - 10, LANE]], [vo, vo, 0])], events: [], expect: expectSafe(1.5, 2) };
        },
    },
    {
        id: "crossing_path", group: "junction", name: "Xe cắt ngang giao lộ", summary: "Một xe đi đường ngang băng qua giao lộ trước ego.", requires: "Giao lộ", layout: "junction", icon: Waypoints,
        params: [speed("ego_kmh", "Vận tốc ego", 40, 10, 80), speed("cross_kmh", "Vận tốc xe cắt ngang", 40, 10, 80),
            { key: "side", label: "Xe tới từ", options: [{ value: "right", label: "Bên phải" }, { value: "left", label: "Bên trái" }], default: "right" }],
        build: p => {
            const ve = ms(n(p, "ego_kmh")), vc = ms(n(p, "cross_kmh")), side = p.side === "left" ? 1 : -1, meet = 33 / ve, y0 = side * vc * meet, d = clampDuration(meet + 5);
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("crosser", "car", [33, y0, side > 0 ? -90 : 90], [[33, y0 - side * (vc * d + 10)]], [vc, vc, 0])], events: [], expect: expectSafe(1.5, 2) };
        },
    },
    {
        id: "red_light_runner", group: "junction", name: "Xe vượt đèn đỏ", summary: "Ego đi đèn xanh, xe đường ngang vượt đèn đỏ tốc độ cao.", requires: "Giao lộ có đèn", layout: "junction", icon: OctagonAlert,
        params: [speed("ego_kmh", "Vận tốc ego", 40, 10, 80), speed("runner_kmh", "Vận tốc xe vượt đèn", 60, 20, 100)],
        build: p => {
            const ve = ms(n(p, "ego_kmh")), vr = ms(n(p, "runner_kmh")), meet = 33 / ve, y0 = -vr * meet, d = clampDuration(meet + 5);
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("runner", "car", [33, y0, 90], [[33, y0 + vr * d + 10]], [vr, vr, 0])], events: [], expect: expectSafe(1.5, 2) };
        },
    },
    {
        id: "oncoming_encroach", group: "other", name: "Xe ngược chiều lấn làn", summary: "Xe ngược chiều lấn sang làn của ego.", requires: "Đường hai chiều", layout: "two_way", icon: Route,
        params: [speed("ego_kmh", "Vận tốc ego", 60), speed("oncoming_kmh", "Vận tốc xe ngược chiều", 60), { key: "encroach_m", label: "Mức lấn làn", unit: "m", min: 0.5, max: 3.5, step: 0.25, default: 1.5 }, time("at_s", "Thời điểm lấn làn", 2)],
        build: p => {
            const vo = ms(n(p, "oncoming_kmh")), d = clampDuration(n(p, "at_s") + 6), start = (ms(n(p, "ego_kmh")) + vo) * (n(p, "at_s") + 3);
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("oncoming", "car", [start, LANE, 180], [[start - vo * d - 10, LANE]], [vo, vo, 0])],
                events: [event("encroach", "lane_change", "oncoming", n(p, "at_s"), { lateral_m: n(p, "encroach_m"), duration_s: 1.5 })], expect: expectSafe(1.5, 1) };
        },
    },
    {
        id: "obstacle_avoid", group: "other", name: "Tránh vật cản trên làn", summary: "Xe hỏng/vật cản trên làn, ego chuyển làn để tránh.", requires: "≥ 2 làn cùng chiều", layout: "two_lane", icon: Construction,
        params: [speed("ego_kmh", "Vận tốc ego", 50), dist("obstacle_m", "Vị trí vật cản", 50, 20, 120),
            { key: "kind", label: "Vật cản", options: [{ value: "car", label: "Xe con hỏng" }, { value: "truck", label: "Xe tải dừng" }], default: "car" }],
        build: p => {
            const v = ms(n(p, "ego_kmh")), x = n(p, "obstacle_m"), d = clampDuration(x / v + 4), kind = p.kind === "truck" ? "truck" : "car";
            return { duration_s: d, actors: [ego(n(p, "ego_kmh"), d), actor("obstacle", kind, [x, 0, 0], [], [0, 0, 0])],
                events: [event("avoid", "lane_change", "ego", Math.max(0.5, round((x - 25) / v)), { lateral_m: LANE, duration_s: 2.5 })], expect: expectSafe(1.5, 1) };
        },
    },
    {
        id: "free_drive", group: "other", name: "Tự do / tuỳ chỉnh", summary: "Chỉ có ego; tự thêm đối tượng và tình huống.", requires: "Bất kỳ", layout: "straight", icon: Car,
        params: [speed("ego_kmh", "Vận tốc ego", 40), time("duration_s", "Thời lượng", 10, 2, 60)],
        build: p => ({ duration_s: clampDuration(n(p, "duration_s")), actors: [ego(n(p, "ego_kmh"), n(p, "duration_s"))], events: [], expect: expectSafe() }),
    },
];
export const TYPE_BY_ID = new Map(SCENARIO_TYPES.map(type => [type.id, type]));

export const defaultParams = (type: ScenarioType): Params => Object.fromEntries(type.params.map(p => [p.key, p.default]));

/**
 * Rebuilds the preset part of 4–7 from key params, keeping everything else the user set (name, map, weather…) and the
 * objects/events the user added themselves (`manual`); hand edits to preset objects are what gets overwritten.
 */
export function applyType(base: ScenarioTemplate, type: ScenarioType, params: Params): ScenarioTemplate {
    const built = type.build(params);
    const actors = [...built.actors, ...base.actors.filter(a => a.manual && !built.actors.some(b => b.id === a.id))];
    const events = [...built.events, ...base.events.filter(e => e.manual && actors.some(a => a.id === e.actor) && !built.events.some(b => b.id === e.id))];
    return { ...base, scenario_type: type.id, params, customized: false, actors, events, expect: built.expect, map: { ...base.map, duration_s: built.duration_s } };
}

export function newTemplate(type: ScenarioType, scene: string, name: string, params: Params = defaultParams(type)): ScenarioTemplate {
    const base: ScenarioTemplate = {
        profile: TEMPLATE_PROFILE, name, description: type.summary, tags: [type.group],
        scenario_type: type.id, params, customized: false,
        map: { scene, placement: { ...DEFAULT_PLACEMENT }, duration_s: 10, sample_hz: 10, ego_react: true },
        environment: { weather_preset: "ClearNoon" },
        actors: [], events: [], expect: expectSafe(),
        provenance: { mode: "template", created_at: new Date().toISOString() },
    };
    return applyType(base, type, params);
}
