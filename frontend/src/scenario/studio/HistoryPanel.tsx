import { BarChart3, Pencil, Save, Trash2 } from "lucide-react";
import { useT } from "../i18n";
import { KIND_LABEL, describeName, translateVars, type HistoryRow } from "./history";

/** Right column of the Studio (plan50 P01 §3): created scenarios of the current scene with Sửa · Xoá · Phân tích · Lưu. */
export function HistoryPanel({ rows, activeId, busy, error, onRetry, onOpen, onEdit, onDelete, onAnalyse, onSave }: {
    rows: HistoryRow[]; activeId: string | null; busy: boolean; error?: string; onRetry: () => void;
    onOpen: (row: HistoryRow) => void; onEdit: (row: HistoryRow) => void; onDelete: (row: HistoryRow) => void;
    onAnalyse: (row: HistoryRow) => void; onSave?: (row: HistoryRow) => void;
}) {
    const t = useT();
    const time = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""; };
    return <aside className="studio-history" aria-label={t("Lịch sử kịch bản")}>
        <h2>{t("Lịch sử kịch bản")}</h2>
        {error && <div className="studio-inline-error" role="alert"><span>{t("Không đọc được thư viện")}</span><button onClick={onRetry}>{t("Thử lại")}</button><details><summary>{t("Chi tiết lỗi")}</summary>{error}</details></div>}
        {!rows.length && !error && <p className="studio-muted">{t("Chưa có kịch bản cho cảnh này. Bấm “Tạo kịch bản” ở cột bên trái.")}</p>}
        <ul className="studio-history-list">
            {rows.map(row => {
                const editBlocked = row.kind === "real2sim";
                const readable = describeName(row.name);
                return <li key={row.id} className={row.id === activeId ? "active" : undefined}>
                    <button className="studio-history-main" disabled={busy} onClick={() => onOpen(row)}>
                        <strong title={row.name}>{readable ? t(readable.key, translateVars(readable.vars, t)) : row.name}</strong>
                        <small><span className={`chip studio-kind-${row.kind}`}>{t(KIND_LABEL[row.kind])}</span>{row.entry.invalid && <span className="chip studio-invalid-chip" title={row.entry.invalid.message}>{t("Không hợp lệ")}</span>}{row.baseline ? ` ${t("baseline + pilot")} · ` : " "}{time(row.created_at)}</small>
                    </button>
                    <span className="studio-history-actions">
                        <button className="icon-button" aria-label={t("Sửa {name}", { name: row.name })} title={editBlocked ? t("Gói real2sim chỉ xem; sửa trong tool real2sim") : t("Sửa")} disabled={busy || editBlocked} onClick={() => onEdit(row)}><Pencil size={14} aria-hidden/></button>
                        <button className="icon-button danger" aria-label={t("Xoá {name}", { name: row.name })} title={t("Xoá")} disabled={busy} onClick={() => onDelete(row)}><Trash2 size={14} aria-hidden/></button>
                        <button className="icon-button" aria-label={t("Phân tích {name}", { name: row.name })} title={t("Phân tích")} disabled={busy} onClick={() => onAnalyse(row)}><BarChart3 size={14} aria-hidden/></button>
                        {onSave && <button className="icon-button" aria-label={t("Lưu {name}", { name: row.name })} title={t("Lưu / xuất")} disabled={busy} onClick={() => onSave(row)}><Save size={14} aria-hidden/></button>}
                    </span>
                </li>;
            })}
        </ul>
    </aside>;
}
