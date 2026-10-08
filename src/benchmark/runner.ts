/**
 * Benchmark engine — runs the REAL algorithms headless (no rendering)
 * and measures pure algorithm execution time separately from any UI work.
 *
 * Fairness rules enforced here:
 *  - one source array per benchmark; every (algorithm, run) receives its
 *    own clone of that exact source — algorithms never see different data;
 *  - algorithms execute sequentially so CPU time is never contended;
 *  - time is accumulated only around actual processing (event-loop gaps
 *    between chunks are excluded from the measurement);
 *  - every finished run is verified with isSorted (+ length and sum
 *    checks); an unsorted result marks the run failed and keeps it out
 *    of rankings.
 */

import type { AlgorithmId, DataDistribution } from '../types';
import type {
  AlgorithmRunResult,
  BenchmarkConfig,
  BenchmarkControl,
  BenchmarkProgress,
  BenchmarkResult,
  ScalingConfig,
  ScalingPoint,
  ScalingResult,
} from './types';
import { createAlgorithm } from '../algorithms';
import { generateArray } from '../simulation';

/** CPU budget per chunk before yielding to the event loop. */
export const CHUNK_BUDGET_MS = 12;

/** Minimal config for headless runs — algorithms do not use the rest. */
const HEADLESS_CONFIG = {
  algorithm: 'quick' as AlgorithmId,
  elementCount: 0,
  visualizationMode: 'cubes' as const,
  speed: 1,
  dataDistribution: 'random' as DataDistribution,
  soundEnabled: false,
};

export interface CorrectnessReport {
  ok: boolean;
  reason?: string;
}

/**
 * Correctness gate: sorted + same length + same value sum as the source.
 * The sum check catches "sorted but wrong data" regressions cheaply.
 */
