import { useMemo, useState } from "react";
import type { Pose, Scenario } from "./types";
import { useT } from "./i18n";
import "./actorTimeline.css";

export const MOTION_THRESHOLD = 0.1;
export type MotionSpan = { start: number; end: number; moving: boolean };
/** Imported XOSC vertices define a continuous linear trajectory between consecutive samples. */
export function motionSpans(samples: Pose[], duration: number): MotionSpan[] {
    const spans: MotionSpan[] = [];
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1], b = samples[i];
        if (![a.t_s, b.t_s, a.x_m, a.y_m, b.x_m, b.y_m].every(Number.isFinite) || b.t_s <= a.t_s) continue;
        const start = Math.max(0, a.t_s), end = Math.min(duration, b.t_s);
        if (end <= start) continue;
        const moving = Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m) / (b.t_s - a.t_s) > MOTION_THRESHOLD;
        const last = spans.at(-1);
        if (last && last.end === start && last.moving === moving) last.end = end;
        else spans.push({ start, end, moving });
    }
    return spans;
}
/** Display-only thinning: keep actual endpoint timestamps and leave room between diamonds. */
export function visibleKeys(keys: number[], duration: number): number[] {
    if (!keys.length || duration <= 0) return keys.slice(0, 1);
    const gap = duration * 0.024;
    const kept = [keys[0]];
    for (const k of keys.slice(1, -1)) if (k - kept[kept.length - 1] >= gap && keys[keys.length - 1] - k >= gap) kept.push(k);
    if (keys.length > 1 && keys[keys.length - 1] !== keys[0]) kept.push(keys[keys.length - 1]);
    return kept;
}
const kinds: [string, string][] = [["pedestrian", "Người đi bộ"], ["bicycle", "Xe đạp"], ["motorcycle", "Xe máy"], ["trailer", "Rơ-moóc"], ["truck", "Xe tải"], ["bus", "Xe buýt"], ["car", "Xe con"]];
export function ActorTimeline({ scenario, time, duration, disabled, onSeek }: {
    scenario: Scenario | null; time: number; duration: number; disabled: boolean; onSeek: (time: number) => void;
}) {
    const t = useT();
    const [picked, setPicked] = useState<string | null>(null);
    const end = Number.isFinite(duration) ? Math.max(0, duration) : 0;
    const rows = useMemo(() => (scenario?.actors ?? []).map(actor => {
        const keys = actor.samples.map(p => p.t_s).filter(v => Number.isFinite(v) && v >= 0 && v <= end);
        const spans = motionSpans(actor.samples, end);
        const position = (v: number) => end > 0 ? v / end * 1000 : 0;
        return { actor, keys, spans,
            stillPath: spans.filter(s => !s.moving).map(s => `M${position(s.start)} 24H${position(s.end)}`).join(" "),
            movingPath: spans.filter(s => s.moving).map(s => `M${position(s.start)} 24H${position(s.end)}`).join(" "),
            keysPath: visibleKeys(keys, end).map(k => `M${position(k)} 4l3 3-3 3-3-3Z`).join(" "),
        };
    }), [scenario, end]);
    const selected = rows.find(r => r.actor.id === picked) ?? rows[0];
    const now = Math.max(0, Math.min(end, time));
    const x = (v: number) => end > 0 ? v / end * 1000 : 0;
    const label = (actor: NonNullable<Scenario>["actors"][number]) => actor.role === "ego" ? "Ego" : `${t(kinds.find(([k]) => actor.category.includes(k))?.[1] ?? actor.category)} · ${actor.id}`;
    const seek = (v: number) => { if (!disabled && Number.isFinite(v)) onSeek(Math.max(0, Math.min(end, v))); };
    return <section className="actor-timeline" aria-label={t("Dòng thời gian vật thể")}>
        <header className="actor-timeline-head"><strong>{t("Dòng thời gian")}</strong><span>{t("{n} đối tượng", { n: rows.length })}</span>
            <div className="actor-timeline-legend"><span>◆ {t("Mốc quỹ đạo XOSC")}</span><span><i className="motion"/> {t("Chuyển động")}</span><span><i/> {t("Đứng yên")}</span></div>
        </header>
        {!rows.length ? <p className="runner-empty">{t("Chọn một kịch bản để xem dòng thời gian.")}</p> : <div className="actor-timeline-scroll">
            <div className="actor-time-row axis"><span>{t("Vật thể / giây")}</span><div>{Array.from({ length: 11 }, (_, i) => <small key={i} style={{ left: `${i * 10}%` }}>{(end * i / 10).toFixed(1)}</small>)}</div></div>
            {rows.map(({ actor, keys, stillPath, movingPath, keysPath }) => <div className={`actor-time-row${selected?.actor.id === actor.id ? " selected" : ""}`} key={actor.id}>
                <button className="actor-time-name" title={label(actor)} aria-pressed={selected?.actor.id === actor.id} onClick={() => setPicked(actor.id)}>{label(actor)}</button>
                <div className="actor-time-lane" role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={t("Thời gian của {name}", { name: label(actor) })} aria-valuemin={0} aria-valuemax={end} aria-valuenow={now} aria-valuetext={`${now.toFixed(2)} s`}
                    onKeyDown={e => { const v = e.key === "Home" ? 0 : e.key === "End" ? end : e.key === "ArrowLeft" ? now - 0.1 : e.key === "ArrowRight" ? now + 0.1 : null; if (v !== null) { e.preventDefault(); e.stopPropagation(); seek(v); } }}
                    onClick={e => { if (disabled) return; setPicked(actor.id); const box = e.currentTarget.getBoundingClientRect(); const at = (e.clientX - box.left) / box.width * end; const nearest = keys.reduce<number | null>((best, k) => best === null || Math.abs(k - at) < Math.abs(best - at) ? k : best, null); seek(nearest !== null && Math.abs(nearest - at) / (end || 1) * box.width <= 7 ? nearest : at); }}>
                    <svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden>
                        <path className="span-still" d={stillPath}/>
                        <path className="span-moving" d={movingPath}/>
                        <path className="span-keys" d={keysPath}/>
                    </svg><i className="actor-playhead" style={{ left: `${x(now) / 10}%` }}/>
                </div>
            </div>)}
        </div>}

    </section>;
}
