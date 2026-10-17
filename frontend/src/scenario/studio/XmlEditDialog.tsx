import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";
import type { ImportedEntry } from "../types";

/** Sửa a hand-imported .xosc (no template): offer "recreate with a template" first, the XML editor only on request. */
export function XmlEditDialog({ entry, name: initialName, xml: initialXml, busy, error, onClose, onRecreate, onSave }: {
    entry: ImportedEntry; name: string; xml: string; busy: boolean; error?: string; onClose: () => void; onRecreate: () => void;
    onSave: (name: string, xml: string) => Promise<boolean | undefined>;
}) {
    const t = useT();
    const [showXml, setShowXml] = useState(false);
    const [name, setName] = useState(initialName);
    const [xml, setXml] = useState(initialXml);
    return <div className="runner-dialog-backdrop">
        <div className="runner-dialog wide" role="dialog" aria-modal="true" aria-label={t("Sửa {name}", { name: entry.name })}>
            <div className="runner-dialog-head"><h2>{t("Sửa kịch bản")}</h2><button className="icon-button" aria-label={t("Đóng")} onClick={onClose}><X size={14} aria-hidden/></button></div>
            {!showXml ? <>
                <p className="runner-edit-note">{t("“{name}” không có template đi kèm (nạp từ file .xosc, hoặc tạo trước bản 0.30.0), nên không mở lại được form template.", { name: entry.name })}</p>
                <p className="sensor-note">{t("Tạo lại bằng template trên cùng map {scene}: khi lưu, kịch bản mới thay thế kịch bản này (bản cũ vào thùng rác).", { scene: entry.scene })}</p>
                <button className="primary full-width" disabled={busy} onClick={onRecreate}>{t("Tạo lại bằng template")}</button>
                <div className="button-pair"><button disabled={busy} onClick={onClose}>{t("Huỷ")}</button><button disabled={busy} onClick={() => setShowXml(true)}>{t("Sửa XML (nâng cao)")}</button></div>
            </> : <>
                <label className="field">{t("Tên")}<input aria-label={t("Tên kịch bản")} value={name} maxLength={120} onChange={e => setName(e.target.value)}/></label>
                <label className="field">{t("Nội dung OpenSCENARIO (XML)")}<textarea aria-label={t("Nội dung OpenSCENARIO")} spellCheck={false} value={xml} onChange={e => setXml(e.target.value)}/></label>
                <p className="sensor-note">{t("Khi lưu, kịch bản được kiểm lại với map {scene} như lúc nạp; không hợp lệ thì giữ nguyên bản cũ.", { scene: entry.scene })}</p>
                {error && <p className="authoring-warn" role="alert">{error.replace(/^[A-Z_]+: /, "")}</p>}
                <div className="button-pair"><button disabled={busy} onClick={onClose}>{t("Huỷ")}</button><button className="primary" disabled={busy || !name.trim() || !xml.trim()} onClick={() => void onSave(name.trim(), xml).then(ok => { if (ok) onClose(); })}>{t("Lưu")}</button></div>
            </>}
        </div>
    </div>;
}
