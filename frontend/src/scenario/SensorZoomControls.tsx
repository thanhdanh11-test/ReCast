export function SensorZoomControls({label, zoom, zoomIn, zoomOut, reset, panned = false, minZoom = 0.5, maxZoom = 8}: {
  label: string; zoom: number; zoomIn: () => void; zoomOut: () => void; reset: () => void;
  panned?: boolean; minZoom?: number; maxZoom?: number;
}) {
  return <div className="sensor-zoom" role="group" aria-label={`Zoom ${label}`}>
    <button aria-label={`Thu nhỏ ${label}`} onClick={zoomOut} disabled={zoom <= minZoom}>−</button>
    <button aria-label={`Đặt lại zoom ${label}`} onClick={reset} title="Đặt lại zoom và vị trí (hoặc bấm đúp vào khung)">{panned ? '⌖ ' : ''}{zoom.toFixed(1)}×</button>
    <button aria-label={`Phóng to ${label}`} onClick={zoomIn} disabled={zoom >= maxZoom}>+</button>
  </div>;
}
