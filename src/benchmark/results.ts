/**
 * Result shaping helpers — turn raw benchmark data into the series and
 * rows the charts and tables render. Pure functions (unit-tested).
 */

import type { AlgorithmId } from '../types';
import type {
  AlgorithmAggregate,
  BenchmarkMetric,
  BenchmarkRankings,
  BenchmarkResult,
  ScalingResult,
} from './types';
import { aggregateBenchmark } from './statistics';
import { computeRankings } from './ranking';

export interface ChartSeries {
  algorithmId: AlgorithmId;
  label: string;
  /** One point per run (benchmark) or per size (scaling). */
  points: { x: number; y: number }[];
}

export const METRIC_LABELS: Record<BenchmarkMetric, string> = {
  algorithmMs: 'TIME',
  comparisons: 'COMPARISONS',
  swaps: 'SWAPS',
  operations: 'OPERATIONS',
};

export interface BenchmarkView {
  aggregates: AlgorithmAggregate[];
  rankings: BenchmarkRankings;
}

/** Cached-shaped view of a result (aggregates + rankings computed once). */
export function buildBenchmarkView(result: BenchmarkResult): BenchmarkView {
  const aggregates = aggregateBenchmark(result);
  return { aggregates, rankings: computeRankings(aggregates) };
}

/**
 * Series for the runs chart: x = run index (1-based), y = metric.
 * Failed runs break the line (no fabricated point).
 */
export function runsChartSeries(
  result: BenchmarkResult,
  metric: BenchmarkMetric
): ChartSeries[] {
  return result.config.algorithmIds.map((algorithmId) => {
    const runs = result.runs
      .filter((r) => r.algorithmId === algorithmId && r.ok)
      .sort((a, b) => a.runIndex - b.runIndex);
    return {
      algorithmId,
      label: algorithmId,
      points: runs.map((r) => ({ x: r.runIndex + 1, y: r[metric] })),
    };
  });
}

/**
 * Series for the scaling chart: x = array size (log10 spaced by the
 * caller), y = metric. Failed points are omitted from the line but the
 * table still shows them.
 */
export function scalingChartSeries(
  result: ScalingResult,
  metric: BenchmarkMetric
): ChartSeries[] {
  return result.config.algorithmIds.map((algorithmId) => {
    const points = result.points
      .filter((p) => p.algorithmId === algorithmId && p.ok)
      .sort((a, b) => a.size - b.size)
      .map((p) => ({ x: p.size, y: p[metric] }));
    return { algorithmId, label: algorithmId, points };
  });
}
