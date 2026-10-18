import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Box, Database, Gauge, Info, Languages, MessageSquare, Palette, Play, Radar, UserRound } from "lucide-react";
import { accessCall, type Session } from "./accessApi";
import { ModelCredits } from "./ModelCredits";
import { useT, type Translate } from "./i18n";
import type { Preferences } from "./preferences";
import type { DesktopAPI, FeedbackEntry, FeedbackKind, Settings, StorageInfo } from "./types";

export type SettingsSection = "appearance" | "display" | "lidar" | "playback" | "units" | "language" | "data" | "account" | "feedback" | "about";

export interface SettingsPageProps {
    preferences: Preferences;
    onChange: (change: Partial<Preferences>) => void;
    onBack: () => void;
    demo: boolean;
    api: DesktopAPI;
    settings: Settings | null;
    busy: boolean;
    onChooseDataset: () => void;
    onChooseWorkspace: () => void;
    /** Present when the studio runs behind the local login (AccessApp). */
    onLogout?: () => void;
    /** Attached to feedback when the viewer allows it. */
    feedbackContext: Record<string, string>;
    /** Opens the maker's external form (build-time VITE_FEEDBACK_URL), when configured. */
    onOpenFeedbackForm?: () => void;
}

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode; local?: boolean; account?: boolean }[] = [
    { id: "appearance", label: "Giao diện", icon: <Palette size={16} aria-hidden/> },
    { id: "display", label: "Hiển thị 3D", icon: <Box size={16} aria-hidden/> },
    { id: "lidar", label: "LiDAR", icon: <Radar size={16} aria-hidden/> },
    { id: "playback", label: "Phát lại", icon: <Play size={16} aria-hidden/> },
    { id: "units", label: "Đơn vị", icon: <Gauge size={16} aria-hidden/> },
    { id: "language", label: "Ngôn ngữ", icon: <Languages size={16} aria-hidden/> },
    { id: "data", label: "Dữ liệu & lưu trữ", icon: <Database size={16} aria-hidden/>, local: true },
    { id: "account", label: "Tài khoản", icon: <UserRound size={16} aria-hidden/>, account: true },
    { id: "feedback", label: "Góp ý nhà sản xuất", icon: <MessageSquare size={16} aria-hidden/> },
    { id: "about", label: "Thông tin", icon: <Info size={16} aria-hidden/> },
];

const SHORTCUTS: [string, string][] = [
    ["Space", "Phát / tạm dừng"], ["← / →", "Lùi / tiến 1 giây"], ["Home / End", "Về đầu / về cuối"], ["Esc", "Đóng ngăn, thu khung phóng to, rời trang cài đặt"],
];

