import { useEffect, useRef, useState } from "react";
import { Download, RotateCcw, Trash2 } from "lucide-react";
import { useT } from "../i18n";
import type { DesktopAPI, ExportJob } from "../types";

const POLL_MS = 1000;
const active = (jobs: ExportJob[]) => jobs.some(j => j.status === "queued" || j.status === "running");

/** "Đã xuất" page (plan50 P04 §4): every export with live progress, download, retry and delete. Polls only while a
 * job is queued/running and the page is shown. */
export function ExportsPage({ api, shown, onActiveChange }: { api: DesktopAPI; shown: boolean; onActiveChange?: (n: number) => void }) {
    const t = useT();
    const [jobs, setJobs] = useState<ExportJob[]>([]);
    const [error, setError] = useState("");
    const alive = useRef(true);
    async function load() {
        if (!api.listExports) return;
        try { const rows = await api.listExports(); if (alive.current) { setJobs(rows); setError(""); } }
        catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    }
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => { if (shown) void load(); }, [shown]);
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
    const time = (iso: string | null) => iso ? new Date(iso).toLocaleString() : "—";
    return <main className="studio-exports" aria-label={t("Đã xuất")}>
        <header className="studio-exports-head"><h1>{t("Đã xuất")}</h1><p>{t("Các kịch bản đã lưu ra tệp. Bản xuất chạy nền; bạn có thể rời trang trong lúc chờ.")}</p></header>
        {error && <div className="studio-inline-error" role="alert"><span>{error.replace(/^[A-Z_]+: /, "")}</span><button onClick={() => void load()}>{t("Thử lại")}</button></div>}
        {!jobs.length ? <p className="studio-muted">{t("Chưa có bản xuất. Bấm nút Lưu ở cột Lịch sử của trang Kịch bản.")}</p>
        : <table className="studio-exports-table">
            <thead><tr><th>{t("Tên")}</th><th>{t("Cảnh")}</th><th>{t("Định dạng")}</th><th>{t("Tiến độ")}</th><th>{t("Thời gian")}</th><th aria-label={t("Hành động")}/></tr></thead>
            <tbody>{jobs.map(job => <tr key={job.id} data-status={job.status}>
                <td><strong>{job.name}</strong>{job.notes.map((n, i) => <small key={i}>{t(n)}</small>)}</td>
                <td>{job.scene}</td>
                <td>{job.format === "carla" ? "CARLA" : ".xosc"}</td>
                <td className="studio-progress-cell">
                    <progress max={100} value={job.progress} aria-label={t("Tiến độ {name}", { name: job.name })}/>
                    <span>{job.progress}% · {job.status === "failed" ? `${t("Lỗi")}: ${job.error?.message ?? ""}` : t(job.status === "queued" ? "Đang chờ" : job.step)}</span>
                </td>
                <td>{time(job.finished_at ?? job.created_at)}</td>
                <td><div className="studio-export-actions">
                    {job.status === "done" && api.exportUrl && <a className="button-like" href={api.exportUrl(job.id)} download aria-label={t("Tải về {name}", { name: job.name })}><Download size={14} aria-hidden/>{t("Tải về")}</a>}
                    {job.status === "failed" && <button onClick={() => void retry(job)} aria-label={t("Xuất lại {name}", { name: job.name })}><RotateCcw size={14} aria-hidden/>{t("Xuất lại")}</button>}
                    <button className="icon-button danger" aria-label={t("Xoá bản xuất {name}", { name: job.name })} disabled={job.status === "running"} title={job.status === "running" ? t("Đang xuất, chờ xong rồi xoá") : t("Xoá")} onClick={() => void remove(job)}><Trash2 size={14} aria-hidden/></button>
                </div></td>
            </tr>)}</tbody>
        </table>}
    </main>;
}
