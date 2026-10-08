/**
 * Compare Controller — runs 2–4 REAL sorts (one OperationStream +
 * AnimationScheduler each) on identical copies of the same input array,
 * forwards every lane's real operations/stats to the UI, and derives the
 * verdicts from the completed runs.
 */

import { OperationStream } from './operationStream';
import { AnimationScheduler } from './scheduler';
import { prepareSharedArray, computeVerdicts } from '../utils/compare';
import { modeForCount, schedulerOpsPerFrame } from '../utils/perfMode';
import type {
  AlgorithmId,
  CompareResult,
  CompareVerdicts,
  SortConfig,
  SortOperation,
  SortStatistics,
} from '../types';

export interface CompareCallbacks {
  onLaneUpdate: (id: AlgorithmId, operations: SortOperation[], stats: SortStatistics) => void;
  onLaneComplete: (id: AlgorithmId, result: CompareResult) => void;
  onAllComplete: (results: CompareResult[], verdicts: CompareVerdicts) => void;
}

export class CompareController {
  private streams = new Map<AlgorithmId, OperationStream>();
  private schedulers = new Map<AlgorithmId, AnimationScheduler>();
  private results: CompareResult[] = [];
  private completedIds = new Set<AlgorithmId>();
  private running = false;

  constructor(
    private readonly ids: AlgorithmId[],
    private readonly baseArray: number[],
    private config: SortConfig,
    private readonly callbacks: CompareCallbacks
  ) {}

  start(): void {
    if (this.running) return;

    // Identical input for everyone, independent copies per lane.
    const shared = prepareSharedArray(this.baseArray, this.ids);
    const opsPerFrame = schedulerOpsPerFrame(modeForCount(this.config.elementCount));

    for (const id of this.ids) {
      const laneConfig: SortConfig = { ...this.config, algorithm: id };
      const stream = new OperationStream(laneConfig);
      const scheduler = new AnimationScheduler(stream, {
        targetFPS: 60,
        maxOperationsPerFrame: opsPerFrame,
        speedMultiplier: this.config.speed,
      });

      scheduler.onUpdate((operations, _array, stats, isComplete) => {
        this.callbacks.onLaneUpdate(id, operations, stats);
        if (isComplete) this.markComplete(id, stats);
      });
      // Fires exactly once per lane when its visualization has fully
      // caught up — double-guarded against the onUpdate path above.
      scheduler.onComplete(() => {
        this.markComplete(id, scheduler.getStatistics());
      });

      this.streams.set(id, stream);
      this.schedulers.set(id, scheduler);
      scheduler.start(shared.get(id)!);
    }

    this.running = true;
  }

  private markComplete(id: AlgorithmId, stats: SortStatistics): void {
    if (this.completedIds.has(id)) return;
    this.completedIds.add(id);

    const result: CompareResult = {
      algorithmId: id,
      elapsedMs: stats.elapsedTime,
      comparisons: stats.comparisons,
      swaps: stats.swaps,
      operations: stats.operations,
      arrayAccesses: stats.arrayAccesses,
    };
    this.results.push(result);
    this.callbacks.onLaneComplete(id, result);

    if (this.completedIds.size === this.ids.length) {
      this.running = false;
      const verdicts = computeVerdicts(this.results);
      if (verdicts) {
        this.callbacks.onAllComplete([...this.results], verdicts);
      }
    }
  }

  pause(): void {
    for (const scheduler of this.schedulers.values()) scheduler.pause();
  }

  resume(): void {
    for (const scheduler of this.schedulers.values()) scheduler.resume();
  }

  stop(): void {
    for (const scheduler of this.schedulers.values()) scheduler.stop();
    for (const stream of this.streams.values()) stream.stop();
    this.streams.clear();
    this.schedulers.clear();
    this.results = [];
    this.completedIds.clear();
    this.running = false;
  }

  setSpeed(multiplier: number): void {
    this.config = { ...this.config, speed: multiplier };
    for (const scheduler of this.schedulers.values()) scheduler.setSpeed(multiplier);
  }

  isRunning(): boolean {
    return this.running;
  }

  getIds(): AlgorithmId[] {
    return [...this.ids];
  }

  getResults(): CompareResult[] {
    return [...this.results];
  }
}
