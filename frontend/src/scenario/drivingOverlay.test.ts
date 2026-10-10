import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createDrivingOverlay } from './drivingOverlay';
const pose=(t_s:number,x_m:number)=>({t_s,x_m,y_m:0,z_m:0,yaw_rad:0,observed:true});
it('draws only supported future trajectory and removes unsupported/end paths',()=>{
 const scene=new THREE.Scene(),overlay=createDrivingOverlay(scene,0,2);
 const corridor=scene.children[0] as THREE.Mesh;
 overlay.update(pose(0,0),[pose(0,0),pose(.5,3),pose(2,30)],1);
 expect(corridor.geometry.drawRange.count).toBe(6);
 const positions=corridor.geometry.attributes.position;
 expect(positions.getX(2)).toBe(3);
 overlay.update(pose(2,30),[pose(0,0),pose(.5,3),pose(2,30)],1);
 expect(corridor.geometry.drawRange.count).toBe(0);
 overlay.update(null,[],1);expect(corridor.visible).toBe(false);
});
