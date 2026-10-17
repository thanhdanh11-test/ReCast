import {useState} from "react";
import {AlertTriangle,CheckCircle2} from "lucide-react";
import type {ReactiveDetail,VariantOutcome} from "../reactiveTypes";
import {fmt,type Mode} from "../reactive/model";
import {useT} from "../i18n";
const MODE_KEY="topeye.scenario.metrics.mode";
export function loadMetricsMode():Mode{try{return localStorage.getItem(MODE_KEY)==='technical'?'technical':'simple';}catch{return 'simple';}}
export function saveMetricsMode(mode:Mode){try{localStorage.setItem(MODE_KEY,mode);}catch{}}
const GROUP:Record<string,string>={collision:"Va chạm",hard:"Phanh gấp",close:"Tiếp cận gần",mild:"Phản ứng nhẹ",far:"Cách xa"};
const egoCollision=(v:VariantOutcome|undefined)=>v?.collisions?.some(c=>c[0]==='ego'||c[1]==='ego')??false;
export function ScenarioMetricsView({detail,reactionSeconds}:{detail:ReactiveDetail;reactionSeconds?:number}){
 const t=useT(),[mode,setMode]=useState<Mode>(loadMetricsMode);
 const base=detail.comparison?.baseline,pilot=detail.comparison?.pilot;
 const baseGap=base?.ego?.min_gap,pilotGap=pilot?.ego?.min_gap,delta=baseGap!=null&&pilotGap!=null?pilotGap-baseGap:null;
 const complete=!!base?.ego&&!!pilot?.ego&&Array.isArray(base.collisions)&&Array.isArray(pilot.collisions);
 const avoided=complete&&egoCollision(base)&&!egoCollision(pilot)&&pilot?.valid===true;
 const passed=complete&&pilot?.valid===true&&!egoCollision(pilot);
 const title=!complete?t("Chưa đủ dữ liệu để đối chiếu"):avoided?t("Baseline có va chạm ego; pilot không phát hiện va chạm"):passed?t("Không phát hiện va chạm trong khoảng mô phỏng"):t("Tình huống cần lưu ý");
 const group=(v:VariantOutcome|undefined)=>v?.group?t(GROUP[v.group]??v.group):t("Chưa phân nhóm");
 const valid=(v:VariantOutcome|undefined)=>!v?t("Chưa kiểm"):v.valid?t("Đạt chuẩn"):v.reasons?.join(', ')||t("Không đạt");
 const rows:[string,string,string,string][]=[
  ["Phân nhóm (Group)",group(base),group(pilot),avoided?t("Không phát hiện va chạm ego ở pilot"):base?.group===pilot?.group?t("Tương đương"):t("Khác nhóm")],
  ["Khoảng cách gần nhất (Min Gap)",fmt(baseGap,2,' m'),fmt(pilotGap,2,' m'),delta==null?'—':`${delta>=0?'+':''}${fmt(delta,2,' m')}`],
  ["Thời gian tới va chạm (Min TTC)",fmt(base?.ego?.min_ttc,2,' s'),fmt(pilot?.ego?.min_ttc,2,' s'),'—'],
  ["Gia tốc phanh sử dụng (a_used)",fmt(base?.ego?.a_used,2,' m/s²'),fmt(pilot?.ego?.a_used,2,' m/s²'),'—'],
  ["Thời gian phản xạ (Reaction)",t("Không áp dụng"),fmt(reactionSeconds,2,' s'),t("Tham số mô phỏng")],
  ["Kiểm định hợp lệ (Validity)",valid(base),valid(pilot),t("Xem các kiểm tra trong báo cáo")],
 ];
 return <section className="ud-outcomes" aria-label={t("Baseline và pilot")}>
  <div className="ud-metrics-header"><div className="ud-metrics-heading"><small>{t("SỐ LIỆU ĐO ĐẠC & ĐÁNH GIÁ")}</small><strong>{t(mode==='simple'?"Đánh giá an toàn dễ hiểu":"Đối chiếu chỉ số kỹ thuật chi tiết")}</strong></div><div className="ud-mode-toggle" role="group" aria-label={t("Chế độ hiển thị số liệu")}>{(['simple','technical'] as const).map(m=><button key={m} className={mode===m?'active':''} aria-pressed={mode===m} onClick={()=>{setMode(m);saveMetricsMode(m);}}>{t(m==='simple'?"Cơ bản":"Kỹ thuật")}</button>)}</div></div>
  {mode==='simple'?<div className="ud-simple-view"><div className={`ud-verdict-banner ${passed?'ok':'warn'}`}>{passed?<CheckCircle2 size={22}/>:<AlertTriangle size={22}/>}<div><strong>{title}</strong><p>{!complete?t("Các trường thiếu được hiển thị bằng dấu gạch; không suy ra kết luận."):!pilot?.valid?detail.summary:pilot.reacted?.includes('ego')?t("Ego có phản ứng trong mô hình. Xem quỹ đạo và các kiểm tra chi tiết."):t("Báo cáo không ghi nhận ego phản ứng trong trường hợp này.")}</p></div></div>
   <div className="ud-simple-cards">{([base,pilot] as const).map((v,i)=><div key={i} className={`ud-card ${egoCollision(v)?'danger':v?.valid?'success':'warn'}`}><div className="ud-card-top"><small>{t(i===0?"BASELINE · KHÔNG PHẢN ỨNG":"PILOT · CÓ PHẢN ỨNG")}</small><span className="ud-badge">{group(v)}</span></div><div className="ud-card-main"><div className="ud-metric-stat"><span className="ud-m-label">{t("Cự ly gần nhất:")}</span><strong className="ud-m-val">{fmt(v?.ego?.min_gap,2)} m</strong>{i===1&&delta!=null&&delta>0&&<span className="ud-m-diff">+{fmt(delta,2)} m</span>}</div><p>{t("Khoảng cách nhỏ nhất trong toàn khoảng mô phỏng, không phải khoảng cách khi dừng.")}</p></div></div>)}</div>
  </div>:<div className="ud-technical-view"><table className="ud-tech-table" aria-label={t("Bảng so sánh kỹ thuật")}><thead><tr>{["Thông số đo đạc","Baseline (Không phản ứng)","Pilot (Có phản ứng)","Đánh giá kỹ thuật"].map(h=><th key={h}>{t(h)}</th>)}</tr></thead><tbody>{rows.map(([label,a,b,note])=><tr key={label}><td><strong>{t(label)}</strong></td><td>{a}</td><td>{b}</td><td>{note}</td></tr>)}</tbody></table><p>{t("File xuất dùng quỹ đạo tính sẵn trong khoảng mô phỏng.")}</p></div>}
 </section>;
}
