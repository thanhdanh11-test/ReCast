import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, LoaderCircle, Play, RotateCcw } from "lucide-react";
import { TacticalMap } from "../TacticalMap";
import { TrackView } from "../TrackView";
import { Real2simReport } from "../Real2simReport";
import { DEFAULT_PARAMS, KIND_LABEL, KINDS, BRAKE_LEVEL_LABEL, kindsOf, windowsOf, type Params } from "../reactive/model";
import { TYPE_BY_ID, newTemplate, type ScenarioType } from "../authoring/catalog";
import { TypeGallery } from "../authoring/TypeGallery";
import { KeyParams, TemplateForm } from "../authoring/TemplateForm";
import { MapFit } from "../authoring/MapFit";
import { TemplatePreview } from "../authoring/TemplatePreview";
import { validateTemplate, type ScenarioTemplate } from "../authoring/template";
import { ReactionParameters } from "../unified/ReactionParameters";
import { INTENTS, guidedCandidates, guidedOptions } from "../unified/guidance";
import { ScenarioMetricsView } from "../unified/ScenarioMetricsView";
import { initialParams, reactionChoice, type ComparisonPair } from "../unified/model";
import { useT } from "../i18n";
import { useScenarioSession, type Resource } from "./useScenarioSession";
import type { ReactNode } from "react";
import type { SceneEnvironmentSettings } from "../weather";
import type { Preferences } from "../preferences";
import { ScenarioTools } from "./ScenarioTools";
import { ReactiveDock } from "../reactive/ReactiveDock";
import type { DesktopAPI, ImportedEntry, ImportedScenario, Scenario, ScenarioGroup, ReactiveEvent } from "../types";
import type { EsminiCheck, ReactiveKind } from "../reactiveTypes";
import "../authoring/authoring.css";
import "../unified/unified.css";

const STEPS = ["Chọn xe", "Chọn tình huống", "Chỉnh tham số", "Xem kết quả", "Lưu / Xuất"];
type Step = 1 | 2 | 3 | 4 | 5;
type View = "pair" | "baseline" | "pilot" | "source";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const fmt = (value: number | null | undefined, digits = 1) => value == null ? "—" : value.toFixed(digits).replace(".", ",");


