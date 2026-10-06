import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api/client';
import {
  SceneSummary,
  SceneMeta,
  CameraCalib,
  Box3D,
  ApiError,
  BoxAtlas,
  ObjectsDenseData,
  FramePose,
  PanoData,
} from './api/types';
import { Header, LayerState } from './components/Header';
import { TopView } from './components/TopView';
import { BirdView } from './components/BirdView';
import { SurroundView } from './components/SurroundView';
import { ThreeView } from './components/ThreeView';
import { CameraGrid } from './components/CameraGrid';
import { CalibModal } from './components/CalibModal';
import { Toast, ToastMessage } from './components/Toast';
import { PaneErrorBoundary } from './components/PaneErrorBoundary';
import { runAutomatedBenchmark } from './perf';

export type TopViewMode = '2D' | 'Bird' | 'Surround';

const DEFAULT_LAYERS: LayerState = {
  ground: true,
  color: true,
  raw: false,
  boxes: true,
  dense: false,
  splat: false,
};

function loadLayersFromStorage(): LayerState {
  try {
    const saved = localStorage.getItem('topeye_layers');
    if (saved) {
      return { ...DEFAULT_LAYERS, ...JSON.parse(saved) };
    }
  } catch {
    // localStorage disabled or failed
  }
  return DEFAULT_LAYERS;
}

function saveLayersToStorage(layers: LayerState) {
  try {
    localStorage.setItem('topeye_layers', JSON.stringify(layers));
  } catch {
    // ignore
  }
}

function loadTopViewModeFromStorage(): TopViewMode {
  try {
    if (
      typeof window !== 'undefined' &&
      (window.location.search.includes('surround=1') ||
        window.location.search.includes('mode=surround'))
    ) {
      return 'Surround';
    }
    if (
      typeof window !== 'undefined' &&
      (window.location.search.includes('bird=1') ||
        window.location.search.includes('mode=bird'))
    ) {
      return 'Bird';
    }
    const saved = localStorage.getItem('topeye_top_view_mode');
    if (saved === '2D' || saved === 'Bird' || saved === 'Surround') {
      return saved;
    }
  } catch {
    // localStorage disabled or failed
  }
  return '2D';
}

function saveTopViewModeToStorage(mode: TopViewMode) {
  try {
    localStorage.setItem('topeye_top_view_mode', mode);
  } catch {
    // ignore
  }
}

// Memory cache for prefetching ±2 frames
interface FrameCacheEntry {
  points: Float32Array;
  bevUrl: string | null;
  boxes: Box3D[];
  calib: Record<string, CameraCalib>;
  camImages: Record<string, string>;
  boxAtlas: BoxAtlas | null;
  boxAtlasUrl: string | null;
  denseData: ObjectsDenseData | null;
  pose: FramePose | null;
  panoData: PanoData | null;
}

