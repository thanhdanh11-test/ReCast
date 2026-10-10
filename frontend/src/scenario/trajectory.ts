import type { Actor, Pose, Replay, Scenario } from "./types";
export function poseAt(rows: Pose[], time: number): Pose {
  if (!rows.length) throw new Error("Trajectory has no poses");
  const i = rows.findIndex((p) => p.t_s >= time);
  if (i <= 0) return i === 0 ? rows[0] : rows[rows.length - 1];
  const a = rows[i - 1],
    b = rows[i],
    f = (time - a.t_s) / (b.t_s - a.t_s);
  const dh = Math.atan2(
    Math.sin(b.yaw_rad - a.yaw_rad),
    Math.cos(b.yaw_rad - a.yaw_rad),
  );
  return {
    ...a,
    t_s: time,
    x_m: a.x_m + (b.x_m - a.x_m) * f,
    y_m: a.y_m + (b.y_m - a.y_m) * f,
    z_m: a.z_m + (b.z_m - a.z_m) * f,
    yaw_rad: a.yaw_rad + dh * f,
  };
}
export function replayRows(actor: Actor, replay: Replay | null): Pose[] {
  return replay
    ? replay.observed.filter((p) => p.id === actor.id)
    : actor.samples;
}
export function supportedPose(
  rows: Pose[],
  time: number,
  maxGap = 1,
): Pose | null {
  if (
    !rows.length ||
    time < rows[0].t_s - 1e-7 ||
    time > rows[rows.length - 1].t_s + 1e-7
  )
    return null;
  const next = rows.findIndex((p) => p.t_s >= time);
  if (
    next > 0 &&
    Math.abs(rows[next].t_s - time) > 1e-7 &&
    rows[next].t_s - rows[next - 1].t_s > maxGap
  )
    return null;
  return poseAt(
    rows,
    Math.max(rows[0].t_s, Math.min(time, rows[rows.length - 1].t_s)),
  );
}
export function scenePosition(p: Pose): [number, number, number] {
  return [p.x_m, p.z_m, -p.y_m];
}

export function playbackEnd(
  scenario: Scenario | null,
  replay: Replay | null,
): number {
  if (!scenario) return 0;
  if (!replay) return scenario.interval_s[1];
  return Math.min(
    scenario.interval_s[1],
    ...scenario.actors.map((actor) =>
      Math.max(0, ...replayRows(actor, replay).map((p) => p.t_s)),
    ),
  );
}
