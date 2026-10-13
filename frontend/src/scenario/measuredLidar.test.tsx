// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeLidar, measuredLidarRequest, useMeasuredLidar, type LidarRequest } from './measuredLidar';
import { LidarView } from './LidarView';
import type { LidarFrame, Scenario } from './types';

afterEach(cleanup);
const ego = { id: 'ego', role: 'ego', category: 'vehicle.car', length_m: 4, width_m: 2, samples: [{ t_s: 0, x_m: 0, y_m: 0, z_m: 0, yaw_rad: 0, observed: true }] };
const base: Scenario = { id: 's', interval_s: [0, 5], source: { scene: 'scene-0103', selected_interval_s: [10.4, 13] }, actors: [ego] };
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const frame = (count: number, time_s = 0): LidarFrame => ({ scene: 'scene-0103', sensor: 'LIDAR_TOP', frame: 'ego', time_s, offset_s: 0.004, timestamp_us: 1, count, range_m: 100,
  xyz_cm_b64: b64(Array.from({ length: count }, () => [100, 0, 0xfe, 0xff, 50, 0]).flat()), intensity_b64: b64(Array(count).fill(9)) });

describe('measuredLidarRequest', () => {
  it('maps timeline time to the recorded source time only where a recording exists', () => {
    expect(measuredLidarRequest({ ...base, mode: 'source' }, 3)).toEqual({ scene: 'scene-0103', time_s: 3 });
    expect(measuredLidarRequest(base, 1.5)).toEqual({ scene: 'scene-0103', time_s: 11.9 });
    expect(measuredLidarRequest({ ...base, variant: { speed_factor: 1, gap_offset_m: 0 } }, 1)).toEqual({ scene: 'scene-0103', time_s: 11.4 });
    expect(measuredLidarRequest({ ...base, variant: { speed_factor: 1.2, gap_offset_m: 0 } }, 1)).toBeNull();
    expect(measuredLidarRequest({ ...base, variant: { speed_factor: 1, gap_offset_m: 2 } }, 1)).toBeNull();
    expect(measuredLidarRequest({ ...base, mode: 'imported' }, 1)).toBeNull();
    expect(measuredLidarRequest(null, 1)).toBeNull();
  });
});

describe('decodeLidar', () => {
  it('reads little-endian int16 centimetres and rejects size mismatches', () => {
    const d = decodeLidar(frame(2));
    expect(Array.from(d.xyz)).toEqual([100, -2, 50, 100, -2, 50]);
    expect(Array.from(d.intensity)).toEqual([9, 9]);
    expect(() => decodeLidar({ ...frame(2), count: 3 })).toThrow(/LIDAR_CORRUPT/);
  });
});

function Probe({ load, request }: { load: (r: LidarRequest) => Promise<LidarFrame>; request: LidarRequest | null }) {
  const state = useMeasuredLidar(load, request);
  return <output data-testid="probe">{state.data ? state.data.frame.time_s : state.error ?? 'none'}</output>;
}

describe('useMeasuredLidar', () => {
  it('keeps one read in flight, then fetches only the latest timeline time', async () => {
    const pending: ((f: LidarFrame) => void)[] = [];
    const load = vi.fn((r: LidarRequest) => new Promise<LidarFrame>(resolve => pending.push(() => resolve(frame(1, r.time_s)))));
    const { rerender } = render(<Probe load={load} request={{ scene: 'scene-0103', time_s: 1 }} />);
    rerender(<Probe load={load} request={{ scene: 'scene-0103', time_s: 2 }} />);
    rerender(<Probe load={load} request={{ scene: 'scene-0103', time_s: 3 }} />);
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { pending.shift()!(frame(1)); });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1][0].time_s).toBe(3);
    await act(async () => { pending.shift()!(frame(1)); });
    expect(screen.getByTestId('probe').textContent).toBe('3');
    rerender(<Probe load={load} request={{ scene: 'scene-0103', time_s: 1 }} />);
    expect(load).toHaveBeenCalledTimes(2); // served from cache
    expect(screen.getByTestId('probe').textContent).toBe('1');
  });
  it('ignores BUSY, reports unavailable sweeps without keeping a stale frame', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('BUSY: x')).mockRejectedValueOnce(new Error('LIDAR_UNAVAILABLE: No LiDAR sweep within 0.1s'));
    const { rerender } = render(<Probe load={load} request={{ scene: 'scene-0103', time_s: 1 }} />);
    await act(async () => {});
    expect(screen.getByTestId('probe').textContent).toBe('none');
    rerender(<Probe load={load} request={{ scene: 'scene-0103', time_s: 99 }} />);
    await act(async () => {});
    expect(screen.getByTestId('probe').textContent).toMatch(/LIDAR_UNAVAILABLE/);
  });
});

describe('LidarView source selection', () => {
  it('shows measured LiDAR for source scenes and a labelled simulation for variants', async () => {
    const load = vi.fn(async () => frame(3));
    const { rerender } = render(<LidarView scenario={{ ...base, mode: 'source' }} time={0} replay={null} loadLidar={load} />);
    await act(async () => {});
    expect(screen.getByTestId('lidar-view').getAttribute('data-mode')).toBe('measured');
    expect(screen.getByTestId('lidar-view').getAttribute('data-points')).toBe('3');
    rerender(<LidarView scenario={{ ...base, id: 'v', variant: { speed_factor: 1.2, gap_offset_m: 0 } }} time={0} replay={null} loadLidar={load} />);
    expect(screen.getByTestId('lidar-view').getAttribute('data-mode')).toBe('simulated');
    expect(screen.getByText('MÔ PHỎNG').getAttribute('title')).toMatch(/Biến thể đã dời đối tượng/);
  });
  it('falls back to the simulation when the host has no measured LiDAR (static demo)', async () => {
    const load = vi.fn(async () => { throw new Error('WEB_DEMO_UNAVAILABLE: x'); });
    render(<LidarView scenario={{ ...base, mode: 'source' }} time={0} replay={null} loadLidar={load} />);
    await act(async () => {});
    expect(screen.getByTestId('lidar-view').getAttribute('data-mode')).toBe('simulated');
  });
});
