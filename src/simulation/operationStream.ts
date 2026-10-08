/**
 * Operation stream - handles the flow of operations from algorithm to renderer
 */

import type { SortOperation, SortConfig } from '../types';
import type { AlgorithmStepResult } from '../algorithms';
import { createAlgorithm } from '../algorithms';

export interface OperationBatch {
  operations: SortOperation[];
  array: number[];
  isComplete: boolean;
  statistics: {
    comparisons: number;
    swaps: number;
    arrayAccesses: number;
    operations: number;
    elapsedTime: number;
    progress: number;
  };
}

export type AlgorithmGenerator = Generator<AlgorithmStepResult, void, unknown>;

export class OperationStream {
  private generator: AlgorithmGenerator | null = null;
  /**
   * The running algorithm instance; its own counters are the source of
   * truth for comparisons / swaps / array accesses / operations.
   */
  private algorithm: { getStatistics(): { comparisons: number; swaps: number; arrayAccesses: number; operations: number; progress: number } } | null = null;
  private config: SortConfig;
  private isRunning = false;
  private isPaused = false;
  private currentArray: number[] = [];
  private totalStats = {
    comparisons: 0,
    swaps: 0,
    arrayAccesses: 0,
    operations: 0,
    elapsedTime: 0,
    progress: 0,
  };
  private startTime = 0;
  private pauseTime = 0;
  private totalPausedDuration = 0;
  private chainId = 0;
  private demandCallback: (() => number) | null = null;
  private waitingForDemand = false;
  private readonly highWaterMark = 50000;
  private readonly lowWaterMark = 20000;
  private onBatchCallback: ((batch: OperationBatch) => void) | null = null;
  private onCompleteCallback: ((finalArray: number[], finalStats: typeof this.totalStats) => void) | null = null;
  private onErrorCallback: ((error: Error) => void) | null = null;

  constructor(config: SortConfig) {
    this.config = config;
  }

  setConfig(config: SortConfig): void {
    this.config = config;
  }

  start(array: number[]): void {
    if (this.isRunning) return;

    this.currentArray = [...array];
    this.totalStats = {
      comparisons: 0,
      swaps: 0,
      arrayAccesses: 0,
      operations: 0,
      elapsedTime: 0,
      progress: 0,
    };
    this.startTime = performance.now();
    this.totalPausedDuration = 0;

    try {
      const algorithm = createAlgorithm(this.config.algorithm, this.config);
      this.algorithm = algorithm;
      this.generator = algorithm.sort(this.currentArray);
      this.isRunning = true;
      this.isPaused = false;
      this.waitingForDemand = false;
      this.chainId++;
      this.runStep(this.chainId);
    } catch (error) {
      this.onErrorCallback?.(error as Error);
      this.reset();
    }
  }

