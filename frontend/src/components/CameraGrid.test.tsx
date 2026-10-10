import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CameraGrid } from './CameraGrid';
import { Box3D, CameraCalib } from '../api/types';

describe('CameraGrid Box Selection & Highlighting (H06 contract & H11 box labels)', () => {
  const mockCameras: Record<string, CameraCalib> = {
    CAM_FRONT: {
      name: 'CAM_FRONT',
      K: [
        [1000, 0, 800],
        [0, 1000, 450],
        [0, 0, 1],
      ],
      // Transform LiDAR (x right, y front, z up) -> Cam (x right, y down, z forward)
      T_lidar_cam: [
        [1, 0, 0, 0],
        [0, 0, -1, 0],
        [0, 1, 0, 0],
        [0, 0, 0, 1],
      ],
      width: 1600,
      height: 900,
    },
  };

  const boxA: Box3D = {
    id: 'gt:scene-0061_000000_box01',
    source: 'gt',
    track_key: 'inst:car_01',
    label: 'vehicle.car',
    cx: 0,
    cy: 10,
    cz: 0,
    l: 2,
    w: 2,
    h: 2,
    yaw: 0,
    score: 1.0,
    version: null,
    attributes: {},
  };

  const boxB: Box3D = {
    id: 'gt:scene-0061_000000_box02',
    source: 'gt',
    track_key: 'inst:car_02',
    label: 'vehicle.car',
    cx: 0,
    cy: 18,
    cz: 0,
    l: 2,
    w: 2,
    h: 2,
    yaw: 0,
    score: 1.0,
    version: null,
    attributes: {},
  };

  // Small box far away: cy = 80, size 0.8m -> projected size ~ 1000 * 0.8 / 80 = 10px (< 40px)
  const boxSmall: Box3D = {
    id: 'gt:scene-0061_000000_box_small',
    source: 'gt',
    track_key: 'inst:ped_01',
    label: 'human.pedestrian',
    cx: 0,
    cy: 80,
    cz: 0,
    l: 0.8,
    w: 0.8,
    h: 0.8,
    yaw: 0,
    score: 1.0,
    version: null,
    attributes: {},
  };

  it('highlights ONLY boxA when selectedBoxId equals boxA.id and shows short label', () => {
    const html = renderToString(
      <CameraGrid
        cameras={mockCameras}
        cameraImageUrls={{ CAM_FRONT: 'blob:mock-cam-url' }}
        boxes={[boxA, boxB]}
        selectedBoxId={boxA.id}
        onSelectBox={() => {}}
        showBoxes={true}
      />
    );

    // Box A has label tag with highlight color #00f3ff
    expect(html).toContain(`fill="#00f3ff"`);
    expect(html).toContain(`>car</text>`);

    // Box A lines are stroke-width 4
    expect(html).toContain(`stroke-width="4"`);

    // Box B retains default color #22c55e and stroke-width 2
    expect(html).toContain(`fill="#22c55e"`);
    expect(html).toContain(`stroke-width="2"`);

    // Ensure React key is not box-undefined
    expect(html).not.toContain('box-undefined');
  });

  it('highlights ONLY boxB when selectedBoxId equals boxB.id', () => {
    const html = renderToString(
      <CameraGrid
        cameras={mockCameras}
        cameraImageUrls={{ CAM_FRONT: 'blob:mock-cam-url' }}
        boxes={[boxA, boxB]}
        selectedBoxId={boxB.id}
        onSelectBox={() => {}}
        showBoxes={true}
      />
    );

    // Box B is highlighted with #00f3ff
    expect(html).toContain(`fill="#00f3ff"`);
    expect(html).toContain(`>car</text>`);

    // Box A has normal color #22c55e
    expect(html).toContain(`fill="#22c55e"`);
  });

  it('highlights neither box when selectedBoxId is null', () => {
    const html = renderToString(
      <CameraGrid
        cameras={mockCameras}
        cameraImageUrls={{ CAM_FRONT: 'blob:mock-cam-url' }}
        boxes={[boxA, boxB]}
        selectedBoxId={null}
        onSelectBox={() => {}}
        showBoxes={true}
      />
    );

    // No highlight color #00f3ff in SVG boxes
    expect(html).not.toContain(`fill="#00f3ff"`);
    expect(html).not.toContain(`stroke-width="4"`);

    // Both are unselected #22c55e with stroke-width 2 and short label
    expect(html).toContain(`fill="#22c55e"`);
    expect(html).toContain(`>car</text>`);
  });

  it('Camera: box < 40 px không có chữ, box ≥ 40 px có chữ, box đang chọn luôn có chữ', () => {
    // 1. When unselected: boxA (>= 40px) has label, boxSmall (< 40px) does NOT have label
    const htmlUnselected = renderToString(
      <CameraGrid
        cameras={mockCameras}
        cameraImageUrls={{ CAM_FRONT: 'blob:mock-cam-url' }}
        boxes={[boxA, boxSmall]}
        selectedBoxId={null}
        onSelectBox={() => {}}
        showBoxes={true}
      />
    );

    // boxA (>= 40px) has short label 'car'
    expect(htmlUnselected).toContain('>car</text>');
    // boxSmall (< 40px) does not have label 'ped'
    expect(htmlUnselected).not.toContain('>ped</text>');

    // 2. When boxSmall is selected: it ALWAYS has text even though < 40px
    const htmlSelectedSmall = renderToString(
      <CameraGrid
        cameras={mockCameras}
        cameraImageUrls={{ CAM_FRONT: 'blob:mock-cam-url' }}
        boxes={[boxA, boxSmall]}
        selectedBoxId={boxSmall.id}
        onSelectBox={() => {}}
        showBoxes={true}
      />
    );

    expect(htmlSelectedSmall).toContain('>ped</text>');
    expect(htmlSelectedSmall).toContain(`fill="#00f3ff"`);
  });

  it('Không phần tử text nào chứa chuỗi "gt:" (SPEC-P02 §2 CẤM in id lên canvas hay ảnh)', () => {
    const html = renderToString(
      <CameraGrid
        cameras={mockCameras}
        cameraImageUrls={{ CAM_FRONT: 'blob:mock-cam-url' }}
        boxes={[boxA, boxB, boxSmall]}
        selectedBoxId={boxA.id}
        onSelectBox={() => {}}
        showBoxes={true}
      />
    );

    // Extract all SVG <text> elements and verify inner text does not contain gt: or #
    const textMatches = [...html.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)];
    expect(textMatches.length).toBeGreaterThan(0);

    for (const match of textMatches) {
      const innerText = match[1];
      expect(innerText).not.toContain('gt:');
      expect(innerText).not.toContain('#');
    }
  });

  it('Thêm tooltip cho box hiện tên lớp và id đầy đủ', () => {
    const html = renderToString(
      <CameraGrid
        cameras={mockCameras}
        cameraImageUrls={{ CAM_FRONT: 'blob:mock-cam-url' }}
        boxes={[boxA]}
        selectedBoxId={null}
        onSelectBox={() => {}}
        showBoxes={true}
      />
    );

    // SVG <title> provides native tooltip on box hover
    expect(html).toContain(`<title>${boxA.label} (${boxA.id})</title>`);
  });

  it('renders correctly with optional frameId prop passed', () => {
    const html = renderToString(
      <CameraGrid
        frameId="scene-0061_000000"
        cameras={mockCameras}
        cameraImageUrls={{ CAM_FRONT: 'blob:mock-cam-url' }}
        boxes={[boxA]}
        selectedBoxId={null}
        onSelectBox={() => {}}
        showBoxes={true}
      />
    );
    expect(html).toContain('CAM_FRONT');
  });
});
