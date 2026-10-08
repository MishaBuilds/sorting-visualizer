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

  constructor(config: SortConfig) {
    this.config = config;
    this.array = [];
  }

  abstract getInfo(): AlgorithmInfo;

  abstract sort(array: number[]): Generator<AlgorithmStepResult, void, unknown>;

  protected createOperation(type: OperationType, indices: number[], values?: number[], metadata?: Record<string, unknown>): SortOperation {
    this.statistics.operations++;
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
    this.createOperation('compare', [i, j], [this.array[i], this.array[j]]);
    return this.array[i] - this.array[j];
  }

  protected swap(i: number, j: number): void {
    this.statistics.swaps++;
    this.statistics.arrayAccesses += 4; // read i, read j, write i, write j
    const vi = this.array[i];
    const vj = this.array[j];
    this.createOperation('swap', [i, j], [vi, vj]);
    [this.array[i], this.array[j]] = [this.array[j], this.array[i]];
  }

  protected move(from: number, to: number): void {
    this.statistics.arrayAccesses += 2; // read from, write to
    const value = this.array[from];
    this.createOperation('move', [from, to], [value]);
    this.array[to] = value;
  }

  protected overwrite(index: number, value: number): void {
    this.statistics.arrayAccesses += 1; // write
    this.createOperation('overwrite', [index], [value]);
    this.array[index] = value;
  }

  protected markPivot(index: number): void {
    this.createOperation('pivot', [index], [this.array[index]]);
  }

  protected markHeapify(index: number): void {
    this.createOperation('heapify', [index], [this.array[index]]);
  }

  protected markMerge(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): void {
    const leftValues = this.array.slice(leftStart, leftEnd + 1);
    const rightValues = this.array.slice(rightStart, rightEnd + 1);
    this.createOperation('merge', [leftStart, leftEnd, rightStart, rightEnd], [...leftValues, ...rightValues], {
      leftRange: [leftStart, leftEnd],
      rightRange: [rightStart, rightEnd],
    });
  }

  protected markSorted(index: number): void {
    this.createOperation('mark-sorted', [index], [this.array[index]]);
  }

  protected markRange(start: number, end: number): void {
    this.createOperation('mark-range', [start, end]);
  }

  protected getArray(): number[] {
    return this.array;
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