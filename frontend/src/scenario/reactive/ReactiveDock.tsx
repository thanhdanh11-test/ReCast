import { useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { HelpTip } from "../help/HelpTip";
import { ReactiveCharts, type ChartId } from "../ReactiveCharts";
import { ChecksBlock, EsminiBlock, VehiclesBlock, isCheck, type EsminiState } from "../Real2simReport";
import { ParameterSpace, SceneMetricsPanel } from "../authoring/SceneMetricsPanel";
import type { ReactivePreset } from "../authoring/ReactiveForm";
import type { ReactiveEvent, ReactiveLabelProblem, Real2simReport } from "../types";
import type { GridCell, ReactiveGroup, ReactiveKind, ReactiveKindMetrics, ReactiveMetrics, ReplayErrorMetrics } from "../reactiveTypes";
import { GROUP_LABEL } from "../help/terms";
import { KIND_LABEL, fmt } from "./model";
import { groupTone, isKindMetrics, kindSpace, type AnyMetrics } from "./kindMetrics";
import type { KindDetail } from "./ReactiveMap";

type DockTab = "charts" | "space" | "vehicles" | "checks" | "esmini" | "scene" | "raw";
const CHART_TABS: [string, ChartId[]][] = [["Tốc độ", ["speed"]], ["Gia tốc", ["accel"]], ["Khoảng cách và TTC", ["gap", "ttc"]]];
type Load<T> = { status: "idle" | "loading" } | { status: "ready"; data: T } | { status: "error"; error: string };

/**
 * Bottom tray of the technical mode (SPEC-WP2 §5): the plan46 report blocks, full width, one per tab. Tabs that need
 * a package say so until one is created.
 */
export function ReactiveDock({ scene, busy, detail, report, esmini, onEsminiCheck, metrics, labelProblems, onSeek, onPickCell, onPickKindCell,
    reactiveMetrics, replayErrorMetrics, onFill, onCreate }: {
    scene: string; busy: boolean;
    detail: KindDetail | null; report: Real2simReport | null;
    esmini: EsminiState; onEsminiCheck?: () => void;
    /** Scene metric 2 of the current kind (brake: v0.34.0 shape; other kinds: grid axes, plan47 C5). */
    metrics: Load<AnyMetrics> | null; labelProblems: ReactiveLabelProblem[];
    onSeek: (t: number) => void; onPickCell: (cell: GridCell) => void;
    onPickKindCell: (cell: ReactiveKindMetrics["cells"][number], kind: ReactiveKind) => void;
    reactiveMetrics?: (scene: string, reactions?: number[]) => Promise<ReactiveMetrics>;
    replayErrorMetrics?: (scene: string) => Promise<ReplayErrorMetrics>;
    onFill: (choice: Omit<ReactivePreset, "seq">) => void;
    onCreate: (scene: string, event: ReactiveEvent) => Promise<boolean | undefined>;
}) {
    const t = useT();
    const [tab, setTab] = useState<DockTab>("charts");
    const [chart, setChart] = useState(0);
    const check = isCheck(esmini) ? esmini : null;
    const checks = (detail?.checks ?? []).map(c => c.id === "esmini" && check ? { ...c, passed: check.passed } : c);
    const failed = checks.filter(c => c.passed === false).length, passed = checks.filter(c => c.passed === true).length;
    const tabs: [DockTab, string][] = [
        ["charts", t("Biểu đồ")], ["space", t("Không gian tham số")], ["vehicles", t("Các xe")],
        ["checks", detail ? (failed ? `${t("Kiểm tra hợp lệ")} ✗${failed}` : `${t("Kiểm tra hợp lệ")} ✓${passed}`) : t("Kiểm tra hợp lệ")],
        ["esmini", check ? `${t("Độ khớp esmini")} ${check.passed === true ? "✓" : check.passed === false ? "✗" : "–"}` : t("Độ khớp esmini")],
        ["scene", t("Chỉ số cảnh")], ["raw", t("Dữ liệu gốc")],
    ];
    const needPackage = (body: (d: KindDetail) => ReactNode) => detail ? body(detail) : <p className="rx-note">{t("Tạo tình huống để xem mục này.")}</p>;
    return <section className="rx-dock" aria-label={t("Khay chi tiết")}>
        <div className="rx-dock-tabs" role="tablist" aria-label={t("Khay chi tiết")}>
            {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
        </div>
        <div className="rx-dock-body" role="tabpanel">
            {tab === "charts" && needPackage(d => <>
                <div className="rx-subtabs" role="group" aria-label={t("Biểu đồ")}>
                    {CHART_TABS.map(([label], i) => <button key={label} type="button" className="rx-chip" aria-pressed={chart === i} onClick={() => setChart(i)}>{t(label)}</button>)}
                    <HelpTip term="ttc"/>
                </div>
                <ReactiveCharts detail={d} show={CHART_TABS[chart][1]} wide onSeek={onSeek}/>
            </>)}
            {tab === "space" && (metrics?.status === "ready" ? (isKindMetrics(metrics.data)
                ? <KindSpace data={metrics.data} onPick={cell => onPickKindCell(cell, (metrics.data as ReactiveKindMetrics).kind)}/>
                : <ParameterSpace data={metrics.data} onPick={onPickCell}/>)
                : <p className="rx-note">{metrics?.status === "loading" ? t("Đang quét lưới sự kiện của cảnh") : metrics?.status === "error" ? t(metrics.error) : t("Không có bộ đo chỉ số cảnh.")}</p>)}
            {tab === "vehicles" && needPackage(d => <VehiclesBlock detail={d}/>)}
            {tab === "checks" && needPackage(d => <ChecksBlock detail={d} esmini={esmini}/>)}
            {tab === "esmini" && (report ? <EsminiBlock esmini={esmini} onEsminiCheck={onEsminiCheck}/> : <p className="rx-note">{t("Tạo tình huống để xem mục này.")}</p>)}
            {tab === "scene" && <SceneMetricsPanel scene={scene} busy={busy} reactiveMetrics={reactiveMetrics} replayErrorMetrics={replayErrorMetrics}
                onFill={onFill} onCreate={onCreate} onDone={() => undefined}/>}
            {tab === "raw" && <div className="rx-raw">
                <h4>{t("Đoạn nhãn lỗi trong cảnh")} <HelpTip term="label_problem"/></h4>
                {labelProblems.length ? <ul className="r2s-notes">{labelProblems.map((p, i) => <li key={i}>{p.name} · {fmt(p.t_from, 1)}–{fmt(p.t_to, 1, " s")}</li>)}</ul>
                    : <p className="rx-note">{t("Không có.")}</p>}
                {report && <details><summary>{t("report.json của gói")} <HelpTip term="package"/></summary><pre>{JSON.stringify(report, null, 2)}</pre></details>}
            </div>}
        </div>
    </section>;
}

/** Parameter space of a non-brake kind (plan47 C5): one row per combination of its axes, one column per t0. */
function KindSpace({ data, onPick }: { data: ReactiveKindMetrics; onPick: (cell: ReactiveKindMetrics["cells"][number]) => void }) {
    const t = useT();
    const actors = [...new Map(data.cells.map(c => [c.actor_id, c.actor])).entries()];
    const [actorId, setActorId] = useState(actors[0]?.[0] ?? "");
    const { times, rows } = kindSpace(data, actorId, t);
    const side = (s: { valid: boolean; group: ReactiveGroup | null }) => s.valid && s.group ? t(GROUP_LABEL[s.group]) : t("không hợp lệ");
    if (!actors.length) return <p className="rx-note">{t("Không có ô nào trên lưới của loại này.")}</p>;
    return <div className="scene-metrics-block" aria-label={t("Không gian tham số")}>
        <h4>{t("Không gian tham số")} · {t(KIND_LABEL[data.kind])} <HelpTip term="space"/></h4>
        <label className="reactive-field"><span>{t("Xe")}</span>
            <select aria-label={t("Xe trong không gian tham số")} value={actorId} onChange={e => setActorId(e.target.value)}>
                {actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
        </label>
        <table className="param-space" aria-label={t("Lưới {goal}", { goal: t(KIND_LABEL[data.kind]) })}>
            <thead><tr><th/>{times.map(t0 => <th key={t0}>{fmt(t0, 0, " s")}</th>)}</tr></thead>
            <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th>{times.map(t0 => {
                const c = row.cells.get(t0);
                const title = c && t("{params} lúc {t0} · baseline: {b} · pilot: {p}", { params: row.label, t0: fmt(t0, 1, " s"), b: side(c.baseline), p: side(c.pilot) });
                return <td key={t0}>{c && <button type="button" className={`param-cell ${groupTone(c.pilot)}`} title={title} aria-label={title} onClick={() => onPick(c)}>
                    <span className={`param-base ${groupTone(c.baseline)}`} aria-hidden/>
                </button>}</td>;
            })}</tr>)}</tbody>
        </table>
        <p className="sensor-note">{t("Màu ô: nhóm pilot · chấm góc: nhóm baseline · ô trống: không đủ dữ liệu · bấm ô để điền form")}</p>
    </div>;
}
