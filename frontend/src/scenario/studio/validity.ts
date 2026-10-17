// plan51: which vehicles a scenario's timeline shows, and why a scenario is invalid with how to fix it.
import type { ImportedEntry, ImportedScenario } from "../types";

/** Ego + the vehicles the scenario is about: the event vehicle and the ones that reacted (reaction / real2sim);
 * every authored actor otherwise (a template or .xosc only contains the actors the user placed). */
export function chosenActorIds(scenario: ImportedScenario): string[] {
    const report = scenario.report;
    if (report?.event?.actor) return [...new Set(["ego", report.event.actor, ...(report.reacted ?? [])])].filter(id => scenario.actors.some(a => a.id === id));
    return scenario.actors.map(a => a.id);
}

/** A fix hint: an i18n key + its variables (rendered with t()). */
export interface Hint { key: string; vars?: Record<string, string> }
export interface Invalidity { code: string; message: string; hints: Hint[] }

/** Not valid (plan51 D2/D3): the library flag, else the opened package itself; null when valid. */
export function invalidityOf(entry: ImportedEntry | null | undefined, scenario: ImportedScenario | null): Invalidity | null {
    const ego = scenario?.import.diagnostics.find(d => d.code === "EGO_COLLISION");
    const flag = entry?.invalid ?? (ego ? { code: "EGO_COLLISION", message: ego.message ?? "", actor_id: ego.actor_id, t_s: ego.t_s }
        : scenario?.report?.valid === false ? { code: "REPORT_INVALID", message: scenario.report.topeye?.summary ?? scenario.report.reasons.join("; ") } : null);
    if (!flag) return null;
    const reaction = !!scenario?.report?.event || entry?.kind === "real2sim";
    // A reaction summary already ends with “Cách sửa: …”; templates and .xosc get concrete steps.
    const actor = { actor: flag.actor_id ?? "xe kia" };
    const hints: Hint[] = reaction ? [] : flag.code === "EGO_COLLISION" ? [
        { key: "Giảm vận tốc của xe của bạn (ego), hoặc thêm sự kiện phanh cho ego trước lúc va chạm." },
        { key: "Tăng khoảng cách ban đầu giữa ego và {actor}.", vars: actor },
        { key: "Đổi thời điểm hoặc mức của sự kiện của {actor} (phanh nhẹ hơn, cắt làn xa hơn).", vars: actor },
    ] : [];
    return { code: flag.code, message: flag.message, hints };
}
