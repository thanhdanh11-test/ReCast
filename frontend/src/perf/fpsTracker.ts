export class FpsTracker {
  private frameTimestamps: number[] = [];
  private fpsSamples: number[] = [];
  private lastTime: number = typeof performance !== 'undefined' ? performance.now() : 0;

  recordFrame(now: number = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
    if (this.lastTime > 0) {
      const delta = now - this.lastTime;
      if (delta > 0) {
        const instantFps = 1000 / delta;
        // Filter out unreasonable timer resolution spikes (> 240 fps)
        if (instantFps <= 240) {
          this.fpsSamples.push(instantFps);
        }
      }
    }
    this.lastTime = now;

    this.frameTimestamps.push(now);
    // Keep last 2 seconds for rolling FPS display
    const cutoff = now - 2000;
    while (this.frameTimestamps.length > 0 && this.frameTimestamps[0] < cutoff) {
      this.frameTimestamps.shift();
    }
  }

  getCurrentFps(): number {
    if (this.frameTimestamps.length < 2) return 60;
    const duration = this.frameTimestamps[this.frameTimestamps.length - 1] - this.frameTimestamps[0];
    if (duration <= 0) return 60;
    return Number(((this.frameTimestamps.length - 1) / (duration / 1000)).toFixed(1));
  }

  getAverageFps(): number {
    if (this.fpsSamples.length === 0) return 60;
    const sum = this.fpsSamples.reduce((acc, v) => acc + v, 0);
    return Number((sum / this.fpsSamples.length).toFixed(1));
  }

  getMinFps(): number {
    if (this.fpsSamples.length === 0) return 60;
    // Skip first 3 warmup frames if available
    const samples = this.fpsSamples.length > 3 ? this.fpsSamples.slice(3) : this.fpsSamples;
    return Number(Math.min(...samples).toFixed(1));
  }

  reset(): void {
    this.frameTimestamps = [];
    this.fpsSamples = [];
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
  }
}

export const globalFpsTracker = new FpsTracker();
