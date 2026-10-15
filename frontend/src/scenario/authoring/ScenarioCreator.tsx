import { useRef, useState } from "react";
import { ArrowLeft, Check, Download, FileUp, FolderOpen, LayoutGrid, MapPin, Sparkles, TriangleAlert, Upload, X } from "lucide-react";
import { useT } from "../i18n";
import { TYPE_BY_ID, newTemplate, type ScenarioType } from "./catalog";
import { AiChat } from "./AiChat";
import { KeyParams, TemplateForm } from "./TemplateForm";
import { MapFit, type FitProbe } from "./MapFit";
import { TemplatePreview } from "./TemplatePreview";
import { TypeGallery } from "./TypeGallery";
import { parseTemplate, validateTemplate, type Issue, type ScenarioTemplate } from "./template";
import "./authoring.css";

/**
 * “Tạo kịch bản” screen (plan38 P01): pick a type → edit the template, or describe it to AI → same template.
 * “Tạo từ template” compiles it in the worker (P02) and imports it like a .xosc file; the existing .xosc import and
 * map-context export stay available in the footer.
 */
export function ScenarioCreator({ scenes, currentScene, busy, onClose, onExportMap, onImportXosc, onImportPackage, onCreateTemplate, fitTemplate, editing }: {
    scenes: string[]; currentScene: string; busy: boolean; onClose: () => void;
    onExportMap: (scene: string) => Promise<unknown>; onImportXosc: (scene: string) => Promise<boolean | undefined>;
    /** real2sim package folder (plan43); its report.json picks the scene, else the selected map. */
    onImportPackage?: (scene: string) => Promise<boolean | undefined>;
    onCreateTemplate: (template: ScenarioTemplate) => Promise<boolean | undefined>;
    /** Map suggestions; absent (e.g. static demo) hides them. */
    fitTemplate?: FitProbe;
    /** Editing a library scenario made from a template: starts in its form; saving replaces that scenario. */
    editing?: { name: string; template: ScenarioTemplate | null };
}) {
    const t = useT();
    const [scene, setScene] = useState(currentScene || scenes[0] || "");
    const [mode, setMode] = useState<"template" | "ai">("template");
    const [template, setTemplate] = useState<ScenarioTemplate | null>(() => editing?.template ? parseTemplate(JSON.stringify(editing.template)) : null);
    const [view, setView] = useState<"diagram" | "json">("diagram");
    const [issues, setIssues] = useState<Issue[] | null>(null);
    const [loadError, setLoadError] = useState("");
    const file = useRef<HTMLInputElement>(null);
    const type: ScenarioType | undefined = template ? TYPE_BY_ID.get(template.scenario_type) : undefined;

    const edit = (next: ScenarioTemplate | null) => { setTemplate(next); setIssues(null); };
    const pickScene = (value: string) => { setScene(value); if (template) edit({ ...template, map: { ...template.map, scene: value } }); };
    const pick = (picked: ScenarioType) => { edit(newTemplate(picked, scene, t(picked.name))); setMode("template"); };
    const download = () => {
        if (!template) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
        const a = Object.assign(document.createElement("a"), { href: url, download: `${template.name.trim().replace(/[^\w-]+/g, "_") || "scenario"}.template.json` });
        a.click();
        URL.revokeObjectURL(url);
    };
    const load = async (picked: File | undefined) => {
        if (!picked) return;
        try {
            const loaded = parseTemplate(await picked.text());
            if (!TYPE_BY_ID.has(loaded.scenario_type)) throw new Error(`Loại kịch bản không xác định: ${loaded.scenario_type}`);
            setLoadError(""); setMode("template"); edit(loaded);
        } catch (error) { setLoadError(error instanceof Error ? error.message : String(error)); }
        if (file.current) file.current.value = "";
    };
    const mapsMatch = !template || template.map.scene === scene;
    /** Client checks first (fast feedback); the worker re-checks everything and runs validate_xosc. */
    const create = () => {
        if (!template) return;
        const found = validateTemplate(template);
        setIssues(found);
        if (!found.length) void onCreateTemplate(template).then(ok => { if (ok) onClose(); });
    };

    return <div className="runner-dialog-backdrop">
        <div className="runner-dialog authoring" role="dialog" aria-modal="true" aria-label={editing ? t("Sửa {name}", { name: editing.name }) : t("Tạo kịch bản")}>
            <header className="authoring-head">
                <div className="authoring-modes" role="tablist" aria-label={t("Cách tạo kịch bản")}>
                    <button role="tab" aria-selected={mode === "template"} onClick={() => setMode("template")}><LayoutGrid size={14} aria-hidden/>{t("Từ template")}</button>
                    <button role="tab" aria-selected={mode === "ai"} onClick={() => setMode("ai")}><Sparkles size={14} aria-hidden/>{t("Bằng AI")}</button>
                </div>
                <label className="authoring-map">{t("Map")}<select aria-label={t("Map cho kịch bản")} value={scene} disabled={busy} onChange={e => pickScene(e.target.value)}>
                    {scenes.map(s => <option key={s} value={s}>{s}</option>)}
                </select></label>
                <button className="icon-button" aria-label={t("Đóng")} onClick={onClose}><X size={14} aria-hidden/></button>
            </header>

            <div className="authoring-body">
                {/* Kept mounted so the conversation survives switching tabs. */}
                <div className="authoring-chat-wrap" hidden={mode !== "ai"}><AiChat scene={scene} onOpen={result => { edit(result.template); setMode("template"); }}/></div>
                {mode === "template" && !template && <TypeGallery scene={scene} onPick={pick}/>}
                {mode === "template" && template && <div className="authoring-editor">
                    <div className="authoring-left">
                        <div className="authoring-type">
                            {type && <type.icon size={18} aria-hidden/>}
                            <div><strong>{type ? t(type.name) : template.scenario_type}</strong>{type && <small>{t("Cần trên map")}: {t(type.requires)}</small>}</div>
                            <button className="authoring-add" onClick={() => edit(null)}><ArrowLeft size={13} aria-hidden/>{t("Đổi loại")}</button>
                        </div>
                        {fitTemplate && <MapFit template={template} scenes={scenes} scene={scene} probe={fitTemplate} onPick={pickScene}/>}
                        {type && <section aria-label={t("Tham số chính")}><h3>{t("Tham số chính")}</h3><KeyParams template={template} type={type} set={edit}/></section>}
                        <h3>{t("Chi tiết template")}</h3>
                        <TemplateForm template={template} set={edit} scenes={scenes}/>
                    </div>
                    <div className="authoring-right">
                        <div className="runner-tabs authoring-view-tabs" role="tablist" aria-label={t("Xem trước template")}>
                            <button role="tab" aria-selected={view === "diagram"} onClick={() => setView("diagram")}>{t("Sơ đồ")}</button>
                            <button role="tab" aria-selected={view === "json"} onClick={() => setView("json")}>JSON</button>
                        </div>
                        {view === "diagram" ? <div className="authoring-diagram">
                            <TemplatePreview template={template} layout={type?.layout ?? "straight"}/>
                            <p className="sensor-note">{t("Sơ đồ minh hoạ trong hệ toạ độ của ego (chưa đặt lên map thật). Đỏ: ego · nét đứt: lộ trình · ⚡: tình huống.")}</p>
                            <dl className="kv">
                                <dt>{t("Thời lượng")}</dt><dd>{template.map.duration_s} s</dd>
                                <dt>{t("Đối tượng")}</dt><dd>{template.actors.length}</dd>
                                <dt>{t("Tình huống")}</dt><dd>{template.events.length}</dd>
                                <dt>{t("Thời tiết")}</dt><dd>{template.environment.weather_preset}</dd>
                            </dl>
                        </div> : <pre className="authoring-json" aria-label={t("Nội dung template (JSON)")}>{JSON.stringify(template, null, 2)}</pre>}
                        {!mapsMatch && <p className="authoring-warn">{t("Map của template khác map đang chọn ở trên.")}</p>}
                        {issues && (issues.length
                            ? <ul className="authoring-issues" role="alert">{issues.map((issue, i) => <li key={i}><TriangleAlert size={12} aria-hidden/>{t(issue.message, issue.vars)}</li>)}</ul>
                            : <p className="chip ok authoring-valid"><Check size={12} aria-hidden/>{t("Template hợp lệ")}</p>)}
                    </div>
                </div>}
                {loadError && <p className="authoring-warn" role="alert">{t(loadError)}</p>}
            </div>

            <footer className="authoring-foot">
                <div className="authoring-foot-group">
                    <button disabled={busy || !scene} onClick={() => void onExportMap(scene)}><MapPin size={14} aria-hidden/> {t("Tải thông tin map")}</button>
                    <button disabled={busy || !scene} onClick={() => void onImportXosc(scene).then(ok => { if (ok) onClose(); })}><Upload size={14} aria-hidden/> {t("Chọn file .xosc")}</button>
                    {onImportPackage && <button disabled={busy || !scene} title={t("Chọn thư mục gói real2sim (.xosc + report.json + trajectories.csv)")} onClick={() => void onImportPackage(scene).then(ok => { if (ok) onClose(); })}><FolderOpen size={14} aria-hidden/> {t("Nạp gói real2sim")}</button>}
                    <button onClick={() => file.current?.click()}><FileUp size={14} aria-hidden/> {t("Nạp template")}</button>
                    <input ref={file} type="file" accept=".json,application/json" hidden aria-label={t("File template")} onChange={e => void load(e.target.files?.[0])}/>
                </div>
                <div className="authoring-foot-group">
                    <button onClick={onClose}>{t("Huỷ")}</button>
                    {mode === "template" && template && <>
                        <button onClick={download}><Download size={14} aria-hidden/> {t("Tải template")}</button>
                        <button onClick={() => setIssues(validateTemplate(template))}><Check size={14} aria-hidden/> {t("Kiểm tra")}</button>
                        <button className="primary" disabled={busy || !mapsMatch} title={mapsMatch ? undefined : t("Map của template khác map đang chọn ở trên.")} onClick={create}>{editing ? t("Lưu thay đổi") : t("Tạo từ template")}</button>
                    </>}
                </div>
            </footer>
        </div>
    </div>;
}
