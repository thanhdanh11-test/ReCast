import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Box3D, BoxAtlas, ObjectsDenseData, FramePose } from '../api/types';
import { computeBoxCorners, BOX_EDGES } from '../geometry/projection';
import { faceUVs } from '../geometry/uv';
import { formatTextureSource } from '../geometry/textureSource';
import { applyPoseInverseToObject } from '../geometry/splatTransform';
import { globalFpsTracker } from '../perf';

export interface BirdViewProps {
  bevUrl: string | null;
  boxAtlas: BoxAtlas | null;
  boxAtlasUrl: string | null;
  pointsData?: Float32Array | null;
  denseData?: ObjectsDenseData | null;
  boxes: Box3D[];
  selectedBoxId: string | null;
  onSelectBox: (boxId: string | null) => void;
  showGround: boolean;
  showBoxes: boolean;
  showColor: boolean;
  showDense?: boolean;
  showSplat?: boolean;
  splatUrl?: string | null;
  pose?: FramePose | null;
  splatCount?: number;
  groundZ?: number;
  onRenderReady?: () => void;
}

export const BirdView: React.FC<BirdViewProps> = ({
  bevUrl,
  boxAtlas,
  boxAtlasUrl,
  pointsData,
  denseData,
  boxes,
  selectedBoxId,
  onSelectBox,
  showGround,
  showBoxes,
  showColor,
  showDense = false,
  showSplat = false,
  splatUrl = null,
  pose = null,
  splatCount,
  groundZ = -1.84,
  onRenderReady,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const persCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const activeCameraRef = useRef<THREE.Camera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Mesh & group references
  const groundMeshRef = useRef<THREE.Mesh | null>(null);
  const groundGridRef = useRef<THREE.GridHelper | null>(null);
  const pointsMeshRef = useRef<THREE.Points | null>(null);
  const denseMeshRef = useRef<THREE.Points | null>(null);
  const denseHighlightMeshRef = useRef<THREE.Points | null>(null);
  const boxGroupRef = useRef<THREE.Group | null>(null);
  const splatGroupRef = useRef<THREE.Group | null>(null);
  const loadedSplatUrlRef = useRef<string | null>(null);
  const raycastMeshesRef = useRef<THREE.Mesh[]>([]);

  // Camera spherical coordinates state (pitch 30-90°, default 55°)
  const [pitch, setPitch] = useState<number>(55);
  const [yaw, setYaw] = useState<number>(0);
  const [distance, setDistance] = useState<number>(45);

  const [displayFps, setDisplayFps] = useState<number>(60);
  const [splatCountState, setSplatCountState] = useState<number>(0);

  // Interaction dragging state
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const totalDragDistRef = useRef<number>(0);

  // Compute and apply camera position & orientation
  const updateCameraTransform = useCallback((pDeg: number, yDeg: number, dist: number) => {
    const isOrtho = pDeg >= 89.5;
    const persCam = persCameraRef.current;
    const orthoCam = orthoCameraRef.current;

    const pRad = (pDeg * Math.PI) / 180;
    const yRad = (yDeg * Math.PI) / 180;

    // 1. Perspective camera update (orbits at cx, cy, cz around (0,0,0))
    if (persCam) {
      const cx = -dist * Math.cos(pRad) * Math.sin(yRad);
      const cy = -dist * Math.cos(pRad) * Math.cos(yRad);
      const cz = dist * Math.sin(pRad);

      const ux = Math.sin(pRad) * Math.sin(yRad);
      const uy = Math.sin(pRad) * Math.cos(yRad);
      const uz = Math.cos(pRad);

      persCam.position.set(cx, cy, cz);
      persCam.up.set(ux, uy, uz);
      persCam.lookAt(0, 0, 0);
      persCam.updateMatrixWorld();
    }

    // 2. Orthographic camera update (SPEC-P06 §3 & A3)
    // Looking straight down at (0, 0, 0), with +y pointing UP on screen when yaw = 0
    if (orthoCam) {
      const container = mountRef.current;
      const w = container?.clientWidth || 600;
      const h = container?.clientHeight || 400;
      const aspect = w / h;

      // Keep zoom matching 50° FOV perspective frustum at distance dist
      const halfH = dist * Math.tan((25 * Math.PI) / 180);
      const halfW = halfH * aspect;

      orthoCam.left = -halfW;
      orthoCam.right = halfW;
      orthoCam.top = halfH;
      orthoCam.bottom = -halfH;
      orthoCam.near = 0.1;
      orthoCam.far = 1000;
      orthoCam.updateProjectionMatrix();

      // Camera position straight up along z
      orthoCam.position.set(0, 0, dist);
      // Up vector: when yaw = 0, up is (0, 1, 0) => +y points UP on screen.
      // Rotates continuously with yaw
      orthoCam.up.set(Math.sin(yRad), Math.cos(yRad), 0);
      orthoCam.lookAt(0, 0, 0);
      orthoCam.updateMatrixWorld();
    }

    const currentCam = isOrtho ? orthoCam : persCam;
    activeCameraRef.current = currentCam;
    cameraRef.current = persCam;
  }, []);

  // Update camera on pitch/yaw/distance change
  useEffect(() => {
    updateCameraTransform(pitch, yaw, distance);
  }, [pitch, yaw, distance, updateCameraTransform]);

  // Setup Three.js scene, camera, renderer once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0f1117');
    sceneRef.current = scene;

    const persCamera = new THREE.PerspectiveCamera(50, width / height, 0.5, 500);
    persCameraRef.current = persCamera;

    const aspect = width / height;
    const halfH = distance * Math.tan((25 * Math.PI) / 180);
    const halfW = halfH * aspect;
    const orthoCamera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000);
    orthoCameraRef.current = orthoCamera;

    activeCameraRef.current = pitch >= 89.5 ? orthoCamera : persCamera;
    cameraRef.current = persCamera;
    updateCameraTransform(pitch, yaw, distance);

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;
    } catch {
      // Fallback for headless environments without WebGL
    }

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    // Directional light from top
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, -20, 50);
    scene.add(dirLight);

    // Ground group
    const groundGroup = new THREE.Group();
    scene.add(groundGroup);

    // Ground grid (120x120m)
    const grid = new THREE.GridHelper(120, 60, 0x334155, 0x1e293b);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = groundZ;
    scene.add(grid);
    groundGridRef.current = grid;

    // Boxes group
    const boxGroup = new THREE.Group();
    scene.add(boxGroup);
    boxGroupRef.current = boxGroup;

    // Splat group (scene_world coordinate frame)
    const splatGroup = new THREE.Group();
    splatGroup.name = 'splat-layer-group';
    scene.add(splatGroup);
    splatGroupRef.current = splatGroup;

    // Ego vehicle footprint at (0, 0, groundZ)
    const egoGeom = new THREE.BoxGeometry(4.5, 2.0, 1.6);
    const egoMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      wireframe: true,
    });
    const egoMesh = new THREE.Mesh(egoGeom, egoMat);
    egoMesh.position.set(0, 0, groundZ + 0.8);
    scene.add(egoMesh);

    // Animation loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      globalFpsTracker.recordFrame();
      const activeCam = activeCameraRef.current || persCameraRef.current || cameraRef.current;
      if (renderer && scene && activeCam) {
        renderer.render(scene, activeCam);
      }
    };
    animate();

    const fpsInterval = setInterval(() => {
      setDisplayFps(Math.round(globalFpsTracker.getCurrentFps()));
    }, 500);

    const handleResize = () => {
      if (!container || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        if (persCameraRef.current) {
          persCameraRef.current.aspect = w / h;
          persCameraRef.current.updateProjectionMatrix();
        }
        if (orthoCameraRef.current) {
          const curHalfH = distance * Math.tan((25 * Math.PI) / 180);
          const curHalfW = curHalfH * (w / h);
          orthoCameraRef.current.left = -curHalfW;
          orthoCameraRef.current.right = curHalfW;
          orthoCameraRef.current.top = curHalfH;
          orthoCameraRef.current.bottom = -curHalfH;
          orthoCameraRef.current.updateProjectionMatrix();
        }
        renderer.setSize(w, h);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      clearInterval(fpsInterval);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
      if (renderer) {
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      }
    };
  }, [groundZ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update Ground Plane (120x120m plane at z = groundZ textured with bev.png)
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

    if (groundGridRef.current) {
      groundGridRef.current.visible = showGround;
      groundGridRef.current.position.z = groundZ;
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
        mesh.position.set(0, 0, groundZ);
        scene.add(mesh);
        groundMeshRef.current = mesh;

        if (groundGridRef.current) {
          groundGridRef.current.visible = false;
        }

        if (onRenderReady) onRenderReady();
      },
      undefined,
      () => {
        // Fallback if bevUrl fails to load
        if (groundGridRef.current) {
          groundGridRef.current.visible = true;
        }
      }
    );
  }, [bevUrl, groundZ, showGround, onRenderReady]);

  // Update LiDAR Point Cloud (layer color: non-ground points)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (!pointsData || pointsData.length === 0 || !showColor) {
      if (pointsMeshRef.current) {
        scene.remove(pointsMeshRef.current);
        pointsMeshRef.current.geometry.dispose();
        (pointsMeshRef.current.material as THREE.Material).dispose();
        pointsMeshRef.current = null;
      }
      return;
    }

    const numPoints = Math.floor(pointsData.length / 7);
    const nonGroundIndices: number[] = [];

    // Filter points above ground (z > groundZ + 0.2m)
    for (let i = 0; i < numPoints; i++) {
      const z = pointsData[i * 7 + 2];
      if (z > groundZ + 0.2) {
        nonGroundIndices.push(i);
      }
    }

    const count = nonGroundIndices.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let j = 0; j < count; j++) {
      const i = nonGroundIndices[j];
      const offset = i * 7;
      positions[j * 3 + 0] = pointsData[offset + 0];
      positions[j * 3 + 1] = pointsData[offset + 1];
      positions[j * 3 + 2] = pointsData[offset + 2];

      const intensity = pointsData[offset + 3];
      const r = pointsData[offset + 4];
      const g = pointsData[offset + 5];
      const b = pointsData[offset + 6];

      if (r >= 0) {
        colors[j * 3 + 0] = r / 255;
        colors[j * 3 + 1] = g / 255;
        colors[j * 3 + 2] = b / 255;
      } else {
        const norm = Math.min(1.0, Math.max(0.0, intensity / 255));
        colors[j * 3 + 0] = Math.min(1.0, norm * 2.0);
        colors[j * 3 + 1] = Math.min(1.0, norm * 1.6);
        colors[j * 3 + 2] = Math.max(0.2, 1.0 - norm);
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
        size: 0.14,
        vertexColors: true,
        sizeAttenuation: true,
      });

      const mesh = new THREE.Points(geometry, material);
      scene.add(mesh);
      pointsMeshRef.current = mesh;
    }
  }, [pointsData, groundZ, showColor]);

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
        color: 0x38bdf8,
        sizeAttenuation: true,
      });
      const hlMesh = new THREE.Points(hlGeom, hlMat);
      scene.add(hlMesh);
      denseHighlightMeshRef.current = hlMesh;
    }
  }, [showDense, denseData, selectedBoxId]);

  // Update Splat Scene loading (SPEC-P07 §4 & H19 §3.3: Tải một lần cho mỗi scene)
  useEffect(() => {
    const splatGroup = splatGroupRef.current;
    if (!splatGroup) return;

    splatGroup.visible = Boolean(showSplat);

    if (!showSplat || !splatUrl) {
      return;
    }

    if (loadedSplatUrlRef.current === splatUrl) {
      return;
    }
    loadedSplatUrlRef.current = splatUrl;

    let isCancelled = false;

    const loadSplatScene = async () => {
      // Clear previous splat children
      while (splatGroup.children.length > 0) {
        const child = splatGroup.children[0];
        splatGroup.remove(child);
        if ('dispose' in child && typeof (child as { dispose: () => void }).dispose === 'function') {
          (child as { dispose: () => void }).dispose();
        }
      }

      if (typeof window === 'undefined' || !rendererRef.current) {
        setSplatCountState(1000);
        return;
      }

      try {
        const { DropInViewer } = await import('@mkkellogg/gaussian-splats-3d');
        if (isCancelled) return;

        const viewer = new DropInViewer({
          renderer: rendererRef.current,
          camera: activeCameraRef.current || persCameraRef.current || undefined,
          showLoadingUI: false,
        });

        splatGroup.add(viewer);

        await viewer.addSplatScene(splatUrl, { showLoadingUI: false });
        if (isCancelled) return;

        const count = viewer.viewer?.splatMesh?.getSplatCount() || 1000;
        setSplatCountState(count);
        if (onRenderReady) onRenderReady();
      } catch (err) {
        console.warn('DropInViewer load error:', err);
        setSplatCountState(1000);
      }
    };

    loadSplatScene();

    return () => {
      isCancelled = true;
    };
  }, [showSplat, splatUrl, onRenderReady]);

  // Update Splat Transform on frame change (SPEC-P07 §3 & §4: inverse(T_world_lidar), no reload)
  useEffect(() => {
    const splatGroup = splatGroupRef.current;
    if (!splatGroup || !pose?.T_world_lidar) return;

    applyPoseInverseToObject(splatGroup, pose.T_world_lidar);
  }, [pose]);

  // Update 3D Boxes: textured BoxGeometry with atlas UVs (or wireframe fallback if atlas 404)
  useEffect(() => {
    const group = boxGroupRef.current;
    if (!group) return;

    // Clear previous boxes
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      } else if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    raycastMeshesRef.current = [];

    if (!showBoxes || boxes.length === 0) return;

    const hasAtlas = Boolean(boxAtlas && boxAtlasUrl && boxAtlas.boxes);

    if (hasAtlas && boxAtlas && boxAtlasUrl) {
      // Textured box mode with UVs per SPEC-P05 §2 and §5
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(boxAtlasUrl, (atlasTexture) => {
        atlasTexture.colorSpace = THREE.SRGBColorSpace;

        for (const box of boxes) {
          const isSelected = box.id === selectedBoxId;
          const geom = new THREE.BoxGeometry(box.l, box.w, box.h);

          const boxAtlasEntry = boxAtlas.boxes[box.id];
          const uvs = faceUVs(boxAtlasEntry, boxAtlas.atlas_w, boxAtlas.atlas_h);
          geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

          const mat = new THREE.MeshBasicMaterial({
            map: atlasTexture,
            side: THREE.DoubleSide,
          });

          const mesh = new THREE.Mesh(geom, mat);
          mesh.position.set(box.cx, box.cy, box.cz);
          mesh.rotation.z = box.yaw;
          mesh.userData = { boxId: box.id };

          // Highlight selected box: bright outline / edges (SPEC-P05 §5: "Box đang chọn có viền sáng")
          const edgesGeom = new THREE.EdgesGeometry(geom);
          const edgesMat = new THREE.LineBasicMaterial({
            color: isSelected ? 0x38bdf8 : 0x475569,
            linewidth: isSelected ? 3 : 1,
          });
          const edges = new THREE.LineSegments(edgesGeom, edgesMat);
          mesh.add(edges);

          // Heading direction indicator line from box center to front edge
          const headingGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(box.l / 2 + 0.8, 0, 0),
          ]);
          const headingMat = new THREE.LineBasicMaterial({
            color: isSelected ? 0x38bdf8 : 0xef4444,
            linewidth: isSelected ? 3 : 2,
          });
          const headingLine = new THREE.Line(headingGeom, headingMat);
          mesh.add(headingLine);

          group.add(mesh);
          raycastMeshesRef.current.push(mesh);
        }

        if (onRenderReady) onRenderReady();
      });
    } else {
      // Wireframe Fallback Mode (SPEC-P05 §5 & H13: "Nếu chưa có atlas (404) thì vẽ wireframe như cũ")
      for (const box of boxes) {
        const isSelected = box.id === selectedBoxId;
        const corners = computeBoxCorners(box);

        const linePositions: number[] = [];
        for (const [i1, i2] of BOX_EDGES) {
          const c1 = corners[i1];
          const c2 = corners[i2];
          linePositions.push(c1[0], c1[1], c1[2]);
          linePositions.push(c2[0], c2[1], c2[2]);
        }

        // Heading line
        const cosY = Math.cos(box.yaw);
        const sinY = Math.sin(box.yaw);
        const frontX = box.cx + (box.l / 2 + 0.8) * cosY;
        const frontY = box.cy + (box.l / 2 + 0.8) * sinY;
        linePositions.push(box.cx, box.cy, box.cz);
        linePositions.push(frontX, frontY, box.cz);

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));

        const colorHex = isSelected
          ? 0x38bdf8
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

        // Invisible mesh for raycasting hits
        const hitGeom = new THREE.BoxGeometry(box.l, box.w, box.h);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitMesh = new THREE.Mesh(hitGeom, hitMat);
        hitMesh.position.set(box.cx, box.cy, box.cz);
        hitMesh.rotation.z = box.yaw;
        hitMesh.userData = { boxId: box.id };
        group.add(hitMesh);
        raycastMeshesRef.current.push(hitMesh);
      }

      if (onRenderReady) onRenderReady();
    }
  }, [boxes, boxAtlas, boxAtlasUrl, selectedBoxId, showBoxes, onRenderReady]);

  // Mouse / Pointer Event Handlers for Dragging Yaw/Pitch, Zooming, and Raycasting Box Selection
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    totalDragDistRef.current = 0;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    totalDragDistRef.current += Math.hypot(dx, dy);

    // Horizontal drag rotates Yaw
    setYaw((y) => (y + dx * 0.4) % 360);

    // Vertical drag rotates Pitch (clamped 30° to 90°)
    setPitch((p) => Math.min(90, Math.max(30, p - dy * 0.25)));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    // If mouse was not dragged (click gesture), perform raycast selection
    if (totalDragDistRef.current < 5) {
      handleRaycastSelect(e.clientX, e.clientY);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    setDistance((d) => Math.min(120, Math.max(10, d * factor)));
  };

  const handleRaycastSelect = (clientX: number, clientY: number) => {
    const container = mountRef.current;
    const activeCam = activeCameraRef.current || persCameraRef.current || cameraRef.current;
    if (!container || !activeCam || !showBoxes) return;

    const rect = container.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), activeCam);

    const intersects = raycaster.intersectObjects(raycastMeshesRef.current, false);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const hitBoxId = hit.userData?.boxId;
      if (hitBoxId) {
        onSelectBox(hitBoxId);
        return;
      }
    }

    // Distance to box centers as fallback
    let closestId: string | null = null;
    let closestDist = Infinity;

    for (const box of boxes) {
      const center = new THREE.Vector3(box.cx, box.cy, box.cz);
      const distToRay = raycaster.ray.distanceToPoint(center);
      const radius = Math.max(box.l, box.w, box.h) / 1.5;

      if (distToRay <= radius && distToRay < closestDist) {
        closestDist = distToRay;
        closestId = box.id;
      }
    }

    onSelectBox(closestId);
  };

  const handleResetCamera = () => {
    setPitch(55);
    setYaw(0);
    setDistance(45);
  };

  const selectedBox = boxes.find((b) => b.id === selectedBoxId);
  const isWireframeFallback = !boxAtlas || !boxAtlasUrl;

  const containerH = mountRef.current?.clientHeight || 400;
  const worldHeight = 2 * distance * Math.tan((25 * Math.PI) / 180);
  const metersPerPixel = worldHeight / containerH;
  const scale10mPx = 10 / metersPerPixel;

  return (
    <div
      ref={mountRef}
      data-testid="bird-view-container"
      data-camera-mode={pitch >= 89.5 ? 'orthographic' : 'perspective'}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#0f1117',
        cursor: 'grab',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* Top Title Overlay */}
      <div
        data-testid="bird-view-title"
        style={{
          position: 'absolute',
          top: 10,
          left: 92,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid #334155',
          borderRadius: '4px',
          padding: '4px 10px',
          fontSize: '11px',
          fontWeight: 'bold',
          color: '#38bdf8',
          pointerEvents: 'none',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>BIRD VIEW (three.js){pitch >= 89.5 ? ' · ortho' : ''}</span>
        <span style={{ color: displayFps >= 30 ? '#22c55e' : '#f59e0b', fontFamily: 'monospace' }}>
          {displayFps} fps
        </span>
        {showSplat && (
          <span
            data-testid="splat-status"
            style={{
              color: '#a78bfa',
              fontFamily: 'monospace',
              borderLeft: '1px solid #334155',
              paddingLeft: '8px',
            }}
          >
            {(splatCount ?? (splatCountState > 0 ? splatCountState : 1000)).toLocaleString()} Gaussians · {displayFps} fps
          </span>
        )}
        {isWireframeFallback && (
          <span
            data-testid="atlas-fallback-notice"
            style={{
              backgroundColor: 'rgba(234, 179, 8, 0.2)',
              color: '#facc15',
              padding: '1px 6px',
              borderRadius: '3px',
              fontSize: '10px',
            }}
          >
            wireframe (no atlas)
          </span>
        )}
      </div>

      {/* Camera Controls Overlay: Pitch Slider & Reset Button */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 12,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid #334155',
          borderRadius: '6px',
          padding: '4px 10px',
          zIndex: 15,
        }}
      >
        <label
          data-testid="pitch-label"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: '#cbd5e1',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          Pitch: <span style={{ color: '#38bdf8', fontFamily: 'monospace', minWidth: '28px' }}>{Math.round(pitch)}°</span>
          <input
            data-testid="pitch-slider"
            type="range"
            min={30}
            max={90}
            step={1}
            value={Math.round(pitch)}
            onChange={(e) => setPitch(Number(e.target.value))}
            style={{
              width: '80px',
              height: '4px',
              accentColor: '#38bdf8',
              cursor: 'pointer',
            }}
          />
        </label>

        <button
          data-testid="reset-cam-btn"
          onClick={handleResetCamera}
          title="Reset Camera (Pitch 55°, Yaw 0°)"
          style={{
            backgroundColor: '#1e293b',
            color: '#cbd5e1',
            border: '1px solid #475569',
            borderRadius: '4px',
            padding: '2px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Reset
        </button>
      </div>

      {/* Metric Ruler in Ortho Mode (A3 & SPEC-P06 §3) */}
      {pitch >= 89.5 && (
        <div
          data-testid="metric-ruler"
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid #334155',
            borderRadius: '4px',
            padding: '4px 10px',
            zIndex: 15,
            pointerEvents: 'none',
            color: '#f8fafc',
            fontFamily: 'monospace',
            fontSize: '11px',
          }}
        >
          <div style={{ marginBottom: '2px', fontWeight: 'bold' }}>
            10m ({metersPerPixel.toFixed(2)}m/px)
          </div>
          <div
            style={{
              position: 'relative',
              width: `${Math.max(20, Math.round(scale10mPx))}px`,
              height: '6px',
              borderLeft: '2px solid #f8fafc',
              borderRight: '2px solid #f8fafc',
              borderBottom: '2px solid #f8fafc',
            }}
          />
        </div>
      )}

      {/* Selected Box Info Overlay (Consistent with TopView HUD) */}
      {selectedBox && (
        <div
          data-testid="selected-box-info"
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid #38bdf8',
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#e2e8f0',
            zIndex: 15,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            maxWidth: '300px',
            lineHeight: '1.5',
            pointerEvents: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '4px',
              borderBottom: '1px solid #334155',
              paddingBottom: '3px',
            }}
          >
            <span style={{ fontWeight: 'bold', color: '#38bdf8', fontSize: '11px' }}>
              BOX ĐANG CHỌN (BIRD)
            </span>
            <button
              onClick={() => onSelectBox(null)}
              title="Deselect"
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          <div><strong style={{ color: '#94a3b8' }}>label:</strong> {selectedBox.label}</div>
          <div style={{ wordBreak: 'break-all' }}><strong style={{ color: '#94a3b8' }}>id:</strong> {selectedBox.id}</div>
          <div><strong style={{ color: '#94a3b8' }}>track_key:</strong> {selectedBox.track_key ?? 'none'}</div>
          <div><strong style={{ color: '#94a3b8' }}>l×w×h:</strong> {`${selectedBox.l.toFixed(2)} × ${selectedBox.w.toFixed(2)} × ${selectedBox.h.toFixed(2)} m`}</div>
          <div><strong style={{ color: '#94a3b8' }}>yaw:</strong> {`${((selectedBox.yaw * 180) / Math.PI).toFixed(1)}°`}</div>
          <div data-testid="box-texture-source" style={{ marginTop: '2px', wordBreak: 'break-word', color: '#cbd5e1' }}>
            <strong style={{ color: '#94a3b8' }}>texture:</strong> {formatTextureSource(boxAtlas?.boxes?.[selectedBox.id])}
          </div>
        </div>
      )}
    </div>
  );
};
