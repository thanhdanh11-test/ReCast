import { Pause, Play, RotateCcw } from "lucide-react";
import { motionSpans } from "../ActorTimeline";
import { useT } from "../i18n";
import type { Scenario } from "../types";

/** Fixed categorical palette (plan50 P02 §2); the ego keeps the app's red. */
export const PALETTE = ["#4ea8de", "#f4a259", "#9be564", "#c77dff", "#ffd166", "#4cc9a0", "#ef476f", "#8d99ae"];
export const EGO_COLOR = "#da291c";
/** Width of the vehicle-name column (px); the tracks share the rest. */
const LABEL_W = 120;
export interface TimelineMark { t: number; label: string; tone: "event" | "reaction" }

/** Rows: ego, then the event vehicle, then moving vehicles, then static ones. */
export function timelineRows(scenario: Scenario, duration: number, eventActor?: string | null) {
    const rows = scenario.actors.map(actor => ({ actor, spans: motionSpans(actor.samples, duration) }));
    const rank = (r: typeof rows[number]) => r.actor.role === "ego" ? 0 : r.actor.id === eventActor ? 1 : r.spans.some(s => s.moving) ? 2 : 3;
    return rows.sort((a, b) => rank(a) - rank(b));
}

/**
 * Timeline under the Studio viewer (plan50 P02 §2): one row per vehicle, coloured spans where it moves (measured
 * samples, 0.1 m/s threshold), the baseline drawn as a thin dashed line over the same row, and the event / reaction
 * marks taken from the report (missing ⇒ not drawn).
 */
export function StudioTimeline({ scenario, baseline, duration, time, playing, onPlay, onRestart, onSeek, marks, eventActor, actorIds }: {
    scenario: Scenario | null; baseline: Scenario | null; duration: number; time: number; playing: boolean;
    onPlay: () => void; onRestart: () => void; onSeek: (t: number) => void; marks: TimelineMark[]; eventActor?: string | null;
    /** plan51: vehicles to draw (ego + the scenario's chosen ones); null = playback controls only (source scene). */
    actorIds: string[] | null;
}) {
    const t = useT();
    const x = (s: number) => `${duration > 0 ? Math.min(100, Math.max(0, s / duration * 100)) : 0}%`;
    const rows = scenario && actorIds ? timelineRows(scenario, duration, eventActor).filter(r => actorIds.includes(r.actor.id)) : [];
    const ghost = new Map(baseline?.actors.map(a => [a.id, motionSpans(a.samples, duration)]) ?? []);
    const seek = (event: React.MouseEvent<HTMLDivElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        const track = box.width - LABEL_W;
        if (track > 0) onSeek(Math.min(duration, Math.max(0, (event.clientX - box.left - LABEL_W) / track * duration)));
    };
    return <section className="studio-timeline" aria-label={t("Dòng thời gian")}>
        <div className="studio-timeline-controls">
            <button className="icon-button" aria-label={t("Về đầu")} disabled={!scenario} onClick={onRestart}><RotateCcw size={14} aria-hidden/></button>
            <button className="icon-button" aria-label={playing ? t("Tạm dừng") : t("Phát")} disabled={!scenario} onClick={onPlay}>{playing ? <Pause size={14} aria-hidden/> : <Play size={14} aria-hidden/>}</button>
            <input aria-label={t("Thời gian")} type="range" min={0} max={duration || 1} step={0.05} value={Math.min(time, duration)} disabled={!scenario} onChange={e => onSeek(Number(e.target.value))}/>
            <output>{time.toFixed(2).replace(".", ",")} / {duration.toFixed(2).replace(".", ",")} s</output>
        </div>
        {!scenario || !actorIds ? null
        : <div className="studio-timeline-rows" style={{ ["--label-w" as string]: `${LABEL_W}px` }} onClick={seek}>
            {rows.map(({ actor, spans }, i) => {
                const color = actor.role === "ego" ? EGO_COLOR : PALETTE[i % PALETTE.length];
                return <div className="studio-timeline-row" key={actor.id} data-actor={actor.id}>
                    <span className="studio-timeline-label" title={actor.id}><i style={{ background: color }}/>{actor.role === "ego" ? "ego" : actor.id}</span>
                    <div className="studio-timeline-track">
                        {spans.filter(s => s.moving).map(s => <b key={`p${s.start}`} className="studio-span" data-variant="pilot" style={{ left: x(s.start), width: `calc(${x(s.end)} - ${x(s.start)})`, background: color }}/>)}
                        {(ghost.get(actor.id) ?? []).filter(s => s.moving).map(s => <b key={`b${s.start}`} className="studio-span studio-span-baseline" data-variant="baseline" style={{ left: x(s.start), width: `calc(${x(s.end)} - ${x(s.start)})`, borderColor: color }}/>)}
                    </div>
                </div>;
            })}
            {marks.map(m => <span key={`${m.tone}${m.t}`} className={`studio-mark studio-mark-${m.tone}`} style={{ left: `calc(var(--label-w) + (100% - var(--label-w)) * ${duration > 0 ? m.t / duration : 0})` }} title={`${m.label} · ${m.t.toFixed(1)} s`}><em>{m.label}</em></span>)}
            <span className="studio-cursor" style={{ left: `calc(var(--label-w) + (100% - var(--label-w)) * ${duration > 0 ? Math.min(time, duration) / duration : 0})` }}/>
        </div>}
        {baseline && <p className="studio-legend"><b className="studio-span"/> {t("pilot")} <b className="studio-span studio-span-baseline"/> {t("baseline")}</p>}
    </section>;
}
