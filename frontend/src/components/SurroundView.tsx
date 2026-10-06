import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Box3D, PanoMeta } from '../api/types';
import { computeBoxCorners, BOX_EDGES } from '../geometry/projection';
import {
  parseDepthBuffer,
  buildSurroundSphereGeometry,
  buildBackgroundSphereGeometry,
  SurroundSphereMeshResult,
} from '../geometry/panorama';
import { globalFpsTracker } from '../perf';

export interface SurroundViewProps {
  panoMeta?: PanoMeta | null;
  panoDepthBuffer?: ArrayBuffer | null;
  panoRgbUrl?: string | null;
  panoAlphaUrl?: string | null;
  bevUrl?: string | null;
  showGround?: boolean;
  boxes: Box3D[];
  selectedBoxId: string | null;
  onSelectBox: (boxId: string | null) => void;
  showBoxes?: boolean;
  groundZ?: number;
  is404?: boolean;
  onRenderReady?: () => void;
}

export const SurroundView: React.FC<SurroundViewProps> = ({
  panoMeta,
  panoDepthBuffer,
  panoRgbUrl,
  panoAlphaUrl,
  bevUrl,
  showGround = true,
  boxes,
  selectedBoxId,
  onSelectBox,
  showBoxes = true,
  groundZ = -1.84,
  is404 = false,
  onRenderReady,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Scene component groups
  const panoMeshRef = useRef<THREE.Mesh | null>(null);
  const bgSphereMeshRef = useRef<THREE.Mesh | null>(null);
  const groundMeshRef = useRef<THREE.Mesh | null>(null);
  const boxGroupRef = useRef<THREE.Group | null>(null);
  const egoGroupRef = useRef<THREE.Group | null>(null);

  // Camera spherical coordinates (pitch 10°-89°, default 35°, default distance 12m)
  const [pitch, setPitch] = useState<number>(35);
  const [yaw, setYaw] = useState<number>(0);
  const [distance, setDistance] = useState<number>(12);

  const [displayFps, setDisplayFps] = useState<number>(60);
  const [meshStats, setMeshStats] = useState<{
    triangles: number;
    droppedTriangles: number;
  } | null>(null);

  // Drag interaction state
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragDistanceRef = useRef<number>(0);

  // Update orbit camera position and up vector
  const updateCameraTransform = useCallback((pDeg: number, yDeg: number, dist: number) => {
    const cam = cameraRef.current;
    if (!cam) return;

    // Pitch clamped strictly in [10°, 89°] per SPEC-P09 §3
    const clampedP = Math.max(10, Math.min(89, pDeg));
    const pRad = (clampedP * Math.PI) / 180;
    const yRad = (yDeg * Math.PI) / 180;

    // Ego vehicle center target in LIDAR_TOP
    const targetZ = groundZ + 0.8;

    // Camera position orbiting around (0, 0, targetZ)
    // When yaw = 0, camera is at -y (behind vehicle) looking towards +y (forward)
    const cx = -dist * Math.cos(pRad) * Math.sin(yRad);
    const cy = -dist * Math.cos(pRad) * Math.cos(yRad);
    const cz = targetZ + dist * Math.sin(pRad);

    // Exact tangent up vector to avoid gimbal distortion
    const ux = Math.sin(pRad) * Math.sin(yRad);
    const uy = Math.sin(pRad) * Math.cos(yRad);
    const uz = Math.cos(pRad);

    cam.position.set(cx, cy, cz);
    cam.up.set(ux, uy, uz);
    cam.lookAt(0, 0, targetZ);
    cam.updateMatrixWorld();
  }, [groundZ]);

  // Sync camera transform whenever pitch, yaw, or distance changes
  useEffect(() => {
    updateCameraTransform(pitch, yaw, distance);
  }, [pitch, yaw, distance, updateCameraTransform]);

  // 1. Initialize Three.js scene and renderer
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090d16');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.2, 500);
    cameraRef.current = camera;
    updateCameraTransform(pitch, yaw, distance);

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;
    } catch {
      // Fallback for headless testing environments without WebGL
    }

    // Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    // Ego vehicle group: 4.5m x 1.9m x 1.6m footprint in LIDAR_TOP per SPEC-P09 §3
    const egoGroup = new THREE.Group();
    egoGroup.name = 'ego-vehicle-group';

    const egoW = 1.9; // x axis (width)
    const egoL = 4.5; // y axis (length)
    const egoH = 1.6; // z axis (height)
    const egoZ = groundZ + egoH / 2;

    const egoGeom = new THREE.BoxGeometry(egoW, egoL, egoH);
    const egoWireGeom = new THREE.WireframeGeometry(egoGeom);
    const egoWireMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
    const egoWire = new THREE.LineSegments(egoWireGeom, egoWireMat);

    const egoBodyMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.35,
    });
    const egoBody = new THREE.Mesh(egoGeom, egoBodyMat);

    // Heading arrow at front of vehicle (+y)
    const arrowGeom = new THREE.ConeGeometry(0.4, 0.9, 8);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const arrowMesh = new THREE.Mesh(arrowGeom, arrowMat);
    arrowMesh.rotation.x = Math.PI / 2;
    arrowMesh.position.set(0, egoL / 2 + 0.5, 0);

    egoGroup.add(egoBody);
    egoGroup.add(egoWire);
    egoGroup.add(arrowMesh);
    egoGroup.position.set(0, 0, egoZ);
    scene.add(egoGroup);
    egoGroupRef.current = egoGroup;

    // Boxes group
    const boxGroup = new THREE.Group();
    boxGroup.name = 'boxes-wireframe-group';
    scene.add(boxGroup);
    boxGroupRef.current = boxGroup;

    // Animation & render loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      globalFpsTracker.recordFrame();
      setDisplayFps(Math.round(globalFpsTracker.getCurrentFps()));
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth || 600;
      const h = mountRef.current.clientHeight || 400;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current && rendererRef.current.domElement) {
        if (rendererRef.current.domElement.parentElement) {
          rendererRef.current.domElement.parentElement.removeChild(
            rendererRef.current.domElement
          );
        }
        rendererRef.current.dispose();
      }
    };
  }, []);

  // 2. Ground Plane (120x120m plane at z = groundZ textured with bev.png per SPEC-P09 §5 F2)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Dispose old ground mesh
    if (groundMeshRef.current) {
      scene.remove(groundMeshRef.current);
      groundMeshRef.current.geometry.dispose();
      if (Array.isArray(groundMeshRef.current.material)) {
        groundMeshRef.current.material.forEach((m) => m.dispose());
      } else {
        groundMeshRef.current.material.dispose();
      }
      groundMeshRef.current = null;
    }

    if (!showGround || !bevUrl) return;

    const planeGeom = new THREE.PlaneGeometry(120, 120);
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      bevUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const planeMat = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        const mesh = new THREE.Mesh(planeGeom, planeMat);
        mesh.name = 'surround-ground-bev-mesh';
        mesh.position.set(0, 0, groundZ);
        mesh.renderOrder = 0;
        mesh.userData = { groundZ, width: 120, height: 120 };
        scene.add(mesh);
        groundMeshRef.current = mesh;
      },
      undefined,
      (err) => {
        // Graceful fallback if bevUrl fails to load (404/network error) - no crash
        console.warn('SurroundView: failed to load bev.png (404/error):', err);
      }
    );
  }, [bevUrl, groundZ, showGround]);

  // 3. Build and update Surround Bowl Mesh & Background Sphere from depth buffer and textures
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Clear previous pano mesh
    if (panoMeshRef.current) {
      scene.remove(panoMeshRef.current);
      panoMeshRef.current.geometry.dispose();
      if (Array.isArray(panoMeshRef.current.material)) {
        panoMeshRef.current.material.forEach((m) => m.dispose());
      } else {
        panoMeshRef.current.material.dispose();
      }
      panoMeshRef.current = null;
    }

    // Clear previous background sphere mesh
    if (bgSphereMeshRef.current) {
      scene.remove(bgSphereMeshRef.current);
      bgSphereMeshRef.current.geometry.dispose();
      if (Array.isArray(bgSphereMeshRef.current.material)) {
        bgSphereMeshRef.current.material.forEach((m) => m.dispose());
      } else {
        bgSphereMeshRef.current.material.dispose();
      }
      bgSphereMeshRef.current = null;
    }

    if (is404 || !panoMeta || !panoDepthBuffer || !panoRgbUrl) {
      setMeshStats(null);
      if (onRenderReady) onRenderReady();
      return;
    }

    try {
      // Decode depth buffer (uint16 mm, little-endian DataView per SPEC-P09 §2 & §3)
      const depthMeters = parseDepthBuffer(
        panoDepthBuffer,
        panoMeta.depth_width,
        panoMeta.depth_height,
        panoMeta.depth_unit_m || 0.001
      );

      // Construct 256×128 spherical mesh, dropping discontinuous triangles (> 2m and > 20%)
      const meshData: SurroundSphereMeshResult = buildSurroundSphereGeometry(
        panoMeta,
        depthMeters,
        256,
        128
      );

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(meshData.positions, 3)
      );
      geometry.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
      geometry.computeVertexNormals();

      // F1: Construct complete background sphere at max_depth_m (default 60m), centered at C
      const maxDepth = panoMeta.max_depth_m || 60.0;
      const bgMeshData = buildBackgroundSphereGeometry(panoMeta, maxDepth, 128, 64);
      const bgGeometry = new THREE.BufferGeometry();
      bgGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(bgMeshData.positions, 3)
      );
      bgGeometry.setAttribute('uv', new THREE.BufferAttribute(bgMeshData.uvs, 2));
      bgGeometry.setIndex(new THREE.BufferAttribute(bgMeshData.indices, 1));
      bgGeometry.computeVertexNormals();

      // Load RGB panorama and Alpha map
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(panoRgbUrl, (rgbTexture) => {
        rgbTexture.colorSpace = THREE.SRGBColorSpace;
        rgbTexture.wrapS = THREE.ClampToEdgeWrapping;
        rgbTexture.wrapT = THREE.ClampToEdgeWrapping;

        const onTexturesReady = (alphaTexture?: THREE.Texture) => {
          // Bowl material: alphaTest: 0.05 ensures alpha=0 fragments below horizon are transparent and discarded
          const bowlMaterial = new THREE.MeshBasicMaterial({
            map: rgbTexture,
            ...(alphaTexture ? { alphaMap: alphaTexture } : {}),
            transparent: true,
            alphaTest: 0.05,
            side: THREE.DoubleSide,
            depthWrite: true,
          });

          const bowlMesh = new THREE.Mesh(geometry, bowlMaterial);
          bowlMesh.name = 'surround-bowl-mesh';
          bowlMesh.renderOrder = 1;
          scene.add(bowlMesh);
          panoMeshRef.current = bowlMesh;

          // Background sphere material: rendered behind bowl mesh
          const bgMaterial = new THREE.MeshBasicMaterial({
            map: rgbTexture,
            ...(alphaTexture ? { alphaMap: alphaTexture } : {}),
            transparent: true,
            alphaTest: 0.05,
            side: THREE.DoubleSide,
            depthWrite: true,
            depthFunc: THREE.LessEqualDepth,
          });

          const bgMesh = new THREE.Mesh(bgGeometry, bgMaterial);
          bgMesh.name = 'surround-background-sphere';
          bgMesh.renderOrder = 2; // rendered after mesh bát
          bgMesh.userData = {
            radius: maxDepth,
            center: panoMeta.center,
          };
          scene.add(bgMesh);
          bgSphereMeshRef.current = bgMesh;

          setMeshStats({
            triangles: meshData.indices.length / 3,
            droppedTriangles: meshData.droppedTriangles,
          });

          if (onRenderReady) onRenderReady();
        };

        if (panoAlphaUrl) {
          textureLoader.load(
            panoAlphaUrl,
            (alphaTexture) => {
              alphaTexture.wrapS = THREE.ClampToEdgeWrapping;
              alphaTexture.wrapT = THREE.ClampToEdgeWrapping;
              onTexturesReady(alphaTexture);
            },
            undefined,
            () => {
              onTexturesReady();
            }
          );
        } else {
          onTexturesReady();
        }
      });
    } catch {
      // Graceful fallback on build error
    }
  }, [panoMeta, panoDepthBuffer, panoRgbUrl, panoAlphaUrl, is404, onRenderReady]);

  // 3. Update Wireframe 3D Boxes & synchronization
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

      const linePositions: number[] = [];
      for (const [i1, i2] of BOX_EDGES) {
        const c1 = corners[i1];
        const c2 = corners[i2];
        linePositions.push(c1[0], c1[1], c1[2]);
        linePositions.push(c2[0], c2[1], c2[2]);
      }

      // Front heading line
      const cosY = Math.cos(box.yaw);
      const sinY = Math.sin(box.yaw);
      const frontX = box.cx + (box.l / 2 + 0.6) * cosY;
      const frontY = box.cy + (box.l / 2 + 0.6) * sinY;
      linePositions.push(box.cx, box.cy, box.cz);
      linePositions.push(frontX, frontY, box.cz);

      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(linePositions, 3)
      );

      const colorHex = isSelected
        ? 0x38bdf8
        : box.label === 'vehicle'
        ? 0x22c55e
        : 0xf59e0b;

      const mat = new THREE.LineBasicMaterial({
        color: colorHex,
        linewidth: isSelected ? 3 : 1,
      });

      const lines = new THREE.LineSegments(geom, mat);
      lines.userData = { boxId: box.id };
      group.add(lines);
    }
  }, [boxes, selectedBoxId, showBoxes]);

  // 4. Pointer Interaction (Orbit drag, click raycasting to select box, wheel zoom)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragDistanceRef.current = 0;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragDistanceRef.current += Math.hypot(dx, dy);

    // Orbit: horizontal drag updates yaw, vertical drag updates pitch (10°-89°)
    setYaw((prev) => prev - dx * 0.45);
    setPitch((prev) => Math.max(10, Math.min(89, prev + dy * 0.35)));

    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current && dragDistanceRef.current < 5) {
      // User clicked without dragging -> perform raycasting to select box
      const container = mountRef.current;
      const camera = cameraRef.current;
      if (container && camera && showBoxes && boxes.length > 0) {
        const rect = container.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

        let closestId: string | null = null;
        let closestDist = Infinity;

        for (const box of boxes) {
          const centerVec = new THREE.Vector3(box.cx, box.cy, box.cz);
          const distToRay = raycaster.ray.distanceToPoint(centerVec);
          const boxRadius = Math.max(box.l, box.w, box.h) / 1.3;

          if (distToRay < boxRadius && distToRay < closestDist) {
            closestDist = distToRay;
            closestId = box.id;
          }
        }

        if (closestId !== null) {
          onSelectBox(closestId);
        }
      }
    }
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Zoom: distance clamped between 3m and 50m
    setDistance((prev) => Math.max(3, Math.min(50, prev + e.deltaY * 0.015)));
  };

  const handleResetCamera = () => {
    setPitch(35);
    setYaw(0);
    setDistance(12);
  };

  const selectedBox = boxes.find((b) => b.id === selectedBoxId);

  return (
    <div
      data-testid="surround-view-container"
      ref={mountRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      data-bg-radius={panoMeta?.max_depth_m || 60}
      data-ground-z={groundZ}
      data-ground-visible={showGround ? 'true' : 'false'}
      data-has-bev={Boolean(bevUrl && showGround) ? 'true' : 'false'}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#090d16',
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      {/* Background sphere test hook */}
      {panoMeta && (
        <div
          data-testid="surround-background-sphere"
          data-radius={panoMeta.max_depth_m || 60}
          data-center={JSON.stringify(panoMeta.center)}
          style={{ display: 'none' }}
        />
      )}

      {/* BEV Ground plane test hook */}
      {showGround && bevUrl && (
        <div
          data-testid="surround-ground-bev"
          data-ground-z={groundZ}
          data-bev-url={bevUrl}
          style={{ display: 'none' }}
        />
      )}

      {/* Top Header Overlay */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          padding: '4px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 'bold',
          color: '#38bdf8',
          pointerEvents: 'none',
          zIndex: 10,
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          border: '1px solid #1e293b',
        }}
      >
        <span>SURROUND 3D (LiDAR bowl)</span>
        <span style={{ color: displayFps >= 30 ? '#22c55e' : '#f59e0b' }}>
          {displayFps} fps
        </span>
        {meshStats && (
          <span style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 'normal' }}>
            ({meshStats.triangles.toLocaleString()} tris · {meshStats.droppedTriangles.toLocaleString()} dropped)
          </span>
        )}
      </div>

      {/* Camera Pitch Slider and Reset Controls (Pitch 10°-89°, default 35°) */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          padding: '6px 12px',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          zIndex: 10,
          border: '1px solid #1e293b',
        }}
      >
        <label
          htmlFor="pitch-slider"
          style={{
            fontSize: '11px',
            color: '#94a3b8',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          Pitch {Math.round(pitch)}°
        </label>
        <input
          id="pitch-slider"
          data-testid="pitch-slider"
          type="range"
          min="10"
          max="89"
          value={Math.round(pitch)}
          onChange={(e) => setPitch(Number(e.target.value))}
          style={{
            width: '90px',
            cursor: 'pointer',
            accentColor: '#0284c7',
          }}
        />
        <span style={{ fontSize: '11px', color: '#64748b' }}>
          {distance.toFixed(1)}m
        </span>
        <button
          data-testid="reset-surround-camera-btn"
          onClick={handleResetCamera}
          style={{
            backgroundColor: '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Đặt lại (35° / 12m)
        </button>
      </div>

      {/* 404 Notice Overlay */}
      {(is404 || !panoDepthBuffer) && (
        <div
          data-testid="surround-404-notice"
          style={{
            position: 'absolute',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(239, 68, 68, 0.9)',
            color: '#ffffff',
            padding: '8px 16px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            zIndex: 15,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          }}
        >
          <span>Chưa có dữ liệu panorama (404) cho frame này</span>
        </div>
      )}

      {/* Selected Box HUD Overlay */}
      {selectedBox && (
        <div
          data-testid="selected-box-hud"
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid #0284c7',
            borderRadius: '6px',
            padding: '6px 10px',
            fontSize: '11px',
            color: '#e2e8f0',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 'bold', color: '#38bdf8' }}>
            {`${selectedBox.label} (${selectedBox.id})`}
          </div>
          <div style={{ color: '#94a3b8' }}>
            {`${selectedBox.l.toFixed(2)}m × ${selectedBox.w.toFixed(2)}m × ${selectedBox.h.toFixed(2)}m · yaw ${((selectedBox.yaw * 180) / Math.PI).toFixed(1)}°`}
          </div>
        </div>
      )}
    </div>
  );
};
