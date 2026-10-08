/**
 * Heap Sort implementation
 */

import { SortingAlgorithm, AlgorithmRegistry } from './base';
import type { AlgorithmInfo } from '../types';
import type { AlgorithmStepResult } from './base';

export class HeapSort extends SortingAlgorithm {
  private opsSinceYield = 0;

  getInfo(): AlgorithmInfo {
    return {
      id: 'heap',
      name: 'Heap Sort',
      description: 'Comparison-based algorithm that builds a max heap from the array, then repeatedly extracts the maximum element and rebuilds the heap until sorted.',
      bestComplexity: 'O(n log n)',
      averageComplexity: 'O(n log n)',
      worstComplexity: 'O(n log n)',
      spaceComplexity: 'O(1)',
      stable: false,
    };
  }

  *sort(array: number[]): Generator<AlgorithmStepResult, void, unknown> {
    this.array = [...array];
    this.resetStatistics();
    this.opsSinceYield = 0;

    const n = this.array.length;

    // Build max heap
    for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
      yield* this.heapify(n, i);
      if (this.isCancelled()) return;
    }

    // Visual: the freshly built heap region lights up as one block; it
    // shrinks from the right as markSorted colors the extracted tail.
    if (n > 1) this.markRange(0, n - 1);
    yield this.createStepResult();

    // Extract elements from heap one by one
    for (let i = n - 1; i > 0 && !this.isCancelled(); i--) {
      // Move current root (max) to end
      this.swap(0, i);
      this.markSorted(i);
      yield this.createStepResult();

      // Heapify reduced heap
      yield* this.heapify(i, 0);
    }

    // Mark first element as sorted
    this.markSorted(0);

    yield this.createStepResult(true);
  }

  private *heapify(n: number, i: number): Generator<AlgorithmStepResult, void, unknown> {
    let largest = i;
    const left = 2 * i + 1;
    const right = 2 * i + 2;

    this.markHeapify(i);

    // Compare with left child
    if (left < n) {
      if (this.compare(left, largest) > 0) {
        largest = left;
      }
      this.opsSinceYield++;
      if (this.opsSinceYield >= 50) {
        this.opsSinceYield = 0;
        yield this.createStepResult();
      }
    }

    // Compare with right child
    if (right < n) {
      if (this.compare(right, largest) > 0) {
        largest = right;
      }
      this.opsSinceYield++;
      if (this.opsSinceYield >= 50) {
        this.opsSinceYield = 0;
        yield this.createStepResult();
      }
    }

    // If largest is not root
    if (largest !== i) {
      this.swap(i, largest);
      yield this.createStepResult();

      // Recursively heapify the affected sub-tree
      yield* this.heapify(n, largest);
    }
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
    // Heap sort: build heap O(n) + n extractions each O(log n). The
    // factor is calibrated against measured op counts (≈3.7·n·log2(n)).
    const expectedOps = n + n * Math.log2(n) * 3.7;
    return Math.min(1, this.statistics.operations / expectedOps);
  }
}

AlgorithmRegistry.register('heap', HeapSort);