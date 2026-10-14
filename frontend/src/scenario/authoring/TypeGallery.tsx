import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useT } from "../i18n";
import { GROUPS, SCENARIO_TYPES, newTemplate, type GroupId, type ScenarioType } from "./catalog";
import { TemplatePreview } from "./TemplatePreview";

/** Step 1: pick a scenario type. Thumbnails are drawn from each type's own default build. */
export function TypeGallery({ scene, onPick }: { scene: string; onPick: (type: ScenarioType) => void }) {
    const t = useT();
    const [group, setGroup] = useState<GroupId | "all">("all");
    const [query, setQuery] = useState("");
    const previews = useMemo(() => new Map(SCENARIO_TYPES.map(type => [type.id, newTemplate(type, scene, type.name)])), [scene]);
    const q = query.trim().toLowerCase();
    const shown = SCENARIO_TYPES.filter(type => (group === "all" || type.group === group)
        && (!q || [type.name, type.summary, t(type.name), t(type.summary)].some(s => s.toLowerCase().includes(q))));
    return <div className="authoring-gallery">
        <div className="authoring-filter">
            <div className="authoring-groups" role="group" aria-label={t("Nhóm kịch bản")}>
                {[{ id: "all" as const, label: "Tất cả" }, ...GROUPS].map(g => <button key={g.id} className="chip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>{t(g.label)}</button>)}
            </div>
            <label className="authoring-search"><Search size={14} aria-hidden/><input aria-label={t("Tìm loại kịch bản")} placeholder={t("Tìm loại kịch bản")} value={query} onChange={e => setQuery(e.target.value)}/></label>
        </div>
        <ul className="authoring-cards">
            {shown.map(type => {
                const Icon = type.icon;
                return <li key={type.id}><button className="authoring-card" onClick={() => onPick(type)} aria-label={t("Chọn loại {name}", { name: t(type.name) })}>
                    <TemplatePreview template={previews.get(type.id)!} layout={type.layout} compact/>
                    <span className="authoring-card-title"><Icon size={15} aria-hidden/>{t(type.name)}</span>
                    <small>{t(type.summary)}</small>
                    <span className="authoring-require">{t("Cần trên map")}: {t(type.requires)}</span>
                </button></li>;
            })}
            {!shown.length && <li className="runner-muted">{t("Không có loại phù hợp.")}</li>}
        </ul>
    </div>;
}
