import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Header, LayerState } from './Header';

describe('Header Layer Checkboxes & Dense Layer (SPEC-P06 §4 & H17 §2, §3.3)', () => {
  const defaultLayers: LayerState = {
    ground: true,
    color: true,
    raw: false,
    boxes: true,
    dense: false,
    splat: false,
  };

  it('renders all 6 layer checkboxes: ground, color, raw, boxes, dense, and splat', () => {
    const html = renderToString(
      <Header
        scenes={[{ scene: 'scene-0061', n_frames: 40, cached: true }]}
        currentScene="scene-0061"
        onSelectScene={vi.fn()}
        currentFrameIndex={0}
        totalFrames={40}
        currentFrameId="scene-0061_000000"
        onFrameChange={vi.fn()}
        layers={defaultLayers}
        onLayerToggle={vi.fn()}
        calibReport={null}
        onOpenCalibModal={vi.fn()}
        isDenseAvailable={true}
        isSplatAvailable={true}
      />
    );

    expect(html).toContain('data-testid="layer-ground-checkbox"');
    expect(html).toContain('data-testid="layer-color-checkbox"');
    expect(html).toContain('data-testid="layer-raw-checkbox"');
    expect(html).toContain('data-testid="layer-boxes-checkbox"');
    expect(html).toContain('data-testid="layer-dense-checkbox"');
    expect(html).toContain('data-testid="layer-splat-checkbox"');
    expect(html).toContain('splat');
  });

  it('enables dense checkbox when isDenseAvailable is true', () => {
    const html = renderToString(
      <Header
        scenes={[{ scene: 'scene-0061', n_frames: 40, cached: true }]}
        currentScene="scene-0061"
        onSelectScene={vi.fn()}
        currentFrameIndex={0}
        totalFrames={40}
        currentFrameId="scene-0061_000000"
        onFrameChange={vi.fn()}
        layers={{ ...defaultLayers, dense: true }}
        onLayerToggle={vi.fn()}
        calibReport={null}
        onOpenCalibModal={vi.fn()}
        isDenseAvailable={true}
      />
    );

    expect(html).toContain('data-testid="layer-dense-checkbox"');
    // Not disabled, no "chưa có dữ liệu" title
    expect(html).not.toContain('title="chưa có dữ liệu"');
  });

  it('disables dense layer and displays "chưa có dữ liệu" on hover when isDenseAvailable is false (404 fallback)', () => {
    const html = renderToString(
      <Header
        scenes={[{ scene: 'scene-0061', n_frames: 40, cached: true }]}
        currentScene="scene-0061"
        onSelectScene={vi.fn()}
        currentFrameIndex={0}
        totalFrames={40}
        currentFrameId="scene-0061_000000"
        onFrameChange={vi.fn()}
        layers={defaultLayers}
        onLayerToggle={vi.fn()}
        calibReport={null}
        onOpenCalibModal={vi.fn()}
        isDenseAvailable={false}
      />
    );

    // SPEC-P06 §4: "Thiếu objects_dense (404) thì layer dense bị vô hiệu hoá, hover vào hiện "chưa có dữ liệu""
    expect(html).toContain('title="chưa có dữ liệu"');
    expect(html).toContain('disabled');
  });

  it('enables splat checkbox when isSplatAvailable is true', () => {
    const html = renderToString(
      <Header
        scenes={[{ scene: 'scene-0061', n_frames: 40, cached: true }]}
        currentScene="scene-0061"
        onSelectScene={vi.fn()}
        currentFrameIndex={0}
        totalFrames={40}
        currentFrameId="scene-0061_000000"
        onFrameChange={vi.fn()}
        layers={{ ...defaultLayers, splat: true }}
        onLayerToggle={vi.fn()}
        calibReport={null}
        onOpenCalibModal={vi.fn()}
        isSplatAvailable={true}
      />
    );

    expect(html).toContain('data-testid="layer-splat-checkbox"');
    expect(html).not.toContain('title="chưa có splat"');
  });

  it('disables splat layer and displays "chưa có splat" on hover when isSplatAvailable is false (SPEC-P07 §4: 404 fallback)', () => {
    const html = renderToString(
      <Header
        scenes={[{ scene: 'scene-0061', n_frames: 40, cached: true }]}
        currentScene="scene-0061"
        onSelectScene={vi.fn()}
        currentFrameIndex={0}
        totalFrames={40}
        currentFrameId="scene-0061_000000"
        onFrameChange={vi.fn()}
        layers={defaultLayers}
        onLayerToggle={vi.fn()}
        calibReport={null}
        onOpenCalibModal={vi.fn()}
        isSplatAvailable={false}
      />
    );

    // SPEC-P07 §4: "404 thì vô hiệu hoá layer, hover hiện "chưa có splat""
    expect(html).toContain('title="chưa có splat"');
    expect(html).toContain('disabled');
  });
});
