import { useEffect, useRef, useState } from 'react';

const clamp = (value: number) => Math.max(1, Math.min(8, value));
/** View-only scaling: never changes map geometry, sensor range or playback poses. */
export function useSensorZoom(identity: string | undefined, enabled: boolean) {
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => { setZoom(1); }, [identity]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!enabled || !svg) return;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      setZoom(value => clamp(value * Math.exp(-Math.sign(event.deltaY) * 0.15)));
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [identity, enabled]);
  return { zoom, svgRef, zoomIn: () => setZoom(v => clamp(v * 1.25)),
    zoomOut: () => setZoom(v => clamp(v / 1.25)), reset: () => setZoom(1) };
}