export function App() {
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [currentScene, setCurrentScene] = useState<string>('scene-0061');
  const [meta, setMeta] = useState<SceneMeta | null>(null);
  const [cache425Error, setCache425Error] = useState<string | null>(null);

  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerState>(loadLayersFromStorage);
  const [topViewMode, setTopViewMode] = useState<TopViewMode>(loadTopViewModeFromStorage);
  const [isCalibModalOpen, setIsCalibModalOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Performance benchmark state
  const [isBenchmarking, setIsBenchmarking] = useState<boolean>(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Current frame data
  const [pointsData, setPointsData] = useState<Float32Array | null>(null);
  const [bevUrl, setBevUrl] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Box3D[]>([]);
  const [calibs, setCalibs] = useState<Record<string, CameraCalib>>({});
  const [cameraImageUrls, setCameraImageUrls] = useState<Record<string, string>>({});
  const [boxAtlas, setBoxAtlas] = useState<BoxAtlas | null>(null);
  const [boxAtlasUrl, setBoxAtlasUrl] = useState<string | null>(null);
  const [denseData, setDenseData] = useState<ObjectsDenseData | null>(null);
  const [isDenseAvailable, setIsDenseAvailable] = useState<boolean>(true);
  const [sceneSplatUrl, setSceneSplatUrl] = useState<string | null>(null);
  const [isSplatAvailable, setIsSplatAvailable] = useState<boolean>(true);
  const [currentPose, setCurrentPose] = useState<FramePose | null>(null);
  const [panoData, setPanoData] = useState<PanoData | null>(null);
  const [isPano404, setIsPano404] = useState<boolean>(false);

  const handleTopViewModeChange = (mode: TopViewMode) => {
    setTopViewMode(mode);
    saveTopViewModeToStorage(mode);
  };

  const frameCache = useRef<Map<string, FrameCacheEntry>>(new Map());

  const addToast = useCallback(
    (type: 'error' | 'warning' | 'info', message: string, commandToRun?: string) => {
      const id = `${Date.now()}_${Math.random()}`;
      setToasts((prev) => [...prev, { id, type, message, commandToRun }]);
    },
    []
  );

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // 1. Initial Load: Fetch scenes
  useEffect(() => {
    api
      .getScenes()
      .then((res) => {
        setScenes(res);
        if (res.length > 0 && !res.find((s) => s.scene === currentScene)) {
          setCurrentScene(res[0].scene);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          addToast('error', err.message);
        } else {
          addToast('error', 'Failed to load scenes');
        }
      });
  }, [addToast, currentScene]);

  // 2. Fetch Scene Meta
  useEffect(() => {
    if (!currentScene) return;
    frameCache.current.clear();
    setCache425Error(null);

    api
      .getSceneMeta(currentScene)
      .then((m) => {
        setMeta(m);
        setCurrentFrameIndex(0);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          if (err.status === 425) {
            const cmd = `topeye-prepare --scene ${currentScene}`;
            setCache425Error(cmd);
            addToast(
              'warning',
              `Cache for '${currentScene}' is not ready (425).`,
              cmd
            );
          } else if (err.status === 404) {
            addToast('error', `Scene '${currentScene}' not found (404)`);
          } else {
            addToast('error', err.message);
          }
        }
      });

    // Load splat for the scene (SPEC-P07 §4 & H19 §3.3: tải 1 lần cho mỗi scene)
    api
      .getSceneSplatUrl(currentScene)
      .then((url) => {
        setSceneSplatUrl(url);
        setIsSplatAvailable(true);
      })
      .catch(() => {
        setSceneSplatUrl(null);
        setIsSplatAvailable(false);
      });
  }, [currentScene, addToast]);

  // 3. Load Frame Data (with ±2 frame prefetch)
  const currentFrameId =
    meta?.frames && meta.frames[currentFrameIndex]
      ? meta.frames[currentFrameIndex]
      : `${currentScene}_${String(currentFrameIndex).padStart(6, '0')}`;

  const loadFrame = useCallback(
    async (scene: string, frameId: string): Promise<FrameCacheEntry> => {
      const cached = frameCache.current.get(frameId);
      if (cached) return cached;

      // Handle 404/missing BEV, box atlas, dense objects, splat pose, and pano smoothly without crashing the frame load
      const [
        points,
        bevUrlOrNull,
        boxList,
        calib,
        boxAtlasOrNull,
        boxAtlasUrlOrNull,
        denseDataOrNull,
        poseOrNull,
        panoDataOrNull,
      ] = await Promise.all([
        api.getFramePoints(scene, frameId),
        api.getFrameBevUrl(scene, frameId).catch(() => null),
        api.getFrameBoxes(scene, frameId, 'gt'),
        api.getFrameCalib(scene, frameId),
        api.getFrameBoxAtlas(scene, frameId).catch(() => null),
        api.getFrameBoxAtlasImageUrl(scene, frameId).catch(() => null),
        api.getFrameObjectsDense(scene, frameId).catch(() => null),
        api.getFramePose(scene, frameId).catch(() => null),
        api.getFramePanoData(scene, frameId).catch(() => null),
      ]);

      const camNames = Object.keys(calib);
      const camImages: Record<string, string> = {};
      await Promise.all(
        camNames.map(async (cam) => {
          try {
            camImages[cam] = await api.getFrameCameraImageUrl(scene, frameId, cam);
          } catch {
            // Camera image missing (404): empty string indicates missing data
            camImages[cam] = '';
          }
        })
      );

      const entry: FrameCacheEntry = {
        points,
        bevUrl: bevUrlOrNull,
        boxes: boxList,
        calib,
        camImages,
        boxAtlas: boxAtlasOrNull,
        boxAtlasUrl: boxAtlasUrlOrNull,
        denseData: denseDataOrNull,
        pose: poseOrNull,
        panoData: panoDataOrNull,
      };

      frameCache.current.set(frameId, entry);
      return entry;
    },
    []
  );

  useEffect(() => {
    if (!meta || !meta.frames || meta.frames.length === 0) return;

    let isCancelled = false;

    // Load active frame immediately
    loadFrame(currentScene, currentFrameId)
      .then((data) => {
        if (isCancelled) return;
        setPointsData(data.points);
        setBevUrl(data.bevUrl);
        setBoxes(data.boxes);
        setCalibs(data.calib);
        setCameraImageUrls(data.camImages);
        setBoxAtlas(data.boxAtlas);
        setBoxAtlasUrl(data.boxAtlasUrl);
        setDenseData(data.denseData);
        setIsDenseAvailable(Boolean(data.denseData));
        setCurrentPose(data.pose);
        setPanoData(data.panoData);
        setIsPano404(!data.panoData);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          addToast('error', err.message);
        } else if (err instanceof Error) {
          addToast('error', err.message);
        }
      });

    // Prefetch ±2 frames in background
    const prefetchOffsets = [-2, -1, 1, 2];
    for (const offset of prefetchOffsets) {
      const targetIdx = currentFrameIndex + offset;
      if (targetIdx >= 0 && targetIdx < meta.frames.length) {
        const targetFrameId = meta.frames[targetIdx];
        loadFrame(currentScene, targetFrameId).catch(() => {
          // ignore background prefetch errors
        });
      }
    }

    return () => {
      isCancelled = true;
    };
  }, [currentScene, currentFrameId, currentFrameIndex, meta, loadFrame, addToast]);

  // 4. Automated Benchmark Runner (50 frame transitions)
  const handleRunBenchmark = useCallback(async () => {
    if (isBenchmarking || !meta || !meta.frames || meta.frames.length === 0) return;
    setIsBenchmarking(true);
    addToast('info', 'Bắt đầu đo hiệu năng (50 lần chuyển frame)...');

    try {
      const { report, filename } = await runAutomatedBenchmark(
        async (targetIndex) => {
          const tStart = performance.now();
          const targetFrameId = meta.frames[targetIndex];
          const data = await loadFrame(currentScene, targetFrameId);
          setPointsData(data.points);
          setBevUrl(data.bevUrl);
          setBoxes(data.boxes);
          setCalibs(data.calib);
          setCameraImageUrls(data.camImages);
          setBoxAtlas(data.boxAtlas);
          setBoxAtlasUrl(data.boxAtlasUrl);
          setDenseData(data.denseData);
          setIsDenseAvailable(Boolean(data.denseData));
          setCurrentPose(data.pose);
          setPanoData(data.panoData);
          setIsPano404(!data.panoData);
          setCurrentFrameIndex(targetIndex);

          // Wait double requestAnimationFrame to ensure browser has painted all views
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          });

          return Number((performance.now() - tStart).toFixed(2));
        },
        meta.frames.length,
        50,
        (current, total) => {
          setBenchmarkProgress({ current, total });
        }
      );

      addToast(
        'info',
        `Hoàn tất benchmark 50 frames: p50=${report.p50}ms, p90=${report.p90}ms, FPS trung bình=${report.fpsAverage}. Đã tải về: ${filename}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', `Lỗi khi chạy benchmark: ${msg}`);
    } finally {
      setIsBenchmarking(false);
      setBenchmarkProgress(null);
    }
  }, [isBenchmarking, meta, currentScene, loadFrame, addToast]);

  // 5. Keyboard Navigation: ArrowLeft / ArrowRight / P for Benchmark
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentFrameIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (meta?.frames) {
          setCurrentFrameIndex((prev) => Math.min(meta.frames.length - 1, prev + 1));
        }
      } else if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleRunBenchmark();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [meta, handleRunBenchmark]);

  // 6. Layer Toggle
  const handleLayerToggle = (layerKey: keyof LayerState) => {
    setLayers((prev) => {
      const next = { ...prev, [layerKey]: !prev[layerKey] };
      saveLayersToStorage(next);
      return next;
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#0f1117',
      }}
    >
      {/* 1. Header Bar */}
      <Header
        scenes={scenes}
        currentScene={currentScene}
        onSelectScene={setCurrentScene}
        currentFrameIndex={currentFrameIndex}
        totalFrames={meta?.frames?.length || 1}
        currentFrameId={currentFrameId}
        onFrameChange={setCurrentFrameIndex}
        layers={layers}
        onLayerToggle={handleLayerToggle}
        calibReport={meta?.calib_report || null}
        onOpenCalibModal={() => setIsCalibModalOpen(true)}
        onRunBenchmark={handleRunBenchmark}
        isBenchmarking={isBenchmarking}
        benchmarkProgress={benchmarkProgress}
        isDenseAvailable={isDenseAvailable}
        isSplatAvailable={isSplatAvailable}
      />

      {/* 2. Main Content Split: Upper (55%) vs Lower (45%) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          height: 'calc(100vh - 48px)',
          overflow: 'hidden',
        }}
      >
        {cache425Error ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f8fafc',
              gap: '16px',
              padding: '24px',
            }}
          >
            <div style={{ fontSize: '36px' }}>⏳</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: '#facc15' }}>
              Cache chưa sẵn sàng (425)
            </div>
            <div style={{ color: '#94a3b8', fontSize: '14px' }}>
              Scene '{currentScene}' chưa được chuẩn bị cache. Vui lòng chạy lệnh:
            </div>
            <code
              style={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '10px 18px',
                color: '#38bdf8',
                fontFamily: 'monospace',
                fontSize: '14px',
                userSelect: 'all',
              }}
            >
              {cache425Error}
            </code>
          </div>
        ) : (
          <>
            {/* Upper Viewport: Top View (Left) & 3D View (Right) */}
            <div
              style={{
                display: 'flex',
                flex: '1 1 54%',
                minHeight: '260px',
                borderBottom: '2px solid #232734',
                overflow: 'hidden',
              }}
            >
              {/* Top View / Bird View Pane */}
              <div
                style={{
                  flex: '1 1 50%',
                  borderRight: '1px solid #232734',
                  height: '100%',
                  position: 'relative',
                }}
              >
                {/* 2D | Bird Mode Switcher */}
                <div
                  data-testid="topview-mode-toggle"
                  style={{
                    position: 'absolute',
                    top: 10,
                    left: 12,
                    zIndex: 25,
                    display: 'flex',
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '2px',
                    gap: '2px',
                  }}
                >
                  <button
                    data-testid="mode-2d-btn"
                    onClick={() => handleTopViewModeChange('2D')}
                    style={{
                      backgroundColor: topViewMode === '2D' ? '#0284c7' : 'transparent',
                      color: topViewMode === '2D' ? '#ffffff' : '#94a3b8',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    2D
                  </button>
                  <button
                    data-testid="mode-bird-btn"
                    onClick={() => handleTopViewModeChange('Bird')}
                    style={{
                      backgroundColor: topViewMode === 'Bird' ? '#0284c7' : 'transparent',
                      color: topViewMode === 'Bird' ? '#ffffff' : '#94a3b8',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Bird
                  </button>
                  <button
                    data-testid="mode-surround-btn"
                    onClick={() => handleTopViewModeChange('Surround')}
                    style={{
                      backgroundColor: topViewMode === 'Surround' ? '#0284c7' : 'transparent',
                      color: topViewMode === 'Surround' ? '#ffffff' : '#94a3b8',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Surround
                  </button>
                </div>

                {topViewMode === '2D' ? (
                  <PaneErrorBoundary paneName="TopView" resetKeys={[currentFrameId]}>
                    <TopView
                      bevUrl={bevUrl}
                      boxAtlas={boxAtlas}
                      pointsData={pointsData}
                      boxes={boxes}
                      selectedBoxId={selectedBoxId}
                      onSelectBox={setSelectedBoxId}
                      showGround={layers.ground}
                      showBoxes={layers.boxes}
                      bevConfig={meta?.bev}
                    />
                  </PaneErrorBoundary>
                ) : topViewMode === 'Bird' ? (
                  <PaneErrorBoundary paneName="BirdView" resetKeys={[currentFrameId]}>
                    <BirdView
                      bevUrl={bevUrl}
                      boxAtlas={boxAtlas}
                      boxAtlasUrl={boxAtlasUrl}
                      pointsData={pointsData}
                      denseData={denseData}
                      boxes={boxes}
                      selectedBoxId={selectedBoxId}
                      onSelectBox={setSelectedBoxId}
                      showGround={layers.ground}
                      showBoxes={layers.boxes}
                      showColor={layers.color}
                      showDense={layers.dense && isDenseAvailable}
                      showSplat={layers.splat && isSplatAvailable}
                      splatUrl={sceneSplatUrl}
                      pose={currentPose}
                      groundZ={boxAtlas?.ground_z ?? -1.84}
                    />
                  </PaneErrorBoundary>
                ) : (
                  <PaneErrorBoundary paneName="SurroundView" resetKeys={[currentFrameId]}>
                    <SurroundView
                      panoMeta={panoData?.meta}
                      panoDepthBuffer={panoData?.depthBuffer}
                      panoRgbUrl={panoData?.rgbUrl}
                      panoAlphaUrl={panoData?.alphaUrl}
                      bevUrl={bevUrl}
                      showGround={layers.ground}
                      boxes={boxes}
                      selectedBoxId={selectedBoxId}
                      onSelectBox={setSelectedBoxId}
                      showBoxes={layers.boxes}
                      groundZ={boxAtlas?.ground_z ?? -1.84}
                      is404={isPano404}
                    />
                  </PaneErrorBoundary>
                )}
              </div>

              {/* 3D View (Perspective Three.js) */}
              <div
                style={{
                  flex: '1 1 50%',
                  height: '100%',
                  position: 'relative',
                }}
              >
                <PaneErrorBoundary paneName="ThreeView" resetKeys={[currentFrameId]}>
                  <ThreeView
                    pointsData={pointsData}
                    denseData={denseData}
                    boxes={boxes}
                    selectedBoxId={selectedBoxId}
                    onSelectBox={setSelectedBoxId}
                    showColor={layers.color}
                    showRaw={layers.raw}
                    showBoxes={layers.boxes}
                    showDense={layers.dense && isDenseAvailable}
                  />
                </PaneErrorBoundary>
              </div>
            </div>

            {/* Lower Viewport: 6 Camera Grid (NuScenes: FL F FR / BL B BR) */}
            <div
              style={{
                flex: '1 1 46%',
                minHeight: '200px',
                overflow: 'hidden',
              }}
            >
              <PaneErrorBoundary paneName="CameraGrid" resetKeys={[currentFrameId]}>
                <CameraGrid
                  frameId={currentFrameId}
                  cameras={calibs}
                  cameraImageUrls={cameraImageUrls}
                  boxes={boxes}
                  selectedBoxId={selectedBoxId}
                  onSelectBox={setSelectedBoxId}
                  showBoxes={layers.boxes}
                />
              </PaneErrorBoundary>
            </div>
          </>
        )}
      </div>

      {/* Calibration Modal */}
      {isCalibModalOpen && (
        <CalibModal
          report={meta?.calib_report || null}
          onClose={() => setIsCalibModalOpen(false)}
        />
      )}

      {/* Toast Notifications */}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
