import { CheckCircle2, TriangleAlert, XCircle } from "lucide-react";
import { useT } from "../i18n";
import { HelpTip } from "../help/HelpTip";
import { GROUP_LABEL, GROUP_TERM, type TermKey } from "../help/terms";
import { MARKER_LABEL } from "../ReactiveCharts";
import type { ReactiveDetail, ReactiveGroup } from "../reactiveTypes";
import type { Real2simReport } from "../types";
import { SEVERITY, checkTally, keyMoments, kpiRows, type KpiId, type KpiRow } from "./analysis";
import { assessmentOf } from "./validity";
import { AssessmentDetails } from "./AssessmentDetails";

/** Vietnamese decimal comma; "—" when the report has no number (never invented). */
const fmt = (v: number | null | undefined, digits: number, unit = "") =>
    v === undefined || v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits).replace(".", ",")}${unit ? ` ${unit}` : ""}`;
const TERM: Partial<Record<KpiId, TermKey>> = { min_gap: "min_gap", min_ttc: "ttc", a_min: "braking", a_used: "braking" };
const VERDICT = { ok: "Trong ngưỡng", near: "Sát ngưỡng", over: "Vượt ngưỡng" } as const;

/** plan53 §1 "Kết luận": verdict, danger scale, safety metrics against the report's thresholds, assumptions. */
export function AnalysisSummary({ report, detail, onChecks }: { report: Real2simReport | null; detail: ReactiveDetail; onChecks?: () => void }) {
    const t = useT();
    const react = report?.drivers?.react !== false;
    const own = react ? detail.comparison?.pilot : detail.comparison?.baseline;
    const assessment = assessmentOf(report);
    const thresholds = report?.drivers?.thresholds;
    const rows = kpiRows(detail, thresholds);
    const tally = checkTally(detail.checks);
    const total = tally.passed + tally.failed + tally.unknown;
    const ok = own?.valid === true;
    const Icon = own?.valid === true ? CheckCircle2 : own?.valid === false ? XCircle : TriangleAlert;
    return <div className="an-summary">
        <section className={`an-verdict ${ok ? "ok" : own?.valid === false ? "bad" : ""}`} aria-label={t("Kết luận")}>
            <Icon size={26} aria-hidden/>
            <div>
                <small>{t("KẾT LUẬN")} · {t(react ? "biến thể có phản ứng (pilot)" : "biến thể không phản ứng (baseline)")}</small>
                <strong>{assessment ? t(assessment.title) : own?.valid === true ? t("Kịch bản hợp lệ") : own?.valid === false ? t("Chưa đạt kiểm định") : t("Chưa đủ dữ liệu để kết luận")}</strong>
                {assessment ? <AssessmentDetails assessment={assessment} summary={detail.summary}/> : <p>{detail.summary}</p>}
                {total > 0 && <p className="an-tally">
                    {t("Kiểm định: {p}/{n} điều kiện đạt", { p: tally.passed, n: total })}
                    {tally.failed > 0 && <span className="bad"> · {t("{n} không đạt", { n: tally.failed })}</span>}
                    {tally.unknown > 0 && <span> · {t("{n} chưa kiểm", { n: tally.unknown })}</span>}
                    {onChecks && <button type="button" className="an-link" onClick={onChecks}>{t("Xem kiểm định")}</button>}
                </p>}
            </div>
        </section>

        <section className="an-block" aria-label={t("Mức độ nguy hiểm")}>
            <h3>{t("Mức độ nguy hiểm")} <HelpTip term="group"/></h3>
            <p className="an-help">{t("Cùng một sự kiện chạy hai lần: baseline không ai phản ứng, pilot các xe phản ứng như người lái. Vị trí trên thang càng sang phải càng nguy hiểm.")}</p>
            <ol className="an-scale">
                {SEVERITY.map((g, i) => <li key={g} className={`an-step s${i}`}>
                    <span className="an-step-label">{t(GROUP_LABEL[g])} <HelpTip term={GROUP_TERM[g]}/></span>
                    <span className="an-pins">
                        {groupOf(detail.comparison?.baseline) === g && <b className="an-pin base" title={t("Baseline")}>B</b>}
                        {groupOf(detail.comparison?.pilot) === g && <b className="an-pin pilot" title={t("Pilot")}>P</b>}
                    </span>
                </li>)}
            </ol>
            <p className="an-legend"><b className="an-pin base">B</b> {t("baseline (không phản ứng)")} <b className="an-pin pilot">P</b> {t("pilot (có phản ứng)")}</p>
        </section>

        <section className="an-block" aria-label={t("Chỉ số an toàn")}>
            <h3>{t("Chỉ số an toàn của xe bạn")}</h3>
            <table className="an-table">
                <thead><tr><th>{t("Chỉ số")}</th><th>Baseline</th><th>Pilot</th><th>{t("Thay đổi")}</th><th>{t("Ngưỡng")}</th><th>{t("Đánh giá (pilot)")}</th></tr></thead>
                <tbody>{rows.map(kpiLine)}</tbody>
            </table>
            <p className="an-help">{t("Ngưỡng lấy từ chính báo cáo mô phỏng. Khoảng cách gần nhất chỉ xét xe cùng làn phía trước; “sát ngưỡng” = cao hơn ngưỡng chưa tới 50% (khoảng cách, TTC) hoặc đã quá 80% ngưỡng (mức phanh).")}</p>
        </section>

        <section className="an-block" aria-label={t("Giả định và giới hạn")}>
            <h3>{t("Giả định và giới hạn")}</h3>
            <ul className="an-assume">
                <li>{t("Thời gian phản xạ người lái: {s}", { s: fmt(report?.drivers?.reaction_s, 1, "s") })}</li>
                <li>{t("Bước thời gian mô phỏng: {s}", { s: fmt(report?.run?.dt, 2, "s") })}</li>
                <li>{t("Xe phản ứng theo mô hình bám xe IDM; người đi bộ, xe nhập làn và xe mới vào khung hình chưa được mô phỏng phản ứng.")}</li>
                <li>{t("Kết quả là mô phỏng trên quỹ đạo nuScenes đã ghi, không phải phép đo trên xe thật.")}</li>
            </ul>
        </section>
    </div>;

    function kpiLine(row: KpiRow) {
        const sign = row.delta !== null && row.delta > 0 ? "+" : "";
        return <tr key={row.id}>
            <td>{t(row.label)}{TERM[row.id] && <> <HelpTip term={TERM[row.id]!}/></>}</td>
            <td>{fmt(row.baseline, row.digits, row.unit)}</td>
            <td><strong>{fmt(row.pilot, row.digits, row.unit)}</strong></td>
            <td className={row.improved === true ? "good" : row.improved === false ? "worse" : ""}>
                {row.delta === null ? "—" : `${sign}${fmt(row.delta, row.digits, row.unit)}`}
                {row.improved !== null && <small> {row.improved ? t("tốt hơn") : t("kém hơn")}</small>}
            </td>
            <td>{row.threshold === null ? "—" : `${row.better === "higher" ? "≥" : "≤"} ${fmt(row.threshold, row.digits, row.unit)}`}</td>
            <td>{row.verdict ? <span className={`an-verdict-chip ${row.verdict}`}>{t(VERDICT[row.verdict])}</span> : "—"}</td>
        </tr>;
    }
}

const groupOf = (v: { valid: boolean; group: ReactiveGroup | null } | undefined) => v?.group ?? null;

/** plan53 §2: the report's markers as a table; a row seeks the viewer to that time. */
export function KeyMoments({ detail, onSeek }: { detail: ReactiveDetail; onSeek: (t: number) => void }) {
    const t = useT();
    const moments = keyMoments(detail);
    if (!moments.length) return null;
    return <section className="an-block" aria-label={t("Mốc thời gian chính")}>
        <h3>{t("Mốc thời gian chính")}</h3>
        <table className="an-table an-moments"><thead><tr><th>{t("Lúc")}</th><th>{t("Xe")}</th><th>{t("Sự kiện")}</th><th/></tr></thead><tbody>
            {moments.map((m, i) => <tr key={i}>
                <td>{fmt(m.t, 1, "s")}</td>
                <td>{m.agent}{m.other ? ` – ${m.other}` : ""}</td>
                <td>{t(MARKER_LABEL[m.kind] ?? m.kind)}{m.value !== undefined && m.kind === "closest" ? ` · ${fmt(m.value, 2, "m")}` : ""}</td>
                <td><button type="button" className="an-link" onClick={() => onSeek(m.t)}>{t("Xem trên cảnh")}</button></td>
            </tr>)}
        </tbody></table>
    </section>;
}
