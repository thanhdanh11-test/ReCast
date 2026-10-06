import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BirdView } from './BirdView';
import { Box3D, BoxAtlas } from '../api/types';

describe('BirdView Three.js Component (SPEC-P05 §5)', () => {
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

  const sampleAtlas: BoxAtlas = {
    atlas_w: 1024,
    atlas_h: 1024,
    ground_z: -1.84,
    boxes: {
      'gt:scene-0061_f0000_box01': {
        faces: {
          front: { uv: [32, 32, 288, 288], cam: 'CAM_FRONT', seen: true },
          back: { uv: [320, 32, 576, 288], cam: 'CAM_BACK', seen: true },
          left: { uv: [608, 32, 864, 288], cam: 'CAM_BACK_LEFT', seen: true },
          right: { uv: [32, 320, 288, 576], cam: 'CAM_FRONT_RIGHT', seen: true },
          top: { uv: [320, 320, 576, 576], cam: 'CAM_FRONT', seen: false },
        },
      },
    },
  };

  it('renders BirdView container with title, pitch slider (default 55°), and reset button', () => {
    const html = renderToString(
      <BirdView
        bevUrl="blob:http://localhost/bev.png"
        boxAtlas={sampleAtlas}
        boxAtlasUrl="data:image/svg+xml,test"
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={vi.fn()}
        showGround={true}
        showBoxes={true}
        showColor={true}
      />
    );

    expect(html).toContain('data-testid="bird-view-container"');
    expect(html).toContain('BIRD VIEW (three.js)');
    expect(html).toContain('Pitch:');
    expect(html).toContain('55°');
    expect(html).toContain('data-testid="pitch-slider"');
    expect(html).toContain('data-testid="reset-cam-btn"');
    // With atlas present, no fallback notice
    expect(html).not.toContain('data-testid="atlas-fallback-notice"');
  });

  it('renders wireframe fallback notice when boxAtlas is null (404 fallback)', () => {
    const html = renderToString(
      <BirdView
        bevUrl={null}
        boxAtlas={null}
        boxAtlasUrl={null}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={vi.fn()}
        showGround={true}
        showBoxes={true}
        showColor={false}
      />
    );

    expect(html).toContain('data-testid="atlas-fallback-notice"');
    expect(html).toContain('wireframe (no atlas)');
  });

  it('renders selected box info HUD with id, label, track_key, dimensions, and yaw in degrees', () => {
    const html = renderToString(
      <BirdView
        bevUrl={null}
        boxAtlas={sampleAtlas}
        boxAtlasUrl="data:image/svg+xml,test"
        boxes={sampleBoxes}
        selectedBoxId={sampleBoxes[0].id}
        onSelectBox={vi.fn()}
        showGround={true}
        showBoxes={true}
        showColor={true}
      />
    );

    expect(html).toContain('data-testid="selected-box-info"');
    expect(html).toContain('BOX ĐANG CHỌN (BIRD)');
    expect(html).toContain('vehicle.car');
    expect(html).toContain('gt:scene-0061_f0000_box01');
    expect(html).toContain('inst:car_01');
    expect(html).toContain('4.50 × 2.00 × 1.60 m');
    expect(html).toContain('5.7°');
    expect(html).toContain('data-testid="box-texture-source"');
    expect(html).toContain('F: CAM_FRONT @t0');
  });

  it('does not render selected box info HUD when no box is selected', () => {
    const html = renderToString(
      <BirdView
        bevUrl={null}
        boxAtlas={sampleAtlas}
        boxAtlasUrl="data:image/svg+xml,test"
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={vi.fn()}
        showGround={true}
        showBoxes={true}
        showColor={true}
      />
    );

    expect(html).not.toContain('data-testid="selected-box-info"');
  });

  it('renders with perspective camera mode attribute by default at pitch 55°', () => {
    const html = renderToString(
      <BirdView
        bevUrl={null}
        boxAtlas={sampleAtlas}
        boxAtlasUrl="data:image/svg+xml,test"
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={vi.fn()}
        showGround={true}
        showBoxes={true}
        showColor={true}
      />
    );

    expect(html).toContain('data-camera-mode="perspective"');
    expect(html).not.toContain('data-testid="metric-ruler"');
  });

  it('renders with dense layer enabled without throwing', () => {
    const mockDenseData = {
      meta: {
        objects: [
          { id: sampleBoxes[0].id, track_key: sampleBoxes[0].track_key!, start: 0, count: 5, n_frames: 10, rigid: true },
        ],
      },
      points: new Float32Array(35), // 5 * 7
    };

    const html = renderToString(
      <BirdView
        bevUrl={null}
        boxAtlas={sampleAtlas}
        boxAtlasUrl="data:image/svg+xml,test"
        boxes={sampleBoxes}
        selectedBoxId={sampleBoxes[0].id}
        onSelectBox={vi.fn()}
        showGround={true}
        showBoxes={true}
        showColor={true}
        showDense={true}
        denseData={mockDenseData}
      />
    );

    expect(html).toContain('data-testid="bird-view-container"');
    expect(html).toContain('data-testid="selected-box-info"');
  });

  it('renders splat status indicator with gaussian count and fps when showSplat is true', () => {
    const html = renderToString(
      <BirdView
        bevUrl={null}
        boxAtlas={sampleAtlas}
        boxAtlasUrl="data:image/svg+xml,test"
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={vi.fn()}
        showGround={true}
        showBoxes={true}
        showColor={true}
        showSplat={true}
        splatUrl="blob:http://localhost/splat.ply"
        splatCount={1000}
      />
    );

    expect(html).toContain('data-testid="splat-status"');
    expect(html).toContain('1,000');
    expect(html).toContain('Gaussians');
    expect(html).toContain('fps');
  });

  it('does not render splat status indicator when showSplat is false', () => {
    const html = renderToString(
      <BirdView
        bevUrl={null}
        boxAtlas={sampleAtlas}
        boxAtlasUrl="data:image/svg+xml,test"
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={vi.fn()}
        showGround={true}
        showBoxes={true}
        showColor={true}
        showSplat={false}
        splatUrl="blob:http://localhost/splat.ply"
      />
    );

    expect(html).not.toContain('data-testid="splat-status"');
  });

  it('renders correctly with pose prop supplied for frame alignment', () => {
    const mockPose = {
      T_world_lidar: [
        [1, 0, 0, 10],
        [0, 1, 0, 20],
        [0, 0, 1, 1],
        [0, 0, 0, 1],
      ],
    };

    const html = renderToString(
      <BirdView
        bevUrl={null}
        boxAtlas={sampleAtlas}
        boxAtlasUrl="data:image/svg+xml,test"
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={vi.fn()}
        showGround={true}
        showBoxes={true}
        showColor={true}
        showSplat={true}
        splatUrl="blob:http://localhost/splat.ply"
        pose={mockPose}
      />
    );

    expect(html).toContain('data-testid="bird-view-container"');
    expect(html).toContain('data-testid="splat-status"');
  });
});
