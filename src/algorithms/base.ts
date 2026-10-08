/**
 * Base algorithm class and interfaces
 */

import type { SortOperation, OperationType, AlgorithmInfo, SortConfig, SortingContext } from '../types';

export interface AlgorithmStepResult {
  operations: SortOperation[];
  array: number[];
  isComplete: boolean;
}

export abstract class SortingAlgorithm {
  protected array: number[];
  protected operations: SortOperation[] = [];
  protected statistics = {
    comparisons: 0,
    swaps: 0,
    arrayAccesses: 0,
    operations: 0,
  };
  protected startTime = 0;
  protected currentTime = 0;
  protected config: SortConfig;
  protected context: SortingContext | null = null;
  protected cancelled = false;
  /**
   * Headless (benchmark) mode: the algorithm performs the exact same real
   * comparisons / swaps / writes on the array and keeps the exact same
   * counters, but skips visualization bookkeeping — operation objects,
   * per-op timestamps and per-step array snapshots. This keeps the
   * measured "algorithm time" focused on the algorithm itself instead of
   * on rendering support work. Never active in the visualizer pipeline.
   */
  protected headless = false;

  constructor(config: SortConfig) {
    this.config = config;
    this.array = [];
  }

  abstract getInfo(): AlgorithmInfo;

  abstract sort(array: number[]): Generator<AlgorithmStepResult, void, unknown>;

  /** Count an operation; in headless mode only the counter moves. */
  protected bumpOperation(): void {
    this.statistics.operations++;
  }

  protected createOperation(type: OperationType, indices: number[], values?: number[], metadata?: Record<string, unknown>): SortOperation | null {
    this.statistics.operations++;
    if (this.headless) return null; // no rendering bookkeeping in benchmark runs
    const op: SortOperation = {
      type,
      indices,
      values,
      metadata,
      timestamp: performance.now() - this.startTime,
    };
    this.operations.push(op);
    return op;
  }

  protected compare(i: number, j: number): number {
    this.statistics.comparisons++;
    this.statistics.arrayAccesses += 2;
    if (this.headless) this.bumpOperation();
    else this.createOperation('compare', [i, j], [this.array[i], this.array[j]]);
    return this.array[i] - this.array[j];
  }

  protected swap(i: number, j: number): void {
    this.statistics.swaps++;
    this.statistics.arrayAccesses += 4; // read i, read j, write i, write j
    const vi = this.array[i];
    const vj = this.array[j];
    if (this.headless) this.bumpOperation();
    else this.createOperation('swap', [i, j], [vi, vj]);
    [this.array[i], this.array[j]] = [this.array[j], this.array[i]];
  }

  protected move(from: number, to: number): void {
    this.statistics.arrayAccesses += 2; // read from, write to
    const value = this.array[from];
    if (this.headless) this.bumpOperation();
    else this.createOperation('move', [from, to], [value]);
    this.array[to] = value;
  }

  protected overwrite(index: number, value: number): void {
    this.statistics.arrayAccesses += 1; // write
    if (this.headless) this.bumpOperation();
    else this.createOperation('overwrite', [index], [value]);
    this.array[index] = value;
  }

  protected markPivot(index: number): void {
    if (this.headless) this.bumpOperation();
    else this.createOperation('pivot', [index], [this.array[index]]);
  }

  protected markHeapify(index: number): void {
    if (this.headless) this.bumpOperation();
    else this.createOperation('heapify', [index], [this.array[index]]);
  }

  protected markMerge(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): void {
    if (this.headless) {
      this.bumpOperation();
      return;
    }
    const leftValues = this.array.slice(leftStart, leftEnd + 1);
    const rightValues = this.array.slice(rightStart, rightEnd + 1);
    this.createOperation('merge', [leftStart, leftEnd, rightStart, rightEnd], [...leftValues, ...rightValues], {
      leftRange: [leftStart, leftEnd],
      rightRange: [rightStart, rightEnd],
    });
  }

  protected markSorted(index: number): void {
    if (this.headless) this.bumpOperation();
    else this.createOperation('mark-sorted', [index], [this.array[index]]);
  }

  protected markRange(start: number, end: number): void {
    if (this.headless) this.bumpOperation();
    else this.createOperation('mark-range', [start, end]);
  }

  protected getArray(): number[] {
    return this.array;
  }

  /** Switch the algorithm into headless (benchmark) mode. See field docs. */
  setHeadless(enabled: boolean): void {
    this.headless = enabled;
  }

  /**
   * The final (sorted) internal array — used by the benchmark engine's
   * correctness check. Returns a copy so callers can never mutate the
   * algorithm's own state.
   */
  getFinalArray(): number[] {
    return [...this.array];
  }

  /**
   * Authoritative counters of the running algorithm
   * (comparisons, swaps, real array accesses, operations).
   * Public so the simulation layer can report genuine statistics.
   */
  getStatistics() {
    return {
      ...this.statistics,
      elapsedTime: performance.now() - this.startTime,
      progress: this.calculateProgress(),
    };
  }

  protected abstract calculateProgress(): number;

  protected resetStatistics(): void {
    this.statistics = {
      comparisons: 0,
      swaps: 0,
      arrayAccesses: 0,
      operations: 0,
    };
    this.operations = [];
    this.startTime = performance.now();
    this.cancelled = false;
  }

  cancel(): void {
    this.cancelled = true;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  getContext(): SortingContext | null {
    return this.context;
  }
}

export class AlgorithmRegistry {
  private static algorithms: Map<string, new (config: SortConfig) => SortingAlgorithm> = new Map();

  static register(id: string, algorithmClass: new (config: SortConfig) => SortingAlgorithm): void {
    this.algorithms.set(id, algorithmClass);
  }

  static get(id: string): (new (config: SortConfig) => SortingAlgorithm) | undefined {
    return this.algorithms.get(id);
  }

  static getAll(): Map<string, new (config: SortConfig) => SortingAlgorithm> {
    return new Map(this.algorithms);
  }

  static getIds(): string[] {
    return Array.from(this.algorithms.keys());
  }
}