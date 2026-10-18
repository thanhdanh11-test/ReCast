import { useEffect, useRef, useState } from "react";
import { Box, Map as MapIcon, Plus, Sparkles, Wand2, X } from "lucide-react";
import { useT } from "../i18n";
import { TacticalMap } from "../TacticalMap";
import { TrackView } from "../TrackView";
import { ScenarioCreator } from "../authoring/ScenarioCreator";
import type { ScenarioTemplate } from "../authoring/template";
import { ScenarioWorkspace, type CreateMode } from "../workspace/ScenarioWorkspace";
import { useScenarioSession } from "../workspace/useScenarioSession";
import { SceneList } from "./SceneList";
import { StudioTimeline, type TimelineMark } from "./StudioTimeline";
import { HistoryPanel } from "./HistoryPanel";
import { AnalysisPage } from "./AnalysisPage";
import { SaveDialog } from "./SaveDialog";
import { XmlEditDialog } from "./XmlEditDialog";
import { describeName, historyRows, initialOf, translateVars, type HistoryRow } from "./history";
import { assessmentOf, chosenActorIds, invalidityOf } from "./validity";
import { AssessmentDetails } from "./AssessmentDetails";
import type { Preferences } from "../preferences";
import type { SceneEnvironmentSettings } from "../weather";
import type { DesktopAPI, ExportFormat, ImportedScenario, Scenario, Scene } from "../types";
import "./studio.css";

const MODE_KEY = "topeye.studio.view";
type ViewMode = "2d" | "3d";
type Opened = { row: HistoryRow | null; pilot: ImportedScenario; baseline: ImportedScenario | null };
type Overlay = null | { kind: "menu" } | { kind: "available" } | { kind: "custom"; initial?: CreateMode["initial"] }
    | { kind: "analysis" } | { kind: "save"; row: HistoryRow }
    | { kind: "editTemplate"; row: HistoryRow; template: ScenarioTemplate | null } | { kind: "editXml"; row: HistoryRow; name: string; xml: string };
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const readMode = (): ViewMode => { try { return localStorage.getItem(MODE_KEY) === "3d" ? "3d" : "2d"; } catch { return "2d"; } };

/** Why a scenario cannot be exported for CARLA, known before asking the worker (plan50 D5). */
export function carlaBlocked(source: Scenario | null): string | null {
    const version = (source?.source as { dataset_version?: string } | undefined)?.dataset_version ?? "";
    return version.startsWith("av2") ? "Argoverse 2 không có tâm làn để dựng bản đồ .xodr; chỉ xuất được .xosc." : null;
}

/**
 * Scenario Studio (plan50): scene list · viewer (2D baseline/pilot or 3D) with a vehicle timeline · history of created
 * scenarios. Authoring reuses the existing dialogs/flows in overlays; nothing here computes scenarios or metrics.
 */
