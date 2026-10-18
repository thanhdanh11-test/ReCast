// plan51: which vehicles a scenario's timeline shows, and why a scenario is invalid with how to fix it.
import type { ImportedEntry, ImportedScenario } from "../types";

export const VALIDITY_REASONS: Record<string, string> = {
    label_error: "Vi phạm chuyển động gần vị trí dữ liệu nguồn cũng vượt ngưỡng kiểm định.",
    physics: "Chuyển động mô phỏng vượt giới hạn tốc độ, gia tốc hoặc phanh.",
    collision: "Có va chạm giữa các xe trong kịch bản.",
    ego_collision: "Xe của bạn (ego) có va chạm.",
    tailgating: "Có xe bám đuôi dưới 0,5 m khi chạy trên 3 m/s quá 0,5 s.",
    unsupported: "Có tương tác hoặc xe mới xuất hiện ngoài phạm vi mô phỏng phản ứng.",
    unsupported_interaction: "Có tương tác cắt ngang, nhập làn hoặc chạm người/vật thể chưa được hỗ trợ.",
    unsupported_appearing: "Có xe vừa xuất hiện tại vị trí tương tác; mô hình chưa hỗ trợ trường hợp này.",
};
export const VALIDITY_TITLES = {
    source: "Dữ liệu nguồn cần kiểm tra", physics: "Chuyển động vượt ngưỡng", collision: "Có va chạm",
    baseline: "Baseline có va chạm", unsupported: "Ngoài phạm vi mô phỏng",
    tailgating: "Có xe bám quá sát", mixed: "Nhiều điều kiện chưa đạt", unknown: "Chưa đạt kiểm định",
} as const;
export const SOURCE_EXPLANATION = "Kiểm định xét toàn bộ quỹ đạo, kể cả trước sự kiện. Vi phạm gần cùng vị trí trong dữ liệu nguồn là dấu hiệu cần kiểm tra, chưa chứng minh nhãn gốc sai hoặc thao tác tạo kịch bản sai.";
export const BASELINE_EXPLANATION = "Đây là kết quả của baseline không phản ứng. Va chạm được ghi nhận để so sánh; không có nghĩa việc tạo hoặc lưu kịch bản thất bại.";
export const VALIDATION_EXPLANATION = "Các điều kiện dưới đây chưa đạt kiểm định. Kiểm định khác với việc tạo hoặc lưu kịch bản; kết quả chạy esmini được kiểm tra riêng.";

interface AssessmentInput {
    valid: boolean | null;
    reasons?: string[];
    react?: boolean | null;
    drivers?: { react: boolean } | null;
}
export interface Assessment { title: string; explanation: string; reasons: string[]; sourceRelated: boolean }
export function assessmentOf(report: AssessmentInput | null | undefined): Assessment | null {
    if (report?.valid !== false) return null;
    const reasons = report.reasons ?? [];
    const codes = reasons.map(reason => /^\[([^\]]+)\]/.exec(reason)?.[1] ?? reason);
    const category = (code: string) => code === "label_error" ? "source" : code.startsWith("unsupported") ? "unsupported"
        : code === "ego_collision" || code === "collision" ? "collision" : code === "physics" ? "physics" : code === "tailgating" ? "tailgating" : "unknown";
    const categories = new Set(codes.map(category));
    const sourceRelated = categories.has("source");
    const baseline = (report.drivers?.react ?? report.react) === false;
    const kind = categories.size > 1 ? "mixed" : categories.values().next().value ?? "unknown";
    return {
        title: kind === "collision" && baseline ? VALIDITY_TITLES.baseline : VALIDITY_TITLES[kind],
        explanation: sourceRelated ? SOURCE_EXPLANATION : baseline && categories.has("collision") ? BASELINE_EXPLANATION : VALIDATION_EXPLANATION,
        reasons: reasons.map((reason, i) => VALIDITY_REASONS[codes[i]] ?? reason), sourceRelated,
    };
}

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
