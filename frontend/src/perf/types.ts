export interface PerfReport {
  timestamp: string;
  userAgent: string;
  totalTransitions: number;
  samples: number[]; // Transition latency in ms per frame switch
  p50: number; // 50th percentile (ms)
  p90: number; // 90th percentile (ms)
  fpsAverage: number; // Average 3D FPS during benchmark
  fpsMin: number; // Minimum 3D FPS recorded
}
