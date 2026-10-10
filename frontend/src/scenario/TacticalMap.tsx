import { useMemo } from "react";
import { useSensorZoom } from "./useSensorZoom";
import { SensorZoomControls } from "./SensorZoomControls";
import type { Scenario, Replay } from "./types";
import { visibleActors, footprint, polygonPath } from "./sensors";
import { vehicleClass, VEHICLE_CLASS_LABELS } from "./vehicleClass";
export function TacticalMap({
  scenario,
  time,
  replay,
}: {
  scenario: Scenario | null;
  time: number;
  replay: Replay | null;
}) {
  const environment =
    scenario?.mode === "source" || scenario?.mode === "imported"
      ? scenario.environment
      : undefined;
  const paths = useMemo(
    () =>
      environment?.polygons
        // nuScenes stop_line polygons are semantic stopping regions, not paint (as in 3D).
        .filter((p) => p.kind !== "stop_line")
        .map((p) => ({
          kind: p.kind,
          d: polygonPath([p.outer, ...p.holes]),
        })) ?? [],
    [environment],
  );
  const actors = scenario ? visibleActors(scenario, replay, time) : [],
    ego = actors.find((a) => a.actor.role === "ego");
  const controls = useSensorZoom(scenario?.id, !!ego && !!paths.length);
  const span = 130 / controls.zoom;
  // Legend lists only classes inside the current (zoomed) map frame around the ego.
  const present = new Set(
    actors
      .filter(
        (a) =>
          a.actor.role !== "ego" &&
          !!ego &&
          Math.abs(a.pose.x_m - ego.pose.x_m) <= span / 2 &&
          Math.abs(a.pose.y_m - ego.pose.y_m) <= span / 2,
      )
      .map((a) => vehicleClass(a.actor.category)),
  );
  if (!scenario)
    return <div className="view-empty">Chọn dữ liệu để xem bản đồ.</div>;
  if (!environment || !paths.length)
    return (
      <div className="view-empty">
        {scenario.mode === "source" || scenario.mode === "imported"
          ? "Cảnh này không có dữ liệu bản đồ."
          : "Trích đoạn dùng đường tổng hợp. Về cảnh gốc để xem map nuScenes."}
      </div>
    );
  if (!ego)
    return <div className="view-empty">Thiếu pose ego tại thời điểm này.</div>;
  return (
    <div className="sensor-view" data-testid="map-view" data-time={time}>
      <SensorZoomControls label="map" {...controls} />
      <svg
        ref={controls.svgRef}
        viewBox={`${ego.pose.x_m - span / 2} ${-ego.pose.y_m - span / 2} ${span} ${span}`}
        role="img"
        aria-label="Bản đồ nuScenes và vị trí đối tượng"
      >
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fillRule="evenodd"
            className={`map-surface map-${p.kind}`}
          />
        ))}
        {environment.lines.map((l, i) => (
          <polyline
            key={i}
            points={l.points.map(([x, y]) => `${x},${-y}`).join(" ")}
            className="map-line"
          />
        ))}
        <polyline
          points={ego.actor.samples.map((p) => `${p.x_m},${-p.y_m}`).join(" ")}
          className="map-trajectory"
        />
        {actors.map(({ actor, pose }) => (
          <path
            key={actor.id}
            d={polygonPath([footprint(actor, pose)])}
            className={
              actor.role === "ego"
                ? "map-ego"
                : `map-actor map-class-${vehicleClass(actor.category)}`
            }
          >
            <title>
              {actor.category} · {actor.id}
            </title>
          </path>
        ))}
        <path
          d={`M${ego.pose.x_m} ${-ego.pose.y_m}l${Math.cos(ego.pose.yaw_rad) * 6} ${-Math.sin(ego.pose.yaw_rad) * 6}`}
          className="map-heading"
        />
      </svg>
      <ul
        className="map-legend"
        data-testid="map-legend"
        aria-label="Chú thích màu theo loại đối tượng"
      >
        <li>
          <i className="map-swatch map-swatch-ego" />
          Xe ego
        </li>
        {VEHICLE_CLASS_LABELS.filter(([c]) => present.has(c)).map(
          ([c, label]) => (
            <li key={c}>
              <i className={`map-swatch map-swatch-${c}`} />
              {label}
            </li>
          ),
        )}
      </ul>
      <span className="sensor-stat">
        {actors.length} đối tượng hiện tại · Bắc ↑
      </span>
      <p className="sensor-note">
        Map nuScenes · khung {span.toFixed(0)}m · bám vị trí ego. Cuộn để zoom.
      </p>
    </div>
  );
}
