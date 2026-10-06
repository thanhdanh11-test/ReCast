import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { TopView } from './TopView';
import { Box3D } from '../api/types';

describe('TopView 404 / missing BEV handling & Selected Box HUD (H11)', () => {
  const sampleBoxes: Box3D[] = [
    {
      id: 'gt:scene-0061_f0000_box01',
      source: 'gt',
      track_key: 'inst:car_01',
      cx: 2.0,
      cy: 10.0,
      cz: -0.5,
      l: 4.5,
      w: 2.0,
      h: 1.6,
      yaw: 0.1,
      label: 'vehicle.car',
      score: 1.0,
      version: null,
      attributes: {},
    },
  ];

  it('renders "chưa có top view" state when bevUrl is null (404) and ground layer is enabled', () => {
    const html = renderToString(
      <TopView
        bevUrl={null}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
        showGround={true}
        showBoxes={true}
      />
    );

    // Verify it contains the required notice
    expect(html).toContain('chưa có top view');
    expect(html).toContain('data-testid="bev-status"');
  });

  it('does not render "chưa có top view" notice when ground layer is turned off', () => {
    const html = renderToString(
      <TopView
        bevUrl={null}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
        showGround={false}
        showBoxes={true}
      />
    );

    expect(html).not.toContain('chưa có top view');
  });

  it('does not render "chưa có top view" notice when bevUrl is available', () => {
    const html = renderToString(
      <TopView
        bevUrl="blob:http://localhost:5173/mock-bev-uuid"
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
        showGround={true}
        showBoxes={true}
      />
    );

    expect(html).not.toContain('chưa có top view');
  });

  it('renders selected box info overlay with label, id, track_key, l×w×h, and yaw in degrees (H11 §3 item 4)', () => {
    const html = renderToString(
      <TopView
        bevUrl={null}
        boxes={sampleBoxes}
        selectedBoxId={sampleBoxes[0].id}
        onSelectBox={() => {}}
        showGround={true}
        showBoxes={true}
      />
    );

    expect(html).toContain('data-testid="selected-box-info"');
    expect(html).toContain('BOX ĐANG CHỌN');
    expect(html).toContain('vehicle.car');
    expect(html).toContain('gt:scene-0061_f0000_box01');
    expect(html).toContain('inst:car_01');
    expect(html).toContain('4.50 × 2.00 × 1.60 m');
    // 0.1 rad = 5.729... deg -> 5.7°
    expect(html).toContain('5.7°');
  });

  it('does not render selected box info overlay when no box is selected', () => {
    const html = renderToString(
      <TopView
        bevUrl={null}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
        showGround={true}
        showBoxes={true}
      />
    );

    expect(html).not.toContain('data-testid="selected-box-info"');
  });
});
