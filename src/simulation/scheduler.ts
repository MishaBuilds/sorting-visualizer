/**
 * Animation scheduler - batches operations and synchronizes with requestAnimationFrame
 */

import type { SortOperation } from '../types';
import { OperationStream, OperationBatch } from './operationStream';

export interface SchedulerConfig {
  targetFPS: number;
  maxOperationsPerFrame: number;
  speedMultiplier: number;
}

export class AnimationScheduler {
  private stream: OperationStream;
  private config: SchedulerConfig;
  private pendingOperations: SortOperation[] = [];
  private currentArray: number[] = [];
  private finalArray: number[] | null = null;
  private isComplete = false; // generation finished (stream done)
  private completionFired = false;
  private consumedOps = 0;
  private statistics = {
    comparisons: 0,
    swaps: 0,
    arrayAccesses: 0,
    operations: 0,
    elapsedTime: 0,
    progress: 0,
  };
  private animationId: number | null = null;
  private lastFrameTime = 0;
  private paused = false;
  private defaultMaxOperationsPerFrame: number;
  private onUpdateCallback: ((ops: SortOperation[], array: number[], stats: typeof this.statistics, isComplete: boolean) => void) | null = null;
  private onCompleteCallback: ((finalArray: number[]) => void) | null = null;

  constructor(stream: OperationStream, config: Partial<SchedulerConfig> = {}) {
    this.stream = stream;
    this.config = {
      targetFPS: 60,
      maxOperationsPerFrame: 500,
      speedMultiplier: 1,
      ...config,
    };
    this.defaultMaxOperationsPerFrame = this.config.maxOperationsPerFrame;

    this.stream.onBatch((batch) => this.handleBatch(batch));
    this.stream.onComplete((finalArray) => this.handleComplete(finalArray));
    // Backpressure: stream generates based on how big our backlog is
    this.stream.setDemandCallback(() => this.pendingOperations.length);
  }

  setSpeed(multiplier: number): void {
    this.config.speedMultiplier = Math.max(0.1, Math.min(10, multiplier));
  }

  setMaxOperationsPerFrame(max: number): void {
    this.config.maxOperationsPerFrame = Math.max(1, max);
  }

  start(array: number[]): void {
    // Stop any previous loop/stream before starting fresh
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.stream.stop();

    this.pendingOperations = [];
    this.currentArray = [...array];
    this.finalArray = null;
    this.isComplete = false;
    this.completionFired = false;
    this.consumedOps = 0;
    this.paused = false;
    // Restore default throughput (it may have been raised on the final batch)
    this.config.maxOperationsPerFrame = this.defaultMaxOperationsPerFrame;
    this.statistics = {
      comparisons: 0,
      swaps: 0,
      arrayAccesses: 0,
      operations: 0,
      elapsedTime: 0,
      progress: 0,
    };
    this.lastFrameTime = performance.now();
    this.stream.start(array);
    this.scheduleFrame();
  }

  pause(): void {
    this.paused = true;
    this.stream.pause();
  }

  resume(): void {
    this.paused = false;
    this.stream.resume();
    if (!this.animationId) {
      this.lastFrameTime = performance.now();
      this.scheduleFrame();
    }
  }

  stop(): void {
    this.stream.stop();
    this.pendingOperations = [];
    this.finalArray = null;
    this.isComplete = false;
    this.completionFired = false;
    this.consumedOps = 0;
    this.paused = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private scheduleFrame(): void {
    this.animationId = requestAnimationFrame((time) => this.processFrame(time));
  }

  private processFrame(currentTime: number): void {
    // Nothing renders while paused; resume() restarts the loop.
    if (this.paused) {
      this.animationId = null;
      return;
    }

    const deltaTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    // Process operations based on speed multiplier
    const opsToProcess = Math.min(
      this.pendingOperations.length,
      Math.max(1, Math.floor(this.config.maxOperationsPerFrame * this.config.speedMultiplier * (deltaTime / 16.67)))
    );

    const batch = opsToProcess > 0 ? this.pendingOperations.splice(0, opsToProcess) : [];
    this.consumedOps += batch.length;

    // Completion = generation done AND every operation rendered
    const visComplete = this.isComplete && this.pendingOperations.length === 0;

    // Progress reflects the algorithm's own work estimate (how much of
    // the sort is actually done), not the pipeline catch-up ratio — that
    // reads ~100% whenever the renderer keeps pace with generation.
    // Capped until the viewer has seen every operation.
    const progress = visComplete ? 1 : Math.min(0.999, this.statistics.progress);

    this.onUpdateCallback?.(batch, [...this.currentArray], { ...this.statistics, progress }, visComplete);

    // Tell the stream it may generate more now that we drained some backlog
    this.stream.notifyDemand();

    if (visComplete) {
      // Fire completion exactly once, when the visualization has fully caught up
      if (!this.completionFired) {
        this.completionFired = true;
        this.onCompleteCallback?.(this.finalArray ?? [...this.currentArray]);
      }
      this.animationId = null;
      return;
    }

    if (this.stream.isActive() || this.pendingOperations.length > 0) {
      this.scheduleFrame();
    } else {
      this.animationId = null;
    }
  }

  private handleBatch(batch: OperationBatch): void {
    // Loop instead of spread-push: batches may exceed argument-count limits
    for (const op of batch.operations) this.pendingOperations.push(op);
    this.currentArray = batch.array;
    this.statistics = batch.statistics;
    if (batch.isComplete) this.isComplete = true;
  }

  private handleComplete(finalArray: number[]): void {
    this.currentArray = finalArray;
    this.finalArray = finalArray;
    this.isComplete = true;
    // onCompleteCallback fires from processFrame once the last operation
    // has actually been rendered, so the UI never jumps ahead of the view.
  }

  onUpdate(callback: (ops: SortOperation[], array: number[], stats: typeof this.statistics, isComplete: boolean) => void): void {
    this.onUpdateCallback = callback;
  }

  onComplete(callback: (finalArray: number[]) => void): void {
    this.onCompleteCallback = callback;
  }

  getCurrentArray(): number[] {
    return [...this.currentArray];
  }

  getStatistics() {
    return { ...this.statistics };
  }

  isRunning(): boolean {
    return this.stream.isActive() || this.pendingOperations.length > 0;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isCompleteState(): boolean {
    return this.isComplete;
  }
}