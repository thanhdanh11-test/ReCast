import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, Eye, EyeOff, FolderPlus, LoaderCircle, LogOut, MapPin, Plus, Route, ShieldCheck, X } from "lucide-react";
import ScenarioApp from "./ScenarioApp";
import logo from "./assets/topeye-logo.png";
import { accessCall, type DatasetEntry, type Session } from "./accessApi";
import "./access.css";
import { LanguageProvider, useT } from "./i18n";
import { loadPreferences, PREFERENCES_EVENT } from "./preferences";


function Brand() {
  return <div className="access-brand"><img src={logo} alt=""/><span>Recast<small>SCENARIO STUDIO</small></span></div>;
}
function Login({ configured, onSession }: { configured: boolean; onSession: (s: Session) => void }) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try { onSession(await accessCall<Session>(configured ? "auth/login" : "auth/setup", { username, password })); setPassword(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <main className="access-screen login-screen">
    <section className="login-world" aria-label="Recast Scenario Studio">
      <Brand/>
      <div className="login-editorial"><p className="access-eyebrow">{t("GÓC NHÌN TỪ DỮ LIỆU THẬT")}</p><h1>{t("Từ đường phố")}<br/>{t("đến kịch bản")}<span>.</span></h1><p>{t("Chọn một bản đồ. Khám phá chuyển động.")}<br/>{t("Bắt đầu hành trình mô phỏng của bạn.")}</p></div>
      <div className="road-art" aria-hidden="true"><div className="road-line road-one"/><div className="road-line road-two"/><div className="road-line road-three"/><div className="road-pin"><Route size={24}/></div><span className="road-caption">YOUR NEXT SCENARIO STARTS HERE</span></div>
      <div className="login-world-foot"><span>{t("LiDAR · Quỹ đạo · OpenSCENARIO")}</span><span>{t("01 / KHỞI ĐỘNG")}</span></div>
    </section>
    <section className="login-form-panel">
      <div className="login-form-wrap"><span className="access-section-number">RECAST / ACCESS</span><h2>{configured ? t("Chào mừng trở lại.") : t("Bắt đầu với Recast.")}</h2><p className="access-subtitle">{configured ? t("Đăng nhập để mở thư viện map của bạn.") : t("Tạo tài khoản trên máy này để vào thư viện map.")}</p>
        <form onSubmit={submit} className="access-form">
          <label>{t("Tên đăng nhập")}<input autoFocus name="username" autoComplete="username" required minLength={3} maxLength={64} pattern={"[A-Za-z0-9_.\\-]{3,64}"} value={username} onChange={e => setUsername(e.target.value)} placeholder={t("Nhập tên đăng nhập")} disabled={busy}/></label>
          <div className="password-label"><label htmlFor="local-password">{t("Mật khẩu")}</label><div className="password-field"><input id="local-password" name="password" type={visible ? "text" : "password"} autoComplete={configured ? "current-password" : "new-password"} required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={t("Tối thiểu 12 ký tự")} disabled={busy}/><button type="button" aria-label={visible ? t("Ẩn mật khẩu") : t("Hiện mật khẩu")} aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></div>
          {error && <p className="access-error" role="alert">{error}</p>}
          <button className="access-primary" disabled={busy} type="submit">{busy ? <><LoaderCircle className="access-spin" size={18}/>{t("Đang xử lý")}</> : <>{configured ? t("Đăng nhập") : t("Tạo tài khoản")}<ArrowRight size={19}/></>}</button>
        </form><p className="access-local-note"><ShieldCheck size={16}/>{t("Tài khoản và dữ liệu được lưu trên máy này.")}</p>
      </div><small className="login-bottom">{t("KHÔNG GIAN LÀM VIỆC CỦA BẠN")}</small>
    </section>
  </main>;
}

function ImportDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<void> }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { await accessCall("catalog/add", { path, name }); await onAdded(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <dialog className="access-dialog" ref={dialog} aria-labelledby="import-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="import-heading"><FolderPlus size={24}/><button type="button" aria-label={t("Đóng nhập dữ liệu")} disabled={busy} onClick={onClose}><X size={20}/></button></div>
    <h2 id="import-title">{t("Thêm dữ liệu của bạn")}</h2><p>{t("Chọn thư mục nuScenes hoặc Argoverse 2 Sensor đã có trên máy. Dữ liệu gốc được giữ nguyên.")}</p>
    <form className="access-form" onSubmit={submit}>
      <label>{t("Tên bộ dữ liệu")}<input autoFocus value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder={t("Ví dụ: Chuyến đi buổi sáng")} disabled={busy}/></label>
      <label>{t("Đường dẫn thư mục")}<input required value={path} maxLength={4096} onChange={e => setPath(e.target.value)} placeholder="/Users/…/datasets/my-map" disabled={busy}/></label>
      {error && <p className="access-error" role="alert">{error}</p>}
      <button className="access-primary" disabled={busy || !path.trim()}>{busy ? <><LoaderCircle className="access-spin" size={18}/>{t("Đang kiểm tra dữ liệu")}</> : <>{t("Thêm vào thư viện")}<ArrowRight size={18}/></>}</button>
    </form>
  </dialog>;
}
const cities: Record<string, string> = { PIT: "Pittsburgh", MIA: "Miami", WDC: "Washington D.C.", DTW: "Detroit", PAO: "Palo Alto", "boston-seaport": "Boston", "singapore-onenorth": "Singapore", "singapore-queenstown": "Singapore", "singapore-hollandvillage": "Singapore" };
function locations(entry: DatasetEntry) { return [...new Set(entry.regions.map(r => cities[r] || r))].join(" · "); }

/** Login and library follow the saved UI language; the studio provides its own (live) one. */
export default function AccessApp() {
  const [language, setLanguage] = useState(() => loadPreferences().language);
  useEffect(() => {
    const sync = () => setLanguage(loadPreferences().language);
    window.addEventListener(PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(PREFERENCES_EVENT, sync);
  }, []);
  return <LanguageProvider value={language}><AccessScreens/></LanguageProvider>;
}

function AccessScreens() {
  const t = useT();
  const [session, setSession] = useState<Session | null>(null);
  const [entries, setEntries] = useState<DatasetEntry[]>([]);
  const [studio, setStudio] = useState(false);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const plus = useRef<HTMLButtonElement>(null);
  async function refresh() { setEntries(await accessCall<DatasetEntry[]>("catalog")); }
  useEffect(() => {
    let active = true;
    accessCall<Session>("auth/session").then(s => { if (active) setSession(s); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    const expired = () => { setSession(s => ({ configured: s?.configured ?? true, authenticated: false })); setStudio(false); setEntries([]); setImporting(false); };
    window.addEventListener("topeye-session-expired", expired);
    return () => { active = false; window.removeEventListener("topeye-session-expired", expired); };
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    setLoading(true); setError("");
    accessCall<DatasetEntry[]>("catalog").then(v => { if (active) setEntries(v); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.authenticated]);
  async function open(entry: DatasetEntry) {
    if (opening) return;
    setOpening(entry.id); setError("");
    try { await accessCall("catalog/select", { id: entry.id }); setStudio(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setOpening(null); }
  }
  async function logout() {
    try { const s = await accessCall<Session>("auth/logout", {}); setSession(s); setStudio(false); setEntries([]); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  if (!session) return <main className="access-screen access-pending"><Brand/>{loading ? <p role="status"><LoaderCircle className="access-spin"/>{t("Đang mở Recast…")}</p> : <><p role="alert">{error}</p><button className="access-primary" onClick={() => window.location.reload()}>{t("Thử lại")}</button></>}</main>;
  if (!session.authenticated) return <Login key={String(session.configured)} configured={session.configured} onSession={s => { setError(""); setStudio(false); setSession(s); }}/>;
  if (studio) return <ScenarioApp initialGuided onLibrary={() => { setStudio(false); void refresh().catch(e => setError(e.message)); }} onLogout={() => void logout()}/>;
  const count = entries.filter(e => e.status === "ready").reduce((sum, e) => sum + e.sceneCount, 0);
  return <main className="access-screen catalog-screen">
    <header className="catalog-header"><Brand/><div className="catalog-account"><span><i/>{session.username}</span><button type="button" className="access-quiet" onClick={() => void logout()} disabled={!!opening}><LogOut size={16}/>{t("Đăng xuất")}</button></div></header>
    <section className="catalog-content">
      <div className="catalog-title"><div><p className="access-eyebrow">{t("02 / CHỌN ĐIỂM XUẤT PHÁT")}</p><h1>{t("Chọn map của bạn")}<span>.</span></h1><p className="access-subtitle">{t("Những con đường thật. Những kịch bản tiếp theo.")}</p></div><div className="catalog-total"><strong>{String(count).padStart(2, "0")}</strong><span>{t("SCENE SẴN SÀNG")}</span></div></div>
      <div className="catalog-section-label"><span>{t("THƯ VIỆN DỮ LIỆU")}</span><span>{entries.length} BỘ DỮ LIỆU</span></div>
      {error && <p className="access-error" role="alert">{error}</p>}
      {loading && <p className="catalog-loading" role="status"><LoaderCircle className="access-spin" size={18}/>{t("Đang kiểm tra thư viện…")}</p>}
      <div className="dataset-grid" aria-label={t("Thư viện map")}>
        {entries.map((entry, index) => <button key={entry.id} type="button" className="dataset-tile" disabled={!!opening || entry.status !== "ready"} onClick={() => void open(entry)} aria-label={t("Mở {name}", { name: entry.name })}>
          <div className="dataset-picture">{entry.previewUrl ? <img src={entry.previewUrl} alt="" loading="lazy"/> : <div className="dataset-no-image"><Route size={64}/></div>}<span className="dataset-index">{String(index + 1).padStart(2, "0")}</span><span className="dataset-format">{entry.format === "av2" ? "ARGOVERSE 2" : "NUSCENES"}</span></div>
          <div className="dataset-info"><div className="dataset-title-row"><h2>{entry.name}</h2><ArrowRight size={22}/></div><p><MapPin size={13}/>{locations(entry) || t("Dữ liệu trên máy")}</p><div className="dataset-meta"><span>{entry.sceneCount} scene</span><span>{opening === entry.id ? <><LoaderCircle className="access-spin" size={13}/>{t("Đang mở…")}</> : entry.status === "ready" ? <><Check size={13}/>{t("Sẵn sàng")}</> : t("Không khả dụng")}</span></div></div>
        </button>)}
        <button type="button" ref={plus} className="dataset-tile dataset-add" disabled={!!opening || loading} onClick={() => setImporting(true)}><span className="dataset-plus"><Plus size={36} strokeWidth={1.4}/></span><h2>{t("Thêm dữ liệu")}</h2><p>{t("Mở một hành trình mới")}<br/>{t("từ dữ liệu của bạn")}</p><span className="dataset-add-formats">nuScenes / Argoverse 2 Sensor</span></button>
      </div>
      <footer className="catalog-footer"><span><ShieldCheck size={14}/>{t("Dữ liệu gốc luôn được giữ nguyên")}</span><span>{t("CHỌN MAP → KHÁM PHÁ → TẠO KỊCH BẢN")}</span></footer>
    </section>
    {importing && <ImportDialog onAdded={refresh} onClose={() => { setImporting(false); plus.current?.focus(); }}/>}
  </main>;
}
