import { useEffect, useMemo, useRef, useState } from "react";
import { Check, RotateCw } from "lucide-react";
import { useT } from "../i18n";
import type { EsminiState } from "../Real2simReport";
import type { Candidate, ImportedScenario, ReactiveCandidates, ReactiveEvent, Scenario } from "../types";
import type { GridCell, ReactiveKind, ReactiveKindMetrics, ReactiveMetrics, ReactiveMetricsByKind, ReplayErrorMetrics } from "../reactiveTypes";
import type { ReactivePreset } from "../authoring/ReactiveForm";
import { DEFAULT_PARAMS, KIND_LABEL, STEP2_LABEL, clampToWindows, defaultTarget, eventOf, fmt, goalOf, kindsOf, loadMode, saveMode, speedAt, targetRange,
    timelineMarks, verdictOf, windowsOf, type Mode, type Params } from "./model";
import { DEFAULT_LAYERS, ReactiveMap, type KindDetail, type Layer } from "./ReactiveMap";
import { ReactiveTimeline } from "./ReactiveTimeline";
import { ReactiveInspector, type Step } from "./ReactiveInspector";
import { ReactiveDock } from "./ReactiveDock";
import { paramsOf, type AnyMetrics, type Rare } from "./kindMetrics";
import "./reactive.css";

type Load<T> = { status: "idle" | "loading" } | { status: "ready"; data: T } | { status: "error"; error: string };
/** A package made by "Tạo tình huống": already written by the worker; "Huỷ" deletes it, "Lưu" keeps it. */
type Draft = { pkg: ImportedScenario; saved: boolean };
const message = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error: /, "");
/** Playback restarts this long before the event start, so the lead-in is visible. */
const LEAD_IN_S = 1;
const TICK_MS = 40;
const AFTER_EVENT_S = 4; // backend reactive.py: four seconds of scene must remain after the event.

/**
 * "Phản ứng" workspace (plan47 SPEC-WP2), laid out as the approved sketch specs/reactive-layout-demo.png: top bar with
 * the three steps, 2D map in the centre, time bar, inspector on the right, detail tray below (technical mode).
 * "Tạo tình huống" simulates at once through the existing `importReactive` (the package is written then); "Lưu vào
 * thư viện" keeps it, "Huỷ" or any change of the choice deletes the unsaved package (`deleteImported`).
 */
