import { describe, expect, it } from "vitest";
import { nearestLeadVehicle } from "./leadVehicle";
import type { Actor, Pose, Replay, Scenario } from "./types";
const p = (t_s = 0, x_m = 0, y_m = 0, z_m = .8, yaw_rad = 0): Pose => ({t_s,x_m,y_m,z_m,yaw_rad,observed:true});
const actor = (id: string, x = 0, y = 0, yaw = 0): Actor => ({id,role:id === "ego" ? "ego" : "traffic",category:"vehicle.car",length_m:4,width_m:2,height_m:1.6,samples:[p(0,x,y,id === "ego" ? 0 : .8,yaw),p(1,x,y,id === "ego" ? 0 : .8,yaw)]});
const scene = (...actors: Actor[]): Scenario => ({id:"source",mode:"source",actors,interval_s:[0,1],source:{scene:"test"}});
describe("live forward vehicle clearance", () => {
    it("reports bumper gap rather than center distance and chooses closest ahead vehicle", () => {
        const result = nearestLeadVehicle(scene(actor("ego"),actor("far",20),actor("near",10)),null,.5)!;
        expect(result.actorId).toBe("near"); expect(result.gapM).toBe(6); expect(result.centerDistanceM).toBe(10);
    });
    it("accounts for ego heading and target rotated OBB supports", () => {
        const result = nearestLeadVehicle(scene(actor("ego",0,0,Math.PI/2),actor("lead",0,10,Math.PI/2 + Math.PI/4)),null,.5)!;
        expect(result.gapM).toBeCloseTo(8 - 3 / Math.sqrt(2));
    });
    it("rejects adjacent, opposing, behind, overpass and pedestrian actors", () => {
        const overpass = actor("overpass",10); overpass.samples.forEach(pose=>pose.z_m = 8);
        const person = actor("person",5); person.category="human.pedestrian.adult";
        expect(nearestLeadVehicle(scene(actor("ego"),actor("adjacent",8,4),actor("opposing",10,0,Math.PI),actor("behind",-10),overpass,person),null,.5)).toBeNull();
    });
    it("handles imported centered ego and tall legacy ego without mutating poses", () => {
        const ego = actor("ego"); ego.height_m = 8;
        const lead = actor("lead",10); lead.samples.forEach(pose=>pose.z_m = 9);
        const original = JSON.stringify([ego,lead]);
        expect(nearestLeadVehicle(scene(ego,lead),null,.5)).not.toBeNull();
        const imported = {...scene(ego,lead),mode:"imported" as const};
        expect(nearestLeadVehicle(imported,null,.5)).toBeNull();
        expect(JSON.stringify([ego,lead])).toBe(original);
    });
    it("uses actual measured rows and refuses missing simulator targets or large gaps", () => {
        const scenario=scene(actor("ego"),actor("lead",10));
        const replay = {observed:[{...p(0),id:"ego"},{...p(.05),id:"ego"}],path:"test",report:{}} as Replay;
        expect(nearestLeadVehicle(scenario,replay,.025)).toBeNull();
        replay.observed.push({...p(0,20),id:"lead"},{...p(.05,20),id:"lead"});
        expect(nearestLeadVehicle(scenario,replay,.025)?.gapM).toBe(16);
        replay.observed[3].t_s = .2;
        expect(nearestLeadVehicle(scenario,replay,.025)).toBeNull();
    });
    it("does not extrapolate or bridge source gaps; imported interpolation remains supported", () => {
        const ego=actor("ego"),lead=actor("lead",10); ego.samples[1].t_s=2;lead.samples[1].t_s=2;
        const scenario=scene(ego,lead);
        expect(nearestLeadVehicle(scenario,null,1)).toBeNull();
        expect(nearestLeadVehicle({...scenario,mode:"imported"},null,1)?.gapM).toBe(6);
        expect(nearestLeadVehicle(scenario,null,3)).toBeNull();
    });
    it("updates numeric gap with time, includes cyclists and clamps overlapping boxes to zero", () => {
        const lead=actor("bike",10); lead.category="vehicle.bicycle";lead.samples[1].x_m=2;
        const scenario=scene(actor("ego"),lead);
        expect(nearestLeadVehicle(scenario,null,0)?.gapM).toBe(6);
        expect(nearestLeadVehicle(scenario,null,.5)?.gapM).toBe(2);
        expect(nearestLeadVehicle(scenario,null,1)?.gapM).toBe(0);
    });
});
