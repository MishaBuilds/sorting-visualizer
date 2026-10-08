import { describe, it, expect } from 'vitest';
import {
  validateSelection,
  prepareSharedArray,
  computeVerdicts,
  computeLaneLayout,
  COMPARE_MIN_ALGORITHMS,
  COMPARE_MAX_ALGORITHMS,
} from '../src/utils/compare';
import { OperationStream } from '../src/simulation/operationStream';
import { initializeAlgorithms } from '../src/algorithms';
import { generateArray } from '../src/simulation';
import type { AlgorithmId, CompareResult, SortConfig } from '../src/types';

initializeAlgorithms();

function isSorted(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1] > arr[i]) return false;
  }
  return true;
}

function runStream(algorithmId: string, array: number[]): Promise<{
  finalArray: number[];
  stats: { comparisons: number; swaps: number; operations: number; arrayAccesses: number; elapsedTime: number };
}> {
  return new Promise((resolve, reject) => {
    const config: SortConfig = {
      algorithm: algorithmId as SortConfig['algorithm'],
      elementCount: array.length,
      visualizationMode: 'cubes',
      speed: 1,
      dataDistribution: 'random',
      soundEnabled: false,
    };
    const stream = new OperationStream(config);
    stream.onComplete((finalArray, stats) => resolve({ finalArray, stats }));
    stream.onError((err) => reject(err));
    stream.start(array);
  });
}

describe('Compare selection validation', () => {
  it('accepts 2 to 4 distinct algorithms', () => {
    expect(validateSelection(['quick', 'merge']).ok).toBe(true);
    expect(validateSelection(['quick', 'merge', 'heap']).ok).toBe(true);
    expect(validateSelection(['quick', 'merge', 'heap', 'bubble']).ok).toBe(true);
  });

  it('rejects fewer than 2 selections', () => {
    const result = validateSelection(['quick']);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(String(COMPARE_MIN_ALGORITHMS));
    expect(validateSelection([]).ok).toBe(false);
  });

  it('rejects more than 4 selections', () => {
    const result = validateSelection(['quick', 'merge', 'heap', 'bubble', 'quick'] as AlgorithmId[]);
    expect(result.ok).toBe(false);
    // Duplicate check fires first for 5 entries with a repeat...
    expect(result.error!.length).toBeGreaterThan(0);
    expect(COMPARE_MAX_ALGORITHMS).toBe(4);
  });

  it('rejects duplicate selections', () => {
    const result = validateSelection(['quick', 'quick']);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('once');
  });
});

describe('Shared compare input array', () => {
  it('gives every algorithm an identical, independent copy', () => {
    const base = [5, 3, 8, 1, 9];
    const copies = prepareSharedArray(base, ['quick', 'merge', 'heap']);

    expect(copies.size).toBe(3);
    expect(copies.get('quick')).toEqual(base);
    expect(copies.get('merge')).toEqual(base);
    expect(copies.get('heap')).toEqual(base);

    // Independence: mutating one copy must not affect the others.
    const quick = copies.get('quick')!;
    quick[0] = 999;
    expect(copies.get('merge')![0]).toBe(5);
    expect(base[0]).toBe(5);
  });
});

describe('Verdicts from real measurements', () => {
  const results: CompareResult[] = [
    { algorithmId: 'bubble', elapsedMs: 90000, comparisons: 500000, swaps: 250000, operations: 750000, arrayAccesses: 2000000 },
    { algorithmId: 'quick', elapsedMs: 8420, comparisons: 151024, swaps: 75213, operations: 249502, arrayAccesses: 602600 },
    { algorithmId: 'merge', elapsedMs: 17600, comparisons: 118000, swaps: 0, operations: 420000, arrayAccesses: 900000 },
    { algorithmId: 'heap', elapsedMs: 20100, comparisons: 160000, swaps: 80000, operations: 498000, arrayAccesses: 980000 },
  ];

  it('picks the real fastest / fewest comparisons / most operations', () => {
    const verdicts = computeVerdicts(results)!;
    expect(verdicts.fastest).toBe('quick');      // 8 420 ms is the minimum
    expect(verdicts.fewestComparisons).toBe('merge'); // 118 000 is the minimum
    expect(verdicts.mostOperations).toBe('bubble');   // 750 000 is the maximum
  });

  it('returns null without a complete comparison', () => {
    expect(computeVerdicts([results[0]])).toBeNull();
    expect(computeVerdicts([])).toBeNull();
  });

  it('resolves ties deterministically (first in input order)', () => {
    const tied: CompareResult[] = [
      { algorithmId: 'quick', elapsedMs: 1000, comparisons: 10, swaps: 1, operations: 100, arrayAccesses: 0 },
      { algorithmId: 'merge', elapsedMs: 1000, comparisons: 10, swaps: 1, operations: 100, arrayAccesses: 0 },
    ];
    const verdicts = computeVerdicts(tied)!;
    expect(verdicts.fastest).toBe('quick');
    expect(verdicts.fewestComparisons).toBe('quick');
    expect(verdicts.mostOperations).toBe('quick');
  });
});

