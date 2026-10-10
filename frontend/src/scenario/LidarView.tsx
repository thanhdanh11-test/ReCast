import { useMemo } from 'react';
import { useSensorZoom } from './useSensorZoom';
import { SensorZoomControls } from './SensorZoomControls';
import type { Scenario, Replay } from './types';
import { simulateScan } from './sensors';
export function LidarView({ scenario, replay, time }: {
    scenario: Scenario | null;
    replay: Replay | null;
    time: number;
}) {
    const scan = useMemo(() => scenario ? simulateScan(scenario, replay, time) : null, [scenario, replay, time]);
    const controls = useSensorZoom(scenario?.id, !!scan);
    const span = 134 / controls.zoom;
    if (!scan)
        return <div className="view-empty">{scenario ? 'Thiếu pose ego tại thời điểm này.' : 'Chọn dữ liệu để xem tia quét.'}</div>;
    const hits = scan.rays.filter(r => r.distance !== null);
    const beam = scan.rays[Math.floor(time * 90) % 180];
    return <div className="sensor-view" data-testid="lidar-view" data-time={time} data-returns={hits.length}>
    <SensorZoomControls label="LiDAR" {...controls}/>
    <svg ref={controls.svgRef} viewBox={`${-span / 2} ${-span / 2} ${span} ${span}`} role="img" aria-label="LiDAR mô phỏng quét ngang 360 độ">
      {[20, 40, 60].map(r => <g key={r}><circle r={r} className="range-ring"/><text x="2" y={-r + 4} className="range-label">{r}m</text></g>)}
      <path d="M-60 0H60 M0-60V60" className="range-ring"/>
      {hits.map((r, i) => {
            const x = -Math.sin(r.angle) * r.distance!, y = -Math.cos(r.angle) * r.distance!;
            return <g key={i}><path d={`M0 0L${x} ${y}`} className="lidar-ray"/><circle cx={x} cy={y} r=".65" className="lidar-return"/></g>;
        })}
      <path d={`M0 0L${-Math.sin(beam.angle) * (beam.distance ?? 60)} ${-Math.cos(beam.angle) * (beam.distance ?? 60)}`} className="lidar-sweep"/>
      <path d="M0 -3L-1.5 2L1.5 2Z" className="lidar-ego"/>
    </svg>
    <span className="sensor-stat">{hits.length}/180 tia có giao điểm · hướng lên = đầu xe</span>
    <p className="sensor-note">Quét ngang giả lập · 60m · cao 1m. {(scenario?.mode === 'source' || scenario?.mode === 'imported') ? (scenario.environment ? 'Vật cản giản lược từ cảnh.' : 'Thiếu môi trường; chỉ quét các đối tượng nguồn.') : 'Chỉ các đối tượng trong trích đoạn.'} Không phải LiDAR đo thực.</p>
  </div>;
}
