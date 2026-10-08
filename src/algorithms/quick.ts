/**
 * Quick Sort implementation
 */

import { SortingAlgorithm, AlgorithmRegistry } from './base';
import type { AlgorithmInfo } from '../types';
import type { AlgorithmStepResult } from './base';

export class QuickSort extends SortingAlgorithm {
  private opsSinceYield = 0;

  getInfo(): AlgorithmInfo {
    return {
      id: 'quick',
      name: 'Quick Sort',
      description: 'Efficient divide-and-conquer algorithm that picks a pivot element and partitions the array around it, placing smaller elements before the pivot and larger elements after it.',
      bestComplexity: 'O(n log n)',
      averageComplexity: 'O(n log n)',
      worstComplexity: 'O(n²)',
      spaceComplexity: 'O(log n)',
      stable: false,
    };
  }

  *sort(array: number[]): Generator<AlgorithmStepResult, void, unknown> {
    this.array = [...array];
    this.resetStatistics();
    this.opsSinceYield = 0;

    yield* this.quickSort(0, this.array.length - 1);

    // Mark all as sorted
    for (let i = 0; i < this.array.length; i++) {
      this.markSorted(i);
    }

    yield this.createStepResult(true);
  }

  private *quickSort(low: number, high: number): Generator<AlgorithmStepResult, void, unknown> {
    if (low < high && !this.isCancelled()) {
      const pivotPos = yield* this.partition(low, high);
      if (this.isCancelled()) return;

      yield* this.quickSort(low, pivotPos - 1);
      if (this.isCancelled()) return;

      yield* this.quickSort(pivotPos + 1, high);
    }
  }

  private *partition(low: number, high: number): Generator<AlgorithmStepResult, number, unknown> {
    // Use middle element as pivot for better average performance
    const pivotIndex = Math.floor((low + high) / 2);

    // Visual: show the active partition range, then the pivot on top of it
    this.markRange(low, high);
    this.markPivot(pivotIndex);
    yield this.createStepResult();

    // Move pivot to end for partitioning
    if (pivotIndex !== high) {
      this.swap(pivotIndex, high);
      yield this.createStepResult();
    }

    // pivot is now at position `high`
    let i = low - 1;

    for (let j = low; j < high && !this.isCancelled(); j++) {
      if (this.compare(j, high) <= 0) {
        i++;
        if (i !== j) {
          this.swap(i, j);
        }
        this.opsSinceYield++;

        if (this.opsSinceYield >= 50) {
          this.opsSinceYield = 0;
          yield this.createStepResult();
        }
      }
    }

    // Place pivot in correct position
    const pivotFinalPos = i + 1;
    if (pivotFinalPos !== high) {
      this.swap(pivotFinalPos, high);
    }

    // Mark pivot as sorted
    this.markSorted(pivotFinalPos);

    yield this.createStepResult();
    return pivotFinalPos;
  }

  private createStepResult(isComplete = false): AlgorithmStepResult {
    const ops = this.operations.splice(0);
    return {
      operations: ops,
      // Headless mode never copies: benchmark runs ignore the snapshot.
      array: this.headless ? this.array : [...this.array],
      isComplete,
    };
  }

  protected calculateProgress(): number {
    const n = this.array.length;
    // Quick sort progress estimation based on operations. The factor is
    // calibrated against measured op counts (≈2.1·n·log2(n) at 10 000
    // elements) so the bar tracks the real run instead of pegging early.
    const expectedOps = n * Math.log2(n) * 2.1;
    return Math.min(1, this.statistics.operations / expectedOps);
  }
}

AlgorithmRegistry.register('quick', QuickSort);