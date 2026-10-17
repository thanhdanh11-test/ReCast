import { useState, type MouseEvent } from "react";
import { useT } from "./i18n";
import type { MarkerKind, ReactiveDetail, ReactiveMarker } from "./reactiveTypes";
import "./reactiveReport.css";

const num = (v: number, digits: number) => v.toFixed(digits).replace(".", ",");
/** Upper bound of the TTC axis: TTC is clamped at 99 s by the worker, anything above this is "far". */
const TTC_TOP = 10;

export const MARKER_LABEL: Record<MarkerKind, string> = {
    brake_start: "bắt đầu phanh", brake_full: "phanh đủ mức", stopped: "dừng", resume: "đi tiếp",
    reacts: "phản ứng", closest: "gần nhất", collision: "va chạm",
    event_start: "bắt đầu sự kiện", lane_arrived: "vào làn mới",
};

interface Line { values: (number | null)[]; className: string }

/**
 * Plain SVG line chart over the report's time grid (like MetricsPanel's ErrorChart): null breaks a line,
 * horizontal threshold lines, vertical labelled markers. Missing or empty series draw an empty frame.
 */
function Chart({ label, t, lines, unit, thresholds = [], markers, top: fixedTop, labelled = false, wide = false, onSeek }: {
    label: string; t: number[]; lines: Line[]; unit: string; thresholds?: number[]; markers: ReactiveMarker[]; top?: number; labelled?: boolean;
    /** Full-width variant of the workspace dock (plan47 WP2 §5). */
    wide?: boolean;
    /** Clicking the plot seeks to that time. */
    onSeek?: (t: number) => void;
}) {
    const tr = useT();
    const w = wide ? 960 : 320, h = wide ? 170 : 130, pad = { l: 36, r: 6, t: 14, b: 18 };
    const t0 = t[0] ?? 0, t1 = t[t.length - 1] ?? 1;
    const finite = lines.flatMap(l => l.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    const top = fixedTop ?? Math.max(0.1, ...finite, ...thresholds);
    const bottom = fixedTop !== undefined ? 0 : Math.min(0, ...finite);
    const x = (v: number) => pad.l + ((v - t0) / Math.max(1e-9, t1 - t0)) * (w - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (Math.min(top, Math.max(bottom, v)) - bottom) / Math.max(1e-9, top - bottom)) * (h - pad.t - pad.b);
    const path = (values: (number | null)[]) => values.map((v, i) => v === null || !Number.isFinite(v) || t[i] === undefined ? ""
        : `${i && values[i - 1] !== null && Number.isFinite(values[i - 1] as number) ? "L" : "M"}${x(t[i]).toFixed(1)} ${y(v).toFixed(1)}`).join("");
    const digits = Math.abs(top) >= 10 ? 0 : 1;
    const seek = onSeek && ((e: MouseEvent<SVGSVGElement>) => {
        const box = e.currentTarget.getBoundingClientRect();
        if (box.width <= 0) return;
        const at = t0 + ((e.clientX - box.left) / box.width * w - pad.l) / (w - pad.l - pad.r) * (t1 - t0);
        onSeek(Math.min(t1, Math.max(t0, at)));
    });
    return <svg className={`metrics-chart reactive-chart${wide ? " wide" : ""}${seek ? " seekable" : ""}`} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} onClick={seek}>
        <text x={pad.l} y={9} className="reactive-chart-title">{label}</text>
        {[top, (top + bottom) / 2, bottom].map(v => <g key={v}><line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="metrics-grid"/>
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end">{num(v, digits)} {unit}</text></g>)}
        {thresholds.map(v => <line key={v} x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="reactive-threshold"/>)}
        {markers.filter(m => m.t >= t0 && m.t <= t1).map((m, i) => <g key={i} className={`reactive-marker ${m.kind}`}>
            <line x1={x(m.t)} x2={x(m.t)} y1={pad.t} y2={h - pad.b}/>
            {labelled && <text x={x(m.t) + 2} y={pad.t + 8 + (i % 3) * 9}>{tr(MARKER_LABEL[m.kind])}</text>}
            <title>{`${tr(MARKER_LABEL[m.kind])} · ${m.agent}${m.other ? ` – ${m.other}` : ""} · ${num(m.t, 1)} s`}</title>
        </g>)}
        {lines.map((l, i) => <path key={i} d={path(l.values)} className={l.className}/>)}
        <text x={pad.l} y={h - 4}>{num(t0, 1)} s</text><text x={w - pad.r} y={h - 4} textAnchor="end">{num(t1, 1)} s</text>
    </svg>;
}

export type ChartId = "speed" | "accel" | "gap" | "ttc";
const ALL_CHARTS: ChartId[] = ["speed", "accel", "gap", "ttc"];

/**
 * Report charts of a reactive package (plan46 SPEC-WP4 §1.4): speed and acceleration of a chosen vehicle, ego gap and
 * TTC. The workspace dock (plan47 WP2 §5) shows a subset, full width, and seeks the timeline on click.
 */
export function ReactiveCharts({ detail, show = ALL_CHARTS, wide = false, onSeek }: { detail: ReactiveDetail; show?: ChartId[]; wide?: boolean; onSeek?: (t: number) => void }) {
    const t = useT();
    const { series, markers } = detail;
    const names = Object.keys(series?.vehicles ?? {});
    const first = names.find(n => detail.vehicles?.[n]?.role === "event") ?? names[0] ?? "";
    const [chosen, setChosen] = useState(first);
    const name = names.includes(chosen) ? chosen : first;
    const v = series?.vehicles?.[name];
    const time = series?.t ?? [];
    const marks = markers ?? [];
    return <div className="reactive-charts">
        {names.length > 0 && <label className="reactive-chart-pick">{t("Xe")}{" "}
            <select value={name} onChange={e => setChosen(e.target.value)}>{names.map(n => <option key={n} value={n}>{n}</option>)}</select></label>}
        {show.includes("speed") && <Chart label={t("Tốc độ {name}", { name })} t={time} unit="m/s" markers={marks} labelled wide={wide} onSeek={onSeek}
            lines={[{ values: v?.v_rec ?? [], className: "reactive-rec" }, { values: v?.v ?? [], className: "reactive-sim" }]}/>}
        {show.includes("accel") && <Chart label={t("Gia tốc {name}", { name })} t={time} unit="m/s²" markers={marks} wide={wide} onSeek={onSeek} lines={[{ values: v?.a ?? [], className: "reactive-sim" }]}/>}
        {show.includes("gap") && <Chart label={t("Khoảng cách xe của bạn tới xe trước")} t={time} unit="m" markers={marks} thresholds={[1]} wide={wide} onSeek={onSeek}
            lines={[{ values: series?.ego?.gap ?? [], className: "reactive-sim" }]}/>}
        {show.includes("ttc") && <Chart label={t("TTC xe của bạn")} t={time} unit="s" markers={marks} thresholds={[1.5]} top={TTC_TOP} wide={wide} onSeek={onSeek}
            lines={[{ values: series?.ego?.ttc ?? [], className: "reactive-sim" }]}/>}
        <p className="sensor-note">{onSeek ? t("Nét liền: mô phỏng · nét đứt: bản ghi · vạch ngang: ngưỡng 1 m / 1,5 s · vạch dọc: mốc sự kiện · bấm vào biểu đồ để tới thời điểm đó")
            : t("Nét liền: mô phỏng · nét đứt: bản ghi · vạch ngang: ngưỡng 1 m / 1,5 s · vạch dọc: mốc sự kiện")}</p>
        {!wide && marks.length > 0 && <ul className="reactive-marker-list">{marks.map((m, i) => <li key={i} className={m.kind}>
            <b>{num(m.t, 1)} s</b> {t(MARKER_LABEL[m.kind])} · {m.agent}{m.other ? ` – ${m.other}` : ""}{m.value !== undefined ? ` (${num(m.value, 2)})` : ""}</li>)}</ul>}
    </div>;
}
