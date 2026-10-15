import { TriangleAlert } from "lucide-react";
import { useT } from "./i18n";
import type { Diagnostic, Real2simReport as Report } from "./types";

/** Number with unit, Vietnamese decimal comma; "—" when the tool did not report it (never invented). */
const fmt = (value: number | null | undefined, digits: number, unit = "") =>
    value === undefined || value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits).replace(".", ",")}${unit}`;

const TARGET: Record<string, string> = { stop: "dừng hẳn", slow: "giảm tốc" };

/**
 * Scenario report of a team real2sim package (plan43 SPEC-P02): the tool's own numbers from report.json,
 * plus the app's map/dynamics notes. Replaces the metrics block for this kind; nothing is recomputed here.
 */
export function Real2simReport({ report, diagnostics }: { report: Report | null; diagnostics: Diagnostic[] }) {
    const t = useT();
    const notes = diagnostics.filter(d => /^(MAP_NOTE_|DYNAMIC_NOTE|REPORT_FIELD)/.test(d.code));
    const notesBlock = <section className="r2s-block" aria-label={t("Ghi chú map của app")}>
        <h3>{t("Ghi chú map của app")}</h3>
        {notes.length ? <ul className="r2s-notes">{notes.map((d, i) => <li key={i}><TriangleAlert size={12} aria-hidden/>{d.message}</li>)}</ul>
            : <p className="runner-muted">{t("Không có ghi chú.")}</p>}
        <p className="sensor-note">{t("Dữ liệu ghi thật có xe đỗ lề, rào chắn ngoài làn: các ghi chú này không chặn việc nạp.")}</p>
    </section>;
    if (!report) return <div className="r2s-report"><p className="runner-muted">{t("Gói không có report.json.")}</p>{notesBlock}</div>;
    const { event, ego, drivers, esmini, run } = report;
    const physics = Object.entries(report.physics);
    const errors = Object.entries(esmini?.replay_error_m ?? {});
    const reacted = report.reacted.filter(id => id);
    return <div className="r2s-report" aria-label={t("Báo cáo kịch bản real2sim")}>
        <section className="r2s-block">
            <h3>{t("Kết luận")} <small className="runner-muted">{t("theo real2sim")}</small></h3>
            <p className={`r2s-verdict ${report.valid === true ? "pass" : report.valid === false ? "fail" : ""}`}>
                {report.valid === true ? t("Hợp lệ") : report.valid === false ? t("Không hợp lệ") : t("Chưa rõ")}
                {report.group && <span className="chip">{report.group}</span>}
            </p>
            {report.reasons.length > 0 && <ul className="r2s-notes">{report.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </section>
        {event && <section className="r2s-block">
            <h3>{t("Sự kiện")}</h3>
            <p>{t("{actor} {target} · giảm tốc {decel} lúc {t0} · đứng {dwell}", {
                actor: event.actor, target: t(TARGET[event.target] ?? event.target),
                decel: fmt(event.decel, 1, " m/s²"), t0: fmt(event.t0, 1, " s"), dwell: fmt(event.dwell, 1, " s"),
            })}</p>
        </section>}
        {ego && <section className="r2s-block">
            <h3>{t("Ego")}{ego.conflict_with && <small className="runner-muted"> · {t("xung đột với {id}", { id: ego.conflict_with })}</small>}</h3>
            <table className="r2s-table"><thead><tr><th/><th>{t("Mô phỏng")}</th><th>{t("Bản ghi")}</th></tr></thead><tbody>
                <tr><td>{t("Khoảng cách nhỏ nhất")}</td><td>{fmt(ego.min_gap, 2, " m")}</td><td>{fmt(ego.recorded_min_gap, 2, " m")}</td></tr>
                <tr><td>{t("TTC nhỏ nhất")}</td><td>{fmt(ego.min_ttc, 2, " s")}</td><td>{ego.recorded_min_ttc === undefined ? t("không có") : fmt(ego.recorded_min_ttc, 2, " s")}</td></tr>
            </tbody></table>
            <dl className="kv">
                <dt>{t("Giảm tốc cần tối thiểu")}</dt><dd>{fmt(ego.a_min, 2, " m/s²")}</dd>
                <dt>{t("Giảm tốc đã dùng")}</dt><dd>{fmt(ego.a_used, 2, " m/s²")}</dd>
                {ego.stimulus !== undefined && <><dt>{t("Bắt đầu phản ứng")}</dt><dd>{fmt(ego.stimulus, 2, " s")}</dd></>}
            </dl>
        </section>}
        {drivers && <section className="r2s-block">
            <h3>{t("Tài xế phản ứng")}</h3>
            <p>{drivers.react ? t("Bật · phản ứng sau {s}", { s: fmt(drivers.reaction_s, 1, " s") }) : t("Tắt")}</p>
            {reacted.length > 0 && <table className="r2s-table"><thead><tr><th>{t("Xe đã phản ứng")}</th><th>T</th><th>s0</th><th>{t("Phanh cho phép")}</th><th>{t("Phanh đã dùng")}</th></tr></thead><tbody>
                {reacted.map(id => { const v = drivers.per_vehicle[id] ?? {}; return <tr key={id}>
                    <td>{id}</td><td>{fmt(v.T, 2, " s")}</td><td>{fmt(v.s0, 1, " m")}</td><td>{fmt(v.max_decel, 1, " m/s²")}</td><td>{fmt(report.max_decel_used[id], 2, " m/s²")}</td>
                </tr>; })}
            </tbody></table>}
        </section>}
        {physics.length > 0 && <section className="r2s-block">
            <h3>{t("Động học từng xe")}</h3>
            <table className="r2s-table"><thead><tr><th>ID</th><th>{t("V tối đa")}</th><th>{t("Tăng tốc max")}</th><th>{t("Phanh max")}</th></tr></thead><tbody>
                {physics.map(([id, p]) => <tr key={id}>
                    <td>{id}</td><td>{fmt(p.max_speed, 1, " m/s")}</td>
                    <td className={p.max_accel !== undefined && p.limit_accel !== undefined && p.max_accel > p.limit_accel ? "fail" : ""} title={t("ngưỡng {v}", { v: fmt(p.limit_accel, 1, " m/s²") })}>{fmt(p.max_accel, 2, " m/s²")}{p.t_accel !== undefined && <small> @{fmt(p.t_accel, 2, " s")}</small>}</td>
                    <td className={p.max_decel !== undefined && p.limit_decel !== undefined && p.max_decel > p.limit_decel ? "fail" : ""} title={t("ngưỡng {v}", { v: fmt(p.limit_decel, 1, " m/s²") })}>{fmt(p.max_decel, 2, " m/s²")}{p.t_decel !== undefined && <small> @{fmt(p.t_decel, 2, " s")}</small>}</td>
                </tr>)}
            </tbody></table>
        </section>}
        <section className="r2s-block">
            <h3>{t("Va chạm")}</h3>
            {report.collisions.length ? <ul className="r2s-notes">{report.collisions.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p>{t("Không có")}</p>}
        </section>
        {esmini && <section className="r2s-block">
            <h3>esmini <small className="runner-muted">{esmini.version ?? ""} · exit {esmini.exit ?? "—"}</small></h3>
            {errors.length > 0 && <table className="r2s-table"><thead><tr><th>ID</th><th>{t("Sai số TB")}</th><th>{t("Sai số max")}</th></tr></thead><tbody>
                {errors.map(([id, e]) => <tr key={id}><td>{id}</td><td>{fmt(e.mean, 4, " m")}</td><td>{fmt(e.max, 4, " m")}</td></tr>)}
            </tbody></table>}
            {esmini.problems.map((p, i) => <p className="runner-diag" key={i}><TriangleAlert size={13} aria-hidden/>{p}</p>)}
        </section>}
        {notesBlock}
        {run && <section className="r2s-block">
            <h3>{t("Nguồn gốc")}</h3>
            <dl className="kv">
                <dt>{t("Tạo lúc")}</dt><dd>{run.created ?? "—"}</dd>
                <dt>Commit</dt><dd>{run.commit ? `${run.commit.slice(0, 10)}${run.dirty ? ` (${t("có sửa chưa commit")})` : ""}` : "—"}</dd>
                <dt>esmini</dt><dd>{run.esmini_version ?? "—"}</dd>
                <dt>{t("Bước thời gian")}</dt><dd>{fmt(run.dt, 2, " s")}</dd>
                <dt>{t("Đường")}</dt><dd>{run.road ?? "—"}</dd>
            </dl>
        </section>}
    </div>;
}
