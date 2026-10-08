/**
 * Algorithms barrel export
 */

export type { AlgorithmStepResult } from './base';
export { SortingAlgorithm, AlgorithmRegistry } from './base';
export { BubbleSort } from './bubble';
export { QuickSort } from './quick';
export { MergeSort } from './merge';
export { HeapSort } from './heap';

import { AlgorithmRegistry } from './base';
import { BubbleSort } from './bubble';
import { QuickSort } from './quick';
import { MergeSort } from './merge';
import { HeapSort } from './heap';
import type { SortConfig } from '../types';

export function initializeAlgorithms(): void {
  AlgorithmRegistry.register('bubble', BubbleSort);
  AlgorithmRegistry.register('quick', QuickSort);
  AlgorithmRegistry.register('merge', MergeSort);
  AlgorithmRegistry.register('heap', HeapSort);
}

export function createAlgorithm(id: string, config: SortConfig) {
  const AlgorithmClass = AlgorithmRegistry.get(id);
  if (!AlgorithmClass) {
    throw new Error(`Unknown algorithm: ${id}`);
  }
  return new AlgorithmClass(config);
}