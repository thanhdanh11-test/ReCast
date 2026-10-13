// @vitest-environment happy-dom
import {render,screen,cleanup,act} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {LidarView} from './LidarView';
import {TacticalMap} from './TacticalMap';
import type {Scenario} from './types';
afterEach(cleanup);
const source:Scenario={id:'source',mode:'source',interval_s:[0,1],source:{scene:'test',selected_interval_s:[0,1]},road:{kind:'source_map'},actors:[{id:'ego',role:'ego',category:'vehicle.car',length_m:4,width_m:2,samples:[{t_s:0,x_m:0,y_m:0,z_m:0,yaw_rad:0,observed:true}]}]};
it('labels the 180-ray scan as a simulation with its reason, and no captions',()=>{
 render(<LidarView scenario={source} time={0} replay={null}/>);
 const tag=screen.getByText('MÔ PHỎNG');
 expect(tag.getAttribute('title')).toMatch(/Không phải LiDAR đo thực/);
 expect(document.querySelector('.sensor-note')).toBeNull();
 expect(document.querySelector('.sensor-stat')).toBeNull();
 expect(screen.queryByRole('button')).toBeNull();
});
it('does not invent a map when vectors are absent',()=>{
 render(<TacticalMap scenario={source} time={0} replay={null}/>);
 expect(screen.getByText('Cảnh này không có dữ liệu bản đồ.')).toBeTruthy();
 expect(screen.queryByRole('img')).toBeNull();
});

const mapped:Scenario={...source,environment:{polygons:[{kind:'drivable_area',outer:[[-100,-100],[100,-100],[100,100],[-100,100]],holes:[]}],lines:[],buildings:[],trees:[],poles:[],warnings:[],provenance:[]}};
for(const [View,label,initialSpan] of [[TacticalMap,'map',130],[LidarView,'LiDAR',134]] as const){
 it(`${label} zooms by wheel within 0.5–8×, resets on double-click and for another scene`,()=>{
  const {rerender}=render(<View scenario={mapped} time={0} replay={null}/>);
  const svg=screen.getByRole('img');
  const span=()=>Number(svg.getAttribute('viewBox')!.split(' ')[2]);
  const wheel=(deltaY:number)=>{const e=new WheelEvent('wheel',{deltaY,bubbles:true,cancelable:true});act(()=>{svg.dispatchEvent(e);});return e;};
  expect(span()).toBe(initialSpan);
  expect(screen.queryByRole('button')).toBeNull();
  const returns=screen.queryByTestId('lidar-view')?.getAttribute('data-returns');
  expect(wheel(-100).defaultPrevented).toBe(true);
  expect(span()).toBeLessThan(initialSpan);
  expect(screen.queryByTestId('lidar-view')?.getAttribute('data-returns')).toBe(returns);
  for(let i=0;i<40;i++)wheel(-100);
  expect(span()).toBeCloseTo(initialSpan/8);
  for(let i=0;i<60;i++)wheel(100);
  expect(span()).toBeCloseTo(initialSpan*2);
  act(()=>{svg.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));});
  expect(span()).toBe(initialSpan);
  wheel(-100);
  rerender(<View scenario={{...mapped,id:'new-scene'}} time={0} replay={null}/>);
  expect(span()).toBe(initialSpan);
 });
}
it('keeps map centered on moving ego while zoomed and marks ego in both views',()=>{
 const moving={...mapped,actors:[{...mapped.actors[0],samples:[mapped.actors[0].samples[0],{...mapped.actors[0].samples[0],t_s:1,x_m:10,y_m:20}]}]};
 const {rerender}=render(<TacticalMap scenario={moving} time={0} replay={null}/>);
 act(()=>{screen.getByRole('img').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));});
 rerender(<TacticalMap scenario={moving} time={1} replay={null}/>);
 const box=screen.getByRole('img').getAttribute('viewBox')!.split(' ').map(Number);
 expect(box[0]+box[2]/2).toBe(10);expect(box[1]+box[3]/2).toBe(-20);
 expect(document.querySelector('.map-ego')).toBeTruthy();
 rerender(<LidarView scenario={moving} time={1} replay={null}/>);
 expect(document.querySelector('.lidar-ego')).toBeTruthy();
});

for(const [View,label] of [[TacticalMap,'map'],[LidarView,'LiDAR']] as const){
 it(`${label} pans by dragging, recentres on double-click, and resets for another scene`,()=>{
  const {rerender}=render(<View scenario={mapped} time={0} replay={null}/>);
  const svg=screen.getByRole('img');
  const centre=()=>{const b=svg.getAttribute('viewBox')!.split(' ').map(Number);return [b[0]+b[2]/2,b[1]+b[3]/2];};
  const [x0,y0]=centre();
  const drag=(dx:number,dy:number)=>act(()=>{
   svg.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,button:0,clientX:100,clientY:100,bubbles:true}));
   svg.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:100+dx,clientY:100+dy,bubbles:true}));
   svg.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,clientX:100+dx,clientY:100+dy,bubbles:true}));
  });
  drag(10,-5);
  const [x1,y1]=centre();
  expect(x1).toBeLessThan(x0);   // content follows the pointer, so the frame centre moves the other way
  expect(y1).toBeGreaterThan(y0);
  act(()=>{svg.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));});
  expect(centre()).toEqual([x0,y0]);
  drag(4,4);
  rerender(<View scenario={{...mapped,id:'other'}} time={0} replay={null}/>);
  expect(centre()).toEqual([x0,y0]);
 });
}

