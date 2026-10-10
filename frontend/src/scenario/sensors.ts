import type { Actor, Pose, Replay, Scenario } from './types';
import { replayRows, supportedPose } from './trajectory';
export type Point = [
    number,
    number
];
export function visibleActors(scenario: Scenario, replay: Replay | null, time: number) {
    return scenario.actors.flatMap(actor => {
        const pose = supportedPose(replayRows(actor, replay), time, replay ? .075 : scenario.mode === "imported" ? Infinity : 1);
        return pose ? [{ actor, pose }] : [];
    });
}
export function footprint(actor: Actor, pose: Pose): Point[] {
    const c = Math.cos(pose.yaw_rad), s = Math.sin(pose.yaw_rad);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
        const dx = x * actor.length_m / 2, dy = y * actor.width_m / 2;
        return [pose.x_m + c * dx - s * dy, pose.y_m + s * dx + c * dy];
    });
}
export function polygonPath(rings: number[][][]): string {
    return rings.filter(r => r.length > 2).map(r => r.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${-y}`).join(' ') + ' Z').join(' ');
}
export function rayDistance(origin: Point, direction: Point, a: Point, b: Point): number | null {
    const sx = b[0] - a[0], sy = b[1] - a[1], den = direction[0] * sy - direction[1] * sx;
    if (Math.abs(den) < 1e-9)
        return null;
    const ax = a[0] - origin[0], ay = a[1] - origin[1];
    const t = (ax * sy - ay * sx) / den, u = (ax * direction[1] - ay * direction[0]) / den;
    return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}
export interface Scan {
    ego: Pose;
    rays: {
        angle: number;
        distance: number | null;
    }[];
}
export function simulateScan(scenario: Scenario, replay: Replay | null, time: number): Scan | null {
    const actors = visibleActors(scenario, replay, time), ego = actors.find(a => a.actor.role === 'ego');
    if (!ego)
        return null;
    const sensorZ = ego.pose.z_m - (scenario.mode === "imported" ? (ego.actor.height_m ?? 1.6) / 2 : 0) + 1, obstacles: Point[][] = [];
    const overlaps = (base: number, height: number) => sensorZ >= base && sensorZ <= base + height;
    for (const { actor, pose } of actors) {
        const height = actor.height_m ?? 1.6;
        if (actor.role !== 'ego' && overlaps(pose.z_m - height / 2, height))
            obstacles.push(footprint(actor, pose));
    }
    const circle = (x: number, y: number, r: number): Point[] => Array.from({ length: 16 }, (_, i) => [x + r * Math.cos(i * Math.PI / 8), y + r * Math.sin(i * Math.PI / 8)]);
    if ((scenario.mode === 'source' || scenario.mode === 'imported') && scenario.environment) {
        const env = scenario.environment;
        for (const b of env.buildings)
            if (overlaps(b.base_z, b.height))
                obstacles.push(b.polygon.map(([x, y]) => [x, y]));
        for (const p of env.poles)
            if (overlaps(p.z, p.height))
                obstacles.push(circle(p.x, p.y, .12));
        for (const t of env.trees) {
            if (overlaps(t.z, t.height * .65))
                obstacles.push(circle(t.x, t.y, .24));
            if (overlaps(t.z + t.height * .34, t.height * .68))
                obstacles.push(circle(t.x, t.y, t.crown_radius));
        }
    }
    // Reject distant footprints once, before tracing rays. Bounds retain large nearby buildings.
    const ox = ego.pose.x_m, oy = ego.pose.y_m;
    const nearby = obstacles.filter(p => p.length > 1 && Math.min(...p.map(v => v[0])) <= ox + 60 && Math.max(...p.map(v => v[0])) >= ox - 60 && Math.min(...p.map(v => v[1])) <= oy + 60 && Math.max(...p.map(v => v[1])) >= oy - 60);
    const rays = Array.from({ length: 180 }, (_, i) => {
        const angle = i * Math.PI / 90, world = angle + ego.pose.yaw_rad;
        const direction: Point = [Math.cos(world), Math.sin(world)];
        let distance: number | null = null;
        for (const polygon of nearby)
            for (let j = 0; j < polygon.length; j++) {
                const hit = rayDistance([ox, oy], direction, polygon[j], polygon[(j + 1) % polygon.length]);
                if (hit !== null && hit <= 60 && (distance === null || hit < distance))
                    distance = hit;
            }
        return { angle, distance };
    });
    return { ego: ego.pose, rays };
}
