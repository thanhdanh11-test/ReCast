import { useMemo } from 'react';
import { useViewTransform } from './useViewTransform';
import type { Scenario, Replay, LidarFrame } from './types';
import { simulateScan } from './sensors';
import { measuredLidarRequest, useMeasuredLidar, type DecodedLidar, type LidarRequest } from './measuredLidar';
import { LidarPointCloud3D } from './LidarPointCloud3D';

const BASE_SPAN = 134;

export function LidarView({ scenario, replay, time, loadLidar }: {
    scenario: Scenario | null;
    replay: Replay | null;
    time: number;
    loadLidar?: (request: LidarRequest) => Promise<LidarFrame>;
}) {
    const request = loadLidar ? measuredLidarRequest(scenario, time) : null;
    const measured = useMeasuredLidar(loadLidar, request);
    if (request && !measured.unsupported)
        return <MeasuredLidar identity={scenario?.id} time={time} data={measured.data} error={measured.error}/>;
    return <SimulatedLidar scenario={scenario} replay={replay} time={time} measuredPossible={!!loadLidar && !measured.unsupported}/>;
}

function MeasuredLidar({ identity, time, data, error }: { identity?: string; time: number; data: DecodedLidar | null; error: string | null }) {
    const frame = data?.frame;
    return <div className="sensor-view" data-testid="lidar-view" data-mode="measured" data-time={time} data-points={frame?.count ?? 0}>
    <LidarPointCloud3D identity={identity} data={data}/>
    {error && <span className="sensor-error sensor-overlay" role="status">{error.replace(/^[A-Z_]+: /, '')}</span>}
  </div>;
}

function SimulatedLidar({ scenario, replay, time, measuredPossible }: { scenario: Scenario | null; replay: Replay | null; time: number; measuredPossible: boolean }) {
    const scan = useMemo(() => scenario ? simulateScan(scenario, replay, time) : null, [scenario, replay, time]);
    const controls = useViewTransform<SVGSVGElement>(scenario?.id, !!scan, BASE_SPAN);
    const { span, pan } = controls;
    if (!scan)
        return <div className="view-empty">{scenario ? 'Thiếu pose ego tại thời điểm này.' : 'Chọn dữ liệu để xem LiDAR.'}</div>;
    const hits = scan.rays.filter(r => r.distance !== null);
    const beam = scan.rays[Math.floor(time * 90) % 180];
    const why = !measuredPossible ? 'Không phải LiDAR đo thực.'
        : scenario?.mode === 'imported' ? 'Kịch bản nạp không có LiDAR đo; đây là quét giả lập.'
        : 'Biến thể đã dời đối tượng nên không có LiDAR đo tương ứng; đây là quét giả lập.';
    return <div className="sensor-view" data-testid="lidar-view" data-mode="simulated" data-time={time} data-returns={hits.length}>
    <span className="sensor-tag" title={why}>MÔ PHỎNG</span>
    <svg ref={controls.ref} viewBox={`${pan.x - span / 2} ${pan.y - span / 2} ${span} ${span}`} role="img" aria-label="LiDAR mô phỏng quét ngang 360 độ">
      {[20, 40, 60].map(r => <g key={r}><circle r={r} className="range-ring"/><text x="2" y={-r + 4} className="range-label">{r}m</text></g>)}
      <path d="M-60 0H60 M0-60V60" className="range-ring"/>
      {hits.map((r, i) => {
            const x = -Math.sin(r.angle) * r.distance!, y = -Math.cos(r.angle) * r.distance!;
            return <g key={i}><path d={`M0 0L${x} ${y}`} className="lidar-ray"/><circle cx={x} cy={y} r=".65" className="lidar-return"/></g>;
        })}
      <path d={`M0 0L${-Math.sin(beam.angle) * (beam.distance ?? 60)} ${-Math.cos(beam.angle) * (beam.distance ?? 60)}`} className="lidar-sweep"/>
      <path d="M0 -3L-1.5 2L1.5 2Z" className="lidar-ego"/>
    </svg>
  </div>;
}
