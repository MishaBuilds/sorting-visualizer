/**
 * Benchmark statistics — pure, testable aggregation over REAL runs.
 *
 * Rules:
 *  - each run keeps its own counters (runs are never merged in place);
 *  - only successful runs feed the aggregates;
 *  - failed runs are surfaced separately, never silently dropped;
 *  - median averages the two middle values for even sample counts.
 */

import type { AlgorithmId } from '../types';
import type {
  AlgorithmAggregate,
  AlgorithmRunResult,
  BenchmarkResult,
  MetricAggregate,
} from './types';

export function summarize(values: number[]): MetricAggregate {
  if (values.length === 0) {
    return { average: 0, min: 0, max: 0, median: 0, samples: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  let sum = 0;
  for (const v of sorted) sum += v;
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { average: sum / sorted.length, min, max, median, samples: sorted.length };
}

export function aggregateRuns(runs: AlgorithmRunResult[]): {
  successful: AlgorithmRunResult[];
  failed: AlgorithmRunResult[];
} {
  const successful = runs.filter((r) => r.ok);
  const failed = runs.filter((r) => !r.ok);
  return { successful, failed };
}

export function aggregateAlgorithm(
  algorithmId: AlgorithmId,
  runs: AlgorithmRunResult[]
): AlgorithmAggregate {
  const { successful, failed } = aggregateRuns(runs);
  if (successful.length === 0) {
    return { algorithmId, totalRuns: runs.length, failedRuns: failed, metrics: null };
  }
  return {
    algorithmId,
    totalRuns: runs.length,
    failedRuns: failed,
    metrics: {
      algorithmMs: summarize(successful.map((r) => r.algorithmMs)),
      comparisons: summarize(successful.map((r) => r.comparisons)),
      swaps: summarize(successful.map((r) => r.swaps)),
      operations: summarize(successful.map((r) => r.operations)),
      arrayAccesses: summarize(successful.map((r) => r.arrayAccesses)),
    },
  };
}

/** Aggregate every algorithm of a benchmark result, preserving config order. */
export function aggregateBenchmark(result: BenchmarkResult): AlgorithmAggregate[] {
  return result.config.algorithmIds.map((id) =>
    aggregateAlgorithm(id, result.runs.filter((r) => r.algorithmId === id))
  );
}

/** Total failed runs across a whole benchmark (never hidden). */
export function countFailedRuns(result: BenchmarkResult): number {
  return result.runs.filter((r) => !r.ok).length;
}
