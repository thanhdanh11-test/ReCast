import topeyeLogo from "./assets/topeye-logo.png";
import { useEffect, useRef, useState } from "react";
import { Replay, Scene, Scenario, Settings } from "./types";
import { TrackView } from "./TrackView";
import { LidarView } from "./LidarView";
import { TacticalMap } from "./TacticalMap";
import { playbackEnd } from "./trajectory";
import { EnvironmentMenu, HeaderPopover } from "./EnvironmentMenu";
import { defaultEnvironmentSettings } from "./weather";
import { ModelCredits } from "./ModelCredits";
import "./scenario.css";
const api = window.scenarioApp;
export default function ScenarioApp() {
    const [settings, setSettings] = useState<Settings | null>(null), [scenes, setScenes] = useState<Scene[]>([]), [sceneName, setSceneName] = useState("");
    const [selected, setSelected] = useState<string[]>([]), [start, setStart] = useState(3), [end, setEnd] = useState(8);
    const [original, setOriginal] = useState<Scenario | null>(null);
    const [base, setBase] = useState<Scenario | null>(null), [scenario, setScenario] = useState<Scenario | null>(null), [replay, setReplay] = useState<Replay | null>(null);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState("Sẵn sàng"), [error, setError] = useState("");
    const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [offset, setOffset] = useState(0), [target, setTarget] = useState("vehicle_1");
    const [runs, setRuns] = useState<{
        id: string;
        valid: boolean;
    }[]>([]);
    const [environmentSettings, setEnvironmentSettings] = useState(defaultEnvironmentSettings);
    const [showMap, setShowMap] = useState(true);
    const demo = settings?.mode === "web-demo";
    const demoVariants = demo && base ? window.scenarioDemo?.demoVariants(base.id) ?? [] : [];
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
    const current = scenes.find((s) => s.scene === sceneName);
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
    async function loadSource(s: Scene) {
        const source = await checked(api!.sourceScene({ scene: s.scene }));
        setOriginal(source);
        setScenario(source);
        setReplay(null);
        setTime(0);
        setMessage(`Cảnh gốc: ${source.actors.length} đối tượng · ${source.environment?.buildings.length || 0} khối nhà`);
    }
    function selectScene(s: Scene) {
        setOriginal(null);
        const pilot = s.scene === "scene-0103" && s.tracks.find((t) => t.token === "ec0e6425eae2442698ff7b43d405d279");
        setSceneName(s.scene);
        setSelected(pilot ? [pilot.token] : s.tracks.slice(0, 1).map((t) => t.token));
        setStart(pilot ? 8 : 3);
        setEnd(pilot ? 13 : 8);
        setScenario(null);
        setBase(null);
        setReplay(null);
        setTime(0);
    }
    async function refresh() {
        if (!api)
            return;
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
            setOriginal(null); setBase(null); setScenario(null); setReplay(null); setTime(0);
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
    const canRun = !!scenario && scenario.mode !== "source" && (settings?.engineAvailable || demo) && !busy;
    const imported = scenario?.mode === "imported";
    const hasSourceMap = !!original?.environment?.polygons.length;
    const sourceLabel = replay ? "ESMINI · ĐÃ ĐO" : scenario?.mode === "source" ? "DỮ LIỆU GỐC" : imported ? "ĐÃ NẠP · XEM TRƯỚC" : "XEM TRƯỚC";
    const resetPlayback = () => { setReplay(null); setTime(0); setPlaying(false); };
    async function importScenario(reopen: boolean) {
        if (!original) return;
        const s = await checked(reopen ? api!.openImported({source_id: original.id}) : api!.importXosc({source_id: original.id}));
        if (!s) { setMessage("Đã đóng hộp chọn · giữ nguyên cảnh đang xem"); return; }
        setScenario(s); resetPlayback();
        setMessage(`Đã nạp OpenSCENARIO · ${s.actors.length} đối tượng · đúng map hiện tại`);
    }
    const selectTrack = (token: string) => setSelected(previous => previous.includes(token)
        ? previous.filter(t => t !== token) : previous.length < 3 ? [...previous, token] : previous);
    if (!api)
        return <main className="studio view-empty"><h1>Topeye · Scenario Studio</h1><p>Mở ứng dụng Topeye trên máy để dùng mô phỏng.</p></main>;
    return <div className="studio">
    <header className="studio-header">
      <div className="studio-brand"><img className="brand-mark" src={topeyeLogo} alt="Logo Topeye"/><div><h1>Topeye <span>Scenario Studio</span></h1><small>{demo ? "BẢN DEMO WEB · dữ liệu tính sẵn" : "Không gian mô phỏng"}</small></div></div>
      <div className="header-actions">
        <EnvironmentMenu settings={environmentSettings} onChange={setEnvironmentSettings}/>
        {!demo && <><HeaderPopover label="OpenSCENARIO" primary>
          <button className="primary full-width" disabled={busy || !hasSourceMap} onClick={() => void job('Đang nạp OpenSCENARIO', () => importScenario(false))}>Nạp OpenSCENARIO</button>
          <button className="full-width" disabled={busy || !hasSourceMap} onClick={() => void job('Đang xuất thông tin map', async () => { const r = await checked(api.exportMapContext({source_id: original!.id})); setMessage(r ? `Đã xuất thông tin map: ${r.path}` : 'Đã đóng hộp chọn · giữ nguyên cảnh đang xem'); })}>Xuất thông tin map</button>
          <button className="full-width" disabled={busy || !hasSourceMap} onClick={() => void job('Đang mở OpenSCENARIO đã lưu', () => importScenario(true))}>Mở kịch bản đã lưu</button>
        </HeaderPopover>
        <button className="dataset-button" disabled={busy} title={settings?.dataset ?? undefined} onClick={() => void job("Đang mở dữ liệu", async () => {
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
        })}>{settings?.dataset ? `Đổi dữ liệu · ${settings.datasetVersion || 'nuScenes'}` : 'Chọn thư mục nuScenes'}</button>
        <button disabled={busy} title={settings?.workspace} onClick={() => void job('Chọn nơi lưu', async () => { await checked(api.chooseWorkspace()); setSettings(await checked(api.settings())); setMessage('Đã cập nhật nơi lưu'); })}>Thư mục lưu</button></>}
        {demo && import.meta.env.VITE_FEEDBACK_URL && <button onClick={feedback}>Góp ý</button>}
      </div>
    </header>
    <div className="studio-body">
      <aside className="workflow" aria-label="Thiết lập kịch bản">
        <section>
          <div className="section-title"><h2>Cảnh nguồn</h2><span>{scenes.length} cảnh</span></div>
          <label className="field">Cảnh đang xem<select aria-label="Cảnh đang xem" disabled={busy || !scenes.length} value={sceneName} onChange={e => {
            const s = scenes.find(r => r.scene === e.target.value);
            if (s) {
                selectScene(s);
                void job('Đang dựng cảnh gốc', () => loadSource(s));
            }
        }}>
            {!scenes.length && <option value="">Chưa có dữ liệu</option>}
            {scenes.map(s => <option key={s.scene} value={s.scene}>{s.scene} · {s.duration_s.toFixed(1)}s</option>)}
          </select></label>
          <button className="full-width" disabled={busy || !current} onClick={() => {
            if (original) {
                setScenario(original);
                resetPlayback();
            }
            else if (current)
                void job('Đang dựng cảnh gốc', () => loadSource(current));
        }}>Xem cảnh gốc</button>
          <label className="toggle"><input type="checkbox" checked={showMap} onChange={e => setShowMap(e.target.checked)}/>Hiển thị map tích hợp</label>
        </section>
        {imported && <section>
          <div className="section-title"><h2>OpenSCENARIO</h2><span>Đã nạp</span></div>
          {imported && <p className="sensor-note">{replay?.report.kind === "imported" ? "Đang hiển thị kết quả đo thực từ esmini." : "Quỹ đạo đã kiểm tra theo map. Xem trước chưa phải kết quả simulator."}</p>}
          {imported && scenario.import?.diagnostics.map((d, i) => <p className="sensor-note" key={i}>{d.code === "PEDESTRIAN_ROADWAY" ? "Người đi bộ có đoạn đi trên đường ngoài lối qua đường." : d.code === "ESTIMATED_GEOMETRY" ? "Vật cản được ước lượng từ dữ liệu nguồn; chưa xác nhận an toàn vật lý." : d.message}</p>)}
        </section>}
        <section>
          <div className="section-title"><h2>01 · Trích đoạn</h2><span>{selected.length}/3 đối tượng</span></div>
          <div className="field-pair"><label className="field">Từ (s)<input type="number" min="0" step=".5" value={start} disabled={busy} onChange={e => setStart(Number(e.target.value))}/></label><label className="field">Đến (s)<input type="number" min="2" step=".5" value={end} disabled={busy} onChange={e => setEnd(Number(e.target.value))}/></label></div>
          <details className="actor-picker"><summary>Chọn đối tượng <span>{current?.tracks.length ?? 0} khả dụng</span></summary>
            <div className="actor-list">{current?.tracks.map(t => <label key={t.token} className="actor-row"><input type="checkbox" aria-label={`${t.category} ${t.token}`} checked={selected.includes(t.token)} disabled={busy || (!selected.includes(t.token) && selected.length >= 3)} onChange={() => selectTrack(t.token)}/><span><strong>{t.category.replace('vehicle.', '')}</strong><small>{t.token.slice(0, 8)} · {t.start_s.toFixed(1)}–{t.end_s.toFixed(1)}s</small></span></label>)}</div>
          </details>
          <button className="primary full-width" disabled={busy || !current || !selected.length} onClick={() => void job('Đang trích quỹ đạo', async () => {
            const s = await checked(api.extract({ scene: sceneName, actor_tokens: selected, start_s: start, end_s: end }));
                setBase(s);
            setScenario(s);
            resetPlayback();
            setTarget(s.actors.find(a => a.role === 'traffic')?.id || 'vehicle_1');
            setSpeed(1);
            setOffset(0);
            setMessage('Đã trích quỹ đạo · sẵn sàng phát lại');
        })}>Trích đoạn thử nghiệm</button>
        </section>
        {demo ? (demoVariants.length ? <section>
          <div className="section-title"><h2>02 · Biến thể</h2></div>
          <button disabled={busy} onClick={() => { setScenario(base); resetPlayback(); }}>Bản gốc</button>
          {demoVariants.map(v => <button className="full-width" key={v.key} disabled={busy}
            onClick={() => void job('Đang tải biến thể tính sẵn', async () => {
              const s = await checked(api.variant({scenario_id: base!.id, target_actor: v.target_actor, speed_factor: v.speed_factor, gap_offset_m: v.gap_offset_m}));
              setScenario(s); resetPlayback(); setMessage('Biến thể tính sẵn đã sẵn sàng');
            })}>{v.target_actor} · {v.speed_factor}× · {v.gap_offset_m}m</button>)}
        </section> : <p className="sensor-note">Biến thể tự do chỉ có ở bản đầy đủ (npm run web:local)</p>) : <>
        <section>
          <div className="section-title"><h2>02 · Biến thể</h2></div>
          <label className="field">Đối tượng<select value={target} disabled={!base || busy || imported} onChange={e => setTarget(e.target.value)}>{base?.actors.filter(a => a.role === 'traffic').map(a => <option key={a.id} value={a.id}>{a.id}</option>)}</select></label>
          <label className="field"><span>Tốc độ <output>{speed.toFixed(2)}×</output></span><input aria-label="Hệ số tốc độ" type="range" min=".5" max="1.5" step=".05" value={speed} disabled={!base || busy || imported} onChange={e => setSpeed(Number(e.target.value))}/></label>
          <label className="field"><span>Dịch dọc <output>{offset.toFixed(1)}m</output></span><input aria-label="Dịch dọc" type="range" min="-10" max="10" step=".5" value={offset} disabled={!base || busy || imported} onChange={e => setOffset(Number(e.target.value))}/></label>
          <div className="button-pair"><button disabled={!base || busy || imported} onClick={() => { setScenario(base); resetPlayback(); }}>Bản gốc</button><button disabled={!base || busy || imported} onClick={() => void job('Đang tạo biến thể', async () => { const s = await checked(api.variant({ scenario_id: base!.id, target_actor: target, speed_factor: speed, gap_offset_m: offset })); setScenario(s); resetPlayback(); setMessage('Biến thể đã sẵn sàng'); })}>Tạo biến thể</button></div>
        </section>
        </>}
        <section>
          <div className="section-title"><h2>03 · Kiểm chứng</h2><span>{runs.filter(r => r.valid).length}/{runs.length} đạt</span></div>
          {!demo && settings && !settings.engineAvailable && scenario && scenario.mode !== "source" && <p className="sensor-note">Chưa tìm thấy bộ mô phỏng esmini; cần kiểm tra cài đặt trước khi chạy kịch bản.</p>}
          <button className="primary full-width" disabled={!canRun} onClick={() => void job(demo ? 'Đang tải kết quả esmini tính sẵn' : imported ? 'Đang chạy kịch bản đã nạp' : 'Đang khởi động esmini', async () => { const r = await checked(imported ? api.replayImported({ scenario_id: scenario!.id }) : api.replay({ scenario_id: scenario!.id })); setReplay(r); setTime(0); if (r.report.kind !== 'imported') { const valid = r.report.status === 'pass'; setRuns(v => [...v.filter(item => item.id !== scenario!.id), { id: scenario!.id, valid }]); } setMessage(demo ? 'Kết quả esmini đã đo sẵn' : 'Đã lưu kết quả phát lại và báo cáo'); })}>{demo ? 'Xem kết quả esmini tính sẵn' : imported ? 'Chạy kịch bản đã nạp' : 'Chạy phát lại'}</button>
          {!demo && <button className="full-width" disabled={!scenario || scenario.mode === 'source' || imported || busy} onClick={() => void job('Đang xuất OpenSCENARIO', async () => { const r = await checked(api.export({ scenario_id: scenario!.id })); setMessage(`Đã xuất: ${r.path}`); })}>Xuất kịch bản ↗</button>}
          {replay && replay.report.kind !== 'imported' && <div className="replay-result"><strong>{replay.report.status === 'pass' ? 'Đạt ngưỡng kiểm chứng' : 'Chưa đạt ngưỡng'}</strong><span>Coverage {(replay.report.coverage * 100).toFixed(1)}%</span>{replay.report.per_actor.map(m => <p key={m.id}>{m.id}: {m.status} · ADE {m.ade_xy_m?.toFixed(3) ?? '—'}m{m.reason ? ` · ${m.reason}` : ''}</p>)}</div>}
          {replay?.report.kind === 'imported' && <div className="replay-result">
            <strong>Thực thi: {replay.report.execution}</strong>
            <span>Bám quỹ đạo: {(replay.report.fidelity.coverage * 100).toFixed(1)}% · XY tối đa {replay.report.fidelity.max_xy_m.toFixed(3)}m · góc tối đa {replay.report.fidelity.max_yaw_rad.toFixed(3)}rad</span>
            <span>Tuân thủ map: {replay.report.map_conformance}</span>
            <span>Quan sát tiếp xúc: {replay.report.contacts.length} · Không kết luận an toàn</span>
            {replay.report.warnings.map((warning, i) => <p key={i}>{warning === "Contacts are sampled at 20Hz; geometry is estimated, not a safety certification" ? "Tiếp xúc được lấy mẫu 20 lần/giây; hình học ước lượng chưa xác nhận an toàn vật lý." : warning}</p>)}
          </div>}
        </section>
        {demo && <section><ModelCredits/><p className="sensor-note">nuScenes © Motional, CC BY-NC-SA 4.0</p><p className="sensor-note">CARLA weather presets · MIT</p></section>}
      </aside>
      <main ref={workspaceRef} className={`view-workspace ${showMap ? '' : 'without-map'}`}>
        <section className="viewport-panel primary-view" aria-label="Mô phỏng 3D">
          <div className="panel-heading"><h2>Mô phỏng 3D</h2><span>{scenario ? sourceLabel : 'CHƯA CÓ CẢNH'}</span></div>
          <div className="panel-content"><TrackView scenario={scenario} time={time} replay={replay} environmentSettings={environmentSettings}/></div>
        </section>
        <section className="viewport-panel lidar-panel" aria-label="Mô phỏng LiDAR">
          <div className="panel-heading"><h2>Mô phỏng LiDAR</h2><span>QUÉT NGANG 360°</span></div>
          <div className="panel-content"><LidarView scenario={scenario} time={time} replay={replay}/></div>
        </section>
        {showMap && <section className="viewport-panel map-panel" aria-label="Map tích hợp">
          <div className="panel-heading"><h2>Map tích hợp</h2><span>nuScenes</span></div>
          <div className="panel-content"><TacticalMap scenario={scenario} time={time} replay={replay}/></div>
        </section>}
        {!!scenario?.environment?.warnings.length && <div className="environment-warning" role="note">{scenario.environment.warnings.join(' · ')}</div>}
      </main>
    </div>
    <div className="playback-bar">
      <button aria-label="Về đầu" disabled={!scenario || busy} onClick={() => { setPlaying(false); setTime(0); }}>↤</button>
      <button className="play-button" aria-label={playing ? 'Tạm dừng' : 'Phát mô phỏng'} disabled={!scenario || busy} onClick={() => {
            if (time >= timelineEnd)
                setTime(0);
            setPlaying(!playing);
        }}>{playing ? 'Ⅱ' : '▶'}</button>
      <button aria-label="Về cuối" disabled={!scenario || busy} onClick={() => { setPlaying(false); setTime(timelineEnd); }}>↦</button>
      <input aria-label="Thời gian mô phỏng" type="range" min="0" max={timelineEnd || 1} step=".01" value={time} disabled={!scenario || busy} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }}/>
      <output>{time.toFixed(2)} <span>/ {timelineEnd.toFixed(2)}s</span></output>
    </div>
    <footer aria-label="Trạng thái tác vụ" className={`studio-status ${error ? 'has-error' : ''}`} role={error ? 'alert' : 'status'}><span>{busy ? '◌ ' : ''}{error || message}</span>{busy && <button disabled={cancelling.current} onClick={() => void cancel()}>Huỷ tác vụ</button>}{error && (demo || !!window.scenarioDemo) && <button disabled={busy} onClick={() => void job("Đang thử lại", refresh)}>Thử lại</button>}<small>v{settings?.version ?? '—'}</small></footer>
  </div>;
}
