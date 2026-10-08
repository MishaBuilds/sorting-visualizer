/**
 * Facts about the actual generated array — everything the DATASET card
 * shows is computed here from real values, never estimated.
 */

import type { DatasetStats } from '../types';

export function computeDatasetStats(array: number[]): DatasetStats {
  const count = array.length;
  if (count === 0) {
    return { count: 0, ascendingFraction: 1, uniqueCount: 0, min: 0, max: 0 };
  }

  let min = array[0];
  let max = array[0];
  const unique = new Set<number>();
  for (let i = 0; i < count; i++) {
    const v = array[i];
    if (v < min) min = v;
    if (v > max) max = v;
    unique.add(v);
  }

  if (count === 1) {
    return { count, ascendingFraction: 1, uniqueCount: unique.size, min, max };
  }

  // "Already ascending" = adjacent pairs that are already in order.
  let ascendingPairs = 0;
  for (let i = 1; i < count; i++) {
    if (array[i] >= array[i - 1]) ascendingPairs++;
  }

  return {
    count,
    ascendingFraction: ascendingPairs / (count - 1),
    uniqueCount: unique.size,
    min,
    max,
  };
}

export function formatAscendingPercent(stats: DatasetStats): string {
  return `${(stats.ascendingFraction * 100).toFixed(1)}% already ascending`;
}

/** Full dataset characteristics — every number computed from the array. */
export interface DatasetAnalysis {
  count: number;
  uniqueCount: number;
  min: number;
  max: number;
  /** Adjacent pairs already in ascending order (0..1). */
  ascendingFraction: number;
  /** Adjacent pairs in descending order (0..1). */
  descendingFraction: number;
  /** Adjacent pairs NOT in order = 1 - ascendingFraction (0..1). */
  disorderFraction: number;
  /** Exact number of inversions (counted with an O(n log n) merge pass). */
  inversions: number;
}

export function analyzeDataset(array: number[]): DatasetAnalysis {
  const count = array.length;
  if (count === 0) {
    return {
      count: 0,
      uniqueCount: 0,
      min: 0,
      max: 0,
      ascendingFraction: 1,
      descendingFraction: 1,
      disorderFraction: 0,
      inversions: 0,
    };
  }

  let min = array[0];
  let max = array[0];
  const unique = new Set<number>();
  let ascendingPairs = 0;
  let descendingPairs = 0;
  for (let i = 0; i < count; i++) {
    const v = array[i];
    if (v < min) min = v;
    if (v > max) max = v;
    unique.add(v);
    if (i > 0) {
      if (v >= array[i - 1]) ascendingPairs++;
      if (v <= array[i - 1]) descendingPairs++;
    }
  }

  const pairCount = Math.max(1, count - 1);
  const ascendingFraction = count === 1 ? 1 : ascendingPairs / pairCount;
  const descendingFraction = count === 1 ? 1 : descendingPairs / pairCount;

  return {
    count,
    uniqueCount: unique.size,
    min,
    max,
    ascendingFraction,
    descendingFraction,
    disorderFraction: 1 - ascendingFraction,
    inversions: countInversions(array),
  };
}

/**
 * Exact inversion count via merge sort — O(n log n), so even 100 000
 * elements are counted for real (no sampling, no estimation).
 */
export function countInversions(array: number[]): number {
  const n = array.length;
  if (n < 2) return 0;
  const work = array.slice();
  const buffer = new Array<number>(n);

  const sortAndCount = (lo: number, hi: number): number => {
    if (hi - lo < 2) return 0;
    const mid = (lo + hi) >> 1;
    let inversions = sortAndCount(lo, mid) + sortAndCount(mid, hi);
    let i = lo;
    let j = mid;
    let k = lo;
    while (i < mid && j < hi) {
      if (work[i] <= work[j]) {
        buffer[k++] = work[i++];
      } else {
        buffer[k++] = work[j++];
        inversions += mid - i; // all remaining left-run values exceed work[j]
      }
    }
    while (i < mid) buffer[k++] = work[i++];
    while (j < hi) buffer[k++] = work[j++];
    for (let t = lo; t < hi; t++) work[t] = buffer[t];
    return inversions;
  };

  return sortAndCount(0, n);
}
