import { PerfReport } from './types';
import { computeP50, computeP90 } from './stats';
import { globalFpsTracker } from './fpsTracker';

/**
 * Triggers browser download of the performance benchmark JSON file.
 * Returns the generated filename.
 */
export function downloadPerfReport(report: PerfReport): string {
  const json = JSON.stringify(report, null, 2);
  const timestamp = Date.now();
  const filename = `perf-${timestamp}.json`;

  if (typeof document !== 'undefined') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return filename;
}

/**
 * Run automated 50 frame transitions benchmark.
 *
 * @param switchFrame Callback to switch to a specific frame index and resolve when all views are rendered.
 * @param totalTransitions Number of transitions to benchmark (default: 50)
 * @param totalFrames Total frames in current scene (to wrap around indices)
 * @param onProgress Optional progress callback (step: number, total: number)
 */
export async function runAutomatedBenchmark(
  switchFrame: (targetIndex: number) => Promise<number>,
  totalFrames: number,
  totalTransitions = 50,
  onProgress?: (step: number, total: number) => void
): Promise<{ report: PerfReport; filename: string }> {
  globalFpsTracker.reset();
  const samples: number[] = [];

  let currentIndex = 0;

  for (let step = 1; step <= totalTransitions; step++) {
    // Alternate or advance through frames
    currentIndex = (currentIndex + 1) % Math.max(1, totalFrames);
    if (onProgress) {
      onProgress(step, totalTransitions);
    }

    const durationMs = await switchFrame(currentIndex);
    samples.push(durationMs);

    // Yield short macro-task tick to allow browser event loop and rendering
    await new Promise((resolve) => setTimeout(resolve, 16));
  }

  const p50 = computeP50(samples);
  const p90 = computeP90(samples);
  const fpsAverage = globalFpsTracker.getAverageFps();
  const fpsMin = globalFpsTracker.getMinFps();
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js/Test';

  const report: PerfReport = {
    timestamp: new Date().toISOString(),
    userAgent,
    totalTransitions,
    samples,
    p50,
    p90,
    fpsAverage,
    fpsMin,
  };

  const filename = downloadPerfReport(report);
  return { report, filename };
}
