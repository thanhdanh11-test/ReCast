import { useEffect, useState, type ReactNode } from "react";
import { Check, Download, Pencil, Trash2, TriangleAlert, X } from "lucide-react";
import { ActorTimeline } from "./ActorTimeline";
import { ScenarioCreator } from "./authoring/ScenarioCreator";
import type { ScenarioTemplate } from "./authoring/template";
import type { FitProbe } from "./authoring/MapFit";
import { TrackView } from "./TrackView";
import { MetricsPanel, type MetricsState } from "./MetricsPanel";
import { TacticalMap } from "./TacticalMap";
import type { ImportedEntry, ImportedReport, ImportedRun, Replay, Scenario } from "./types";
import type { SceneEnvironmentSettings } from "./weather";
import { useT } from "./i18n";

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
type XmlDoc = { name: string; file_name: string; xml: string; template?: ScenarioTemplate | null };
export function ScenarioRunner(props: {
    entries: ImportedEntry[]; activeId: string | null;
    busy: boolean; metrics: MetricsState | null;
    scenes: string[]; currentScene: string;
    scenario: Scenario | null; replay: Replay | null; time: number; environmentSettings: SceneEnvironmentSettings;
    playback: ReactNode; duration: number; onSeek: (time: number) => void;
    loading: ReactNode; onSceneReady: () => void;
    onSelect: (entry: ImportedEntry) => void;
    onCreate: (scene: string) => Promise<boolean | undefined>; onCreateTemplate: (template: ScenarioTemplate) => Promise<boolean | undefined>; onFitTemplate?: FitProbe; onExportMap: (scene: string) => Promise<unknown>;
    onExport: (entry: ImportedEntry) => void; onDelete: (entry: ImportedEntry) => void;
    onDeleteRun: (entry: ImportedEntry, runId: string) => void;
    onLoadXml: (entry: ImportedEntry) => Promise<XmlDoc | undefined>;
    onSaveEdit: (entry: ImportedEntry, name: string, xml: string) => Promise<boolean | undefined>;
    onSaveTemplateEdit: (entry: ImportedEntry, template: ScenarioTemplate) => Promise<boolean | undefined>;
}) {
    const t = useT();
    const { entries, activeId, scenario, replay, busy } = props;
    const [tab, setTab] = useState<"library" | "metrics" | "history">("library");
    const [creating, setCreating] = useState(false);
    /** No template: offer "recreate with a template" first; the XML editor only after an explicit "advanced" click. */
    const [editing, setEditing] = useState<{ entry: ImportedEntry; name: string; xml: string; showXml: boolean } | null>(null);
    /** template null = recreate from the type gallery on the same map, replacing the scenario on save. */
    const [editingTemplate, setEditingTemplate] = useState<{ entry: ImportedEntry; template: ScenarioTemplate | null } | null>(null);
    useEffect(() => {
        if (!creating && !editing && !editingTemplate) return;
        const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setCreating(false); setEditing(null); setEditingTemplate(null); } };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [creating, editing, editingTemplate]);
    // Always opens (owner: the button is always available); actions inside wait while a job runs.
    const openCreate = () => setCreating(true);
    const openEdit = async (entry: ImportedEntry) => {
        const doc = await props.onLoadXml(entry);
        // Template-made scenarios are edited as a template; only hand-imported .xosc files fall back to XML.
        if (doc?.template) setEditingTemplate({ entry, template: doc.template });
        else if (doc) setEditing({ entry, name: doc.file_name, xml: doc.xml, showXml: false });
    };
    const active = entries.find(e => e.scenario_id === activeId) ?? null;
    const shown = scenario?.mode === "imported" ? scenario : null;
    const report = replay?.report.kind === "imported" ? replay.report as ImportedReport : null;
    const last: ImportedRun | undefined = active?.runs.find(r => r.status === "completed");
    const diagnostics = shown?.import?.diagnostics ?? [];
    return <div className="runner" data-testid="scenario-runner">
        <section className="runner-center" aria-label={t("Xem trước và kết quả")}>
            <div className="runner-title">
                <div><strong>{active?.name ?? t("Chọn một kịch bản")}</strong><small>{shown ? `${shown.source.scene} · ${shown.profile ?? ""} · ${t("{n} đối tượng", { n: shown.actors.length })}` : active ? `${active.scene} · ${t("bấm để mở")}` : ""}</small></div>
                {shown && <div className="runner-chips">
                    <span className="chip ok"><Check size={12} aria-hidden/>{t("Đúng map")}</span>
                    <span className="chip ok"><Check size={12} aria-hidden/>{t("Động học hợp lệ")}</span>
                    {diagnostics.length > 0 && <span className="chip warn"><TriangleAlert size={12} aria-hidden/>{t("{n} cảnh báo", { n: diagnostics.length })}</span>}
                </div>}
            </div>
            <div className="runner-stage">
                <TrackView scenario={shown} time={props.time} replay={shown ? replay : null} environmentSettings={props.environmentSettings} onReady={props.onSceneReady}/>
                {props.loading}
            </div>
            {props.playback}
            <ActorTimeline key={shown?.id ?? "empty"} scenario={shown} time={props.time} duration={props.duration} disabled={busy || !shown} onSeek={props.onSeek}/>
        </section>
        <aside className="runner-sidebar">
            <div className="runner-tabs" role="tablist" aria-label={t("Nội dung kịch bản")}>
                {([['library', 'Kịch bản'], ['metrics', 'Số liệu'], ['history', 'Lịch sử']] as const).map(([id, label], index, tabs) => <button key={id} id={`tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`runner-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={e => {
                    const next = e.key === 'ArrowRight' ? (index + 1) % tabs.length : e.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
                    if (next !== null) { e.preventDefault(); setTab(tabs[next][0]); document.getElementById(`tab-${tabs[next][0]}`)?.focus(); }
                }}>{t(label)}</button>)}
            </div>
        <section id="runner-library" role="tabpanel" aria-labelledby="tab-library" hidden={tab !== "library"} className="runner-col runner-library" aria-label={t("Thư viện kịch bản")}>
            <div className="runner-head"><h2>{t("Kịch bản")}</h2></div>
            <ul className="runner-list">
                {!entries.length && <li className="runner-empty">{t("Chưa có kịch bản. Bấm “Tạo kịch bản” để nạp file .xosc.")}</li>}
                {entries.map(entry => {
                    const status = runStatus(entry);
                    return <li key={entry.scenario_id} className={`runner-item${entry.scenario_id === activeId ? " active" : ""}`}>
                        <button className="runner-item-main" disabled={busy} onClick={() => props.onSelect(entry)}>
                            <strong title={entry.name}>{entry.name}</strong>
                            <small>{entry.scene} · {t("{n} đối tượng", { n: entry.actors })} · {fmt(entry.duration_s, 1, " s")}</small>
                        </button>
                        <span className={`run-status ${status.tone}`}>{t(status.label)}</span>
                        <span className="runner-item-actions">
                            <button className="icon-button" aria-label={t("Xuất {name}", { name: entry.name })} title={t("Xuất kịch bản (.xosc)")} disabled={busy} onClick={() => props.onExport(entry)}><Download size={14} aria-hidden/></button>
                            <button className="icon-button" aria-label={t("Sửa {name}", { name: entry.name })} title={t("Sửa kịch bản")} disabled={busy} onClick={() => void openEdit(entry)}><Pencil size={14} aria-hidden/></button>
                            <button className="icon-button danger" aria-label={t("Xoá {name}", { name: entry.name })} title={t("Xoá kịch bản")} disabled={busy} onClick={() => props.onDelete(entry)}><Trash2 size={14} aria-hidden/></button>
                        </span>
                    </li>;
                })}
            </ul>
            <div className="runner-foot"><button className="primary full-width create-scenario" onClick={openCreate}>{t("Tạo kịch bản")}</button></div>
        </section>
        <section id="runner-metrics" role="tabpanel" aria-labelledby="tab-metrics" hidden={tab !== "metrics"} className="runner-col runner-report" aria-label={t("Chạy và báo cáo")}>
            <div className="runner-section runner-map" aria-label="Map 2D">
                {shown ? <TacticalMap scenario={shown} time={props.time} replay={replay}/> : <p className="runner-muted">{t("Chọn một kịch bản để xem map.")}</p>}
            </div>
            <div className="runner-section" aria-label={t("Chỉ số kịch bản")}>
                <MetricsPanel state={props.metrics} time={shown ? props.time : null}/>
            </div>
            <div className="runner-section">
                <h3>{t("Kết quả lần chạy gần nhất")}</h3>
                {report ? <dl className="kv">
                    <dt>{t("Thực thi")}</dt><dd className={report.execution}>{report.execution === "pass" ? t("Đạt") : t("Không đạt")}</dd>
                    <dt>{t("Bám quỹ đạo")}</dt><dd>{fmt(report.fidelity.coverage * 100, 1, " %")}</dd>
                    <dt>{t("Sai lệch XY tối đa")}</dt><dd>{fmt(report.fidelity.max_xy_m, 3, " m")}</dd>
                    <dt>{t("Sai lệch góc tối đa")}</dt><dd>{fmt(report.fidelity.max_yaw_rad, 3, " rad")}</dd>
                    <dt>{t("Tuân thủ map")}</dt><dd className={report.map_conformance}>{report.map_conformance === "pass" ? t("Đạt") : t("Không đạt")}</dd>
                    <dt>{t("Quan sát tiếp xúc")}</dt><dd>{report.contacts.length}</dd>
                </dl> : last ? <dl className="kv">
                    <dt>{t("Thực thi")}</dt><dd className={last.execution}>{last.execution === "pass" ? t("Đạt") : t("Không đạt")}</dd>
                    <dt>{t("Bám quỹ đạo")}</dt><dd>{fmt(last.coverage === undefined ? undefined : last.coverage * 100, 1, " %")}</dd>
                    <dt>{t("Sai lệch XY tối đa")}</dt><dd>{fmt(last.max_xy_m, 3, " m")}</dd>
                    <dt>{t("Sai lệch góc tối đa")}</dt><dd>{fmt(last.max_yaw_rad, 3, " rad")}</dd>
                    <dt>{t("Tuân thủ map")}</dt><dd className={last.map_conformance}>{last.map_conformance === "pass" ? t("Đạt") : t("Không đạt")}</dd>
                    <dt>{t("Quan sát tiếp xúc")}</dt><dd>{last.contacts ?? "—"}</dd>
                </dl> : <p className="runner-muted">{t("Chưa có lần chạy.")}</p>}
            </div>
            {shown && <div className="runner-section">
                <h3>{t("Đối tượng")}</h3>
                <table><thead><tr><th>ID</th><th>{t("Loại")}</th><th>{t("V tối đa")}</th></tr></thead><tbody>
                    {shown.actors.map(a => <tr key={a.id}><td>{a.id}</td><td>{a.role === "ego" ? "ego" : t(kind(a.category))}</td><td>{fmt(maxSpeed(shown, a.id), 1, " m/s")}</td></tr>)}
                </tbody></table>
            </div>}
        </section>
        {tab === "history" && <section id="runner-history" className="runner-history" role="tabpanel" aria-labelledby="tab-history" hidden={tab !== "history"}>
            <div className="runner-section">
                <h3>{t("Lịch sử chạy")}</h3>
                {entries.some(e => e.runs.length) ? <table><thead><tr><th>{t("Lúc")}</th><th>{t("Kết quả")}</th><th>XY max</th><th aria-label={t("Xoá lịch sử")}/></tr></thead><tbody>
                    {entries.flatMap(entry => entry.runs.map(r => ({ entry, r }))).sort((a, b) => b.r.at.localeCompare(a.r.at)).map(({entry, r}) => <tr key={`${entry.scenario_id}-${r.run_id}`}><td><strong>{entry.name}</strong><br/>{new Date(r.at).toLocaleDateString()} {time(r.at)}</td><td className={r.execution ?? ""}>{r.status !== "completed" ? (r.status === "interrupted" ? t("Đã huỷ") : r.status === "running" ? t("Đang chạy") : t("Lỗi")) : r.execution === "pass" && r.map_conformance === "pass" ? t("Đạt") : t("Không đạt")}</td><td>{fmt(r.max_xy_m, 3, " m")}</td><td><button className="icon-button" aria-label={t("Xoá lần chạy {name} lúc {at}", { name: entry.name, at: r.at })} title={t("Xoá lịch sử")} disabled={busy || r.status === "running"} onClick={() => props.onDeleteRun(entry, r.run_id)}><Trash2 size={14} aria-hidden/></button></td></tr>)}
                </tbody></table> : <p className="runner-muted">{t("Chưa có lịch sử.")}</p>}
                {diagnostics.map((d, i) => <p className="runner-diag" key={i}><TriangleAlert size={13} aria-hidden/>{d.code === "PEDESTRIAN_ROADWAY" ? t("Người đi bộ có đoạn đi trên đường ngoài lối qua đường.") : d.code === "ESTIMATED_GEOMETRY" ? t("Vật cản được ước lượng từ dữ liệu nguồn; chưa xác nhận an toàn vật lý.") : d.message}</p>)}
                {report?.warnings.map((w, i) => <p className="runner-diag" key={`w${i}`}><TriangleAlert size={13} aria-hidden/>{w === "Contacts are sampled at 20Hz; geometry is estimated, not a safety certification" ? t("Tiếp xúc được lấy mẫu 20 lần/giây; hình học ước lượng chưa xác nhận an toàn vật lý.") : w}</p>)}
            </div>
        </section>}
        </aside>
        {creating && <ScenarioCreator scenes={props.scenes} currentScene={props.currentScene} busy={busy} onClose={() => setCreating(false)} onExportMap={props.onExportMap} onImportXosc={props.onCreate} onCreateTemplate={props.onCreateTemplate} fitTemplate={props.onFitTemplate}/>}
        {editingTemplate && <ScenarioCreator scenes={props.scenes} currentScene={editingTemplate.template?.map.scene ?? editingTemplate.entry.scene} busy={busy}
            editing={{ name: editingTemplate.entry.name, template: editingTemplate.template }}
            onClose={() => setEditingTemplate(null)} onExportMap={props.onExportMap} onImportXosc={props.onCreate}
            onCreateTemplate={template => props.onSaveTemplateEdit(editingTemplate.entry, template)} fitTemplate={props.onFitTemplate}/>}
        {editing && <div className="runner-dialog-backdrop">
            <div className="runner-dialog wide" role="dialog" aria-modal="true" aria-label={t("Sửa {name}", { name: editing.entry.name })}>
                <div className="runner-dialog-head"><h2>{t("Sửa kịch bản")}</h2><button className="icon-button" aria-label={t("Đóng")} onClick={() => setEditing(null)}><X size={14} aria-hidden/></button></div>
                {!editing.showXml ? <>
                    <p className="runner-edit-note">{t("“{name}” không có template đi kèm (nạp từ file .xosc, hoặc tạo trước bản 0.30.0), nên không mở lại được form template.", { name: editing.entry.name })}</p>
                    <p className="sensor-note">{t("Tạo lại bằng template trên cùng map {scene}: khi lưu, kịch bản mới thay thế kịch bản này (bản cũ vào thùng rác).", { scene: editing.entry.scene })}</p>
                    <button className="primary full-width" disabled={busy} onClick={() => { setEditingTemplate({ entry: editing.entry, template: null }); setEditing(null); }}>{t("Tạo lại bằng template")}</button>
                    <div className="button-pair"><button disabled={busy} onClick={() => setEditing(null)}>{t("Huỷ")}</button><button disabled={busy} onClick={() => setEditing({ ...editing, showXml: true })}>{t("Sửa XML (nâng cao)")}</button></div>
                </> : <>
                <label className="field">{t("Tên")}<input aria-label={t("Tên kịch bản")} value={editing.name} maxLength={120} onChange={e => setEditing({ ...editing, name: e.target.value })}/></label>
                <label className="field">{t("Nội dung OpenSCENARIO (XML)")}<textarea aria-label={t("Nội dung OpenSCENARIO")} spellCheck={false} value={editing.xml} onChange={e => setEditing({ ...editing, xml: e.target.value })}/></label>
                <p className="sensor-note">{t("Khi lưu, kịch bản được kiểm lại với map {scene} như lúc nạp; không hợp lệ thì giữ nguyên bản cũ.", { scene: editing.entry.scene })}</p>
                <div className="button-pair"><button disabled={busy} onClick={() => setEditing(null)}>{t("Huỷ")}</button><button className="primary" disabled={busy || !editing.name.trim() || !editing.xml.trim()} onClick={() => void props.onSaveEdit(editing.entry, editing.name.trim(), editing.xml).then(ok => { if (ok) setEditing(null); })}>{t("Lưu")}</button></div>
                </>}
            </div>
        </div>}
    </div>;
}