  /**
   * Advances the algorithm generator for a short time budget, collects the
   * emitted operations into one batch, then yields back to the event loop.
   * Batching per hop (instead of one setTimeout per operation) keeps
   * generation fast for large arrays while still not blocking the UI.
   */
  private runStep(chainId: number): void {
    if (chainId !== this.chainId) return; // stale chain (after pause/stop/restart)
    if (!this.isRunning || this.isPaused || !this.generator) return;

    // Backpressure: stop generating while the consumer's queue is overfull.
    // The consumer calls notifyDemand() once it has drained enough.
    if (this.isOverHighWater()) {
      this.waitingForDemand = true;
      return;
    }

    try {
      const budgetMs = 8;
      const hopStart = performance.now();
      const collected: SortOperation[] = [];
      let done = false;

      while (this.isRunning && !this.isPaused) {
        const result = this.generator.next();

        if (result.done) {
          done = true;
          break;
        }

        const stepResult = result.value;
        this.currentArray = stepResult.array;
        for (const op of stepResult.operations) collected.push(op);

        if (performance.now() - hopStart >= budgetMs) break;
      }

      if (!this.isRunning) return; // stopped while stepping

      // Take the authoritative counters straight from the algorithm so the
      // displayed statistics (including real array accesses) are genuine.
      let algorithmProgress: number | null = null;
      if (this.algorithm) {
        const s = this.algorithm.getStatistics();
        this.totalStats.comparisons = s.comparisons;
        this.totalStats.swaps = s.swaps;
        this.totalStats.arrayAccesses = s.arrayAccesses;
        this.totalStats.operations = s.operations;
        algorithmProgress = s.progress;
      }

      this.totalStats.elapsedTime = performance.now() - this.startTime - this.totalPausedDuration;
      // The algorithm's own work estimate is the sort's real progress;
      // the stream-level estimate only stands in when no algorithm is bound.
      this.totalStats.progress = done ? 1 : (algorithmProgress ?? this.estimateProgress());

      if (done) {
        this.onBatchCallback?.({
          operations: collected,
          array: [...this.currentArray],
          isComplete: true,
          statistics: { ...this.totalStats },
        });
        this.onCompleteCallback?.([...this.currentArray], { ...this.totalStats });
        // Stop but keep currentArray/statistics so callers can inspect the result
        this.stop();
        return;
      }

      this.onBatchCallback?.({
        operations: collected,
        array: [...this.currentArray],
        isComplete: false,
        statistics: { ...this.totalStats },
      });

      // Yield to the event loop, then continue this chain
      setTimeout(() => this.runStep(chainId), 0);
    } catch (error) {
      this.onErrorCallback?.(error as Error);
      this.reset();
    }
  }

  private estimateProgress(): number {
    // This is a rough estimate, actual progress comes from algorithm
    const n = this.currentArray.length;
    const expectedOps = n * Math.log2(n) * 2;
    return Math.min(0.99, this.totalStats.operations / expectedOps);
  }

  pause(): void {
    if (this.isRunning && !this.isPaused) {
      this.isPaused = true;
      this.pauseTime = performance.now();
      this.chainId++; // invalidate any pending scheduled step
    }
  }

  resume(): void {
    if (this.isRunning && this.isPaused) {
      this.isPaused = false;
      this.totalPausedDuration += performance.now() - this.pauseTime;
      this.chainId++;
      this.runStep(this.chainId);
    }
  }

  stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.generator = null;
    this.algorithm = null;
    this.waitingForDemand = false;
    this.chainId++; // invalidate any pending scheduled step
  }

  /**
   * Provides the consumer's backlog size so generation can be throttled
   * when the renderer is not keeping up (prevents unbounded memory growth).
   */
  setDemandCallback(fn: (() => number) | null): void {
    this.demandCallback = fn;
  }

  /**
   * Called by the consumer after draining its queue. Resumes generation
   * if it was paused by backpressure.
   */
  notifyDemand(): void {
    if (this.waitingForDemand && this.isRunning && !this.isPaused && this.isUnderLowWater()) {
      this.waitingForDemand = false;
      this.runStep(this.chainId);
    }
  }

  private isOverHighWater(): boolean {
    return this.demandCallback !== null && this.demandCallback() >= this.highWaterMark;
  }

  private isUnderLowWater(): boolean {
    return this.demandCallback === null || this.demandCallback() <= this.lowWaterMark;
  }

  reset(): void {
    this.stop();
    this.currentArray = [];
    this.totalStats = {
      comparisons: 0,
      swaps: 0,
      arrayAccesses: 0,
      operations: 0,
      elapsedTime: 0,
      progress: 0,
    };
  }

  onBatch(callback: (batch: OperationBatch) => void): void {
    this.onBatchCallback = callback;
  }

  onComplete(callback: (finalArray: number[], finalStats: typeof this.totalStats) => void): void {
    this.onCompleteCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }

  getCurrentArray(): number[] {
    return [...this.currentArray];
  }

  getStatistics() {
    return { ...this.totalStats };
  }

  isActive(): boolean {
    return this.isRunning;
  }

  isPausedState(): boolean {
    return this.isPaused;
  }
}