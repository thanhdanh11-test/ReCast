import {useEffect,useRef,useState,type Dispatch,type SetStateAction} from "react";
import {ScenarioRunner} from "../ScenarioRunner";
import {ReactiveDock} from "../reactive/ReactiveDock";
import {type Params} from "../reactive/model";
import {SceneTechnical} from "./SceneTechnical";
import {useT} from "../i18n";
import {environmentSettingsFor,type SceneEnvironmentSettings} from "../weather";
import type {DesktopAPI,ImportedEntry,ImportedScenario,ReactiveCandidates,ReactiveEvent,Scenario,ScenarioGroup} from "../types";
import type {ReactiveKind,ReactiveSensitivity,EsminiCheck} from "../reactiveTypes";
import type {MetricsState} from "../MetricsPanel";
type DockMetrics=Parameters<typeof ReactiveDock>[0]['metrics'];
export function ScenarioTools(p:{api:DesktopAPI;active:boolean;scenes:string[];onSelectScene?:(scene:string)=>Promise<Scenario>;sourceAction:<T>(operation:(id:string)=>Promise<T>)=>Promise<T>;source:Scenario|null;entries:ImportedEntry[];groups:ScenarioGroup[];artifact:ImportedScenario|null;activeId:string|null;checked:<T>(request:Promise<T>)=>Promise<T>;onClear:()=>void;onStatus:(message:string)=>void;busy:boolean;time:number;end:number;scene:string;canCreate:boolean;environmentSettings?:SceneEnvironmentSettings;onSeek:(t:number)=>void;onSelect:(e:ImportedEntry)=>void;onResult:(s:ImportedScenario)=>void;onWork:(action:()=>Promise<void>)=>Promise<void>;refresh:()=>Promise<void>;onReaction:()=>void;onCreatePair:(event:ReactiveEvent)=>Promise<void>;offers:ReactiveCandidates|null;kind:ReactiveKind;dockMetrics:DockMetrics;setDockMetrics:Dispatch<SetStateAction<DockMetrics>>;fill:(id:string,kind:ReactiveKind,params:Params,start:number)=>void;}) {
 const t=useT(),api=p.api;
 const [metrics,setMetrics]=useState<MetricsState|null>(null),[esmini,setEsmini]=useState<EsminiCheck|null>(null);
 const metricCache=useRef(new Map<string,MetricsState>()),mounted=useRef(true),selectedId=useRef(p.artifact?.id);selectedId.current=p.artifact?.id;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{setEsmini(null);},[p.artifact?.id]);
 useEffect(()=>{
  if(!p.artifact||p.artifact.kind==='real2sim'||!api.scenarioMetrics){setMetrics(null);return;}
  const key=p.artifact.id,cached=metricCache.current.get(key);setMetrics(cached??null);
  if(!p.active||(cached&&cached.status!=='error'))return;
  const loading:MetricsState={key,status:'loading'};metricCache.current.set(key,loading);setMetrics(loading);
  void api.scenarioMetrics({scenario_id:key}).then(data=>{const value:MetricsState={key,status:'ready',data};metricCache.current.set(key,value);if(mounted.current&&selectedId.current===key)setMetrics(value);},e=>{const value:MetricsState={key,status:'error',error:e instanceof Error?e.message:String(e)};metricCache.current.set(key,value);if(mounted.current&&selectedId.current===key)setMetrics(value);});
 },[p.artifact?.id,p.active]);
 async function perform(action:()=>Promise<void>):Promise<boolean> {let ok=false;await p.onWork(async()=>{await action();ok=true;});return ok;}
 const sourceId=()=>{if(!p.source)throw new Error(t('Chưa có dữ liệu'));return p.source.id;};
 const accept=async(s:ImportedScenario|null)=>{if(s){p.onResult(s);p.onStatus(t("Đã nạp OpenSCENARIO · {n} đối tượng · đúng map hiện tại",{n:s.actors.length}));}else p.onStatus(t("Đã đóng hộp chọn · giữ nguyên cảnh đang xem."));await p.refresh();};
 async function importPackage(){if(!p.canCreate)return false;const files=await api.pickPackage();if(!files)return false;const src=files.scene&&files.scene!==p.scene&&p.onSelectScene?await p.onSelectScene(files.scene):p.source;if(!src)return false;return perform(async()=>{const s=await p.checked(api.importPackage({source_id:src.id,files:files.files}));p.onResult(s);p.onStatus(t("Đã nạp gói real2sim · {n} đối tượng · {notes} ghi chú map.",{n:s.actors.length,notes:s.import.diagnostics.length}));await p.refresh();});}
 async function sensitivity():Promise<ReactiveSensitivity> {
  const e=p.artifact?.report?.event,c=p.offers?.candidates.find(c=>c.name===e?.actor);
  if(!e||!c||e.decel==null||e.t0==null||(e.target!=='stop'&&e.target!=='half'))throw new Error(t('Gói không có sự kiện phanh để chạy lại'));
  return api.reactiveSensitivity({source_id:sourceId(),event:{actor_id:c.actor_id,t0_s:e.t0,decel_mps2:e.decel,target:e.target,dwell_s:e.dwell??0,react:true,reaction_s:p.artifact?.report?.drivers?.reaction_s??1}});
 }
 const check=()=>void p.onWork(async()=>{if(p.artifact)setEsmini(await p.checked(api.esminiCheck({scenario_id:p.artifact.id})));});
 return <section className="sw-tools" aria-label={t('Công cụ kịch bản')}>
  <ScenarioRunner embedded groups={p.groups} active={false} entries={p.entries} activeId={p.activeId} busy={p.busy} metrics={metrics} scenes={p.scenes} onSceneChange={p.onSelectScene?value=>{void p.onSelectScene!(value).catch(e=>p.onStatus(String(e)));}:undefined} currentScene={p.scene} scenario={p.artifact} replay={null} time={p.time} environmentSettings={p.environmentSettings??environmentSettingsFor('ClearNoon','auto')} playback={null} duration={p.end} onSeek={p.onSeek} loading={null} onSceneReady={()=>{}} onSelect={p.onSelect}
   canCreate={p.canCreate} onOpenReactive={p.onReaction}
   onCreate={async()=>{if(!p.canCreate)return false;let created=false;await perform(async()=>{const s=await p.checked(p.sourceAction(source_id=>api.importXosc({source_id})));created=!!s;await accept(s);});return created;}}
   onImportPackage={importPackage}
   onCreateTemplate={template=>p.canCreate?perform(async()=>accept(await p.checked(p.sourceAction(source_id=>api.importTemplate({source_id,template}))))):Promise.resolve(false)}
   onFitTemplate={api.templateFit?(scene,template)=>api.templateFit({scene,template}):undefined}
   onMapStatus={api.mapStatus}
   onExportMap={()=>p.onWork(async()=>{const result=await p.checked(api.exportMapContext({source_id:sourceId()}));if(result)p.onStatus(t("Đã xuất thông tin map: {path}.",{path:result.path}));})}
   onExport={entry=>void p.onWork(async()=>{const doc=await p.checked(api.readImported({scenario_id:entry.scenario_id}));const url=URL.createObjectURL(new Blob([doc.xml],{type:'application/xml'}));const link=Object.assign(document.createElement('a'),{href:url,download:doc.file_name});link.click();p.onStatus(t("Đã xuất {name} (thư mục Tải về)",{name:entry.name}));setTimeout(()=>URL.revokeObjectURL(url),1000);})}
   onDelete={entry=>{if(window.confirm(t('Xoá kịch bản “{name}”? Gói và lịch sử chạy được chuyển vào thư mục .trash trong thư mục lưu.',{name:entry.name})))void p.onWork(async()=>{await p.checked(api.deleteImported({scenario_id:entry.scenario_id}));if(entry.scenario_id===p.activeId||p.groups.some(g=>(g.baseline_id===p.activeId||g.pilot_id===p.activeId)&&(g.baseline_id===entry.scenario_id||g.pilot_id===entry.scenario_id)))p.onClear();p.onStatus(t("Đã xoá {name}",{name:entry.name}));await p.refresh();});}}
   onDeleteRun={(entry,runId)=>{if(window.confirm(t('Xoá lần chạy này khỏi lịch sử? Kịch bản được giữ nguyên; kết quả chuyển vào .trash.')))void p.onWork(async()=>{await p.checked(api.deleteImportedRun({scenario_id:entry.scenario_id,run_id:runId}));await p.refresh();});}}
   onLoadXml={async entry=>{let doc:Awaited<ReturnType<DesktopAPI['readImported']>>|undefined;await p.onWork(async()=>{doc=await p.checked(api.readImported({scenario_id:entry.scenario_id}));});return doc;}}
   onSaveEdit={(entry,name,xml)=>perform(async()=>{const s=await p.checked(p.sourceAction(source_id=>api.importXosc({source_id,xml,file_name:name})));if(s){p.onResult(s);await p.checked(api.deleteImported({scenario_id:entry.scenario_id}));}await p.refresh();})}
   onSaveTemplateEdit={(entry,template)=>perform(async()=>{const s=await p.checked(p.sourceAction(source_id=>api.importTemplate({source_id,template})));p.onResult(s);await p.checked(api.deleteImported({scenario_id:entry.scenario_id}));p.onStatus(t("Đã xoá {name}",{name:entry.name}));await p.refresh();})}
   onSensitivity={p.artifact?.report?.topeye?sensitivity:undefined} esmini={esmini} onEsminiCheck={p.artifact?.kind==='real2sim'?check:undefined}/>
  <SceneTechnical api={api} scene={p.scene} kind={p.kind} busy={p.busy} artifact={p.artifact} offers={p.offers} esmini={esmini} onEsminiCheck={check} onSeek={p.onSeek} fill={p.fill} onCreatePair={p.onCreatePair} dockMetrics={p.dockMetrics} setDockMetrics={p.setDockMetrics}/>
 </section>;
}