export function checkCorrectness(source: number[], result: number[]): CorrectnessReport {
  if (result.length !== source.length) {
    return { ok: false, reason: `length mismatch: ${result.length} !== ${source.length}` };
  }
  let sum = 0;
  for (let i = 1; i < result.length; i++) {
    if (result[i - 1] > result[i]) {
      return { ok: false, reason: `not sorted at index ${i}` };
    }
  }
  for (let i = 0; i < result.length; i++) sum += result[i];
  let sourceSum = 0;
  for (let i = 0; i < source.length; i++) sourceSum += source[i];
  if (sum !== sourceSum) {
    return { ok: false, reason: `value sum mismatch: ${sum} !== ${sourceSum}` };
  }
  return { ok: true };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Run one algorithm once on `source` (the caller supplies a clone so the
 * fairness contract is visible and testable at the call site).
 */
export async function runAlgorithmOnce(
  algorithmId: AlgorithmId,
  source: number[],
  options: {
    control?: BenchmarkControl;
    runIndex?: number;
    onChunk?: (innerProgress: number) => void;
  } = {}
): Promise<AlgorithmRunResult> {
  const { control, runIndex = 0 } = options;
  const base: AlgorithmRunResult = {
    algorithmId,
    runIndex,
    ok: false,
    algorithmMs: 0,
    comparisons: 0,
    swaps: 0,
    operations: 0,
    arrayAccesses: 0,
  };

  if (control?.cancelled) {
    return { ...base, cancelled: true, error: 'cancelled before start' };
  }

  let algorithm;
  try {
    algorithm = createAlgorithm(algorithmId, HEADLESS_CONFIG);
  } catch (e) {
    return { ...base, error: `cannot create algorithm: ${errorText(e)}` };
  }
  algorithm.setHeadless(true);

  let cpuMs = 0;
  try {
    const generator = algorithm.sort([...source]);
    while (true) {
      if (control?.cancelled) {
        return { ...base, cancelled: true, error: 'cancelled', algorithmMs: cpuMs };
      }
      const chunkStart = performance.now();
      let done = false;
      do {
        const step = generator.next();
        done = step.done === true;
      } while (!done && performance.now() - chunkStart < CHUNK_BUDGET_MS);
      cpuMs += performance.now() - chunkStart;

      if (done) break;

      // Let the UI breathe; this gap is NOT counted as algorithm time.
      options.onChunk?.(algorithm.getStatistics().progress);
      await yieldToEventLoop();
    }
  } catch (e) {
    const stats = safeStats(algorithm);
    return {
      ...base,
      error: `execution error: ${errorText(e)}`,
      algorithmMs: cpuMs,
      ...stats,
    };
  }

  if (control?.cancelled) {
    return { ...base, cancelled: true, error: 'cancelled', algorithmMs: cpuMs };
  }

  const stats = algorithm.getStatistics();
  const finalArray = algorithm.getFinalArray();
  const correctness = checkCorrectness(source, finalArray);

  return {
    ...base,
    ok: correctness.ok,
    error: correctness.ok ? undefined : correctness.reason,
    algorithmMs: cpuMs,
    comparisons: stats.comparisons,
    swaps: stats.swaps,
    operations: stats.operations,
    arrayAccesses: stats.arrayAccesses,
  };
}

function safeStats(algorithm: { getStatistics(): { comparisons: number; swaps: number; operations: number; arrayAccesses: number } }) {
  try {
    const s = algorithm.getStatistics();
    return {
      comparisons: s.comparisons,
      swaps: s.swaps,
      operations: s.operations,
      arrayAccesses: s.arrayAccesses,
    };
  } catch {
    return { comparisons: 0, swaps: 0, operations: 0, arrayAccesses: 0 };
  }
}

/** FNV-style fingerprint used to prove identical input across runs. */
export function arrayFingerprint(array: number[]): number {
  let hash = 2166136261;
  for (let i = 0; i < array.length; i++) {
    hash ^= array[i] & 0xffff;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

let benchmarkSeq = 0;

/**
 * Full benchmark: sequential, fair, cancellable. Progress is reported at
 * chunk granularity (the UI throttles how often it repaints).
 */
export async function runBenchmark(
  config: BenchmarkConfig,
  sourceArray: number[],
  control: BenchmarkControl,
  onProgress?: (progress: BenchmarkProgress) => void
): Promise<BenchmarkResult> {
  const total = config.algorithmIds.length * config.runs;
  const runs: AlgorithmRunResult[] = [];
  let completed = 0;
  let cancelled = false;

  outer: for (let runIndex = 0; runIndex < config.runs; runIndex++) {
    for (const algorithmId of config.algorithmIds) {
      if (control.cancelled) {
        cancelled = true;
        break outer;
      }
      // Fair comparison: an identical fresh clone of the same source.
      const clone = sourceArray.slice();
      const result = await runAlgorithmOnce(algorithmId, clone, {
        control,
        runIndex,
        onChunk: (innerProgress) => {
          onProgress?.({
            phase: 'run',
            completed,
            total,
            currentAlgorithmId: algorithmId,
            currentRunIndex: runIndex,
            innerProgress,
          });
        },
      });
      if (result.cancelled) {
        cancelled = true;
        break outer;
      }
      runs.push(result);
      completed++;
      onProgress?.({
        phase: 'run',
        completed,
        total,
        currentAlgorithmId: algorithmId,
        currentRunIndex: runIndex,
        innerProgress: 1,
      });
    }
  }

  return {
    id: `bench-${Date.now()}-${benchmarkSeq++}`,
    createdAt: Date.now(),
    config: { ...config, algorithmIds: [...config.algorithmIds] },
    sourceFingerprint: arrayFingerprint(sourceArray),
    sourceLength: sourceArray.length,
    runs,
    cancelled,
  };
}

/**
 * Scaling test: for every size, one source array is generated and every
 * selected algorithm runs once on its own clone of that exact array.
 */
export async function runScaling(
  config: ScalingConfig,
  control: BenchmarkControl,
  onProgress?: (progress: BenchmarkProgress) => void
): Promise<ScalingResult> {
  const sizes = [...config.sizes].sort((a, b) => a - b);
  const total = sizes.length * config.algorithmIds.length;
  const points: ScalingPoint[] = [];
  let completed = 0;
  let cancelled = false;

  outer: for (const size of sizes) {
    const source = generateArray(size, config.dataset);
    for (const algorithmId of config.algorithmIds) {
      if (control.cancelled) {
        cancelled = true;
        break outer;
      }
      const clone = source.slice();
      const result = await runAlgorithmOnce(algorithmId, clone, {
        control,
        runIndex: 0,
        onChunk: (innerProgress) => {
          onProgress?.({
            phase: 'scaling',
            completed,
            total,
            currentAlgorithmId: algorithmId,
            currentRunIndex: size,
            innerProgress,
          });
        },
      });
      if (result.cancelled) {
        cancelled = true;
        break outer;
      }
      points.push({
        algorithmId,
        size,
        ok: result.ok,
        error: result.error,
        algorithmMs: result.algorithmMs,
        comparisons: result.comparisons,
        swaps: result.swaps,
        operations: result.operations,
        arrayAccesses: result.arrayAccesses,
      });
      completed++;
      onProgress?.({
        phase: 'scaling',
        completed,
        total,
        currentAlgorithmId: algorithmId,
        currentRunIndex: size,
        innerProgress: 1,
      });
    }
  }

  return {
    id: `scale-${Date.now()}-${benchmarkSeq++}`,
    createdAt: Date.now(),
    config: {
      algorithmIds: [...config.algorithmIds],
      dataset: config.dataset,
      sizes,
    },
    points,
    cancelled,
  };
}
