import { useT } from "./i18n";
export function SensorZoomControls({label, zoom, zoomIn, zoomOut, reset, panned = false, minZoom = 0.5, maxZoom = 8}: {
  label: string; zoom: number; zoomIn: () => void; zoomOut: () => void; reset: () => void;
  panned?: boolean; minZoom?: number; maxZoom?: number;
}) {
  const t = useT();
  return <div className="sensor-zoom" role="group" aria-label={`Zoom ${label}`}>
    <button aria-label={t("Thu nhỏ {label}", { label })} onClick={zoomOut} disabled={zoom <= minZoom}>−</button>
    <button aria-label={t("Đặt lại zoom {label}", { label })} onClick={reset} title={t("Đặt lại zoom và vị trí (hoặc bấm đúp vào khung)")}>{panned ? '⌖ ' : ''}{zoom.toFixed(1)}×</button>
    <button aria-label={t("Phóng to {label}", { label })} onClick={zoomIn} disabled={zoom >= maxZoom}>+</button>
  </div>;
}