function bytes(value: number) {
    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let v = value / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function Choice<T extends string | number | boolean>({ label, value, options, onChange, hint }: {
    label: string; value: T; options: [T, string][]; onChange: (value: T) => void; hint?: string;
}) {
    return <fieldset className="settings-choice">
        <legend>{label}</legend>
        <div role="radiogroup" aria-label={label}>
            {options.map(([option, text]) => <button key={String(option)} type="button" role="radio" aria-checked={option === value}
                className={option === value ? "selected" : ""} onClick={() => onChange(option)}>{text}</button>)}
        </div>
        {hint && <p className="settings-hint">{hint}</p>}
    </fieldset>;
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
    return <section className="settings-section" aria-label={title}>
        <h2>{title}</h2>
        {note && <p className="settings-hint">{note}</p>}
        {children}
    </section>;
}

function DataSection({ t, api, settings, busy, onChooseDataset, onChooseWorkspace }: { t: Translate } & Pick<SettingsPageProps, "api" | "settings" | "busy" | "onChooseDataset" | "onChooseWorkspace">) {
    const [info, setInfo] = useState<StorageInfo | null>(null), [status, setStatus] = useState(""), [working, setWorking] = useState(false);
    const refresh = () => { void api.storageInfo?.().then(setInfo).catch(e => setStatus(String(e.message || e))); };
    useEffect(refresh, [api, settings?.workspace]); // eslint-disable-line react-hooks/exhaustive-deps
    async function run(action: () => Promise<{ removed: number }> | undefined, done: string) {
        setWorking(true); setStatus("");
        try { const r = await action(); setStatus(t(done, { n: r?.removed ?? 0 })); refresh(); }
        catch (e) { setStatus(String((e as Error).message || e).replace(/^[A-Z_]+: /, "")); }
        finally { setWorking(false); }
    }
    return <Section title={t("Dữ liệu & lưu trữ")}>
        <dl className="settings-kv">
            <dt>{t("Dữ liệu đang dùng")}</dt><dd>{settings?.dataset ? `${settings.dataset} · ${settings.datasetVersion || "nuScenes"}` : t("Chưa chọn dữ liệu")}</dd>
            <dt>{t("Thư mục lưu kịch bản")}</dt><dd className="settings-path">{settings?.workspace || "—"}</dd>
        </dl>
        <div className="settings-row">
            <button type="button" disabled={busy} onClick={onChooseDataset}>{settings?.dataset ? t("Đổi dữ liệu") : t("Chọn thư mục dữ liệu")}</button>
            <button type="button" disabled={busy} onClick={onChooseWorkspace}>{t("Thư mục lưu")}</button>
        </div>
        <h3>{t("Bộ nhớ")}</h3>
        {info ? <dl className="settings-kv">
            <dt>{t("Kịch bản đã lưu")}</dt><dd>{info.scenarios} · {bytes(info.scenarioBytes)}</dd>
            <dt>{t("Bộ nhớ đệm chỉ số")}</dt><dd>{bytes(info.metricsBytes)}</dd>
            <dt>{t("Thùng rác (.trash)")}</dt><dd>{t("{n} mục", { n: info.trashItems })} · {bytes(info.trashBytes)}</dd>
        </dl> : <p className="settings-hint">{t("Đang đo dung lượng…")}</p>}
        <div className="settings-row">
            <button type="button" disabled={working || !info?.metricsBytes} onClick={() => void run(() => api.clearMetricsCache?.(), "Đã xoá bộ nhớ đệm chỉ số ({n} kịch bản).")}>{t("Xoá bộ nhớ đệm chỉ số")}</button>
            <button type="button" className="danger" disabled={working || !info?.trashItems} onClick={() => {
                if (window.confirm(t("Xoá vĩnh viễn {n} mục trong thùng rác? Không thể khôi phục.", { n: info?.trashItems ?? 0 })))
                    void run(() => api.emptyTrash?.(), "Đã dọn thùng rác ({n} mục).");
            }}>{t("Dọn thùng rác")}</button>
        </div>
        <p className="settings-hint">{t("Chỉ số sẽ được tính lại khi mở kịch bản. Cảnh nguồn đã dựng được giữ trong bộ nhớ của phiên đang chạy.")}</p>
        {status && <p className="settings-status" role="status">{status}</p>}
    </Section>;
}

function AccountSection({ t, onLogout }: { t: Translate; onLogout: () => void }) {
    const [session, setSession] = useState<(Session & { sessionHours?: number }) | null>(null);
    const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [repeat, setRepeat] = useState("");
    const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null), [working, setWorking] = useState(false);
    useEffect(() => { void accessCall<Session & { sessionHours?: number }>("auth/session").then(setSession).catch(() => {}); }, []);
    async function changePassword() {
        if (next !== repeat) { setStatus({ ok: false, text: t("Mật khẩu nhập lại không khớp.") }); return; }
        setWorking(true); setStatus(null);
        try {
            await accessCall("auth/password", { current, next });
            setCurrent(""); setNext(""); setRepeat("");
            setStatus({ ok: true, text: t("Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất.") });
        } catch (e) { setStatus({ ok: false, text: (e as Error).message }); }
        finally { setWorking(false); }
    }
    async function setHours(hours: number) {
        try { await accessCall("auth/sessionHours", { hours }); setSession(s => s && { ...s, sessionHours: hours }); }
        catch (e) { setStatus({ ok: false, text: (e as Error).message }); }
    }
    return <Section title={t("Tài khoản")}>
        <dl className="settings-kv"><dt>{t("Tên đăng nhập")}</dt><dd>{session?.username ?? "—"}</dd></dl>
        <Choice label={t("Tự đăng xuất sau")} value={session?.sessionHours ?? 8} onChange={h => void setHours(h)}
            options={[[1, t("1 giờ")], [8, t("8 giờ")], [24, t("1 ngày")], [168, t("7 ngày")]]} hint={t("Áp dụng cho lần đăng nhập sau.")}/>
        <form className="settings-form" onSubmit={e => { e.preventDefault(); void changePassword(); }}>
            <h3>{t("Đổi mật khẩu")}</h3>
            <label className="field">{t("Mật khẩu hiện tại")}<input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required/></label>
            <label className="field">{t("Mật khẩu mới (12–128 ký tự)")}<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={next} onChange={e => setNext(e.target.value)} required/></label>
            <label className="field">{t("Nhập lại mật khẩu mới")}<input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} required/></label>
            <button type="submit" disabled={working || !current || next.length < 12}>{t("Đổi mật khẩu")}</button>
            {status && <p className={status.ok ? "settings-status" : "settings-status bad"} role="status">{status.text}</p>}
        </form>
        <div className="settings-row"><button type="button" onClick={onLogout}>{t("Đăng xuất")}</button></div>
    </Section>;
}

