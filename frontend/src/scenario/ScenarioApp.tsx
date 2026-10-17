import topeyeLogo from "./assets/topeye-logo.png";
import {lazy,Suspense,useEffect,useMemo,useRef,useState} from "react";
import type {Scene,Scenario,Settings} from "./types";
import {TrackView} from "./TrackView";
import {LidarView} from "./LidarView";
import {TacticalMap} from "./TacticalMap";
import {environmentSettingsFor} from "./weather";
import {loadPreferences,savePreferences,useResolvedTheme,type Preferences} from "./preferences";
import {SettingsPage} from "./SettingsPage";
import {advancePlayback} from "./playback";
import {LanguageProvider,translate,useT,type Translate} from "./i18n";
import {IconRail,type RailItem} from "./IconRail";
import {ModelCredits} from "./ModelCredits";
import {Clapperboard,Database,LoaderCircle,Map,Maximize2,Minimize2,Settings as SettingsIcon,X} from "lucide-react";
import "./scenario.css";
const ScenarioWorkspace=lazy(()=>import("./workspace/ScenarioWorkspace").then(m=>({default:m.ScenarioWorkspace})));
const api=window.scenarioApp;
type Panel="track"|"lidar"|"map";
export default function ScenarioApp({onLibrary,onLogout,initialGuided=false}:{onLibrary?:()=>void;onLogout?:()=>void;initialGuided?:boolean}={}) {
 const [datasetEpoch,setDatasetEpoch]=useState(0);
 const [settings,setSettings]=useState<Settings|null>(null),[scenes,setScenes]=useState<Scene[]>([]),[sceneName,setSceneName]=useState("");
 const [mapErrors,setMapErrors]=useState<Record<string,string|null>>({});
 const [source,setSource]=useState<Scenario|null>(null),[busy,setBusy]=useState(false),[childBusy,setChildBusy]=useState(false),[sceneLoading,setSceneLoading]=useState(false);
 const [message,setMessage]=useState("Sẵn sàng"),[error,setError]=useState(""),[time,setTime]=useState(0),[playing,setPlaying]=useState(false);
 const [preferences,setPreferences]=useState<Preferences>(loadPreferences);
 const [view,setView]=useState<"scene"|"scenario">(()=>initialGuided||new URLSearchParams(window.location.search).get("unified-demo")==="1"?"scenario":"scene");
 const [settingsOpen,setSettingsOpen]=useState(false),[drawer,setDrawer]=useState(false),[railWide,setRailWide]=useState(false);
 const [expanded,setExpanded]=useState<"track"|"lidar"|"map"|null>(null);
 const generation=useRef(0),busyRef=useRef(false),dirty=useRef(false),loaded=useRef<Scenario|null>(null);
 const firstPreferences=useRef(preferences);
 const t:Translate=(key,vars)=>translate(preferences.language,key,vars);
 const demo=settings?.mode==="web-demo",locked=busy||childBusy;
 const theme=useResolvedTheme(preferences.appearance);
 const environmentSettings=useMemo(()=>environmentSettingsFor("ClearNoon",preferences.quality),[preferences.quality]);
 const end=source?.interval_s[1]??0;
 useEffect(()=>{if(preferences!==firstPreferences.current)savePreferences(preferences);},[preferences]);
 /** Scenes whose map the creation gate rejects are greyed out in the scenario scene picker; probe failure greys nothing. */
 useEffect(()=>{setMapErrors({});if(!api?.mapStatus||!scenes.length)return;let alive=true;api.mapStatus().then(s=>{if(alive)setMapErrors(s);},()=>{});return()=>{alive=false;};},[scenes]);
 async function checked<T>(request:Promise<T>):Promise<T>{const current=generation.current;const value=await request;if(current!==generation.current)throw new Error("CANCELLED");return value;}
 async function job(label:string,action:()=>Promise<void>){if(busyRef.current)return;const current=++generation.current;busyRef.current=true;setBusy(true);setPlaying(false);setError("");setMessage(label);try{await action();}catch(e){if(current===generation.current){setError(String(e).replace(/^Error: /,""));setMessage(t("Cần kiểm tra lại"));setSceneLoading(false);}}finally{if(current===generation.current){busyRef.current=false;setBusy(false);}}}
 async function loadSource(row:Scene){setSceneLoading(true);const src=await checked(api!.sourceScene({scene:row.scene}));loaded.current=src;setSource(src);setTime(0);setMessage(t("Cảnh gốc: {actors} đối tượng · {buildings} khối nhà",{actors:src.actors.length,buildings:src.environment?.buildings.length??0}));}
 async function refresh(){const s=await checked(api!.settings());setSettings(s);const rows=await checked(api!.listScenes());setScenes(rows);if(!rows.length){setSource(null);loaded.current=null;setSceneName("");setSceneLoading(false);setMessage(t("Chưa có cảnh trong dữ liệu"));return;}const row=rows.find(r=>r.scene===sceneName)||rows.find(r=>r.scene==="scene-0103")||rows[0];setSceneName(row.scene);await loadSource(row);setMessage(t("Đã đọc {n} cảnh",{n:rows.length}));}
 useEffect(()=>{if(!api)return;let alive=true;api.settings().then(s=>{if(!alive)return;setSettings(s);if(s.dataset)void job(t("Đang đọc dữ liệu"),refresh);}).catch(e=>{if(alive)setError(String(e));});const off=api.onProgress(p=>{if(busyRef.current)setMessage(p.phase);});return()=>{alive=false;generation.current++;off();};},[]);
 async function cancel(){generation.current++;busyRef.current=false;setBusy(false);setPlaying(false);setSceneLoading(false);setMessage(t("Đang huỷ tác vụ"));try{await api!.cancelJob();loaded.current=null;setSource(null);setTime(0);setMessage(t("Đã huỷ · tạo lại kịch bản để tiếp tục"));}catch(e){setError(String(e));}}
 async function openScene(row:Scene,preserveDraft=false){if(locked)return;if(!preserveDraft&&dirty.current&&row.scene!==sceneName&&!window.confirm(t("Bỏ bản thiết kế đang chỉnh để đổi cảnh?")))return;if(loaded.current?.source.scene===row.scene){if(!preserveDraft)setView("scene");setTime(0);setPlaying(false);return;}setSource(null);loaded.current=null;setSceneName(row.scene);await job(t("Đang tải cảnh"),()=>loadSource(row));}
 async function chooseDataset(){if(dirty.current&&!window.confirm(t("Bỏ bản thiết kế đang chỉnh để đổi dữ liệu?")))return;await job(t("Đang mở dữ liệu"),async()=>{const result=await checked(api!.chooseDataset());if(result){setDatasetEpoch(v=>v+1);setSource(null);loaded.current=null;setSettings(await checked(api!.settings()));setScenes(result.scenes);const row=result.scenes.find(r=>r.scene==="scene-0103")||result.scenes[0];if(row){setSceneName(row.scene);await loadSource(row);}else{setSceneName("");setSceneLoading(false);}setMessage(t("Đã đọc {n} cảnh",{n:result.scenes.length}));}});}
 const chooseWorkspace=()=>void job(t("Chọn nơi lưu"),async()=>{await checked(api!.chooseWorkspace());setSettings(await checked(api!.settings()));});
 const sceneReady=()=>{setSceneLoading(false);if(preferences.autoplay&&view==="scene")setPlaying(true);};
 useEffect(()=>{if(!playing||view!=="scene"||settingsOpen||!source)return;let previous=performance.now();const timer=setInterval(()=>{const now=performance.now(),dt=(now-previous)/1000;previous=now;setTime(value=>{const next=advancePlayback(value,dt,preferences.playbackRate,end,preferences.loop);if(next.done)setPlaying(false);return next.time;});},40);return()=>clearInterval(timer);},[playing,view,settingsOpen,source?.id,end,preferences.playbackRate,preferences.loop]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){if(settingsOpen)setSettingsOpen(false);else if(expanded)setExpanded(null);else setDrawer(false);return;}const target=e.target as HTMLElement|null;if(view!=="scene"||settingsOpen||locked||!source||e.metaKey||e.ctrlKey||e.altKey||target?.isContentEditable||["INPUT","TEXTAREA","SELECT","BUTTON"].includes(target?.tagName??""))return;if(e.key===" "){e.preventDefault();setPlaying(p=>!p);}if(e.key==="ArrowLeft"){e.preventDefault();setTime(v=>Math.max(0,v-1));}if(e.key==="ArrowRight"){e.preventDefault();setTime(v=>Math.min(end,v+1));}if(e.key==="Home"){e.preventDefault();setTime(0);setPlaying(false);}if(e.key==="End"){e.preventDefault();setTime(end);setPlaying(false);}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[view,settingsOpen,locked,source?.id,end,expanded]);
 if(!api)return <main className="studio view-empty"><h1>Topeye</h1><p>{t("Chạy `npm run web:local` để mở Topeye.")}</p></main>;
 const railItems:RailItem[]=[{id:"scene",label:t("Cảnh nguồn"),icon:<Map size={20}/>,disabled:locked},...(!demo?[{id:"scenario",label:t("Kịch bản"),icon:<Clapperboard size={20}/>,separatorBefore:true,disabled:locked}]:[]),{id:"settings",label:t("Cài đặt"),icon:<SettingsIcon size={20}/>,bottom:true,disabled:locked}];
 function onRail(id:string){if(locked)return;setPlaying(false);if(id==="settings"){setSettingsOpen(v=>!v);setDrawer(false);return;}setSettingsOpen(false);if(id==="scenario"){setView("scenario");setDrawer(false);}else{setView("scene");setDrawer(v=>view==="scene"?!v:true);}}
 const feedbackContext={version:settings?.version??"",scene:sceneName,view,userAgent:navigator.userAgent.slice(0,300)};
 function feedback(){const url=new URL(import.meta.env.VITE_FEEDBACK_URL,window.location.href);if(!["https:","http:"].includes(url.protocol))return;url.search="";const context={scene:sceneName,time:time.toFixed(1),camera:document.querySelector<HTMLElement>('[data-camera-mode]')?.dataset.cameraMode??'follow',weather:environmentSettings.preset,version:settings?.version??''};Object.entries(context).forEach(([k,v])=>url.searchParams.set(k,v));window.open(url.href,"_blank","noopener,noreferrer");}
 return <LanguageProvider value={preferences.language}><div className="studio" data-theme={theme}>
  <header className="studio-header"><div className="studio-brand"><img className="brand-mark" src={topeyeLogo} alt="Logo Topeye"/><h1>Topeye</h1></div>{onLibrary&&<button className="studio-library-button" disabled={locked} onClick={onLibrary}><Database size={14}/>{t("Thư viện map")}</button>}
   {busy&&<div className="busy-indicator" data-testid="busy-indicator"><LoaderCircle size={14} className="spin"/><span>{message}</span><button onClick={()=>void cancel()}>{t("Huỷ tác vụ")}</button></div>}
  </header>
  <div className="studio-body"><IconRail items={railItems} active={settingsOpen?"settings":view} wide={railWide} onToggleWide={()=>setRailWide(v=>!v)} onSelect={onRail}/>
   {settingsOpen&&<SettingsPage preferences={preferences} onChange={change=>setPreferences(p=>({...p,...change}))} onBack={()=>setSettingsOpen(false)} demo={demo} api={api} settings={settings} busy={locked} onChooseDataset={()=>void chooseDataset()} onChooseWorkspace={chooseWorkspace} onLogout={onLogout} feedbackContext={feedbackContext} onOpenFeedbackForm={import.meta.env.VITE_FEEDBACK_URL?feedback:undefined}/>}
   <div className="studio-views" hidden={settingsOpen}>
    {drawer&&view==="scene"&&<aside className="tool-drawer narrow" aria-label={t("Cảnh nguồn")}><div className="drawer-head"><h2>{t("Cảnh nguồn")}</h2><button className="icon-button" aria-label={t("Đóng ngăn")} onClick={()=>setDrawer(false)}><X size={14}/></button></div>{scenes.length?<ul className="scene-list" aria-label={t("Danh sách cảnh")}>{scenes.map(row=><li key={row.scene}><button aria-current={row.scene===sceneName?"true":undefined} disabled={locked} onClick={()=>void openScene(row)}><strong>{row.scene}</strong><small>{row.duration_s.toFixed(1).replace(".",",")} s · {t("{n} đối tượng",{n:row.tracks.length})}</small></button></li>)}</ul>:<p className="sensor-note">{t("Chưa có dữ liệu. Mở “Cài đặt” để chọn thư mục dữ liệu.")}</p>}{demo&&<div className="drawer-credits"><ModelCredits/><p className="sensor-note">nuScenes © Motional, CC BY-NC-SA 4.0</p><p className="sensor-note">CARLA weather presets · MIT</p></div>}</aside>}
    <div className="view-pane" hidden={view!=="scenario"}>
     <div className="sw-container"><label className="sw-scene-picker">{t("Cảnh nguồn")}<select aria-label={t("Cảnh đang chọn")} disabled={locked} value={sceneName} onChange={e=>{const row=scenes.find(r=>r.scene===e.target.value);if(row)void openScene(row);}}>{!scenes.length&&<option value="">—</option>}{scenes.map(row=>{const error=mapErrors[row.scene];return <option key={row.scene} value={row.scene} disabled={!!error} title={error??undefined}>{error?`${row.scene} · ${t("map lỗi, không tạo được kịch bản")}`:row.scene}</option>;})}</select></label>
     {!demo&&sceneName&&settings?.dataset?<Suspense fallback={<p role="status">{t("Đang mở Kịch bản…")}</p>}><ScenarioWorkspace key={`${settings?.dataset}:${settings?.workspace}:${datasetEpoch}`} api={api} externalBusy={busy} scene={sceneName} source={source} scenes={scenes.map(r=>r.scene)} onSelectScene={async value=>{const row=scenes.find(r=>r.scene===value);if(!row)throw new Error(t("Không có cảnh {scene} trong dữ liệu đang mở",{scene:value}));await openScene(row,true);if(loaded.current?.source.scene!==value)throw new Error("CANCELLED");return loaded.current;}} active={view==="scenario"&&!settingsOpen} preferences={preferences} environmentSettings={environmentSettings} onBusyChange={setChildBusy} onDirtyChange={v=>{dirty.current=v;}}/></Suspense>:<section className="sw-empty" role={busy?"status":"region"}><h2>{t("Kịch bản")}</h2><p>{busy?t("Đang tải dữ liệu"):error?t("Không tải được dữ liệu"):t("Chưa có cảnh trong dữ liệu")}</p>{!busy&&<button onClick={()=>void job(t("Đang thử lại"),refresh)}>{t("Thử lại")}</button>}</section>}
     </div>
    </div>
    <div className="view-pane" hidden={view!=="scene"}><main className={`view-workspace ${expanded?`expanded expanded-${expanded}`:""}`}>
     <section className="viewport-panel primary-view" aria-label={t("Mô phỏng 3D")} data-view-state={!source?"empty":"source"}><ExpandButton panel="track" label="khung 3D" expanded={expanded} onChange={setExpanded}/><div className="panel-content"><TrackView scenario={source} time={time} replay={null} environmentSettings={environmentSettings} warnings={source?.environment?.warnings??[]} display={preferences} active={view==="scene"&&!settingsOpen} onReady={view==="scene"?sceneReady:undefined}/></div></section>
     <section className="viewport-panel lidar-panel" aria-label="LiDAR"><ExpandButton panel="lidar" label="khung LiDAR" expanded={expanded} onChange={setExpanded}/><div className="panel-content"><LidarView scenario={source} time={time} replay={null} loadLidar={api.lidarFrame} display={preferences}/></div></section>
     <section className="viewport-panel map-panel" aria-label={t("Map tích hợp")}><ExpandButton panel="map" label="khung map" expanded={expanded} onChange={setExpanded}/><div className="panel-content"><TacticalMap scenario={source} time={time} replay={null}/></div></section>
     {view==="scene"&&sceneLoading&&<LoadingOverlay/>}
    </main></div>
   </div>
  </div>
  {error&&<div className="error-toast" role="alert"><span>{error.replace(/^[A-Z_]+: /,"")}</span><button disabled={locked} onClick={()=>void job(t("Đang thử lại"),refresh)}>{t("Thử lại")}</button><button aria-label={t("Đóng thông báo lỗi")} onClick={()=>setError("")}><X size={14}/></button></div>}
  {view==="scene"&&!settingsOpen&&<div className="playback-bar"><button aria-label={t("Về đầu")} disabled={!source||locked} onClick={()=>{setTime(0);setPlaying(false);}}>↤</button><button aria-label={playing?t("Tạm dừng"):t("Phát mô phỏng")} disabled={!source||locked} onClick={()=>{if(time>=end)setTime(0);setPlaying(v=>!v);}}>{playing?"❚❚":"▶"}</button><button aria-label={t("Về cuối")} disabled={!source||locked} onClick={()=>{setTime(end);setPlaying(false);}}>↦</button><input aria-label={t("Thời gian mô phỏng")} type="range" min={0} max={end||1} step={.05} value={Math.min(time,end)} onChange={e=>{setTime(Number(e.target.value));setPlaying(false);}}/><output>{time.toFixed(2)} <span>/ {end.toFixed(2)}s</span></output></div>}
  <footer role="status" className="sr-only" aria-label={t("Trạng thái tác vụ")}><span>{message}</span><span>{settings?.version??""}</span></footer>
 </div></LanguageProvider>;
}
function ExpandButton({ panel, label, expanded, onChange }: { panel: Panel; label: string; expanded: Panel | null; onChange: (value: Panel | null) => void }) {
    const t = useT();
    const active = expanded === panel;
    return <button className="panel-expand" aria-pressed={active} aria-label={active ? t("Thu nhỏ {label}", { label: t(label) }) : t("Phóng to {label}", { label: t(label) })}
      title={active ? t("Thu nhỏ (Esc)") : t("Phóng to khung")} onClick={() => onChange(active ? null : panel)}>
      {active ? <Minimize2 size={14} aria-hidden/> : <Maximize2 size={14} aria-hidden/>}
    </button>;
}

/** Covers the views while a scene loads and builds, instead of a blank or white canvas. */
function LoadingOverlay() {
    const t = useT();
    return <div className="loading-overlay" role="status" aria-label={t("Đang tải dữ liệu")} data-testid="loading-overlay">
      <LoaderCircle size={36} className="spin" aria-hidden/>
      <span>{t("Đang tải dữ liệu")}</span>
    </div>;
}
