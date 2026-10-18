import { describe, expect, it } from "vitest";
import { assessmentOf } from "./validity";

describe("validation presentation", () => {
    it("describes source matches as a heuristic, without blaming the authored event", () => {
        const a = assessmentOf({ valid: false, reasons: ["[label_error] Nhãn gốc sai vật lý tại cùng chỗ"] })!;
        expect(a.title).toBe("Dữ liệu nguồn cần kiểm tra");
        expect(a.explanation).toContain("toàn bộ quỹ đạo");
        expect(a.explanation).toContain("chưa chứng minh");
        expect(a.reasons[0]).not.toContain("Nhãn gốc sai");
    });
    it("keeps all mixed reasons and unknown codes instead of the first reason only", () => {
        const a = assessmentOf({ valid: false, reasons: ["label_error", "physics", "[future] Extra check"] })!;
        expect(a.title).toBe("Nhiều điều kiện chưa đạt");
        expect(a.reasons).toHaveLength(3);
        expect(a.reasons[2]).toBe("[future] Extra check");
    });
    it("distinguishes baseline collisions, ego collisions and unsupported interactions", () => {
        expect(assessmentOf({ valid: false, reasons: ["collision"], react: false })?.title).toBe("Baseline có va chạm");
        expect(assessmentOf({ valid: false, reasons: ["ego_collision"] })?.title).toBe("Có va chạm");
        expect(assessmentOf({ valid: false, reasons: ["unsupported_interaction", "unsupported_appearing"] })?.title).toBe("Ngoài phạm vi mô phỏng");
    });
    it("does not infer validity from missing reasons, or mark valid/unknown reports as invalid", () => {
        expect(assessmentOf({ valid: false, reasons: [] })?.title).toBe("Chưa đạt kiểm định");
        expect(assessmentOf({ valid: true, reasons: ["collision"] })).toBeNull();
        expect(assessmentOf({ valid: null })).toBeNull();
        expect(assessmentOf(null)).toBeNull();
    });
});
