import { useEffect, useRef, useState } from 'react';

const MIN_ZOOM = 0.5, MAX_ZOOM = 8;
const clamp = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
export interface Pan { x: number; y: number }

/**
 * View-only zoom and drag-to-pan for square sensor views: never changes map geometry, sensor
 * range or playback poses. Pan is in metres along screen axes (x right, y down); `span(base)`
 * is the visible width for a view whose unzoomed width is `base` metres.
 */
export function useViewTransform<E extends Element = Element>(identity: string | undefined, enabled: boolean, base: number) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const ref = useRef<E>(null);
  const span = base / zoom;
  const spanRef = useRef(span);
  spanRef.current = span;
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [identity]);
  useEffect(() => {
    const element = ref.current as unknown as HTMLElement | null;
    if (!enabled || !element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      setZoom(value => clamp(value * Math.exp(-Math.sign(event.deltaY) * 0.15)));
    };
    // Capture only once the pointer really moves, so a plain click still reaches child shapes.
    let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
    let suppressClick = false;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
        drag.moved = true;
        element.setPointerCapture?.(event.pointerId);
        element.classList.add('dragging');
      }
      const box = element.getBoundingClientRect();
      const metresPerPixel = spanRef.current / Math.max(1, Math.min(box.width, box.height));
      const dx = (event.clientX - drag.x) * metresPerPixel, dy = (event.clientY - drag.y) * metresPerPixel;
      drag = { ...drag, x: event.clientX, y: event.clientY };
      setPan(p => ({ x: p.x - dx, y: p.y - dy }));
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      suppressClick = drag.moved;
      if (drag.moved) element.releasePointerCapture?.(event.pointerId);
      drag = null;
      element.classList.remove('dragging');
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    };
    const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('dblclick', reset);
    element.addEventListener('click', click, true);
    return () => {
      element.removeEventListener('click', click, true);
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('dblclick', reset);
    };
  }, [identity, enabled]);
  return {
    zoom, pan, span, ref, panned: pan.x !== 0 || pan.y !== 0,
    zoomIn: () => setZoom(v => clamp(v * 1.25)),
    zoomOut: () => setZoom(v => clamp(v / 1.25)),
    reset: () => { setZoom(1); setPan({ x: 0, y: 0 }); },
    minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
  };
}
