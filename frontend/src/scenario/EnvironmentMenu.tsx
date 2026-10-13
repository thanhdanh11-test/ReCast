import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { CARLA_WEATHER_VALUES, environmentSettingsFor, type SceneEnvironmentSettings, type SceneQuality, type WeatherPresetId } from "./weather";

import { ModelCredits } from "./ModelCredits";

export function HeaderPopover({label, children, primary = false}: {label: string; children: ReactNode; primary?: boolean}) {
    const [open, setOpen] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    useEffect(() => {
        if (!open) return;
        const close = () => { setOpen(false); trigger.current?.focus(); };
        const pointer = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) close(); };
        const keyboard = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); close(); }
            if (event.key === "Tab") {
                const controls = Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),summary,[tabindex="0"]') || []);
                const first = controls[0], last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        };
        container.current?.querySelector<HTMLElement>('.header-popover-panel button:not(:disabled),.header-popover-panel select')?.focus();
        document.addEventListener("pointerdown", pointer);
        document.addEventListener("keydown", keyboard);
        return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", keyboard); };
    }, [open]);
    return <div className="header-popover" ref={container}>
        <button ref={trigger} className={primary ? "primary header-import-trigger" : undefined} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={() => setOpen(!open)}>{label} <span aria-hidden="true">⌄</span></button>
        {open && <div className="header-popover-panel" id={id} role="dialog" aria-label={label}>{children}</div>}
    </div>;
}

export function EnvironmentMenu({settings, onChange}: {settings: SceneEnvironmentSettings; onChange: (settings: SceneEnvironmentSettings) => void}) {
    return <HeaderPopover label="Môi trường"><EnvironmentPanel settings={settings} onChange={onChange}/></HeaderPopover>;
}
/** Weather/quality controls, shared by the header popover and the rail drawer. */
export function EnvironmentPanel({settings, onChange}: {settings: SceneEnvironmentSettings; onChange: (settings: SceneEnvironmentSettings) => void}) {
    return <>
        <label className="field">Thời tiết CARLA 0.9.15<select aria-label="Thời tiết CARLA 0.9.15" value={settings.preset} onChange={event => onChange(environmentSettingsFor(event.target.value as WeatherPresetId, settings.quality))}>
            {Object.keys(CARLA_WEATHER_VALUES).map(preset => <option key={preset} value={preset}>{preset}</option>)}
        </select></label>
        <label className="field">Chất lượng 3D<select aria-label="Chất lượng 3D" value={settings.quality} onChange={event => onChange(environmentSettingsFor(settings.preset, event.target.value as SceneQuality))}>
            <option value="auto">Tự động</option><option value="high">Chi tiết cao</option><option value="balanced">Cân bằng</option>
        </select></label>
        <p className="sensor-note">Thời tiết chỉ thay đổi hiển thị; mô phỏng hình ảnh qua Three.js.</p><ModelCredits/>
    </>;
}
