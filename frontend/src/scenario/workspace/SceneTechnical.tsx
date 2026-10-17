import {useEffect,useRef,useState,type Dispatch,type SetStateAction} from "react";
import {ReactiveDock} from "../reactive/ReactiveDock";
import {DEFAULT_PARAMS,goalOf,type Params} from "../reactive/model";
import {paramsOf} from "../reactive/kindMetrics";
import {useT} from "../i18n";
import type {DesktopAPI,ImportedScenario,ReactiveCandidates,ReactiveEvent} from "../types";
import type {ReactiveKind,EsminiCheck} from "../reactiveTypes";
type DockMetrics=Parameters<typeof ReactiveDock>[0]['metrics'];
/** Scene metrics and reaction analysis of the loaded scene (collapsed; loads on demand). Shared by the
 * workspace tools and the Studio "Tự tạo" overlay (plan50 D9): picking a cell fills the reaction form. */
export function SceneTechnical(p:{api:DesktopAPI;scene:string;kind:ReactiveKind;busy:boolean;artifact:ImportedScenario|null;offers:ReactiveCandidates|null;esmini:EsminiCheck|null;onEsminiCheck:()=>void;onSeek:(t:number)=>void;fill:(id:string,kind:ReactiveKind,params:Params,start:number)=>void;onCreatePair:(event:ReactiveEvent)=>Promise<void>;dockMetrics:DockMetrics;setDockMetrics:Dispatch<SetStateAction<DockMetrics>>}) {
 const t=useT(),api=p.api;
 const [technicalOpen,setTechnicalOpen]=useState(false);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{p.setDockMetrics(null);},[p.scene,p.kind]);
 const metricsKey=useRef('');metricsKey.current=`${p.scene}:${p.kind}`;
 async function loadSceneMetrics(){const key=metricsKey.current;p.setDockMetrics({status:'loading'});const currentKind=p.kind;try {const data=currentKind==='brake'?await api.reactiveMetrics({scene:p.scene}):(await api.reactiveMetrics({scene:p.scene,kinds:[currentKind]}))[currentKind];if(!data)throw new Error(t('Không có bộ đo chỉ số cảnh.'));if(mounted.current&&metricsKey.current===key)p.setDockMetrics({status:'ready',data});}catch(e){if(mounted.current&&metricsKey.current===key)p.setDockMetrics({status:'error',error:e instanceof Error?e.message:String(e)});}}
 return <details className="sw-technical" onToggle={e=>setTechnicalOpen(e.currentTarget.open)}><summary>{t('Chỉ số cảnh và phân tích phản ứng')}</summary><button disabled={p.busy||p.dockMetrics?.status==='loading'} onClick={()=>void loadSceneMetrics()}>{t('Tải chỉ số cảnh')}</button>
   {technicalOpen && <ReactiveDock scene={p.scene} busy={p.busy} detail={p.artifact?.report?.topeye??null} report={p.artifact?.report??null} esmini={p.esmini} onEsminiCheck={p.onEsminiCheck} metrics={p.dockMetrics} labelProblems={p.offers?.label_problems??[]} onSeek={p.onSeek}
    onPickCell={cell=>p.fill(cell.actor_id,'brake',{...DEFAULT_PARAMS,decel:cell.decel,goal:goalOf(cell.target,cell.dwell)},cell.t0)}
    onPickKindCell={(cell,kind)=>p.fill(cell.actor_id,kind,{...DEFAULT_PARAMS,...paramsOf(kind,cell.params)},cell.t0)}
    onFill={c=>p.fill(c.actor_id,'brake',{...DEFAULT_PARAMS,decel:c.decel_mps2,goal:goalOf(c.target,c.dwell_s)},c.t0_s)}
    onCreate={async(_,event)=>{await p.onCreatePair(event);return true;}}
    reactiveMetrics={api.reactiveMetrics?(scene,reactions)=>api.reactiveMetrics({scene,...(reactions?{reactions}:{})}):undefined}
    replayErrorMetrics={api.replayErrorMetrics?(scene)=>api.replayErrorMetrics({scene}):undefined}/>}
  </details>;
}
