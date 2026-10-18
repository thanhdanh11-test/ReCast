import { useEffect, useRef, useState } from "react";
import { Clapperboard, Download, Play, RotateCcw, Trash2, X } from "lucide-react";
import { useT } from "../i18n";
import type { CarlaRender, CarlaView, DesktopAPI, ExportJob } from "../types";

const POLL_MS = 1000;
const working = (r?: CarlaRender | null) => r?.status === "queued" || r?.status === "running";
const active = (jobs: ExportJob[]) => jobs.some(j => j.status === "queued" || j.status === "running" || working(j.carla_render));
const VIEW_LABEL: Record<CarlaView, string> = { chase: "Sau xe (camera bám)", driver: "Trong xe (ghế lái)" };
/** m:ss since the render started (the waiting time shown next to the CARLA bar). */
const waited = (iso: string, until: string | null) => {
    const s = Math.max(0, Math.round(((until ? Date.parse(until) : Date.now()) - Date.parse(iso)) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "Đã xuất" page (plan50 P04 §4): every export with live progress, download, retry and delete. Polls only while a
 * job or a CARLA render (plan57) is running and the page is shown. */
export function ExportsPage({ api, shown, onActiveChange }: { api: DesktopAPI; shown: boolean; onActiveChange?: (n: number) => void }) {
    const t = useT();
    const [jobs, setJobs] = useState<ExportJob[]>([]);
    const [error, setError] = useState("");
    const [carla, setCarla] = useState<{ available: boolean; reason?: string } | null>(null);
    const [asking, setAsking] = useState<{ job: ExportJob; view: CarlaView } | null>(null);
    const [playing, setPlaying] = useState<{ job: ExportJob; view: CarlaView } | null>(null);
    const alive = useRef(true);
    async function load() {
        if (!api.listExports) return;
        try { const rows = await api.listExports(); if (alive.current) { setJobs(rows); setError(""); } }
        catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    }
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => {
        if (!shown) return;
        void load();
        api.carlaRenderInfo?.().then(info => alive.current && setCarla(info), () => alive.current && setCarla({ available: false }));
    }, [shown]);
    useEffect(() => {
        onActiveChange?.(jobs.filter(j => j.status === "queued" || j.status === "running").length);
        if (!shown || !active(jobs)) return;
        const timer = window.setTimeout(() => void load(), POLL_MS);
        return () => window.clearTimeout(timer);
    }, [jobs, shown]);
    async function remove(job: ExportJob) {
        if (!api.deleteExport || !window.confirm(t("Xoá bản xuất “{name}”? Tệp được chuyển vào thùng rác; kịch bản gốc giữ nguyên.", { name: job.name }))) return;
        try { await api.deleteExport({ id: job.id }); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }
    async function retry(job: ExportJob) {
        if (!api.exportScenario) return;
        try { await api.exportScenario({ scenario_id: job.scenario_id, format: job.format }); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }
    async function render() {
        if (!asking || !api.renderCarla) return;
        const { job, view } = asking;
        setAsking(null);
        try {
            const state = await api.renderCarla({ id: job.id, view });
            setJobs(rows => rows.map(r => r.id === job.id ? { ...r, carla_render: state } : r));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }
    const busy = jobs.some(j => working(j.carla_render));
    const time = (iso: string | null) => iso ? new Date(iso).toLocaleString() : "—";
    return <main className="studio-exports" aria-label={t("Đã xuất")}>
        <header className="studio-exports-head"><h1>{t("Đã xuất")}</h1><p>{t("Các kịch bản đã lưu ra tệp. Bản xuất chạy nền; bạn có thể rời trang trong lúc chờ.")}</p></header>
        {error && <div className="studio-inline-error" role="alert"><span>{error.replace(/^[A-Z_]+: /, "")}</span><button onClick={() => void load()}>{t("Thử lại")}</button></div>}
        {!jobs.length ? <p className="studio-muted">{t("Chưa có bản xuất. Bấm nút Lưu ở cột Lịch sử của trang Kịch bản.")}</p>
        : <table className="studio-exports-table">
            <thead><tr><th>{t("Tên")}</th><th>{t("Cảnh")}</th><th>{t("Định dạng")}</th><th>{t("Tiến độ")}</th><th>{t("Thời gian")}</th><th aria-label={t("Hành động")}/></tr></thead>
            <tbody>{jobs.map(job => {
                const r = job.carla_render;
                const canRender = job.format === "carla" && job.status === "done" && !!api.renderCarla;
                const offReason = !carla?.available ? (carla?.reason ?? t("Chưa cấu hình máy CARLA")) : busy ? t("Đang dựng một kịch bản khác trên CARLA") : undefined;
                return <tr key={job.id} data-status={job.status}>
                    <td><strong>{job.name}</strong>{job.notes.map((n, i) => <small key={i}>{t(n)}</small>)}</td>
                    <td>{job.scene}</td>
                    <td>{job.format === "carla" ? "CARLA" : ".xosc"}</td>
                    <td className="studio-progress-cell">
                        <progress max={100} value={job.progress} aria-label={t("Tiến độ {name}", { name: job.name })}/>
                        <span>{job.progress}% · {job.status === "failed" ? `${t("Lỗi")}: ${job.error?.message ?? ""}` : t(job.status === "queued" ? "Đang chờ" : job.step)}</span>
                        {r && <div className={`studio-carla-render ${r.status}`}>
                            {working(r) && <progress max={100} value={r.progress} aria-label={t("CARLA {name}", { name: job.name })}/>}
                            <span>{r.status === "failed" ? `CARLA: ${r.error?.message ?? t("Lỗi")}`
                                : r.status === "done" ? t("CARLA: video {view} sẵn sàng · {time}", { view: t(VIEW_LABEL[r.view]).toLowerCase(), time: waited(r.started_at, r.finished_at) })
                                : `CARLA ${r.progress}% · ${t(r.step)} · ${t("đã chờ")} ${waited(r.started_at, null)}`}</span>
                        </div>}
                    </td>
                    <td>{time(job.finished_at ?? job.created_at)}</td>
                    <td><div className="studio-export-actions">
                        {job.status === "done" && api.exportUrl && <a className="button-like" href={api.exportUrl(job.id)} download aria-label={t("Tải về {name}", { name: job.name })}><Download size={14} aria-hidden/>{t("Tải về")}</a>}
                        {canRender && <button aria-label={t("Xem trên CARLA {name}", { name: job.name })} disabled={!!offReason} title={offReason}
                            onClick={() => setAsking({ job, view: r?.view ?? "chase" })}><Clapperboard size={14} aria-hidden/>{t("Xem trên CARLA")}</button>}
                        {r?.status === "done" && r.video && api.carlaVideoUrl && <>
                            <button aria-label={t("Xem video {name}", { name: job.name })} onClick={() => setPlaying({ job, view: r.view })}><Play size={14} aria-hidden/>{t("Xem video")}</button>
                            <a className="button-like" href={api.carlaVideoUrl(job.id, r.view)} download aria-label={t("Tải video {name}", { name: job.name })}><Download size={14} aria-hidden/>{t("Tải video")}</a>
                        </>}
                        {job.status === "failed" && <button onClick={() => void retry(job)} aria-label={t("Xuất lại {name}", { name: job.name })}><RotateCcw size={14} aria-hidden/>{t("Xuất lại")}</button>}
                        <button className="icon-button danger" aria-label={t("Xoá bản xuất {name}", { name: job.name })} disabled={job.status === "running" || working(r)} title={job.status === "running" ? t("Đang xuất, chờ xong rồi xoá") : t("Xoá")} onClick={() => void remove(job)}><Trash2 size={14} aria-hidden/></button>
                    </div></td>
                </tr>;
            })}</tbody>
        </table>}
        {asking && <div className="runner-dialog-backdrop" onKeyDown={e => { if (e.key === "Escape") setAsking(null); }}>
            <div className="runner-dialog" role="dialog" aria-modal="true" aria-label={t("Xem trên CARLA")}>
                <div className="runner-dialog-head"><h2>{t("Xem trên CARLA")}</h2><button className="icon-button" aria-label={t("Đóng")} onClick={() => setAsking(null)}><X size={14} aria-hidden/></button></div>
                <p className="studio-save-name">{asking.job.name}</p>
                <fieldset className="studio-carla-views"><legend>{t("Góc nhìn")}</legend>
                    {(["chase", "driver"] as const).map(view => <label key={view}>
                        <input type="radio" name="carla-view" checked={asking.view === view} onChange={() => setAsking({ ...asking, view })}/>{t(VIEW_LABEL[view])}
                    </label>)}
                </fieldset>
                <p className="sensor-note">{t("App sẽ bật máy GPU thuê (khoảng 0,85 USD/giờ), dựng cảnh trên CARLA và quay video; thường mất 5–12 phút. Máy tự tắt khi xong.")}</p>
                <div className="button-pair"><button onClick={() => setAsking(null)}>{t("Huỷ")}</button><button className="primary" onClick={() => void render()}>{t("Bắt đầu dựng")}</button></div>
            </div>
        </div>}
        {playing && api.carlaVideoUrl && <div className="runner-dialog-backdrop" onKeyDown={e => { if (e.key === "Escape") setPlaying(null); }}>
            <div className="runner-dialog wide" role="dialog" aria-modal="true" aria-label={t("Video CARLA")}>
                <div className="runner-dialog-head"><h2>{playing.job.name} · {t(VIEW_LABEL[playing.view])}</h2><button className="icon-button" aria-label={t("Đóng")} onClick={() => setPlaying(null)}><X size={14} aria-hidden/></button></div>
                <video className="studio-carla-video" src={api.carlaVideoUrl(playing.job.id, playing.view)} controls autoPlay/>
            </div>
        </div>}
    </main>;
}
