// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { ActorTimeline, motionSpans, visibleKeys } from "./ActorTimeline";
import type { Pose, Scenario } from "./types";
const pose = (t_s: number, x_m: number): Pose => ({t_s,x_m,y_m:0,z_m:0,yaw_rad:0,observed:true});
const scenario: Scenario = {id:"s",mode:"imported",interval_s:[0,10],source:{scene:"fixture"},actors:[{id:"ego",role:"ego",category:"car",length_m:4,width_m:2,samples:[pose(2,0),pose(4,0),pose(6,4),pose(8,8)]}]};
afterEach(cleanup);
describe("XOSC motion timeline",()=>{
 it("thins dense markers without changing timestamps or endpoints",()=>{const keys=Array.from({length:1001},(_,i)=>i/100);const visible=visibleKeys(keys,10);expect(visible.length).toBeLessThanOrEqual(43);expect(visible[0]).toBe(0);expect(visible.at(-1)).toBe(10);expect(visible.every(k=>keys.includes(k))).toBe(true);expect(keys).toHaveLength(1001);});
 it("preserves delayed coverage and merges moving intervals",()=>{expect(motionSpans(scenario.actors[0].samples,10)).toEqual([{start:2,end:4,moving:false},{start:4,end:8,moving:true}]);});
 it("uses time-normalized speed and clips playback end",()=>{expect(motionSpans([pose(0,0),pose(5,.4),pose(10,5)],7)).toEqual([{start:0,end:5,moving:false},{start:5,end:7,moving:true}]);});
 it("omits invalid intervals and handles zero duration",()=>{expect(motionSpans([pose(0,0),pose(0,4),pose(1,NaN)],5)).toEqual([]);expect(motionSpans([pose(0,0),pose(1,1)],0)).toEqual([]);});
 it("keyboard seeking uses shared absolute time and exact end",()=>{const onSeek=vi.fn();render(<ActorTimeline scenario={scenario} time={4.5} duration={10} disabled={false} onSeek={onSeek}/>);const slider=screen.getByRole('slider');fireEvent.keyDown(slider,{key:'ArrowRight'});expect(onSeek).toHaveBeenLastCalledWith(4.6);fireEvent.keyDown(slider,{key:'End'});expect(onSeek).toHaveBeenLastCalledWith(10);fireEvent.keyDown(slider,{key:'Home'});expect(onSeek).toHaveBeenLastCalledWith(0);});
 it("snaps pointer to a real keyframe, disabled seek is inert",()=>{const onSeek=vi.fn();const {rerender}=render(<ActorTimeline scenario={scenario} time={0} duration={10} disabled={false} onSeek={onSeek}/>);const slider=screen.getByRole('slider');vi.spyOn(slider,'getBoundingClientRect').mockReturnValue({left:0,width:1000} as DOMRect);fireEvent.click(slider,{clientX:403});expect(onSeek).toHaveBeenLastCalledWith(4);rerender(<ActorTimeline scenario={scenario} time={0} duration={10} disabled onSeek={onSeek}/>);fireEvent.keyDown(slider,{key:'End'});fireEvent.click(slider,{clientX:800});expect(onSeek).toHaveBeenCalledTimes(1);});
 it("does not extend actor presence outside its source samples",()=>{render(<ActorTimeline scenario={scenario} time={9} duration={10} disabled={false} onSeek={()=>{}}/>);expect(document.querySelector('.actor-timeline-foot')).toBeNull(); expect(document.querySelector('.span-moving')?.getAttribute('d')).toBe('M400 24H800');});
});
