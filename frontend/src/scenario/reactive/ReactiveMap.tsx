import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useViewTransform } from "../useViewTransform";
import { footprint, polygonPath, visibleActors } from "../sensors";
import { vehicleClass } from "../vehicleClass";
import { useT } from "../i18n";
import { HelpTip } from "../help/HelpTip";
import type { Candidate, ImportedScenario, Scenario } from "../types";
import type { ReactiveDetail, ReactiveKind, ReactiveKindDetail } from "../reactiveTypes";
import { ACTOR_LABEL, fmt, leaderAt, reactingAt, seriesAt, type Mode } from "./model";

export type Layer = "ghost" | "leader" | "gap" | "ids" | "path" | "stopline" | "measure";
/** Overlay chips of the technical mode, in the order of the approved layout. */
export const LAYERS: [Layer, string][] = [["ghost", "Bóng bản ghi"], ["leader", "Xe phía trước"], ["gap", "Khoảng cách, TTC"], ["ids", "Mã xe"],
    ["path", "Dải đường đi"], ["stopline", "Vạch dừng"], ["measure", "Đo khoảng cách"]];
export const DEFAULT_LAYERS: Layer[] = ["ghost", "leader", "gap", "path"];
export type MapView = "2d" | "3d" | "cabin";
export type KindDetail = ReactiveDetail & Partial<ReactiveKindDetail>;
/** Narrowest map frame (m); the frame follows the ego and the chosen (or nearest pickable) vehicle. */
const BASE_SPAN_M = 70;
/** Both are framed together only when they are closer than this (m); otherwise the ego is centred. */
const PAIR_FRAME_M = 120;
/** Room kept around the framed pair (m), and the widest automatic frame. */
const FRAME_MARGIN_M = 26, MAX_SPAN_M = 220;

/**
 * Centre 2D map of the reactive workspace (SPEC-WP2 §2), drawn from the loaded source scene like TacticalMap: the
 * candidate vehicles are outlined (dashed pink) and picked by clicking them; once a package exists its simulated
 * poses are drawn over the recorded ones (dashed ghosts), with the event vehicle in pink and reacting vehicles outlined.
 */
