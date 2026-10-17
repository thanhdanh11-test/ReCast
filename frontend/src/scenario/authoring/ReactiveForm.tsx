import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Play, TriangleAlert } from "lucide-react";
import { useT } from "../i18n";
import { HelpTip } from "../help/HelpTip";
import type { Candidate, ReactiveCandidates, ReactiveEvent } from "../types";

/** Braking levels offered in the form (m/s²); levels above the vehicle's `max_decel_mps2` are hidden. */
export const DECEL_LEVELS = [{ value: 2, label: "nhẹ" }, { value: 4, label: "vừa" }, { value: 6, label: "gấp" }, { value: 8, label: "khẩn" }] as const;
const DEFAULT_DECEL = 4;
const REACTION_LEVELS = [0.7, 1.0, 1.5] as const;
/** UI goals → contract C1 `target` + `dwell_s`. */
const GOALS = {
    stop: { label: "dừng hẳn", target: "stop", dwell_s: 0 },
    dwell: { label: "dừng 3 s", target: "stop", dwell_s: 3 },
    half: { label: "chậm lại 50%", target: "half", dwell_s: 0 },
} as const;
type Goal = keyof typeof GOALS;
/** Form choice → its goal (grid cells and rare cases carry `target` + `dwell`). */
export const goalOf = (target: "stop" | "half", dwell: number): Goal => target === "half" ? "half" : dwell > 0 ? "dwell" : "stop";
/** A choice set from outside the form (scene metrics: grid cell or rare case); `seq` re-applies the same choice. */
export interface ReactivePreset { actor_id: string; t0_s: number; decel_mps2: number; target: "stop" | "half"; dwell_s: number; seq: number }

/**
 * Allowed t0 windows of `c` for one event (plan46 C1 `windows_by_event`, key "<target>:<dwell>:<decel>" in Python
 * `g` format, i.e. `String(number)` here). Older workers without the map fall back to the event-independent windows.
 */
export function windowsFor(c: Candidate, target: "stop" | "half", dwell: number, decel: number | null): [number, number][] {
    if (!c.windows_by_event) return c.windows;
    if (decel === null) return [];
    return c.windows_by_event[`${target}:${dwell}:${decel}` as const] ?? [];
}

/** Snap `t` into the closest of the allowed `windows` (inclusive); unchanged when already inside one. */
export function clampToWindows(t: number, windows: [number, number][]): number {
    let best = t, distance = Infinity;
    for (const [from, to] of windows) {
        const inside = Math.min(Math.max(t, from), to), d = Math.abs(inside - t);
        if (d < distance) { best = inside; distance = d; }
    }
    return best;
}
const allowedDecel = (c: Candidate) => DECEL_LEVELS.filter(level => level.value <= c.max_decel_mps2);
const defaultDecel = (c: Candidate) => {
    const levels = allowedDecel(c);
    return levels.some(l => l.value === DEFAULT_DECEL) ? DEFAULT_DECEL : levels.at(-1)?.value ?? null;
};
const message = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error: /, "");

/**
 * “Phản ứng” tab (plan45 P03): pick a real vehicle with followers, when it brakes, how hard and to what goal; the
 * worker simulates the reactions (`importReactive`). Every number shown comes from `reactiveCandidates`.
 */
