import React from 'react';
import { CalibReport, SceneSummary } from '../api/types';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';

export interface LayerState {
  ground: boolean;
  color: boolean;
  raw: boolean;
  boxes: boolean;
  dense: boolean;
  splat: boolean;
}

interface SidebarProps {
  scenes: SceneSummary[];
  currentScene: string;
  onSelectScene: (scene: string) => void;
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

export const Sidebar: React.FC<SidebarProps> = ({
  scenes,
  currentScene,
  onSelectScene,
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
  const calibColorClass =
    verdict === 'ok' ? 'text-green-500' : verdict === 'warning' ? 'text-yellow-500' : 'text-red-500';

  return (
    <aside className="w-64 md:w-72 flex-shrink-0 border-r border-border bg-card flex flex-col h-full overflow-hidden">
      {/* Branding */}
      <div className="p-4 border-b border-border flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
          T
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-semibold text-sm">ReCast</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">3D Annotator</span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 flex flex-col gap-6">
          
          {/* Scene Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Dataset Scene</label>
            <select
              value={currentScene}
              onChange={(e) => onSelectScene(e.target.value)}
              className="w-full bg-muted text-foreground border-transparent rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            >
              {scenes.map((s) => (
                <option key={s.scene} value={s.scene}>
                  {s.scene} {s.cached ? '' : '(uncached)'}
                </option>
              ))}
            </select>
          </div>

          {/* Calibration */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Camera Calibration</label>
            <div
              onClick={onOpenCalibModal}
              title="Click to view camera calibration dt_ms"
              className="flex items-center justify-between bg-muted px-3 py-2 rounded-md cursor-pointer hover:bg-muted/80 transition-colors border border-transparent hover:border-border"
            >
              <span className="text-sm font-medium">Status</span>
              <span className={`text-sm font-bold flex items-center gap-1.5 ${calibColorClass}`}>
                <div className={`w-2 h-2 rounded-full ${verdict === 'ok' ? 'bg-green-500' : verdict === 'warning' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                {verdict}
              </span>
            </div>
          </div>

          {/* Layers */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Display Layers</label>
            <div className="flex flex-col gap-1 border border-border rounded-md overflow-hidden bg-muted/30">
              {(['ground', 'color', 'raw', 'boxes', 'dense', 'splat'] as const).map((layer) => {
                const isDense = layer === 'dense';
                const isSplat = layer === 'splat';
                const disabled = (isDense && !isDenseAvailable) || (isSplat && !isSplatAvailable);
                const tooltip = disabled
                  ? isSplat
                    ? 'Chưa có splat'
                    : 'Chưa có dữ liệu dense'
                  : undefined;

                return (
                  <label
                    key={layer}
                    title={tooltip}
                    className={`flex items-center gap-3 px-3 py-2.5 text-sm transition-colors border-b border-border/50 last:border-0 ${
                      disabled ? 'opacity-50 cursor-not-allowed bg-muted/50' : 'cursor-pointer hover:bg-muted'
                    }`}
                  >
                    <input
                      type="checkbox"
                      data-testid={`layer-${layer}-checkbox`}
                      checked={layers[layer] && !disabled}
                      disabled={disabled}
                      onChange={() => !disabled && onLayerToggle(layer)}
                      className="accent-primary w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <span className={layers[layer] && !disabled ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                      {layer.charAt(0).toUpperCase() + layer.slice(1)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Perf Benchmark */}
          {onRunBenchmark && (
            <div className="space-y-2 mt-2 pt-4 border-t border-border">
               <label className="text-xs font-semibold text-muted-foreground uppercase">Performance</label>
               <Button
                 variant={isBenchmarking ? "default" : "secondary"}
                 className="w-full justify-start gap-2"
                 onClick={onRunBenchmark}
                 disabled={isBenchmarking}
               >
                 <span>⚡</span>
                 {isBenchmarking ? (
                   <span>
                     Benchmarking... {benchmarkProgress ? `(${benchmarkProgress.current}/${benchmarkProgress.total})` : ''}
                   </span>
                 ) : (
                   <span>Run Benchmark (P)</span>
                 )}
               </Button>
            </div>
          )}
          
        </div>
      </ScrollArea>
    </aside>
  );
};
