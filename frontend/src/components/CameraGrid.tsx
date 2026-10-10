import React, { useEffect, useRef, useState } from 'react';
import { CameraCalib, Box3D } from '../api/types';
import {
  projectBoxToCamera,
  transformPointToCam,
  projectCamToPixel,
  shortLabel,
  isBoxLongEdgeAtLeast40,
} from '../geometry/projection';
import { PaneErrorBoundary } from './PaneErrorBoundary';

interface CameraGridProps {
  cameras: Record<string, CameraCalib>;
  cameraImageUrls: Record<string, string>;
  boxes: Box3D[];
  selectedBoxId: string | null;
  onSelectBox: (boxId: string | null) => void;
  showBoxes: boolean;
  onRenderReady?: () => void;
  frameId?: string;
}

const CAMERA_ORDER = [
  'CAM_FRONT_LEFT',
  'CAM_FRONT',
  'CAM_FRONT_RIGHT',
  'CAM_BACK_LEFT',
  'CAM_BACK',
  'CAM_BACK_RIGHT',
];

export const CameraGrid: React.FC<CameraGridProps> = ({
  cameras,
  cameraImageUrls,
  boxes,
  selectedBoxId,
  onSelectBox,
  showBoxes,
  onRenderReady,
  frameId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const camRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [failedCams, setFailedCams] = useState<Record<string, boolean>>({});
  const [hoveredBox, setHoveredBox] = useState<{ cam: string; box: Box3D } | null>(null);

  useEffect(() => {
    setFailedCams({});
  }, [cameraImageUrls]);

  // Auto-scroll to camera that sees selected box best (SPEC-P02 §2)
  useEffect(() => {
    if (selectedBoxId === null) return;
    const selectedBox = boxes.find((b) => b.id === selectedBoxId);
    if (!selectedBox) return;

    let bestCam: string | null = null;
    let minCenterDist = Infinity;

    for (const camName of CAMERA_ORDER) {
      const calib = cameras[camName];
      if (!calib) continue;

      const pCam = transformPointToCam(
        [selectedBox.cx, selectedBox.cy, selectedBox.cz],
        calib.T_lidar_cam
      );

      // Must be in front of camera
      if (pCam[2] <= 0.1) continue;

      const pixel = projectCamToPixel(pCam, calib.K);
      if (!pixel) continue;

      // Check if point falls inside image bounds
      if (
        pixel.u >= 0 &&
        pixel.u <= calib.width &&
        pixel.v >= 0 &&
        pixel.v <= calib.height
      ) {
        const dist = Math.hypot(
          pixel.u - calib.width / 2,
          pixel.v - calib.height / 2
        );
        if (dist < minCenterDist) {
          minCenterDist = dist;
          bestCam = camName;
        }
      }
    }

    if (bestCam && camRefs.current[bestCam]) {
      camRefs.current[bestCam]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [selectedBoxId, boxes, cameras]);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        padding: '8px',
        backgroundColor: '#050505',
        height: '100%',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      {CAMERA_ORDER.map((camName) => {
        const calib = cameras[camName];
        const imgUrl = cameraImageUrls[camName];

        return (
          <div
            key={camName}
            ref={(el) => {
              camRefs.current[camName] = el;
            }}
            style={{
              position: 'relative',
              backgroundColor: '#0c0c0c',
              borderRadius: '6px',
              overflow: 'hidden',
              border: '1px solid #1a1a1a',
              aspectRatio: '16/9',
            }}
          >
            <PaneErrorBoundary paneName={camName} resetKeys={[frameId, imgUrl]}>
              {/* Camera label banner */}
              <div
                style={{
                  position: 'absolute',
                  top: '6px',
                  left: '6px',
                  zIndex: 10,
                  backgroundColor: 'rgba(0, 0, 0, 0.75)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  color: '#00f3ff',
                  border: '1px solid #334155',
                }}
              >
                {camName}
              </div>

              {/* Background Camera Image */}
              {imgUrl && !failedCams[camName] ? (
                <img
                  src={imgUrl}
                  alt={camName}
                  onError={() => {
                    setFailedCams((prev) => ({ ...prev, [camName]: true }));
                  }}
                  onLoad={() => {
                    if (onRenderReady) onRenderReady();
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  data-testid={`no-camera-data-${camName}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: '#94a3b8',
                    fontSize: '13px',
                    fontStyle: 'italic',
                  }}
                >
                  không có dữ liệu
                </div>
              )}

              {/* SVG Overlay for Projected 3D Bounding Boxes */}
              {calib && (
                <svg
                  viewBox={`0 0 ${calib.width} ${calib.height}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                  }}
                >
                  {showBoxes &&
                    boxes.map((box) => {
                      const edges = projectBoxToCamera(box, calib);
                      if (edges.length === 0) return null;

                      const isSelected = box.id === selectedBoxId;
                      const strokeColor = isSelected
                        ? '#00f3ff'
                        : box.label.includes('human')
                        ? '#eab308'
                        : '#22c55e';
                      const strokeWidth = isSelected ? 4 : 2;

                      // Long edge >= 40 px or selected (SPEC-P02 §2)
                      const isLongEnough = isBoxLongEdgeAtLeast40(edges);
                      const shouldShowLabel = isSelected || isLongEnough;

                      // First edge point for label tag
                      const firstEdge = edges[0];

                      return (
                        <g
                          key={`box-${box.id}`}
                          data-testid={`camera-box-${box.id}`}
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectBox(box.id);
                          }}
                          onMouseEnter={() => setHoveredBox({ cam: camName, box })}
                          onMouseLeave={() =>
                            setHoveredBox((prev) =>
                              prev?.box.id === box.id && prev?.cam === camName ? null : prev
                            )
                          }
                        >
                          <title>{`${box.label} (${box.id})`}</title>
                          {edges.map((edge, idx) => (
                            <line
                              key={idx}
                              x1={edge.p1.u}
                              y1={edge.p1.v}
                              x2={edge.p2.u}
                              y2={edge.p2.v}
                              stroke={strokeColor}
                              strokeWidth={strokeWidth}
                              strokeLinecap="round"
                            />
                          ))}

                          {/* Label Badge: short label only, ~11px font, no id */}
                          {shouldShowLabel && firstEdge && (
                            <text
                              x={firstEdge.p1.u + 6}
                              y={Math.max(16, firstEdge.p1.v - 6)}
                              fill={strokeColor}
                              fontSize="11"
                              fontWeight="bold"
                              fontFamily="monospace"
                              stroke="#000"
                              strokeWidth="2.5"
                              paintOrder="stroke"
                            >
                              {shortLabel(box.label)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                </svg>
              )}

              {/* Tooltip on box hover */}
              {hoveredBox && hoveredBox.cam === camName && (
                <div
                  data-testid="camera-box-tooltip"
                  style={{
                    position: 'absolute',
                    bottom: '6px',
                    right: '6px',
                    zIndex: 20,
                    backgroundColor: 'rgba(0, 0, 0, 0.92)',
                    border: '1px solid #00f3ff',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontSize: '11px',
                    color: '#f8fafc',
                    pointerEvents: 'none',
                    fontFamily: 'monospace',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{hoveredBox.box.label}</span> ·{' '}
                  <span style={{ color: '#94a3b8' }}>{hoveredBox.box.id}</span>
                </div>
              )}
            </PaneErrorBoundary>
          </div>
        );
      })}
    </div>
  );
};
