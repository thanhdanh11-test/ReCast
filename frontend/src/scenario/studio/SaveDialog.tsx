import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";
import type { ExportFormat } from "../types";

/** "Lưu" popup (plan50 P04 §3): export format dropdown, then Xác nhận / Huỷ. */
export function SaveDialog({ name, carlaBlocked, busy, onCancel, onConfirm }: {
    name: string; carlaBlocked: string | null; busy: boolean; onCancel: () => void; onConfirm: (format: ExportFormat) => void;
}) {
    const t = useT();
    const [format, setFormat] = useState<ExportFormat>(carlaBlocked ? "xosc" : "carla");
    return <div className="runner-dialog-backdrop" onKeyDown={e => { if (e.key === "Escape") onCancel(); }}>
        <div className="runner-dialog studio-save" role="dialog" aria-modal="true" aria-label={t("Lưu kịch bản · {name}", { name })}>
            <div className="runner-dialog-head"><h2>{t("Lưu kịch bản")}</h2><button className="icon-button" aria-label={t("Đóng")} onClick={onCancel}><X size={14} aria-hidden/></button></div>
            <p className="studio-save-name">{name}</p>
            <label className="field">{t("Định dạng xuất")}
                <select aria-label={t("Định dạng xuất")} value={format} onChange={e => setFormat(e.target.value as ExportFormat)}>
                    <option value="carla" disabled={!!carlaBlocked}>{t("Xuất cho CARLA")}</option>
                    <option value="xosc">{t("Chỉ .xosc")}</option>
                </select>
            </label>
            <p className="sensor-note">{format === "carla"
                ? t("Gồm .xosc, bản đồ .xodr, trajectories.csv, report.json (nếu có) và manifest.json — mở được bằng CARLA 0.9.15 / esmini.")
                : t("Một tệp OpenSCENARIO đúng như bản đã lưu, kèm manifest.json.")}</p>
            {carlaBlocked && <p className="sensor-note" role="note">{t("Không xuất được cho CARLA")}: {t(carlaBlocked)}</p>}
            <div className="button-pair"><button disabled={busy} onClick={onCancel}>{t("Huỷ")}</button><button className="primary" disabled={busy} onClick={() => onConfirm(format)}>{t("Xác nhận")}</button></div>
        </div>
    </div>;
}
