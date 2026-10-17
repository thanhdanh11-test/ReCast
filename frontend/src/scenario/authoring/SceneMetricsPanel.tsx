import { useEffect, useRef, useState } from "react";
import { Gauge, Play, Square, TriangleAlert } from "lucide-react";
import { useT } from "../i18n";
import { HelpTip } from "../help/HelpTip";
import { GROUP_LABEL, GROUP_TERM } from "../help/terms";
import type { ReactiveEvent } from "../types";
import type { GridCell, MethodCount, RareCase, ReactiveGroup, ReactiveMetrics, ReplayErrorMetrics, ReplayGroupName, ReplayMethod } from "../reactiveTypes";
import type { ReactivePreset } from "./ReactiveForm";
import { categoryName } from "../reactive/model";

/** Number with unit, Vietnamese decimal comma; "—" when not measured (never invented). */
const fmt = (value: number | null | undefined, digits: number, unit = "") =>
    value === undefined || value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits).replace(".", ",")}${unit}`;
const pct = (n: number, of: number) => of > 0 ? fmt(n / of * 100, 1, " %") : "—";
const message = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error: /, "");

const GROUP_ORDER: ReactiveGroup[] = ["collision", "hard", "close", "mild", "far"];
/** `MethodCount.reasons` key → its label and validity condition term (replay-forge docs §8.3). */
const REASONS = [
    ["collision", "Va chạm", "c_collision"], ["appearing", "Xe mới vào khung hình", "c_appear"], ["merge", "Nhập làn / cắt ngang", "c_merge"],
    ["label_error", "Nhãn gốc lỗi", "c_label"], ["tailgating", "Bám sát phi lý", "c_tailgate"], ["physics", "Vượt giới hạn vật lý", "c_physics"],
] as const;
const TARGET_LABEL: Record<string, string> = { "stop:0": "dừng rồi đi ngay", "stop:3": "dừng 3 s rồi đi tiếp", "half:0": "chậm lại 50%" };
const METHODS: ReplayMethod[] = ["exact", "baseline", "pilot"];
const REPLAY_GROUPS: ReplayGroupName[] = ["all", "moving", "static", "vehicle", "pedestrian", "obstacle"];
const REPLAY_GROUP_LABEL: Record<ReplayGroupName, string> = { all: "tất cả", moving: "đang chạy", static: "đứng yên", vehicle: "xe", pedestrian: "người đi bộ", obstacle: "vật cản" };
const SENSITIVITY = [0.7, 1.0, 1.5];

type Load<T> = { status: "idle" } | { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: string };
type Batch = { done: number; failed: number; total: number; running: boolean };
type Choice = Omit<ReactivePreset, "seq">;
const choiceOf = (c: GridCell | RareCase): Choice => ({ actor_id: c.actor_id, t0_s: c.t0, decel_mps2: c.decel, target: c.target, dwell_s: c.dwell });

/**
 * “Chỉ số cảnh” block of the reactive tab (plan46 WP5): scene metric 2 (fixed event grid, baseline vs pilot), the
 * rare cases it found, the parameter space, and scene metric 1 (esmini replay error). Every number comes from the
 * metrics worker (`reactiveMetrics`, `replayErrorMetrics`); picking a case fills the form above.
 */
export function SceneMetricsPanel({ scene, busy, reactiveMetrics, replayErrorMetrics, onFill, onCreate, onDone }: {
    scene: string; busy: boolean;
    reactiveMetrics?: (scene: string, reactions?: number[]) => Promise<ReactiveMetrics>;
    replayErrorMetrics?: (scene: string) => Promise<ReplayErrorMetrics>;
    onFill: (choice: Choice) => void;
    onCreate: (scene: string, event: ReactiveEvent) => Promise<boolean | undefined>;
    onDone: () => void;
}) {
    const t = useT();
    const [metric2, setMetric2] = useState<Load<ReactiveMetrics>>({ status: "idle" });
    const [metric1, setMetric1] = useState<Load<ReplayErrorMetrics>>({ status: "idle" });
    const [withSensitivity, setWithSensitivity] = useState(false);
    const [batch, setBatch] = useState<Batch | null>(null);
    const [createError, setCreateError] = useState("");
    const stop = useRef(false);
    // Results belong to one scene: a late answer for a previous scene is dropped.
    const sceneRef = useRef(scene);
    sceneRef.current = scene;
    useEffect(() => { setMetric2({ status: "idle" }); setMetric1({ status: "idle" }); setBatch(null); setCreateError(""); stop.current = true; }, [scene]);
    if (!reactiveMetrics && !replayErrorMetrics) return null;

    const run = <T,>(set: (value: Load<T>) => void, work: () => Promise<T>) => {
        const asked = scene;
        set({ status: "loading" });
        work().then(data => { if (sceneRef.current === asked) set({ status: "ready", data }); },
            e => { if (sceneRef.current === asked) set({ status: "error", error: message(e) }); });
    };
    const eventOf = (c: RareCase, reaction: number): ReactiveEvent =>
        ({ actor_id: c.actor_id, t0_s: c.t0, decel_mps2: c.decel, target: c.target, dwell_s: c.dwell, react: true, reaction_s: reaction });
    const view = (c: RareCase, reaction: number) => {
        onFill(choiceOf(c)); setCreateError("");
        onCreate(scene, eventOf(c, reaction)).then(ok => { if (ok) onDone(); }, e => setCreateError(message(e)));
    };
    /** Creates every rare case one after the other (the main worker serves one job at a time); stoppable between cases. */
    const createAll = async (cases: RareCase[], reaction: number) => {
        stop.current = false; setCreateError("");
        let done = 0, failed = 0;
        setBatch({ done, failed, total: cases.length, running: true });
        for (const c of cases) {
            if (stop.current) break;
            try { if (await onCreate(scene, eventOf(c, reaction))) done++; else failed++; }
            catch (e) { failed++; setCreateError(message(e)); }
            setBatch({ done, failed, total: cases.length, running: true });
        }
        setBatch({ done, failed, total: cases.length, running: false });
    };

    const m2 = metric2.status === "ready" ? metric2.data : null;
    return <section className="scene-metrics" aria-label={t("Chỉ số cảnh")}>
        <h3>{t("Chỉ số cảnh")}</h3>
        {reactiveMetrics && <div className="scene-metrics-block" aria-label={t("Chỉ số 2")}>
            <div className="scene-metrics-actions">
                <button type="button" disabled={metric2.status === "loading" || !scene}
                    onClick={() => run(setMetric2, () => reactiveMetrics(scene, withSensitivity ? SENSITIVITY : undefined))}><Gauge size={14} aria-hidden/> {t("Đo chỉ số 2")}</button>
                <label className="reactive-check"><input type="checkbox" checked={withSensitivity} onChange={e => setWithSensitivity(e.target.checked)}/>{t("kèm độ nhạy 0,7/1,0/1,5 s")}</label>
                <HelpTip term="sensitivity"/>
            </div>
            {metric2.status === "loading" && <p className="sensor-note" role="status">{t("Đang quét lưới sự kiện của cảnh")}</p>}
            {metric2.status === "error" && <p className="authoring-warn" role="alert">{t(metric2.error)}</p>}
            {m2 && <Metric2 data={m2}/>}
        </div>}
        {m2 && <div className="scene-metrics-block" aria-label={t("Ca hiếm tìm sẵn")}>
            <h4>{t("Ca hiếm tìm sẵn")} <HelpTip term="found"/> <small className="sensor-note">{t("với phản xạ {s}", { s: fmt(m2.reaction_s, 1, " s") })}</small></h4>
            {m2.rare.length ? <>
                <table className="scene-metrics-table"><thead><tr>
                    <th>{t("Xe")}</th><th>{t("Lúc")}</th><th>{t("Mức phanh")}</th><th>{t("Đích")}</th><th>{t("Nhóm")} <HelpTip term="group"/></th>
                    <th>{t("Gần nhất")} <HelpTip term="min_gap"/></th><th>TTC <HelpTip term="ttc"/></th><th/>
                </tr></thead><tbody>
                    {m2.rare.map(c => <tr key={`${c.actor_id}:${c.t0}:${c.decel}:${c.target}:${c.dwell}`}>
                        <td>{c.actor}</td><td>{fmt(c.t0, 1, " s")}</td><td>{fmt(c.decel, 0, " m/s²")}</td><td>{t(TARGET_LABEL[`${c.target}:${c.dwell}`] ?? c.target)}</td>
                        <td>{t(GROUP_LABEL[c.group])}</td><td>{fmt(c.ego_min_gap, 2, " m")}</td><td>{fmt(c.ego_min_ttc, 2, " s")}</td>
                        <td><button type="button" disabled={busy || !!batch?.running} aria-label={t("Xem {actor} lúc {t0}", { actor: c.actor, t0: fmt(c.t0, 1, " s") })}
                            onClick={() => view(c, m2.reaction_s)}>{t("Xem")}</button></td>
                    </tr>)}
                </tbody></table>
                <div className="scene-metrics-actions">
                    {batch?.running
                        ? <button type="button" onClick={() => { stop.current = true; }}><Square size={13} aria-hidden/> {t("Dừng")}</button>
                        : <button type="button" disabled={busy} onClick={() => void createAll(m2.rare, m2.reaction_s)}><Play size={13} aria-hidden/> {t("Tạo tất cả ca hiếm vào thư viện")}</button>}
                    {batch && <span className="sensor-note" role="status">{t("Đã tạo {done}/{total} · lỗi {failed}", { done: batch.done, total: batch.total, failed: batch.failed })}</span>}
                </div>
            </> : <p className="sensor-note">{t("Không có ca hiếm trên lưới này.")}</p>}
            {createError && <p className="authoring-issues" role="alert"><TriangleAlert size={12} aria-hidden/>{t(createError)}</p>}
        </div>}
        {m2 && <ParameterSpace data={m2} onPick={cell => onFill(choiceOf(cell))}/>}
        {replayErrorMetrics && <div className="scene-metrics-block" aria-label={t("Chỉ số 1")}>
            <div className="scene-metrics-actions">
                <button type="button" disabled={metric1.status === "loading" || !scene} onClick={() => run(setMetric1, () => replayErrorMetrics(scene))}><Gauge size={14} aria-hidden/> {t("Đo chỉ số 1 (esmini)")}</button>
            </div>
            {metric1.status === "loading" && <p className="sensor-note" role="status">{t("Đang chạy esmini cho ba cách dựng lại")}</p>}
            {metric1.status === "error" && <p className="authoring-warn" role="alert">{metric1.error.startsWith("ESMINI_MISSING") ? t("Thiếu esmini") : t(metric1.error)}</p>}
            {metric1.status === "ready" && <Metric1 data={metric1.data}/>}
        </div>}
    </section>;
}

function Metric2({ data }: { data: ReactiveMetrics }) {
    const t = useT();
    const row = (label: string, value: (m: MethodCount) => string, term?: Parameters<typeof HelpTip>[0]["term"]) =>
        <tr key={label}><th scope="row">{t(label)}{term && <> <HelpTip term={term}/></>}</th><td>{value(data.baseline)}</td><td>{value(data.pilot)}</td></tr>;
    return <>
        <p className="sensor-note">{t("{tried} biến thể trên {encounters} lần phanh · với phản xạ {s} · esmini kiểm riêng từng gói", { tried: data.tried, encounters: data.encounters, s: fmt(data.reaction_s, 1, " s") })}</p>
        <table className="scene-metrics-table" aria-label={t("Chỉ số 2: baseline và pilot")}>
            <thead><tr><th/><th>baseline <HelpTip term="react"/></th><th>pilot</th></tr></thead>
            <tbody>
                {row("Đã thử", () => String(data.tried))}
                {row("Hợp lệ", m => `${m.valid} (${pct(m.valid, data.tried)})`, "valid")}
                {row("Lần phanh có biến thể hợp lệ", m => `${m.encounters_valid}/${data.encounters}`)}
                {row("Ca hiếm", m => t("{n} ({e} lần phanh)", { n: m.rare, e: m.rare_encounters }), "found")}
                {GROUP_ORDER.map(g => row(GROUP_LABEL[g], m => String(m.groups[g] ?? 0), GROUP_TERM[g]))}
                {REASONS.map(([key, label, term]) => row(t("Loại: {reason}", { reason: t(label) }), m => String(m.reasons[key] ?? 0), term))}
            </tbody>
        </table>
        {data.sensitivity.length > 0 && <table className="scene-metrics-table" aria-label={t("Độ nhạy theo phản xạ")}>
            <thead><tr><th>{t("Phản xạ")} <HelpTip term="reaction"/></th><th>{t("pilot hợp lệ")}</th><th>{t("pilot ca hiếm")}</th></tr></thead>
            <tbody>{data.sensitivity.map(s => <tr key={s.reaction_s}><td>{fmt(s.reaction_s, 1, " s")}</td><td>{s.pilot_valid}</td><td>{s.pilot_rare}</td></tr>)}</tbody>
        </table>}
    </>;
}

/** Braking level × t0 per goal for one vehicle; tiles coloured by the pilot group, the baseline group in a corner dot. */
export function ParameterSpace({ data, onPick }: { data: ReactiveMetrics; onPick: (cell: GridCell) => void }) {
    const t = useT();
    const actors = [...new Map(data.cells.map(c => [c.actor_id, c.actor])).entries()];
    const [actorId, setActorId] = useState(actors[0]?.[0] ?? "");
    const cells = data.cells.filter(c => c.actor_id === actorId);
    const times = [...new Set(cells.map(c => c.t0))].sort((a, b) => a - b);
    const tone = (side: { valid: boolean; group: ReactiveGroup | null }) => side.valid && side.group ? `g-${side.group}` : "invalid";
    const title = (c: GridCell) => t("{decel} m/s² lúc {t0} · baseline: {b} · pilot: {p}", {
        decel: c.decel, t0: fmt(c.t0, 1, " s"),
        b: c.baseline.valid && c.baseline.group ? t(GROUP_LABEL[c.baseline.group]) : t("không hợp lệ"),
        p: c.pilot.valid && c.pilot.group ? t(GROUP_LABEL[c.pilot.group]) : t("không hợp lệ"),
    });
    if (!actors.length) return null;
    return <div className="scene-metrics-block" aria-label={t("Không gian tham số")}>
        <h4>{t("Không gian tham số")} <HelpTip term="space"/></h4>
        <label className="reactive-field"><span>{t("Xe")}</span>
            <select aria-label={t("Xe trong không gian tham số")} value={actorId} onChange={e => setActorId(e.target.value)}>
                {actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
        </label>
        {data.grid.targets.map(([target, dwell]) => {
            const label = TARGET_LABEL[`${target}:${dwell}`] ?? target;
            return <table key={`${target}:${dwell}`} className="param-space" aria-label={t("Lưới {goal}", { goal: t(label) })}>
                <caption>{t(label)}</caption>
                <thead><tr><th>m/s²</th>{times.map(t0 => <th key={t0}>{fmt(t0, 0, " s")}</th>)}</tr></thead>
                <tbody>{data.grid.decels.map(decel => <tr key={decel}><th scope="row">{decel}</th>{times.map(t0 => {
                    const c = cells.find(x => x.t0 === t0 && x.decel === decel && x.target === target && x.dwell === dwell);
                    return <td key={t0}>{c && <button type="button" className={`param-cell ${tone(c.pilot)}`} title={title(c)} aria-label={title(c)} onClick={() => onPick(c)}>
                        <span className={`param-base ${tone(c.baseline)}`} aria-hidden/>
                    </button>}</td>;
                })}</tr>)}</tbody>
            </table>;
        })}
        <p className="sensor-note">{t("Màu ô: nhóm pilot · chấm góc: nhóm baseline · ô trống: không đủ dữ liệu · bấm ô để điền form")}</p>
    </div>;
}

type SortKey = "name" | "category" | "keyframes" | "label_problems" | ReplayMethod;
function Metric1({ data }: { data: ReplayErrorMetrics }) {
    const t = useT();
    const [group, setGroup] = useState<ReplayGroupName>("moving");
    const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "pilot", desc: true });
    const value = (o: ReplayErrorMetrics["objects"][number], key: SortKey) => METHODS.includes(key as ReplayMethod) ? o.ade[key as ReplayMethod] : o[key as Exclude<SortKey, ReplayMethod>];
    const objects = [...data.objects].sort((a, b) => {
        const x = value(a, sort.key), y = value(b, sort.key);
        if (x === y) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (x < y ? -1 : 1) * (sort.desc ? -1 : 1);
    });
    const header = (key: SortKey, label: string, term?: Parameters<typeof HelpTip>[0]["term"]) =>
        <th aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
            <button type="button" className="sort-head" onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : true }))}>{t(label)}</button>
            {term && <> <HelpTip term={term}/></>}
        </th>;
    return <>
        <p className="sensor-note">{t("Theo định nghĩa real2sim · esmini {v} · mã thoát exact/baseline/pilot: {codes}", { v: data.esmini_version ?? "—", codes: METHODS.map(m => data.esmini_exit[m]).join("/") })}</p>
        <label className="reactive-field"><span>{t("Nhóm vật thể")}</span>
            <select aria-label={t("Nhóm vật thể")} value={group} onChange={e => setGroup(e.target.value as ReplayGroupName)}>
                {REPLAY_GROUPS.map(g => <option key={g} value={g}>{t(REPLAY_GROUP_LABEL[g])} ({data.methods.pilot[g]?.n ?? 0})</option>)}
            </select>
        </label>
        <table className="scene-metrics-table" aria-label={t("Chỉ số 1: sai số phát lại")}>
            <thead><tr><th/><th>ADE <HelpTip term="ade"/></th><th>FDE</th><th>max</th><th>yaw</th><th>vRMSE</th></tr></thead>
            <tbody>{METHODS.map(m => {
                const g = data.methods[m][group];
                return <tr key={m}><th scope="row">{m}</th><td>{fmt(g?.ade, 3, " m")}</td><td>{fmt(g?.fde, 3, " m")}</td><td>{fmt(g?.max, 3, " m")}</td><td>{fmt(g?.yaw_deg, 2, "°")}</td><td>{fmt(g?.v_rmse, 3, " m/s")}</td></tr>;
            })}</tbody>
        </table>
        <h4>{t("Kiểm chéo bằng mốc giấu")} <HelpTip term="keyframes"/> <small className="sensor-note">{t("{n} mốc", { n: data.holdout.n })}</small></h4>
        <table className="scene-metrics-table" aria-label={t("Kiểm chéo bằng mốc giấu")}>
            <thead><tr><th/><th>ADE</th><th>{t("Tỉ lệ gia tốc p99 > 4 m/s²")}</th></tr></thead>
            <tbody>{METHODS.map(m => <tr key={m}><th scope="row">{m}</th><td>{fmt(data.holdout.ade[m], 3, " m")}</td><td>{fmt(data.holdout.accel_p99_over_4_share[m] === null ? null : data.holdout.accel_p99_over_4_share[m]! * 100, 1, " %")}</td></tr>)}</tbody>
        </table>
        <h4>{t("Dữ liệu gốc")} <HelpTip term="quality"/></h4>
        <table className="scene-metrics-table" aria-label={t("Dữ liệu gốc từng vật thể")}>
            <thead><tr>
                {header("name", "Vật thể")}{header("category", "Loại")}{header("keyframes", "Mốc nhãn", "keyframes")}{header("label_problems", "Nhãn lỗi", "label_problem")}
                {header("exact", "ADE exact", "ade")}{header("baseline", "ADE baseline")}{header("pilot", "ADE pilot")}
            </tr></thead>
            <tbody>{objects.map(o => <tr key={o.name}>
                <td>{o.name}{o.moving ? "" : <small> · {t("đứng yên")}</small>}</td><td title={o.category}>{t(categoryName(o.category))}</td><td>{o.keyframes}</td><td className={o.label_problems ? "fail" : ""}>{o.label_problems}</td>
                {METHODS.map(m => <td key={m}>{fmt(o.ade[m], 3, " m")}</td>)}
            </tr>)}</tbody>
        </table>
    </>;
}
