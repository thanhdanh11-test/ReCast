import type { ReactNode } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useT } from "../i18n";
import { CARLA_WEATHER_VALUES, type WeatherPresetId } from "../weather";
import { applyType, defaultParams, type ScenarioType } from "./catalog";
import { ACTOR_KINDS, EVENT_LABEL, EVENT_PARAMS, KIND_LABEL, eventTypesFor, LIMITS, withKind, type EventType, type ScenarioTemplate, type TemplateActor, type TemplateEvent } from "./template";

type Setter = (next: ScenarioTemplate) => void;

function Num({ label, unit, value, min, max, step = 0.1, onChange }: { label: string; unit?: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void }) {
    return <label className="field authoring-num"><span>{label}{unit && <em>{unit}</em>}</span>
        <input type="number" aria-label={label} value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step} onChange={e => onChange(e.target.value === "" ? NaN : Number(e.target.value))}/></label>;
}

function Section({ n, title, children, open = false, note }: { n: number; title: string; children: ReactNode; open?: boolean; note?: string }) {
    return <details className="authoring-section" open={open}>
        <summary><span className="authoring-step">{n}</span>{title}{note && <small>{note}</small>}</summary>
        <div className="authoring-section-body">{children}</div>
    </details>;
}

function ActorEditor({ actor, ego, onChange, onRemove }: { actor: TemplateActor; ego?: boolean; onChange: (a: TemplateActor) => void; onRemove?: () => void }) {
    const t = useT();
    const kinds = ego ? ACTOR_KINDS.filter(k => k === "car" || k === "truck" || k === "bus") : ACTOR_KINDS;
    const last = actor.route.at(-1) ?? actor.start;
    return <div className="authoring-actor">
        <div className="authoring-row">
            {ego ? <strong className="authoring-ego-tag">EGO</strong> : <label className="field">{t("ID")}<input aria-label={t("ID đối tượng")} value={actor.id} maxLength={32} onChange={e => onChange({ ...actor, id: e.target.value })}/></label>}
            <label className="field">{t("Loại")}<select aria-label={t("Loại của {id}", { id: actor.id })} value={actor.kind} onChange={e => onChange(withKind(actor, e.target.value as TemplateActor["kind"]))}>
                {kinds.map(k => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
            </select></label>
            {onRemove && <button className="icon-button danger" aria-label={t("Xoá {id}", { id: actor.id })} title={t("Xoá đối tượng")} onClick={onRemove}><Trash2 size={14} aria-hidden/></button>}
        </div>
        <div className="authoring-grid">
            <Num label={t("Dài")} unit="m" value={actor.length_m} onChange={v => onChange({ ...actor, length_m: v })}/>
            <Num label={t("Rộng")} unit="m" value={actor.width_m} onChange={v => onChange({ ...actor, width_m: v })}/>
            <Num label={t("Cao")} unit="m" value={actor.height_m} onChange={v => onChange({ ...actor, height_m: v })}/>
            <Num label={t("Xuất phát x")} unit="m" value={actor.start.x_m} step={0.5} onChange={v => onChange({ ...actor, start: { ...actor.start, x_m: v } })}/>
            <Num label={t("Xuất phát y")} unit="m" value={actor.start.y_m} step={0.5} onChange={v => onChange({ ...actor, start: { ...actor.start, y_m: v } })}/>
            <Num label={t("Hướng")} unit="°" value={actor.start.yaw_deg} step={5} onChange={v => onChange({ ...actor, start: { ...actor.start, yaw_deg: v } })}/>
            <Num label={t("Vận tốc đầu")} unit="m/s" value={actor.speed.initial_mps} onChange={v => onChange({ ...actor, speed: { ...actor.speed, initial_mps: v } })}/>
            <Num label={t("Vận tốc đích")} unit="m/s" value={actor.speed.target_mps} onChange={v => onChange({ ...actor, speed: { ...actor.speed, target_mps: v } })}/>
            <Num label={t("Gia tốc")} unit="m/s²" value={actor.speed.accel_mps2} onChange={v => onChange({ ...actor, speed: { ...actor.speed, accel_mps2: v } })}/>
            {!ego && <Num label={t("Bắt đầu lúc")} unit="s" value={actor.start_delay_s} step={0.5} onChange={v => onChange({ ...actor, start_delay_s: v })}/>}
        </div>
        <div className="authoring-route-list">
            <span>{t("Lộ trình ({n} điểm)", { n: actor.route.length })}</span>
            {actor.route.map((p, i) => <div key={i} className="authoring-row">
                <Num label={t("Điểm {n} x", { n: i + 1 })} unit="m" value={p.x_m} step={1} onChange={v => onChange({ ...actor, route: actor.route.map((q, j) => j === i ? { ...q, x_m: v } : q) })}/>
                <Num label={t("Điểm {n} y", { n: i + 1 })} unit="m" value={p.y_m} step={0.5} onChange={v => onChange({ ...actor, route: actor.route.map((q, j) => j === i ? { ...q, y_m: v } : q) })}/>
                <button className="icon-button" aria-label={t("Xoá điểm {n} của {id}", { n: i + 1, id: actor.id })} onClick={() => onChange({ ...actor, route: actor.route.filter((_, j) => j !== i) })}><Trash2 size={13} aria-hidden/></button>
            </div>)}
            <button className="authoring-add" onClick={() => onChange({ ...actor, route: [...actor.route, { x_m: last.x_m + 10, y_m: last.y_m }] })}><Plus size={13} aria-hidden/>{t("Thêm điểm lộ trình")}</button>
        </div>
    </div>;
}

function EventEditor({ event, index, actors, onChange, onRemove }: { event: TemplateEvent; index: number; actors: TemplateActor[]; onChange: (e: TemplateEvent) => void; onRemove: () => void }) {
    const t = useT();
    const withType = (e: TemplateEvent, type: EventType): TemplateEvent => ({ ...e, type, params: Object.fromEntries(Object.entries(EVENT_PARAMS[type]).map(([k, [, , min, max]]) => [k, e.params[k] ?? Math.round((min + max) / 2)])) });
    const setType = (type: EventType) => onChange(withType(event, type));
    // Switching to a pedestrian turns "hard brake" into "stop" (same deceleration parameter).
    const setActor = (id: string) => {
        const allowed = eventTypesFor(actors.find(a => a.id === id)?.kind);
        onChange(withType({ ...event, actor: id }, allowed.includes(event.type) ? event.type : "stop"));
    };
    const types = eventTypesFor(actors.find(a => a.id === event.actor)?.kind);
    const ids = actors.map(a => a.id);
    return <div className="authoring-actor">
        <div className="authoring-row">
            <label className="field">{t("Tình huống")}<select aria-label={t("Loại tình huống {n}", { n: index + 1 })} value={event.type} onChange={e => setType(e.target.value as EventType)}>
                {types.map(type => <option key={type} value={type}>{t(EVENT_LABEL[type])}</option>)}
            </select></label>
            <label className="field">{t("Đối tượng")}<select aria-label={t("Đối tượng của tình huống {n}", { n: index + 1 })} value={event.actor} onChange={e => setActor(e.target.value)}>
                {!ids.includes(event.actor) && <option value={event.actor}>{event.actor}</option>}
                {actors.map(a => <option key={a.id} value={a.id}>{a.role === "ego" ? `${a.id} (ego)` : a.id}</option>)}
            </select></label>
            <button className="icon-button danger" aria-label={t("Xoá tình huống {n}", { n: index + 1 })} onClick={onRemove}><Trash2 size={14} aria-hidden/></button>
        </div>
        <div className="authoring-grid">
            <Num label={t("Thời điểm")} unit="s" value={event.at_s} step={0.5} onChange={v => onChange({ ...event, at_s: v })}/>
            {Object.entries(EVENT_PARAMS[event.type]).map(([key, [label, unit, min, max]]) =>
                <Num key={key} label={t(label)} unit={unit} min={min} max={max} value={event.params[key]} onChange={v => onChange({ ...event, params: { ...event.params, [key]: v } })}/>)}
        </div>
    </div>;
}

/** Key params of the chosen type: changing one rebuilds parts 4–7 (plan38 SPEC-P01 §3). */
export function KeyParams({ template, type, set }: { template: ScenarioTemplate; type: ScenarioType; set: Setter }) {
    const t = useT();
    const update = (key: string, value: number | string) => set(applyType(template, type, { ...template.params, [key]: value }));
    return <div className="authoring-keyparams">
        {template.customized && <p className="authoring-warn">{t("Đổi tham số chính sẽ sinh lại các đối tượng/tình huống có sẵn của mẫu (chỉnh tay trên chúng sẽ mất); những gì bạn tự thêm được giữ lại.")}</p>}
        {type.params.map(p => "options" in p
            ? <label key={p.key} className="field">{t(p.label)}<select aria-label={t(p.label)} value={String(template.params[p.key] ?? p.default)} onChange={e => update(p.key, e.target.value)}>
                {p.options.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}</select></label>
            : <label key={p.key} className="field authoring-slider"><span>{t(p.label)}<output>{String(template.params[p.key] ?? p.default).replace(".", ",")} {p.unit}</output></span>
                <input type="range" aria-label={t(p.label)} min={p.min} max={p.max} step={p.step} value={Number(template.params[p.key] ?? p.default)} onChange={e => update(p.key, Number(e.target.value))}/></label>)}
        {type.params.length > 0 && <button className="authoring-add" onClick={() => set(applyType(template, type, defaultParams(type)))}><RotateCcw size={13} aria-hidden/>{t("Về giá trị mặc định")}</button>}
    </div>;
}

/** Parts 1–8 of the template; any edit to parts 4–6 marks the template customized. */
export function TemplateForm({ template, set, scenes }: { template: ScenarioTemplate; set: Setter; scenes: string[] }) {
    const t = useT();
    const custom = (patch: Partial<ScenarioTemplate>) => set({ ...template, ...patch, customized: true });
    const egoIndex = template.actors.findIndex(a => a.role === "ego");
    const setActor = (i: number, a: TemplateActor) => {
        const old = template.actors[i].id;
        custom({ actors: template.actors.map((x, j) => j === i ? a : x), events: a.id !== old ? template.events.map(e => e.actor === old ? { ...e, actor: a.id } : e) : template.events });
    };
    const ids = template.actors.map(a => a.id);
    const nextId = (prefix: string) => { let i = 1; while (ids.includes(`${prefix}${i}`)) i++; return `${prefix}${i}`; };
    const nextEventId = () => { let i = 1; while (template.events.some(e => e.id === `event${i}`)) i++; return `event${i}`; };
    const traffic = template.actors.map((a, i) => ({ a, i })).filter(x => x.a.role !== "ego");
    const [dMin, dMax] = LIMITS.duration_s;
    return <div className="authoring-form">
        <Section n={1} title={t("Thông tin")}>
            <label className="field">{t("Tên kịch bản")}<input aria-label={t("Tên kịch bản mới")} value={template.name} maxLength={LIMITS.name} onChange={e => set({ ...template, name: e.target.value })}/></label>
            <label className="field">{t("Mô tả")}<textarea aria-label={t("Mô tả kịch bản")} rows={2} value={template.description} onChange={e => set({ ...template, description: e.target.value })}/></label>
            <label className="field">{t("Thẻ (cách nhau bằng dấu phẩy)")}<input aria-label={t("Thẻ")} value={template.tags.join(", ")} onChange={e => set({ ...template, tags: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}/></label>
        </Section>
        <Section n={2} title={t("Map & thời lượng")}>
            <label className="field">{t("Map")}<select aria-label={t("Map của template")} value={template.map.scene} onChange={e => set({ ...template, map: { ...template.map, scene: e.target.value } })}>
                {!scenes.includes(template.map.scene) && <option value={template.map.scene}>{template.map.scene || "—"}</option>}
                {scenes.map(s => <option key={s} value={s}>{s}</option>)}
            </select></label>
            <div className="authoring-grid">
                <Num label={t("Thời lượng")} unit="s" min={dMin} max={dMax} step={1} value={template.map.duration_s} onChange={v => set({ ...template, map: { ...template.map, duration_s: v } })}/>
                <Num label={t("Tần số mẫu")} unit="Hz" min={1} max={20} step={1} value={template.map.sample_hz} onChange={v => set({ ...template, map: { ...template.map, sample_hz: v } })}/>
            </div>
            <div className="authoring-grid">
                <Num label={t("Điểm bắt đầu trên quỹ đạo nguồn")} unit="m" min={LIMITS.start_m[0]} max={LIMITS.start_m[1]} step={5} value={template.map.placement.start_m} onChange={v => set({ ...template, map: { ...template.map, placement: { ...template.map.placement, start_m: v } } })}/>
                <Num label={t("Lệch ngang toàn kịch bản")} unit="m" min={LIMITS.lateral_m[0]} max={LIMITS.lateral_m[1]} step={0.5} value={template.map.placement.lateral_m} onChange={v => set({ ...template, map: { ...template.map, placement: { ...template.map.placement, lateral_m: v } } })}/>
            </div>
            <label className="toggle"><input type="checkbox" checked={template.map.placement.auto} onChange={e => set({ ...template, map: { ...template.map, placement: { ...template.map.placement, auto: e.target.checked } } })}/>{t("Tự tìm vị trí phù hợp nếu điểm bắt đầu không đặt được")}</label>
            <label className="toggle"><input type="checkbox" checked={template.map.ego_react !== false} onChange={e => set({ ...template, map: { ...template.map, ego_react: e.target.checked } })}/>{t("Ego tự phanh khi có xe/người chắn trong làn (tắt = ego chạy đúng lộ trình đã đặt)")}</label>
            <label className="toggle"><input type="checkbox" checked={template.map.placement.mirror} onChange={e => set({ ...template, map: { ...template.map, placement: { ...template.map.placement, mirror: e.target.checked } } })}/>{t("Lật trái ↔ phải (giao thông đi bên trái)")}</label>
            <p className="sensor-note">{t("Kịch bản được đặt dọc theo quỹ đạo thật của xe ego trong cảnh nguồn, nên bám theo đường cong của mặt đường. Toạ độ bên dưới: x = mét dọc quỹ đạo đó, y = mét sang trái.")}</p>
        </Section>
        <Section n={3} title={t("Môi trường")} note={t("chỉ hiển thị, không ghi vào .xosc")}>
            <label className="field">{t("Thời tiết CARLA")}<select aria-label={t("Thời tiết của template")} value={template.environment.weather_preset} onChange={e => set({ ...template, environment: { weather_preset: e.target.value as WeatherPresetId } })}>
                {Object.keys(CARLA_WEATHER_VALUES).map(p => <option key={p} value={p}>{p}</option>)}
            </select></label>
        </Section>
        <Section n={4} title={t("Xe ego")}>
            {egoIndex >= 0 ? <ActorEditor ego actor={template.actors[egoIndex]} onChange={a => setActor(egoIndex, a)}/> : <p className="authoring-warn">{t("Thiếu xe ego.")}</p>}
        </Section>
        <Section n={5} title={t("Đối tượng khác")} note={t("{n} đối tượng", { n: traffic.length })}>
            {traffic.map(({ a, i }) => <ActorEditor key={i} actor={a} onChange={x => setActor(i, x)} onRemove={() => custom({ actors: template.actors.filter((_, j) => j !== i), events: template.events.filter(e => e.actor !== a.id) })}/>)}
            <button className="authoring-add" disabled={template.actors.length >= LIMITS.actors[1]} onClick={() => custom({ actors: [...template.actors, {
                id: nextId("car"), role: "traffic", kind: "car", manual: true, length_m: 4.5, width_m: 1.8, height_m: 1.5, start_delay_s: 0,
                start: { x_m: 30, y_m: 3.5, yaw_deg: 0 }, route: [{ x_m: 150, y_m: 3.5 }], speed: { initial_mps: 10, target_mps: 10, accel_mps2: 0 },
            }] })}><Plus size={13} aria-hidden/>{t("Thêm đối tượng")}</button>
        </Section>
        <Section n={6} title={t("Tình huống")} note={t("{n} tình huống", { n: template.events.length })}>
            {template.events.map((e, i) => <EventEditor key={i} index={i} event={e} actors={template.actors} onChange={x => custom({ events: template.events.map((y, j) => j === i ? x : y) })} onRemove={() => custom({ events: template.events.filter((_, j) => j !== i) })}/>)}
            <button className="authoring-add" onClick={() => custom({ events: [...template.events, { id: nextEventId(), manual: true, type: "hard_brake", actor: template.actors.find(a => a.role === "ego")?.id ?? ids[0], at_s: 2, params: { decel_mps2: 6 } }] })}><Plus size={13} aria-hidden/>{t("Thêm tình huống")}</button>
        </Section>
        <Section n={7} title={t("Tiêu chí đánh giá")}>
            <div className="authoring-grid">
                <Num label={t("TTC tối thiểu")} unit="s" min={0} max={20} value={template.expect.min_ttc_s} onChange={v => set({ ...template, expect: { ...template.expect, min_ttc_s: v } })}/>
                <Num label={t("Khoảng cách tối thiểu")} unit="m" min={0} max={100} value={template.expect.min_gap_m} onChange={v => set({ ...template, expect: { ...template.expect, min_gap_m: v } })}/>
            </div>
            <label className="toggle"><input type="checkbox" checked={template.expect.no_contact} onChange={e => set({ ...template, expect: { ...template.expect, no_contact: e.target.checked } })}/>{t("Không được có tiếp xúc")}</label>
        </Section>
        <Section n={8} title={t("Nguồn gốc")}>
            <dl className="kv">
                <dt>{t("Cách tạo")}</dt><dd>{template.provenance.mode === "ai" ? t("Bằng AI") : t("Từ template")}</dd>
                {template.provenance.model && <><dt>{t("Mô hình")}</dt><dd>{template.provenance.model}</dd></>}
                {template.provenance.prompt && <><dt>{t("Ý tưởng gốc")}</dt><dd>{template.provenance.prompt}</dd></>}
                <dt>{t("Tạo lúc")}</dt><dd>{new Date(template.provenance.created_at).toLocaleString()}</dd>
            </dl>
        </Section>
    </div>;
}
