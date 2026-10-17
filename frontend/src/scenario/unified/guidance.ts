import { ACCELS, BRAKE_LEVEL_LABEL, DURATIONS, DWELLS, brakeLevels, kindsOf, windowsOf, type Params } from "../reactive/model";
import type { Candidate, Scenario } from "../types";
import type { ReactiveKind } from "../reactiveTypes";
import { initialParams, reactionChoice } from "./model";

export const INTENTS: Record<ReactiveKind, { title: string; description: string }> = {
  brake: { title: "Xe phía trước phanh", description: "Xem xe của bạn phản ứng khi xe trước giảm tốc hoặc dừng lại." },
  accelerate: { title: "Xe phía trước tăng tốc", description: "Quan sát khoảng cách thay đổi khi xe trước chạy nhanh hơn." },
  stopline: { title: "Xe phía trước dừng ở vạch", description: "Thử phản ứng khi xe trước dừng tại vạch trên bản đồ." },
  lane_change: { title: "Xe phía trước chuyển làn", description: "Quan sát xe đổi làn và phản ứng của các xe theo sau." },
};
export interface GuidedOption { label: string; params: Params; time: number }
export function guidedOptions(candidate: Candidate, kind: ReactiveKind, source: Scenario): GuidedOption[] {
  if (!kindsOf(candidate).includes(kind)) return [];
  const base = initialParams(candidate, kind);
  const options: {label: string; params: Params}[] = kind === "brake"
    ? brakeLevels(candidate).map(decel => ({ label: `Phanh ${BRAKE_LEVEL_LABEL[decel]?.toLowerCase() ?? decel} · ${decel} m/s²`, params: { ...base, decel } }))
    : kind === "accelerate" ? ACCELS.map(accel => ({ label: `Tăng tốc ${accel === 1 ? "nhẹ" : accel === 2 ? "vừa" : "mạnh"} · ${accel} m/s²`, params: { ...base, accel } }))
    : kind === "stopline" ? DWELLS.map(dwell => ({ label: dwell ? `Dừng ${dwell} giây` : "Dừng rồi đi ngay", params: { ...base, dwell } }))
    : (["left", "right"] as const).flatMap(direction => DURATIONS.map(duration => ({ label: `Sang ${direction === "left" ? "trái" : "phải"} trong ${duration} giây`, params: { ...base, direction, duration } })));
  return options.flatMap(option => {
    const time = windowsOf(candidate, kind, option.params)[0]?.[0];
    return time !== undefined && reactionChoice(candidate, kind, option.params, time, source).event ? [{ ...option, time }] : [];
  });
}
export function guidedCandidates(candidates: Candidate[], kind: ReactiveKind, source: Scenario) {
  return candidates.filter(c => c.followers.includes("ego") && guidedOptions(c, kind, source).length > 0);
}
