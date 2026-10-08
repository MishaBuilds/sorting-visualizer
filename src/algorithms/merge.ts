/**
 * Merge Sort implementation
 */

import { SortingAlgorithm, AlgorithmRegistry } from './base';
import type { AlgorithmInfo } from '../types';
import type { AlgorithmStepResult } from './base';

export class MergeSort extends SortingAlgorithm {
  private tempArray: number[] = [];
  private opsSinceYield = 0;

  getInfo(): AlgorithmInfo {
    return {
      id: 'merge',
      name: 'Merge Sort',
      description: 'Stable divide-and-conquer algorithm that divides the array into halves, recursively sorts them, and then merges the sorted halves back together.',
      bestComplexity: 'O(n log n)',
      averageComplexity: 'O(n log n)',
      worstComplexity: 'O(n log n)',
      spaceComplexity: 'O(n)',
      stable: true,
    };
  }

  *sort(array: number[]): Generator<AlgorithmStepResult, void, unknown> {
    this.array = [...array];
    this.tempArray = new Array(this.array.length);
    this.resetStatistics();
    this.opsSinceYield = 0;

    yield* this.mergeSort(0, this.array.length - 1);

    // Mark all as sorted
    for (let i = 0; i < this.array.length; i++) {
      this.markSorted(i);
    }

    yield this.createStepResult(true);
  }

  private *mergeSort(left: number, right: number): Generator<AlgorithmStepResult, void, unknown> {
    if (left < right && !this.isCancelled()) {
      const mid = Math.floor((left + right) / 2);

      yield* this.mergeSort(left, mid);
      if (this.isCancelled()) return;

      yield* this.mergeSort(mid + 1, right);
      if (this.isCancelled()) return;

      yield* this.merge(left, mid, right);
    }
  }

  private *merge(left: number, mid: number, right: number): Generator<AlgorithmStepResult, void, unknown> {
    // Copy to temp array
    for (let i = left; i <= right; i++) {
      this.tempArray[i] = this.array[i];
      this.statistics.arrayAccesses++;
    }

    // Mark the ranges being merged
    this.markMerge(left, mid, mid + 1, right);
    yield this.createStepResult();

    let i = left;
    let j = mid + 1;
    let k = left;

    while (i <= mid && j <= right && !this.isCancelled()) {
      this.statistics.comparisons++;
      this.statistics.arrayAccesses += 2;
      this.createOperation('compare', [i, j], [this.tempArray[i], this.tempArray[j]]);

      if (this.tempArray[i] <= this.tempArray[j]) {
        this.overwrite(k, this.tempArray[i]);
        i++;
      } else {
        this.overwrite(k, this.tempArray[j]);
        j++;
      }
      k++;
      this.statistics.arrayAccesses++; // write

      this.opsSinceYield++;
      if (this.opsSinceYield >= 50) {
        this.opsSinceYield = 0;
        yield this.createStepResult();
      }
    }

    // Copy remaining elements from left half
    while (i <= mid && !this.isCancelled()) {
      this.overwrite(k, this.tempArray[i]);
      this.statistics.arrayAccesses += 2; // read + write
      this.createOperation('move', [i, k], [this.tempArray[i]]);
      i++;
      k++;

      this.opsSinceYield++;
      if (this.opsSinceYield >= 50) {
        this.opsSinceYield = 0;
        yield this.createStepResult();
      }
    }

    // Copy remaining elements from right half
    while (j <= right && !this.isCancelled()) {
      this.overwrite(k, this.tempArray[j]);
      this.statistics.arrayAccesses += 2; // read + write
      this.createOperation('move', [j, k], [this.tempArray[j]]);
      j++;
      k++;

      this.opsSinceYield++;
      if (this.opsSinceYield >= 50) {
        this.opsSinceYield = 0;
        yield this.createStepResult();
      }
    }

    // Mark merged range as sorted
    for (let idx = left; idx <= right; idx++) {
      this.markSorted(idx);
    }

    yield this.createStepResult();
  }

  private createStepResult(isComplete = false): AlgorithmStepResult {
    const ops = this.operations.splice(0);
    return {
      operations: ops,
      array: [...this.array],
      isComplete,
    };
  }

  protected calculateProgress(): number {
    const n = this.array.length;
    // Merge sort: log2(n) levels, each level processes n elements. The
    // factor is calibrated against measured op counts (≈3.2·n·log2(n)).
    const expectedOps = n * Math.log2(n) * 3.2;
    return Math.min(1, this.statistics.operations / expectedOps);
  }
}

AlgorithmRegistry.register('merge', MergeSort);