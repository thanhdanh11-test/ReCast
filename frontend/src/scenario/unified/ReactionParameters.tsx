import {useT} from "../i18n";
import type { Dispatch, SetStateAction } from "react";
import { ACCELS, DURATIONS, DWELLS, GOALS, windowsOf, type Params } from "../reactive/model";
import type { Candidate } from "../types";
import type { ReactiveKind } from "../reactiveTypes";
import { reactionChoice } from "./model";
import type { Scenario } from "../types";
const fmt = (n: number) => n.toFixed(1).replace(".", ",");
export function ReactionParameters({selected,kind,params,setParams,t0,setT0,source,busy}: {
 selected: Candidate; kind: ReactiveKind; params: Params; setParams: Dispatch<SetStateAction<Params>>;
 t0: number; setT0: (t: number) => void; source: Scenario; busy: boolean;
}) {
 const t=useT();
 const {levels,effectiveParams,windows,availableTimes,chosenTime,range,target} = reactionChoice(selected,kind,params,t0,source);
 return <fieldset disabled={busy} className="ud-fields">
          {kind === "brake" && <div className="ud-two"><label>{t("Mục tiêu")}<select aria-label={t("Mục tiêu phanh")} value={params.goal} onChange={e => setParams(p => ({ ...p, goal: e.target.value as Params["goal"] }))}>{Object.entries(GOALS).map(([value, goal]) => <option key={value} value={value}>{goal.label}</option>)}</select></label><label>{t("Mức phanh")}<select aria-label={t("Mức phanh")} value={effectiveParams.decel} onChange={e => setParams(p => ({ ...p, decel: Number(e.target.value) }))}>{levels.map(level => <option key={level} value={level}>{level}{t("m/s²")}</option>)}</select></label></div>}
          {kind === "accelerate" && <div className="ud-two"><label>{t("Gia tốc")}<select aria-label={t("Gia tốc")} value={params.accel} onChange={e => setParams(p => ({ ...p, accel: Number(e.target.value) as Params["accel"] }))}>{ACCELS.map(value => <option key={value} value={value}>{value}{t("m/s²")}</option>)}</select></label><label>{t("Tốc độ đích")}<select aria-label={t("Tốc độ đích")} disabled={!range} value={target ?? ""} onChange={e => setParams(p => ({ ...p, target_mps: Number(e.target.value) }))}>{!range && <option value="">{t("Không có giá trị hợp lệ")}</option>}{range && Array.from({ length: Math.floor((range.max - range.min) * 2) + 1 }, (_, i) => range.min + i / 2).map(value => <option key={value} value={value}>{fmt(value)}{t("m/s")}</option>)}</select></label></div>}
          {kind === "stopline" && <label>{t("Thời gian dừng")}<select aria-label={t("Thời gian dừng")} value={params.dwell} onChange={e => setParams(p => ({ ...p, dwell: Number(e.target.value) as Params["dwell"] }))}>{DWELLS.map(value => <option key={value} value={value}>{value} s</option>)}</select></label>}
          {kind === "lane_change" && <div className="ud-two"><label>{t("Hướng")}<select aria-label={t("Hướng chuyển làn")} value={effectiveParams.direction} onChange={e => setParams(p => ({ ...p, direction: e.target.value as Params["direction"],duration:DURATIONS.find(duration=>windowsOf(selected,kind,{...p,direction:e.target.value as Params["direction"],duration}).length)??p.duration }))}><option disabled={!DURATIONS.some(duration=>windowsOf(selected,kind,{...params,direction:"left",duration}).length)} value="left">{t("Trái")}</option><option disabled={!DURATIONS.some(duration=>windowsOf(selected,kind,{...params,direction:"right",duration}).length)} value="right">{t("Phải")}</option></select></label><label>{t("Thời gian chuyển")}<select aria-label={t("Thời gian chuyển làn")} value={effectiveParams.duration} onChange={e => setParams(p => ({ ...p, duration: Number(e.target.value) as Params["duration"] }))}>{DURATIONS.map(value => <option key={value} value={value} disabled={!windowsOf(selected,kind,{...params,duration:value}).length}>{value} s</option>)}</select></label></div>}
          <div className="ud-two"><label>{t("Bắt đầu lúc")}<select aria-label={t("Bắt đầu lúc")} value={chosenTime} disabled={!availableTimes.length || busy} onChange={e => setT0(Number(e.target.value))}>{availableTimes.map(value => <option key={value} value={value}>{fmt(value)} s</option>)}</select></label><label>{t("Xe sau phản ứng")}<select aria-label={t("Độ trễ phản ứng")} value={params.reaction} onChange={e => setParams(p => ({ ...p, reaction: Number(e.target.value) }))}><option value={0.7}>{t("0,7 s")}</option><option value={1}>{t("1,0 s")}</option><option value={1.5}>{t("1,5 s")}</option></select></label></div>
          {selected && !windows.length && <p className="ud-muted">{t("Tổ hợp này chưa có thời điểm hợp lệ. Đổi tham số hoặc chọn xe khác.")}</p>}
</fieldset>;
}
