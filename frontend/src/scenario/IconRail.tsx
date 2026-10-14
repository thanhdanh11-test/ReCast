import type { ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useT } from "./i18n";

export interface RailItem {
    id: string;
    label: string;
    icon: ReactNode;
    /** Primary action (red) vs. tool that opens a drawer. */
    tone?: "run";
    disabled?: boolean;
    badge?: boolean;
    /** Pinned to the bottom group. */
    bottom?: boolean;
    separatorBefore?: boolean;
}

/** Vertical icon toolbar; expand/collapse sits at the very top. Labels show when wide, else as tooltips. */
export function IconRail({ items, active, wide, onToggleWide, onSelect }: {
    items: RailItem[]; active: string | null; wide: boolean;
    onToggleWide: () => void; onSelect: (id: string) => void;
}) {
    const t = useT();
    const button = (item: RailItem) => <button key={item.id} className={`rail-button${item.tone === "run" ? " rail-run" : ""}`}
        aria-label={item.label} title={wide ? undefined : item.label} aria-pressed={active === item.id}
        disabled={item.disabled} onClick={() => onSelect(item.id)}>
        {item.icon}<span className="rail-label">{item.label}</span>{item.badge && <i className="rail-badge" aria-hidden/>}
    </button>;
    const top = items.filter(i => !i.bottom), bottom = items.filter(i => i.bottom);
    return <nav className={`icon-rail${wide ? " wide" : ""}`} aria-label={t("Công cụ")}>
        <button className="rail-button" aria-label={wide ? t("Thu gọn thanh công cụ") : t("Mở rộng thanh công cụ")} title={wide ? undefined : t("Mở rộng thanh công cụ")} aria-expanded={wide} onClick={onToggleWide}>
            {wide ? <PanelLeftClose size={20} aria-hidden/> : <PanelLeftOpen size={20} aria-hidden/>}<span className="rail-label">{t("Thu gọn")}</span>
        </button>
        <hr/>
        {top.map(item => <span key={item.id} className="rail-slot">{item.separatorBefore && <hr/>}{button(item)}</span>)}
        <div className="rail-grow"/>
        {bottom.map(button)}
    </nav>;
}
