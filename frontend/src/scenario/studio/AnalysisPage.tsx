import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useT } from "../i18n";
import { AnalysisSummary, KeyMoments } from "./AnalysisSummary";
import { relevantIds } from "./analysis";
import { ReactiveCharts } from "../ReactiveCharts";
import { ChecksBlock, EsminiBlock, Real2simReport, VehiclesBlock, type EsminiState } from "../Real2simReport";
import { MetricsPanel, type MetricsState } from "../MetricsPanel";
import type { DesktopAPI, ImportedScenario } from "../types";
import { describeName, translateVars } from "./history";

export type SectionId = "summary" | "timeline" | "checks" | "vehicles" | "report" | "fidelity" | "esmini";
const LABEL: Record<SectionId, string> = {
    summary: "1 · Kết luận", timeline: "2 · Diễn biến", checks: "3 · Kiểm định", vehicles: "4 · Từng xe",
    report: "Báo cáo chi tiết", fidelity: "Độ khớp quỹ đạo", esmini: "esmini",
};

/** Last section opened in this page session (P03 §2): reopening another scenario starts there when it has it. */
let lastSection: SectionId | undefined;

/** Sections that have data for this scenario (plan50 P03 §2); nothing is computed here. */
export function sectionsOf(pilot: ImportedScenario, hasMetrics: boolean): SectionId[] {
    const detail = pilot.report?.topeye;
    const out: SectionId[] = [];
    if (detail) out.push("summary", "timeline", "checks", "vehicles");
    if (pilot.report) out.push("report");
    if (pilot.kind !== "real2sim" && hasMetrics) out.push("fidelity");
    if (pilot.kind === "real2sim") out.push("esmini");
    return out;
}

/** "Phân tích" page (plan50 P03 §2): one scenario's numbers split into sections, chosen from the bar on top. */
export function AnalysisPage({ api, name, pilot, onBack, onSeek }: {
    api: DesktopAPI; name: string; pilot: ImportedScenario; onBack: () => void; onSeek: (t: number) => void;
}) {
    const t = useT();
    const sections = sectionsOf(pilot, !!api.scenarioMetrics);
    const [section, setSectionState] = useState<SectionId | undefined>(lastSection && sections.includes(lastSection) ? lastSection : sections[0]);
    const setSection = (id: SectionId) => { lastSection = id; setSectionState(id); };
    const [metrics, setMetrics] = useState<MetricsState | null>(null);
    const [esmini, setEsmini] = useState<EsminiState>(null);
    const detail = pilot.report?.topeye ?? null;
    const readable = describeName(name.replace(/\.xosc$/, ""));
    useEffect(() => {
        if (section !== "fidelity" || !api.scenarioMetrics || metrics) return;
        let alive = true;
        setMetrics({ key: pilot.id, status: "loading" });
        api.scenarioMetrics({ scenario_id: pilot.id }).then(data => { if (alive) setMetrics({ key: pilot.id, status: "ready", data }); },
            e => { if (alive) setMetrics({ key: pilot.id, status: "error", error: e instanceof Error ? e.message : String(e) }); });
        return () => { alive = false; };
    }, [section, pilot.id]);
    const checkEsmini = () => {
        setEsmini("loading");
        api.esminiCheck({ scenario_id: pilot.id }).then(setEsmini, e => setEsmini({ error: e instanceof Error ? e.message : String(e) }));
    };
    return <section className="studio-analysis" aria-label={t("Phân tích {name}", { name })}>
        <header className="studio-overlay-head"><button className="sw-back" onClick={onBack}><ArrowLeft size={14} aria-hidden/>{t("Quay lại Studio")}</button><div><small>{t("PHÂN TÍCH")}</small><h2 title={name}>{readable ? t(readable.key, translateVars(readable.vars, t)) : name}</h2></div></header>
        {!sections.length ? <p className="studio-muted">{t("Kịch bản này chưa có số liệu phân tích.")}</p> : <>
            <div className="studio-tabs" role="tablist" aria-label={t("Mục phân tích")}>
                {sections.map(id => <button key={id} role="tab" aria-selected={section === id} onClick={() => setSection(id)}>{t(LABEL[id])}</button>)}
            </div>
            <div className="studio-analysis-body" role="tabpanel" aria-label={section ? t(LABEL[section]) : undefined}>
                {section === "summary" && detail && <AnalysisSummary report={pilot.report ?? null} detail={detail} onChecks={() => setSection("checks")}/>}
                {section === "timeline" && detail && <>
                    <p className="an-help">{t("Đường đứt xám là bản ghi gốc, đường chấm đỏ là ngưỡng, vạch dọc là các mốc. Bấm “Xem trên cảnh” để quay về Studio đúng thời điểm đó.")}</p>
                    <ReactiveCharts detail={detail} wide onSeek={onSeek}/>
                    <KeyMoments detail={detail} onSeek={v => { onSeek(v); onBack(); }}/>
                </>}
                {section === "checks" && detail && <ChecksBlock detail={detail} esmini={esmini}/>}
                {section === "vehicles" && detail && <VehiclesBlock detail={detail}/>}
                {section === "report" && <Real2simReport report={pilot.report ?? null} diagnostics={pilot.import.diagnostics} esmini={esmini} onEsminiCheck={sections.includes("esmini") ? undefined : checkEsmini}
                    focus={relevantIds(pilot.report)} brief={!!detail}/>}
                {section === "fidelity" && <MetricsPanel state={metrics} time={null}/>}
                {section === "esmini" && <EsminiBlock esmini={esmini} onEsminiCheck={checkEsmini}/>}
            </div>
        </>}
    </section>;
}
