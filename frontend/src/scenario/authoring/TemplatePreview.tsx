import { useId } from "react";
import { useT } from "../i18n";
import type { Layout } from "./catalog";
import { EVENT_LABEL, type Point, type ScenarioTemplate } from "./template";

const LANE = 3.5;
/** Schematic road per layout, ego-start frame (y up = left). Not the real map: anchoring is P02. */
function Road({ layout }: { layout: Layout }) {
    const band = (y0: number, y1: number, x0 = -400, x1 = 400) => <rect className="authoring-road" x={x0} y={y0} width={x1 - x0} height={y1 - y0}/>;
    const line = (y: number, dashed: boolean, x0 = -400, x1 = 400) => <line className={dashed ? "authoring-lane dashed" : "authoring-lane"} x1={x0} x2={x1} y1={y} y2={y}/>;
    if (layout === "junction") return <g>{band(-LANE / 2, LANE * 1.5)}<rect className="authoring-road" x={28} y={-400} width={10} height={800}/>{line(LANE / 2, false, -400, 28)}{line(LANE / 2, false, 38, 400)}</g>;
    if (layout === "ramp") return <g>{band(-LANE / 2, LANE / 2)}<polygon className="authoring-road" points={`-400,${-LANE * 1.5} 30,${-LANE * 1.5} 55,${-LANE / 2} -400,${-LANE / 2}`}/>{line(-LANE / 2, true, -400, 30)}</g>;
    if (layout === "two_lane" || layout === "two_way") return <g>{band(-LANE / 2, LANE * 1.5)}{line(LANE / 2, layout === "two_lane")}</g>;
    return <g>{band(-LANE / 2, LANE / 2)}<rect className="authoring-walkway" x={-400} y={LANE / 2} width={800} height={4}/><rect className="authoring-walkway" x={-400} y={-LANE / 2 - 4} width={800} height={4}/></g>;
}

function bounds(template: ScenarioTemplate): [number, number, number, number] {
    const starts = template.actors.map(a => a.start);
    const near = (p: Point) => Math.abs(p.x_m) < 140 && Math.abs(p.y_m) < 60;
    const points: Point[] = [...starts, ...template.actors.flatMap(a => a.route.filter(near))];
    if (!points.length) return [-10, -10, 40, 20];
    let x0 = Math.min(...points.map(p => p.x_m)) - 8, x1 = Math.max(...starts.map(p => p.x_m), x0 + 30) + 18;
    let y0 = Math.min(-8, ...points.map(p => p.y_m)) - 3, y1 = Math.max(8, ...points.map(p => p.y_m)) + 3;
    // Keep the drawing readable: no thinner than 3:1.
    const minH = (x1 - x0) / 3;
    if (y1 - y0 < minH) { const grow = (minH - (y1 - y0)) / 2; y0 -= grow; y1 += grow; }
    const minW = (y1 - y0) * 1.2;
    if (x1 - x0 < minW) { const grow = (minW - (x1 - x0)) / 2; x0 -= grow; x1 += grow; }
    return [x0, y0, x1, y1];
}

export function TemplatePreview({ template, layout, compact = false }: { template: ScenarioTemplate; layout: Layout; compact?: boolean }) {
    const t = useT();
    const arrow = useId();
    const [x0, y0, x1, y1] = bounds(template);
    const k = (x1 - x0) / 100; // stroke/text scale relative to the view width
    return <svg className={`authoring-preview${compact ? " compact" : ""}`} viewBox={`${x0} ${-y1} ${x1 - x0} ${y1 - y0}`} preserveAspectRatio="xMidYMid meet"
        role="img" aria-label={compact ? undefined : t("Sơ đồ kịch bản")} aria-hidden={compact || undefined}>
        <defs><marker id={arrow} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="authoring-arrow"/></marker></defs>
        <g transform="scale(1,-1)">
            <Road layout={layout}/>
            {template.actors.map(a => <polyline key={`r-${a.id}`} className={`authoring-route${a.role === "ego" ? " ego" : ""}`} strokeWidth={k * 0.5}
                points={[a.start, ...a.route].map(p => `${p.x_m},${p.y_m}`).join(" ")} markerEnd={a.route.length ? `url(#${arrow})` : undefined}/>)}
            {template.actors.map(a => <rect key={a.id} className={a.role === "ego" ? "map-ego" : `map-class-${a.kind}`}
                x={a.start.x_m - a.length_m / 2} y={a.start.y_m - a.width_m / 2} width={a.length_m} height={a.width_m}
                transform={`rotate(${a.start.yaw_deg} ${a.start.x_m} ${a.start.y_m})`}/>)}
        </g>
        {!compact && <g className="authoring-labels" fontSize={k * 2.6}>
            {template.actors.map(a => <text key={a.id} x={a.start.x_m} y={-a.start.y_m - Math.max(a.width_m, 1) - k}>{a.id}</text>)}
            {template.events.map((e, i) => {
                const a = template.actors.find(x => x.id === e.actor);
                return a ? <text key={e.id} className="authoring-event" x={a.start.x_m} y={-a.start.y_m + Math.max(a.width_m, 1) + k * 3 * (i + 1)}>⚡ {e.actor}: {t(EVENT_LABEL[e.type])} · {e.at_s} s</text> : null;
            })}
        </g>}
    </svg>;
}
