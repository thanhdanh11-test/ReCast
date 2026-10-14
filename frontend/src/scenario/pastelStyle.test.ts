import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { updateMapCameraDepth } from './pastelStyle';
import { roadScene, disposeScene } from './scene3d';
import type { Scenario } from './types';

describe('pastel display', () => {
  it('improves distant depth precision and restores cabin near plane', () => {
    const camera = new THREE.PerspectiveCamera(48, 1, .1, 1600);
    camera.position.set(0, 500, 0);
    updateMapCameraDepth(camera, new THREE.Vector3(), false);
    expect(camera.near).toBe(10);
    updateMapCameraDepth(camera, new THREE.Vector3(), true);
    expect(camera.near).toBe(.1);
  });
  it('renders expanded imported map with terrain without changing actor samples', () => {
    const scenario: Scenario = {mode:'imported', id:'test', interval_s:[0,1], source:{scene:'test'}, actors:[{
      id:'ego',role:'ego',category:'vehicle.car',length_m:4,width_m:2,height_m:2,
      samples:[{t_s:0,x_m:0,y_m:0,z_m:1,yaw_rad:0,observed:true}],
    }],environment:{polygons:[],lines:[],buildings:[],trees:[],poles:[],warnings:[],provenance:[],presentation:{
      schema_version:1,style:'pastel-v1',bounds_m:[-210,-210,210,210],
      ground:{cell_m:2,samples:[[0,0,0,10,0],[2,0,0,10,0],[0,2,0,10,0],[2,2,0,10,0]]},
      surfaces:[{kind:'drivable_area',outer:[[-4,-4],[4,-4],[4,4],[-4,4]],holes:[]}],
      buildings:[],diagnostics:[],
    }}};
    const before = JSON.stringify(scenario);
    const road = roadScene(scenario);
    expect(road.radius).toBeGreaterThan(500);
    expect(road.ground.active).toBe(true);
    let pastelRoad = false;
    road.group.traverse(o => {if(o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.color.getHex() === 0x929299) pastelRoad = true;});
    expect(pastelRoad).toBe(true);
    expect(JSON.stringify(scenario)).toBe(before);
    const scene = new THREE.Scene();scene.add(road.group);disposeScene(scene);
  });
});
