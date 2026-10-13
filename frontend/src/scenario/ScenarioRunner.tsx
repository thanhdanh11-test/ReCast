import { useEffect, useState, type ReactNode } from "react";
import { Check, Download, MapPin, Pencil, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { TrackView } from "./TrackView";
import { MetricsPanel, type MetricsState } from "./MetricsPanel";
import { TacticalMap } from "./TacticalMap";
import type { ImportedEntry, ImportedReport, ImportedRun, Replay, Scenario } from "./types";
import type { SceneEnvironmentSettings } from "./weather";

type Status = { label: string; tone: "ok" | "bad" | "run" | "new" };
export function runStatus(entry: ImportedEntry): Status {
    const last = entry.runs[0];
    if (!last) return { label: "Chưa chạy", tone: "new" };
    if (last.status === "running") return { label: "Đang chạy", tone: "run" };
    if (last.status === "interrupted") return { label: "Đã huỷ", tone: "new" };
    if (last.status === "completed" && last.execution === "pass" && last.map_conformance === "pass") return { label: "Đạt", tone: "ok" };
    return { label: "Không đạt", tone: "bad" };
}

const fmt = (value: number | undefined, digits: number, unit = "") => value === undefined ? "—" : `${value.toFixed(digits).replace(".", ",")}${unit}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
const KIND: Record<string, string> = { car: "xe con", truck: "xe tải", bus: "xe buýt", bicycle: "xe đạp", motorcycle: "xe máy", pedestrian: "người đi bộ" };
const kind = (category: string) => Object.entries(KIND).find(([k]) => category.includes(k))?.[1] ?? category;
function maxSpeed(scenario: Scenario, id: string): number | undefined {
    const s = scenario.actors.find(a => a.id === id)?.samples ?? [];
    let best: number | undefined;
    for (let i = 1; i < s.length; i++) {
        const dt = s[i].t_s - s[i - 1].t_s;
        if (dt > 0) best = Math.max(best ?? 0, Math.hypot(s[i].x_m - s[i - 1].x_m, s[i].y_m - s[i - 1].y_m) / dt);
    }
    return best;
}

/** Dedicated OpenSCENARIO workspace: library · preview/result · run & report (plan26, mockup C). */
type XmlDoc = { name: string; file_name: string; xml: string };
export function ScenarioRunner(props: {
    entries: ImportedEntry[]; activeId: string | null;
    busy: boolean; metrics: MetricsState | null;
    scenes: string[]; currentScene: string;
    scenario: Scenario | null; replay: Replay | null; time: number; environmentSettings: SceneEnvironmentSettings;
    playback: ReactNode;
    loading: ReactNode; onSceneReady: () => void;
    onSelect: (entry: ImportedEntry) => void;
    onCreate: (scene: string) => Promise<boolean | undefined>; onExportMap: (scene: string) => Promise<unknown>;
    onExport: (entry: ImportedEntry) => void; onDelete: (entry: ImportedEntry) => void;
    onLoadXml: (entry: ImportedEntry) => Promise<XmlDoc | undefined>;
    onSaveEdit: (entry: ImportedEntry, name: string, xml: string) => Promise<boolean | undefined>;
}) {
    const { entries, activeId, scenario, replay, busy } = props;
    const [creating, setCreating] = useState(false);
    const [createScene, setCreateScene] = useState(props.currentScene);
    const [editing, setEditing] = useState<{ entry: ImportedEntry; name: string; xml: string } | null>(null);
    useEffect(() => {
        if (!creating && !editing) return;
        const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setCreating(false); setEditing(null); } };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [creating, editing]);
    // Always opens (owner: the button is always available); actions inside wait while a job runs.
    const openCreate = () => { setCreateScene(props.currentScene || props.scenes[0] || ""); setCreating(true); };
    const openEdit = async (entry: ImportedEntry) => {
        const doc = await props.onLoadXml(entry);
        if (doc) setEditing({ entry, name: doc.file_name, xml: doc.xml });
    };
    const active = entries.find(e => e.scenario_id === activeId) ?? null;
    const shown = scenario?.mode === "imported" ? scenario : null;
    const report = replay?.report.kind === "imported" ? replay.report as ImportedReport : null;
    const last: ImportedRun | undefined = active?.runs.find(r => r.status === "completed");
    const diagnostics = shown?.import?.diagnostics ?? [];
    return <div className="runner" data-testid="scenario-runner">
        <section className="runner-col" aria-label="Thư viện kịch bản">
            <div className="runner-head"><h2>Kịch bản</h2></div>
            <ul className="runner-list">
                {!entries.length && <li className="runner-empty">Chưa có kịch bản. Bấm “Tạo kịch bản” để nạp file .xosc.</li>}
                {entries.map(entry => {
                    const status = runStatus(entry);
                    return <li key={entry.scenario_id} className={`runner-item${entry.scenario_id === activeId ? " active" : ""}`}>
                        <button className="runner-item-main" disabled={busy} onClick={() => props.onSelect(entry)}>
                            <strong title={entry.name}>{entry.name}</strong>
                            <small>{entry.scene} · {entry.actors} đối tượng · {fmt(entry.duration_s, 1, " s")}</small>
                        </button>
                        <span className={`run-status ${status.tone}`}>{status.label}</span>
                        <span className="runner-item-actions">
                            <button className="icon-button" aria-label={`Xuất ${entry.name}`} title="Xuất kịch bản (.xosc)" disabled={busy} onClick={() => props.onExport(entry)}><Download size={14} aria-hidden/></button>
                            <button className="icon-button" aria-label={`Sửa ${entry.name}`} title="Sửa kịch bản" disabled={busy} onClick={() => void openEdit(entry)}><Pencil size={14} aria-hidden/></button>
                            <button className="icon-button danger" aria-label={`Xoá ${entry.name}`} title="Xoá kịch bản" disabled={busy} onClick={() => props.onDelete(entry)}><Trash2 size={14} aria-hidden/></button>
                        </span>
                    </li>;
                })}
            </ul>
            <div className="runner-foot"><button className="primary full-width create-scenario" onClick={openCreate}>Tạo kịch bản</button></div>
        </section>
        <section className="runner-center" aria-label="Xem trước và kết quả">
            <div className="runner-title">
                <div><strong>{active?.name ?? "Chọn một kịch bản"}</strong><small>{shown ? `${shown.source.scene} · ${shown.profile ?? ""} · ${shown.actors.length} đối tượng` : active ? `${active.scene} · bấm để mở` : ""}</small></div>
                {shown && <div className="runner-chips">
                    <span className="chip ok"><Check size={12} aria-hidden/>Đúng map</span>
                    <span className="chip ok"><Check size={12} aria-hidden/>Động học hợp lệ</span>
                    {diagnostics.length > 0 && <span className="chip warn"><TriangleAlert size={12} aria-hidden/>{diagnostics.length} cảnh báo</span>}
                </div>}
            </div>
            <div className="runner-stage">
                <TrackView scenario={shown} time={props.time} replay={shown ? replay : null} environmentSettings={props.environmentSettings} onReady={props.onSceneReady}/>
                {props.loading}
            </div>
            {props.playback}
        </section>
        <section className="runner-col runner-report" aria-label="Chạy và báo cáo">
            <div className="runner-section runner-map" aria-label="Map 2D">
                {shown ? <TacticalMap scenario={shown} time={props.time} replay={replay}/> : <p className="runner-muted">Chọn một kịch bản để xem map.</p>}
            </div>
            <div className="runner-section" aria-label="Chỉ số kịch bản">
                <MetricsPanel state={props.metrics} time={shown ? props.time : null}/>
            </div>
            <div className="runner-section">
                <h3>Kết quả lần chạy gần nhất</h3>
                {report ? <dl className="kv">
                    <dt>Thực thi</dt><dd className={report.execution}>{report.execution === "pass" ? "Đạt" : "Không đạt"}</dd>
                    <dt>Bám quỹ đạo</dt><dd>{fmt(report.fidelity.coverage * 100, 1, " %")}</dd>
                    <dt>Sai lệch XY tối đa</dt><dd>{fmt(report.fidelity.max_xy_m, 3, " m")}</dd>
                    <dt>Sai lệch góc tối đa</dt><dd>{fmt(report.fidelity.max_yaw_rad, 3, " rad")}</dd>
                    <dt>Tuân thủ map</dt><dd className={report.map_conformance}>{report.map_conformance === "pass" ? "Đạt" : "Không đạt"}</dd>
                    <dt>Quan sát tiếp xúc</dt><dd>{report.contacts.length}</dd>
                </dl> : last ? <dl className="kv">
                    <dt>Thực thi</dt><dd className={last.execution}>{last.execution === "pass" ? "Đạt" : "Không đạt"}</dd>
                    <dt>Bám quỹ đạo</dt><dd>{fmt(last.coverage === undefined ? undefined : last.coverage * 100, 1, " %")}</dd>
                    <dt>Sai lệch XY tối đa</dt><dd>{fmt(last.max_xy_m, 3, " m")}</dd>
                    <dt>Sai lệch góc tối đa</dt><dd>{fmt(last.max_yaw_rad, 3, " rad")}</dd>
                    <dt>Tuân thủ map</dt><dd className={last.map_conformance}>{last.map_conformance === "pass" ? "Đạt" : "Không đạt"}</dd>
                    <dt>Quan sát tiếp xúc</dt><dd>{last.contacts ?? "—"}</dd>
                </dl> : <p className="runner-muted">Chưa có lần chạy.</p>}
            </div>
            {shown && <div className="runner-section">
                <h3>Đối tượng</h3>
                <table><thead><tr><th>ID</th><th>Loại</th><th>V tối đa</th></tr></thead><tbody>
                    {shown.actors.map(a => <tr key={a.id}><td>{a.id}</td><td>{a.role === "ego" ? "ego" : kind(a.category)}</td><td>{fmt(maxSpeed(shown, a.id), 1, " m/s")}</td></tr>)}
                </tbody></table>
            </div>}
            <div className="runner-section">
                <h3>Lịch sử chạy</h3>
                {active?.runs.length ? <table><thead><tr><th>Lúc</th><th>Kết quả</th><th>XY max</th></tr></thead><tbody>
                    {active.runs.map(r => <tr key={r.run_id}><td>{time(r.at)}</td><td className={r.execution ?? ""}>{r.status !== "completed" ? (r.status === "interrupted" ? "Đã huỷ" : r.status === "running" ? "Đang chạy" : "Lỗi") : r.execution === "pass" && r.map_conformance === "pass" ? "Đạt" : "Không đạt"}</td><td>{fmt(r.max_xy_m, 3, " m")}</td></tr>)}
                </tbody></table> : <p className="runner-muted">Chưa có lịch sử.</p>}
                {diagnostics.map((d, i) => <p className="runner-diag" key={i}><TriangleAlert size={13} aria-hidden/>{d.code === "PEDESTRIAN_ROADWAY" ? "Người đi bộ có đoạn đi trên đường ngoài lối qua đường." : d.code === "ESTIMATED_GEOMETRY" ? "Vật cản được ước lượng từ dữ liệu nguồn; chưa xác nhận an toàn vật lý." : d.message}</p>)}
                {report?.warnings.map((w, i) => <p className="runner-diag" key={`w${i}`}><TriangleAlert size={13} aria-hidden/>{w === "Contacts are sampled at 20Hz; geometry is estimated, not a safety certification" ? "Tiếp xúc được lấy mẫu 20 lần/giây; hình học ước lượng chưa xác nhận an toàn vật lý." : w}</p>)}
            </div>
        </section>
        {creating && <div className="runner-dialog-backdrop">
            <div className="runner-dialog" role="dialog" aria-modal="true" aria-label="Tạo kịch bản">
                <div className="runner-dialog-head"><h2>Tạo kịch bản</h2><button className="icon-button" aria-label="Đóng" onClick={() => setCreating(false)}><X size={14} aria-hidden/></button></div>
                <label className="field">Map (cảnh nguồn)<select aria-label="Map cho kịch bản" value={createScene} disabled={busy} onChange={e => setCreateScene(e.target.value)}>
                    {props.scenes.map(scene => <option key={scene} value={scene}>{scene}</option>)}
                </select></label>
                <p className="sensor-note">Tải thông tin map cho công cụ sinh kịch bản, rồi nạp file OpenSCENARIO (.xosc) đúng map này.</p>
                <button className="full-width" disabled={busy || !createScene} onClick={() => void props.onExportMap(createScene)}><MapPin size={14} aria-hidden/> Tải thông tin map</button>
                <button className="primary full-width" disabled={busy || !createScene} onClick={() => void props.onCreate(createScene).then(ok => { if (ok) setCreating(false); })}><Upload size={14} aria-hidden/> Chọn file .xosc</button>
            </div>
        </div>}
        {editing && <div className="runner-dialog-backdrop">
            <div className="runner-dialog wide" role="dialog" aria-modal="true" aria-label={`Sửa ${editing.entry.name}`}>
                <div className="runner-dialog-head"><h2>Sửa kịch bản</h2><button className="icon-button" aria-label="Đóng" onClick={() => setEditing(null)}><X size={14} aria-hidden/></button></div>
                <label className="field">Tên<input aria-label="Tên kịch bản" value={editing.name} maxLength={120} onChange={e => setEditing({ ...editing, name: e.target.value })}/></label>
                <label className="field">Nội dung OpenSCENARIO (XML)<textarea aria-label="Nội dung OpenSCENARIO" spellCheck={false} value={editing.xml} onChange={e => setEditing({ ...editing, xml: e.target.value })}/></label>
                <p className="sensor-note">Khi lưu, kịch bản được kiểm lại với map {editing.entry.scene} như lúc nạp; không hợp lệ thì giữ nguyên bản cũ.</p>
                <div className="button-pair"><button disabled={busy} onClick={() => setEditing(null)}>Huỷ</button><button className="primary" disabled={busy || !editing.name.trim() || !editing.xml.trim()} onClick={() => void props.onSaveEdit(editing.entry, editing.name.trim(), editing.xml).then(ok => { if (ok) setEditing(null); })}>Lưu</button></div>
            </div>
        </div>}
    </div>;
}
