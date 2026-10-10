import * as THREE from 'three';
import highBase64 from './assets/models/vinfast-vf3-high.glb.base64?raw';
import lowBase64 from './assets/models/vinfast-vf3-low.glb.base64?raw';
import credit from './assets/models/vinfast-vf3-attribution.json';
import { parseActorTemplate, type AssetTemplatePair } from './assetModels';
export const VINFAST_CREDIT = credit;
const decode=(text:string)=>{const binary=atob(text.trim());const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes.buffer;};
export async function loadVinfastTemplate(signal?:AbortSignal):Promise<AssetTemplatePair>{
 const parts:AssetTemplatePair[]=[];
 const dispose=(groups:THREE.Group[],materials:boolean)=>{const geometries=new Set<THREE.BufferGeometry>(),mats=new Set<THREE.Material>();for(const g of groups)g.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);}});geometries.forEach(g=>g.dispose());if(materials)mats.forEach(m=>m.dispose());};
 try {
  for(const [data,id] of [[highBase64,'vinfast-vf3-high'],[lowBase64,'vinfast-vf3-low']]){
   if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
   parts.push(await parseActorTemplate(decode(data),id));
  }
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const high=parts[0].high,distant=parts[1].high;
  dispose(parts.map(p=>p.distant),false); // Generated clustering is unused; explicit optimized low GLB is authoritative.
  for(const group of [high,distant]){group.userData.assetCredit=credit;group.traverse(o=>{if(o instanceof THREE.Mesh){const mat=o.material as THREE.MeshStandardMaterial;if(mat.userData.actorSurface==='paint')mat.color.setHex(0xda291c);}});}
  return {high,distant,id:'vinfast-vf3'};
 }catch(error){dispose(parts.flatMap(p=>[p.high,p.distant]),true);throw error;}
}