export function ReactiveMap({ source, pkg, time, candidates, selected, onPick, detail, kind, eventLabel, pickable, layers, onToggleLayer, mode, hint,
    saved, onOpen3d }: {
    source: Scenario | null; pkg: ImportedScenario | null; time: number;
    candidates: Candidate[]; selected: Candidate | undefined; onPick: (c: Candidate) => void;
    detail: KindDetail | null; kind: ReactiveKind; eventLabel: string; pickable: boolean;
    layers: Set<Layer>; onToggleLayer: (layer: Layer) => void; mode: Mode; hint: string;
    /** The package is in the library: 3D / in-car views open it in the 3D runner. */
    saved: boolean; onOpen3d: () => void;
}) {
    const t = useT();
    const shown = pkg ?? source;
    const environment = source?.mode === "source" || source?.mode === "imported" ? source.environment : undefined;
    const surfaces = useMemo(() => environment?.polygons.filter(p => p.kind !== "stop_line").map(p => ({ kind: p.kind, d: polygonPath([p.outer, ...p.holes]) })) ?? [], [environment]);
    const stoplines = useMemo(() => environment?.polygons.filter(p => p.kind === "stop_line").map(p => polygonPath([p.outer])) ?? [], [environment]);
    // Source ids are dataset tokens, package ids are entity names (car_154): candidates link the two.
    const byName = useMemo(() => new Map(candidates.map(c => [c.name, c])), [candidates]);
    const byId = useMemo(() => new Map(candidates.map(c => [c.actor_id, c])), [candidates]);
    const candidateOf = (id: string) => pkg ? byName.get(id) : byId.get(id);
    const nameOf = (id: string) => pkg ? id : byId.get(id)?.name ?? (id === "ego" ? "ego" : id.slice(0, 6));
    const actors = shown ? visibleActors(shown, null, time) : [];
    const ego = actors.find(a => a.actor.role === "ego");
    const eventName = selected?.name ?? null;
    const eventPose = actors.find(a => eventName && nameOf(a.actor.id) === eventName);
    // Step ①: frame the pickable vehicle nearest to the ego, so there is something to click.
    const nearest = !eventName && ego ? actors.filter(a => candidateOf(a.actor.id))
        .sort((a, b) => Math.hypot(a.pose.x_m - ego.pose.x_m, a.pose.y_m - ego.pose.y_m) - Math.hypot(b.pose.x_m - ego.pose.x_m, b.pose.y_m - ego.pose.y_m))[0] : undefined;
    const focus = eventPose ?? nearest;
    const box = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 1000, height: 480 });
    const drawn = !!ego && !!surfaces.length;
    useEffect(() => {
        const el = box.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0 && entry.contentRect.height > 0) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
        observer.observe(el);
        return () => observer.disconnect();
    }, [drawn]);
    const aspect = size.height / size.width;
    const pair = ego && focus && Math.hypot(focus.pose.x_m - ego.pose.x_m, focus.pose.y_m - ego.pose.y_m) < PAIR_FRAME_M ? focus : null;
    // The frame widens (never below BASE_SPAN_M) so the ego and the focused vehicle both fit the panel's shape.
    const fit = ego && pair ? Math.max(Math.abs(pair.pose.x_m - ego.pose.x_m) + FRAME_MARGIN_M, (Math.abs(pair.pose.y_m - ego.pose.y_m) + FRAME_MARGIN_M) / aspect) : 0;
    // useViewTransform measures its span along the panel's short side (drag: span / min(width, height) metres per pixel).
    const short = Math.min(size.width, size.height);
    const controls = useViewTransform<SVGSVGElement>(`${source?.id}:${pkg?.id ?? ""}`, drawn, Math.min(MAX_SPAN_M, Math.max(BASE_SPAN_M, fit)) * short / size.width);
    const span = controls.span * size.width / short, spanY = controls.span * size.height / short;
    const [measure, setMeasure] = useState<[number, number][]>([]);
    useEffect(() => { if (!layers.has("measure")) setMeasure([]); }, [layers]);

    if (!source) return <div className="rx-map view-empty">{t("Chọn dữ liệu để xem bản đồ.")}</div>;
    if (!environment || !surfaces.length) return <div className="rx-map view-empty">{t("Cảnh này không có dữ liệu bản đồ.")}</div>;
    if (!ego) return <div className="rx-map view-empty">{t("Thiếu pose ego tại thời điểm này.")}</div>;
    const cx = (pair ? (ego.pose.x_m + pair.pose.x_m) / 2 : ego.pose.x_m) + controls.pan.x;
    const cy = (pair ? (ego.pose.y_m + pair.pose.y_m) / 2 : ego.pose.y_m) - controls.pan.y;
    // The viewBox has the panel's shape: one screen pixel = span / width metres.
    const px = span / Math.max(size.width, 1);
    const font = 12 * px;
    const series = detail?.series;
    const gap = series ? seriesAt(series.t, series.ego?.gap, time) : null;
    const ttc = series ? seriesAt(series.t, series.ego?.ttc, time) : null;
    const leaderName = leaderAt(detail, "ego", time);
    const leader = leaderName ? actors.find(a => nameOf(a.actor.id) === leaderName) : undefined;
    const egoReacting = reactingAt(detail, "ego", time);
    const eventSamples = (pkg && eventName ? pkg.actors.find(a => a.id === eventName) : source.actors.find(a => a.id === selected?.actor_id))?.samples ?? [];
    const ghosts = pkg && layers.has("ghost") ? visibleActors(source, null, time).filter(({ actor }) => {
        const name = actor.role === "ego" ? "ego" : byId.get(actor.id)?.name;
        return !!name && (name === eventName || detail?.vehicles?.[name]?.role === "reacted" || name === "ego");
    }) : [];
    const stoplinePoints = [...(selected?.kinds?.stopline?.stoplines ?? []).map(s => [s.x_m, s.y_m] as [number, number]),
        ...(detail?.stopline ? [[detail.stopline.x_m, detail.stopline.y_m] as [number, number]] : [])];
    const clickMap = (e: MouseEvent<SVGSVGElement>) => {
        if (!layers.has("measure")) return;
        const svg = e.currentTarget, ctm = svg.getScreenCTM?.();
        if (!ctm) return;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
        setMeasure(m => m.length >= 2 ? [[p.x, -p.y]] : [...m, [p.x, -p.y]]);
    };
    const technical = mode === "technical";

    return <div className="rx-map" ref={box} data-testid="reactive-map" data-time={time}>
        <svg ref={controls.ref} viewBox={`${cx - span / 2} ${-cy - spanY / 2} ${span} ${spanY}`}
            role="img" aria-label={t("Bản đồ 2D của tình huống phản ứng")} onClick={clickMap}>
            {surfaces.map((p, i) => <path key={i} d={p.d} fillRule="evenodd" className={`map-surface map-${p.kind}`}/>)}
            {environment.lines.map((l, i) => <polyline key={i} points={l.points.map(([x, y]) => `${x},${-y}`).join(" ")} className="map-line"/>)}
            {layers.has("stopline") && stoplines.map((d, i) => <path key={i} d={d} className="rx-stopline-area"/>)}
            {(layers.has("stopline") || detail?.kind === "stopline") && stoplinePoints.map(([x, y], i) =>
                <circle key={i} cx={x} cy={-y} r={1.2} className="rx-stopline" data-testid="rx-stopline"/>)}
            {layers.has("path") && eventSamples.length > 1 && <polyline className="rx-path" strokeWidth={2.4 * px}
                points={eventSamples.filter(p => !pkg || p.t_s >= (detail?.markers?.find(m => m.kind === "brake_start")?.t ?? 0)).map(p => `${p.x_m},${-p.y_m}`).join(" ")}/>}
            {layers.has("path") && detail?.path && <polyline className="rx-path lane" strokeWidth={2.4 * px} points={detail.path.map(([x, y]) => `${x},${-y}`).join(" ")}/>}
            {ghosts.map(({ actor, pose }) => <path key={`g-${actor.id}`} d={polygonPath([footprint(actor, pose)])} className="rx-ghost" strokeWidth={1.2 * px} strokeDasharray={`${3 * px} ${3 * px}`}/>)}
            {actors.map(({ actor, pose }) => {
                const name = nameOf(actor.id), cand = candidateOf(actor.id);
                const isEvent = !!eventName && name === eventName, isEgo = actor.role === "ego";
                const reacting = !isEgo && !isEvent && reactingAt(detail, name, time);
                const canPick = pickable && !!cand && !isEvent;
                const cls = isEgo ? `rx-ego${egoReacting ? " reacting" : ""}` : isEvent ? (pkg ? "rx-event" : "rx-event selected")
                    : reacting ? "rx-react" : `map-actor map-class-${vehicleClass(actor.category)}${canPick ? " rx-candidate" : ""}`;
                return <path key={actor.id} d={polygonPath([footprint(actor, pose)])} className={cls} data-actor={name}
                    strokeWidth={(isEgo && egoReacting ? 2.2 : canPick ? 1.6 : 1) * px} strokeDasharray={canPick ? `${4 * px} ${3 * px}` : undefined}
                    role={canPick ? "button" : undefined} tabIndex={canPick ? 0 : undefined} aria-label={canPick ? t("Chọn xe {name}", { name }) : undefined}
                    onClick={canPick ? e => { e.stopPropagation(); onPick(cand!); } : undefined}
                    onKeyDown={canPick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(cand!); } } : undefined}>
                    <title>{`${name} · ${actor.category}`}</title>
                </path>;
            })}
            {layers.has("leader") && leader && <g className="rx-leader">
                <line x1={ego.pose.x_m} y1={-ego.pose.y_m} x2={leader.pose.x_m} y2={-leader.pose.y_m} strokeWidth={1.4 * px} strokeDasharray={`${5 * px} ${4 * px}`}/>
                <circle cx={leader.pose.x_m} cy={-leader.pose.y_m} r={3 * px}/>
            </g>}
            {layers.has("gap") && (gap !== null || ttc !== null) && <g className="rx-gap-label" transform={`translate(${(ego.pose.x_m + (leader?.pose.x_m ?? ego.pose.x_m)) / 2 + 14 * px} ${-(ego.pose.y_m + (leader?.pose.y_m ?? ego.pose.y_m)) / 2})`}>
                <rect x={0} y={-11 * px} width={190 * px} height={22 * px}/>
                <text x={8 * px} y={4 * px} fontSize={font}>{t("cách xe trước {gap} · TTC {ttc}", { gap: fmt(gap, 1, " m"), ttc: ttc !== null && ttc >= 99 ? "∞" : fmt(ttc, 1, " s") })}</text>
            </g>}
            {eventPose && <text className="rx-label" x={eventPose.pose.x_m + 3} y={-eventPose.pose.y_m - 1} fontSize={font}>{eventLabel}</text>}
            <text className="rx-label" x={ego.pose.x_m + 3} y={-ego.pose.y_m + 3} fontSize={font}>{egoReacting ? t("xe của bạn · đang phản ứng") : t("xe của bạn")}</text>
            {layers.has("ids") && actors.filter(a => a.actor.role !== "ego" && nameOf(a.actor.id) !== eventName).map(({ actor, pose }) =>
                <text key={`id-${actor.id}`} className="rx-id" x={pose.x_m + 2} y={-pose.y_m} fontSize={font * 0.85}>{nameOf(actor.id)}</text>)}
            {measure.length > 0 && <g className="rx-measure">
                {measure.map(([x, y], i) => <circle key={i} cx={x} cy={-y} r={3 * px}/>)}
                {measure.length === 2 && <>
                    <line x1={measure[0][0]} y1={-measure[0][1]} x2={measure[1][0]} y2={-measure[1][1]} strokeWidth={1.4 * px}/>
                    <text x={(measure[0][0] + measure[1][0]) / 2} y={-(measure[0][1] + measure[1][1]) / 2 - 4 * px} fontSize={font}>
                        {fmt(Math.hypot(measure[1][0] - measure[0][0], measure[1][1] - measure[0][1]), 1, " m")}</text>
                </>}
            </g>}
        </svg>
        {technical && <div className="rx-chips" role="group" aria-label={t("Lớp phủ bản đồ")}>
            {LAYERS.map(([id, label]) => <button key={id} type="button" className="rx-chip" aria-pressed={layers.has(id)} onClick={() => onToggleLayer(id)}>{t(label)}</button>)}
        </div>}
        <div className="rx-views" role="group" aria-label={t("Kiểu xem")}>
            <button type="button" aria-pressed="true">{t("2D từ trên")}</button>
            <button type="button" aria-pressed="false" disabled={!saved} title={saved ? undefined : t("Lưu vào thư viện để mở bằng 3D")} onClick={onOpen3d}>3D</button>
            <button type="button" aria-pressed="false" disabled={!saved} title={saved ? undefined : t("Lưu vào thư viện để mở bằng 3D")} onClick={onOpen3d}>{t("Trong xe")}</button>
        </div>
        {hint && <p className="rx-hint" role="status">{hint}</p>}
        <ul className="rx-legend" aria-label={t("Chú thích bản đồ")}>
            <li><i className="rx-sw ego"/>{t("xe của bạn")} <HelpTip term="ego"/></li>
            <li><i className="rx-sw candidate"/>{kind === "brake" ? t("xe có thể cho phanh") : t("xe có thể chọn")} <HelpTip term="pick"/></li>
            <li><i className="rx-sw event"/>{t(ACTOR_LABEL[kind]).toLocaleLowerCase("vi")}</li>
            <li><i className="rx-sw react"/>{t("xe phản ứng")}</li>
            {technical && <li><i className="rx-sw ghost"/>{t("vị trí trong bản ghi")}</li>}
        </ul>
    </div>;
}
