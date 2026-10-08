import { describe, it, expect } from 'vitest';
import {
  NORMAL_COUNTS,
  PERFORMANCE_COUNTS,
  countsForMode,
  isPerformanceCount,
  modeForCount,
  defaultCountForMode,
  longRunWarning,
  schedulerOpsPerFrame,
} from '../src/utils/perfMode';
import { computeDatasetStats, formatAscendingPercent } from '../src/utils/datasetStats';
import { createSeriesSampler, downsample } from '../src/utils/graphSampler';
import { createRunHistory, HISTORY_STORAGE_KEY } from '../src/utils/runHistory';
import { initializeAlgorithms } from '../src/algorithms';
import { ALGORITHM_TAGS, getInspectorData } from '../src/algorithms/inspector';
import type { SortConfig, RunHistoryEntry, AlgorithmId } from '../src/types';

initializeAlgorithms();

const baseConfig: SortConfig = {
  algorithm: 'quick',
  elementCount: 10000,
  visualizationMode: 'cubes',
  speed: 1,
  dataDistribution: 'random',
  soundEnabled: false,
};

describe('Performance mode presets', () => {
  it('exposes the documented normal and performance counts', () => {
    expect(NORMAL_COUNTS).toEqual([1000, 5000, 10000]);
    expect(PERFORMANCE_COUNTS).toEqual([25000, 50000, 100000]);
    expect(countsForMode('normal')).toEqual([1000, 5000, 10000]);
    expect(countsForMode('performance')).toEqual([25000, 50000, 100000]);
  });

  it('classifies counts into the right mode', () => {
    expect(isPerformanceCount(10000)).toBe(false);
    expect(isPerformanceCount(25000)).toBe(true);
    expect(isPerformanceCount(100000)).toBe(true);
    expect(modeForCount(5000)).toBe('normal');
    expect(modeForCount(50000)).toBe('performance');
  });

  it('keeps the current count when it belongs to the target mode', () => {
    expect(defaultCountForMode('normal', 5000)).toBe(5000);
    expect(defaultCountForMode('performance', 50000)).toBe(50000);
    expect(defaultCountForMode('normal', 100000)).toBe(10000);
    expect(defaultCountForMode('performance', 10000)).toBe(25000);
  });

  it('raises scheduler throughput only in performance mode', () => {
    expect(schedulerOpsPerFrame('normal')).toBe(500);
    expect(schedulerOpsPerFrame('performance')).toBeGreaterThan(500);
  });

  it('warns only for genuinely infeasible combinations', () => {
    expect(longRunWarning('bubble', 100000)).not.toBeNull();
    expect(longRunWarning('bubble', 25000)).not.toBeNull();
    expect(longRunWarning('bubble', 10000)).toBeNull();
    expect(longRunWarning('quick', 100000)).toBeNull();
    expect(longRunWarning('merge', 100000)).toBeNull();
    expect(longRunWarning('heap', 100000)).toBeNull();
    // The warning never blocks: it is only a string.
    expect(typeof longRunWarning('bubble', 100000)).toBe('string');
  });
});

describe('Dataset statistics', () => {
  it('measures a fully ascending array as 100%', () => {
    const stats = computeDatasetStats([1, 2, 3, 4, 5]);
    expect(stats.ascendingFraction).toBe(1);
    expect(stats.uniqueCount).toBe(5);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
    expect(formatAscendingPercent(stats)).toBe('100.0% already ascending');
  });

  it('measures a reversed array as 0%', () => {
    const stats = computeDatasetStats([5, 4, 3, 2, 1]);
    expect(stats.ascendingFraction).toBe(0);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
  });

  it('measures mixed arrays from actual pairs', () => {
    // Pairs: (3,1) no, (1,2) yes, (2,4) yes, (4,3) no → 2/4 = 0.5
    const stats = computeDatasetStats([3, 1, 2, 4, 3]);
    expect(stats.ascendingFraction).toBeCloseTo(0.5, 10);
    expect(stats.count).toBe(5);
    expect(stats.uniqueCount).toBe(4); // 3, 1, 2, 4
  });

  it('handles empty and single-element arrays', () => {
    expect(computeDatasetStats([]).ascendingFraction).toBe(1);
    expect(computeDatasetStats([7]).ascendingFraction).toBe(1);
    expect(computeDatasetStats([7]).uniqueCount).toBe(1);
  });

  it('computes real uniqueness for few-unique data', () => {
    const arr = [2, 2, 5, 5, 2, 5];
    const stats = computeDatasetStats(arr);
    expect(stats.uniqueCount).toBe(2);
  });
});

