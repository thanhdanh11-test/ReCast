export function SensorZoomControls({label, zoom, zoomIn, zoomOut, reset}: {
  label: string; zoom: number; zoomIn: () => void; zoomOut: () => void; reset: () => void;
}) {
  return <div className="sensor-zoom" role="group" aria-label={`Zoom ${label}`}>
    <button aria-label={`Thu nhỏ ${label}`} onClick={zoomOut} disabled={zoom <= 1}>−</button>
    <button aria-label={`Đặt lại zoom ${label}`} onClick={reset} title="Đặt lại zoom">{zoom.toFixed(1)}×</button>
    <button aria-label={`Phóng to ${label}`} onClick={zoomIn} disabled={zoom >= 8}>+</button>
  </div>;
}
