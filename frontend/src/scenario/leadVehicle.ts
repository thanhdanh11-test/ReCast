import type { Actor, Pose, Replay, Scenario } from "./types";
import { replayRows, supportedPose } from "./trajectory";

export interface LeadVehicle {
    actorId: string;
    gapM: number;
    centerDistanceM: number;
    egoPose: Pose;
    targetPose: Pose;
}

/** Forward corridor heuristic using oriented footprints; does not infer lane membership. */
export function nearestLeadVehicle(scenario: Scenario | null, replay: Replay | null, time: number): LeadVehicle | null {
    if (!scenario) return null;
    const ego = scenario.actors.find(actor => actor.role === "ego");
    if (!ego) return null;
    const maxGap = replay ? .075 : scenario.mode === "imported" ? Infinity : 1;
    const pose = (actor: Actor) => supportedPose(replayRows(actor, replay), time, maxGap);
    const egoPose = pose(ego);
    if (!egoPose) return null;
    const egoHeight = ego.height_m ?? 1.6;
    // Source/legacy ego reference is on ground, imported ego poses already use box center.
    const egoCenterZ = egoPose.z_m + (scenario.mode === "imported" ? 0 : egoHeight / 2);
    const cos = Math.cos(egoPose.yaw_rad), sin = Math.sin(egoPose.yaw_rad);
    let nearest: LeadVehicle | null = null;
    for (const actor of scenario.actors) {
        if (actor.id === ego.id || !actor.category.startsWith("vehicle.")) continue;
        const targetPose = pose(actor);
        if (!targetPose) continue;
        const height = actor.height_m ?? 1.6;
        if (Math.abs(targetPose.z_m - egoCenterZ) > (egoHeight + height) / 2 + .5) continue;
        const dx = targetPose.x_m - egoPose.x_m, dy = targetPose.y_m - egoPose.y_m;
        const along = dx * cos + dy * sin, lateral = -dx * sin + dy * cos;
        const yaw = targetPose.yaw_rad - egoPose.yaw_rad;
        const facing = Math.cos(yaw), cross = Math.abs(Math.sin(yaw));
        if (along <= 0 || facing <= 0) continue;
        const longitudinalSupport = Math.abs(facing) * actor.length_m / 2 + cross * actor.width_m / 2;
        const lateralSupport = cross * actor.length_m / 2 + Math.abs(facing) * actor.width_m / 2;
        if (Math.abs(lateral) > ego.width_m / 2 + lateralSupport + .5) continue;
        const gapM = Math.max(0, along - ego.length_m / 2 - longitudinalSupport);
        if (!nearest || gapM < nearest.gapM) nearest = {
            actorId: actor.id, gapM, centerDistanceM: Math.hypot(dx, dy, targetPose.z_m - egoCenterZ), egoPose, targetPose,
        };
    }
    return nearest;
}
