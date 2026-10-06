import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SurroundView } from './SurroundView';
import { Box3D } from '../api/types';
import { getMockPanoMeta, getMockPanoDepthBuffer, getMockPanoRgbUrl, getMockPanoAlphaUrl } from '../api/mockPano';

const sampleBoxes: Box3D[] = [
  {
    id: 'gt:box_01',
    label: 'vehicle',
    track_key: 'track_01',
    cx: 2.0,
    cy: 8.0,
    cz: -0.5,
    l: 4.8,
    w: 2.1,
    h: 1.7,
    yaw: 0.15,
    score: null,
    version: null,
    source: 'gt',
    attributes: {},
  },
];

describe('SurroundView Component (SPEC-P09 §3 & H23)', () => {
  it('renders SurroundView container with title, pitch slider (default 35°), and reset button', () => {
    const html = renderToString(
      <SurroundView
        panoMeta={getMockPanoMeta()}
        panoDepthBuffer={getMockPanoDepthBuffer()}
        panoRgbUrl={getMockPanoRgbUrl()}
        panoAlphaUrl={getMockPanoAlphaUrl()}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
      />
    );

    expect(html).toContain('data-testid="surround-view-container"');
    expect(html).toContain('SURROUND 3D (LiDAR bowl)');
    expect(html).toContain('data-testid="pitch-slider"');
    expect(html).toContain('min="10"');
    expect(html).toContain('max="89"');
    expect(html).toContain('value="35"');
    expect(html).toContain('data-testid="reset-surround-camera-btn"');
    expect(html).toContain('Đặt lại (35° / 12m)');
  });

  it('renders 404 notice when pano data is missing or is404 is true', () => {
    const html404 = renderToString(
      <SurroundView
        panoMeta={null}
        panoDepthBuffer={null}
        panoRgbUrl={null}
        panoAlphaUrl={null}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
        is404={true}
      />
    );

    expect(html404).toContain('data-testid="surround-404-notice"');
    expect(html404).toContain('Chưa có dữ liệu panorama (404) cho frame này');
  });

  it('does not render 404 notice when pano data is present and is404 is false', () => {
    const html = renderToString(
      <SurroundView
        panoMeta={getMockPanoMeta()}
        panoDepthBuffer={getMockPanoDepthBuffer()}
        panoRgbUrl={getMockPanoRgbUrl()}
        panoAlphaUrl={getMockPanoAlphaUrl()}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
        is404={false}
      />
    );

    expect(html).not.toContain('data-testid="surround-404-notice"');
  });

  it('renders selected box info HUD when a box is selected', () => {
    const html = renderToString(
      <SurroundView
        panoMeta={getMockPanoMeta()}
        panoDepthBuffer={getMockPanoDepthBuffer()}
        panoRgbUrl={getMockPanoRgbUrl()}
        panoAlphaUrl={getMockPanoAlphaUrl()}
        boxes={sampleBoxes}
        selectedBoxId="gt:box_01"
        onSelectBox={() => {}}
      />
    );

    expect(html).toContain('data-testid="selected-box-hud"');
    expect(html).toContain('vehicle (gt:box_01)');
    expect(html).toContain('4.80m × 2.10m × 1.70m');
  });

  it('does not render selected box info HUD when no box is selected', () => {
    const html = renderToString(
      <SurroundView
        panoMeta={getMockPanoMeta()}
        panoDepthBuffer={getMockPanoDepthBuffer()}
        panoRgbUrl={getMockPanoRgbUrl()}
        panoAlphaUrl={getMockPanoAlphaUrl()}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
      />
    );

    expect(html).not.toContain('data-testid="selected-box-hud"');
  });

  // SPEC-P09 §5 (F1): Background sphere with radius max_depth_m (default 60m)
  it('có quả cầu nền và bán kính đúng max_depth_m', () => {
    const defaultMeta = getMockPanoMeta(); // max_depth_m: 60.0
    const htmlDefault = renderToString(
      <SurroundView
        panoMeta={defaultMeta}
        panoDepthBuffer={getMockPanoDepthBuffer()}
        panoRgbUrl={getMockPanoRgbUrl()}
        panoAlphaUrl={getMockPanoAlphaUrl()}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
      />
    );

    expect(htmlDefault).toContain('data-testid="surround-background-sphere"');
    expect(htmlDefault).toContain('data-radius="60"');
    expect(htmlDefault).toContain('data-bg-radius="60"');

    // Test with custom max_depth_m (e.g. 80.0m)
    const customMeta = { ...defaultMeta, max_depth_m: 80.0 };
    const htmlCustom = renderToString(
      <SurroundView
        panoMeta={customMeta}
        panoDepthBuffer={getMockPanoDepthBuffer()}
        panoRgbUrl={getMockPanoRgbUrl()}
        panoAlphaUrl={getMockPanoAlphaUrl()}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
      />
    );

    expect(htmlCustom).toContain('data-testid="surround-background-sphere"');
    expect(htmlCustom).toContain('data-radius="80"');
    expect(htmlCustom).toContain('data-bg-radius="80"');
  });

  // SPEC-P09 §5 (F2): BEV Ground Plane at ground_z when ground layer is enabled
  it('mặt đất bev hiện khi bật ground và nằm ở ground_z', () => {
    const html = renderToString(
      <SurroundView
        panoMeta={getMockPanoMeta()}
        panoDepthBuffer={getMockPanoDepthBuffer()}
        panoRgbUrl={getMockPanoRgbUrl()}
        panoAlphaUrl={getMockPanoAlphaUrl()}
        bevUrl="blob:http://localhost/bev.png"
        showGround={true}
        groundZ={-1.84}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
      />
    );

    expect(html).toContain('data-testid="surround-ground-bev"');
    expect(html).toContain('data-ground-z="-1.84"');
    expect(html).toContain('data-bev-url="blob:http://localhost/bev.png"');
    expect(html).toContain('data-ground-visible="true"');
    expect(html).toContain('data-has-bev="true"');
  });

  it('mặt đất bev ẩn khi tắt layer ground', () => {
    const html = renderToString(
      <SurroundView
        panoMeta={getMockPanoMeta()}
        panoDepthBuffer={getMockPanoDepthBuffer()}
        panoRgbUrl={getMockPanoRgbUrl()}
        panoAlphaUrl={getMockPanoAlphaUrl()}
        bevUrl="blob:http://localhost/bev.png"
        showGround={false}
        groundZ={-1.84}
        boxes={sampleBoxes}
        selectedBoxId={null}
        onSelectBox={() => {}}
      />
    );

    expect(html).not.toContain('data-testid="surround-ground-bev"');
    expect(html).toContain('data-ground-visible="false"');
    expect(html).toContain('data-has-bev="false"');
  });

  // SPEC-P09 §5 (F2): Missing bev.png (404) does not crash
  it('thiếu bev.png (404) thì không crash', () => {
    expect(() => {
      const html = renderToString(
        <SurroundView
          panoMeta={getMockPanoMeta()}
          panoDepthBuffer={getMockPanoDepthBuffer()}
          panoRgbUrl={getMockPanoRgbUrl()}
          panoAlphaUrl={getMockPanoAlphaUrl()}
          bevUrl={null}
          showGround={true}
          groundZ={-1.84}
          boxes={sampleBoxes}
          selectedBoxId={null}
          onSelectBox={() => {}}
        />
      );

      expect(html).toContain('data-testid="surround-view-container"');
      expect(html).not.toContain('data-testid="surround-ground-bev"');
      expect(html).toContain('data-has-bev="false"');
    }).not.toThrow();
  });
});
