// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,renderHook,waitFor} from "@testing-library/react";
import {useScenarioSession} from "./useScenarioSession";
import {source,candidates} from "../reactive/fixtures";
import type {DesktopAPI} from "../types";
afterEach(cleanup);
function api() {return {sourceScene:vi.fn(async()=>source),mapContext:vi.fn(async()=>({map_id:"sha256:test"})),reactiveCandidates:vi.fn(async()=>candidates),listImported:vi.fn(async()=>[{scene:"scene-0061"}]),scenarioGroups:vi.fn(async()=>[])};}
it("keeps saved packages and retry when candidate discovery fails",async()=>{
 const a=api();a.reactiveCandidates.mockRejectedValue(new Error("candidate failed"));
 const {result}=renderHook(()=>useScenarioSession(a as unknown as DesktopAPI,"scene-0061",source));
 await waitFor(()=>expect(result.current.errors.candidates).toBe("candidate failed"));
 expect(result.current.entries).toHaveLength(1);expect(result.current.canCreate).toBe(true);expect(a.sourceScene).not.toHaveBeenCalled();
 a.reactiveCandidates.mockResolvedValue(candidates);await result.current.retry("candidates");
 await waitFor(()=>expect(result.current.errors.candidates).toBeUndefined());
});
it("blocks authoring on invalid geometry without hiding the library",async()=>{
 const a=api();a.mapContext.mockRejectedValue(new Error("INVALID_MAP_GEOMETRY"));
 const {result}=renderHook(()=>useScenarioSession(a as unknown as DesktopAPI,"scene-0061",source));
 await waitFor(()=>expect(result.current.errors.map).toBe("INVALID_MAP_GEOMETRY"));
 expect(result.current.canCreate).toBe(false);expect(result.current.entries).toHaveLength(1);
});
it("does not reload source when a provided source is reused",async()=>{
 const a=api();const {result,rerender}=renderHook(()=>useScenarioSession(a as unknown as DesktopAPI,"scene-0061",source));
 await waitFor(()=>expect(result.current.offers).toEqual(candidates));rerender();
 expect(a.sourceScene).not.toHaveBeenCalled();expect(a.reactiveCandidates).toHaveBeenCalledTimes(1);
});
it("retries a stale source once without replaying unrelated errors",async()=>{
 const a=api(),{result}=renderHook(()=>useScenarioSession(a as unknown as DesktopAPI,"scene-0061",source));
 await waitFor(()=>expect(result.current.canCreate).toBe(true));
 const operation=vi.fn().mockRejectedValueOnce(new Error("STALE_CONTEXT: gone")).mockResolvedValue("ok");
 expect(await result.current.sourceAction(operation)).toBe("ok");expect(operation).toHaveBeenCalledTimes(2);expect(a.sourceScene).toHaveBeenCalledTimes(1);
 const bad=vi.fn().mockRejectedValue(new Error("NETWORK"));await expect(result.current.sourceAction(bad)).rejects.toThrow("NETWORK");expect(bad).toHaveBeenCalledTimes(1);
});
it("ignores candidate results from a previous scene",async()=>{
 const a=api();let finish!:(value:typeof candidates)=>void;
 a.reactiveCandidates.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const {result,rerender}=renderHook(({scene,src})=>useScenarioSession(a as unknown as DesktopAPI,scene,src),{initialProps:{scene:"scene-0061",src:source}});
 await waitFor(()=>expect(a.reactiveCandidates).toHaveBeenCalledTimes(1));
 const next={...source,id:"next-source",source:{...source.source,scene:"scene-next"}};
 rerender({scene:"scene-next",src:next});
 await waitFor(()=>expect(a.reactiveCandidates).toHaveBeenCalledTimes(2));
 const newer={...candidates,candidates:[]};a.reactiveCandidates.mockResolvedValue(newer);await result.current.retry("candidates");
 finish(candidates);await waitFor(()=>expect(result.current.offers).toEqual(newer));
});
