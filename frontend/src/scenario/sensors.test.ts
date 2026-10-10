import { describe, it, expect } from 'vitest';
import { footprint, polygonPath, rayDistance, simulateScan, visibleActors } from './sensors';
import type { Actor, Scenario, Replay } from './types';
const pose = (t = 0, x = 0, y = 0, z = 0, yaw = 0) => ({ t_s: t, x_m: x, y_m: y, z_m: z, yaw_rad: yaw, observed: true });
const actor = (id: string, x: number, y = 0, z = 1, yaw = 0): Actor => ({ id, role: id === 'ego' ? 'ego' : 'traffic', category: 'vehicle.car', length_m: 4, width_m: 2, height_m: 2, samples: [pose(0, x, y, z, yaw), pose(1, x, y, z, yaw)] });
const scene = (actors: Actor[]): Scenario => ({ id: 'test', mode: 'source', interval_s: [0, 1], source: { scene: 'test', selected_interval_s: [0, 1] }, road: { kind: 'source_map' }, actors });
const ego = () => actor('ego', 0, 0, 0);
describe('geometric sensor views', () => {
    it('finds only forward segment intersections', () => { expect(rayDistance([0, 0], [1, 0], [5, -1], [5, 1])).toBe(5); expect(rayDistance([0, 0], [1, 0], [-5, -1], [-5, 1])).toBeNull(); expect(rayDistance([0, 0], [1, 0], [0, 1], [5, 1])).toBeNull(); });
    it('returns nearest visible obstacle rather than farther actor', () => { const scan = simulateScan(scene([ego(), actor('far', 20), actor('near', 10)]), null, .5)!; expect(scan.rays).toHaveLength(180); expect(scan.rays[0].distance).toBeCloseTo(8); });
    it('rotates annotation footprints and ray distances with yaw', () => { const car = actor('car', 10, 0, 1, Math.PI / 2); expect(footprint(car, car.samples[0])[0]).toEqual([11, -2]); expect(simulateScan(scene([ego(), car]), null, .5)!.rays[0].distance).toBeCloseTo(9); });
    it('does not invent returns at maximum range or from ego', () => { const scan = simulateScan(scene([ego(), actor('far', 70)]), null, .5)!; expect(scan.rays.every(r => r.distance === null)).toBe(true); });
    it('rejects actors above the sensor plane', () => { expect(simulateScan(scene([ego(), actor('bridge', 10, 0, 8)]), null, .5)!.rays[0].distance).toBeNull(); });
    it('intersects static geometry only in source coordinates and at sensor height', () => { const s = scene([ego()]); s.environment = { polygons: [], lines: [], trees: [], poles: [], warnings: [], provenance: [], buildings: [{ polygon: [[12, -3], [14, -3], [14, 3], [12, 3]], base_z: 0, height: 5 }] }; expect(simulateScan(s, null, .5)!.rays[0].distance).toBeCloseTo(12); s.environment.buildings[0].base_z = 5; expect(simulateScan(s, null, .5)!.rays[0].distance).toBeNull(); s.environment.buildings[0].base_z = 0; delete s.mode; expect(simulateScan(s, null, .5)!.rays[0].distance).toBeNull(); });
    it('hides unsupported actors and returns no scan for ego gaps', () => { const e = ego(); e.samples = [pose(0), pose(3)]; expect(visibleActors(scene([e]), null, 1)).toHaveLength(0); expect(simulateScan(scene([e]), null, 1)).toBeNull(); });
    it('uses replay positions and never fills missing engine poses from source', () => { const s = scene([ego(), actor('car', 10)]); const replay = { observed: [{ ...pose(.5), id: 'ego' }, { ...pose(.5, 30, 0, 1), id: 'car' }] } as Replay; expect(simulateScan(s, replay, .5)!.rays[0].distance).toBeCloseTo(28); expect(simulateScan(s, replay, .6)).toBeNull(); });
    it('recomputes moving actor returns with timeline', () => { const car = actor('moving', 10); car.samples[1].x_m = 20; const s = scene([ego(), car]); expect(simulateScan(s, null, 0)!.rays[0].distance).toBe(8); expect(simulateScan(s, null, 1)!.rays[0].distance).toBe(18); });
    it('writes numeric SVG paths including holes with inverted world Y', () => { expect(polygonPath([[[0, 0], [10, 0], [10, 10]], [[2, 2], [3, 2], [3, 3]]])).toBe('M0,0 L10,0 L10,-10 Z M2,-2 L3,-2 L3,-3 Z'); });
});

it('uses bound imported geometry and continuous planned poses while keeping replay gaps unsupported',()=>{
 const imported = scene([ego(),actor('new-pedestrian',10)]);
 imported.mode='imported';
 imported.actors[1].category='human.pedestrian.adult';
 imported.actors.forEach(a=>{a.samples[1].t_s=2;a.samples.forEach(p=>{p.observed=false;});});
 imported.interval_s=[0,2];
 imported.environment={polygons:[],lines:[],trees:[],poles:[],warnings:[],provenance:[],buildings:[{polygon:[[6,-2],[7,-2],[7,2],[6,2]],base_z:0,height:5}]};
 expect(visibleActors(imported,null,1).map(v=>v.actor.id)).toEqual(['ego','new-pedestrian']);
 expect(simulateScan(imported,null,1)!.rays[0].distance).toBe(6);
 const replay={observed:[{...pose(0),id:'ego'},{...pose(.2),id:'ego'}]} as Replay;
 expect(simulateScan(imported,replay,.1)).toBeNull();
});
it('places imported ego scan one meter above ground using its box center',()=>{
 const e=ego();e.height_m=2;e.samples.forEach(p=>p.z_m=1);
 const imported=scene([e]);imported.mode='imported';
 imported.environment={polygons:[],lines:[],trees:[],poles:[],warnings:[],provenance:[],buildings:[{polygon:[[6,-2],[7,-2],[7,2],[6,2]],base_z:0,height:1.2}]};
 expect(simulateScan(imported,null,.5)!.rays[0].distance).toBe(6);
 imported.mode='source';
 expect(simulateScan(imported,null,.5)!.rays[0].distance).toBeNull();
});
