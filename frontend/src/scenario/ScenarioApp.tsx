import topeyeLogo from "./assets/topeye-logo.png";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ImportedEntry, Replay, Scene, Scenario, Settings } from "./types";
import { TrackView } from "./TrackView";
import { LidarView } from "./LidarView";
import { TacticalMap } from "./TacticalMap";
import { playbackEnd } from "./trajectory";
import { environmentSettingsFor, type SceneQuality } from "./weather";
import { loadPreferences, savePreferences, useResolvedTheme, type Appearance, type Preferences } from "./preferences";
import { ModelCredits } from "./ModelCredits";
import { IconRail, type RailItem } from "./IconRail";
import { ScenarioRunner } from "./ScenarioRunner";
import type { MetricsState } from "./MetricsPanel";
import { Clapperboard, Database, LoaderCircle, Map, Maximize2, MessageSquare, Minimize2, Settings as SettingsIcon, X } from "lucide-react";
import "./scenario.css";
const api = window.scenarioApp;
type Tool = "scene" | "settings";
type View = "scene" | "runner";
export default function ScenarioApp({ onLibrary }: { onLibrary?: () => void } = {}) {
    const [settings, setSettings] = useState<Settings | null>(null), [scenes, setScenes] = useState<Scene[]>([]), [sceneName, setSceneName] = useState("");
    const [original, setOriginalState] = useState<Scenario | null>(null);
    // Latest source for sequential jobs (batch runs read it across awaits, after re-renders).
    const originalRef = useRef<Scenario | null>(null);
    const setOriginal = (value: Scenario | null) => { originalRef.current = value; setOriginalState(value); };
    const [scenario, setScenario] = useState<Scenario | null>(null), [replay, setReplay] = useState<Replay | null>(null);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState("Sẵn sàng"), [error, setError] = useState("");
    const [time, setTime] = useState(0), [playing, setPlaying] = useState(false);
    // Weather moves to scenario authoring; the 3D view keeps ClearNoon and only the quality is a setting.
    const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
    const theme = useResolvedTheme(preferences.appearance);
    const environmentSettings = useMemo(() => environmentSettingsFor("ClearNoon", preferences.quality), [preferences.quality]);
    const updatePreferences = (change: Partial<Preferences>) => setPreferences(current => {
        const next = { ...current, ...change };
        savePreferences(next);
        return next;
    });
    const [expanded, setExpanded] = useState<"track" | "lidar" | "map" | null>(null);
    const [view, setView] = useState<View>("scene");
    // True from the start of a scene load until the 3D view has drawn that scene (no blank/white gap).
    const [sceneLoading, setSceneLoading] = useState(false);
    // Scenario metrics are computed automatically in the background (own worker) for the opened scenario.
    const [metrics, setMetrics] = useState<MetricsState | null>(null);
    const metricsCache = useRef(new globalThis.Map<string, MetricsState>());
    const [tool, setTool] = useState<Tool | null>(null);
    const [railWide, setRailWide] = useState(false);
    const [library, setLibrary] = useState<ImportedEntry[]>([]);
    const [activeEntry, setActiveEntry] = useState<string | null>(null);
    const runnerSnapshot = useRef<{ scenario: Scenario; replay: Replay | null } | null>(null);
    useEffect(() => {
        if (!expanded && !tool) return;
        const key = (event: KeyboardEvent) => { if (event.key !== "Escape") return; if (expanded) setExpanded(null); else setTool(null); };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [expanded, tool]);
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
            setMessage("Cần kiểm tra lại");
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
        setMessage(`Cảnh gốc: ${source.actors.length} đối tượng · ${source.environment?.buildings.length || 0} khối nhà`);
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
        setMessage(`Đã đọc ${rows.length} cảnh`);
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
                void job("Đang đọc dữ liệu", refresh);
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
        setMessage("Đang huỷ tác vụ");
        try {
            await api.cancelJob();
            setOriginal(null); setScenario(null); setReplay(null); setTime(0); runnerSnapshot.current = null;
            setMessage("Đã huỷ · tạo lại kịch bản để tiếp tục");
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
    const sceneReady = () => setSceneLoading(false);
    const metricsScene = view === "runner" && scenario?.mode === "imported" && settings?.mode !== "web-demo" ? scenario.id : null;
    useEffect(() => {
        if (!metricsScene || !api?.scenarioMetrics) { setMetrics(null); return; }
        const cached = metricsCache.current.get(metricsScene);
        if (cached && cached.status !== "error") { setMetrics(cached); return; }
        let stale = false;
        const loading: MetricsState = { key: metricsScene, status: "loading" };
        metricsCache.current.set(metricsScene, loading);
        setMetrics(loading);
        api.scenarioMetrics({ scenario_id: metricsScene }).then(data => {
            const ready: MetricsState = { key: metricsScene, status: "ready", data };
            metricsCache.current.set(metricsScene, ready);
            if (!stale) setMetrics(ready);
        }, (e: unknown) => {
            const failed: MetricsState = { key: metricsScene, status: "error", error: String(e instanceof Error ? e.message : e) };
            metricsCache.current.set(metricsScene, failed);
            if (!stale) setMetrics(failed);
        });
        return () => { stale = true; };
    }, [metricsScene]);
    useEffect(() => {
        if (!playing || !scenario)
            return;
        let last = performance.now();
        const timer = setInterval(() => {
            const now = performance.now(), dt = (now - last) / 1000;
            last = now;
            setTime((t) => {
                const next = t + dt;
                if (next >= timelineEnd) {
                    setPlaying(false);
                    return timelineEnd;
                }
                return next;
            });
        }, 40);
        return () => clearInterval(timer);
    }, [playing, scenario, timelineEnd]);
    const imported = scenario?.mode === "imported";
    const resetPlayback = () => { setReplay(null); setTime(0); setPlaying(false); };
    // ---- OpenSCENARIO library (plan26) -------------------------------------------------------
    async function refreshLibrary() {
        if (!api?.listImported) return;
        setLibrary(await checked(api.listImported()));
    }
    // Runs as a normal job: the worker serves one request at a time, so a concurrent read would make the next action BUSY.
    useEffect(() => { if (view === "runner" && settings?.dataset) void job("Đang đọc thư viện kịch bản", refreshLibrary); }, [view, settings?.dataset]);
    /** Make `scene` the loaded source (reusing it when already loaded) and return it. */
    async function ensureSource(scene: string): Promise<Scenario> {
        const loaded = originalRef.current;
        if (loaded && loaded.source.scene === scene) return loaded;
        const row = scenes.find(s => s.scene === scene);
        if (!row) throw new Error(`DATASET_INVALID: Không có cảnh ${scene} trong dữ liệu đang mở`);
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
        showImported(s, `Đã mở ${entry.name}`, entry.scenario_id);
        return s;
    }
    function createScenario(scene: string) {
        return job('Đang nạp OpenSCENARIO', async () => {
            const source = await ensureSource(scene);
            const s = await checked(api!.importXosc({ source_id: source.id }));
            if (!s) { setMessage("Đã đóng hộp chọn · giữ nguyên cảnh đang xem"); return false; }
            showImported(s, `Đã nạp OpenSCENARIO · ${s.actors.length} đối tượng · đúng map hiện tại`);
            await refreshLibrary();
            return true;
        });
    }
    function exportMap(scene: string) {
        return job('Đang xuất thông tin map', async () => {
            const source = await ensureSource(scene);
            const r = await checked(api!.exportMapContext({ source_id: source.id }));
            setMessage(r ? `Đã xuất thông tin map: ${r.path}` : 'Đã đóng hộp chọn · giữ nguyên cảnh đang xem');
        });
    }
    function exportEntry(entry: ImportedEntry) {
        return job(`Đang xuất ${entry.name}`, async () => {
            const data = await checked(api!.readImported({ scenario_id: entry.scenario_id }));
            const url = URL.createObjectURL(new Blob([data.xml], { type: "application/xml" }));
            const link = document.createElement("a");
            link.href = url; link.download = data.file_name;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            setMessage(`Đã xuất ${data.file_name} (thư mục Tải về)`);
        });
    }
    function loadEntryXml(entry: ImportedEntry) {
        return job(`Đang mở ${entry.name} để sửa`, () => checked(api!.readImported({ scenario_id: entry.scenario_id })));
    }
    /** Packages are immutable: a valid edit is imported as a new package, then the old one is trashed. */
    function saveEdit(entry: ImportedEntry, name: string, xml: string) {
        return job(`Đang lưu ${name}`, async () => {
            const source = await ensureSource(entry.scene);
            const s = await checked(api!.importXosc({ source_id: source.id, xml, file_name: name }));
            if (!s) return false;
            await checked(api!.deleteImported({ scenario_id: entry.scenario_id }));
            if (runnerSnapshot.current?.scenario.id === entry.scenario_id) runnerSnapshot.current = null;
            showImported(s, `Đã lưu ${name}`);
            await refreshLibrary();
            return true;
        });
    }
    function deleteEntry(entry: ImportedEntry) {
        if (!window.confirm(`Xoá kịch bản “${entry.name}”? Gói và lịch sử chạy được chuyển vào thư mục .trash trong thư mục lưu.`)) return;
        void job(`Đang xoá ${entry.name}`, async () => {
            await checked(api!.deleteImported({ scenario_id: entry.scenario_id }));
            if (activeEntry === entry.scenario_id) setActiveEntry(null);
            if (scenario?.id === entry.scenario_id) { setScenario(originalRef.current); resetPlayback(); }
            if (runnerSnapshot.current?.scenario.id === entry.scenario_id) runnerSnapshot.current = null;
            setMessage(`Đã xoá ${entry.name}`);
            await refreshLibrary();
        });
    }
    if (!api)
        return <main className="studio view-empty"><h1>Topeye</h1><p>Chạy `npm run web:local` để mở Topeye.</p></main>;
    const warnings = scenario?.environment?.warnings ?? [];
    const railItems: RailItem[] = [
        { id: "scene", label: "Cảnh nguồn", icon: <Map size={20} aria-hidden/> },
        ...(!demo ? [{ id: "runner", label: "OpenSCENARIO", icon: <Clapperboard size={20} aria-hidden/>, separatorBefore: true }] : []),
        ...(demo && import.meta.env.VITE_FEEDBACK_URL ? [{ id: "feedback", label: "Góp ý", icon: <MessageSquare size={20} aria-hidden/>, bottom: true }] : []),
        { id: "settings", label: "Cài đặt", icon: <SettingsIcon size={20} aria-hidden/>, bottom: true },
    ];
    function onRail(id: string) {
        if (id === "feedback") { feedback(); return; }
        if (id === "runner") { showRunner(); setTool(null); return; }
        const next = id as Tool;
        if (next === "scene") showScene();
        setTool(tool === next ? null : next);
    }
    const playback = <div className="playback-bar">
      <button aria-label="Về đầu" disabled={!scenario || busy} onClick={() => { setPlaying(false); setTime(0); }}>↤</button>
      <button className="play-button" aria-label={playing ? 'Tạm dừng' : 'Phát mô phỏng'} disabled={!scenario || busy} onClick={() => {
            if (time >= timelineEnd)
                setTime(0);
            setPlaying(!playing);
        }}>{playing ? 'Ⅱ' : '▶'}</button>
      <button aria-label="Về cuối" disabled={!scenario || busy} onClick={() => { setPlaying(false); setTime(timelineEnd); }}>↦</button>
      <div className="timeline-track">
        <input aria-label="Thời gian mô phỏng" type="range" min="0" max={timelineEnd || 1} step=".01" value={time} disabled={!scenario || busy} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }}/>
      </div>
      <output>{time.toFixed(2)} <span>/ {timelineEnd.toFixed(2)}s</span></output>
    </div>;
    const drawers: Record<Tool, { title: string; body: ReactNode }> = {
        scene: { title: "Cảnh nguồn", body: scenes.length ? <ul className="scene-list" aria-label="Danh sách cảnh">
          {scenes.map(s => {
            const active = s.scene === sceneName && scenario?.mode === "source";
            return <li key={s.scene}><button aria-current={active ? "true" : undefined} disabled={busy} onClick={() => openScene(s)}>
              <strong>{s.scene}</strong><small>{s.duration_s.toFixed(1).replace(".", ",")} s · {s.tracks.length} đối tượng</small>
            </button></li>;
          })}
        </ul> : <p className="sensor-note">Chưa có dữ liệu. Mở “Cài đặt” để chọn thư mục dữ liệu.</p> },
        settings: { title: "Cài đặt", body: <>
          <label className="field">Giao diện<select aria-label="Giao diện" value={preferences.appearance} onChange={e => updatePreferences({ appearance: e.target.value as Appearance })}>
            <option value="dark">Tối</option><option value="light">Sáng</option><option value="system">Theo hệ thống</option>
          </select></label>
          <label className="field">Chất lượng đồ hoạ<select aria-label="Chất lượng đồ hoạ" value={preferences.quality} onChange={e => updatePreferences({ quality: e.target.value as SceneQuality })}>
            <option value="auto">Tự động (giảm khi máy chậm)</option><option value="high">Cao</option><option value="balanced">Cân bằng</option>
          </select></label>
          {!demo && <>
          <p className="popover-note">{settings?.dataset ? `Đang dùng: ${settings.dataset} · ${settings.datasetVersion || 'nuScenes'}` : 'Chưa chọn dữ liệu'}</p>
          <button className="dataset-button full-width" disabled={busy} title={settings?.dataset ?? undefined} onClick={() => void job("Đang mở dữ liệu", async () => {
            const res = await checked(api.chooseDataset());
            if (res) {
                setSettings(await checked(api.settings()));
                setScenes(res.scenes);
                const s = res.scenes[0];
                if (s) {
                    selectScene(s);
                    await loadSource(s);
                }
                setMessage(`Đã đọc ${res.scenes.length} cảnh`);
            }
        })}>{settings?.dataset ? 'Đổi dữ liệu' : 'Chọn thư mục dữ liệu'}</button>
          <p className="popover-note">Lưu kịch bản tại: {settings?.workspace || '—'}</p>
          <button className="full-width" disabled={busy} title={settings?.workspace} onClick={() => void job('Chọn nơi lưu', async () => { await checked(api.chooseWorkspace()); setSettings(await checked(api.settings())); setMessage('Đã cập nhật nơi lưu'); })}>Thư mục lưu</button>
          <ModelCredits/>
          </>}
        </> },
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
        void job('Đang dựng cảnh gốc', () => loadSource(s));
    }
    const drawer = tool ? drawers[tool] : null;
    const activeRail = view === "runner" && !tool ? "runner" : tool;
    return <div className="studio" data-theme={theme}>
    <header className="studio-header">
      <div className="studio-brand"><img className="brand-mark" src={topeyeLogo} alt="Logo Topeye"/><h1>Topeye</h1></div>
      {onLibrary && <button type="button" className="studio-library-button" disabled={busy} onClick={onLibrary}><Database size={14} aria-hidden/>Thư viện map</button>}
      {busy && <div className="busy-indicator" data-testid="busy-indicator"><LoaderCircle size={14} className="spin" aria-hidden/><span>{message}</span><button disabled={cancelling.current} onClick={() => void cancel()}>Huỷ tác vụ</button></div>}
    </header>
    <div className="studio-body">
      <IconRail items={railItems} active={activeRail} wide={railWide} onToggleWide={() => setRailWide(v => !v)} onSelect={onRail}/>
      {drawer && <aside className={`tool-drawer${tool === "scene" ? " narrow" : ""}`} aria-label={drawer.title}>
        <div className="drawer-head"><h2>{drawer.title}</h2><button className="icon-button" aria-label="Đóng ngăn" onClick={() => setTool(null)}><X size={14} aria-hidden/></button></div>
        {drawer.body}
        {demo && <div className="drawer-credits"><ModelCredits/><p className="sensor-note">nuScenes © Motional, CC BY-NC-SA 4.0</p><p className="sensor-note">CARLA weather presets · MIT</p></div>}
      </aside>}
      {view === "runner" ? <ScenarioRunner entries={library} activeId={activeEntry}
          busy={busy} metrics={metrics}
          scenes={scenes.map(s => s.scene)} currentScene={original?.source.scene ?? scenes[0]?.scene ?? ""}
          scenario={scenario} replay={replay} time={time} environmentSettings={environmentSettings} playback={playback}
          loading={sceneLoading && <LoadingOverlay/>} onSceneReady={sceneReady}
          onSelect={entry => void job(`Đang mở ${entry.name}`, () => openEntry(entry))}
          onCreate={createScenario} onExportMap={exportMap}
          onExport={entry => void exportEntry(entry)} onLoadXml={loadEntryXml} onSaveEdit={saveEdit} onDelete={deleteEntry}/>
      : <main ref={workspaceRef} className={`view-workspace ${expanded ? `expanded expanded-${expanded}` : ''}`}>
        <section className="viewport-panel primary-view" aria-label="Mô phỏng 3D" data-view-state={!scenario ? "empty" : replay ? "replay" : scenario.mode === "source" ? "source" : imported ? "imported-preview" : "preview"}>
          <ExpandButton panel="track" label="khung 3D" expanded={expanded} onChange={setExpanded}/>
          <div className="panel-content"><TrackView scenario={scenario} time={time} replay={replay} environmentSettings={environmentSettings} warnings={warnings} onReady={sceneReady}/></div>
        </section>
        <section className="viewport-panel lidar-panel" aria-label="LiDAR">
          <ExpandButton panel="lidar" label="khung LiDAR" expanded={expanded} onChange={setExpanded}/>
          <div className="panel-content"><LidarView scenario={scenario} time={time} replay={replay} loadLidar={api?.lidarFrame}/></div>
        </section>
        <section className="viewport-panel map-panel" aria-label="Map tích hợp">
          <ExpandButton panel="map" label="khung map" expanded={expanded} onChange={setExpanded}/>
          <div className="panel-content"><TacticalMap scenario={scenario} time={time} replay={replay}/></div>
        </section>
        {sceneLoading && <LoadingOverlay/>}
        {error && <div className="error-toast" aria-live="assertive"><span>{error.replace(/^[A-Z_]+: /, '')}</span>{(demo || !!window.scenarioDemo) && <button disabled={busy} onClick={() => void job("Đang thử lại", refresh)}>Thử lại</button>}<button aria-label="Đóng thông báo lỗi" onClick={() => setError('')}><X size={14} aria-hidden/></button></div>}
      </main>}
    </div>
    {view === "scene" && playback}
    {view === "runner" && error && <div className="error-toast runner-toast" aria-live="assertive"><span>{error.replace(/^[A-Z_]+: /, '')}</span><button aria-label="Đóng thông báo lỗi" onClick={() => setError('')}><X size={14} aria-hidden/></button></div>}
    {/* Status bar removed from the layout (owner request); kept for assistive tech and tests. */}
    <div aria-label="Trạng thái tác vụ" className="sr-only" role={error ? 'alert' : 'status'}><span>{busy ? '◌ ' : ''}{error || message}</span><small>v{settings?.version ?? '—'}</small></div>
  </div>;
}

type Panel = "track" | "lidar" | "map";
function ExpandButton({ panel, label, expanded, onChange }: { panel: Panel; label: string; expanded: Panel | null; onChange: (value: Panel | null) => void }) {
    const active = expanded === panel;
    return <button className="panel-expand" aria-pressed={active} aria-label={active ? `Thu nhỏ ${label}` : `Phóng to ${label}`}
      title={active ? "Thu nhỏ (Esc)" : "Phóng to khung"} onClick={() => onChange(active ? null : panel)}>
      {active ? <Minimize2 size={14} aria-hidden/> : <Maximize2 size={14} aria-hidden/>}
    </button>;
}

/** Covers the views while a scene loads and builds, instead of a blank or white canvas. */
function LoadingOverlay() {
    return <div className="loading-overlay" role="status" aria-label="Đang tải dữ liệu" data-testid="loading-overlay">
      <LoaderCircle size={36} className="spin" aria-hidden/>
      <span>Đang tải dữ liệu</span>
    </div>;
}
