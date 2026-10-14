import { useMemo } from "react";
import { useViewTransform } from "./useViewTransform";
import type { Scenario, Replay } from "./types";
import { visibleActors, footprint, polygonPath } from "./sensors";
import { vehicleClass, VEHICLE_CLASS_LABELS } from "./vehicleClass";
import { useT } from "./i18n";
export function TacticalMap({
  scenario,
  time,
  replay,
}: {
  scenario: Scenario | null;
  time: number;
  replay: Replay | null;
}) {
  const t = useT();
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
  const controls = useViewTransform<SVGSVGElement>(scenario?.id, !!ego && !!paths.length, 130);
  const span = controls.span;
  // Frame centre follows the ego; dragging offsets it (screen y down = world −y).
  const centre = ego ? { x: ego.pose.x_m + controls.pan.x, y: ego.pose.y_m - controls.pan.y } : null;
  // Legend lists only classes inside the current (zoomed) map frame around the ego.
  const present = new Set(
    actors
      .filter(
        (a) =>
          a.actor.role !== "ego" &&
          !!centre &&
          Math.abs(a.pose.x_m - centre.x) <= span / 2 &&
          Math.abs(a.pose.y_m - centre.y) <= span / 2,
      )
      .map((a) => vehicleClass(a.actor.category)),
  );
  if (!scenario)
    return <div className="view-empty">{t("Chọn dữ liệu để xem bản đồ.")}</div>;
  if (!environment || !paths.length)
    return (
      <div className="view-empty">
        {scenario.mode === "source" || scenario.mode === "imported"
          ? t("Cảnh này không có dữ liệu bản đồ.")
          : t("Trích đoạn dùng đường tổng hợp. Về cảnh gốc để xem map nuScenes.")}
      </div>
    );
  if (!ego || !centre)
    return <div className="view-empty">{t("Thiếu pose ego tại thời điểm này.")}</div>;
  return (
    <div className="sensor-view" data-testid="map-view" data-time={time}>
      <svg
        ref={controls.ref}
        viewBox={`${centre.x - span / 2} ${-centre.y - span / 2} ${span} ${span}`}
        role="img"
        aria-label={t("Bản đồ nuScenes và vị trí đối tượng")}
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
        {actors.map(({ actor, pose }) => {
          return (
          <path
            key={actor.id}
            d={polygonPath([footprint(actor, pose)])}
            className={
              actor.role === "ego"
                ? "map-ego"
                : `map-actor map-class-${vehicleClass(actor.category)}`
            }
            data-actor={actor.id}
          >
            <title>
              {actor.category} · {actor.id}
            </title>
          </path>
          );
        })}
        <path
          d={`M${ego.pose.x_m} ${-ego.pose.y_m}l${Math.cos(ego.pose.yaw_rad) * 6} ${-Math.sin(ego.pose.yaw_rad) * 6}`}
          className="map-heading"
        />
      </svg>
      <ul
        className="map-legend"
        data-testid="map-legend"
        aria-label={t("Chú thích màu theo loại đối tượng")}
      >
        <li>
          <i className="map-swatch map-swatch-ego" />
          {t("Xe ego")}
        </li>
        {VEHICLE_CLASS_LABELS.filter(([c]) => present.has(c)).map(
          ([c, label]) => (
            <li key={c}>
              <i className={`map-swatch map-swatch-${c}`} />
              {t(label)}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
