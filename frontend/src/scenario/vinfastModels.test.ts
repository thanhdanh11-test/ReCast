import { expect, it } from 'vitest';
import * as THREE from 'three';
import { loadVinfastTemplate, VINFAST_CREDIT } from './vinfastModels';
import { instantiateAssetModel, disposeActorTemplates } from './assetModels';
const triangles=(g:THREE.Group)=>{let total=0;g.traverse(o=>{if(o instanceof THREE.Mesh)total+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});return total;};
it('loads authentic offline VF3, fits pose boxes and colors body only with explicit lower LOD',async()=>{
 const pair=await loadVinfastTemplate();expect(triangles(pair.high)).toBeLessThanOrEqual(50000);expect(triangles(pair.distant)).toBeLessThanOrEqual(8000);
 expect(VINFAST_CREDIT.author).toContain('Hoàng Huy');expect(VINFAST_CREDIT.source_triangles).toBe(262981);
 const templates={sedan:pair,suv:pair,ego:pair};
 const actor={id:'ego',role:'ego',category:'vehicle.car',length_m:4.5,width_m:1.85,height_m:1.6,samples:[]};
 const source=instantiateAssetModel(actor,false,templates)!;const imported=instantiateAssetModel(actor,true,templates)!;
 const sourceBounds=new THREE.Box3().setFromObject(source),importBounds=new THREE.Box3().setFromObject(imported);
 expect(sourceBounds.min.y).toBeCloseTo(0);expect(importBounds.getCenter(new THREE.Vector3()).y).toBeCloseTo(0);
 expect(sourceBounds.getSize(new THREE.Vector3()).toArray()).toEqual(expect.arrayContaining([expect.closeTo(4.5,4),expect.closeTo(1.6,4),expect.closeTo(1.85,4)]));
 let body=0,trim=0;pair.high.traverse(o=>{if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshStandardMaterial;if(m.userData.lamp)return;if(m.userData.actorSurface==='paint'){expect(m.color.getHex()).toBe(0xda291c);body++;}else{expect(m.color.r).toBe(m.color.g);trim++;}}});expect(body).toBeGreaterThan(0);expect(trim).toBeGreaterThan(0);
 disposeActorTemplates(templates);
});
it('rejects cancelled VinFast loads before attaching meshes',async()=>{const c=new AbortController();c.abort();await expect(loadVinfastTemplate(c.signal)).rejects.toMatchObject({name:'AbortError'});});
