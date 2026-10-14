import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { pointRgb, type DecodedLidar } from './measuredLidar';
import { defaultPreferences, type Preferences } from './preferences';
import { useT } from "./i18n";

/** Camera presets around the ego (Three axes: x = ego right, y = up, −z = ego forward). */
const TOP = { distance: 120, polar: 0.001 };

/**
 * Measured LiDAR as an orbitable 3D point cloud: drag up/down to tilt, sideways to orbit,
 * right-drag to pan, wheel to zoom, double-click for the top view. Renders on demand, not per frame.
 */
export function LidarPointCloud3D({ identity, data, display = defaultPreferences }: { identity?: string; data: DecodedLidar | null; display?: Pick<Preferences, 'lidarColor' | 'lidarPointSize'> }) {
  const t = useT();
    const host = useRef<HTMLDivElement>(null);
    const api = useRef<{ setData: (d: DecodedLidar | null, view: Pick<Preferences, 'lidarColor' | 'lidarPointSize'>) => void; preset: (p: typeof TOP) => void } | null>(null);
    const [error, setError] = useState('');
    const [tilt, setTilt] = useState(0);
    useEffect(() => {
        const element = host.current;
        if (!element) return;
        let renderer: THREE.WebGLRenderer;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true });
        } catch {
            setError(t('Không khởi tạo được WebGL cho LiDAR 3D.'));
            return;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x181818);
        element.appendChild(renderer.domElement);
        renderer.domElement.className = 'lidar-canvas';
        renderer.domElement.setAttribute('aria-label', t('LiDAR đo thực 3D, kéo để xoay/nghiêng'));
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 600);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.maxPolarAngle = Math.PI / 2 - 0.02;
        controls.minDistance = 5;
        controls.maxDistance = 300;
        controls.screenSpacePanning = true;
        const rings = new THREE.Group();
        for (const r of [20, 40, 60, 80, 100]) {
            const points = Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * r, 0, Math.sin((i / 128) * Math.PI * 2) * r));
            rings.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x3a3a3a })));
        }
        scene.add(rings);
        const ego = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.5, 4.5), new THREE.MeshBasicMaterial({ color: 0xda291c }));
        ego.position.set(0, 0.75, -1.3); // nuScenes ego origin is the rear axle on the ground
        scene.add(ego);
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true });
        const cloud = new THREE.Points(geometry, material);
        scene.add(cloud);
        const render = () => {
            renderer.render(scene, camera);
            setTilt(Math.round(THREE.MathUtils.radToDeg(controls.getPolarAngle())));
        };
        const preset = (p: typeof TOP) => {
            controls.target.set(0, 0, 0);
            // Forward (−z) points up the screen in the top view; tilted views look forward from behind.
            camera.position.set(0, Math.cos(p.polar) * p.distance, Math.sin(p.polar) * p.distance);
            camera.up.set(0, 1, 0);
            controls.update();
            render();
        };
        api.current = {
            setData: (d, view) => {
                material.size = view.lidarPointSize;
                if (!d) { geometry.setDrawRange(0, 0); render(); return; }
                const n = d.frame.count, positions = new Float32Array(n * 3), colours = new Float32Array(n * 3);
                for (let i = 0; i < n; i++) {
                    const x = d.xyz[i * 3] / 100, y = d.xyz[i * 3 + 1] / 100, z = d.xyz[i * 3 + 2] / 100;
                    positions[i * 3] = -y; positions[i * 3 + 1] = z; positions[i * 3 + 2] = -x;
                    const [r, g, b] = pointRgb(view.lidarColor, x, y, z, d.intensity[i]);
                    colours[i * 3] = r / 255; colours[i * 3 + 1] = g / 255; colours[i * 3 + 2] = b / 255;
                }
                geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
                geometry.setDrawRange(0, n);
                geometry.computeBoundingSphere();
                render();
            },
            preset,
        };
        controls.addEventListener('change', render);
        const top = () => preset(TOP);
        renderer.domElement.addEventListener('dblclick', top);
        const resize = new ResizeObserver(() => {
            const w = element.clientWidth, h = element.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            render();
        });
        resize.observe(element);
        preset(TOP);
        return () => {
            api.current = null;
            renderer.domElement.removeEventListener('dblclick', top);
            resize.disconnect();
            controls.dispose();
            scene.traverse(o => {
                const mesh = o as THREE.Mesh;
                mesh.geometry?.dispose();
                (Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []).forEach(m => m.dispose());
            });
            renderer.dispose();
            renderer.domElement.remove();
        };
    }, []);
    useEffect(() => { api.current?.setData(data, display); }, [data, display.lidarColor, display.lidarPointSize]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { api.current?.preset(TOP); }, [identity]);
    return <div className="lidar-3d" data-tilt={tilt}>
      <div ref={host} className="lidar-3d-host"/>
      {error && <div className="view-empty">{error}</div>}
    </div>;
}