export function ReactiveWorkspace(props: {
    active: boolean; busy: boolean;
    datasetName: string; onChooseDataset: () => void;
    scenes: string[]; currentScene: string;
    /** Loaded source scene (the app keeps one); drawn when it is the chosen scene. */
    source: Scenario | null;
    loadScene: (scene: string) => Promise<Scenario>;
    candidates: (scene: string) => Promise<ReactiveCandidates>;
    create: (scene: string, event: ReactiveEvent) => Promise<ImportedScenario>;
    discard: (scenario_id: string) => Promise<unknown>;
    open3d: (scenario_id: string) => void;
    esmini: (scenario_id: string) => EsminiState; onEsminiCheck?: (scenario_id: string) => void;
    reactiveMetrics?: (scene: string, reactions?: number[]) => Promise<ReactiveMetrics>;
    /** plan47 C5: scene metric 2 of other kinds (`kinds` param); absent = brake only. */
    reactiveKindMetrics?: (scene: string, kinds: ReactiveKind[]) => Promise<ReactiveMetricsByKind>;
    replayErrorMetrics?: (scene: string) => Promise<ReplayErrorMetrics>;
}) {
    const t = useT();
    const { active, busy } = props;
    const [mode, setModeState] = useState<Mode>(loadMode);
    const setMode = (next: Mode) => { setModeState(next); saveMode(next); };
    const [layers, setLayers] = useState<Set<Layer>>(() => new Set(DEFAULT_LAYERS));
    const [scene, setScene] = useState(props.currentScene);
    useEffect(() => { if (!scene && props.currentScene) setScene(props.currentScene); }, [props.currentScene]);
    const [cands, setCands] = useState<Load<ReactiveCandidates> & { scene?: string }>({ status: "idle" });
    const [loadedSource, setLoadedSource] = useState<Scenario | null>(null);
    const [loadingScene, setLoadingScene] = useState(false);
    /** Scene metric 2 by "<scene>:<kind>" (brake = the v0.34.0 request, other kinds with `kinds`). */
    const [metricsBy, setMetricsBy] = useState<Record<string, Load<AnyMetrics>>>({});
    const [actorId, setActorId] = useState("");
    const [kind, setKind] = useState<ReactiveKind>("brake");
    const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
    const [t0, setT0] = useState(0);
    const [draft, setDraftState] = useState<Draft | null>(null);
    const draftRef = useRef<Draft | null>(null);
    const setDraft = (next: Draft | null) => { draftRef.current = next; setDraftState(next); };
    const [error, setError] = useState("");
    const [time, setTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [rate, setRate] = useState(1);

    // ---- data of the chosen scene: candidates on the main worker (when it is free), scene metric 2 on the metrics worker
    const asked = useRef<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!active || !scene || busy || asked.current === scene) return;
        asked.current = scene;
        setCands({ status: "loading", scene });
        const alreadyLoaded = props.source?.source.scene === scene ? props.source : null;
        setLoadingScene(!alreadyLoaded);
        (alreadyLoaded ? Promise.resolve(alreadyLoaded) : props.loadScene(scene))
            .then(source => {
                if (asked.current !== scene) return;
                setLoadedSource(source);
                setLoadingScene(false);
                return props.candidates(scene).then(data => {
                    if (asked.current === scene) setCands({ status: "ready", data, scene });
                });
            })
            .catch(e => { if (asked.current === scene) { asked.current = null; setLoadingScene(false); setCands({ status: "error", error: message(e), scene }); } });
    }, [active, scene, busy, attempt]);
    const retry = () => { asked.current = null; setCands({ status: "idle" }); setAttempt(n => n + 1); };
    const metricsKey = `${scene}:${kind}`;
    const loadMetrics: (() => Promise<AnyMetrics>) | null = kind === "brake" ? (props.reactiveMetrics ? () => props.reactiveMetrics!(scene) : null)
        : props.reactiveKindMetrics ? () => props.reactiveKindMetrics!(scene, [kind]).then(byKind => {
            const m: ReactiveKindMetrics | undefined = byKind[kind as Exclude<ReactiveKind, "brake">];
            if (!m) throw new Error("NOT_SUPPORTED: " + t("Bộ đo chưa có chỉ số cho loại sự kiện này"));
            return m;
        }) : null;
    useEffect(() => {
        if (!active || !scene || !loadMetrics || metricsBy[metricsKey]) return;
        const key = metricsKey;
        setMetricsBy(m => ({ ...m, [key]: { status: "loading" } }));
        loadMetrics().then(data => setMetricsBy(m => ({ ...m, [key]: { status: "ready", data } })),
            e => setMetricsBy(m => ({ ...m, [key]: { status: "error", error: message(e) } })));
    }, [active, metricsKey]);
    const metrics: Load<AnyMetrics> | null = loadMetrics ? metricsBy[metricsKey] ?? { status: "loading" } : null;

    const data = cands.status === "ready" && cands.scene === scene ? cands.data : null;
    const duration = data?.duration_s ?? 0;
    const candidates = data?.candidates ?? [];
    const selected = candidates.find(c => c.actor_id === actorId);
    const source = props.source?.source.scene === scene ? props.source : loadedSource?.source.scene === scene ? loadedSource : null;
    const windows = useMemo(() => selected ? windowsOf(selected, kind, params) : [], [selected, kind, params]);
    const speed = kind === "accelerate" && selected ? speedAt(source?.actors.find(a => a.id === selected.actor_id), t0) : null;
    const rawRange = kind === "accelerate" && selected ? targetRange(selected, speed) : null;
    const feasibleMax = speed === null ? 0 : speed + params.accel * (duration - t0 - AFTER_EVENT_S);
    const range = rawRange && feasibleMax >= rawRange.min ? { min: rawRange.min, max: Math.min(rawRange.max, feasibleMax) } : null;
    const target = range ? (params.target_mps !== null ? Math.min(range.max, Math.max(range.min, params.target_mps)) : defaultTarget(range, speed)) : null;
    const detail = (draft?.pkg.report?.topeye ?? null) as KindDetail | null;
    const verdict = detail ? verdictOf(detail, draft?.pkg.report?.drivers?.react !== false) : null;
    const step: Step = !selected ? 1 : !draft ? 2 : 3;
    const windowsKey = JSON.stringify(windows);
    useEffect(() => { if (windows.length && !draftRef.current) setT0(current => clampToWindows(current, windows)); }, [actorId, windowsKey]);

    /** Any change of the choice ends the shown package; an unsaved one is deleted (it was only a draft). */
    const invalidate = () => {
        const current = draftRef.current;
        setDraft(null); setError(""); setPlaying(false);
        if (current && !current.saved) void props.discard(current.pkg.id).catch(() => undefined);
    };
    useEffect(() => { invalidate(); setActorId(""); setTime(0); setLoadedSource(null); }, [scene]);
    const choose = (c: Candidate | undefined) => {
        invalidate();
        setActorId(c?.actor_id ?? "");
        if (!c) return;
        const offered = kindsOf(c);
        const nextKind = offered.includes(kind) ? kind : offered[0] ?? "brake";
        setKind(nextKind);
        const first = windowsOf(c, nextKind, params)[0]?.[0] ?? 0;
        setT0(first); setTime(first);
    };
    const changeKind = (next: ReactiveKind) => { invalidate(); setKind(next); };
    const changeParams = (change: Partial<Params>) => { invalidate(); setParams(p => ({ ...p, ...change })); };
    const seek = (value: number) => {
        setPlaying(false);
        setTime(value);
        if (step === 2 && windows.length) setT0(clampToWindows(value, windows));
    };

    const run = (event: ReactiveEvent | null, saved = false) => {
        if (!event) return Promise.resolve(false);
        setError(""); setPlaying(false);
        return props.create(scene, event).then(pkg => {
            setDraft({ pkg, saved });
            setTime(Math.max(0, event.t0_s - LEAD_IN_S)); setPlaying(true);
            return true;
        }, e => { setError(message(e)); return false; });
    };
    const create = () => { if (selected) void run(eventOf(selected, kind, params, t0, target)); };
    /** A choice made outside the form (rare case, parameter-space tile, scene metrics): fills the form, returns its event. */
    const fillChoice = (actor_id: string, nextKind: ReactiveKind, change: Partial<Params>, start: number) => {
        const c = candidates.find(x => x.actor_id === actor_id);
        if (!c) return null;
        invalidate();
        const next = { ...params, ...change };
        setActorId(c.actor_id); setKind(nextKind); setParams(next); setT0(start); setTime(start);
        return eventOf(c, nextKind, next, start, next.target_mps);
    };
    const fill = (choice: Omit<ReactivePreset, "seq">) =>
        fillChoice(choice.actor_id, "brake", { decel: choice.decel_mps2, goal: goalOf(choice.target, choice.dwell_s) }, choice.t0_s);
    const pickCell = (cell: GridCell) => { fill({ actor_id: cell.actor_id, t0_s: cell.t0, decel_mps2: cell.decel, target: cell.target, dwell_s: cell.dwell }); };
    const pickKindCell = (cell: ReactiveKindMetrics["cells"][number], cellKind: ReactiveKind) => { fillChoice(cell.actor_id, cellKind, paramsOf(cellKind, cell.params), cell.t0); };
    const rare = (c: Rare) => void run(fillChoice(c.actor_id, c.kind, c.params, c.t0));

    // ---- playback (own clock: the app's playback belongs to the scene and runner views)
    useEffect(() => {
        if (!playing || !active) return;
        let last = performance.now();
        const timer = setInterval(() => {
            const now = performance.now(), dt = (now - last) / 1000;
            last = now;
            setTime(value => {
                const next = value + dt * rate;
                if (next >= duration) { setPlaying(false); return duration; }
                return next;
            });
        }, TICK_MS);
        return () => clearInterval(timer);
    }, [playing, active, rate, duration]);
    const play = () => { if (!playing && time >= duration) setTime(0); setPlaying(p => !p); };

    const name = selected?.name ?? "";
    const eventLabel = !selected ? "" : kind === "brake" ? t("{name} · phanh {v}", { name, v: fmt(params.decel, 1, " m/s²") })
        : kind === "accelerate" ? t("{name} · tăng tốc tới {v}", { name, v: fmt(target, 1, " m/s") })
        : kind === "stopline" ? t("{name} · dừng ở vạch {v}", { name, v: fmt(params.dwell, 0, " s") })
        : t("{name} · chuyển làn {v}", { name, v: `${params.direction === "left" ? t("trái") : t("phải")} ${fmt(params.duration, 0, " s")}` });
    const hint = step === 1 ? t("Bấm một xe viền hồng trên bản đồ để chọn xe gây sự kiện")
        : step === 2 ? t("Kéo thanh thời gian để chọn lúc bắt đầu · bấm Tạo tình huống để mô phỏng")
        : draft?.saved ? t("Đã lưu · bấm 3D hoặc Trong xe để mở bằng 3D") : t("Bấm Phát để xem xe sau phản ứng · Lưu vào thư viện để mở bằng 3D");
    const marks = timelineMarks(detail?.markers, kind, selected ? t0 : null, t);
    const technical = mode === "technical";
    const steps: [Step, string][] = [[1, t("Chọn xe")], [2, t(STEP2_LABEL[kind])], [3, t("Xem và lưu")]];
    const stepDone = (s: Step) => s === 1 ? !!selected : s === 2 ? !!draft : !!draft?.saved;

    return <div className={`rx-ws${technical ? "" : " simple"}`} data-testid="reactive-workspace" data-mode={mode}>
        <header className="rx-top">
            <select className="rx-select" aria-label={t("Dữ liệu")} value="current" disabled={busy}
                onChange={e => { if (e.target.value === "choose") props.onChooseDataset(); }}>
                <option value="current">{props.datasetName || t("Chưa chọn dữ liệu")}</option>
                <option value="choose">{t("Chọn dữ liệu khác…")}</option>
            </select>
            <select className="rx-select" aria-label={t("Cảnh")} value={scene} disabled={busy || !props.scenes.length} onChange={e => {
                if (e.target.value === scene) return;
                setLoadedSource(null); setCands({ status: "idle" }); setScene(e.target.value);
            }}>
                {props.scenes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ol className="rx-steps" aria-label={t("Các bước")}>
                {steps.map(([s, label]) => <li key={s} className={stepDone(s) ? "done" : step === s ? "on" : ""} aria-current={step === s ? "step" : undefined}>
                    <i>{stepDone(s) ? <Check size={12} aria-hidden/> : s}</i>{label}
                </li>)}
            </ol>
            <span className="rx-spacer"/>
            <span className="rx-engine">{metrics?.status === "ready" ? `engine ${metrics.data.engine} · ego 2 Hz` : "ego 2 Hz"}</span>
            <div className="rx-modes" role="group" aria-label={t("Chế độ hiển thị")}>
                <button type="button" aria-pressed={mode === "simple"} onClick={() => setMode("simple")}>{t("Đơn giản")}</button>
                <button type="button" aria-pressed={mode === "technical"} onClick={() => setMode("technical")}>{t("Kỹ thuật")}</button>
            </div>
        </header>
        <main className="rx-stage">
            {cands.status === "error" && cands.scene === scene ? <div className="rx-map view-empty"><p role="alert">{t(cands.error)}</p>
                <button type="button" onClick={retry}><RotateCw size={14} aria-hidden/> {t("Thử lại")}</button></div>
            : !source || !data ? <div className="rx-map view-empty" role="status">{loadingScene ? t("Đang tải cảnh") : t("Đang tìm xe phù hợp")}</div>
            : <ReactiveMap source={source} pkg={draft?.pkg ?? null} time={time} candidates={candidates} selected={selected} onPick={choose}
                detail={detail} kind={detail?.kind ?? kind} eventLabel={eventLabel} pickable={!busy} layers={layers} mode={mode} hint={hint}
                onToggleLayer={layer => setLayers(current => { const next = new Set(current); if (next.has(layer)) next.delete(layer); else next.add(layer); return next; })}
                saved={!!draft?.saved} onOpen3d={() => { if (draft) props.open3d(draft.pkg.id); }}/>}
        </main>
        <ReactiveTimeline time={time} duration={duration} playing={playing} onPlay={play} onSeek={seek} marks={marks} windows={windows}
            editing={step === 2} rate={rate} onRate={setRate} disabled={!data}/>
        <ReactiveInspector mode={mode} step={step} busy={busy} candidates={candidates} selected={selected} onSelect={choose}
            kind={kind} onKind={changeKind} params={{ ...params, target_mps: target }} onParams={changeParams} t0={t0} windows={windows}
            targetRange={range} target={target} detail={detail} verdict={verdict} error={error} saved={!!draft?.saved}
            onCreate={create} onReplay={() => { setTime(Math.max(0, t0 - LEAD_IN_S)); setPlaying(true); }}
            onSave={() => { if (draft) setDraft({ ...draft, saved: true }); }} onDiscard={invalidate} onNew={() => { setDraft(null); setPlaying(false); }}
            metrics={metrics} onRare={rare}/>
        {technical && <ReactiveDock scene={scene} busy={busy} detail={detail} report={draft?.pkg.report ?? null}
            esmini={draft ? props.esmini(draft.pkg.id) : null} onEsminiCheck={draft && props.onEsminiCheck ? () => props.onEsminiCheck!(draft.pkg.id) : undefined}
            metrics={metrics} labelProblems={data?.label_problems ?? []} onSeek={seek} onPickCell={pickCell} onPickKindCell={pickKindCell}
            reactiveMetrics={props.reactiveMetrics} replayErrorMetrics={props.replayErrorMetrics}
            onFill={choice => { fill(choice); }} onCreate={(_, event) => run(event, true)}/>}
        <p className="sr-only" aria-live="polite">{selected ? t("{kind} · {name}", { kind: t(KIND_LABEL[kind]), name: selected.name }) : ""}</p>
    </div>;
}
