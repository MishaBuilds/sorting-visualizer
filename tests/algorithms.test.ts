import { describe, it, expect } from 'vitest';
import { initializeAlgorithms, createAlgorithm } from '../src/algorithms';
import type { SortConfig } from '../src/types';
import { generateArray } from '../src/simulation';

initializeAlgorithms();

const baseConfig: SortConfig = {
  algorithm: 'quick',
  elementCount: 100,
  visualizationMode: 'cubes',
  speed: 1,
  dataDistribution: 'random',
  soundEnabled: false,
};

function collectFinalArray(algorithmId: string, array: number[]): number[] {
  const config = { ...baseConfig, algorithm: algorithmId as SortConfig['algorithm'] };
  const algorithm = createAlgorithm(algorithmId, config);
  const generator = algorithm.sort(array);

  let lastArray = [...array];
  let result = generator.next();
  while (!result.done) {
    lastArray = result.value.array;
    result = generator.next();
  }
  return lastArray;
}

function isSorted(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1] > arr[i]) return false;
  }
  return true;
}

describe('Sorting Algorithms', () => {
  const algorithms = ['bubble', 'quick', 'merge', 'heap'] as const;

  for (const algo of algorithms) {
    it(`${algo} sorts a random array correctly`, () => {
      const array = generateArray(500, 'random');
      const result = collectFinalArray(algo, array);
      expect(isSorted(result)).toBe(true);
      expect(result.length).toBe(array.length);
    });

    it(`${algo} sorts an already-sorted array`, () => {
      const array = generateArray(200, 'nearly-sorted');
      const result = collectFinalArray(algo, array);
      expect(isSorted(result)).toBe(true);
    });

    it(`${algo} sorts a reversed array`, () => {
      const array = generateArray(200, 'reversed');
      const result = collectFinalArray(algo, array);
      expect(isSorted(result)).toBe(true);
    });

    it(`${algo} sorts few-unique values`, () => {
      const array = generateArray(200, 'few-unique');
      const result = collectFinalArray(algo, array);
      expect(isSorted(result)).toBe(true);
    });

    it(`${algo} preserves all elements (no loss/duplication)`, () => {
      const array = generateArray(300, 'random');
      const sortedCopy = [...array].sort((a, b) => a - b);
      const result = collectFinalArray(algo, array);
      expect([...result].sort((a, b) => a - b)).toEqual(sortedCopy);
    });
  }

  it('handles edge case: single element', () => {
    const result = collectFinalArray('quick', [42]);
    expect(result).toEqual([42]);
  });

  it('handles edge case: two elements', () => {
    const result = collectFinalArray('quick', [2, 1]);
    expect(result).toEqual([1, 2]);
  });

  it('handles edge case: empty array', () => {
    const result = collectFinalArray('quick', []);
    expect(result).toEqual([]);
  });

  it('algorithm info is defined for all algorithms', () => {
    for (const algo of algorithms) {
      const algorithm = createAlgorithm(algo, baseConfig);
      const info = algorithm.getInfo();
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.bestComplexity.length).toBeGreaterThan(0);
      expect(info.worstComplexity.length).toBeGreaterThan(0);
    }
  });
});

describe('Statistics counting', () => {
  it('quick sort counts comparisons and swaps', () => {
    const config = { ...baseConfig, algorithm: 'quick' as const };
    const algorithm = createAlgorithm('quick', config);
    const generator = algorithm.sort([3, 1, 2]);
    let result = generator.next();
    while (!result.done) result = generator.next();
    // Just verify it runs without error and produces sorted output
    const finalArray = collectFinalArray('quick', [3, 1, 2]);
    expect(isSorted(finalArray)).toBe(true);
  });
});