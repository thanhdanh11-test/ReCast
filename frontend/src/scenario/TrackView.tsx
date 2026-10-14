import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Replay, Scenario } from "./types";
import { poseAt, replayRows, scenePosition, supportedPose } from "./trajectory";
import {
  disposeScene,
  roadScene,
  vehicleModel,
  createModelResources,
} from "./scene3d";
import {
  defaultEnvironmentSettings,
  type SceneEnvironmentSettings,
} from "./weather";
import { loadVinfastTemplate } from "./vinfastModels";
import { environmentIssues, formatContactNotice } from "./sourceEnvironment";
import { applyCabinView, cabinCamera, createCabinHood, setCabinMode } from "./cabinCamera";
import {
  loadActorTemplates,
  instantiateAssetModel,
  disposeActorTemplates,
} from "./assetModels";
import { nearestLeadVehicle, type LeadVehicle } from "./leadVehicle";
import { contactPosition, contactTilt } from "./groundSupport";
import { createDrivingOverlay } from "./drivingOverlay";
import { createWeatherEffects } from "./weatherEffects";
import { updateMapCameraDepth } from "./pastelStyle";
import { defaultPreferences, formatSpeed, type Preferences } from "./preferences";
import { useT } from "./i18n";
export { poseAt } from "./trajectory";
export function TrackView({
  scenario,
  time,
  replay,
  environmentSettings = defaultEnvironmentSettings(),
  warnings = [],
  display = defaultPreferences,
  onReady,
}: {
  scenario: Scenario | null;
  time: number;
  replay: Replay | null;
  environmentSettings?: SceneEnvironmentSettings;
  /** Source/environment warnings shown in the collapsible warning chip. */
  warnings?: string[];
  /** Cài đặt: starting camera, shadows, ego corridor and speed unit. */
  display?: Pick<Preferences, "camera" | "shadows" | "corridor" | "speedUnit">;
  /** Called once per built scene after its first frame is drawn (or when 3D cannot start). */
  onReady?: () => void;
}) {
  const t = useT();
  const mount = useRef<HTMLDivElement>(null),
    latest = useRef({
      time,
      environmentSettings,
      display,
      lead: null as LeadVehicle | null,
      onReady: undefined as (() => void) | undefined,
    }),
    leadBadge = useRef<HTMLDivElement>(null),
    actions = useRef<{
      follow: () => void;
      overview: () => void;
      cabin: () => void;
    } | null>(null);
  const [mode, setMode] = useState("Bám xe"),
    [error, setError] = useState(""),
    [geometryNotice, setGeometryNotice] = useState(""),
    [contactNotice, setContactNotice] = useState("");
  const lead = nearestLeadVehicle(scenario, replay, time);
  latest.current = { time, environmentSettings, display, lead, onReady };
  const [showWarnings, setShowWarnings] = useState(false);
  const ego = scenario?.actors.find((a) => a.role === "ego");
  const rows = ego ? replayRows(ego, replay) : [];
  const missing =
    replay && scenario
      ? scenario.actors
          .filter(
            (actor) => !supportedPose(replayRows(actor, replay), time, 0.075),
          )
          .map((actor) => actor.id)
      : [];
  const current = rows.length
    ? supportedPose(
        rows,
        time,
        replay ? 0.075 : scenario?.mode === "imported" ? Infinity : 1,
      )
    : null;
  const near = rows.length
    ? supportedPose(
        rows,
        Math.max(rows[0].t_s, time - 0.1),
        replay ? 0.075 : scenario?.mode === "imported" ? Infinity : 1,
      )
    : null;
  const speed =
    current && near && current.t_s > near.t_s
      ? (Math.hypot(current.x_m - near.x_m, current.y_m - near.y_m) /
          (current.t_s - near.t_s))
      : 0;
  const shownSpeed = formatSpeed(speed, display.speedUnit);
  useEffect(() => {
    if (!scenario || !scenario.actors.length || !mount.current) return;
    const host = mount.current;
    host.dataset.actorModels = "loading";
    setError("");
    setContactNotice("");
    setMode("Bám xe");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      setError(t("Không khởi tạo được WebGL. Hãy mở lại app để xem cảnh 3D."));
      latest.current.onReady?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xe7e7e4);
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", t("Cảnh kịch bản 3D"));
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xe7e7e4, 0.0035);
    const ambient = new THREE.HemisphereLight(0xffffff, 0x999999, 2.1);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(12, 35, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -90,
      right: 90,
      top: 90,
      bottom: -90,
      near: 0.1,
      far: 250,
    });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.12;
    scene.add(sun, sun.target);
    const road = roadScene(scenario);
    if (scenario.environment?.presentation?.style === "pastel-v1") {
      Object.assign(sun.shadow.camera, {left: -360, right: 360, top: 360, bottom: -360, near: 1, far: 1200});
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.2;
      sun.shadow.radius = 3;
    }
    const { geometryIssues, flatFallbacks } = environmentIssues(road.group);
    setGeometryNotice(
      geometryIssues
        ? t("Map nguồn có {n} vùng hình học lỗi; một số chi tiết bị thiếu hoặc chỉ hiển thị ước lượng.", { n: geometryIssues })
        : "",
    );
    scene.add(road.group);
    const resources = createModelResources();
    const actors = scenario.actors.map((actor) => {
      const mesh = vehicleModel(actor, scenario.mode === "imported", resources);
      scene.add(mesh);
      return {
        actor,
        mesh,
        base: new THREE.Box3().setFromObject(mesh).min.y,
        rows: replayRows(actor, replay),
      };
    });
    const weatherEffects = createWeatherEffects(
      scene,
      sun,
      ambient,
      road.center,
      scenario.environment?.presentation?.style === "pastel-v1",
    );
    let appliedSettings: SceneEnvironmentSettings | null = null;
    let lastFrameTime = performance.now(),
      metricTime = lastFrameTime;
    let slowFrames = 0,
      reducedQuality = false;
    let active = true;
    const assetAbort = new AbortController();
    void loadActorTemplates(assetAbort.signal)
      .then(async (templates) => {
        try {
          templates.ego = await loadVinfastTemplate(assetAbort.signal);
        } catch (error) {
          disposeActorTemplates(templates);
          throw error;
        }
        return templates;
      })
      .then((templates) => {
        if (!active) {
          disposeActorTemplates(templates);
          return;
        }
        const assetVault = new THREE.Group();
        assetVault.visible = false;
        assetVault.add(
          templates.sedan.high,
          templates.sedan.distant,
          templates.suv.high,
          templates.suv.distant,
        );
        if (templates.ego)
          assetVault.add(templates.ego.high, templates.ego.distant);
        scene.add(assetVault); // Own templates before instantiation can fail.
        for (const item of actors) {
          const model = instantiateAssetModel(
            item.actor,
            scenario.mode === "imported",
            templates,
          );
          if (!model) continue;
          item.base = new THREE.Box3().setFromObject(model).min.y;
          model.position.copy(item.mesh.position);
          model.rotation.copy(item.mesh.rotation);
          item.mesh.visible = false; // Retain fallback in scene for single-owner resource cleanup.
          scene.add(model);
          item.mesh = model;
        }
        host.dataset.actorModels = "bundled";
        host.dataset.egoModel = templates.ego?.id ?? "generic";
        appliedSettings = null;
      })
      .catch((err) => {
        if (active && err?.name !== "AbortError")
          setGeometryNotice(
            t("Chưa tải được mô hình xe chi tiết; đang dùng mô hình dự phòng."),
          );
      });
    const ego = actors.find((a) => a.actor.role === "ego")!;
    const drivingOverlay = createDrivingOverlay(
      scene,
      road.floor,
      ego.actor.width_m,
      road.ground,
    );
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1600),
      controls = new OrbitControls(camera, renderer.domElement);
    const cabinHood = createCabinHood();
    camera.add(cabinHood);
    scene.add(camera);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 7;
    controls.maxDistance = Math.max(200, road.radius * 1.6);
    let cabin = false,
      cabinGround: number | null = null;
    let follow = true,
      frame = 0,
      previous: THREE.Vector3 | null = null,
      lost = false;
    function leaveCabin() {
      if (!cabin) return;
      cabin = false;
      cabinHood.visible = false;
      cabinGround = null;
      setCabinMode(camera, controls, false);
      delete host.dataset.cabinEyeM;
    }
    function followCamera() {
      leaveCabin();
      host.dataset.cameraMode = "follow";
      const p = poseAt(
        ego.rows.length ? ego.rows : ego.actor.samples,
        latest.current.time,
      );
      const center = new THREE.Vector3(...scenePosition(p));
      camera.position
        .copy(center)
        .add(
          new THREE.Vector3(
            -12 * Math.cos(p.yaw_rad),
            8,
            12 * Math.sin(p.yaw_rad),
          ),
        );
      controls.target
        .copy(center)
        .add(
          new THREE.Vector3(
            6 * Math.cos(p.yaw_rad),
            0,
            -6 * Math.sin(p.yaw_rad),
          ),
        );
      previous = center;
      follow = true;
      setMode("Bám xe");
      controls.update();
    }
    function cabinView() {
      // Driver-eye view: camera is driven every frame; orbiting would leave the cabin.
      follow = false;
      cabin = true;
      setCabinMode(camera, controls, true);
      host.dataset.cameraMode = "cabin";
      setMode("Trong xe");
    }
    function overview() {
      leaveCabin();
      host.dataset.cameraMode = "overview";
      follow = false;
      setMode("Toàn cảnh");
      controls.target.copy(road.center);
      camera.position
        .copy(road.center)
        .add(
          new THREE.Vector3(
            -road.radius * 0.55,
            road.radius * 0.85,
            road.radius * 0.65,
          ),
        );
      controls.update();
    }
    const onStart = () => {
      follow = false;
      setMode("Tự do");
    };
    controls.addEventListener("start", onStart);
    actions.current = { follow: followCamera, overview, cabin: cabinView };
    followCamera();
    // Starting view from Cài đặt; the buttons still switch freely afterwards.
    if (latest.current.display.camera === "overview") overview();
    else if (latest.current.display.camera === "cabin") cabinView();
    const resize = new ResizeObserver(() => {
      const w = host.clientWidth,
        h = host.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resize.observe(host);
    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      setError(t("Kết nối GPU bị gián đoạn. Chọn lại cảnh để khởi tạo khung 3D."));
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    let readyNotified = false;
    function draw() {
      if (lost || !active) return; // a frame queued before cleanup must not touch the host
      const now = performance.now();
      const delta = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;
      const view = latest.current.display;
      sun.castShadow = view.shadows;
      drivingOverlay.setVisible(view.corridor);
      const settings = latest.current.environmentSettings;
      if (settings !== appliedSettings) {
        weatherEffects.apply(settings.weather);
        renderer.setPixelRatio(
          Math.min(
            window.devicePixelRatio,
            settings.quality === "high"
              ? 2
              : settings.quality === "balanced"
                ? 1
                : 1.5,
          ),
        );
        reducedQuality = false;
        slowFrames = 0;
        scene.traverse((object) => {
          if (object instanceof THREE.LOD) {
            object.autoUpdate = settings.quality !== "high";
            if (!object.autoUpdate)
              object.levels.forEach((level, index) => {
                level.object.visible = index === 0;
              });
          }
        });
        appliedSettings = settings;
      }
      let grounded = 0,
        unknownGround = 0;
      const contactMode =
        !replay && scenario?.mode === "source" ? "source" : "measured";
      for (const item of actors) {
        const p = supportedPose(
          item.rows,
          latest.current.time,
          replay ? 0.075 : scenario?.mode === "imported" ? Infinity : 1,
        );
        const envelope =
          scenario?.mode === "source"
            ? scenario.environment?.presentation?.bounds_m
            : undefined;
        const inside =
          !p ||
          !envelope ||
          (p.x_m >= envelope[0] &&
            p.y_m >= envelope[1] &&
            p.x_m <= envelope[2] &&
            p.y_m <= envelope[3]);
        item.mesh.visible = !!p && inside;
        if (p && inside) {
          const [roll, pitch] = contactTilt(
            item.actor,
            p,
            contactMode,
            road.ground,
            item.base,
          );
          const position = contactPosition(
            item.actor,
            p,
            contactMode,
            road.ground,
            item.base,
            [roll, pitch],
          );
          item.mesh.position.set(...position);
          if (contactMode === "source") {
            const height = road.ground.heightAt(p.x_m, p.y_m);
            if (
              height !== null &&
              Math.abs(height - (p.z_m + item.base)) <= 1.5
            )
              grounded++;
            else unknownGround++;
          }
          item.mesh.rotation.set(roll, p.yaw_rad, pitch, "YZX");
        }
      }
      if (follow && ego.mesh.visible) {
        const pos = ego.mesh.position.clone();
        if (previous) {
          const delta = pos.clone().sub(previous);
          camera.position.add(delta);
          controls.target.add(delta);
        }
        previous = pos;
      }
      cabinHood.visible = false;
      if (cabin) {
        const cabinPose = supportedPose(
          ego.rows,
          latest.current.time,
          replay ? 0.075 : scenario?.mode === "imported" ? Infinity : 1,
        );
        if (cabinPose && ego.mesh.visible) {
          const egoPosition = ego.mesh.position.toArray() as [
            number,
            number,
            number,
          ];
          const view = cabinCamera(
            cabinPose,
            ego.actor,
            egoPosition,
            scenario?.mode === "imported",
          );
          applyCabinView(camera, controls, ego.mesh, view);
          cabinHood.visible = true;
          cabinGround =
            egoPosition[1] -
            (scenario?.mode === "imported"
              ? (ego.actor.height_m ?? 1.6) / 2
              : 0);
        } else ego.mesh.visible = false;
      } else controls.update();
      if (settings.quality === "auto" && !reducedQuality) {
        slowFrames =
          delta > 0.0333 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
        if (slowFrames >= 45) {
          renderer.setPixelRatio(1);
          reducedQuality = true;
        }
      }
      const liveLead = latest.current.lead;
      const egoPose = supportedPose(
        ego.rows,
        latest.current.time,
        replay ? 0.075 : scenario?.mode === "imported" ? Infinity : 1,
      );
      const corridorM = drivingOverlay.update(
        egoPose,
        ego.rows,
        replay ? 0.075 : scenario?.mode === "imported" ? Infinity : 1,
        liveLead?.targetPose,
        liveLead ? liveLead.gapM + ego.actor.length_m / 2 : undefined,
      );
      if (leadBadge.current) {
        const leadItem = liveLead
          ? actors.find((a) => a.actor.id === liveLead.actorId)
          : undefined;
        if (liveLead && leadItem?.mesh.visible) {
          const target = new THREE.Vector3(
            ...contactPosition(
              leadItem.actor,
              liveLead.targetPose,
              contactMode,
              road.ground,
              leadItem.base,
            ),
          );
          target.y += 2;
          target.project(camera);
          const onScreen =
            target.z >= -1 &&
            target.z <= 1 &&
            Math.abs(target.x) < 0.95 &&
            Math.abs(target.y) < 0.9;
          leadBadge.current.style.visibility = onScreen ? "visible" : "hidden";
          leadBadge.current.style.transform = `translate(${((target.x + 1) * host.clientWidth) / 2}px,${((1 - target.y) * host.clientHeight) / 2}px) translate(-50%,-100%)`;
        } else leadBadge.current.style.visibility = "hidden";
      }
      weatherEffects.update(delta, controls.target);
      updateMapCameraDepth(camera, controls.target, cabin);
      // Measured from the camera actually rendered, so any later camera mutation is visible.
      if (cabin && cabinGround !== null)
        host.dataset.cabinEyeM = (camera.position.y - cabinGround).toFixed(2);
      renderer.render(scene, camera);
      if (!readyNotified) {
        readyNotified = true;
        latest.current.onReady?.();
      }
      if (now - metricTime > 1000) {
        host.dataset.grounded = String(grounded);
        host.dataset.groundUnknown = String(unknownGround);
        setContactNotice(
          contactMode === "source"
            ? formatContactNotice(grounded, unknownGround, flatFallbacks)
            : "",
        );
        host.dataset.drawCalls = String(renderer.info.render.calls);
        host.dataset.triangles = String(renderer.info.render.triangles);
        host.dataset.geometries = String(renderer.info.memory.geometries);
        host.dataset.textures = String(renderer.info.memory.textures);
        host.dataset.corridorM = corridorM.toFixed(2);
        host.dataset.leadDistanceM = liveLead
          ? (liveLead.gapM + ego.actor.length_m / 2).toFixed(2)
          : "";
        metricTime = now;
      }
      frame = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      active = false;
      delete host.dataset.cabinEyeM; // A new scene starts outside the cabin.
      assetAbort.abort();
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.removeEventListener("start", onStart);
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      actions.current = null;
    };
  }, [scenario, replay]);
  if (!scenario)
    return (
      <div className="empty-view">
        <div className="road-icon">↗</div>
        <h2>{t("Dựng kịch bản 3D từ cảnh thật")}</h2>
        <p>{t("Chọn cảnh để dựng môi trường và xem chuyển động gốc.")}</p>
        <span>{t("Camera bám xe · Xoay và zoom · Phát lại esmini")}</span>
      </div>
    );
  return (
    <div
      className="scene3d"
      data-source={
        replay ? "esmini" : scenario.mode === "source" ? "source" : "preview"
      }
      data-ego-x={current?.x_m}
      data-ego-y={current?.y_m}
      data-time={time}
    >
      <div className="scene3d-canvas" ref={mount} />
      {scenario.environment?.presentation?.style === "pastel-v1" && (
        <div className="map-attribution">
          Map pastel · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · ODbL
        </div>
      )}
      <div
        className="lead-distance-badge"
        ref={leadBadge}
        data-testid="lead-distance"
        title={t("Khoảng hở theo hướng ego; chọn xe cùng hướng trong hành lang phía trước")}
      >
        {lead ? `${lead.gapM.toFixed(1)} m` : ""}
      </div>
      <div className="driving-hud">
        <strong>
          {current ? shownSpeed.value : "—"} <small>{shownSpeed.unit}</small>
        </strong>
        <small className="lead-distance-stat">
          {t("Xe phía trước:")} {lead ? `${lead.gapM.toFixed(1)} m` : "—"}
        </small>
        <span className={replay ? "measured" : ""}>
          {replay
            ? t("ESMINI · PHÁT LẠI")
            : scenario.mode === "source"
              ? t("DỮ LIỆU GỐC")
              : t("XEM TRƯỚC")}
        </span>
      </div>
      <div className="camera-controls">
        <button
          onClick={() => actions.current?.follow()}
          aria-pressed={mode === "Bám xe"}
        >
          {t("Bám xe")}
        </button>
        <button
          onClick={() => actions.current?.overview()}
          aria-pressed={mode === "Toàn cảnh"}
        >
          {t("Toàn cảnh")}
        </button>
        <button
          onClick={() => actions.current?.cabin()}
          aria-pressed={mode === "Trong xe"}
        >
          {t("Trong xe")}
        </button>
      </div>
      {(geometryNotice || contactNotice || warnings.length > 0) && (
        <div className="scene3d-warnings">
          <button
            className="scene3d-warning-chip"
            aria-expanded={showWarnings}
            onClick={() => setShowWarnings((v) => !v)}
          >
            ⚠ {t("{n} cảnh báo dữ liệu", { n: [geometryNotice, contactNotice].filter(Boolean).length + warnings.length })}
          </button>
          <div className="scene3d-warning-list" hidden={!showWarnings}>
            {warnings.map((w, i) => <p key={i}>{w}</p>)}
            {geometryNotice && <p className="scene3d-geometry-notice" data-testid="geometry-notice">{geometryNotice}</p>}
            {contactNotice && <p className="scene3d-contact-notice" data-testid="contact-notice">{contactNotice}</p>}
          </div>
        </div>
      )}
      {(!current || error || missing.length > 0) && (
        <div className="scene3d-error" role="alert">
          {error ||
            t("Thiếu pose {source} tại thời điểm này: {ids}. Kéo thanh thời gian về trước.", { source: replay ? "esmini" : t("dữ liệu gốc"), ids: missing.join(", ") || "ego" })}
        </div>
      )}
    </div>
  );
}
