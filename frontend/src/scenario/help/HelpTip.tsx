import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "../i18n";
import { TERMS, type TermKey } from "./terms";
import "./help.css";

/** Gap between the mark and its tooltip, and the minimum distance kept from the viewport edges (px). */
const GAP = 6, EDGE = 8;

/**
 * Viewport position of a tooltip of size `tip` next to the mark `mark` (plan47 WP2 §7): below and centred when it
 * fits, flipped above when the bottom would cut it, and slid horizontally to stay inside the viewport.
 */
export function placeTip(mark: { left: number; right: number; top: number; bottom: number }, tip: { width: number; height: number },
    view: { width: number; height: number }): { left: number; top: number } {
    const centre = (mark.left + mark.right) / 2;
    const left = Math.min(Math.max(centre - tip.width / 2, EDGE), Math.max(EDGE, view.width - tip.width - EDGE));
    const below = mark.bottom + GAP, above = mark.top - GAP - tip.height;
    const top = below + tip.height <= view.height - EDGE || above < EDGE ? below : above;
    return { left, top };
}

/**
 * "?" mark explaining one term (plan46 SPEC-WP4 §0; replay-forge help.js behaviour): shows on hover,
 * keyboard focus or click (touch), hides on leave, blur, Escape or a click elsewhere. A click pins it open.
 * The tooltip is fixed to the viewport so scrolling or clipped panels never cut or cover it.
 * The text comes only from TERMS.
 */
export function HelpTip({ term }: { term: TermKey }) {
    const t = useT();
    const id = useId();
    const ref = useRef<HTMLSpanElement>(null);
    const tipRef = useRef<HTMLSpanElement>(null);
    const [hover, setHover] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
    const open = hover || pinned;
    const [title, body] = TERMS[term];
    useEffect(() => {
        if (!open) return;
        const close = () => { setHover(false); setPinned(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
        const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
        document.addEventListener("keydown", onKey);
        document.addEventListener("pointerdown", onDown);
        return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
    }, [open]);
    useLayoutEffect(() => {
        if (!open) { setStyle({ visibility: "hidden" }); return; }
        const place = () => {
            const mark = ref.current?.getBoundingClientRect(), tip = tipRef.current?.getBoundingClientRect();
            if (!mark || !tip) return;
            setStyle(placeTip(mark, tip, { width: window.innerWidth, height: window.innerHeight }));
        };
        place();
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
    }, [open]);
    return <span className="help" ref={ref}>
        <button type="button" className="help-mark" aria-label={t("Giải thích: {title}", { title })} aria-expanded={open} aria-describedby={open ? id : undefined}
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
            onFocus={() => setHover(true)} onBlur={() => { setHover(false); setPinned(false); }}
            onClick={e => { e.preventDefault(); e.stopPropagation(); if (pinned) { setPinned(false); setHover(false); } else setPinned(true); }}>?</button>
        {open && <span className="help-tip" role="tooltip" id={id} ref={tipRef} style={style}><b>{title}</b>{body}</span>}
    </span>;
}