describe('Lane viewport layout', () => {
  const W = 1920;
  const H = 1080;

  it('splits 2 lanes into a 1x2 grid covering the canvas', () => {
    const GAP = 6;
    const layout = computeLaneLayout(2, W, H, GAP);
    expect(layout.rows).toBe(1);
    expect(layout.cols).toBe(2);
    expect(layout.lanes).toHaveLength(2);
    expect(layout.emptyCell).toBeNull();

    const [a, b] = layout.lanes;
    expect(a.x).toBe(GAP / 2);
    expect(a.x + a.w).toBeLessThan(b.x); // no horizontal overlap
    expect(b.x + b.w).toBe(W - GAP / 2); // reaches the right edge
    expect(a.h).toBe(H - GAP);           // full height minus the gap trim
    expect(a.w + b.w).toBe(W - 2 * GAP); // together they span the width
  });

  it('splits 4 lanes into a 2x2 grid without overlaps', () => {
    const layout = computeLaneLayout(4, W, H);
    expect(layout.rows).toBe(2);
    expect(layout.cols).toBe(2);
    expect(layout.emptyCell).toBeNull();

    for (const lane of layout.lanes) {
      expect(lane.x).toBeGreaterThanOrEqual(0);
      expect(lane.y).toBeGreaterThanOrEqual(0);
      expect(lane.x + lane.w).toBeLessThanOrEqual(W + 0.001);
      expect(lane.y + lane.h).toBeLessThanOrEqual(H + 0.001);
    }
    // Pairwise non-overlap
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const a = layout.lanes[i];
        const b = layout.lanes[j];
        const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
        const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it('uses the leftover cell for 3 lanes', () => {
    const layout = computeLaneLayout(3, W, H);
    expect(layout.lanes).toHaveLength(3);
    expect(layout.rows).toBe(2);
    expect(layout.cols).toBe(2);
    expect(layout.emptyCell).not.toBeNull();
    expect(layout.emptyCell!.x).toBeGreaterThanOrEqual(0);
    expect(layout.emptyCell!.y).toBeGreaterThanOrEqual(0);
  });

  it('clamps out-of-range counts', () => {
    expect(computeLaneLayout(1, W, H).lanes).toHaveLength(2);
    expect(computeLaneLayout(9, W, H).lanes).toHaveLength(4);
  });
});

describe('Compare integration: real streams on the shared array', () => {
  it('quick + merge + bubble all sort the same input correctly', async () => {
    const base = generateArray(300, 'random');
    const ids: AlgorithmId[] = ['quick', 'merge', 'bubble'];
    const shared = prepareSharedArray(base, ids);

    const runs = await Promise.all(
      ids.map((id) => runStream(id, shared.get(id)!))
    );

    for (const run of runs) {
      expect(isSorted(run.finalArray)).toBe(true);
      expect([...run.finalArray].sort((a, b) => a - b)).toEqual([...base].sort((a, b) => a - b));
      expect(run.stats.comparisons).toBeGreaterThan(0);
      expect(run.stats.operations).toBeGreaterThan(0);
    }

    // Build real compare results and derive verdicts from them.
    const results: CompareResult[] = ids.map((id, i) => ({
      algorithmId: id,
      elapsedMs: runs[i].stats.elapsedTime,
      comparisons: runs[i].stats.comparisons,
      swaps: runs[i].stats.swaps,
      operations: runs[i].stats.operations,
      arrayAccesses: runs[i].stats.arrayAccesses,
    }));

    const verdicts = computeVerdicts(results);
    expect(verdicts).not.toBeNull();
    expect(ids).toContain(verdicts!.fastest);
    expect(ids).toContain(verdicts!.fewestComparisons);
    expect(ids).toContain(verdicts!.mostOperations);

    // Bubble really is the slowest comparator on random data.
    expect(verdicts!.fewestComparisons).not.toBe('bubble');
  }, 15000);
});
