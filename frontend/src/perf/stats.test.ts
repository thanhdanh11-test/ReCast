import { describe, it, expect } from 'vitest';
import {
  calculatePercentile,
  computeP50,
  computeP90,
  computeAverage,
  computeMin,
} from './stats';

describe('perf/stats', () => {
  describe('computeP50 (median)', () => {
    it('returns 0 for empty array', () => {
      expect(computeP50([])).toBe(0);
    });

    it('returns the sole element for single item array', () => {
      expect(computeP50([42.5])).toBe(42.5);
    });

    it('computes exact median for odd number of sorted elements', () => {
      // 10, 20, 30, 40, 50 -> median = 30
      expect(computeP50([10, 20, 30, 40, 50])).toBe(30);
      // unsorted
      expect(computeP50([50, 10, 40, 20, 30])).toBe(30);
    });

    it('computes interpolated median for even number of elements', () => {
      // 10, 20, 30, 40 -> rank = 0.5 * 3 = 1.5 -> (20 + 30) / 2 = 25
      expect(computeP50([10, 20, 30, 40])).toBe(25);
    });
  });

  describe('computeP90', () => {
    it('returns 0 for empty array', () => {
      expect(computeP90([])).toBe(0);
    });

    it('returns the sole element for single item array', () => {
      expect(computeP90([100])).toBe(100);
    });

    it('computes accurate p90 for 10 elements', () => {
      // Array 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
      // rank = 0.9 * (10 - 1) = 8.1
      // sorted[8] = 90, sorted[9] = 100
      // 90 * 0.9 + 100 * 0.1 = 91
      const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      expect(computeP90(arr)).toBe(91);
    });

    it('computes accurate p90 on 50 samples benchmark distribution', () => {
      // 50 samples all 100ms except 5 samples at 200ms
      const samples = Array(45).fill(100).concat(Array(5).fill(200));
      // rank = 0.9 * 49 = 44.1
      // sorted index 44 is 100, index 45 is 200
      // weight = 0.1 -> 100 * 0.9 + 200 * 0.1 = 110
      expect(computeP90(samples)).toBe(110);
    });
  });

  describe('calculatePercentile edge cases', () => {
    it('clamps percentiles outside 0..100', () => {
      const arr = [10, 20, 30];
      expect(calculatePercentile(arr, -10)).toBe(10);
      expect(calculatePercentile(arr, 150)).toBe(30);
    });

    it('does not mutate original array', () => {
      const original = [30, 10, 20];
      computeP50(original);
      expect(original).toEqual([30, 10, 20]);
    });
  });

  describe('computeAverage and computeMin', () => {
    it('computes correct mean', () => {
      expect(computeAverage([])).toBe(0);
      expect(computeAverage([10, 20, 30])).toBe(20);
      expect(computeAverage([10, 15, 20])).toBe(15);
    });

    it('computes correct min', () => {
      expect(computeMin([])).toBe(0);
      expect(computeMin([45, 12, 88, 3])).toBe(3);
    });
  });
});
