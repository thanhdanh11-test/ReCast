/**
 * Compute the p-th percentile of an array of numbers using linear interpolation.
 * Matches standard statistical percentile calculation (e.g. numpy / Python standard).
 *
 * @param samples Array of numbers (e.g. frame transition latency in milliseconds)
 * @param percentile Number between 0 and 100 (e.g. 50 for median, 90 for p90)
 */
export function calculatePercentile(samples: number[], percentile: number): number {
  if (!samples || samples.length === 0) return 0;
  if (samples.length === 1) return Number(samples[0].toFixed(2));

  // Sort ascending without mutating original array
  const sorted = [...samples].sort((a, b) => a - b);
  const clampedPercentile = Math.max(0, Math.min(100, percentile));
  const rank = (clampedPercentile / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;

  const result = sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
  return Number(result.toFixed(2));
}

/**
 * Compute the 50th percentile (median) of samples.
 */
export function computeP50(samples: number[]): number {
  return calculatePercentile(samples, 50);
}

/**
 * Compute the 90th percentile of samples.
 */
export function computeP90(samples: number[]): number {
  return calculatePercentile(samples, 90);
}

/**
 * Compute the arithmetic mean of an array of numbers.
 */
export function computeAverage(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Number((sum / values.length).toFixed(2));
}

/**
 * Compute the minimum value in an array of numbers.
 */
export function computeMin(values: number[]): number {
  if (!values || values.length === 0) return 0;
  return Number(Math.min(...values).toFixed(2));
}