export function ScenarioWorkspace({ api, scene = "scene-0061", source: providedSource, active = true, environmentSettings, preferences, onBusyChange, onDirtyChange, externalBusy=false, scenes, onSelectScene }: {
  api: DesktopAPI; scenes?:string[]; onSelectScene?:(scene:string)=>Promise<Scenario>; externalBusy?:boolean; scene?: string; source?: Scenario | null; active?: boolean;
  environmentSettings?: SceneEnvironmentSettings; preferences?: Preferences; onBusyChange?: (busy:boolean)=>void; onDirtyChange?: (dirty:boolean)=>void;
}) {
  const SCENE = scene;
  const preserveTemplate=useRef(false),lastScene=useRef(scene);
  const t = useT();
  const session = useScenarioSession(api,scene,providedSource);
  const {source,offers,entries,groups,loading,refreshLibrary} = session;
  const [guided, setGuided] = useState(true);
  
  const [step, setStep] = useState<Step>(1);
  const [actorId, setActorId] = useState("");
  const [kind, setKind] = useState<ReactiveKind>("brake");
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [t0, setT0] = useState(0);
  const [template, setTemplate] = useState<ScenarioTemplate | null>(null);
  const [activeEntryId,setActiveEntryId]=useState<string|null>(null);
  const [artifact, setArtifact] = useState<ImportedScenario | null>(null);
  const [pair, setPair] = useState<ComparisonPair | null>(null);
  const pairs = useRef(new Map<string, ComparisonPair>());
  const [view, setView] = useState<View>("pair");
  const [camera, setCamera] = useState<"map" | "3d">("map");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [working, setBusy] = useState(false);
  const busy=working||externalBusy;
  const inFlight = useRef(false);
  const jobEpoch = useRef(0), alive = useRef(true);
  const [partialGroup,setPartialGroup] = useState<ScenarioGroup|null>(null);
  const [dockMetrics,setDockMetrics] = useState<Parameters<typeof ReactiveDock>[0]["metrics"]>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [esmini, setEsmini] = useState<EsminiCheck | null>(null);
  const selected = offers?.candidates.find(c => c.actor_id === actorId);
  const templateMode = actorId === "ego";
  const steps = templateMode ? ["Chọn cách tạo","Chọn mẫu","Điều chỉnh","Xem kết quả","Lưu / Xuất"] : guided ? ["Chọn tình huống","Xác nhận xe","Điều chỉnh","Xem kết quả","Lưu / Xuất"] : STEPS;
  const type = template ? TYPE_BY_ID.get(template.scenario_type) : undefined;
  const choice = reactionChoice(selected, kind, params, t0, source);
  useEffect(()=>{onDirtyChange?.(step===3&&!artifact);return()=>onDirtyChange?.(false);},[step,artifact?.id]);
  const resultMode = step >= 4 && !!artifact;
  const activeArtifact = pair ? view === "baseline" ? pair.baseline : pair.pilot : artifact;
  const shown = resultMode && view !== "source" ? activeArtifact : source;
  const end = shown?.interval_s[1] ?? 0;
  const report = activeArtifact?.report;
  const detail = report?.topeye;
  const current = entries.find(entry => entry.scenario_id === activeArtifact?.id);
  const isPair = resultMode && !!pair && view === "pair" && camera === "map";

  async function safeRefresh() { await Promise.allSettled([refreshLibrary(),session.refreshGroups()]); }
  async function checked<T>(promise:Promise<T>):Promise<T> { const epoch=jobEpoch.current; const value=await promise; if(!alive.current || epoch!==jobEpoch.current) throw new Error("CANCELLED"); return value; }
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;jobEpoch.current++;};},[]);
  useEffect(()=>{if(!active)setPlaying(false);},[active]);
  useEffect(()=>{onBusyChange?.(working);return()=>onBusyChange?.(false);},[working]);
  async function cancel() {jobEpoch.current++;inFlight.current=false;setBusy(false);setPlaying(false);setNotice(t("Đã huỷ tác vụ"));await api.cancelJob?.().catch(()=>{});void session.retry("source").catch(()=>{});void safeRefresh();}
  useEffect(() => {
    if (!active || !playing || !shown) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(), delta = (now - previous) / 1000 * (preferences?.playbackRate ?? 1); previous = now;
      setTime(value => { if (value + delta >= end) { if(preferences?.loop)return 0;setPlaying(false); return end; } return value + delta; });
    }, 50);
    return () => window.clearInterval(timer);
  }, [active, playing, shown?.id, end, preferences?.playbackRate, preferences?.loop]);

  function invalidate() { setArtifact(null); setActiveEntryId(null);setPair(null); setEsmini(null); setPlaying(false); setError(""); setNotice(""); }
  useEffect(()=>{if(lastScene.current===scene)return;lastScene.current=scene;invalidate();setTime(0);setPartialGroup(null);if(preserveTemplate.current){preserveTemplate.current=false;setStep(3);}else{setActorId("");setTemplate(null);setStep(1);}},[scene]);
  async function pickTemplateScene(value:string) {if(!onSelectScene)return;preserveTemplate.current=true;if(template)setTemplate({...template,map:{...template.map,scene:value}});await onSelectScene(value);}
  function switchMode(next: boolean) {
    if (busy || guided===next) return;
    setGuided(next);setPlaying(false);
    if(step<4 && !templateMode && selected)setStep(3);
  }
  function newMethod(method:"reaction"|"template") {
    if(busy)return;
    if(step===3 && !window.confirm(t("Bỏ bản thiết kế đang chỉnh để tạo mới?")))return;
    invalidate();setActorId(method==="template"?"ego":"");setTemplate(null);setTime(0);setStep(method==="template"?2:1);
    if(method==="template")setGuided(false);
  }
  function chooseIntent(next: ReactiveKind) {
    if (busy || !source || !offers) return;
    const candidate = guidedCandidates(offers.candidates, next, source)[0];
    if (!candidate) return;
    const option = guidedOptions(candidate, next, source)[0];
    invalidate(); setKind(next); setActorId(candidate.actor_id); setParams(option.params); setT0(option.time); setTime(0); setStep(2);
  }
  function pickActor(id: string) {
    if (busy || resultMode) return;
    const candidate = offers?.candidates.find(c => c.actor_id === id);
    if (guided) {
      if (step === 1) { setNotice("Chọn điều bạn muốn thử trước. App sẽ gợi ý xe phù hợp."); return; }
      if (!source || !candidate || !guidedCandidates([candidate], kind, source).length) { setNotice("Xe này chưa phù hợp với tình huống đã chọn và xe của bạn. Hãy chọn xe có viền vàng."); return; }
      const option = guidedOptions(candidate, kind, source)[0];
      invalidate(); setActorId(id); setParams(option.params); setT0(option.time); setStep(2); setTime(0); return;
    }
    if (id !== "ego" && id !== "" && !candidate) { setNotice("Đối tượng này chưa có sự kiện phản ứng hợp lệ. Chọn xe có viền vàng hoặc chọn ego để thiết kế từ mẫu."); return; }
    invalidate(); setActorId(id); setTemplate(null); setStep(1); setTime(0);
    if (candidate) { const next = kindsOf(candidate)[0] ?? "brake"; const defaults = initialParams(candidate, next); setKind(next); setParams(defaults); setT0(windowsOf(candidate, next, defaults)[0]?.[0] ?? 0); }
  }
  function pickKind(next: ReactiveKind) {
    if (busy) return;
    const defaults = selected ? initialParams(selected, next) : DEFAULT_PARAMS;
    invalidate(); setKind(next); setParams(defaults);
    setT0(selected ? windowsOf(selected, next, defaults)[0]?.[0] ?? 0 : 0); setStep(3);
  }
  function pickTemplate(next: ScenarioType) { if (busy) return; invalidate(); setTemplate(newTemplate(next, SCENE, next.name)); setStep(3); }
  function go(next: Step) {
    if (busy) return;
    if (next < 4 && resultMode) invalidate();
    setStep(next); setPlaying(false);
  }
  async function work(action: () => Promise<void>) {
    if (inFlight.current || externalBusy) return;
    const epoch=++jobEpoch.current;
    inFlight.current = true; setBusy(true); setError(""); setNotice(""); setPlaying(false);
    try { await action(); } catch (e) { if(alive.current && epoch===jobEpoch.current){setError(message(e));setNotice("");} }
    finally { if(alive.current && epoch===jobEpoch.current){inFlight.current=false;setBusy(false);} }
  }
  function showResult(result: ImportedScenario, comparison: ComparisonPair | null = null) {
    setArtifact(result);setActiveEntryId(result.id); setPair(comparison); setStep(4); setTime(0); setView(comparison ? "pair" : "pilot"); setCamera("map"); setEsmini(null);
  }
  function simulate() {
    if (!source || !session.canCreate) return;
    if (templateMode) {
      if (!template) return;
      const issues=validateTemplate(template);
      if(issues.length){setError(issues.map(i=>t(i.message,i.vars)).join(" · "));return;}
      void work(async()=>{const result=await checked(session.sourceAction(source_id=>api.importTemplate({source_id,template})));showResult(result);await safeRefresh();});
    } else if(choice.event) void createPair(choice.event);
  }
  async function createPair(event:ReactiveEvent, resume?:ScenarioGroup) {
    if(!source || !session.canCreate)return;
    await work(async()=>{
      let baseline:ImportedScenario|null=null,pilot:ImportedScenario|null=null;
      const {react: _react,...frozen}=event;
      let group:ScenarioGroup=resume??{schema_version:1,id:crypto.randomUUID().replaceAll("-",""),scene:SCENE,map_id:session.mapId!,event:frozen,baseline_id:null,pilot_id:null,created_at:new Date().toISOString()};
      try {
        if(resume?.baseline_id){const entry=entries.find(e=>e.scenario_id===resume.baseline_id);if(!entry)throw new Error(t("Không tìm thấy baseline đã lưu"));baseline=await checked(session.sourceAction(source_id=>api.openImported({source_id,path:entry.package_path})));}
        else {setNotice(t("Đang tạo baseline…"));baseline=await checked(session.sourceAction(source_id=>api.importReactive({source_id,event:{...event,react:false}})));}
        if(!baseline)throw new Error(t("Không mở được baseline"));
        group={...group,map_id:baseline.map_id,baseline_id:baseline.id};
        if(api.recordScenarioGroup)await checked(api.recordScenarioGroup({group}));
        setPartialGroup(group);
        setNotice(t("Đang tạo pilot với cùng sự kiện…"));
        pilot=await checked(session.sourceAction(source_id=>api.importReactive({source_id,event:{...event,react:true}})));
        group={...group,pilot_id:pilot.id};
        if(api.recordScenarioGroup)await checked(api.recordScenarioGroup({group}));
        const comparison={baseline,pilot};pairs.current.set(baseline.id,comparison);pairs.current.set(pilot.id,comparison);
        setPartialGroup(null);showResult(pilot,comparison);setNotice(t("Đã tạo hai quỹ đạo thật. Kéo thời gian để so sánh."));
      } catch(e) {
        if(String(e).includes("CANCELLED"))throw e;
        if(baseline){showResult(pilot??baseline,pilot?{baseline,pilot}:null);setPartialGroup(group);}
        if(baseline&&pilot)throw new Error(t("Hai gói đã được lưu; chưa lưu được liên kết. Baseline: {baseline}; pilot: {pilot}.",{baseline:baseline.id,pilot:pilot.id})+" "+message(e));
        throw new Error(`${baseline? t("Baseline đã được lưu; pilot chưa hoàn tất. ID: {id}",{id:baseline.id})+" ":""}${message(e)}`);
      } finally {await safeRefresh();}
    });
  }
  function importXosc() {
    if (!source) return;
    void work(async () => { const result = await checked(session.sourceAction(source_id=>api.importXosc({source_id}))); if (result) { showResult(result); await safeRefresh(); } });
  }
  function openEntry(entry: ImportedEntry) {
    if(!source)return;
    void work(async()=>{
      const result=await checked(session.sourceAction(source_id=>api.openImported({source_id,path:entry.package_path})));
      setPartialGroup(null);
      if(!result)throw new Error(t("Không mở được gói đã chọn."));
      const group=groups.find(g=>g.baseline_id===entry.scenario_id||g.pilot_id===entry.scenario_id);
      if(group?.baseline_id&&group.pilot_id){
        const b=entries.find(e=>e.scenario_id===group.baseline_id),p=entries.find(e=>e.scenario_id===group.pilot_id);
        if(b&&p){const baseline=entry.scenario_id===b.scenario_id?result:await checked(session.sourceAction(source_id=>api.openImported({source_id,path:b.package_path})));const pilot=entry.scenario_id===p.scenario_id?result:await checked(session.sourceAction(source_id=>api.openImported({source_id,path:p.package_path})));if(baseline&&pilot){showResult(pilot,{baseline,pilot});return;}}
      }
      setPartialGroup(group?.baseline_id&&!group.pilot_id?group:null);showResult(result,group?null:pairs.current.get(result.id)??null);setActiveEntryId(entry.scenario_id);
    });
  }
  function download(result: ImportedScenario, label = "") {
    void work(async () => {
      const doc = await checked(api.readImported({ scenario_id: result.id }));
      const url = URL.createObjectURL(new Blob([doc.xml], { type: "application/xml" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: `${label ? label + "-" : ""}${doc.file_name}` });
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Đã xuất tệp OpenSCENARIO.");
    });
  }
  function presetLabel(option:ReturnType<typeof guidedOptions>[number]) {
    const p=option.params;
    if(kind==='brake')return t("Phanh {level} · {a} m/s²",{level:t(BRAKE_LEVEL_LABEL[p.decel]??String(p.decel)),a:p.decel});
    if(kind==='accelerate')return t("Tăng tốc · {a} m/s²",{a:p.accel});
    if(kind==='stopline')return p.dwell?t("Dừng {n} giây",{n:p.dwell}):t("Dừng rồi đi ngay");
    return t("Sang {side} trong {n} giây",{side:t(p.direction==='left'?"Trái":"Phải"),n:p.duration});
  }
  function renderTools():ReactNode {return <ScenarioTools api={api} active={active} scenes={scenes??[SCENE]} onSelectScene={onSelectScene} source={source} sourceAction={session.sourceAction} entries={entries} groups={groups} artifact={activeArtifact} activeId={activeEntryId} checked={checked} onClear={()=>{pairs.current.clear();invalidate();}} onStatus={setNotice} busy={busy} time={time} end={end} onSeek={value=>{setTime(value);setPlaying(false);}} onSelect={openEntry} onResult={showResult} onWork={work} refresh={safeRefresh} environmentSettings={environmentSettings} scene={SCENE} canCreate={session.canCreate} onReaction={()=>newMethod("reaction")} onCreatePair={createPair} dockMetrics={dockMetrics} setDockMetrics={setDockMetrics} offers={offers} kind={kind} fill={(id,k,p,start)=>{setActorId(id);setKind(k);setParams(p);setT0(start);setStep(3);setPlaying(false);}}/>;}
  const draw = (scene: Scenario | null, pick = false) => camera === "map"
    ? <TacticalMap scenario={scene} replay={null} time={time} onPickActor={pick && !busy ? pickActor : undefined} selectedActorId={actorId} eligibleActorIds={pick ? (guided && source ? guidedCandidates(offers?.candidates ?? [], kind, source) : offers?.candidates)?.map(c => c.actor_id) : undefined}/>
    : <TrackView scenario={scene} replay={null} time={time} active={active} display={preferences} environmentSettings={environmentSettings}/>;
  const artifactLabel = activeArtifact?.report?.drivers ? activeArtifact.report.drivers.react ? t("Pilot · có phản ứng") : t("Baseline · không phản ứng") : t("Kịch bản OpenSCENARIO");

  return <main className={`unified-demo scenario-workspace ud-guided ${guided && step < 4 ? "ud-beginner-authoring" : ""}`}>
    <header className="ud-head"><div><span className="ud-kicker">TOPEYE / SCENARIO</span><h1>{t("Kịch bản")}</h1></div><span className="ud-scene">{SCENE}</span></header>
    <div className="sw-actions"><button disabled={busy} onClick={()=>newMethod("reaction")}>{t("Thử phản ứng")}</button><button disabled={busy||!session.canCreate} onClick={()=>newMethod("template")}>{t("Tạo từ mẫu")}</button><button disabled={busy||!session.canCreate} onClick={importXosc}>{t("Nạp tệp .xosc")}</button><button disabled={busy} onClick={()=>void safeRefresh()}>{t("Làm mới thư viện")}</button></div>
    <div className="ud-mode"><div role="group" aria-label={t("Chế độ sử dụng")}><button disabled={busy} aria-pressed={guided} onClick={() => switchMode(true)}>{t("Có hướng dẫn")}</button><button disabled={busy} aria-pressed={!guided} onClick={() => switchMode(false)}>{t("Chi tiết")}</button></div><span>{guided ? t("Bắt đầu bằng điều bạn muốn thử. Không cần biết thông số kỹ thuật.") : t("Toàn bộ xe, 20 mẫu và tham số.")}</span></div>
    <nav className="ud-flow" aria-label={t("Luồng kịch bản")}>{steps.map((label, i) => <button key={label} aria-current={step === i + 1 ? "step" : undefined} disabled={busy || i + 1 > step} onClick={() => go(i + 1 as Step)}><b>{i + 1 < step ? <Check size={15}/> : `0${i + 1}`}</b>{t(label)}</button>)}</nav>
    {loading && <div className="ud-message" role="status"><LoaderCircle className="ud-spin" size={16}/>{t("Đang nạp xe và các tình huống phù hợp…")}</div>}
    {Object.entries(session.errors).filter(([,v])=>v).map(([key,value])=><div key={key} className="ud-message ud-error" role="alert"><strong>{t(key==="map"?t("Map chưa hỗ trợ tạo kịch bản"):key==="library"?t("Không đọc được thư viện"):key==="groups"?t("Không đọc được nhóm so sánh"):t("Không tải được dữ liệu"))}</strong><span>{value}</span><button onClick={()=>void session.retry(key as Resource).catch(()=>{})}>{t("Thử lại")}</button></div>)}
    {error && <div className="ud-message ud-error" role="alert">{error}<button onClick={()=>setError("")}>{t("Đóng")}</button></div>}
    {busy && <button className="sw-cancel" onClick={()=>void cancel()}>{t("Huỷ tác vụ")}</button>}
    {notice && <div className="ud-message" role="status">{notice}</div>}
    <div className="ud-layout">
      <section className="ud-main" aria-label={t("Cảnh và kết quả")}>
        <div className="ud-stage-head"><div><small>{resultMode ? t("QUỸ ĐẠO ĐÃ TẠO") : t("CẢNH NGUỒN · DỮ LIỆU THẬT")}</small><strong>{resultMode ? isPair ? t("Cùng sự kiện. Hai cách phản ứng.") : view === "source" ? t("Bản ghi nguồn") : artifactLabel : templateMode ? t("Thiết kế tình huống quanh ego") : selected ? `Xe gây sự kiện: ${selected.name}` : guided ? t("Xe màu đỏ là xe của bạn") : t("Bấm xe trên bản đồ để bắt đầu")}</strong></div>
          <div className="ud-switch" role="group" aria-label={t("Cách xem")}><button disabled={busy} aria-pressed={camera === "map"} onClick={() => setCamera("map")}>{t("Bản đồ")}</button><button disabled={busy} aria-pressed={camera === "3d"} onClick={() => { setCamera("3d"); setEsmini(null); if (view === "pair") setView("pilot"); }}>3D</button></div></div>
        {resultMode && <div className="ud-view-tabs" role="group" aria-label={t("Biến thể phát lại")}>{pair && <><button disabled={busy} aria-pressed={view === "pair"} onClick={() => { setView("pair"); setCamera("map"); setEsmini(null); }}>{t("Đặt cạnh nhau")}</button><button disabled={busy} aria-pressed={view === "baseline"} onClick={() => { setView("baseline"); setEsmini(null); }}>{guided ? t("Không bật phản ứng") : "Baseline"}</button></>}<button disabled={busy} aria-pressed={view === "pilot"} onClick={() => { setView("pilot"); setEsmini(null); }}>{pair ? guided ? t("Có bật phản ứng") : "Pilot" : t("Kết quả")}</button><button disabled={busy} aria-pressed={view === "source"} onClick={() => { setView("source"); setEsmini(null); }}>{t("Bản ghi nguồn")}</button></div>}
        {step === 2 && templateMode ? <div className="ud-gallery"><TypeGallery scene={SCENE} onPick={pickTemplate}/></div>
        : <div className={`ud-stage ${isPair ? "ud-pair" : ""}`}>
          {isPair && pair ? <>{(["baseline", "pilot"] as const).map(variant => <section key={variant} aria-label={`Phát lại ${variant}`}><header>{variant === "baseline" ? t("Không bật phản ứng · Baseline") : t("Có bật phản ứng · Pilot")}</header>{draw(pair[variant])}</section>)}</> : draw(shown, !resultMode)}
          {!resultMode && <div className="ud-map-hint">{t("Đỏ: xe của bạn · viền vàng: xe tạo tình huống có thể chọn · cuộn để phóng to")}</div>}
        </div>}
        {!(step === 2 && templateMode) && <div className="ud-playback"><button disabled={!shown || busy} onClick={() => { setPlaying(false); setTime(0); }} aria-label={t("Về đầu")}><RotateCcw size={16}/></button><button disabled={!shown || busy} onClick={() => { if (time >= end) setTime(0); setPlaying(!playing); }}><Play size={16}/>{playing ? t("Tạm dừng") : t("Phát")}</button><input aria-label={t("Thời gian")} type="range" min={0} max={end || 1} step={0.05} value={Math.min(time, end)} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }}/><output>{fmt(time, 2)} / {fmt(end, 2)} s</output></div>}
        {resultMode && detail && <ScenarioMetricsView detail={detail} reactionSeconds={report?.drivers?.reaction_s??undefined} />}
        {resultMode && !detail && <p className="ud-context">{t("Kịch bản từ mẫu hoặc tệp có quỹ đạo để phát lại. Chưa có mô phỏng phản ứng baseline/pilot cho nhánh này.")}</p>}
        {resultMode && detail && !pair && <p className="ud-context">{t("Đang mở một gói")}{artifactLabel.toLowerCase()}{t(". Báo cáo có hai bộ số đo; quỹ đạo của gói còn lại chưa được mở trong phiên này.")}</p>}
      </section>
      <aside className="ud-side">
        <section className="ud-panel">
          <div className="ud-panel-head"><small>{t("BƯỚC 0")}{step} / 05</small><h2>{t(steps[step - 1])}</h2></div>
          {guided && step === 1 && <>
            <p className="ud-context">{t("Bạn muốn thử điều gì? App sẽ tìm xe phía trước phù hợp trong cảnh thật.")}</p>
            <div className="ud-kind ud-intents">{KINDS.map(value => {
              const available = source && guidedCandidates(offers?.candidates ?? [], value, source).length > 0;
              return <button key={value} disabled={busy || loading || !available || !session.canCreate} onClick={() => chooseIntent(value)}><strong>{t(INTENTS[value].title)}</strong><span>{t(INTENTS[value].description)}</span>{!loading && !available && <small>{t("Chưa có xe phù hợp trong cảnh này")}</small>}</button>;
            })}</div><p className="ud-context">{t("Muốn tự thiết kế xe của mình hoặc dùng 20 mẫu? Chọn Chi tiết phía trên.")}</p>
          </>}
          {guided && !templateMode && step === 2 && <>
            <div className="ud-role"><strong>{t("Xe của bạn: màu đỏ trên bản đồ")}</strong><p>{t("App đã gợi ý")}{selected?.name}{t("làm xe tạo tình huống vì xe của bạn nằm trong nhóm theo sau.")}</p></div>
            <p className="ud-context">{t(INTENTS[kind].title)}{t(". Giữ xe được gợi ý hoặc bấm một xe viền vàng để đổi.")}</p>
            <label>{t("Xe tạo tình huống")}<select aria-label={t("Xe tạo tình huống")} disabled={busy} value={actorId} onChange={e => pickActor(e.target.value)}>{source && guidedCandidates(offers?.candidates ?? [], kind, source).map(c => <option key={c.actor_id} value={c.actor_id}>{c.name}</option>)}</select></label>
            <button className="ud-primary" disabled={busy || !selected} onClick={() => go(3)}>{t("Dùng xe này")}<ArrowRight size={16}/></button>
          </>}
          {!guided && step === 1 && <>
            <p className="ud-context">{t("Chọn xe để xác định vai trò trong tình huống.")}</p>
            <button className={`ud-ego-choice ${templateMode ? "selected" : ""}`} onClick={() => pickActor("ego")} disabled={busy || !source}><strong>{t("Xe của tôi · ego")}</strong><span>{t("Thiết kế quỹ đạo bằng 20 mẫu tình huống")}</span></button>
            <label>{t("Xe gây sự kiện")}<select aria-label={t("Xe gây sự kiện")} disabled={busy || !offers} value={selected?.actor_id ?? ""} onChange={e => pickActor(e.target.value)}><option value="">{t("Chọn trực tiếp trên map hoặc tại đây")}</option>{offers?.candidates.slice().sort((a, b) => Number(b.followers.includes("ego")) - Number(a.followers.includes("ego"))).map(c => <option key={c.actor_id} value={c.actor_id}>{c.name} · {c.followers.includes("ego") ? t("ego theo sau") : `${c.followers.length} xe theo sau`}</option>)}</select></label>
            <div className="ud-role" role="status"><strong>{templateMode ? t("Đã chọn ego để thiết kế") : selected ? `Đã chọn ${selected.name}` : t("Chưa chọn xe")}</strong><p>{templateMode ? t("Mẫu tạo các xe và quỹ đạo mới trên map nguồn. Bạn có thể chỉnh vận tốc, lộ trình và hành động của ego; bản ghi gốc được giữ nguyên.") : selected ? t("Xe này gây sự kiện. Ego và các xe theo sau có thể phản ứng trong pilot; baseline giữ chuyển động danh định của các xe còn lại.") : t("Chọn xe giao thông để thử phản ứng, hoặc ego để thiết kế từ mẫu.")}</p></div>
            <button className="ud-primary" disabled={!actorId || loading || busy} onClick={() => go(2)}>{t("Tiếp: chọn tình huống")}<ArrowRight size={16}/></button>
          </>}
          {(templateMode || !guided) && step === 2 && <>
            <p className="ud-context">{templateMode ? t("Chọn một trong 20 mẫu ở bên trái. Khả năng đặt lên map sẽ được kiểm tra khi tạo.") : `${selected?.name} có những sự kiện dưới đây. Các loại mờ chưa đủ điều kiện trong cảnh này.`}</p>
            {!templateMode && <div className="ud-kind" role="group" aria-label={t("Các tình huống")}>{KINDS.map(value => <button key={value} aria-label={t(KIND_LABEL[value])} disabled={busy || !kindsOf(selected).includes(value)} onClick={() => pickKind(value)}><strong>{t(KIND_LABEL[value])}</strong><span>{value === "brake" ? t("Dừng hẳn hoặc giảm tốc") : value === "accelerate" ? t("Đạt vận tốc mục tiêu") : value === "stopline" ? t("Dừng theo vạch trên map") : t("Di chuyển sang làn bên cạnh")}</span></button>)}</div>}
          </>}
          {step === 3 && <>
            <div className="ud-event"><span>{templateMode ? t("MẪU THIẾT KẾ") : selected?.name}</span><strong>{templateMode ? type?.name : KIND_LABEL[kind]}</strong></div>
            {templateMode && template && type ? <fieldset disabled={busy} className="ud-template-form ud-fields"><KeyParams template={template} type={type} set={setTemplate}/><details><summary>{t("Quỹ đạo, hành động và tham số nâng cao")}</summary><TemplateForm template={template} set={setTemplate} scenes={[SCENE]}/></details>{api.templateFit&&<MapFit template={template} scenes={scenes??[SCENE]} scene={SCENE} probe={(scene,template)=>api.templateFit({scene,template})} onPick={value=>void pickTemplateScene(value).catch(e=>setError(message(e)))}/>}<div className="ud-schematic"><TemplatePreview template={template} layout={type.layout}/><small>{t("Sơ đồ minh hoạ; chưa đặt lên map thật.")}</small></div></fieldset>
               : selected && source && <>
                {guided && <fieldset disabled={busy} className="ud-fields"><label>{t("Cách xảy ra")}<select aria-label={t("Cách xảy ra")} value={guidedOptions(selected, kind, source).findIndex(o => JSON.stringify(o.params) === JSON.stringify(params))} onChange={e => { const option = guidedOptions(selected, kind, source)[Number(e.target.value)]; if (option) { setParams(option.params); setT0(option.time); } }}><option value={-1} disabled>{t("Đã tùy chỉnh thông số")}</option>{guidedOptions(selected, kind, source).map((o, i) => <option key={o.label} value={i}>{presetLabel(o)}</option>)}</select></label><label>{t("Xảy ra lúc")}<select aria-label={t("Xảy ra lúc")} value={choice.chosenTime} onChange={e => setT0(Number(e.target.value))}>{choice.availableTimes.map(seconds => <option key={seconds} value={seconds}>{t("Giây")} {fmt(seconds)}</option>)}</select></label><p className="ud-context">{t("Xe của bạn phản ứng sau")} {fmt(params.reaction)} {t("giây.")} {kind === "brake" ? params.goal === "half" ? t("Xe trước giảm tốc một nửa.") : t("Xe trước phanh đến khi dừng.") : t(INTENTS[kind].description)}</p></fieldset>}
                <details open={guided ? undefined : true} className="ud-report"><summary>{t("Thông số chi tiết")}</summary><ReactionParameters selected={selected} source={source} kind={kind} params={params} setParams={setParams} t0={t0} setT0={setT0} busy={busy}/></details>
                {!choice.event && <p role="status">{t("Thông số chưa phù hợp. Chọn lại một cách xảy ra ở trên hoặc đổi xe.")}</p>}
              </>}
            <p className="ud-context">{templateMode ? t("Tạo quỹ đạo và kiểm tra vị trí trên map. Kết quả được tự lưu.") : t("So sánh cùng tình huống khi không bật và có bật phản ứng. Hai kết quả được tự lưu để bạn xem lại.")}</p>
            <button className="ud-primary" disabled={busy || !session.canCreate || (templateMode ? !template : !choice.event)} onClick={simulate}>{busy ? <LoaderCircle className="ud-spin" size={16}/> : <Play size={16}/>} {templateMode ? t("Tạo kịch bản trên map") : guided ? t("Xem xe của tôi phản ứng") : t("Chạy baseline và pilot")}</button>
          </>}
          {step === 4 && artifact && <>
            {partialGroup && <button disabled={busy||!session.canCreate} onClick={()=>void (partialGroup.pilot_id?work(async()=>{if(api.recordScenarioGroup)await checked(api.recordScenarioGroup({group:partialGroup}));setPartialGroup(null);await safeRefresh();}):createPair({...partialGroup.event,react:true} as ReactiveEvent,partialGroup))}>{t(partialGroup.pilot_id?"Lưu lại liên kết hai gói":"Thử lại pilot đã thiếu")}</button>}
            <p className="ud-context">{pair ? t("Hai khung dùng cùng thời gian. Bấm Phát hoặc kéo thanh thời gian để xem ego và các xe thay đổi phản ứng.") : t("Phát lại quỹ đạo đã tạo và kiểm tra kết quả trước khi xuất.")}</p>
            <div className="ud-role"><strong>{pair ? t("2 biến thể · 1 sự kiện") : artifactLabel}</strong><p>{current?.name ?? artifact.id.slice(0, 12)} · {activeArtifact?.actors.length} {t("đối tượng")}</p><p>{report?.valid === false ? t("Báo cáo đánh dấu không hợp lệ. Xem lý do trước khi dùng.") : report?.valid === true ? t("Đạt các kiểm tra có trong báo cáo; esmini xem riêng ở dưới.") : t("Đã qua cổng kiểm tra khi nạp.")}</p></div>
            {report && activeArtifact && <details className="ud-report"><summary>{t("Báo cáo của")} {artifactLabel.toLowerCase()}</summary><Real2simReport report={report} diagnostics={activeArtifact.import.diagnostics} esmini={esmini} onEsminiCheck={() => void work(async () => setEsmini(await checked(api.esminiCheck({ scenario_id: activeArtifact.id }))))}/></details>}
            <button className="ud-primary" disabled={busy} onClick={() => go(5)}>{t("Tiếp: lưu và xuất")}<ArrowRight size={16}/></button>
            <button className="ud-secondary" disabled={busy} onClick={() => go(1)}>{t("Thiết kế tình huống khác")}</button>
          </>}
          {step === 5 && artifact && <>
            <div className="ud-saved"><Check size={24}/><strong>{t("Đã tự lưu vào thư viện")}</strong><p>{pair ? t("Cả baseline và pilot đã được lưu thành hai gói riêng khi mô phỏng.") : t("Gói kịch bản đã được lưu khi tạo hoặc nạp.")}</p></div>
            {pair ? <><button className="ud-primary" disabled={busy} onClick={() => download(pair.pilot, "pilot")}><Download size={16}/>{t("Xuất pilot .xosc")}</button><button className="ud-secondary" disabled={busy} onClick={() => download(pair.baseline, "baseline")}><Download size={16}/>{t("Xuất baseline .xosc")}</button></> : <button className="ud-primary" disabled={busy} onClick={() => download(artifact)}><Download size={16}/>{t("Xuất .xosc")}</button>}
            <button className="ud-secondary" disabled={busy} onClick={() => go(1)}>{t("Tạo tình huống mới")}</button>
          </>}
          {step > 1 && step < 4 && <button className="ud-secondary" disabled={busy} onClick={() => go(step - 1 as Step)}><ArrowLeft size={14}/>{t("Quay lại")}</button>}
        </section>

      </aside>
    </div>
    {renderTools()}
  </main>;
}
