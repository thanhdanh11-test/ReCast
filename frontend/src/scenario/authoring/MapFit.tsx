import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useT } from "../i18n";
import type { TemplateFit } from "../types";
import type { ScenarioTemplate } from "./template";

export type FitProbe = (scene: string, template: ScenarioTemplate) => Promise<TemplateFit>;

/** Short reason per gate code; the full worker message stays in the tooltip. */
export const REASON: Record<string, string> = {
    OUTSIDE_MAP: "ra ngoài vùng map",
    OUTSIDE_SURFACE: "ra ngoài mặt đường",
    STATIC_OBSTACLE: "chạm vật cản",
    DYNAMIC_LIMIT: "cua gắt / vượt gia tốc",
    INVALID_MAP_GEOMETRY: "map nguồn hỏng",
    MAP_UNAVAILABLE: "cảnh không có map",
    INVALID_TEMPLATE: "template chưa hợp lệ",
};
export const reasonOf = (code: string) => REASON[code] ?? "không kiểm được";

/** What decides fit: everything except labels, the chosen map and presentation-only fields. */
export function fitKey(t: ScenarioTemplate): string {
    return JSON.stringify([t.map.duration_s, t.map.sample_hz, t.map.placement, t.actors, t.events]);
}

/**
 * Suggests maps for the current template: each scene is probed with the real import gate (worker `template_fit`,
 * read-only, cached), current map first. Re-probes 1 s after the template's geometry/timing changes.
 */
export function MapFit({ template, scenes, scene, probe, onPick, onCurrent }: { template: ScenarioTemplate; scenes: string[]; scene: string; probe: FitProbe; onPick: (scene: string) => void;
    /** plan52: verdict of the chosen map for the current template content (null while unknown). */
    onCurrent?: (fit: TemplateFit | null) => void }) {
    const t = useT();
    const [fits, setFits] = useState<Record<string, TemplateFit>>({});
    const [running, setRunning] = useState(false);
    /** Template content the shown results belong to; differs while a re-probe is scheduled. */
    const [probed, setProbed] = useState<string | null>(null);
    const generation = useRef(0);
    const key = fitKey(template);
    const latest = useRef(template);
    latest.current = template;
    const order = [scene, ...scenes.filter(s => s !== scene)].filter(Boolean);

    const run = () => {
        const ticket = ++generation.current;
        setFits({});
        setProbed(fitKey(latest.current));
        setRunning(true);
        void (async () => {
            for (const s of order) {
                if (generation.current !== ticket) return;
                let fit: TemplateFit;
                try { fit = await probe(s, latest.current); }
                catch (error) { fit = { scene: s, ok: false, code: "ERROR", message: error instanceof Error ? error.message : String(error) }; }
                if (generation.current !== ticket) return;
                setFits(f => ({ ...f, [s]: fit }));
            }
            if (generation.current === ticket) setRunning(false);
        })();
    };
    useEffect(() => {
        const timer = setTimeout(run, probed === null ? 0 : 1000);
        return () => { clearTimeout(timer); generation.current++; };
    // Re-probe only when the fit-relevant content or the scene list changes (run reads the latest template).
    }, [key, scenes.join("|")]);

    const done = order.filter(s => fits[s]);
    const good = done.filter(s => fits[s].ok);
    const bad = done.filter(s => !fits[s].ok);
    const pending = order.filter(s => !fits[s]);
    const current = fits[scene];
    const checking = running || probed !== key;
    const verdict = probed === key ? current ?? null : null;
    useEffect(() => { onCurrent?.(verdict); }, [verdict?.ok, verdict?.scene, probed === key]);
    const label = (fit: TemplateFit) => fit.ok
        ? `${Math.round(fit.placement.start_m)} m${fit.placement.mirror ? ` · ${t("lật")}` : ""}`
        : t(reasonOf(fit.code));
    return <section className="map-fit" aria-label={t("Map phù hợp")}>
        <div className="map-fit-head">
            <h3>{t("Map phù hợp")}</h3>
            <span className="runner-muted" aria-live="polite">{checking ? t("Đang kiểm {done}/{total} map…", { done: probed === key ? done.length : 0, total: order.length }) : t("{n}/{total} map dùng được", { n: good.length, total: order.length })}</span>
            <button className="authoring-add" disabled={checking} onClick={run}><RotateCcw size={13} aria-hidden/>{t("Kiểm lại")}</button>
        </div>
        {!checking && current && !current.ok && <p className="authoring-warn">{t("Map đang chọn ({scene}) không đặt được loại này: {reason}.", { scene, reason: t(reasonOf(current.code)) })}</p>}
        <ul className="map-fit-list">
            {good.map(s => <li key={s}><button className={`map-fit-item ok${s === scene ? " selected" : ""}`} aria-pressed={s === scene} title={t("Dùng map {scene}", { scene: s })} onClick={() => onPick(s)}>
                <Check size={13} aria-hidden/><strong>{s}</strong><small>{label(fits[s])}</small></button></li>)}
            {pending.map(s => <li key={s}><span className="map-fit-item pending"><LoaderCircle size={13} aria-hidden/><strong>{s}</strong><small>{t("đang kiểm")}</small></span></li>)}
            {bad.map(s => <li key={s}><span className={`map-fit-item bad${s === scene ? " selected" : ""}`} title={(fits[s] as Extract<TemplateFit, { ok: false }>).message}>
                <X size={13} aria-hidden/><strong>{s}</strong><small>{label(fits[s])}</small></span></li>)}
        </ul>
    </section>;
}