function FeedbackSection({ t, api, context, openForm }: { t: Translate; api: DesktopAPI; context: Record<string, string>; openForm?: () => void }) {
    const [kind, setKind] = useState<FeedbackKind>("bug"), [message, setMessage] = useState(""), [contact, setContact] = useState(""), [attach, setAttach] = useState(true);
    const [history, setHistory] = useState<FeedbackEntry[]>([]), [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null), [working, setWorking] = useState(false);
    const local = !!api.submitFeedback;
    const load = () => { void api.listFeedback?.().then(setHistory).catch(() => {}); };
    useEffect(load, [api]); // eslint-disable-line react-hooks/exhaustive-deps
    const kinds: [FeedbackKind, string][] = [["bug", t("Báo lỗi")], ["idea", t("Đề xuất")], ["other", t("Khác")]];
    async function submit() {
        setWorking(true); setStatus(null);
        try {
            await api.submitFeedback!({ kind, message, ...(contact.trim() ? { contact: contact.trim() } : {}), ...(attach ? { context } : {}) });
            setMessage(""); setStatus({ ok: true, text: t("Đã lưu góp ý. Cảm ơn bạn!") }); load();
        } catch (e) { setStatus({ ok: false, text: String((e as Error).message || e).replace(/^[A-Z_]+: /, "") }); }
        finally { setWorking(false); }
    }
    function exportAll() {
        const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "topeye-feedback.json" });
        a.click();
        URL.revokeObjectURL(a.href);
    }
    return <Section title={t("Góp ý nhà sản xuất")} note={t("Báo lỗi hoặc đề xuất tính năng cho đội phát triển ReCast.")}>
        {local && <form className="settings-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
            <Choice label={t("Loại góp ý")} value={kind} onChange={setKind} options={kinds}/>
            <label className="field">{t("Nội dung")}<textarea aria-label={t("Nội dung")} rows={6} maxLength={4000} value={message} onChange={e => setMessage(e.target.value)}
                placeholder={t("Mô tả vấn đề hoặc ý tưởng; nếu là lỗi, ghi các bước để tái hiện.")} required/></label>
            <label className="field">{t("Liên hệ (không bắt buộc)")}<input maxLength={200} value={contact} onChange={e => setContact(e.target.value)} placeholder="email@example.com"/></label>
            <label className="toggle"><input type="checkbox" checked={attach} onChange={e => setAttach(e.target.checked)}/>{t("Kèm thông tin hệ thống")}</label>
            {attach && <p className="settings-hint">{Object.entries(context).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
            <button type="submit" className="primary" disabled={working || !message.trim()}>{t("Gửi góp ý")}</button>
            {status && <p className={status.ok ? "settings-status" : "settings-status bad"} role="status">{status.text}</p>}
            <p className="settings-hint">{t("Góp ý được lưu trên máy này; dùng “Xuất góp ý” để gửi tệp cho nhà sản xuất.")}</p>
        </form>}
        <div className="settings-row">
            {openForm && <button type="button" onClick={openForm}>{t("Mở biểu mẫu góp ý")}</button>}
            {local && <button type="button" disabled={!history.length} onClick={exportAll}>{t("Xuất góp ý (.json)")}</button>}
        </div>
        {!local && !openForm && <p className="settings-hint">{t("Bản web demo chưa có kênh góp ý.")}</p>}
        {history.length > 0 && <>
            <h3>{t("Góp ý đã gửi")}</h3>
            <ul className="settings-feedback-list">{history.map(entry => <li key={entry.id}>
                <span className="chip">{kinds.find(([k]) => k === entry.kind)?.[1]}</span>
                <time dateTime={entry.saved_at}>{new Date(entry.saved_at).toLocaleString()}</time>
                <p>{entry.message}</p>
            </li>)}</ul>
        </>}
    </Section>;
}

/** Full-page settings (replaces the 3D/LiDAR/map workspace until "Quay lại" or Esc). */
export function SettingsPage(props: SettingsPageProps) {
    const t = useT();
    const { preferences: p, onChange, demo, settings } = props;
    const visible = SECTIONS.filter(s => (!s.local || !demo) && (!s.account || props.onLogout));
    const [active, setActive] = useState<SettingsSection>("appearance");
    const section = visible.some(s => s.id === active) ? active : "appearance";
    return <div className="settings-page" role="region" aria-label={t("Cài đặt")}>
        <nav className="settings-nav" aria-label={t("Mục cài đặt")}>
            <button type="button" className="settings-back" onClick={props.onBack}><ArrowLeft size={16} aria-hidden/>{t("Quay lại")}</button>
            <h1>{t("Cài đặt")}</h1>
            {visible.map(s => <button key={s.id} type="button" aria-current={s.id === section ? "page" : undefined} onClick={() => setActive(s.id)}>{s.icon}{t(s.label)}</button>)}
        </nav>
        <div className="settings-content">
            {section === "appearance" && <Section title={t("Giao diện")}>
                <Choice label={t("Chế độ màu")} value={p.appearance} onChange={appearance => onChange({ appearance })}
                    options={[["dark", t("Tối")], ["light", t("Sáng")], ["system", t("Theo hệ thống")]]}/>
                <Choice label={t("Chất lượng đồ hoạ")} value={p.quality} onChange={quality => onChange({ quality })}
                    options={[["auto", t("Tự động")], ["high", t("Cao")], ["balanced", t("Cân bằng")]]}
                    hint={t("Tự động hạ độ phân giải khi máy chạy chậm; Cân bằng dùng độ phân giải thấp nhất.")}/>
            </Section>}
            {section === "display" && <Section title={t("Hiển thị 3D")}>
                <Choice label={t("Góc camera khi mở cảnh")} value={p.camera} onChange={camera => onChange({ camera })}
                    options={[["follow", t("Bám xe")], ["overview", t("Toàn cảnh")], ["cabin", t("Trong xe")]]}/>
                <Choice label={t("Bóng đổ")} value={p.shadows} onChange={shadows => onChange({ shadows })} options={[[true, t("Bật")], [false, t("Tắt")]]}
                    hint={t("Tắt bóng đổ giúp máy yếu chạy mượt hơn.")}/>
                <Choice label={t("Hành lang đường đi của xe ego")} value={p.corridor} onChange={corridor => onChange({ corridor })} options={[[true, t("Hiện")], [false, t("Ẩn")]]}/>
            </Section>}
            {section === "lidar" && <Section title={t("LiDAR")}>
                <Choice label={t("Tô màu điểm theo")} value={p.lidarColor} onChange={lidarColor => onChange({ lidarColor })}
                    options={[["height", t("Độ cao")], ["intensity", t("Cường độ phản xạ")], ["distance", t("Khoảng cách")]]}/>
                <Choice label={t("Kích thước điểm")} value={p.lidarPointSize} onChange={lidarPointSize => onChange({ lidarPointSize })}
                    options={[[1, t("Nhỏ")], [2, t("Vừa")], [3, t("Lớn")]]}/>
            </Section>}
            {section === "playback" && <Section title={t("Phát lại")}>
                <Choice label={t("Tốc độ phát")} value={p.playbackRate} onChange={playbackRate => onChange({ playbackRate })}
                    options={[[0.5, "0,5×"], [1, "1×"], [2, "2×"]]}/>
                <Choice label={t("Tự phát khi mở cảnh")} value={p.autoplay} onChange={autoplay => onChange({ autoplay })} options={[[true, t("Bật")], [false, t("Tắt")]]}/>
                <Choice label={t("Lặp lại khi hết")} value={p.loop} onChange={loop => onChange({ loop })} options={[[true, t("Bật")], [false, t("Tắt")]]}/>
            </Section>}
            {section === "units" && <Section title={t("Đơn vị")}>
                <Choice label={t("Tốc độ")} value={p.speedUnit} onChange={speedUnit => onChange({ speedUnit })} options={[["kmh", "km/h"], ["ms", "m/s"]]}/>
            </Section>}
            {section === "language" && <Section title={t("Ngôn ngữ")} note={t("Thông báo lỗi từ máy chủ vẫn hiển thị bằng tiếng Việt.")}>
                <Choice label={t("Ngôn ngữ giao diện")} value={p.language} onChange={language => onChange({ language })} options={[["vi", "Tiếng Việt"], ["en", "English"]]}/>
            </Section>}
            {section === "data" && <DataSection t={t} api={props.api} settings={settings} busy={props.busy} onChooseDataset={props.onChooseDataset} onChooseWorkspace={props.onChooseWorkspace}/>}
            {section === "account" && props.onLogout && <AccountSection t={t} onLogout={props.onLogout}/>}
            {section === "feedback" && <FeedbackSection t={t} api={props.api} context={props.feedbackContext} openForm={props.onOpenFeedbackForm}/>}
            {section === "about" && <Section title={t("Thông tin")}>
                <dl className="settings-kv">
                    <dt>{t("Phiên bản")}</dt><dd>ReCast {settings?.version ?? "—"}</dd>
                    <dt>{t("Chế độ")}</dt><dd>{demo ? t("Web demo") : t("Ứng dụng trên máy (localhost)")}</dd>
                    <dt>{t("Bộ mô phỏng")}</dt><dd>{demo ? "—" : settings?.engineAvailable ? "esmini 3.9.0" : t("Chưa cài esmini")}</dd>
                </dl>
                <h3>{t("Phím tắt")}</h3>
                <dl className="settings-kv shortcuts">{SHORTCUTS.map(([key, what]) => <Fragment key={key}><dt><kbd>{key}</kbd></dt><dd>{t(what)}</dd></Fragment>)}</dl>
                <h3>{t("Giấy phép")}</h3>
                <ul className="settings-licenses">
                    <li>nuScenes © Motional · CC BY-NC-SA 4.0 ({t("phi thương mại")})</li>
                    <li>Argoverse 2 · CC BY-NC-SA 4.0 ({t("phi thương mại")})</li>
                    <li>esmini · MPL-2.0</li>
                    <li>CARLA weather presets · MIT</li>
                </ul>
                <ModelCredits/>
            </Section>}
        </div>
    </div>;
}
