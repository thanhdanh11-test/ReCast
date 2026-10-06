import React from 'react';
import { CalibReport, SceneSummary } from '../api/types';

export interface LayerState {
  ground: boolean;
  color: boolean;
  raw: boolean;
  boxes: boolean;
  dense: boolean;
  splat: boolean;
}

interface HeaderProps {
  scenes: SceneSummary[];
  currentScene: string;
  onSelectScene: (scene: string) => void;
  currentFrameIndex: number;
  totalFrames: number;
  currentFrameId: string;
  onFrameChange: (index: number) => void;
  layers: LayerState;
  onLayerToggle: (layerKey: keyof LayerState) => void;
  calibReport: CalibReport | null;
  onOpenCalibModal: () => void;
  onRunBenchmark?: () => void;
  isBenchmarking?: boolean;
  benchmarkProgress?: { current: number; total: number } | null;
  isDenseAvailable?: boolean;
  isSplatAvailable?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  scenes,
  currentScene,
  onSelectScene,
  currentFrameIndex,
  totalFrames,
  currentFrameId,
  onFrameChange,
  layers,
  onLayerToggle,
  calibReport,
  onOpenCalibModal,
  onRunBenchmark,
  isBenchmarking = false,
  benchmarkProgress = null,
  isDenseAvailable = true,
  isSplatAvailable = true,
}) => {
  const verdict = calibReport?.verdict || 'ok';
  const calibColor =
    verdict === 'ok' ? '#22c55e' : verdict === 'warning' ? '#eab308' : '#ef4444';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        backgroundColor: '#16181f',
        borderBottom: '1px solid #232734',
        height: '48px',
        gap: '16px',
        fontSize: '13px',
      }}
    >
      {/* 1. Scene selection & Branding */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontWeight: 700, fontSize: '15px', color: '#38bdf8' }}>
          topeye
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ color: '#94a3b8' }}>scene:</label>
          <select
            value={currentScene}
            onChange={(e) => onSelectScene(e.target.value)}
            style={{
              backgroundColor: '#1f2430',
              color: '#f8fafc',
              border: '1px solid #333a4d',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '13px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {scenes.map((s) => (
              <option key={s.scene} value={s.scene}>
                {s.scene} {s.cached ? '' : '(uncached)'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 2. Frame navigation: ◀ ▶ [====|=====] index/total */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flex: '1',
          maxWidth: '520px',
        }}
      >
        <span style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>frame:</span>
        <button
          onClick={() => onFrameChange(Math.max(0, currentFrameIndex - 1))}
          disabled={currentFrameIndex <= 0}
          title="Previous frame (Arrow Left)"
          style={{
            backgroundColor: '#272c3d',
            color: currentFrameIndex <= 0 ? '#64748b' : '#f8fafc',
            border: '1px solid #3b4256',
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: '12px',
          }}
        >
          ◀
        </button>
        <button
          onClick={() => onFrameChange(Math.min(totalFrames - 1, currentFrameIndex + 1))}
          disabled={currentFrameIndex >= totalFrames - 1}
          title="Next frame (Arrow Right)"
          style={{
            backgroundColor: '#272c3d',
            color: currentFrameIndex >= totalFrames - 1 ? '#64748b' : '#f8fafc',
            border: '1px solid #3b4256',
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: '12px',
          }}
        >
          ▶
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={currentFrameIndex}
          onChange={(e) => onFrameChange(parseInt(e.target.value, 10))}
          style={{ flex: 1, margin: '0 4px' }}
        />
        <span
          style={{
            fontFamily: 'monospace',
            color: '#cbd5e1',
            whiteSpace: 'nowrap',
            fontSize: '12px',
          }}
        >
          [{currentFrameIndex + 1}/{totalFrames || 1}] {currentFrameId}
        </span>
      </div>

      {/* 3. Layer checkboxes */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ color: '#94a3b8' }}>layers:</span>
        {(['ground', 'color', 'raw', 'boxes', 'dense', 'splat'] as const).map((layer) => {
          const isDense = layer === 'dense';
          const isSplat = layer === 'splat';
          const disabled = (isDense && !isDenseAvailable) || (isSplat && !isSplatAvailable);
          const tooltip = disabled
            ? isSplat
              ? 'chưa có splat'
              : 'chưa có dữ liệu'
            : undefined;

          return (
            <label
              key={layer}
              title={tooltip}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                color: disabled ? '#475569' : layers[layer] ? '#f8fafc' : '#64748b',
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <input
                type="checkbox"
                data-testid={`layer-${layer}-checkbox`}
                checked={layers[layer] && !disabled}
                disabled={disabled}
                onChange={() => !disabled && onLayerToggle(layer)}
                style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
              />
              {layer}
            </label>
          );
        })}
      </div>

      {/* 4. Calibration status indicator */}
      <div
        onClick={onOpenCalibModal}
        title="Click to view camera calibration dt_ms"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: '4px',
          backgroundColor: '#1e222e',
          border: '1px solid #2e3547',
        }}
      >
        <span style={{ color: '#94a3b8' }}>calib:</span>
        <span style={{ color: calibColor, fontSize: '13px', fontWeight: 600 }}>
          ● {verdict}
        </span>
      </div>

      {/* 5. Perf Benchmark Button */}
      {onRunBenchmark && (
        <button
          onClick={onRunBenchmark}
          disabled={isBenchmarking}
          title="Run Performance Benchmark (P): 50 frame transitions and download perf-<timestamp>.json"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: isBenchmarking ? '#2563eb' : '#1e222e',
            color: '#f8fafc',
            border: isBenchmarking ? '1px solid #3b82f6' : '1px solid #2e3547',
            borderRadius: '4px',
            padding: '4px 10px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: isBenchmarking ? 'wait' : 'pointer',
          }}
        >
          <span>
            ⚡ Benchmark{' '}
            {isBenchmarking && benchmarkProgress
              ? `(${benchmarkProgress.current}/${benchmarkProgress.total})`
              : '(P)'}
          </span>
        </button>
      )}
    </header>
  );
};
