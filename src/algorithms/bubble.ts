/**
 * Bubble Sort implementation
 */

import { SortingAlgorithm, AlgorithmRegistry } from './base';
import type { AlgorithmInfo } from '../types';
import type { AlgorithmStepResult } from './base';

export class BubbleSort extends SortingAlgorithm {
  getInfo(): AlgorithmInfo {
    return {
      id: 'bubble',
      name: 'Bubble Sort',
      description: 'Simple comparison-based algorithm that repeatedly steps through the list, compares adjacent elements and swaps them if they are in the wrong order.',
      bestComplexity: 'O(n)',
      averageComplexity: 'O(n²)',
      worstComplexity: 'O(n²)',
      spaceComplexity: 'O(1)',
      stable: true,
    };
  }

  *sort(array: number[]): Generator<AlgorithmStepResult, void, unknown> {
    this.array = [...array];
    this.resetStatistics();

    const n = this.array.length;

    for (let i = 0; i < n - 1 && !this.isCancelled(); i++) {
      let swapped = false;

      for (let j = 0; j < n - 1 - i && !this.isCancelled(); j++) {
        if (this.compare(j, j + 1) > 0) {
          this.swap(j, j + 1);
          swapped = true;
        }

        // Yield control periodically for visualization
        if (this.statistics.operations % 100 === 0) {
          yield this.createStepResult();
        }
      }

      // Mark the last element as sorted
      this.markSorted(n - 1 - i);

      if (!swapped) {
        // Mark all remaining as sorted
        for (let k = 0; k <= n - 1 - i; k++) {
          this.markSorted(k);
        }
        break;
      }

      yield this.createStepResult();
    }

    // Mark all as sorted if not already
    for (let i = 0; i < n; i++) {
      this.markSorted(i);
    }

    yield this.createStepResult(true);
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
    // Rough approximation for bubble sort
    return Math.min(1, this.statistics.comparisons / (n * n / 2));
  }
}

AlgorithmRegistry.register('bubble', BubbleSort);