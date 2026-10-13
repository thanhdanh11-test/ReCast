// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TrackView } from './TrackView';
import type { Scenario } from './types';

afterEach(cleanup);
const scenario: Scenario = { id: 's', mode: 'source', interval_s: [0, 1], source: { scene: 'scene-0103' },
  actors: [{ id: 'ego', role: 'ego', category: 'vehicle.car', length_m: 4, width_m: 2, samples: [{ t_s: 0, x_m: 0, y_m: 0, z_m: 0, yaw_rad: 0, observed: true }] }] };

it('collapses data warnings into a chip that expands on demand', () => {
  render(<TrackView scenario={scenario} time={0} replay={null} warnings={['Thiếu LiDAR cho 2 mẫu', 'Map lỗi 1 vùng']} />);
  const chip = screen.getByRole('button', { name: /2 cảnh báo dữ liệu/ });
  expect(chip.getAttribute('aria-expanded')).toBe('false');
  expect((screen.getByText('Thiếu LiDAR cho 2 mẫu').parentElement as HTMLElement).hidden).toBe(true);
  fireEvent.click(chip);
  expect(chip.getAttribute('aria-expanded')).toBe('true');
  expect((screen.getByText('Map lỗi 1 vùng').parentElement as HTMLElement).hidden).toBe(false);
});

it('shows no chip without warnings', () => {
  render(<TrackView scenario={scenario} time={0} replay={null} />);
  expect(screen.queryByRole('button', { name: /cảnh báo dữ liệu/ })).toBeNull();
});
