// @vitest-environment happy-dom
import {render,screen,cleanup,fireEvent,act} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {LidarView} from './LidarView';
import {TacticalMap} from './TacticalMap';
import type {Scenario} from './types';
afterEach(cleanup);
const source:Scenario={id:'source',mode:'source',interval_s:[0,1],source:{scene:'test',selected_interval_s:[0,1]},road:{kind:'source_map'},actors:[{id:'ego',role:'ego',category:'vehicle.car',length_m:4,width_m:2,samples:[{t_s:0,x_m:0,y_m:0,z_m:0,yaw_rad:0,observed:true}]}]};
it('distinguishes source missing environment from extracted actor-only scans',()=>{
 const {rerender}=render(<LidarView scenario={source} time={0} replay={null}/>);
 expect(screen.getByText(/Thiếu môi trường; chỉ quét các đối tượng nguồn/)).toBeTruthy();
 rerender(<LidarView scenario={{...source,mode:undefined}} time={0} replay={null}/>);
 expect(screen.getByText(/Chỉ các đối tượng trong trích đoạn/)).toBeTruthy();
});
it('does not invent a map when vectors are absent',()=>{
 render(<TacticalMap scenario={source} time={0} replay={null}/>);
 expect(screen.getByText('Cảnh này không có dữ liệu bản đồ.')).toBeTruthy();
 expect(screen.queryByRole('img')).toBeNull();
});

const mapped:Scenario={...source,environment:{polygons:[{kind:'drivable_area',outer:[[-100,-100],[100,-100],[100,100],[-100,100]],holes:[]}],lines:[],buildings:[],trees:[],poles:[],warnings:[],provenance:[]}};
for(const [View,label,initialSpan] of [[TacticalMap,'map',130],[LidarView,'LiDAR',134]] as const){
 it(`${label} zooms by buttons/wheel, clamps bounds and resets for another scene`,()=>{
  const {rerender}=render(<View scenario={mapped} time={0} replay={null}/>);
  const svg=screen.getByRole('img');
  const span=()=>Number(svg.getAttribute('viewBox')!.split(' ')[2]);
  expect(span()).toBe(initialSpan);
  fireEvent.click(screen.getByRole('button',{name:`Phóng to ${label}`}));
  expect(span()).toBeLessThan(initialSpan);
  const returns=screen.queryByTestId('lidar-view')?.getAttribute('data-returns');
  const wheel=new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true});
  act(()=>{svg.dispatchEvent(wheel);});
  expect(wheel.defaultPrevented).toBe(true);
  expect(span()).toBeLessThan(initialSpan/1.25);
  expect(screen.queryByTestId('lidar-view')?.getAttribute('data-returns')).toBe(returns);
  for(let i=0;i<30;i++)fireEvent.click(screen.getByRole('button',{name:`Phóng to ${label}`}));
  expect(span()).toBe(initialSpan/8);
  expect((screen.getByRole('button',{name:`Phóng to ${label}`}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:`Đặt lại zoom ${label}`}));
  expect(span()).toBe(initialSpan);
  expect((screen.getByRole('button',{name:`Thu nhỏ ${label}`}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:`Phóng to ${label}`}));
  rerender(<View scenario={{...mapped,id:'new-scene'}} time={0} replay={null}/>);
  expect(span()).toBe(initialSpan);
 });
}
it('keeps map centered on moving ego while zoomed and marks ego in both views',()=>{
 const moving={...mapped,actors:[{...mapped.actors[0],samples:[mapped.actors[0].samples[0],{...mapped.actors[0].samples[0],t_s:1,x_m:10,y_m:20}]}]};
 const {rerender}=render(<TacticalMap scenario={moving} time={0} replay={null}/>);
 fireEvent.click(screen.getByRole('button',{name:'Phóng to map'}));
 rerender(<TacticalMap scenario={moving} time={1} replay={null}/>);
 const box=screen.getByRole('img').getAttribute('viewBox')!.split(' ').map(Number);
 expect(box[0]+box[2]/2).toBe(10);expect(box[1]+box[3]/2).toBe(-20);
 expect(document.querySelector('.map-ego')).toBeTruthy();
 rerender(<LidarView scenario={moving} time={1} replay={null}/>);
 expect(document.querySelector('.lidar-ego')).toBeTruthy();
});
