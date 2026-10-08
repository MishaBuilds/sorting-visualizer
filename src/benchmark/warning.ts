/**
 * Smart warnings for genuinely heavy benchmark combinations.
 *
 * The warning is a heuristic about wall-clock cost (O(n²) work at large
 * sizes), never a fake result estimate. Nothing is blocked — the user
 * decides with RUN ANYWAY / CANCEL.
 */

import type { AlgorithmId } from '../types';

export interface BenchmarkWarning {
  /** Algorithms that make the run heavy. */
  heavyAlgorithms: AlgorithmId[];
  size: number;
  runs: number;
  message: string;
}

export const WARNING_SIZE_THRESHOLD = 25000;
export const WARNING_BUBBLE_SIZE = 10000;

/**
 * Returns a warning for combinations that are likely to take a very long
 * time, null otherwise.
 */
export function benchmarkWarning(
  algorithmIds: AlgorithmId[],
  size: number,
  runs: number
): BenchmarkWarning | null {
  const heavy = algorithmIds.filter((id) => {
    if (id !== 'bubble') return false;
    return size >= WARNING_SIZE_THRESHOLD || (size >= WARNING_BUBBLE_SIZE && runs >= 5);
  });
  if (heavy.length === 0) return null;

  const names = heavy.map((id) => (id === 'bubble' ? 'Bubble Sort' : id));
  const runText = runs > 1 ? ` × ${runs} runs` : '';
  return {
    heavyAlgorithms: heavy,
    size,
    runs,
    message:
      `${names.join(', ')} · ${size.toLocaleString('en-US')} elements${runText}\n\n` +
      `This benchmark may take a very long time because Bubble Sort has ` +
      `O(n²) time complexity — cost grows quadratically with the array size.`,
  };
}

/** Scaling-test variant: warns when big sizes include a quadratic algorithm. */
export function scalingWarning(
  algorithmIds: AlgorithmId[],
  sizes: number[]
): BenchmarkWarning | null {
  const maxSize = sizes.length > 0 ? Math.max(...sizes) : 0;
  if (maxSize < WARNING_BUBBLE_SIZE) return null;
  return benchmarkWarning(algorithmIds, maxSize, 1);
}
