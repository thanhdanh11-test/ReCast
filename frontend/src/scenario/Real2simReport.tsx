import { useEffect, useState, type ReactNode } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useT, type Translate } from "./i18n";
import { HelpTip } from "./help/HelpTip";
import { GROUP_LABEL, GROUP_TERM, TERMS, type TermKey } from "./help/terms";
import { ReactiveCharts } from "./ReactiveCharts";
import type { CheckId, CheckResult, EsminiCheck, ReactiveDetail, ReactiveGroup, ReactiveKindDetail, ReactiveSensitivity, VariantOutcome } from "./reactiveTypes";
import { KIND_LABEL } from "./reactive/model";
import { mentions } from "./studio/analysis";
import { assessmentOf, VALIDITY_REASONS } from "./studio/validity";
import { AssessmentDetails } from "./studio/AssessmentDetails";
import type { Diagnostic, Real2simReport as Report } from "./types";

/** Number with unit, Vietnamese decimal comma; "—" when the tool did not report it (never invented). */
const fmt = (value: number | null | undefined, digits: number, unit = "") =>
    value === undefined || value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits).replace(".", ",")}${unit}`;

const TARGET: Record<string, string> = { hold: "dừng hẳn", stop: "dừng rồi đi tiếp", half: "chậm lại 50%", slow: "giảm tốc" };

/** Rejection reason codes of the reactive assessment (replay-forge format.js REASON_LABEL). */
const REASON: Record<string, string> = {
    ...VALIDITY_REASONS,
    unsupported_interaction: "có xe nhập làn, cắt ngang hoặc người đi bộ (chưa mô phỏng)",
    unsupported_appearing: "có xe vừa đi vào khung hình đúng chỗ tình huống (chưa mô phỏng)", esmini: "esmini báo lỗi",
};
const CHECK_TERM: Record<CheckId, TermKey> = { esmini: "c_esmini", physics: "c_physics", label: "c_label", collision: "c_collision", tailgate: "c_tailgate", merge: "c_merge", appear: "c_appear" };
const MODE_LABEL: Record<string, string> = { nominal: "như bản ghi", waiting: "đang phản xạ", driving: "tự lái", late: "trễ hơn bản ghi", event: "sự kiện" };

export type EsminiState = EsminiCheck | null | "loading" | { error: string };
export const isCheck = (e: EsminiState | undefined): e is EsminiCheck => !!e && typeof e === "object" && !("error" in e);
/** passed null = esmini could not check the package (never a failure). */
const skippedText = (check: EsminiCheck, t: Translate) => check.skipped_reason === "no_road" ? t("không kiểm được: gói thiếu .xodr") : t("không kiểm được");
const mark = (passed: boolean | null) => passed === true ? "✓" : passed === false ? "✗" : null;

/**
 * Scenario report of a team real2sim package (plan43 SPEC-P02): the tool's own numbers from report.json,
 * plus the app's map/dynamics notes. Replaces the metrics block for this kind; nothing is recomputed here.
 */
export function Real2simReport({ report, diagnostics, onSensitivity, esmini, onEsminiCheck, focus, brief = false }: {
    report: Report | null; diagnostics: Diagnostic[];
    /** plan54: only these vehicles are listed (ego + related); the rest is counted and can be shown on request. */
    focus?: Set<string>;
    /** plan54: leave out blocks the Analysis page already shows in its own tabs (verdict, comparison, checks, charts, vehicles). */
    brief?: boolean;
    /** plan46: re-run the package's event at 0.7 / 1.0 / 1.5 s reaction (reactive packages only). */
    onSensitivity?: () => Promise<ReactiveSensitivity>;
    /** plan46: esmini check of this package (validity condition 1), run on the metrics worker. */
    esmini?: EsminiState; onEsminiCheck?: () => void;
}) {
    const t = useT();
    const assessment = assessmentOf(report);
    const [showAll, setShowAll] = useState(false);
    const keep = (id: string) => !focus || showAll || focus.has(id);
    const allNotes = diagnostics.filter(d => /^(MAP_NOTE_|DYNAMIC_NOTE|REPORT_FIELD)/.test(d.code));
    const notes = allNotes.filter(d => !d.actor_id || keep(d.actor_id));
    /** "N mục về M đối tượng khác đang ẩn" + toggle; nothing when everything is shown. */
    const hidden = (rows: number, objects: number) => focus && (showAll || rows > 0) ? <p className="r2s-hidden">
        {!showAll && t("Ẩn {n} mục về {m} đối tượng không liên quan.", { n: rows, m: objects })}
        <button type="button" className="r2s-toggle" onClick={() => setShowAll(!showAll)}>{showAll ? t("Chỉ xe liên quan") : t("Hiện tất cả")}</button>
    </p> : null;
    const hiddenNotes = allNotes.filter(d => d.actor_id && !keep(d.actor_id));
    const notesBlock = <section className="r2s-block" aria-label={t("Ghi chú map của app")}>
        <h3>{t("Ghi chú map của app")}</h3>
        {notes.length ? <ul className="r2s-notes">{notes.map((d, i) => <li key={i}><TriangleAlert size={12} aria-hidden/>{d.message}</li>)}</ul>
            : <p className="runner-muted">{t("Không có ghi chú.")}</p>}
        {hidden(hiddenNotes.length, new Set(hiddenNotes.map(d => d.actor_id)).size)}
        <p className="sensor-note">{t("Dữ liệu ghi thật có xe đỗ lề, rào chắn ngoài làn: các ghi chú này không chặn việc nạp.")}</p>
    </section>;
    if (!report) return <div className="r2s-report"><p className="runner-muted">{t("Gói không có report.json.")}</p>{notesBlock}</div>;
    const { event, ego, drivers, esmini: tool, run } = report;
    const allPhysics = Object.entries(report.physics), physics = allPhysics.filter(([id]) => keep(id));
    const allErrors = Object.entries(tool?.replay_error_m ?? {}), errors = allErrors.filter(([id]) => keep(id));
    const collisions = report.collisions.filter(c => !focus || showAll || mentions(c, focus));
    const reacted = report.reacted.filter(id => id);
    // plan47: a non-brake event has no braking fields; its kind and the report's summary describe it.
    const kind = (report.topeye as (ReactiveDetail & Partial<ReactiveKindDetail>) | null | undefined)?.kind;
    const eventBlock = event && (kind && kind !== "brake" ? <section className="r2s-block">
        <h3>{t("Sự kiện")}</h3>
        <p>{t("{actor} · {kind} lúc {t0}", { actor: event.actor, kind: t(KIND_LABEL[kind]), t0: fmt(event.t0, 1, " s") })}</p>
    </section> : <section className="r2s-block">
        <h3>{t("Sự kiện")}</h3>
        <p>{t("{actor} {target} · giảm tốc {decel} lúc {t0} · đứng {dwell}", {
            actor: event.actor, target: t(TARGET[event.target] ?? event.target),
            decel: fmt(event.decel, 1, " m/s²"), t0: fmt(event.t0, 1, " s"), dwell: fmt(event.dwell, 1, " s"),
        })}</p>
    </section>);
    const runBlock = run && <section className="r2s-block">
        <h3>{t("Nguồn gốc")} <HelpTip term="provenance"/></h3>
        <dl className="kv">
            <dt>{t("Tạo lúc")}</dt><dd>{run.created ?? "—"}</dd>
            <dt>Commit</dt><dd>{run.commit ? `${run.commit.slice(0, 10)}${run.dirty ? ` (${t("có sửa chưa commit")})` : ""}` : "—"}</dd>
            <dt>esmini</dt><dd>{run.esmini_version ?? "—"}</dd>
            <dt>{t("Bước thời gian")}</dt><dd>{fmt(run.dt, 2, " s")}</dd>
            <dt>{t("Đường")}</dt><dd>{run.road ?? "—"}</dd>
        </dl>
    </section>;
    const scopeBlock = focus && <section className="r2s-block" aria-label={t("Phạm vi báo cáo")}>
        <h3>{t("Phạm vi báo cáo")}</h3>
        <p>{t("Chỉ số đo trên xe của bạn và các xe liên quan:")} {[...focus].map(id => <span key={id} className="chip">{id === "ego" ? t("xe của bạn") : id}</span>)}</p>
    </section>;
    if (report.topeye) return <div className="r2s-report" aria-label={t("Báo cáo kịch bản real2sim")}>
        {scopeBlock}
        <ReactiveSections detail={report.topeye} react={drivers?.react !== false} onSensitivity={onSensitivity} esmini={esmini} onEsminiCheck={onEsminiCheck}
            eventBlock={eventBlock} brief={brief}/>
        {notesBlock}
        {runBlock}
    </div>;
    return <div className="r2s-report" aria-label={t("Báo cáo kịch bản real2sim")}>
        {scopeBlock}
        <section className="r2s-block">
            <h3>{t("Kết luận")} <HelpTip term="valid"/> <small className="runner-muted">{t("theo real2sim")}</small></h3>
            <p className={`r2s-verdict ${report.valid === true ? "pass" : report.valid === false ? "fail" : ""}`}>
                {assessment ? t(assessment.title) : report.valid === true ? t("Hợp lệ") : t("Chưa rõ")}
                {report.group && <><span className="chip">{report.group}</span><HelpTip term="group"/></>}
            </p>
            {assessment ? <AssessmentDetails assessment={assessment}/> : report.reasons.length > 0 && <ul className="r2s-notes">{report.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </section>
        {eventBlock}
        {ego && <section className="r2s-block">
            <h3>{t("Ego")} <HelpTip term="ego"/>{ego.conflict_with && <small className="runner-muted"> · {t("xung đột với {id}", { id: ego.conflict_with })}</small>}</h3>
            <table className="r2s-table"><thead><tr><th/><th>{t("Mô phỏng")}</th><th>{t("Bản ghi")} <HelpTip term="recorded_gap"/></th></tr></thead><tbody>
                <tr><td>{t("Khoảng cách nhỏ nhất")} <HelpTip term="min_gap"/></td><td>{fmt(ego.min_gap, 2, " m")}</td><td>{fmt(ego.recorded_min_gap, 2, " m")}</td></tr>
                <tr><td>{t("TTC nhỏ nhất")} <HelpTip term="ttc"/></td><td>{fmt(ego.min_ttc, 2, " s")}</td><td>{ego.recorded_min_ttc === undefined ? t("không có") : fmt(ego.recorded_min_ttc, 2, " s")}</td></tr>
            </tbody></table>
            <dl className="kv">
                <dt>{t("Giảm tốc cần tối thiểu")} <HelpTip term="braking"/></dt><dd>{fmt(ego.a_min, 2, " m/s²")}</dd>
                <dt>{t("Giảm tốc đã dùng")}</dt><dd>{fmt(ego.a_used, 2, " m/s²")}</dd>
                {ego.stimulus !== undefined && <><dt>{t("Bắt đầu phản ứng")}</dt><dd>{fmt(ego.stimulus, 2, " s")}</dd></>}
            </dl>
        </section>}
        {drivers && <section className="r2s-block">
            <h3>{t("Tài xế phản ứng")} <HelpTip term="react"/></h3>
            <p className="r2s-help-row">{drivers.react ? t("Bật · phản ứng sau {s}", { s: fmt(drivers.reaction_s, 1, " s") }) : t("Tắt")}{drivers.react && <HelpTip term="reaction"/>}</p>
            {reacted.length > 0 && <table className="r2s-table"><thead><tr><th>{t("Xe đã phản ứng")} <HelpTip term="reacted"/></th><th>T</th><th>s0 <HelpTip term="T_s0"/></th><th>{t("Phanh cho phép")} <HelpTip term="max_decel"/></th><th>{t("Phanh đã dùng")}</th></tr></thead><tbody>
                {reacted.map(id => { const v = drivers.per_vehicle[id] ?? {}; return <tr key={id}>
                    <td>{id}</td><td>{fmt(v.T, 2, " s")}</td><td>{fmt(v.s0, 1, " m")}</td><td>{fmt(v.max_decel, 1, " m/s²")}</td><td>{fmt(report.max_decel_used[id], 2, " m/s²")}</td>
                </tr>; })}
            </tbody></table>}
        </section>}
        {physics.length > 0 && <section className="r2s-block">
            <h3>{t("Động học từng xe")} <HelpTip term="c_physics"/></h3>
            <table className="r2s-table"><thead><tr><th>ID</th><th>{t("V tối đa")}</th><th>{t("Tăng tốc max")}</th><th>{t("Phanh max")}</th></tr></thead><tbody>
                {physics.map(([id, p]) => <tr key={id}>
                    <td>{id}</td><td>{fmt(p.max_speed, 1, " m/s")}</td>
                    <td className={p.max_accel !== undefined && p.limit_accel !== undefined && p.max_accel > p.limit_accel ? "fail" : ""} title={t("ngưỡng {v}", { v: fmt(p.limit_accel, 1, " m/s²") })}>{fmt(p.max_accel, 2, " m/s²")}{p.t_accel !== undefined && <small> @{fmt(p.t_accel, 2, " s")}</small>}</td>
                    <td className={p.max_decel !== undefined && p.limit_decel !== undefined && p.max_decel > p.limit_decel ? "fail" : ""} title={t("ngưỡng {v}", { v: fmt(p.limit_decel, 1, " m/s²") })}>{fmt(p.max_decel, 2, " m/s²")}{p.t_decel !== undefined && <small> @{fmt(p.t_decel, 2, " s")}</small>}</td>
                </tr>)}
            </tbody></table>
            {hidden(allPhysics.length - physics.length, allPhysics.length - physics.length)}
        </section>}
        <section className="r2s-block">
            <h3>{t("Va chạm")} <HelpTip term="c_collision"/></h3>
            {collisions.length ? <ul className="r2s-notes">{collisions.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p>{t("Không có")}</p>}
            {report.collisions.length > collisions.length && <p className="r2s-hidden">{t("{n} va chạm giữa các đối tượng không liên quan: xem mục Kiểm định.", { n: report.collisions.length - collisions.length })}</p>}
        </section>
        {tool && <section className="r2s-block">
            <h3>esmini <small className="runner-muted">{tool.version ?? ""} · exit {tool.exit ?? "—"}</small></h3>
            {errors.length > 0 && <table className="r2s-table"><thead><tr><th>ID</th><th>{t("Sai số TB")} <HelpTip term="esmini_err"/></th><th>{t("Sai số max")}</th></tr></thead><tbody>
                {errors.map(([id, e]) => <tr key={id}><td>{id}</td><td>{fmt(e.mean, 4, " m")}</td><td>{fmt(e.max, 4, " m")}</td></tr>)}
            </tbody></table>}
            {hidden(allErrors.length - errors.length, allErrors.length - errors.length)}
            {tool.problems.map((p, i) => <p className="runner-diag" key={i}><TriangleAlert size={13} aria-hidden/>{p}</p>)}
        </section>}
        {notesBlock}
        {runBlock}
    </div>;
}

const reasonText = (reasons: string[], t: Translate) => reasons.map(r => t(REASON[/^\[([^\]]+)\]/.exec(r)?.[1] ?? r] ?? r)).join("; ");
const groupText = (g: ReactiveGroup | null, t: Translate) => g ? t(GROUP_LABEL[g]) : "—";
const span = ([a, b]: [number, number, ...unknown[]]) => `${fmt(a, 1)}–${fmt(b, 1, " s")}`;

/** Reactive package detail (plan46 SPEC-WP4 §1/3): the 8 blocks over report.json["topeye"]. */
function ReactiveSections({ detail, react, onSensitivity, esmini, onEsminiCheck, eventBlock, brief }: {
    detail: ReactiveDetail; react: boolean; onSensitivity?: () => Promise<ReactiveSensitivity>;
    esmini?: EsminiState; onEsminiCheck?: () => void; eventBlock: ReactNode; brief: boolean;
}) {
    const t = useT();
    const own: VariantOutcome | undefined = react ? detail.comparison?.pilot : detail.comparison?.baseline;
    const assessment = own ? assessmentOf({ ...own, react }) : null;
    const group = own?.valid ? own.group : null;
    if (brief) return <>
        {eventBlock}
        {onSensitivity && <SensitivityBlock key={detail.summary} run={onSensitivity}/>}
        {onEsminiCheck && <EsminiBlock esmini={esmini} onEsminiCheck={onEsminiCheck}/>}
        <section className="r2s-block" aria-label={t("Kích hoạt theo thời gian")}>
            <h3>{t("Kích hoạt theo thời gian")} <HelpTip term="trigger"/></h3>
            <p>{detail.trigger_note}</p>
        </section>
    </>;
    return <>
        <section className="r2s-block" aria-label={t("Kết luận")}>
            <h3>{t("Kết luận")} <HelpTip term="valid"/></h3>
            <p className={`r2s-verdict ${own?.valid === true ? "pass" : own?.valid === false ? "fail" : ""}`}>
                {assessment ? t(assessment.title) : own?.valid === true ? t("Hợp lệ") : t("Chưa rõ")}
                {group && <><span className="chip">{t(GROUP_LABEL[group])}</span><HelpTip term={GROUP_TERM[group]}/></>}
            </p>
            {assessment ? <AssessmentDetails assessment={assessment} summary={detail.summary}/> : <p className="r2s-summary">{detail.summary}</p>}
        </section>
        {eventBlock}
        <CompareBlock detail={detail} react={react}/>
        <ChecksBlock detail={detail} esmini={esmini}/>
        <section className="r2s-block" aria-label={t("Biểu đồ")}>
            <h3>{t("Biểu đồ")} <HelpTip term="ttc"/></h3>
            <ReactiveCharts detail={detail}/>
        </section>
        <VehiclesBlock detail={detail}/>
        {onSensitivity && <SensitivityBlock key={detail.summary} run={onSensitivity}/>}
        <EsminiBlock esmini={esmini} onEsminiCheck={onEsminiCheck}/>
        <section className="r2s-block" aria-label={t("Kích hoạt theo thời gian")}>
            <h3>{t("Kích hoạt theo thời gian")} <HelpTip term="trigger"/></h3>
            <p>{detail.trigger_note}</p>
        </section>
    </>;
}

/** Block 2: baseline (nobody reacts) and pilot (reactions) on the same event, side by side. */
function CompareBlock({ detail, react }: { detail: ReactiveDetail; react: boolean }) {
    const t = useT();
    const { baseline, pilot } = detail.comparison ?? {};
    const cols = [baseline, pilot];
    const row = (label: string, term: TermKey, cell: (v: VariantOutcome) => ReactNode) =>
        <tr><td>{label} <HelpTip term={term}/></td>{cols.map((v, i) => <td key={i}>{v ? cell(v) : "—"}</td>)}</tr>;
    return <section className="r2s-block" aria-label={t("Baseline và pilot")}>
        <h3>{t("Baseline và pilot")} <HelpTip term="react"/></h3>
        <p>{t("Cùng một sự kiện, chạy hai lần: baseline không ai phản ứng (mọi xe đi đúng bản ghi), pilot các xe phía sau phản ứng như người lái.")}</p>
        <table className="r2s-table"><thead><tr><th/>
            <th>Baseline{!react && <small> · {t("gói này")}</small>}</th><th>Pilot{react && <small> · {t("gói này")}</small>}</th>
        </tr></thead><tbody>
            {row(t("Hợp lệ"), "valid", v => <span className={v.valid ? "r2s-check pass" : "r2s-check fail"}>{v.valid ? "✓" : "✗"}</span>)}
            {row(t("Nhóm"), "group", v => groupText(v.group, t))}
            {row(t("Gần nhất"), "min_gap", v => fmt(v.ego?.min_gap, 2, " m"))}
            {row("TTC", "ttc", v => fmt(v.ego?.min_ttc, 2, " s"))}
            {row(t("Phanh cần"), "braking", v => fmt(v.ego?.a_min, 2, " m/s²"))}
            {row(t("Phanh đã dùng"), "braking", v => fmt(v.ego?.a_used, 2, " m/s²"))}
            {row(t("Xe phản ứng"), "reacted", v => String(v.reacted?.length ?? 0))}
            {row(t("Va chạm"), "c_collision", v => v.collisions?.length ? v.collisions.map(([a, b, at]) => `${a} – ${b} @${fmt(at, 1, " s")}`).join("; ") : t("Không có"))}
            {row(t("Lý do loại"), "valid", v => v.reasons?.length ? reasonText(v.reasons, t) : "—")}
        </tbody></table>
    </section>;
}

/** Block 3: the 7 validity conditions with their worst measure; esmini comes from the separate check. */
export function ChecksBlock({ detail, esmini }: { detail: ReactiveDetail; esmini?: EsminiState }) {
    const t = useT();
    const check = isCheck(esmini) ? esmini : null;
    const rows: CheckResult[] = (detail.checks ?? []).map(c => c.id === "esmini" && check
        ? { ...c, passed: check.passed, value: check.max_error_m, unit: "m", t: null,
            detail: check.passed === null ? skippedText(check, t) : t("mã thoát {exit} · vắng mặt {n}", { exit: check.exit, n: check.missing.length }) }
        : c);
    return <section className="r2s-block" aria-label={t("Kiểm tra hợp lệ")}>
        <h3>{t("Kiểm tra hợp lệ")} <HelpTip term="valid"/></h3>
        <table className="r2s-table"><thead><tr><th>{t("Điều kiện")}</th><th/><th>{t("Số đo")}</th><th>{t("Ngưỡng")}</th><th>{t("Lúc")}</th></tr></thead><tbody>
            {rows.map(c => <tr key={c.id}>
                <td>{TERMS[CHECK_TERM[c.id]][0]} <HelpTip term={CHECK_TERM[c.id]}/>{c.detail && <><br/><small>{c.detail}</small></>}</td>
                <td className={c.passed === true ? "pass" : c.passed === false ? "fail" : "r2s-check unknown"}>{mark(c.passed) ?? t("chưa kiểm")}</td>
                <td>{fmt(c.value, 2, c.unit ? ` ${c.unit}` : "")}</td><td>{fmt(c.threshold, 2, c.unit ? ` ${c.unit}` : "")}</td><td>{fmt(c.t, 2, " s")}</td>
            </tr>)}
        </tbody></table>
        <p className="r2s-help-row">{t("Chồng hộp được miễn")} <HelpTip term="c_excused"/></p>
        {detail.excused?.length ? <ul className="r2s-notes">{detail.excused.map(([a, b, at], i) => <li key={i}>{a} – {b} @{fmt(at, 2, " s")}</li>)}</ul>
            : <p className="runner-muted">{t("Không có.")}</p>}
    </section>;
}

/** Block 5: each vehicle's driver state over time, leaders, T/s0 and braking. */
export function VehiclesBlock({ detail }: { detail: ReactiveDetail }) {
    const t = useT();
    const entries = Object.entries(detail.vehicles ?? {});
    const times = detail.series?.t ?? [];
    const end = Math.max(times[times.length - 1] ?? 0, ...entries.flatMap(([, v]) => (v.modes ?? []).map(m => m[1])), 1e-9);
    const source = (s: "measured" | "default") => s === "measured" ? t("đo") : t("mặc định");
    return <section className="r2s-block" aria-label={t("Các xe")}>
        <h3>{t("Các xe")} <HelpTip term="idm"/></h3>
        <table className="r2s-table"><thead><tr><th>{t("Xe")}</th><th>{t("Trạng thái")} <HelpTip term="modes"/></th><th>{t("Xe phía trước")}</th>
            <th>T · s₀ <HelpTip term="T_s0"/></th><th>{t("Phanh đã dùng / tối đa")} <HelpTip term="max_decel"/></th></tr></thead><tbody>
            {entries.map(([name, v]) => <tr key={name}>
                <td>{name}<br/><small>{v.role === "ego" ? t("xe của bạn") : v.role === "event" ? t("xe gây sự kiện") : t("xe phản ứng")}</small></td>
                <td><div className="r2s-strip" role="img" aria-label={t("Trạng thái {name}", { name })}>
                    {(v.modes ?? []).map(([a, b, m], i) => <span key={i} className={m} style={{ left: `${100 * a / end}%`, width: `${Math.max(0.5, 100 * (b - a) / end)}%` }}
                        title={`${t(MODE_LABEL[m] ?? m)} ${span([a, b])}`}/>)}
                </div></td>
                <td>{v.leaders?.length ? v.leaders.map(([a, b, who]) => `${who} ${span([a, b])}`).join(", ") : "—"}</td>
                <td>{fmt(v.T, 2, " s")} ({source(v.T_source)}) · {fmt(v.s0, 1, " m")} ({source(v.s0_source)})</td>
                <td>{fmt(v.decel_used, 2)} / {fmt(v.max_decel, 1, " m/s²")}</td>
            </tr>)}
        </tbody></table>
    </section>;
}

/** Block 6: the same event at 0.7 / 1.0 / 1.5 s reaction, on request. */
function SensitivityBlock({ run }: { run: () => Promise<ReactiveSensitivity> }) {
    const t = useT();
    const [state, setState] = useState<null | "loading" | ReactiveSensitivity | { error: string }>(null);
    const [alive, setAlive] = useState(true);
    useEffect(() => () => setAlive(false), []);
    const start = () => {
        setState("loading");
        run().then(r => alive && setState(r), (e: unknown) => alive && setState({ error: e instanceof Error ? e.message : String(e) }));
    };
    return <section className="r2s-block" aria-label={t("Thử độ nhạy")}>
        <h3>{t("Thử độ nhạy")} <HelpTip term="sensitivity"/></h3>
        {state === "loading" ? <p className="runner-muted"><LoaderCircle size={12} className="spin" aria-hidden/> {t("Đang thử độ nhạy")}</p>
            : <button type="button" className="secondary" onClick={start}>{t("Thử độ nhạy")}</button>}
        {state && typeof state === "object" && "error" in state && <p className="runner-diag"><TriangleAlert size={13} aria-hidden/>{state.error}</p>}
        {state && typeof state === "object" && "runs" in state && <>
            <table className="r2s-table"><thead><tr><th>{t("Phản xạ")}</th><th>{t("Hợp lệ")}</th><th>{t("Nhóm")}</th><th>{t("Gần nhất")}</th><th>{t("Phanh đã dùng")}</th></tr></thead><tbody>
                {state.runs.map(r => <tr key={r.reaction_s}>
                    <td>{fmt(r.reaction_s, 1, " s")}</td><td className={r.valid ? "pass" : "fail"}>{r.valid ? "✓" : `✗ ${reasonText(r.reasons, t)}`}</td>
                    <td>{groupText(r.valid ? r.group : null, t)}</td><td>{fmt(r.ego?.min_gap, 2, " m")}</td><td>{fmt(r.ego?.a_used, 2, " m/s²")}</td>
                </tr>)}
            </tbody></table>
            <p className={state.stable ? "" : "r2s-check fail"}>{state.stable ? t("Kết luận không đổi theo phản xạ.") : t("Kết luận đổi theo phản xạ: phụ thuộc nhiều vào giả định về người lái.")}</p>
        </>}
    </section>;
}

/** Block 7: esmini check of this package (condition 1), from the metrics worker. */
export function EsminiBlock({ esmini, onEsminiCheck }: { esmini?: EsminiState; onEsminiCheck?: () => void }) {
    const t = useT();
    const check = isCheck(esmini) ? esmini : null;
    const errors = Object.entries(check?.replay_error_m ?? {});
    return <section className="r2s-block" aria-label={t("Độ khớp esmini")}>
        <h3>{t("Độ khớp esmini")} <HelpTip term="c_esmini"/>{check && <small className="runner-muted"> {check.esmini_version ?? ""} · exit {check.exit}</small>}</h3>
        {esmini === "loading" ? <p className="runner-muted"><LoaderCircle size={12} className="spin" aria-hidden/> {t("Đang chạy esmini")}</p>
            : esmini && typeof esmini === "object" && "error" in esmini ? <p className="runner-diag"><TriangleAlert size={13} aria-hidden/>{esmini.error}</p>
            : !check && <p className="runner-muted">{t("Chưa kiểm.")}</p>}
        {check && <>
            <p className={`r2s-verdict ${check.passed === true ? "pass" : check.passed === false ? "fail" : ""}`}>
                {check.passed === true ? t("esmini chạy hết") : check.passed === false ? t("esmini không đạt") : skippedText(check, t)}</p>
            <dl className="kv">
                <dt>{t("Lệch lớn nhất")} <HelpTip term="esmini_err"/></dt><dd>{fmt(check.max_error_m, 4, " m")}</dd>
                <dt>{t("Gia tốc trong esmini")} <HelpTip term="esmini_acc"/></dt><dd>{fmt(check.accel_max_mps2, 2, " m/s²")}</dd>
                <dt>{t("Vắng mặt")}</dt><dd>{check.missing.length ? check.missing.join(", ") : t("Không có")}</dd>
            </dl>
            {errors.length > 0 && <table className="r2s-table"><thead><tr><th>ID</th><th>{t("Sai số TB")}</th><th>{t("Sai số max")}</th></tr></thead><tbody>
                {errors.map(([id, e]) => <tr key={id}><td>{id}</td><td>{fmt(e.mean, 4, " m")}</td><td>{fmt(e.max, 4, " m")}</td></tr>)}
            </tbody></table>}
        </>}
        {onEsminiCheck && esmini !== "loading" && <button type="button" className="secondary" onClick={onEsminiCheck}>{t("Kiểm bằng esmini")}</button>}
    </section>;
}