export function ReactiveForm({ scene, busy, load, onCreate, onDone, preset }: {
    scene: string; busy: boolean;
    /** Choice picked in the scene metrics panel; applied once per `seq` when its vehicle is a candidate. */
    preset?: ReactivePreset | null;
    load: (scene: string) => Promise<ReactiveCandidates>;
    onCreate: (scene: string, event: ReactiveEvent) => Promise<boolean | undefined>;
    onDone: () => void;
}) {
    const t = useT();
    const [data, setData] = useState<ReactiveCandidates | null>(null);
    const [loadError, setLoadError] = useState("");
    const [error, setError] = useState("");
    const [actorId, setActorId] = useState("");
    const [t0, setT0] = useState(0);
    const [decel, setDecel] = useState<number | null>(DEFAULT_DECEL);
    const [goal, setGoal] = useState<Goal>("stop");
    const [advanced, setAdvanced] = useState(false);
    const [react, setReact] = useState(true);
    const [reaction, setReaction] = useState(1.0);
    // One request per scene: StrictMode re-runs effects, and a second request would hit the busy worker.
    const pending = useRef<{ scene: string; promise: Promise<ReactiveCandidates> } | null>(null);

    const choose = (c: Candidate | undefined) => {
        setActorId(c?.actor_id ?? "");
        setT0(c?.windows[0]?.[0] ?? 0);
        setDecel(c ? defaultDecel(c) : null);
        setError("");
    };
    useEffect(() => {
        let live = true;
        setData(null); setLoadError(""); choose(undefined);
        if (!scene) return;
        if (pending.current?.scene !== scene) pending.current = { scene, promise: load(scene) };
        const request = pending.current;
        request.promise.then(result => {
            if (!live) return;
            setData(result); choose(result.candidates[0]);
        }, e => {
            if (pending.current === request) pending.current = null;
            if (live) setLoadError(message(e));
        });
        return () => { live = false; };
    }, [scene]);

    const candidate = data?.candidates.find(c => c.actor_id === actorId);
    const windows = candidate ? windowsFor(candidate, GOALS[goal].target, GOALS[goal].dwell_s, decel) : [];
    const windowsKey = JSON.stringify(windows);
    // The windows depend on the event: keep t0 inside the ones of the current choice.
    useEffect(() => { if (windows.length) setT0(current => clampToWindows(current, windows)); }, [actorId, windowsKey]);
    const applied = useRef(-1);
    useEffect(() => {
        if (!preset || !data || applied.current === preset.seq) return;
        const c = data.candidates.find(item => item.actor_id === preset.actor_id);
        if (!c) return;
        applied.current = preset.seq;
        setActorId(c.actor_id); setT0(preset.t0_s); setDecel(preset.decel_mps2); setGoal(goalOf(preset.target, preset.dwell_s)); setError("");
    }, [preset, data]);
    const min = windows[0]?.[0] ?? 0, max = windows.at(-1)?.[1] ?? 0, span = Math.max(max - min, 1e-9);
    const problems = candidate ? (data?.label_problems ?? []).filter(p => p.name === candidate.name && p.t_to > min && p.t_from < max) : [];
    const create = () => {
        if (!candidate || decel === null || !windows.length) return;
        const event: ReactiveEvent = { actor_id: candidate.actor_id, t0_s: t0, decel_mps2: decel, target: GOALS[goal].target, dwell_s: GOALS[goal].dwell_s, react, reaction_s: reaction };
        setError("");
        onCreate(scene, event).then(ok => { if (ok) onDone(); }, e => setError(message(e)));
    };

    if (loadError) return <div className="reactive-form"><p className="authoring-warn" role="alert">{t(loadError)}</p></div>;
    if (!data) return <div className="reactive-form"><p className="sensor-note" role="status">{t("Đang tìm xe phù hợp")}</p></div>;
    if (!data.candidates.length) return <div className="reactive-form"><p className="authoring-warn" role="status">{t("Cảnh này không có xe nào đang có xe khác chạy phía sau. Chọn cảnh khác.")}</p></div>;

    return <div className="reactive-form">
        <p className="sensor-note">{t("Chọn một xe thật trong cảnh cho nó phanh; các xe phía sau phản ứng như người lái. Các vật thể khác phát lại đúng bản ghi.")}</p>
        <label className="reactive-field"><span>{t("Xe gây sự kiện")} <HelpTip term="pick"/></span>
            <select aria-label={t("Xe gây sự kiện")} value={actorId} disabled={busy} onChange={e => choose(data.candidates.find(c => c.actor_id === e.target.value))}>
                {data.candidates.map(c => <option key={c.actor_id} value={c.actor_id}>{t("{name} · {category} · {n} xe phía sau", { name: c.name, category: c.category, n: c.followers.length })}</option>)}
            </select>
        </label>
        <div className="reactive-field">
            <span>{t("Thời điểm t0")} <HelpTip term="t0"/> <strong>{t0.toFixed(1)} s</strong></span>
            <div className="reactive-slider">
                <input type="range" aria-label={t("Thời điểm t0")} min={min} max={max} step={0.5} value={t0} disabled={busy || !windows.length}
                    onChange={e => setT0(clampToWindows(Number(e.target.value), windows))}/>
                {problems.map((p, i) => <span key={i} className="reactive-problem" title={t("nhãn gốc lỗi")} aria-label={t("nhãn gốc lỗi")}
                    style={{ left: `${(Math.max(p.t_from, min) - min) / span * 100}%`, width: `${(Math.min(p.t_to, max) - Math.max(p.t_from, min)) / span * 100}%` }}/>)}
            </div>
            {windows.length
                ? <small className="sensor-note">{t("Chỉ trong các khoảng hợp lệ")}: {windows.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} s`).join(" · ")}</small>
                : <small className="authoring-warn" role="status">{t("Không còn lúc nào hợp lệ cho mức phanh và đích này (xe cần đủ dữ liệu sau sự kiện). Chọn mức phanh nhẹ hơn hoặc đích khác.")}</small>}
        </div>
        <div className="reactive-field" role="group" aria-label={t("Mức phanh")}>
            <span>{t("Mức phanh")} <HelpTip term="strength"/></span>
            <div className="reactive-choices">
                {allowedDecel(candidate!).map(level => <button key={level.value} type="button" className="chip" aria-pressed={decel === level.value} disabled={busy}
                    onClick={() => setDecel(level.value)}>{t(level.label)} {level.value} m/s²</button>)}
                <HelpTip term="decel"/>
            </div>
        </div>
        <div className="reactive-field" role="group" aria-label={t("Đích")}>
            <span>{t("Đích")} <HelpTip term="target"/></span>
            <div className="reactive-choices">
                {(Object.keys(GOALS) as Goal[]).map(key => <button key={key} type="button" className="chip" aria-pressed={goal === key} disabled={busy}
                    onClick={() => setGoal(key)}>{t(GOALS[key].label)}</button>)}
                <HelpTip term="dwell"/>
            </div>
        </div>
        <button type="button" className="reactive-advanced" aria-expanded={advanced} onClick={() => setAdvanced(a => !a)}>
            {advanced ? <ChevronDown size={13} aria-hidden/> : <ChevronRight size={13} aria-hidden/>}{t("Nâng cao")}
        </button>
        {advanced && <div className="reactive-advanced-body">
            <div className="reactive-check-row"><label className="reactive-check"><input type="checkbox" checked={react} disabled={busy} onChange={e => setReact(e.target.checked)}/>{t("Các xe phía sau phản ứng")}</label><HelpTip term="react"/></div>
            <div className="reactive-field" role="group" aria-label={t("Thời gian phản xạ")}>
                <span>{t("Thời gian phản xạ")} <HelpTip term="reaction"/></span>
                <div className="reactive-choices">
                    {REACTION_LEVELS.map(value => <button key={value} type="button" className="chip" aria-pressed={reaction === value} disabled={busy || !react}
                        onClick={() => setReaction(value)}>{value.toFixed(1)} s</button>)}
                </div>
            </div>
            <p className="sensor-note">{t("Kích hoạt theo thời gian")} <HelpTip term="trigger"/></p>
        </div>}
        {error && <p className="authoring-issues" role="alert"><TriangleAlert size={12} aria-hidden/>{t(error)}</p>}
        <div className="reactive-actions">
            <button className="primary" disabled={busy || !candidate || decel === null || !windows.length} onClick={create}><Play size={14} aria-hidden/> {t("Tạo tình huống")}</button>
        </div>
    </div>;
}
