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
