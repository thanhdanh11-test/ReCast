import { useState, type ReactNode } from "react";
import { Play, TriangleAlert } from "lucide-react";
import { useT, type Translate } from "../i18n";
import { HelpTip } from "../help/HelpTip";
import { GROUP_LABEL, GROUP_TERM } from "../help/terms";
import type { Candidate } from "../types";
import type { ReactiveKind, VariantOutcome } from "../reactiveTypes";
import { rareCases, type AnyMetrics, type Rare } from "./kindMetrics";
import { ACCELS, ACTOR_LABEL, BRAKE_LEVEL_LABEL, DURATIONS, DWELLS, GOALS, KINDS, KIND_LABEL, REACTIONS, START_LABEL, brakeLevels, categoryName, fmt,
    kindsOf, type Goal, type Mode, type Params, type Verdict } from "./model";
import type { KindDetail } from "./ReactiveMap";

/** Rejection reason codes (replay-forge format.js REASON_LABEL), shortened for the verdict card. */
const REASON: Record<string, string> = {
    collision: "các xe khác đâm nhau", label_error: "nhãn gốc của dữ liệu bị lỗi", physics: "sai vật lý", tailgating: "bám sát phi lý",
    unsupported_interaction: "có xe nhập làn, cắt ngang hoặc người đi bộ (chưa mô phỏng)",
    unsupported_appearing: "có xe vừa đi vào khung hình đúng chỗ tình huống (chưa mô phỏng)", esmini: "esmini báo lỗi",
};
const STOPLINE_TYPE: Record<string, string> = {
    TRAFFIC_LIGHT: "đèn tín hiệu", TURN_STOP: "vạch dừng khi rẽ", STOP_SIGN: "biển dừng",
};
const reasons = (o: VariantOutcome, t: Translate) => o.reasons.map(r => t(REASON[r] ?? r)).join("; ");
type Load<T> = { status: "idle" | "loading" } | { status: "ready"; data: T } | { status: "error"; error: string };
export type Step = 1 | 2 | 3;

/**
 * Right column of the reactive workspace (SPEC-WP2 §4): "Tạo tình huống" (vehicle, kind, start, parameters,
 * verdict, actions) and "Ca hiếm tìm sẵn" (rare cases of scene metric 2).
 */
