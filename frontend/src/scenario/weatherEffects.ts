import * as THREE from 'three';
import type { CarlaWeatherParameters } from './weather';

/** Presentation adapter; atmospheric scattering is approximated, physics is unchanged. */
export function createWeatherEffects(scene: THREE.Scene, sun: THREE.DirectionalLight,
  ambient: THREE.HemisphereLight, center: THREE.Vector3) {
  const count = 1800, positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = ((i * 73.17) % 120) - 60;
    positions[i * 3 + 1] = (i * 13.31) % 40;
    positions[i * 3 + 2] = ((i * 39.79) % 120) - 60;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({color:0xdddddd, size:.065, transparent:true,
    opacity:0, depthWrite:false});
  const rain = new THREE.Points(geometry, material);
  rain.frustumCulled = false; rain.visible = false; scene.add(rain);
  const roads: THREE.MeshStandardMaterial[] = [];
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(object.material) ? object.material : [object.material])
      if (m instanceof THREE.MeshStandardMaterial && m.userData.roadSurface && !roads.includes(m)) roads.push(m);
  });
  let weather: CarlaWeatherParameters | null = null;
  function apply(next: CarlaWeatherParameters) {
    weather = next;
    const altitude = THREE.MathUtils.degToRad(next.sun_altitude_angle);
    const azimuth = THREE.MathUtils.degToRad(next.sun_azimuth_angle < 0 ? 135 : next.sun_azimuth_angle);
    const daylight = Math.max(0, Math.sin(altitude));
    const cloud = next.cloudiness / 100;
    const shade = Math.round(36 + daylight * (196 - cloud * 65));
    const sky = new THREE.Color().setRGB(shade / 255, shade / 255, shade / 255);
    scene.background = sky;
    const density = .0008 + next.fog_density / 100 * .025 + next.dust_storm / 100 * .012;
    scene.fog = new THREE.Fog(sky, Math.max(1,next.fog_distance), Math.max(30, 3 / density));
    sun.position.copy(center).add(new THREE.Vector3(Math.cos(azimuth)*Math.cos(altitude)*80,
      Math.sin(altitude)*80, Math.sin(azimuth)*Math.cos(altitude)*80));
    sun.target.position.copy(center); sun.target.updateMatrixWorld();
    sun.intensity = daylight * (3.1 - cloud * 2.4);
    ambient.intensity = .24 + daylight * (1.7 + cloud * .3);
    material.opacity = next.precipitation / 100 * .7;
    rain.visible = next.precipitation > 0;
    geometry.setDrawRange(0, Math.round(count * next.precipitation / 100));
    const surfaceWetness = Math.max(next.wetness, next.precipitation_deposits * .7, next.precipitation * .5);
    for (const m of roads) m.roughness = THREE.MathUtils.lerp(m.userData.dryRoughness ?? .88,.18,surfaceWetness/100);
  }
  function update(delta: number, focus: THREE.Vector3) {
    if (!weather || !rain.visible) return;
    rain.position.copy(focus);
    const wind = weather.wind_intensity / 100 * 6;
    for (let i=0;i<count;i++) {
      positions[i*3] = ((positions[i*3] + wind*delta + 60) % 120) - 60;
      positions[i*3+1] -= delta * (14 + weather.precipitation / 10);
      if (positions[i*3+1] < 0) positions[i*3+1] += 40;
    }
    geometry.attributes.position.needsUpdate = true;
  }
  return {apply,update};
}
