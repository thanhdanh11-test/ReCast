import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createWeatherEffects } from './weatherEffects';
import { defaultEnvironmentSettings } from './weather';
it('changes illumination and wet surfaces without moving scene actors',()=>{
 const scene=new THREE.Scene(), sun=new THREE.DirectionalLight(), ambient=new THREE.HemisphereLight();
 const roadMaterial=new THREE.MeshStandardMaterial({roughness:.88}); roadMaterial.userData.roadSurface=true;
 const road=new THREE.Mesh(new THREE.PlaneGeometry(10,10),roadMaterial); scene.add(road);
 const actor=new THREE.Group();actor.position.set(4,3,2);scene.add(actor);
 const effects=createWeatherEffects(scene,sun,ambient,new THREE.Vector3());
 const clear=defaultEnvironmentSettings().weather; effects.apply(clear);const noon=sun.intensity;
 effects.apply({...clear,sun_altitude_angle:-90,wetness:100,precipitation:100});
 expect(sun.intensity).toBeLessThan(noon);expect(roadMaterial.roughness).toBeCloseTo(.18);
 effects.update(.016,new THREE.Vector3(2,3,4));expect(actor.position.toArray()).toEqual([4,3,2]);
 effects.apply(clear);expect(roadMaterial.roughness).toBeCloseTo(.88);
 const rain=scene.children.find(o=>o instanceof THREE.Points);expect(rain?.visible).toBe(false);
});
