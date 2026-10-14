import { useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { ObjectMetrics, SceneMetrics } from "./types";
import { useT, type Translate } from "./i18n";

export type MetricsState =
    | { key: string; status: "loading" }
    | { key: string; status: "ready"; data: SceneMetrics }
    | { key: string; status: "error"; error: string };

const num = (v: number, digits: number) => v.toFixed(digits).replace(".", ",");
const pct = (part: number, total: number) => total ? `${num(100 * part / total, 1)}%` : "—";
const KIND: [string, string][] = [["ego", "Xe ego"], ["pedestrian", "Người đi bộ"], ["bicycle", "Xe đạp"], ["motorcycle", "Xe máy"], ["bus", "Xe buýt"], ["truck", "Xe tải"], ["trailer", "Rơ-moóc"], ["construction", "Xe công trình"], ["car", "Xe con"], ["animal", "Động vật"]];
const kind = (o: ObjectMetrics) => o.role === "ego" ? "Xe ego" : KIND.find(([k]) => o.category.includes(k))?.[1] ?? o.category;

/** Index of the grid tick closest to `time`, or null when the object has no label support there. */
function tickAt(o: ObjectMetrics, time: number): number | null {
    const t = o.grid_t;
    if (!t.length || time < t[0] - 0.05 || time > t[t.length - 1] + 0.05) return null;
    let best = 0;
    for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - time) < Math.abs(t[best] - time)) best = i;
    return Math.abs(t[best] - time) <= 0.051 ? best : null;
}

function describe(lonLat: [number, number] | undefined, t: Translate) {
    if (!lonLat) return "";
    const [lon, lat] = lonLat;
    return `${lon < 0 ? t("tụt sau") : t("vượt trước")} ${num(Math.abs(lon), 2)} m · ${lat >= 0 ? t("lệch trái") : t("lệch phải")} ${num(Math.abs(lat), 2)} m`;
}

function ErrorChart({ o, time }: { o: ObjectMetrics; time: number | null }) {
    const t = useT();
    const w = 280, h = 120, pad = { l: 34, r: 6, t: 8, b: 18 };
    const t0 = o.grid_t[0], t1 = o.grid_t[o.grid_t.length - 1];
    const top = Math.max(0.01, o.baseline_max_m, o.pilot_max_m ?? 0);
    const x = (t: number) => pad.l + ((t - t0) / Math.max(1e-9, t1 - t0)) * (w - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - v / top) * (h - pad.t - pad.b);
    const path = (values: (number | null)[]) => values.map((v, i) => v === null ? "" : `${i && values[i - 1] !== null ? "L" : "M"}${x(o.grid_t[i]).toFixed(1)} ${y(v).toFixed(1)}`).join("");
    return <svg className="metrics-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("Sai số theo thời gian: Topeye và baseline")}>
        {[top, top / 2, 0].map(v => <g key={v}><line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="metrics-grid"/><text x={pad.l - 4} y={y(v) + 3} textAnchor="end">{num(v, v >= 10 ? 1 : v >= 0.1 ? 2 : 3)} m</text></g>)}
        <path d={path(o.baseline_err)} className="metrics-baseline"/>
        {o.pilot_err && <path d={path(o.pilot_err)} className="metrics-pilot"/>}
        {time !== null && time >= t0 && time <= t1 && <line x1={x(time)} x2={x(time)} y1={pad.t} y2={h - pad.b} className="metrics-now"/>}
        <text x={pad.l} y={h - 4}>{num(t0, 1)} s</text><text x={w - pad.r} y={h - 4} textAnchor="end">{num(t1, 1)} s</text>
    </svg>;
}

