import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box3D, ObjectsDenseData } from '../api/types';
import { computeBoxCorners, BOX_EDGES } from '../geometry/projection';
import { globalFpsTracker } from '../perf';

interface ThreeViewProps {
  pointsData: Float32Array | null;
  denseData?: ObjectsDenseData | null;
  boxes: Box3D[];
  selectedBoxId: string | null;
  onSelectBox: (boxId: string | null) => void;
  showColor: boolean;
  showRaw: boolean;
  showBoxes: boolean;
  showDense?: boolean;
  onRenderReady?: () => void;
}

export const ThreeView: React.FC<ThreeViewProps> = ({
  pointsData,
  denseData,
  boxes,
  selectedBoxId,
  onSelectBox,
  showColor,
  showRaw,
  showBoxes,
  showDense = false,
  onRenderReady,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const pointsMeshRef = useRef<THREE.Points | null>(null);
  const denseMeshRef = useRef<THREE.Points | null>(null);
  const denseHighlightMeshRef = useRef<THREE.Points | null>(null);
  const boxGroupRef = useRef<THREE.Group | null>(null);

  const [displayFps, setDisplayFps] = useState<number>(60);

  // Setup scene, camera, renderer, controls once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050505');
    sceneRef.current = scene;

    // LiDAR convention: x right, y front, z up
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.2, 500);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -22, 14);
    camera.lookAt(0, 6, -1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 6, -1);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controlsRef.current = controls;

    // Ground plane grid (in z = -1.8 m)
    const grid = new THREE.GridHelper(80, 80, 0x334155, 0x1e293b);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -1.8;
    scene.add(grid);

    // Coordinate axes (red: x right, green: y front, blue: z up)
    const axes = new THREE.AxesHelper(3);
    axes.position.set(0, 0, -1.8);
    scene.add(axes);

    // Group for 3D boxes
    const boxGroup = new THREE.Group();
    scene.add(boxGroup);
    boxGroupRef.current = boxGroup;

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      globalFpsTracker.recordFrame();
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const fpsInterval = setInterval(() => {
      setDisplayFps(Math.round(globalFpsTracker.getCurrentFps()));
    }, 500);

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      clearInterval(fpsInterval);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update Points Geometry and Colors
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (!pointsData || pointsData.length === 0) {
      if (pointsMeshRef.current) {
        scene.remove(pointsMeshRef.current);
        pointsMeshRef.current.geometry.dispose();
        (pointsMeshRef.current.material as THREE.Material).dispose();
        pointsMeshRef.current = null;
      }
      return;
    }

    const numPoints = Math.floor(pointsData.length / 7);
    const positions = new Float32Array(numPoints * 3);
    const colors = new Float32Array(numPoints * 3);

    const useIntensityOnly = showRaw || !showColor;

    for (let i = 0; i < numPoints; i++) {
      const offset = i * 7;
      const x = pointsData[offset + 0];
      const y = pointsData[offset + 1];
      const z = pointsData[offset + 2];
      const intensity = pointsData[offset + 3];
      const r = pointsData[offset + 4];
      const g = pointsData[offset + 5];
      const b = pointsData[offset + 6];

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      if (!useIntensityOnly && r >= 0) {
        // True RGB coloring
        colors[i * 3 + 0] = r / 255;
        colors[i * 3 + 1] = g / 255;
        colors[i * 3 + 2] = b / 255;
      } else {
        // Intensity coloring (when r < 0 or raw mode is active)
        const norm = Math.min(1.0, Math.max(0.0, intensity / 255));
        if (useIntensityOnly) {
          colors[i * 3 + 0] = norm;
          colors[i * 3 + 1] = norm;
          colors[i * 3 + 2] = norm;
        } else {
          // Viridis / heat-like colormap
          colors[i * 3 + 0] = Math.min(1.0, norm * 2.0);
          colors[i * 3 + 1] = Math.min(1.0, norm * 1.6);
          colors[i * 3 + 2] = Math.max(0.2, 1.0 - norm);
        }
      }
    }

    if (pointsMeshRef.current) {
      const geom = pointsMeshRef.current.geometry;
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geom.attributes.position.needsUpdate = true;
      geom.attributes.color.needsUpdate = true;
      geom.computeBoundingSphere();
    } else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.computeBoundingSphere();

      const material = new THREE.PointsMaterial({
        size: 0.12,
        vertexColors: true,
        sizeAttenuation: true,
      });

      const mesh = new THREE.Points(geometry, material);
      scene.add(mesh);
      pointsMeshRef.current = mesh;
    }

    if (onRenderReady) {
      onRenderReady();
    }
  }, [pointsData, showColor, showRaw, onRenderReady]);

  // Update Dense LiDAR Points (Layer dense: objects_dense)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const cleanup = () => {
      if (denseMeshRef.current) {
        scene.remove(denseMeshRef.current);
        denseMeshRef.current.geometry.dispose();
        (denseMeshRef.current.material as THREE.Material).dispose();
        denseMeshRef.current = null;
      }
      if (denseHighlightMeshRef.current) {
        scene.remove(denseHighlightMeshRef.current);
        denseHighlightMeshRef.current.geometry.dispose();
        (denseHighlightMeshRef.current.material as THREE.Material).dispose();
        denseHighlightMeshRef.current = null;
      }
    };

    if (!showDense || !denseData || denseData.points.length === 0) {
      cleanup();
      return;
    }

    const { points: dPoints, meta } = denseData;
    const numPoints = Math.floor(dPoints.length / 7);

    // Identify selected object range if any
    const selectedObj = selectedBoxId
      ? meta.objects.find((o) => o.id === selectedBoxId)
      : null;

    const positions = new Float32Array(numPoints * 3);
    const colors = new Float32Array(numPoints * 3);
    const highlightPositions: number[] = [];

    const isSelectedIdx = (idx: number) => {
      if (!selectedObj) return false;
      return idx >= selectedObj.start && idx < selectedObj.start + selectedObj.count;
    };

    for (let i = 0; i < numPoints; i++) {
      const offset = i * 7;
      const x = dPoints[offset + 0];
      const y = dPoints[offset + 1];
      const z = dPoints[offset + 2];
      const intensity = dPoints[offset + 3];
      const r = dPoints[offset + 4];
      const g = dPoints[offset + 5];
      const b = dPoints[offset + 6];

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const isSel = isSelectedIdx(i);
      if (isSel) {
        highlightPositions.push(x, y, z);
      }

      if (r >= 0) {
        colors[i * 3 + 0] = isSel ? 0.22 : r / 255;
        colors[i * 3 + 1] = isSel ? 0.74 : g / 255;
        colors[i * 3 + 2] = isSel ? 0.97 : b / 255;
      } else {
        const norm = Math.min(1.0, Math.max(0.0, intensity / 255));
        colors[i * 3 + 0] = isSel ? 0.22 : norm;
        colors[i * 3 + 1] = isSel ? 0.74 : norm;
        colors[i * 3 + 2] = isSel ? 0.97 : norm;
      }
    }

    cleanup();

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeBoundingSphere();

    const mat = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      sizeAttenuation: true,
    });
    const mesh = new THREE.Points(geom, mat);
    scene.add(mesh);
    denseMeshRef.current = mesh;

    if (highlightPositions.length > 0) {
      const hlGeom = new THREE.BufferGeometry();
      hlGeom.setAttribute('position', new THREE.Float32BufferAttribute(highlightPositions, 3));
      hlGeom.computeBoundingSphere();
      const hlMat = new THREE.PointsMaterial({
        size: 0.28,
        color: 0x00f3ff,
        sizeAttenuation: true,
      });
      const hlMesh = new THREE.Points(hlGeom, hlMat);
      scene.add(hlMesh);
      denseHighlightMeshRef.current = hlMesh;
    }
  }, [showDense, denseData, selectedBoxId]);

  // Update 3D Boxes wireframes
  useEffect(() => {
    const group = boxGroupRef.current;
    if (!group) return;

    // Clear previous boxes
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    if (!showBoxes || boxes.length === 0) return;

    for (const box of boxes) {
      const corners = computeBoxCorners(box);
      const isSelected = box.id === selectedBoxId;

      // 12 edges * 2 endpoints = 24 points (plus 2 for heading line)
      const linePositions: number[] = [];
      for (const [i1, i2] of BOX_EDGES) {
        const c1 = corners[i1];
        const c2 = corners[i2];
        linePositions.push(c1[0], c1[1], c1[2]);
        linePositions.push(c2[0], c2[1], c2[2]);
      }

      // Heading line from box center to front edge
      const cosY = Math.cos(box.yaw);
      const sinY = Math.sin(box.yaw);
      const frontX = box.cx + (box.l / 2 + 0.8) * cosY;
      const frontY = box.cy + (box.l / 2 + 0.8) * sinY;
      linePositions.push(box.cx, box.cy, box.cz);
      linePositions.push(frontX, frontY, box.cz);

      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(linePositions, 3)
      );

      const colorHex = isSelected
        ? 0x00f3ff
        : box.label.includes('human')
        ? 0xeab308
        : 0x22c55e;

      const mat = new THREE.LineBasicMaterial({
        color: colorHex,
        linewidth: isSelected ? 3 : 1,
      });

      const lines = new THREE.LineSegments(geom, mat);
      lines.userData = { boxId: box.id };
      group.add(lines);
    }
  }, [boxes, selectedBoxId, showBoxes]);

  // Handle click on canvas to select box in 3D
  const handlePointerDown = (e: React.PointerEvent) => {
    const container = mountRef.current;
    const camera = cameraRef.current;
    if (!container || !camera || !showBoxes) return;

    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    // Check ray distance to box centers
    let closestId: string | null = null;
    let closestDist = Infinity;

    for (const box of boxes) {
      const boxCenter = new THREE.Vector3(box.cx, box.cy, box.cz);
      const distToRay = raycaster.ray.distanceToPoint(boxCenter);
      const boxRadius = Math.max(box.l, box.w, box.h) / 1.5;

      if (distToRay < boxRadius && distToRay < closestDist) {
        closestDist = distToRay;
        closestId = box.id;
      }
    }

    if (closestId !== null) {
      onSelectBox(closestId);
    }
  };

  const resetCamera = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(0, -22, 14);
    controlsRef.current.target.set(0, 6, -1);
    controlsRef.current.update();
  };

  return (
    <div
      ref={mountRef}
      onPointerDown={handlePointerDown}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#050505',
      }}
    >
      {/* Title overlay */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          padding: '4px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 'bold',
          color: '#00f3ff',
          pointerEvents: 'none',
        }}
      >
        3D VIEW (three.js orbit) ·{' '}
        <span style={{ color: displayFps >= 30 ? '#22c55e' : '#f59e0b' }}>
          {displayFps} fps
        </span>
      </div>

      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <button
          onClick={resetCamera}
          title="Reset Camera"
          style={{
            backgroundColor: 'rgba(26, 26, 26, 0.85)',
            color: '#cbd5e1',
            border: '1px solid #333a4d',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '11px',
          }}
        >
          Reset Cam
        </button>
      </div>
    </div>
  );
};
