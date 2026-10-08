/**
 * Performance Mode: preset element counts, throughput and warnings.
 *
 * NORMAL      — 1 000 / 5 000 / 10 000  (every operation rendered)
 * PERFORMANCE — 25 000 / 50 000 / 100 000 (higher batch throughput;
 *               the algorithm still runs for real, the renderer simply
 *               consumes larger operation batches per frame).
 */

import type { AlgorithmId, PerformanceMode } from '../types';

export const NORMAL_COUNTS: readonly number[] = [1000, 5000, 10000];
export const PERFORMANCE_COUNTS: readonly number[] = [25000, 50000, 100000];

/** Counts above this threshold are only reachable in PERFORMANCE mode. */
export const PERFORMANCE_THRESHOLD = 10000;

export function countsForMode(mode: PerformanceMode): number[] {
  return mode === 'performance' ? [...PERFORMANCE_COUNTS] : [...NORMAL_COUNTS];
}

export function isPerformanceCount(count: number): boolean {
  return count > PERFORMANCE_THRESHOLD;
}

export function modeForCount(count: number): PerformanceMode {
  return isPerformanceCount(count) ? 'performance' : 'normal';
}

/**
 * The count the UI should switch to when the mode toggle changes,
 * keeping the current selection when it still belongs to the mode.
 */
export function defaultCountForMode(mode: PerformanceMode, currentCount: number): number {
  const counts = countsForMode(mode);
  if (counts.includes(currentCount)) return currentCount;
  if (mode === 'normal') return 10000;
  // Jump to the smallest performance preset so the switch stays predictable.
  return PERFORMANCE_COUNTS[0];
}

/**
 * Non-blocking warning: only where the run is genuinely infeasible in
 * practice. The user may still start it — nothing is blocked.
 */
export function longRunWarning(algorithm: AlgorithmId, count: number): string | null {
  if (algorithm === 'bubble' && count >= PERFORMANCE_COUNTS[0]) {
    return `Bubble Sort with ${count.toLocaleString('en-US')} elements may take a very long time. You can start it anyway — or pick a faster algorithm.`;
  }
  return null;
}

/**
 * Operations the scheduler may consume per rendered frame.
 * NORMAL keeps the proven V1 default (500); PERFORMANCE drains the real
 * stream faster so large arrays finish in a reasonable time while every
 * operation still passes through the pipeline.
 */
export function schedulerOpsPerFrame(mode: PerformanceMode): number {
  return mode === 'performance' ? 2000 : 500;
}