/** Scenario metrics (OpenSCENARIO runner report): four cards and the selected moving object (plan33). */
export function MetricsPanel({ state, time }: { state: MetricsState | null; time: number | null }) {
    const t = useT();
    const data = state?.status === "ready" ? state.data : null;
    const ids = useMemo(() => data ? Object.keys(data.per_object).sort((a, b) =>
        (data.per_object[b].role === "ego" ? 1 : 0) - (data.per_object[a].role === "ego" ? 1 : 0) || kind(data.per_object[a]).localeCompare(kind(data.per_object[b]))) : [], [data]);
    const [picked, setPicked] = useState<string | null>(null);
    if (!state) return <p className="runner-muted">{t("Chọn một kịch bản để tính chỉ số.")}</p>;
    if (state.status === "loading") return <div className="metrics-loading" role="status"><LoaderCircle size={22} className="spin" aria-hidden/><span>{t("Đang tính chỉ số…")}</span></div>;
    if (state.status === "error") return <p className="sensor-error">{state.error.replace(/^[A-Z_]+: /, "")}</p>;
    const m = state.data;
    const id = picked && m.per_object[picked] ? picked : ids[0];
    const o = id ? m.per_object[id] : null;
    const i = o && time !== null ? tickAt(o, time) : null;
    const v = m.variants;
    return <div className="metrics">
        <h3>{t("Chỉ số kịch bản")}</h3>
        <div className="metrics-cards">
            <div className="metrics-card"><span>{t("Sai số phát lại (Topeye)")}</span><strong>{m.replay.pilot ? `${num(m.replay.pilot.ade_m, 3)} m` : "—"}</strong><small>baseline {num(m.replay.baseline.ade_m, 3)} m</small></div>
            <div className="metrics-card"><span>{t("Vật thể chuyển động")}</span><strong>{m.objects.moving}</strong><small>{t("trên {n} vật thể", { n: m.objects.total })}</small></div>
            <div className="metrics-card"><span>{t("Biến thể hợp lệ (Topeye)")}</span><strong>{v.pilot_valid ?? "—"}/{v.total}</strong><small>{v.pilot_valid !== null ? pct(v.pilot_valid, v.total) : t("cần esmini")} · baseline {pct(v.baseline_valid, v.total)}</small></div>
            <div className="metrics-card"><span>{t("Tình huống hiếm (Topeye)")}</span><strong>{m.rare.pilot ?? "—"}</strong><small>{t("bản gốc: {n}", { n: m.rare.original })}</small></div>
        </div>
        <p className="metrics-def">{t("Topeye: kịch bản OpenSCENARIO này phát lại bằng esmini, so với các mốc quỹ đạo của nó. Baseline: vận tốc không đổi từ mốc đầu. Hiếm: TTC < 1,5 s với ego đang chạy ≥ 5 m/s.")}</p>
        {m.notes.slice(1).map((n, k) => <p className="metrics-def" key={k}>{n}</p>)}
        {o && <>
            <h3>{t("Vật thể đang chọn")}</h3>
            <select aria-label={t("Vật thể đang chọn")} value={id} onChange={e => setPicked(e.target.value)}>
                {ids.map(k => <option key={k} value={k}>{t(kind(m.per_object[k]))} · {m.per_object[k].role === "ego" ? "ego" : k.slice(0, 8)}</option>)}
            </select>
            <div className="metrics-chips"><span className="chip">{t(kind(o))}</span><span className="chip moving">{t("chuyển động")}</span></div>
            <div className="metrics-box">
                <p className="metrics-caption">{i !== null ? t("Độ lệch so với vị trí thật lúc {t} s", { t: num(o.grid_t[i], 1) }) : t("Thời điểm đang xem nằm ngoài khoảng có nhãn")}</p>
                <dl className="kv">
                    <dt>Topeye</dt><dd>{i !== null && o.pilot_err?.[i] != null ? `${num(o.pilot_err[i]!, 2)} m` : "—"}</dd>
                    <dt>Baseline</dt><dd>{i !== null ? `${num(o.baseline_err[i], 2)} m` : "—"}</dd>
                </dl>
                {i !== null && <p className="metrics-caption right">{describe(o.baseline_lon_lat[i], t)}</p>}
                <ErrorChart o={o} time={time}/>
                <p className="metrics-legend"><i className="lg-pilot"/>Topeye <i className="lg-baseline"/>baseline <i className="lg-now"/>{t("đang xem")}</p>
                <p className="metrics-def">{t("Giữa hai mốc, vị trí thật được nội suy thẳng.")}</p>
            </div>
            <dl className="kv metrics-facts">
                <dt>{t("Loại")}</dt><dd>{o.category}</dd>
                <dt>{t("Kích thước (dài × rộng × cao)")}</dt><dd>{num(o.length_m, 1)} × {num(o.width_m, 1)} × {o.height_m ? num(o.height_m, 1) : "—"} m</dd>
                <dt>{t("Có dữ liệu")}</dt><dd>{t("{n} mốc", { n: o.keyframes })} · {num(o.span_s, 1)} s</dd>
                <dt>{t("Sai số Topeye (trung bình · tối đa)")}</dt><dd>{o.pilot_ade_m !== null ? `${num(o.pilot_ade_m, 3)} · ${num(o.pilot_max_m!, 3)} m` : "—"}</dd>
                <dt>{t("Sai số baseline (trung bình · tối đa)")}</dt><dd>{num(o.baseline_ade_m, 2)} · {num(o.baseline_max_m, 2)} m</dd>
            </dl>
        </>}
    </div>;
}
