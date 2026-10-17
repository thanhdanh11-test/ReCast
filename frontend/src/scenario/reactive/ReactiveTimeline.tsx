import { useT } from "../i18n";
import { fmt, type TimelineMark } from "./model";

/** Playback rates offered next to the clock. */
export const RATES = [0.5, 1, 2] as const;
/** Fine step of the −0,05 / +0,05 buttons (s): the engine's pilot grid. */
export const FINE_STEP_S = 0.05;

/**
 * Time bar of the reactive workspace (SPEC-WP2 §3): play, ±0,05 s, ▼ marks from the report markers and, while the
 * event is being edited (step ②), the allowed start windows; dragging there moves the event start too.
 */
export function ReactiveTimeline({ time, duration, playing, onPlay, onSeek, marks, windows, editing, rate, onRate, disabled }: {
    time: number; duration: number; playing: boolean; onPlay: () => void; onSeek: (t: number) => void;
    marks: TimelineMark[];
    /** Allowed start windows, shown while `editing`. */
    windows: [number, number][];
    /** Step ②: dragging the bar sets the event start. */
    editing: boolean;
    rate: number; onRate: (rate: number) => void; disabled: boolean;
}) {
    const t = useT();
    const end = Math.max(duration, 1e-6);
    const pct = (v: number) => `${Math.min(100, Math.max(0, v / end * 100))}%`;
    const labelled = marks.filter(m => m.label);
    return <div className="rx-timeline" role="group" aria-label={t("Thanh thời gian")}>
        <button type="button" className="rx-tl-btn" aria-label={playing ? t("Tạm dừng") : t("Phát")} disabled={disabled} onClick={onPlay}>{playing ? "Ⅱ" : "▶"}</button>
        <button type="button" className="rx-tl-btn" aria-label={t("Lùi 0,05 s")} disabled={disabled} onClick={() => onSeek(Math.max(0, time - FINE_STEP_S))}>−0,05</button>
        <button type="button" className="rx-tl-btn" aria-label={t("Tiến 0,05 s")} disabled={disabled} onClick={() => onSeek(Math.min(duration, time + FINE_STEP_S))}>+0,05</button>
        <div className="rx-track">
            <ol className="rx-marks" aria-label={t("Mốc trên thanh thời gian")}>
                {labelled.map((m, i) => <li key={i} className={`rx-mark ${m.tone}`} style={{ left: pct(m.t) }} data-kind={m.kind}>
                    <button type="button" tabIndex={-1} title={`${m.label} · ${fmt(m.t, 2, " s")}`} onClick={() => onSeek(m.t)}>▼{m.label}</button>
                </li>)}
            </ol>
            <div className="rx-bar">
                {editing && windows.map(([a, b], i) => <span key={i} className="rx-window" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }}/>)}
                <span className="rx-fill" style={{ width: pct(time) }}/>
                {marks.filter(m => !m.label).map((m, i) => <span key={i} className="rx-tick" style={{ left: pct(m.t) }} title={`${m.kind} · ${fmt(m.t, 2, " s")}`}/>)}
            </div>
            <input type="range" min={0} max={end} step={FINE_STEP_S} value={Math.min(time, end)} disabled={disabled}
                aria-label={editing ? t("Thời gian (kéo để chọn lúc bắt đầu)") : t("Thời gian")} onChange={e => onSeek(Number(e.target.value))}/>
        </div>
        <output className="rx-clock">{fmt(time, 1)} / {fmt(duration, 1, " s")}</output>
        <select className="rx-rate" aria-label={t("Tốc độ phát")} value={rate} onChange={e => onRate(Number(e.target.value))}>
            {RATES.map(r => <option key={r} value={r}>{`${String(r).replace(".", ",")}×`}</option>)}
        </select>
    </div>;
}
