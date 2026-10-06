import { describe, it, expect, vi } from 'vitest';
import { runAutomatedBenchmark } from './benchmark';

describe('perf/benchmark', () => {
  it('runs 50 transitions and produces a valid PerfReport', async () => {
    let callCount = 0;
    const progressList: number[] = [];

    const mockSwitchFrame = vi.fn(async (targetIndex: number) => {
      callCount++;
      // Return synthetic durations: mostly 40ms, occasional 80ms
      return targetIndex % 5 === 0 ? 80 : 40;
    });

    const { report, filename } = await runAutomatedBenchmark(
      mockSwitchFrame,
      10, // 10 total frames in scene
      50, // 50 transitions
      (current, total) => {
        expect(total).toBe(50);
        progressList.push(current);
      }
    );

    expect(callCount).toBe(50);
    expect(progressList.length).toBe(50);
    expect(report.totalTransitions).toBe(50);
    expect(report.samples.length).toBe(50);
    expect(report.p50).toBe(40);
    expect(report.p90).toBe(80);
    expect(typeof report.fpsAverage).toBe('number');
    expect(typeof report.fpsMin).toBe('number');
    expect(typeof report.userAgent).toBe('string');
    expect(filename).toMatch(/^perf-\d+\.json$/);
  });
});