describe('Graph sampling', () => {
  it('gates samples by interval', () => {
    const sampler = createSeriesSampler<number>({ intervalMs: 150 });
    expect(sampler.push(0, 10)).toBe(true);
    expect(sampler.push(100, 20)).toBe(false); // too soon
    expect(sampler.push(149, 30)).toBe(false);
    expect(sampler.push(150, 40)).toBe(true);
    expect(sampler.size()).toBe(2);
    expect(sampler.last()?.values).toBe(40);
  });

  it('never exceeds the point cap under sustained sampling', () => {
    const sampler = createSeriesSampler<number>({ intervalMs: 10, maxPoints: 100 });
    for (let i = 0; i < 5000; i++) {
      sampler.push(i * 10, i);
    }
    expect(sampler.size()).toBeLessThanOrEqual(100);
    // First and last moments of the run are preserved.
    expect(sampler.points()[0].t).toBe(0);
    expect(sampler.points()[sampler.size() - 1].t).toBe(49990);
  });

  it('reset clears everything', () => {
    const sampler = createSeriesSampler<number>({ intervalMs: 0 });
    sampler.push(0, 1);
    sampler.push(1, 2);
    sampler.reset();
    expect(sampler.size()).toBe(0);
    expect(sampler.last()).toBeNull();
  });

  it('downsample keeps first, last and even spacing', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ t: i, values: i }));
    const down = downsample(points, 4);
    expect(down.length).toBe(4);
    expect(down[0].t).toBe(0);
    expect(down[3].t).toBe(9);
    // Monotonic in time
    for (let i = 1; i < down.length; i++) expect(down[i].t).toBeGreaterThan(down[i - 1].t);
    // Input untouched
    expect(points.length).toBe(10);
  });

  it('stores samples as-is without dropping data below the cap', () => {
    const sampler = createSeriesSampler<{ c: number }>({ intervalMs: 5, maxPoints: 50 });
    for (let i = 0; i < 40; i++) sampler.push(i * 5, { c: i * 7 });
    expect(sampler.size()).toBe(40);
    expect(sampler.points()[39].values.c).toBe(39 * 7);
  });
});

function fakeStore(initial?: string): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Record<string, string> } {
  const data: Record<string, string> = initial !== undefined ? { [HISTORY_STORAGE_KEY]: initial } : {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function entry(algorithm: AlgorithmId, elapsedMs: number): RunHistoryEntry {
  return {
    algorithm,
    algorithmName: algorithm,
    elementCount: 10000,
    elapsedMs,
    comparisons: 100,
    swaps: 50,
    operations: 300,
    timestamp: 1,
  };
}

describe('Run history', () => {
  it('keeps entries newest-first and caps the list', () => {
    const history = createRunHistory(fakeStore(), 3);
    history.add(entry('quick', 8000));
    history.add(entry('merge', 17000));
    history.add(entry('heap', 20000));
    history.add(entry('bubble', 90000)); // exceeds cap → oldest dropped

    expect(history.size()).toBe(3);
    expect(history.list().map((e) => e.algorithm)).toEqual(['bubble', 'heap', 'merge']);
  });

  it('persists to the store and reloads', () => {
    const store = fakeStore();
    const history = createRunHistory(store);
    history.add(entry('quick', 8420));

    const reloaded = createRunHistory(store);
    expect(reloaded.size()).toBe(1);
    expect(reloaded.list()[0].elapsedMs).toBe(8420);
  });

  it('clear empties memory and storage', () => {
    const store = fakeStore();
    const history = createRunHistory(store);
    history.add(entry('quick', 1));
    history.clear();
    expect(history.size()).toBe(0);
    expect(store.data[HISTORY_STORAGE_KEY]).toBe('[]');
    expect(createRunHistory(store).size()).toBe(0);
  });

  it('tolerates corrupted stored JSON', () => {
    const history = createRunHistory(fakeStore('{not json'));
    expect(history.size()).toBe(0);
    history.add(entry('merge', 1));
    expect(history.size()).toBe(1);
  });

  it('tolerates a failing storage backend', () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const history = createRunHistory(broken);
    expect(() => history.add(entry('quick', 1))).not.toThrow();
    expect(history.size()).toBe(1); // in-memory fallback still works
  });
});

describe('Algorithm inspector data', () => {
  const ids: AlgorithmId[] = ['bubble', 'quick', 'merge', 'heap'];

  it('every algorithm has a presentation tag', () => {
    for (const id of ids) {
      expect(ALGORITHM_TAGS[id]).toBeTruthy();
      expect(ALGORITHM_TAGS[id].length).toBeGreaterThan(0);
    }
  });

  it('derives complexity info from the real algorithm', () => {
    for (const id of ids) {
      const data = getInspectorData(id, { ...baseConfig, algorithm: id });
      expect(data).not.toBeNull();
      expect(data!.name.length).toBeGreaterThan(0);
      expect(data!.bestComplexity).toContain('O(');
      expect(data!.worstComplexity).toContain('O(');
      expect(data!.tag).toBe(ALGORITHM_TAGS[id]);
    }
  });

  it('quick sort is documented as divide & conquer with n² worst case', () => {
    const data = getInspectorData('quick', baseConfig)!;
    expect(data.tag).toBe('Divide & Conquer');
    expect(data.worstComplexity).toBe('O(n²)');
  });
});
