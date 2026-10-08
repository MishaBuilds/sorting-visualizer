/**
 * Benchmark Lab type definitions.
 *
 * Every number produced here comes from a real algorithm execution —
 * there are no estimated, cached or theoretical result values anywhere
 * in this layer.
 */

import type { AlgorithmId, DataDistribution } from '../types';

export type BenchmarkMetric = 'algorithmMs' | 'comparisons' | 'swaps' | 'operations';

export interface BenchmarkConfig {
  algorithmIds: AlgorithmId[];
  dataset: DataDistribution;
  size: number;
  runs: number;
}

/** One real execution of one algorithm on one cloned copy of the source. */
export interface AlgorithmRunResult {
  algorithmId: AlgorithmId;
  runIndex: number;
  /** true only when the algorithm finished AND produced a sorted array. */
  ok: boolean;
  cancelled?: boolean;
  /** Human-readable failure reason (correctness or thrown error). */
  error?: string;
  /** Pure algorithm execution time in ms — excludes rendering and UI. */
  algorithmMs: number;
  comparisons: number;
  swaps: number;
  operations: number;
  arrayAccesses: number;
}

export interface MetricAggregate {
  average: number;
  min: number;
  max: number;
  median: number;
  samples: number;
}

/** Aggregated view of all *successful* runs of one algorithm. */
export interface AlgorithmAggregate {
  algorithmId: AlgorithmId;
  totalRuns: number;
  failedRuns: AlgorithmRunResult[];
  /** null when every run failed — such algorithms never enter rankings. */
  metrics: {
    algorithmMs: MetricAggregate;
    comparisons: MetricAggregate;
    swaps: MetricAggregate;
    operations: MetricAggregate;
    arrayAccesses: MetricAggregate;
  } | null;
}

export interface BenchmarkResult {
  id: string;
  createdAt: number;
  config: BenchmarkConfig;
  /** Sum of the source array — proves every run cloned identical input. */
  sourceFingerprint: number;
  sourceLength: number;
  runs: AlgorithmRunResult[];
  cancelled: boolean;
}

export interface RankedEntry {
  algorithmId: AlgorithmId;
  value: number;
}

export interface BenchmarkRankings {
  fastest: RankedEntry[];
  fewestComparisons: RankedEntry[];
  fewestOperations: RankedEntry[];
  fewestSwaps: RankedEntry[];
}

export type RankingKey = keyof BenchmarkRankings;

/** Scaling test: one real measurement per (algorithm, size) pair. */
export interface ScalingPoint {
  algorithmId: AlgorithmId;
  size: number;
  ok: boolean;
  cancelled?: boolean;
  error?: string;
  algorithmMs: number;
  comparisons: number;
  swaps: number;
  operations: number;
  arrayAccesses: number;
}

export interface ScalingConfig {
  algorithmIds: AlgorithmId[];
  dataset: DataDistribution;
  sizes: number[];
}

export interface ScalingResult {
  id: string;
  createdAt: number;
  config: ScalingConfig;
  points: ScalingPoint[];
  cancelled: boolean;
}

/** Session history entry (stored locally — no backend). */
export interface BenchmarkHistoryEntry {
  id: string;
  timestamp: number;
  mode: 'benchmark' | 'scaling';
  algorithmIds: AlgorithmId[];
  dataset: DataDistribution;
  sizes: number[];
  runs: number;
  /** Best (fastest) successful algorithm of that session, if any. */
  bestAlgorithmId: AlgorithmId | null;
  bestTimeMs: number | null;
  failedCount: number;
}

/** Cooperative cancellation shared between UI and the runner. */
export interface BenchmarkControl {
  cancelled: boolean;
}

export interface BenchmarkProgress {
  phase: 'run' | 'scaling';
  completed: number;
  total: number;
  currentAlgorithmId: AlgorithmId | null;
  currentRunIndex: number;
  /** The algorithm's own progress estimate inside the current run (0..1). */
  innerProgress: number;
}
