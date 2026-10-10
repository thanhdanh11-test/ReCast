import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Sidebar, LayerState } from './Sidebar';

describe('Sidebar Layer Checkboxes & Dense Layer (SPEC-P06 §4 & H17 §2, §3.3)', () => {
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
      <Sidebar
        scenes={[{ scene: 'scene-0061', n_frames: 40, cached: true }]}
        currentScene="scene-0061"
        onSelectScene={vi.fn()}
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
      <Sidebar
        scenes={[{ scene: 'scene-0061', n_frames: 40, cached: true }]}
        currentScene="scene-0061"
        onSelectScene={vi.fn()}
        layers={{ ...defaultLayers, dense: true }}
        onLayerToggle={vi.fn()}
        calibReport={null}
        onOpenCalibModal={vi.fn()}
        isDenseAvailable={true}
      />
    );

    expect(html).toContain('data-testid="layer-dense-checkbox"');
    // Not disabled, no "Chưa có dữ liệu dense" title
    expect(html).not.toContain('title="Chưa có dữ liệu dense"');
  });

  it('disables dense layer and displays "Chưa có dữ liệu dense" on hover when isDenseAvailable is false (404 fallback)', () => {
    const html = renderToString(
      <Sidebar
        scenes={[{ scene: 'scene-0061', n_frames: 40, cached: true }]}
        currentScene="scene-0061"
        onSelectScene={vi.fn()}
        layers={defaultLayers}
        onLayerToggle={vi.fn()}
        calibReport={null}
        onOpenCalibModal={vi.fn()}
        isDenseAvailable={false}
      />
    );

    // SPEC-P06 §4: "Thiếu objects_dense (404) thì layer dense bị vô hiệu hoá, hover vào hiện "Chưa có dữ liệu dense""
    expect(html).toContain('title="Chưa có dữ liệu dense"');
    expect(html).toContain('disabled');
  });

  it('enables splat checkbox when isSplatAvailable is true', () => {
    const html = renderToString(
      <Sidebar
        scenes={[{ scene: 'scene-0061', n_frames: 40, cached: true }]}
        currentScene="scene-0061"
        onSelectScene={vi.fn()}
        layers={{ ...defaultLayers, splat: true }}
        onLayerToggle={vi.fn()}
        calibReport={null}
        onOpenCalibModal={vi.fn()}
        isSplatAvailable={true}
      />
    );

    expect(html).toContain('data-testid="layer-splat-checkbox"');
    expect(html).not.toContain('title="Chưa có splat"');
  });

  it('disables splat layer and displays "Chưa có splat" on hover when isSplatAvailable is false (SPEC-P07 §4: 404 fallback)', () => {
    const html = renderToString(
      <Sidebar
        scenes={[{ scene: 'scene-0061', n_frames: 40, cached: true }]}
        currentScene="scene-0061"
        onSelectScene={vi.fn()}
        layers={defaultLayers}
        onLayerToggle={vi.fn()}
        calibReport={null}
        onOpenCalibModal={vi.fn()}
        isSplatAvailable={false}
      />
    );

    // SPEC-P07 §4: "404 thì vô hiệu hoá layer, hover hiện "Chưa có splat""
    expect(html).toContain('title="Chưa có splat"');
    expect(html).toContain('disabled');
  });
});
