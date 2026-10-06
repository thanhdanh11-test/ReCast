import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box3D, BoxAtlas, BevConfig, DEFAULT_BEV_CONFIG } from '../api/types';
import { metersToPixel, pixelToMeters, shortLabel } from '../geometry/coords';
import { formatTextureSource } from '../geometry/textureSource';

export interface TopViewProps {
  bevUrl: string | null;
  boxAtlas?: BoxAtlas | null;
  pointsData?: Float32Array | null;
  boxes: Box3D[];
  selectedBoxId: string | null;
  onSelectBox: (boxId: string | null) => void;
  showGround: boolean;
  showBoxes: boolean;
  bevConfig?: BevConfig;
  onRenderReady?: () => void;
}

export const TopView: React.FC<TopViewProps> = ({
  bevUrl,
  boxAtlas,
  pointsData,
  boxes,
  selectedBoxId,
  onSelectBox,
  showGround,
  showBoxes,
  bevConfig = DEFAULT_BEV_CONFIG,
  onRenderReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bevImageRef = useRef<HTMLImageElement | null>(null);
  const pointsCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Pan and zoom state
  const [zoom, setZoom] = useState<number>(0.65);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredBoxId, setHoveredBoxId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Load BEV image
  useEffect(() => {
    if (!bevUrl) {
      bevImageRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = bevUrl;
    img.onload = () => {
      bevImageRef.current = img;
      render();
    };
    img.onerror = () => {
      bevImageRef.current = null;
      render();
    };
  }, [bevUrl]);

  // Pre-render point cloud onto offscreen canvas for top-down orthographic projection
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (!pointsData || pointsData.length === 0) {
      pointsCanvasRef.current = null;
      render();
      return;
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = bevConfig.size_px;
    offscreen.height = bevConfig.size_px;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    const numPoints = Math.floor(pointsData.length / 7);
    const resM = bevConfig.res_m;
    const sizePx = bevConfig.size_px;
    const center = sizePx / 2 - 0.5;

    for (let i = 0; i < numPoints; i++) {
      const offset = i * 7;
      const x = pointsData[offset];
      const y = pointsData[offset + 1];

      // Convert LiDAR (x, y) to BEV pixel (u, v)
      // 01-CONTRACTS §3: x = (u + 0.5 - 600) * 0.1, y = (600 - v - 0.5) * 0.1
      const u = x / resM + center;
      const v = center - y / resM;

      if (u < 0 || u >= sizePx || v < 0 || v >= sizePx) continue;

      const intensity = pointsData[offset + 3];
      const r = pointsData[offset + 4];
      const g = pointsData[offset + 5];
      const b = pointsData[offset + 6];

      if (r >= 0) {
        // True RGB color when point was projected onto a camera
        offCtx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      } else {
        // Grayscale color from LiDAR intensity when r < 0
        const shade = Math.min(255, Math.max(0, intensity | 0));
        offCtx.fillStyle = `rgb(${shade},${shade},${shade})`;
      }

      offCtx.fillRect(u - 1, v - 1, 2, 2);
    }

    pointsCanvasRef.current = offscreen;
    render();
  }, [pointsData, bevConfig]);

  // Render loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);

    // Save state for transform (pan & zoom centered at container center)
    ctx.save();
    const centerX = width / 2 + pan.x;
    const centerY = height / 2 + pan.y;
    ctx.translate(centerX, centerY);
    ctx.scale(zoom, zoom);

    // Origin in BEV coordinates is (600, 600)
    const bevOriginX = bevConfig.size_px / 2;
    const bevOriginY = bevConfig.size_px / 2;
    ctx.translate(-bevOriginX, -bevOriginY);

    // 1. Draw BEV image (ground layer) or default grid
    if (showGround && bevImageRef.current) {
      ctx.drawImage(
        bevImageRef.current,
        0,
        0,
        bevConfig.size_px,
        bevConfig.size_px
      );
    } else {
      // Default dark grid background
      ctx.fillStyle = '#141720';
      ctx.fillRect(0, 0, bevConfig.size_px, bevConfig.size_px);
      ctx.strokeStyle = '#222736';
      ctx.lineWidth = 1;
      for (let p = 0; p <= bevConfig.size_px; p += 100) {
        ctx.beginPath();
        ctx.moveTo(p, 0); ctx.lineTo(p, bevConfig.size_px);
        ctx.moveTo(0, p); ctx.lineTo(bevConfig.size_px, p);
        ctx.stroke();
      }

      // Range rings and ego mark when BEV is missing
      const cx = bevConfig.size_px / 2;
      const cy = bevConfig.size_px / 2;
      ctx.strokeStyle = '#282d3c';
      ctx.lineWidth = 1;
      for (const radiusM of [10, 20, 30, 40, 50]) {
        const rPx = radiusM / bevConfig.res_m;
        ctx.beginPath();
        ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#475569';
        ctx.font = '11px monospace';
        ctx.fillText(`${radiusM}m`, cx + rPx + 4, cy - 4);
      }

      // Ego vehicle footprint at (0, 0) LiDAR_TOP
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(cx - 10, cy - 22, 20, 44);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 28);
      ctx.lineTo(cx - 6, cy - 20);
      ctx.lineTo(cx + 6, cy - 20);
      ctx.closePath();
      ctx.fill();
    }

    // 2. Draw Top-down LiDAR Point Cloud
    if (pointsCanvasRef.current) {
      ctx.drawImage(pointsCanvasRef.current, 0, 0, bevConfig.size_px, bevConfig.size_px);
    }

    // 3. Draw 3D Box Overlays on Top View
    if (showBoxes) {
      for (const box of boxes) {
        const isSelected = box.id === selectedBoxId;
        const cosY = Math.cos(box.yaw);
        const sinY = Math.sin(box.yaw);

        // 4 corners in meters:
        const c1m = [box.cx + (box.l / 2) * cosY - (box.w / 2) * sinY, box.cy + (box.l / 2) * sinY + (box.w / 2) * cosY];
        const c2m = [box.cx + (box.l / 2) * cosY + (box.w / 2) * sinY, box.cy + (box.l / 2) * sinY - (box.w / 2) * cosY];
        const c3m = [box.cx - (box.l / 2) * cosY + (box.w / 2) * sinY, box.cy - (box.l / 2) * sinY - (box.w / 2) * cosY];
        const c4m = [box.cx - (box.l / 2) * cosY - (box.w / 2) * sinY, box.cy - (box.l / 2) * sinY + (box.w / 2) * cosY];

        const p1 = metersToPixel(c1m[0], c1m[1], bevConfig);
        const p2 = metersToPixel(c2m[0], c2m[1], bevConfig);
        const p3 = metersToPixel(c3m[0], c3m[1], bevConfig);
        const p4 = metersToPixel(c4m[0], c4m[1], bevConfig);

        const centerPx = metersToPixel(box.cx, box.cy, bevConfig);
        const headingTipM = [box.cx + (box.l / 2 + 1.2) * cosY, box.cy + (box.l / 2 + 1.2) * sinY];
        const headingTipPx = metersToPixel(headingTipM[0], headingTipM[1], bevConfig);

        // Box Polygon
        ctx.beginPath();
        ctx.moveTo(p1.u, p1.v);
        ctx.lineTo(p2.u, p2.v);
        ctx.lineTo(p3.u, p3.v);
        ctx.lineTo(p4.u, p4.v);
        ctx.closePath();

        // Fill color
        ctx.fillStyle = isSelected
          ? 'rgba(56, 189, 248, 0.35)'
          : box.label.includes('human')
          ? 'rgba(234, 179, 8, 0.25)'
          : 'rgba(34, 197, 94, 0.25)';
        ctx.fill();

        // Stroke
        ctx.lineWidth = isSelected ? 3 : 1.5;
        ctx.strokeStyle = isSelected
          ? '#38bdf8'
          : box.label.includes('human')
          ? '#eab308'
          : '#22c55e';
        ctx.stroke();

        // Heading direction line (vạch chỉ hướng đầu xe)
        ctx.beginPath();
        ctx.moveTo(centerPx.u, centerPx.v);
        ctx.lineTo(headingTipPx.u, headingTipPx.v);
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeStyle = isSelected ? '#38bdf8' : '#ef4444';
        ctx.stroke();

        // Front face highlight (edge p1 -> p2)
        ctx.beginPath();
        ctx.moveTo(p1.u, p1.v);
        ctx.lineTo(p2.u, p2.v);
        ctx.lineWidth = isSelected ? 4 : 2.5;
        ctx.strokeStyle = isSelected ? '#38bdf8' : '#f43f5e';
        ctx.stroke();

        // Box label
        // SPEC-P02 §2: Top view: mặc định KHÔNG in chữ. Chỉ box đang chọn hoặc đang rê chuột mới hiện tên ngắn.
        // CẤM in id lên canvas hay ảnh.
        const isHovered = box.id === hoveredBoxId;
        if (isSelected || isHovered) {
          ctx.font = 'bold 11px sans-serif';
          ctx.fillStyle = isSelected ? '#38bdf8' : '#e2e8f0';
          ctx.fillText(
            shortLabel(box.label),
            p1.u + 4,
            p1.v - 4
          );
        }
      }
    }

    ctx.restore();

    // 4. Draw Scale bar (Thước mét đúng res_m) at bottom-left corner
    const scaleMeters = 10;
    const scalePx = (scaleMeters / bevConfig.res_m) * zoom;
    const barX = 20;
    const barY = height - 25;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(barX - 8, barY - 22, scalePx + 16, 32);

    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(barX, barY - 5); ctx.lineTo(barX, barY + 5);
    ctx.moveTo(barX, barY); ctx.lineTo(barX + scalePx, barY);
    ctx.moveTo(barX + scalePx, barY - 5); ctx.lineTo(barX + scalePx, barY + 5);
    ctx.stroke();

    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(`${scaleMeters}m (res=${bevConfig.res_m}m)`, barX + 4, barY - 8);

    // Top view title (offset to make room for 2D|Bird switch at left: 12)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(92, 10, 180, 24);
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('TOP VIEW (orthographic 2D)', 100, 26);

    if (onRenderReady) {
      onRenderReady();
    }
  }, [bevConfig, boxes, pan, selectedBoxId, hoveredBoxId, showBoxes, showGround, zoom, onRenderReady]);

  useEffect(() => {
    render();
  }, [render]);

  // Window resize handler
  useEffect(() => {
    const handleResize = () => render();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [render]);

  // Mouse event handlers for pan & zoom & click selection
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom((prev) => Math.min(3.5, Math.max(0.2, prev * factor)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
      setHoveredBoxId(null);
    } else {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      setMousePos({ x: mouseX, y: mouseY });

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2 + pan.x;
      const centerY = height / 2 + pan.y;

      const u = (mouseX - centerX) / zoom + bevConfig.size_px / 2;
      const v = (mouseY - centerY) / zoom + bevConfig.size_px / 2;

      const { x, y } = pixelToMeters(u, v, bevConfig);

      let foundId: string | null = null;
      let closestDist = Infinity;

      if (showBoxes) {
        for (const box of boxes) {
          const d = Math.hypot(box.cx - x, box.cy - y);
          const radius = Math.max(box.l, box.w) / 1.5;
          if (d <= radius && d < closestDist) {
            closestDist = d;
            foundId = box.id;
          }
        }
      }

      setHoveredBoxId(foundId);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isDragging) {
      setIsDragging(false);
      const dist = Math.hypot(
        e.clientX - (dragStart.x + pan.x),
        e.clientY - (dragStart.y + pan.y)
      );
      if (dist < 4) {
        handleCanvasClick(e);
      }
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2 + pan.x;
    const centerY = height / 2 + pan.y;

    const u = (clickX - centerX) / zoom + bevConfig.size_px / 2;
    const v = (clickY - centerY) / zoom + bevConfig.size_px / 2;

    const { x, y } = pixelToMeters(u, v, bevConfig);

    let clickedId: string | null = null;
    let closestDist = Infinity;

    for (const box of boxes) {
      const d = Math.hypot(box.cx - x, box.cy - y);
      const radius = Math.max(box.l, box.w) / 1.5;
      if (d <= radius && d < closestDist) {
        closestDist = d;
        clickedId = box.id;
      }
    }

    onSelectBox(clickedId);
  };

  const resetView = () => {
    setZoom(0.65);
    setPan({ x: 0, y: 0 });
  };

  const selectedBox = boxes.find((b) => b.id === selectedBoxId);
  const hoveredBox = boxes.find((b) => b.id === hoveredBoxId);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#0f1117',
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => setHoveredBoxId(null)}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />

      {/* Notice tag for missing BEV top view (when ground layer is active but bevUrl is null/404) */}
      {showGround && !bevUrl && (
        <div
          data-testid="bev-status"
          style={{
            position: 'absolute',
            top: 10,
            left: 280,
            backgroundColor: 'rgba(234, 179, 8, 0.15)',
            border: '1px solid #eab308',
            color: '#facc15',
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: '11px',
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          chưa có top view
        </div>
      )}

      {/* Tooltip when hovering over a box in TopView */}
      {hoveredBox && hoveredBox.id !== selectedBoxId && (
        <div
          data-testid="topview-box-tooltip"
          style={{
            position: 'absolute',
            left: Math.min(mousePos.x + 12, (containerRef.current?.clientWidth || 400) - 220),
            top: Math.max(10, mousePos.y - 28),
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid #38bdf8',
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: '11px',
            color: '#f8fafc',
            pointerEvents: 'none',
            zIndex: 20,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
          }}
        >
          <span style={{ fontWeight: 600 }}>{hoveredBox.label}</span> ·{' '}
          <span style={{ color: '#94a3b8' }}>{hoveredBox.id}</span>
        </div>
      )}

      {/* Selected box info panel (SPEC-P02 §2 & H11 §3 item 4) */}
      {selectedBox && (
        <div
          data-testid="selected-box-info"
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid #38bdf8',
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#e2e8f0',
            zIndex: 15,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            maxWidth: '300px',
            lineHeight: '1.5',
            pointerEvents: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '4px',
              borderBottom: '1px solid #334155',
              paddingBottom: '3px',
            }}
          >
            <span style={{ fontWeight: 'bold', color: '#38bdf8', fontSize: '11px' }}>
              BOX ĐANG CHỌN
            </span>
            <button
              onClick={() => onSelectBox(null)}
              title="Deselect"
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          <div><strong style={{ color: '#94a3b8' }}>label:</strong> {selectedBox.label}</div>
          <div style={{ wordBreak: 'break-all' }}><strong style={{ color: '#94a3b8' }}>id:</strong> {selectedBox.id}</div>
          <div><strong style={{ color: '#94a3b8' }}>track_key:</strong> {selectedBox.track_key ?? 'none'}</div>
          <div><strong style={{ color: '#94a3b8' }}>l×w×h:</strong> {`${selectedBox.l.toFixed(2)} × ${selectedBox.w.toFixed(2)} × ${selectedBox.h.toFixed(2)} m`}</div>
          <div><strong style={{ color: '#94a3b8' }}>yaw:</strong> {`${((selectedBox.yaw * 180) / Math.PI).toFixed(1)}°`}</div>
          {boxAtlas && (
            <div data-testid="box-texture-source" style={{ marginTop: '2px', wordBreak: 'break-word', color: '#cbd5e1' }}>
              <strong style={{ color: '#94a3b8' }}>texture:</strong> {formatTextureSource(boxAtlas.boxes?.[selectedBox.id])}
            </div>
          )}
        </div>
      )}

      {/* Control buttons overlay */}
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6 }}>
        <button
          onClick={resetView}
          title="Reset View"
          style={{
            backgroundColor: 'rgba(30, 35, 48, 0.85)',
            color: '#cbd5e1',
            border: '1px solid #333a4d',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '11px',
          }}
        >
          Reset
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(3.5, z * 1.25))}
          title="Zoom In"
          style={{
            backgroundColor: 'rgba(30, 35, 48, 0.85)',
            color: '#cbd5e1',
            border: '1px solid #333a4d',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
          }}
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}
          title="Zoom Out"
          style={{
            backgroundColor: 'rgba(30, 35, 48, 0.85)',
            color: '#cbd5e1',
            border: '1px solid #333a4d',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
          }}
        >
          -
        </button>
      </div>
    </div>
  );
};
