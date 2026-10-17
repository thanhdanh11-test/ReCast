import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "./i18n.en";
import { GROUPS, SCENARIO_TYPES } from "./authoring/catalog";
import { EVENT_LABEL, EVENT_PARAMS, KIND_LABEL, TEMPLATE_FILE_ERROR } from "./authoring/template";
import { SUGGESTIONS } from "./authoring/mockAi";
import { REASON } from "./authoring/MapFit";

const dir = join(process.cwd(), "src/scenario");
/** Keys translated indirectly: status/kind tables, settings section labels, shortcuts, panel labels. */
const INDIRECT = ["Chưa chạy", "Đang chạy", "Đã huỷ", "Đạt", "Không đạt", "xe con", "xe tải", "xe buýt", "xe đạp", "xe máy", "người đi bộ",
    "Xe ego", "Người đi bộ", "Xe đạp", "Xe máy", "Xe buýt", "Xe tải", "Rơ-moóc", "Xe công trình", "Xe con", "Động vật",
    "Giao diện", "Hiển thị 3D", "LiDAR", "Phát lại", "Đơn vị", "Ngôn ngữ", "Dữ liệu & lưu trữ", "Tài khoản", "Góp ý nhà sản xuất", "Thông tin",
    "Phát / tạm dừng", "Lùi / tiến 1 giây", "Về đầu / về cuối", "Đóng ngăn, thu khung phóng to, rời trang cài đặt",
    "Đã xoá bộ nhớ đệm chỉ số ({n} kịch bản).", "Đã dọn thùng rác ({n} mục).", "khung 3D", "khung LiDAR", "khung map",
    "Rơ-moóc / công trình", "Vật cản", "Khác",
    // plan53 analysis: KPI labels, verdicts and tab labels rendered through t(variable).
    "biến thể có phản ứng (pilot)", "biến thể không phản ứng (baseline)", "Khoảng cách gần nhất", "Thời gian tới va chạm nhỏ nhất (TTC)",
    "Mức phanh cần để tránh", "Mức phanh xe bạn đã dùng", "Số lần xe bạn va chạm", "Trong ngưỡng", "Sát ngưỡng", "Vượt ngưỡng",
    "Báo cáo chi tiết", "1 · Kết luận", "2 · Diễn biến", "3 · Kiểm định", "4 · Từng xe",
    "Đã tạo {name} · {n} đối tượng · đặt tại {at} m trên quỹ đạo xe nguồn", "Đã tạo {name} · {n} đối tượng · đặt tại {at} m trên quỹ đạo xe nguồn, lật trái ↔ phải"];

/** Source files of the UI, including feature subfolders such as authoring/. */
const sources = () => readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(f => /\.tsx?$/.test(f) && !f.includes(".test."));
/** Scenario-creator data rendered through t(variable): catalog, groups, kinds, events. */
function authoringKeys(): string[] {
    return [...GROUPS.map(g => g.label), "Tất cả", ...Object.values(KIND_LABEL), ...Object.values(EVENT_LABEL),
        ...Object.values(EVENT_PARAMS).flatMap(p => Object.values(p).map(([label]) => label)),
        ...SCENARIO_TYPES.flatMap(type => [type.name, type.summary, type.requires,
            ...type.params.flatMap(p => "options" in p ? [p.label, ...p.options.map(o => o.label)] : [p.label])]),
        ...SUGGESTIONS, TEMPLATE_FILE_ERROR, ...Object.values(REASON), "không kiểm được",
        // Issue/explanation messages built as data: add(path, "…") in template.ts, ["…", {vars}] in mockAi.ts.
        ...["template.ts", "mockAi.ts", "AiChat.tsx"].flatMap(f => [...readFileSync(join(dir, "authoring", f), "utf8").matchAll(/(?:add\([^,]+,\s*|\[\s*|label:\s*)"([^"]+)"\s*(?:,\s*\{|\)|,\s*action)/g)].map(m => m[1]))];
}

function literalKeys(): string[] {
    const keys = new Set<string>();
    for (const file of sources()) {
        const source = readFileSync(join(dir, file), "utf8");
        for (const m of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
        for (const m of source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
    }
    return [...keys];
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe("i18n dictionary", () => {
    it("has an English entry for every literal and indirect key", () => {
        const keys = [...literalKeys(), ...INDIRECT, ...authoringKeys()];
        expect(keys.length).toBeGreaterThan(300);
        expect(keys.filter(k => !(k in EN))).toEqual([]);
    });
    it("keeps the same placeholders in every translation", () => {
        expect(Object.entries(EN).filter(([vi, en]) => placeholders(vi).join() !== placeholders(en).join()).map(([vi]) => vi)).toEqual([]);
    });
    it("never wraps template literals or concatenations in t()", () => {
        for (const file of sources())
            expect(readFileSync(join(dir, file), "utf8").match(/\bt\(\s*`/g), file).toBeNull();
    });
});