export function ReactiveInspector(props: {
    mode: Mode; step: Step; busy: boolean;
    candidates: Candidate[]; selected: Candidate | undefined; onSelect: (c: Candidate | undefined) => void;
    kind: ReactiveKind; onKind: (kind: ReactiveKind) => void;
    params: Params; onParams: (change: Partial<Params>) => void;
    t0: number; windows: [number, number][];
    /** accelerate: allowed target range at t0 (null = none). */
    targetRange: { min: number; max: number } | null; target: number | null;
    detail: KindDetail | null; verdict: Verdict | null; error: string;
    saved: boolean; onCreate: () => void; onReplay: () => void; onSave: () => void; onDiscard: () => void; onNew: () => void;
    /** Scene metric 2 of the current kind. */
    metrics: Load<AnyMetrics> | null; onRare: (c: Rare) => void;
}) {
    const t = useT();
    const { mode, step, busy, selected, kind, params, detail, verdict } = props;
    const [tab, setTab] = useState<"create" | "rare">("create");
    const technical = mode === "technical";
    const kinds = kindsOf(selected);
    const rare = props.metrics?.status === "ready" ? rareCases(props.metrics.data, t) : null;
    const seg = <V extends string | number>(label: string, values: readonly V[], current: V, text: (v: V) => string, set: (v: V) => void, enabled: (v: V) => boolean = () => true) =>
        <div className="rx-seg" role="group" aria-label={label}>
            {values.map(v => <button key={String(v)} type="button" aria-pressed={current === v}
                aria-label={label === t("Loại sự kiện") && !enabled(v) ? `${text(v)}, ${t("không khả dụng")}` : text(v)}
                disabled={busy || !enabled(v)} onClick={() => set(v)}>{text(v)}</button>)}
        </div>;
    const field = (label: string, term: Parameters<typeof HelpTip>[0]["term"] | null, body: ReactNode) =>
        <div className="rx-field"><div className="rx-field-label">{label}{term && <HelpTip term={term}/>}</div>{body}</div>;
    const windowText = props.windows.length ? props.windows.map(([a, b]) => `${fmt(a, 1)}–${fmt(b, 1, " s")}`).join(" · ") : null;

    const create = <div className="rx-body">
        {field(t(ACTOR_LABEL[kind]), "pick", selected
            ? <div className="rx-actor"><b>{selected.name}</b><small>{t("{category} · {n} xe phía sau", { category: t(categoryName(selected.category)), n: selected.followers.length })}</small>
                <button type="button" className="rx-link" disabled={busy} onClick={() => props.onSelect(undefined)}>{t("đổi xe")}</button></div>
            : <div className="rx-pick">
                <p>{props.candidates.length ? t("Bấm một xe viền hồng trên bản đồ để chọn.") : t("Cảnh này không có xe nào đang có xe khác chạy phía sau. Chọn cảnh khác.")}</p>
                {props.candidates.length > 0 && <select aria-label={t("Hoặc chọn trong danh sách")} value="" disabled={busy}
                    onChange={e => props.onSelect(props.candidates.find(c => c.actor_id === e.target.value))}>
                    <option value="">{t("Hoặc chọn trong danh sách")}</option>
                    {props.candidates.map(c => <option key={c.actor_id} value={c.actor_id}>{t("{name} · {category} · {n} xe phía sau", { name: c.name, category: t(categoryName(c.category)), n: c.followers.length })}</option>)}
                </select>}
            </div>)}
        {selected && <>
            {field(t("Loại sự kiện"), "kind", seg(t("Loại sự kiện"), KINDS, kind, k => t(KIND_LABEL[k]), props.onKind, k => kinds.includes(k)))}
            {field(t(START_LABEL[kind]), "t0", <div className="rx-big">{fmt(props.t0, 1, " s")}
                <small>{windowText ? t("kéo thanh thời gian để đổi · hợp lệ {windows}", { windows: windowText }) : t("không còn lúc nào hợp lệ cho lựa chọn này")}</small></div>)}
            {kind === "brake" && <>
                {field(t("Phanh mạnh cỡ nào"), "strength", seg(t("Phanh mạnh cỡ nào"), brakeLevels(selected), params.decel,
                    v => technical ? `${t(BRAKE_LEVEL_LABEL[v] ?? "")} ${v}` : t(BRAKE_LEVEL_LABEL[v] ?? ""), v => props.onParams({ decel: v })))}
                {field(t("Rồi làm gì"), "target", seg(t("Rồi làm gì"), Object.keys(GOALS) as Goal[], params.goal, g => t(GOALS[g].label), g => props.onParams({ goal: g })))}
            </>}
            {kind === "accelerate" && <>
                {field(t("Tăng tốc mạnh cỡ nào"), "k_accelerate", seg(t("Tăng tốc mạnh cỡ nào"), ACCELS, params.accel, v => `${v} m/s²`, v => props.onParams({ accel: v })))}
                {technical && field(t("Tốc độ đích"), null, props.targetRange
                    ? <div className="rx-range"><input type="range" aria-label={t("Tốc độ đích")} min={props.targetRange.min} max={props.targetRange.max} step={0.5}
                        value={props.target ?? props.targetRange.min} disabled={busy} onChange={e => props.onParams({ target_mps: Number(e.target.value) })}/>
                        <b>{fmt(props.target, 1, " m/s")}</b></div>
                    : <p className="rx-note">{t("Không còn tốc độ đích hợp lệ lúc này.")}</p>)}
            </>}
            {kind === "stopline" && <>
                {field(t("Chờ ở vạch"), "k_stopline", seg(t("Chờ ở vạch"), DWELLS, params.dwell, v => `${v} s`, v => props.onParams({ dwell: v })))}
                {technical && selected.kinds?.stopline?.stoplines.length ? <p className="rx-note">{t("Vạch dừng kế tiếp: {list}", {
                    list: selected.kinds.stopline.stoplines.map(s => `${t((s.type && STOPLINE_TYPE[s.type]) || "vạch dừng")} · ${fmt(s.t_reach_s, 1, " s")}`).join("; ") })}</p> : null}
            </>}
            {kind === "lane_change" && <>
                {field(t("Sang làn"), "k_lane_change", seg(t("Sang làn"), ["left", "right"] as const, params.direction, d => d === "left" ? t("Trái") : t("Phải"), d => props.onParams({ direction: d })))}
                {field(t("Trong bao lâu"), null, seg(t("Trong bao lâu"), DURATIONS, params.duration, v => `${v} s`, v => props.onParams({ duration: v })))}
            </>}
            {technical && field(t("Phản xạ người lái"), "reaction", seg(t("Phản xạ người lái"), REACTIONS, params.reaction, v => fmt(v, 1, " s"), v => props.onParams({ reaction: v })))}
        </>}
        {props.error && <div className="rx-verdict bad" role="alert"><b><TriangleAlert size={14} aria-hidden/> {t("Không tạo được")}</b><span>{t(props.error)}</span></div>}
        {verdict && <div className={`rx-verdict ${verdict.tone}`} role="status" aria-label={t("Kết luận")}>
            <b>{verdict.tone === "ok" ? t("Dùng được · {group}", { group: verdict.outcome.group ? t(GROUP_LABEL[verdict.outcome.group]) : "—" })
                : verdict.tone === "unsupported" ? t("Chưa hỗ trợ") : t("Không dùng được")}
                {verdict.tone === "ok" && verdict.outcome.group && <HelpTip term={GROUP_TERM[verdict.outcome.group]}/>}</b>
            <span>{verdict.tone !== "ok" ? reasons(verdict.outcome, t)
                : verdict.outcome.ego?.a_used ? t("Xe của bạn phanh {a}, gần nhất {gap}.", { a: fmt(verdict.outcome.ego.a_used, 1, " m/s²"), gap: fmt(verdict.outcome.ego.min_gap, 1, " m") })
                : t("Xe của bạn không phải phanh, gần nhất {gap}.", { gap: fmt(verdict.outcome.ego?.min_gap, 1, " m") })}</span>
            {detail?.summary && <small>{detail.summary}</small>}
        </div>}
        {technical && detail?.kind === "lane_change" && detail.mobil && <p className={`rx-note ${detail.mobil.safe === false ? "bad" : ""}`}>
            {t("Chỗ chen (MOBIL): xe sau mới {who} cần phanh {a} · {safe}", { who: detail.mobil.new_follower ?? "—", a: fmt(detail.mobil.required_decel_mps2, 2, " m/s²"),
                safe: detail.mobil.safe === null ? t("chưa rõ") : detail.mobil.safe ? t("an toàn") : t("không an toàn") })}</p>}
        {step === 2 && selected && <button type="button" className="primary rx-wide" disabled={busy || !props.windows.length || (kind === "accelerate" && props.target === null)}
            onClick={props.onCreate}><Play size={14} aria-hidden/> {t("Tạo tình huống")}</button>}
        {step === 3 && <>
            <div className="rx-row">
                <button type="button" disabled={busy} onClick={props.onReplay}>▶ {t("Phát lại")}</button>
                {props.saved ? <button type="button" className="primary" onClick={props.onNew}>{t("Tạo tình huống khác")}</button>
                    : <button type="button" className="primary" disabled={busy} onClick={props.onSave}>{t("Lưu vào thư viện")}</button>}
            </div>
            {props.saved ? <p className="rx-note ok" role="status">✓ {t("Đã lưu vào thư viện")}</p>
                : <button type="button" className="rx-link rx-discard" disabled={busy} onClick={props.onDiscard}>{t("Huỷ tình huống này")}</button>}
        </>}
        {technical && detail && <table className="rx-mini" aria-label={t("Baseline và pilot")}>
            <thead><tr><th/><th>Baseline <HelpTip term="react"/></th><th>Pilot</th></tr></thead>
            <tbody>
                <MiniRow label={t("Nhóm")} detail={detail} cell={o => o.valid && o.group ? t(GROUP_LABEL[o.group]) : t("không hợp lệ")} bad={o => !o.valid || o.group === "collision"}/>
                <MiniRow label={t("Gần nhất")} detail={detail} cell={o => fmt(o.ego?.min_gap, 2, " m")} bad={o => o.ego?.min_gap === 0}/>
                <MiniRow label={t("TTC nhỏ nhất")} detail={detail} cell={o => fmt(o.ego?.min_ttc, 2, " s")} bad={o => o.ego?.min_ttc === 0}/>
                <MiniRow label={t("Phanh đã dùng")} detail={detail} cell={o => fmt(o.ego?.a_used, 2, " m/s²")} bad={() => false}/>
            </tbody>
        </table>}
        {technical && <div className="rx-warn"><b>{t("Kích hoạt theo thời gian.")}</b> <HelpTip term="trigger"/> {t("File xuất dùng quỹ đạo tính sẵn: nếu xe tự lái của bạn chạy khác người lái mẫu, xe khác không phản ứng lại.")}</div>}
    </div>;

    const rareTab = <div className="rx-body">
        <p className="rx-note">{t("Các tình huống nguy hiểm tool tự tìm trên lưới cố định của cảnh · {kind}", { kind: t(KIND_LABEL[kind]) })} <HelpTip term="found"/></p>
        {!props.metrics && <p className="rx-note">{t("Không có bộ đo chỉ số cảnh.")}</p>}
        {props.metrics?.status === "loading" && <p className="rx-note" role="status">{t("Đang quét lưới sự kiện của cảnh")}</p>}
        {props.metrics?.status === "error" && <p className="authoring-warn" role="alert">{t(props.metrics.error)}</p>}
        {rare && (rare.length ? <ul className="rx-rare">{rare.map(c => <li key={`${c.actor_id}:${c.t0}:${c.label}`}>
            <div><b>{c.actor}</b> · {fmt(c.t0, 1, " s")} · {c.label}
                <br/><small>{t(GROUP_LABEL[c.group])} · {t("gần nhất {v}", { v: fmt(c.ego_min_gap, 2, " m") })} · TTC {fmt(c.ego_min_ttc, 2, " s")}</small></div>
            <button type="button" disabled={busy} aria-label={t("Xem {actor} lúc {t0}", { actor: c.actor, t0: fmt(c.t0, 1, " s") })} onClick={() => { setTab("create"); props.onRare(c); }}>{t("Xem")}</button>
        </li>)}</ul> : <p className="rx-note">{t("Không có ca hiếm trên lưới này.")}</p>)}
    </div>;

    return <aside className="rx-insp" aria-label={t("Tạo tình huống phản ứng")}>
        <div className="rx-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "create"} onClick={() => setTab("create")}>{t("Tạo tình huống")}</button>
            <button role="tab" aria-selected={tab === "rare"} onClick={() => setTab("rare")}>{t("Ca hiếm tìm sẵn · {n}", { n: rare ? rare.length : "…" })}</button>
        </div>
        {tab === "create" ? create : rareTab}
    </aside>;
}

function MiniRow({ label, detail, cell, bad }: { label: string; detail: KindDetail; cell: (o: VariantOutcome) => string; bad: (o: VariantOutcome) => boolean }) {
    const { baseline, pilot } = detail.comparison ?? {};
    return <tr><td>{label}</td>
        {[baseline, pilot].map((o, i) => <td key={i} className={o && bad(o) ? "bad" : i === 1 && o?.valid ? "good" : ""}>{o ? cell(o) : "—"}</td>)}
    </tr>;
}
