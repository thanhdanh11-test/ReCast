import topeyeLogo from "./assets/topeye-logo.png";
import type { ScenarioTemplate } from "./authoring/template";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ImportedEntry, Replay, Scene, Scenario, Settings } from "./types";
import { TrackView } from "./TrackView";
import { LidarView } from "./LidarView";
import { TacticalMap } from "./TacticalMap";
import { playbackEnd } from "./trajectory";
import { environmentSettingsFor } from "./weather";
import { loadPreferences, savePreferences, useResolvedTheme, type Preferences } from "./preferences";
import { SettingsPage } from "./SettingsPage";
import { advancePlayback } from "./playback";
import { LanguageProvider, translate, useT, type Translate } from "./i18n";
import { ModelCredits } from "./ModelCredits";
import { IconRail, type RailItem } from "./IconRail";
import { ScenarioRunner } from "./ScenarioRunner";
import type { MetricsState } from "./MetricsPanel";
import { Clapperboard, Database, LoaderCircle, Map, Maximize2, Minimize2, Settings as SettingsIcon, X } from "lucide-react";
import "./scenario.css";
const api = window.scenarioApp;
type Tool = "scene";
type View = "scene" | "runner";
export default function ScenarioApp({ onLibrary, onLogout }: { onLibrary?: () => void; onLogout?: () => void } = {}) {
    const [settings, setSettings] = useState<Settings | null>(null), [scenes, setScenes] = useState<Scene[]>([]), [sceneName, setSceneName] = useState("");
    const [original, setOriginalState] = useState<Scenario | null>(null);
    // Latest source for sequential jobs (batch runs read it across awaits, after re-renders).
    const originalRef = useRef<Scenario | null>(null);
    const setOriginal = (value: Scenario | null) => { originalRef.current = value; setOriginalState(value); };
    const [scenario, setScenario] = useState<Scenario | null>(null), [replay, setReplay] = useState<Replay | null>(null);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(() => translate(loadPreferences().language, "Sẵn sàng")), [error, setError] = useState("");
    const [time, setTime] = useState(0), [playing, setPlaying] = useState(false);
    // Weather moves to scenario authoring; the 3D view keeps ClearNoon and only the quality is a setting.
    const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
    // This component renders the LanguageProvider, so it translates from its own state, not the context.
    const t: Translate = (vi, vars) => translate(preferences.language, vi, vars);
    const theme = useResolvedTheme(preferences.appearance);
    const environmentSettings = useMemo(() => environmentSettingsFor("ClearNoon", preferences.quality), [preferences.quality]);
    const updatePreferences = (change: Partial<Preferences>) => setPreferences(current => ({ ...current, ...change }));
    // Saved after commit: saving notifies the login/library screens, which must not update mid-render.
    const firstPreferences = useRef(preferences);
    useEffect(() => { if (preferences !== firstPreferences.current) savePreferences(preferences); }, [preferences]);
    const [expanded, setExpanded] = useState<"track" | "lidar" | "map" | null>(null);
    const [view, setView] = useState<View>("scene");
    // True from the start of a scene load until the 3D view has drawn that scene (no blank/white gap).
    const [sceneLoading, setSceneLoading] = useState(false);
    // Scenario metrics are computed automatically in the background (own worker) for the opened scenario.
    const [metrics, setMetrics] = useState<MetricsState | null>(null);
    const metricsCache = useRef(new globalThis.Map<string, MetricsState>());
    const [tool, setTool] = useState<Tool | null>(null);
    const [railWide, setRailWide] = useState(false);
    // Full-page settings overlays the views; they stay mounted so the 3D scene is not rebuilt.
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [library, setLibrary] = useState<ImportedEntry[]>([]);
    const [activeEntry, setActiveEntry] = useState<string | null>(null);
    const runnerSnapshot = useRef<{ scenario: Scenario; replay: Replay | null } | null>(null);
    useEffect(() => {
        if (!expanded && !tool && !settingsOpen) return;
        const key = (event: KeyboardEvent) => { if (event.key !== "Escape") return; if (settingsOpen) setSettingsOpen(false); else if (expanded) setExpanded(null); else setTool(null); };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [expanded, tool, settingsOpen]);
    const demo = settings?.mode === "web-demo";
    const workspaceRef = useRef<HTMLElement>(null);
    function feedback() {
        const url = new URL(import.meta.env.VITE_FEEDBACK_URL, window.location.href);
        if (!['https:', 'http:'].includes(url.protocol)) return;
        url.search = '';
        url.searchParams.set('scene', sceneName);
        url.searchParams.set('time', time.toFixed(1));
        url.searchParams.set('camera', workspaceRef.current?.querySelector<HTMLElement>('[data-camera-mode]')?.dataset.cameraMode ?? 'follow');
        url.searchParams.set('weather', environmentSettings.preset);
        url.searchParams.set('version', settings?.version ?? '');
        window.open(url.href, '_blank', 'noopener,noreferrer');
    }
    const busyRef = useRef(false);
    const generation = useRef(0);
    const cancelling = useRef(false);
    async function checked<T>(promise: Promise<T>): Promise<T> {
        const started = generation.current;
        const value = await promise;
        if (started !== generation.current)
            throw new Error("CANCELLED");
        return value;
    }
    const timelineEnd = playbackEnd(scenario, replay);
    async function job<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
        if (busyRef.current)
            return;
        const started = ++generation.current;
        busyRef.current = true;
        setBusy(true);
        setError("");
        setMessage(label);
        setPlaying(false);
        try {
            return await work();
        }
        catch (e) {
            if (started !== generation.current)
                return;
            setError(String(e).replace(/^Error: /, ""));
            setMessage(t("Cần kiểm tra lại"));
        }
        finally {
            if (started === generation.current) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    }
    async function loadSource(s: Scene): Promise<Scenario> {
        setSceneLoading(true);
        const source = await checked(api!.sourceScene({ scene: s.scene }));
        setOriginal(source);
        setScenario(source);
        setReplay(null);
        setTime(0);
        setMessage(t("Cảnh gốc: {actors} đối tượng · {buildings} khối nhà", { actors: source.actors.length, buildings: source.environment?.buildings.length || 0 }));
        return source;
    }
    function selectScene(s: Scene) {
        setOriginal(null);
        setSceneName(s.scene);
        setScenario(null);
        setReplay(null);
        setTime(0);
    }
    async function refresh() {
        if (!api)
            return;
        setSceneLoading(true);
        setSettings(await checked(api.settings()));
        const rows = await checked(api.listScenes());
        setScenes(rows);
        const s = rows.find((r) => r.scene === "scene-0103") || rows[0];
        if (s) {
            selectScene(s);
            await loadSource(s);
        }
        setMessage(t("Đã đọc {n} cảnh", { n: rows.length }));
    }
    useEffect(() => {
        if (!api)
            return;
        let disposed = false;
        api.settings().then(s => {
            if (disposed)
                return;
            setSettings(s);
            if (s.dataset)
                void job(t("Đang đọc dữ liệu"), refresh);
        }).catch(e => { if (!disposed)
            setError(String(e)); });
        const unsubscribe = api.onProgress(p => {
            if (busyRef.current && !cancelling.current)
                setMessage(p.phase);
        });
        return () => { disposed = true; generation.current++; unsubscribe(); };
    }, []);
    async function cancel() {
        if (cancelling.current || !api)
            return;
        cancelling.current = true;
        generation.current++;
        setPlaying(false);
        setMessage(t("Đang huỷ tác vụ"));
        try {
            await api.cancelJob();
            setOriginal(null); setScenario(null); setReplay(null); setTime(0); runnerSnapshot.current = null;
            setMessage(t("Đã huỷ · tạo lại kịch bản để tiếp tục"));
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            cancelling.current = false;
            busyRef.current = false;
            setBusy(false);
        }
    }
    useEffect(() => { if (!busy && !scenario) setSceneLoading(false); }, [busy, scenario]);
    const sceneReady = () => {
        setSceneLoading(false);
        if (preferences.autoplay) setPlaying(true);
    };
    const metricsScene = view === "runner" && scenario?.mode === "imported" && settings?.mode !== "web-demo" ? scenario.id : null;
    const metricsSceneRef = useRef(metricsScene);
    metricsSceneRef.current = metricsScene;
    useEffect(() => {
        if (!metricsScene || !api?.scenarioMetrics) { setMetrics(null); return; }
        const cached = metricsCache.current.get(metricsScene);
        if (cached && cached.status !== "error") { setMetrics(cached); return; }
        const loading: MetricsState = { key: metricsScene, status: "loading" };
        metricsCache.current.set(metricsScene, loading);
        setMetrics(loading);
        api.scenarioMetrics({ scenario_id: metricsScene }).then(data => {
            const ready: MetricsState = { key: metricsScene, status: "ready", data };
            metricsCache.current.set(metricsScene, ready);
            if (metricsSceneRef.current === metricsScene) setMetrics(ready);
        }, (e: unknown) => {
            const failed: MetricsState = { key: metricsScene, status: "error", error: String(e instanceof Error ? e.message : e) };
            metricsCache.current.set(metricsScene, failed);
            if (metricsSceneRef.current === metricsScene) setMetrics(failed);
        });
    }, [metricsScene]);
    useEffect(() => {
        if (!playing || !scenario)
            return;
        let last = performance.now();
        const timer = setInterval(() => {
            const now = performance.now(), dt = (now - last) / 1000;
            last = now;
            setTime((t) => {
                const step = advancePlayback(t, dt, preferences.playbackRate, timelineEnd, preferences.loop);
                if (step.done) setPlaying(false);
                return step.time;
            });
        }, 40);
        return () => clearInterval(timer);
    }, [playing, scenario, timelineEnd, preferences.playbackRate, preferences.loop]);
    // Playback shortcuts (Cài đặt › Thông tin lists them); never while typing or on the settings page.
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (settingsOpen || busy || !scenario || event.metaKey || event.ctrlKey || event.altKey) return;
            if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))) return;
            if (event.key === " ") { event.preventDefault(); setPlaying(p => { if (!p && time >= timelineEnd) setTime(0); return !p; }); }
            else if (event.key === "ArrowLeft") { event.preventDefault(); setTime(t => Math.max(0, t - 1)); }
            else if (event.key === "ArrowRight") { event.preventDefault(); setTime(t => Math.min(timelineEnd, t + 1)); }
            else if (event.key === "Home") { event.preventDefault(); setPlaying(false); setTime(0); }
            else if (event.key === "End") { event.preventDefault(); setPlaying(false); setTime(timelineEnd); }
        };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [settingsOpen, busy, scenario, time, timelineEnd]);
    const imported = scenario?.mode === "imported";
    const resetPlayback = () => { setReplay(null); setTime(0); setPlaying(false); };
    // ---- OpenSCENARIO library (plan26) -------------------------------------------------------
    async function refreshLibrary() {
        if (!api?.listImported) return;
        setLibrary(await checked(api.listImported()));
    }
    // Runs as a normal job: the worker serves one request at a time, so a concurrent read would make the next action BUSY.
    useEffect(() => { if (view === "runner" && settings?.dataset) void job(t("Đang đọc thư viện kịch bản"), refreshLibrary); }, [view, settings?.dataset]);
    /** Make `scene` the loaded source (reusing it when already loaded) and return it. */
    async function ensureSource(scene: string): Promise<Scenario> {
        const loaded = originalRef.current;
        if (loaded && loaded.source.scene === scene) return loaded;
        const row = scenes.find(s => s.scene === scene);
        if (!row) throw new Error("DATASET_INVALID: " + t("Không có cảnh {scene} trong dữ liệu đang mở", { scene }));
        selectScene(row);
        return loadSource(row);
    }
    /** Imported scenario becomes the runner's active one. */
    function showImported(s: Scenario, label: string, entryId = s.id) {
        setScenario(s); resetPlayback(); setActiveEntry(entryId);
        setMessage(label);
    }
    /** Load the entry's source scene when needed, then open its saved package (no picker). */
    async function openEntry(entry: ImportedEntry): Promise<Scenario> {
        const source = await ensureSource(entry.scene);
        const s = await checked(api!.openImported({ source_id: source.id, path: entry.package_path }));
        if (!s) throw new Error("CANCELLED");
        showImported(s, t("Đã mở {name}", { name: entry.name }), entry.scenario_id);
        return s;
    }
    function createScenario(scene: string) {
        return job(t("Đang nạp OpenSCENARIO"), async () => {
            const source = await ensureSource(scene);
            const s = await checked(api!.importXosc({ source_id: source.id }));
            if (!s) { setMessage(t("Đã đóng hộp chọn · giữ nguyên cảnh đang xem")); return false; }
            showImported(s, t("Đã nạp OpenSCENARIO · {n} đối tượng · đúng map hiện tại", { n: s.actors.length }));
            await refreshLibrary();
            return true;
        });
    }
    function createFromTemplate(template: ScenarioTemplate) {
        return job(t("Đang tạo kịch bản từ template"), async () => {
            const source = await ensureSource(template.map.scene);
            const s = await checked(api!.importTemplate({ source_id: source.id, template }));
            const at = s.placement ? Math.round(s.placement.start_m) : 0;
            const label = s.placement?.mirror ? "Đã tạo {name} · {n} đối tượng · đặt tại {at} m trên quỹ đạo xe nguồn, lật trái ↔ phải" : "Đã tạo {name} · {n} đối tượng · đặt tại {at} m trên quỹ đạo xe nguồn";
            showImported(s, t(label, { name: template.name, n: s.actors.length, at }));
            await refreshLibrary();
            return true;
        });
    }
    function exportMap(scene: string) {
        return job(t("Đang xuất thông tin map"), async () => {
            const source = await ensureSource(scene);
            const r = await checked(api!.exportMapContext({ source_id: source.id }));
            setMessage(r ? t("Đã xuất thông tin map: {path}", { path: r.path }) : t(t("Đã đóng hộp chọn · giữ nguyên cảnh đang xem")));
        });
    }
    function exportEntry(entry: ImportedEntry) {
        return job(t("Đang xuất {name}", { name: entry.name }), async () => {
            const data = await checked(api!.readImported({ scenario_id: entry.scenario_id }));
            const url = URL.createObjectURL(new Blob([data.xml], { type: "application/xml" }));
            const link = document.createElement("a");
            link.href = url; link.download = data.file_name;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            setMessage(t("Đã xuất {name} (thư mục Tải về)", { name: data.file_name }));
        });
    }
    function loadEntryXml(entry: ImportedEntry) {
        return job(t("Đang mở {name} để sửa", { name: entry.name }), () => checked(api!.readImported({ scenario_id: entry.scenario_id })));
    }
    /** Packages are immutable: a valid edit is imported as a new package, then the old one is trashed. */
    function saveEdit(entry: ImportedEntry, name: string, xml: string) {
        return job(t("Đang lưu {name}", { name }), async () => {
            const source = await ensureSource(entry.scene);
            const s = await checked(api!.importXosc({ source_id: source.id, xml, file_name: name }));
            if (!s) return false;
            await checked(api!.deleteImported({ scenario_id: entry.scenario_id }));
            if (runnerSnapshot.current?.scenario.id === entry.scenario_id) runnerSnapshot.current = null;
            showImported(s, t("Đã lưu {name}", { name }));
            await refreshLibrary();
            return true;
        });
    }
    /** Same as saveEdit, but the new package is compiled from the edited template. */
    function saveTemplateEdit(entry: ImportedEntry, template: ScenarioTemplate) {
        return job(t("Đang lưu {name}", { name: entry.name }), async () => {
            const source = await ensureSource(template.map.scene);
            const s = await checked(api!.importTemplate({ source_id: source.id, template }));
            await checked(api!.deleteImported({ scenario_id: entry.scenario_id }));
            if (runnerSnapshot.current?.scenario.id === entry.scenario_id) runnerSnapshot.current = null;
            showImported(s, t("Đã lưu {name}", { name: template.name }));
            await refreshLibrary();
            return true;
        });
    }
    function deleteRun(entry: ImportedEntry, runId: string) {
        if (!window.confirm(t("Xoá lần chạy này khỏi lịch sử? Kịch bản được giữ nguyên; kết quả chuyển vào .trash."))) return;
        void job(t("Đang xoá lịch sử"), async () => {
            await checked(api!.deleteImportedRun({ scenario_id: entry.scenario_id, run_id: runId }));
            if (scenario?.id === entry.scenario_id) { setReplay(null); setPlaying(false); }
            if (runnerSnapshot.current?.scenario.id === entry.scenario_id) runnerSnapshot.current = null;
            await refreshLibrary();
            setMessage(t("Đã xoá lần chạy khỏi lịch sử"));
        });
    }
    function deleteEntry(entry: ImportedEntry) {
        if (!window.confirm(t("Xoá kịch bản “{name}”? Gói và lịch sử chạy được chuyển vào thư mục .trash trong thư mục lưu.", { name: entry.name }))) return;
        void job(t("Đang xoá {name}", { name: entry.name }), async () => {
            await checked(api!.deleteImported({ scenario_id: entry.scenario_id }));
            if (activeEntry === entry.scenario_id) setActiveEntry(null);
            if (scenario?.id === entry.scenario_id) { setScenario(originalRef.current); resetPlayback(); }
            if (runnerSnapshot.current?.scenario.id === entry.scenario_id) runnerSnapshot.current = null;
            setMessage(t("Đã xoá {name}", { name: entry.name }));
            await refreshLibrary();
        });
    }
    if (!api)
        return <main className="studio view-empty"><h1>Topeye</h1><p>{t("Chạy `npm run web:local` để mở Topeye.")}</p></main>;
    const warnings = scenario?.environment?.warnings ?? [];
    const railItems: RailItem[] = [
        { id: "scene", label: t("Cảnh nguồn"), icon: <Map size={20} aria-hidden/> },
        ...(!demo ? [{ id: "runner", label: "OpenSCENARIO", icon: <Clapperboard size={20} aria-hidden/>, separatorBefore: true }] : []),
        { id: "settings", label: t("Cài đặt"), icon: <SettingsIcon size={20} aria-hidden/>, bottom: true },
    ];
    function onRail(id: string) {
        if (id === "settings") { setSettingsOpen(open => !open); setTool(null); return; }
        setSettingsOpen(false);
        if (id === "runner") { showRunner(); setTool(null); return; }
        const next = id as Tool;
        if (next === "scene") showScene();
        setTool(tool === next ? null : next);
    }
    const playback = <div className="playback-bar">
      <button aria-label={t("Về đầu")} disabled={!scenario || busy} onClick={() => { setPlaying(false); setTime(0); }}>↤</button>
      <button className="play-button" aria-label={playing ? t('Tạm dừng') : t('Phát mô phỏng')} disabled={!scenario || busy} onClick={() => {
            if (time >= timelineEnd)
                setTime(0);
            setPlaying(!playing);
        }}>{playing ? 'Ⅱ' : '▶'}</button>
      <button aria-label={t("Về cuối")} disabled={!scenario || busy} onClick={() => { setPlaying(false); setTime(timelineEnd); }}>↦</button>
      <div className="timeline-track">
        <input aria-label={t("Thời gian mô phỏng")} type="range" min="0" max={timelineEnd || 1} step=".01" value={time} disabled={!scenario || busy} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }}/>
      </div>
      <output>{time.toFixed(2)} <span>/ {timelineEnd.toFixed(2)}s</span></output>
    </div>;
    const drawers: Record<Tool, { title: string; body: ReactNode }> = {
        scene: { title: t("Cảnh nguồn"), body: scenes.length ? <ul className="scene-list" aria-label={t("Danh sách cảnh")}>
          {scenes.map(s => {
            const active = s.scene === sceneName && scenario?.mode === "source";
            return <li key={s.scene}><button aria-current={active ? "true" : undefined} disabled={busy} onClick={() => openScene(s)}>
              <strong>{s.scene}</strong><small>{s.duration_s.toFixed(1).replace(".", ",")} s · {t("{n} đối tượng", { n: s.tracks.length })}</small>
            </button></li>;
          })}
        </ul> : <p className="sensor-note">{t("Chưa có dữ liệu. Mở “Cài đặt” để chọn thư mục dữ liệu.")}</p> },
    };
    /**
     * The scene view only ever shows the loaded source scene; the runner shows imported scenarios.
     * Switching views swaps what is displayed and remembers the runner's scenario/result.
     */
    function showScene() {
        if (view === "runner" && scenario?.mode === "imported") runnerSnapshot.current = { scenario, replay };
        setView("scene");
        if (scenario !== originalRef.current) {
            setScenario(originalRef.current);
            resetPlayback();
        }
    }
    function showRunner() {
        setView("runner");
        const snapshot = runnerSnapshot.current;
        if (view !== "runner" && snapshot) {
            setScenario(snapshot.scenario);
            setReplay(snapshot.replay);
            setTime(0);
            setPlaying(false);
        }
    }
    /** Open a scene from the list; re-selecting the loaded scene returns to its original data. */
    function openScene(s: Scene) {
        showScene();
        if (original && original.source.scene === s.scene) {
            setScenario(original);
            resetPlayback();
            return;
        }
        selectScene(s);
        void job(t('Đang dựng cảnh gốc'), () => loadSource(s));
    }
    const drawer = tool ? drawers[tool] : null;
    const activeRail = settingsOpen ? "settings" : view === "runner" && !tool ? "runner" : tool;
    async function chooseDataset() {
        await job(t("Đang mở dữ liệu"), async () => {
            const res = await checked(api!.chooseDataset());
            if (res) {
                setSettings(await checked(api!.settings()));
                setScenes(res.scenes);
                const s = res.scenes[0];
                if (s) {
                    selectScene(s);
                    await loadSource(s);
                }
                setMessage(t("Đã đọc {n} cảnh", { n: res.scenes.length }));
            }
        });
    }
    const chooseWorkspace = () => void job(t('Chọn nơi lưu'), async () => { await checked(api!.chooseWorkspace()); setSettings(await checked(api!.settings())); setMessage(t('Đã cập nhật nơi lưu')); });
    const feedbackContext: Record<string, string> = {
        version: settings?.version ?? "", ...(settings?.dataset ? { dataset: settings.dataset } : {}),
        ...(sceneName ? { scene: sceneName } : {}), view, userAgent: navigator.userAgent.slice(0, 300),
    };
    return <LanguageProvider value={preferences.language}><div className="studio" data-theme={theme}>
    <header className="studio-header">
      <div className="studio-brand"><img className="brand-mark" src={topeyeLogo} alt="Logo Topeye"/><h1>Topeye</h1></div>
      {onLibrary && <button type="button" className="studio-library-button" disabled={busy} onClick={onLibrary}><Database size={14} aria-hidden/>{t("Thư viện map")}</button>}
      {busy && <div className="busy-indicator" data-testid="busy-indicator"><LoaderCircle size={14} className="spin" aria-hidden/><span>{message}</span><button disabled={cancelling.current} onClick={() => void cancel()}>{t("Huỷ tác vụ")}</button></div>}
    </header>
    <div className="studio-body">
      <IconRail items={railItems} active={activeRail} wide={railWide} onToggleWide={() => setRailWide(v => !v)} onSelect={onRail}/>
      {settingsOpen && <SettingsPage preferences={preferences} onChange={updatePreferences} onBack={() => setSettingsOpen(false)} demo={demo}
        api={api} settings={settings} busy={busy} onChooseDataset={() => void chooseDataset()} onChooseWorkspace={chooseWorkspace}
        onLogout={onLogout} feedbackContext={feedbackContext} onOpenFeedbackForm={import.meta.env.VITE_FEEDBACK_URL ? feedback : undefined}/>}
      <div className="studio-views" hidden={settingsOpen}>
      {drawer && <aside className={`tool-drawer${tool === "scene" ? " narrow" : ""}`} aria-label={drawer.title}>
        <div className="drawer-head"><h2>{drawer.title}</h2><button className="icon-button" aria-label={t("Đóng ngăn")} onClick={() => setTool(null)}><X size={14} aria-hidden/></button></div>
        {drawer.body}
        {demo && <div className="drawer-credits"><ModelCredits/><p className="sensor-note">nuScenes © Motional, CC BY-NC-SA 4.0</p><p className="sensor-note">CARLA weather presets · MIT</p></div>}
      </aside>}
      {view === "runner" ? <ScenarioRunner entries={library} activeId={activeEntry}
          busy={busy} metrics={metrics} duration={timelineEnd} onSeek={value => { setPlaying(false); setTime(value); }}
          scenes={scenes.map(s => s.scene)} currentScene={original?.source.scene ?? scenes[0]?.scene ?? ""}
          scenario={scenario} replay={replay} time={time} environmentSettings={environmentSettings} playback={playback}
          loading={sceneLoading && <LoadingOverlay/>} onSceneReady={sceneReady}
          onSelect={entry => void job(t("Đang mở {name}", { name: entry.name }), () => openEntry(entry))}
          onCreate={createScenario} onCreateTemplate={createFromTemplate} onFitTemplate={api?.templateFit ? (scene, template) => api.templateFit({ scene, template }) : undefined} onExportMap={exportMap}
          onExport={entry => void exportEntry(entry)} onLoadXml={loadEntryXml} onSaveEdit={saveEdit} onSaveTemplateEdit={saveTemplateEdit} onDelete={deleteEntry} onDeleteRun={deleteRun}/>
      : <main ref={workspaceRef} className={`view-workspace ${expanded ? `expanded expanded-${expanded}` : ''}`}>
        <section className="viewport-panel primary-view" aria-label={t("Mô phỏng 3D")} data-view-state={!scenario ? "empty" : replay ? "replay" : scenario.mode === "source" ? "source" : imported ? "imported-preview" : "preview"}>
          <ExpandButton panel="track" label="khung 3D" expanded={expanded} onChange={setExpanded}/>
          <div className="panel-content"><TrackView scenario={scenario} time={time} replay={replay} environmentSettings={environmentSettings} warnings={warnings} display={preferences} onReady={sceneReady}/></div>
        </section>
        <section className="viewport-panel lidar-panel" aria-label="LiDAR">
          <ExpandButton panel="lidar" label="khung LiDAR" expanded={expanded} onChange={setExpanded}/>
          <div className="panel-content"><LidarView scenario={scenario} time={time} replay={replay} loadLidar={api?.lidarFrame} display={preferences}/></div>
        </section>
        <section className="viewport-panel map-panel" aria-label={t("Map tích hợp")}>
          <ExpandButton panel="map" label="khung map" expanded={expanded} onChange={setExpanded}/>
          <div className="panel-content"><TacticalMap scenario={scenario} time={time} replay={replay}/></div>
        </section>
        {sceneLoading && <LoadingOverlay/>}
        {error && <div className="error-toast" aria-live="assertive"><span>{error.replace(/^[A-Z_]+: /, '')}</span>{(demo || !!window.scenarioDemo) && <button disabled={busy} onClick={() => void job(t("Đang thử lại"), refresh)}>{t("Thử lại")}</button>}<button aria-label={t("Đóng thông báo lỗi")} onClick={() => setError('')}><X size={14} aria-hidden/></button></div>}
      </main>}
      </div>
    </div>
    {view === "scene" && !settingsOpen && playback}
    {view === "runner" && error && <div className="error-toast runner-toast" aria-live="assertive"><span>{error.replace(/^[A-Z_]+: /, '')}</span><button aria-label={t("Đóng thông báo lỗi")} onClick={() => setError('')}><X size={14} aria-hidden/></button></div>}
    {/* Status bar removed from the layout (owner request); kept for assistive tech and tests. */}
    <div aria-label={t("Trạng thái tác vụ")} className="sr-only" role={error ? 'alert' : 'status'}><span>{busy ? '◌ ' : ''}{error || message}</span><small>v{settings?.version ?? '—'}</small></div>
  </div></LanguageProvider>;
}

type Panel = "track" | "lidar" | "map";
function ExpandButton({ panel, label, expanded, onChange }: { panel: Panel; label: string; expanded: Panel | null; onChange: (value: Panel | null) => void }) {
    const t = useT();
    const active = expanded === panel;
    return <button className="panel-expand" aria-pressed={active} aria-label={active ? t("Thu nhỏ {label}", { label: t(label) }) : t("Phóng to {label}", { label: t(label) })}
      title={active ? t("Thu nhỏ (Esc)") : t("Phóng to khung")} onClick={() => onChange(active ? null : panel)}>
      {active ? <Minimize2 size={14} aria-hidden/> : <Maximize2 size={14} aria-hidden/>}
    </button>;
}

/** Covers the views while a scene loads and builds, instead of a blank or white canvas. */
function LoadingOverlay() {
    const t = useT();
    return <div className="loading-overlay" role="status" aria-label={t("Đang tải dữ liệu")} data-testid="loading-overlay">
      <LoaderCircle size={36} className="spin" aria-hidden/>
      <span>{t("Đang tải dữ liệu")}</span>
    </div>;
}