export function ScenarioStudio({ api, scene, scenes, source, mapErrors, onSelectScene, active, preferences, environmentSettings, onBusyChange, onDirtyChange, externalBusy = false, onExported }: {
    api: DesktopAPI; scene: string; scenes: Scene[]; source: Scenario | null; mapErrors: Record<string, string | null>;
    onSelectScene: (scene: string) => Promise<Scenario | null>; active: boolean; preferences: Preferences;
    environmentSettings: SceneEnvironmentSettings; onBusyChange?: (busy: boolean) => void; onDirtyChange?: (dirty: boolean) => void;
    externalBusy?: boolean; onExported?: () => void;
}) {
    const t = useT();
    const session = useScenarioSession(api, scene, source, { candidates: false });
    const rows = historyRows(session.entries, session.groups);
    const [opened, setOpened] = useState<Opened | null>(null);
    const [overlay, setOverlay] = useState<Overlay>(null);
    const [mode, setModeState] = useState<ViewMode>(readMode);
    const [time, setTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [pendingOpen, setPendingOpen] = useState<string | null>(null);
    const epoch = useRef(0), alive = useRef(true);
    /** plan52: packages already opened in this session (immutable: an edit makes a new id) — reopening is instant. */
    const cache = useRef(new Map<string, ImportedScenario>());
    const [used3d, setUsed3d] = useState(() => readMode() === "3d");
    const busy = working || externalBusy;
    const shown = opened?.pilot ?? null;
    /** What the viewer, timeline and playback show: the opened scenario, else the source scene itself. */
    const displayed = shown ?? session.source;
    const end = displayed?.interval_s[1] ?? 0;
    const setMode = (next: ViewMode) => { setModeState(next); if (next === "3d") setUsed3d(true); try { localStorage.setItem(MODE_KEY, next); } catch { /* per-viewer convenience only */ } };

    useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
    useEffect(() => { onBusyChange?.(working); return () => onBusyChange?.(false); }, [working]);
    useEffect(() => { onDirtyChange?.(overlay?.kind === "custom"); }, [overlay?.kind]);
    useEffect(() => { epoch.current++; setOpened(null); setOverlay(o => o?.kind === "custom" ? o : null); setTime(0); setPlaying(false); setError(""); setNotice(""); }, [scene]);
    useEffect(() => { if (!active) setPlaying(false); }, [active]);
    // Esc closes the menu and dialogs; the "Tự tạo" flow and the analysis page close with their back button.
    useEffect(() => {
        if (!overlay || overlay.kind === "custom" || overlay.kind === "analysis") return;
        const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOverlay(null); };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [overlay?.kind]);
    useEffect(() => {
        if (!active || !playing || !displayed) return;
        let previous = performance.now();
        const timer = window.setInterval(() => {
            const now = performance.now(), delta = (now - previous) / 1000 * (preferences.playbackRate ?? 1); previous = now;
            setTime(v => { if (v + delta >= end) { if (preferences.loop) return 0; setPlaying(false); return end; } return v + delta; });
        }, 50);
        return () => window.clearInterval(timer);
    }, [active, playing, displayed?.id, end, preferences.playbackRate, preferences.loop]);
    // Open a just-created scenario once the refreshed library lists it.
    useEffect(() => {
        if (!pendingOpen) return;
        const row = rows.find(r => r.id === pendingOpen || r.baseline?.scenario_id === pendingOpen);
        if (!row) return;
        setPendingOpen(null);
        // Already shown from what the create call returned: only attach the history row (no reopen).
        if (opened && (opened.pilot.id === row.id || opened.pilot.id === row.baseline?.scenario_id)) setOpened({ ...opened, row });
        else void openRow(row, true);
    }, [pendingOpen, session.entries, session.groups]);

    async function work(action: () => Promise<void>, keepNotice = false): Promise<boolean> {
        if (working || externalBusy) return false;
        const current = ++epoch.current;
        setWorking(true); setError(""); if (!keepNotice) setNotice(""); setPlaying(false);
        let ok = false;
        try { await action(); ok = true; } catch (e) { if (alive.current && current === epoch.current && !String(e).includes("CANCELLED")) setError(message(e)); }
        finally { if (alive.current && current === epoch.current) setWorking(false); }
        return ok;
    }
    async function cancel() {
        epoch.current++; setWorking(false); setPlaying(false); setNotice(t("Đã huỷ tác vụ"));
        await api.cancelJob?.().catch(() => {});
        void session.retry("source").catch(() => {}); void refresh();
    }
    async function checked<T>(promise: Promise<T>): Promise<T> { const current = epoch.current; const value = await promise; if (!alive.current || current !== epoch.current) throw new Error("CANCELLED"); return value; }
    const refresh = () => Promise.allSettled([session.refreshLibrary(), session.refreshGroups()]);
    const remember = (s: ImportedScenario | null) => { if (s) { cache.current.delete(s.id); cache.current.set(s.id, s); if (cache.current.size > 24) cache.current.delete(cache.current.keys().next().value!); } return s; };
    const open = async (entry: { scenario_id: string; package_path: string }) => cache.current.get(entry.scenario_id)
        ?? remember(await checked(session.sourceAction(source_id => api.openImported({ source_id, path: entry.package_path }))));

    async function openRow(row: HistoryRow, keepNotice = false) {
        return work(async () => {
            const pilot = await open(row.entry);
            const baseline = row.baseline ? await open(row.baseline) : null;
            if (!pilot) throw new Error(t("Không mở được gói đã chọn."));
            setOpened({ row, pilot, baseline }); setTime(0);
        }, keepNotice);
    }
    function show(result: ImportedScenario) { remember(result); setOpened({ row: null, pilot: result, baseline: null }); setTime(0); setPendingOpen(result.id); }
    async function created(result: ImportedScenario | null, replaced?: HistoryRow) {
        if (!result) { setNotice(t("Đã đóng hộp chọn · giữ nguyên cảnh đang xem.")); return; }
        if (replaced) for (const id of [replaced.entry.scenario_id, replaced.baseline?.scenario_id].filter(Boolean) as string[]) await checked(api.deleteImported({ scenario_id: id }));
        show(result); setNotice(result.import.file_name ? t("Đã lưu {name} vào lịch sử.", { name: result.import.file_name }) : t("Đã lưu kịch bản vào lịch sử."));
        await refresh();
    }
    const runCreate = (action: () => Promise<ImportedScenario | null>, replaced?: HistoryRow) => {
        let ok = false;
        return work(async () => { const result = await action(); await created(result, replaced); ok = !!result; }).then(done => done && ok);
    };
    const ensureCreate = () => { if (!session.canCreate) throw new Error(t("Map chưa hỗ trợ tạo kịch bản")); };

    async function edit(row: HistoryRow) {
        if (row.kind === "reaction" && row.group) { setOverlay({ kind: "custom", initial: initialOf(row.group) }); return; }
        await work(async () => {
            const doc = await checked(api.readImported({ scenario_id: row.entry.scenario_id }));
            setOverlay(doc.template ? { kind: "editTemplate", row, template: doc.template } : { kind: "editXml", row, name: doc.file_name, xml: doc.xml });
        });
    }
    async function remove(row: HistoryRow) {
        const what = row.baseline ? t("“{name}” (baseline + pilot)", { name: row.name }) : `“${row.name}”`;
        if (!window.confirm(t("Xoá kịch bản {what}? Gói và lịch sử chạy được chuyển vào thư mục .trash trong thư mục lưu.", { what }))) return;
        await work(async () => {
            for (const entry of [row.entry, row.baseline].filter(Boolean)) await checked(api.deleteImported({ scenario_id: entry!.scenario_id }));
            if (opened?.row?.id === row.id || opened?.pilot.id === row.id) setOpened(null);
            setNotice(t("Đã xoá {name}", { name: row.name }));
            await refresh();
        });
    }
    async function analyse(row: HistoryRow) {
        if (opened?.pilot.id !== row.id && !(await openRow(row))) return;
        setOverlay({ kind: "analysis" });
    }
    async function exportRow(row: HistoryRow, format: ExportFormat) {
        if (!api.exportScenario) return;
        const ok = await work(async () => { await checked(api.exportScenario!({ scenario_id: row.id, format })); });
        if (ok) { setOverlay(null); setNotice(t("Đã thêm “{name}” vào trang Đã xuất.", { name: row.name })); onExported?.(); }
    }

    const titleOf = (name: string) => { const d = describeName(name.replace(/\.xosc$/i, "")); return d ? t(d.key, translateVars(d.vars, t)) : name; };
    const report = shown?.report;
    // plan52: frame the ego and the event vehicle together when a reaction opens (default frame is 130 m wide).
    const focusSpan = (() => {
        const actor = report?.event?.actor, t0 = report?.event?.t0;
        const ego = shown?.actors.find(a => a.role === "ego"), other = shown?.actors.find(a => a.id === actor);
        if (!ego || !other || t0 == null) return undefined;
        const at = (a: typeof ego) => a.samples.reduce((best, p) => Math.abs(p.t_s - t0) < Math.abs(best.t_s - t0) ? p : best, a.samples[0]);
        const e = at(ego), o = at(other);
        return Math.min(130, Math.max(45, 2 * Math.hypot(o.x_m - e.x_m, o.y_m - e.y_m) + 30));
    })();
    const invalid = shown ? invalidityOf(opened?.row?.entry, shown) : null;
    const assessment = assessmentOf(shown?.report);
    const marks: TimelineMark[] = [];
    if (report?.event?.t0 != null) {
        marks.push({ t: report.event.t0, label: t("Tình huống"), tone: "event" });
        if (report.drivers?.react && report.drivers.reaction_s != null) marks.push({ t: report.event.t0 + report.drivers.reaction_s, label: t("Phản ứng"), tone: "reaction" });
    }
    const creatorProps = {
        scenes: scenes.map(r => r.scene), busy, mapStatus: api.mapStatus, error: error || undefined,
        creationBlocked: session.canCreate ? undefined : session.pending.map || session.pending.source ? t("Đang kiểm tra map…") : t("Map chưa hỗ trợ tạo kịch bản"),
        onSceneChange: (value: string) => { void onSelectScene(value).catch(e => setError(message(e))); },
        onExportMap: () => work(async () => { const r = await checked(session.sourceAction(source_id => api.exportMapContext({ source_id }))); if (r) setNotice(t("Đã xuất thông tin map: {path}.", { path: r.path })); }),
        onImportXosc: () => runCreate(async () => { ensureCreate(); return checked(session.sourceAction(source_id => api.importXosc({ source_id }))); }),
        onImportPackage: async () => {
            ensureCreate();
            const files = await api.pickPackage();
            if (!files) return false;
            const src = files.scene && files.scene !== scene ? await onSelectScene(files.scene) : session.source;
            if (!src) return false;
            return runCreate(() => checked(api.importPackage({ source_id: src.id, files: files.files })));
        },
        fitTemplate: api.templateFit ? (s: string, template: ScenarioTemplate) => api.templateFit({ scene: s, template }) : undefined,
    };
    const closeOverlay = () => { setOverlay(null); setError(""); };
    /** Dialogs show the worker error themselves (plan52: it used to sit hidden behind the modal). */
    const dialogOpen = overlay?.kind === "available" || overlay?.kind === "editTemplate" || overlay?.kind === "editXml";
    const hideCenter = overlay?.kind === "custom" || overlay?.kind === "analysis";

    return <main className="studio-page" data-testid="scenario-studio">
        <aside className="studio-scenes" aria-label={t("Cảnh")}>
            <h2>{t("Cảnh")}</h2>
            <SceneList scenes={scenes} current={scene} disabled={busy} mapErrors={mapErrors} onOpen={row => { void onSelectScene(row.scene).catch(e => setError(message(e))); }}/>
            <div className="studio-create">
                {overlay?.kind === "menu" && <div className="studio-create-menu" role="menu" aria-label={t("Kiểu kịch bản")}>
                    <button role="menuitem" onClick={() => setOverlay({ kind: "available" })}><Sparkles size={16} aria-hidden/><strong>{t("Kịch bản có sẵn")}</strong><span>{t("Chọn từ 20 mẫu, hoặc nạp tệp .xosc / gói real2sim.")}</span></button>
                    <button role="menuitem" disabled={!session.canCreate} onClick={() => setOverlay({ kind: "custom" })}><Wand2 size={16} aria-hidden/><strong>{t("Tự tạo")}</strong><span>{t("Chọn xe, cho xe phía trước phanh / tăng tốc / dừng / chuyển làn, xem các xe khác phản ứng.")}</span></button>
                </div>}
                <button className="primary full-width create-scenario" aria-haspopup="menu" aria-expanded={overlay?.kind === "menu"} disabled={!session.source || busy}
                    title={session.canCreate ? undefined : session.pending.map || session.pending.source ? t("Đang kiểm tra map…") : t("Map chưa hỗ trợ tạo kịch bản")}
                    onClick={() => setOverlay(o => o?.kind === "menu" ? null : { kind: "menu" })}><Plus size={14} aria-hidden/>{t("Tạo kịch bản")}</button>
            </div>
        </aside>

        <section className="studio-center" aria-label={t("Xem kịch bản")} hidden={hideCenter}>
            <header className="studio-center-head">
                <div><small>{scene}</small><strong title={opened?.row?.name}>{shown ? titleOf(opened?.row?.name ?? shown.import.file_name ?? shown.id.slice(0, 8)) : t("Cảnh gốc · dữ liệu thật")}</strong></div>
                <div className="studio-switch" role="group" aria-label={t("Cách xem")}>
                    <button aria-pressed={mode === "2d"} onClick={() => setMode("2d")}><MapIcon size={14} aria-hidden/>2D</button>
                    <button aria-pressed={mode === "3d"} onClick={() => setMode("3d")}><Box size={14} aria-hidden/>3D</button>
                </div>
            </header>
            {working && <div className="studio-notice" role="status">{t("Đang xử lý…")}<button onClick={() => void cancel()}>{t("Huỷ tác vụ")}</button></div>}
            {notice && <div className="studio-notice" role="status">{notice}<button aria-label={t("Đóng")} onClick={() => setNotice("")}><X size={12}/></button></div>}
            {error && !dialogOpen && <div className="studio-inline-error" role="alert"><span>{error.replace(/^[A-Z_]+: /, "")}</span><button aria-label={t("Đóng")} onClick={() => setError("")}><X size={12}/></button></div>}
            {(session.errors.source || session.errors.map) && <div className="studio-inline-error" role="alert"><span>{session.errors.map ? t("Map chưa hỗ trợ tạo kịch bản") : t("Không tải được dữ liệu")}</span>
                <button onClick={() => void session.retry(session.errors.map ? "map" : "source").catch(() => {})}>{t("Thử lại")}</button><details><summary>{t("Chi tiết lỗi")}</summary>{session.errors.map ?? session.errors.source}</details></div>}
            <div className="studio-stage">
                {mode === "2d" && <TacticalMap scenario={displayed} replay={null} time={time} overlay={opened?.baseline ?? null} span={focusSpan}/>}
                {/* plan52: once used, the 3D view stays mounted (hidden in 2D) so switching back is instant. */}
                {(used3d || mode === "3d") && <div className="studio-3d" hidden={mode !== "3d"}><TrackView scenario={displayed} replay={null} time={time} active={active && !hideCenter && mode === "3d"} display={preferences} environmentSettings={environmentSettings}/></div>}
            </div>
            {invalid && shown && <div className="studio-invalid" role="alert">
                <strong>{assessment ? t(assessment.title) : invalid.code === "EGO_COLLISION" ? t("Có va chạm") : t("Chưa đạt kiểm định")}</strong>
                {assessment ? <AssessmentDetails assessment={assessment} summary={invalid.message}/> : <p>{invalid.message}</p>}
                {invalid.hints.length > 0 && <><small>{t("Cách sửa")}</small><ul>{invalid.hints.map(h => <li key={h.key}>{t(h.key, h.vars)}</li>)}</ul></>}
                {opened?.row && opened.row.kind !== "real2sim" && <button disabled={busy} onClick={() => void edit(opened.row!)}>{t("Sửa kịch bản")}</button>}
            </div>}
            <StudioTimeline scenario={displayed} actorIds={shown ? chosenActorIds(shown) : null} baseline={opened?.baseline ?? null} duration={end} time={time} playing={playing} marks={marks} eventActor={report?.event?.actor}
                onPlay={() => { if (time >= end) setTime(0); setPlaying(p => !p); }} onRestart={() => { setTime(0); setPlaying(false); }} onSeek={v => { setTime(v); setPlaying(false); }}/>
        </section>

        {overlay?.kind === "custom" && <div className="studio-overlay">
            <ScenarioWorkspace api={api} scene={scene} source={source} scenes={scenes.map(r => r.scene)} onSelectScene={async v => { const s = await onSelectScene(v); if (!s) throw new Error("CANCELLED"); return s; }}
                active={active} preferences={preferences} environmentSettings={environmentSettings} externalBusy={busy} onBusyChange={onBusyChange}
                create={{ initial: overlay.initial, onClose: closeOverlay, onCreated: (id, pair) => {
                    remember(pair.baseline); remember(pair.pilot);
                    setOpened({ row: null, pilot: pair.pilot, baseline: pair.baseline }); setTime(0);
                    setOverlay(null); setNotice(t("Đã lưu baseline và pilot vào lịch sử.")); setPendingOpen(id); void refresh(); } }}/>
        </div>}
        {overlay?.kind === "analysis" && shown && <div className="studio-overlay">
            <AnalysisPage api={api} name={opened?.row?.name ?? shown.id.slice(0, 8)} pilot={shown} onBack={closeOverlay} onSeek={v => { setTime(v); setPlaying(false); }}/>
        </div>}

        {!hideCenter && <HistoryPanel rows={rows} activeId={opened?.row?.id ?? opened?.pilot.id ?? null} busy={busy} error={session.errors.library}
            onRetry={() => void refresh()} onOpen={row => void openRow(row)} onEdit={row => void edit(row)} onDelete={row => void remove(row)}
            onAnalyse={row => void analyse(row)} onSave={api.exportScenario ? row => setOverlay({ kind: "save", row }) : undefined}/>}

        {overlay?.kind === "available" && <ScenarioCreator {...creatorProps} currentScene={scene} onClose={closeOverlay}
            onCreateTemplate={template => runCreate(async () => { ensureCreate(); return checked(session.sourceAction(source_id => api.importTemplate({ source_id, template }))); })}/>}
        {overlay?.kind === "editTemplate" && <ScenarioCreator {...creatorProps} currentScene={overlay.template?.map.scene ?? overlay.row.entry.scene} onClose={closeOverlay}
            editing={{ name: overlay.row.name, template: overlay.template }}
            onCreateTemplate={template => runCreate(() => checked(session.sourceAction(source_id => api.importTemplate({ source_id, template }))), overlay.row).then(ok => { if (ok) setOverlay(null); return ok; })}/>}
        {overlay?.kind === "editXml" && <XmlEditDialog entry={overlay.row.entry} name={overlay.name} xml={overlay.xml} busy={busy} error={error} onClose={closeOverlay}
            onRecreate={() => setOverlay({ kind: "editTemplate", row: overlay.row, template: null })}
            onSave={(name, xml) => runCreate(() => checked(session.sourceAction(source_id => api.importXosc({ source_id, xml, file_name: name }))), overlay.row)}/>}
        {overlay?.kind === "save" && <SaveDialog name={overlay.row.name} busy={busy} carlaBlocked={carlaBlocked(session.source)} onCancel={closeOverlay} onConfirm={format => void exportRow(overlay.row, format)}/>}
    </main>;
}
