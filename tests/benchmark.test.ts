import { describe, it, expect, beforeEach } from 'vitest';
import {
  runAlgorithmOnce,
  runBenchmark,
  runScaling,
  checkCorrectness,
  arrayFingerprint,
} from '../src/benchmark/runner';
import {
  summarize,
  aggregateRuns,
  aggregateAlgorithm,
  aggregateBenchmark,
  countFailedRuns,
} from '../src/benchmark/statistics';
import { computeRankings, winnerOf, rankOf } from '../src/benchmark/ranking';
import { benchmarkWarning, scalingWarning } from '../src/benchmark/warning';
import {
  createBenchmarkHistory,
  historyEntryFromResult,
} from '../src/benchmark/history';
import {
  BENCHMARK_HISTORY_KEY,
  MAX_BENCHMARK_HISTORY_ENTRIES,
  defaultBenchmarkStore,
} from '../src/benchmark/storage';
import {
  benchmarkToCSV,
  scalingToCSV,
  benchmarkToJSON,
  scalingToJSON,
  buildExportDocument,
  formatDuration,
  formatTextReport,
  csvCell,
} from '../src/benchmark/export';
import {
  buildBenchmarkView,
  runsChartSeries,
  scalingChartSeries,
} from '../src/benchmark/results';
import { analyzeDataset, countInversions } from '../src/utils/datasetStats';
import { generateArray } from '../src/simulation';
import { SortingAlgorithm, AlgorithmRegistry, createAlgorithm } from '../src/algorithms';
import type { AlgorithmStepResult } from '../src/algorithms';
import type {
  AlgorithmId,
  AlgorithmInfo,
  SortConfig,
} from '../src/types';
import type {
  AlgorithmRunResult,
  BenchmarkHistoryEntry,
  BenchmarkResult,
} from '../src/benchmark/types';

// ---------------------------------------------------------------------------
// Test-only algorithms registered into the real registry. They let us prove
// fairness (identical clones), cancellation, failure and per-run isolation
// without touching production code.
// ---------------------------------------------------------------------------

function fakeInfo(name: string): AlgorithmInfo {
  return {
    id: 'quick',
    name,
    description: 'test fake',
    bestComplexity: 'O(n)',
    averageComplexity: 'O(n)',
    worstComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    stable: true,
  };
}

/** Records every input array it receives, then sorts it properly. */
class RecorderSort extends SortingAlgorithm {
  static received: number[][] = [];
  getInfo(): AlgorithmInfo {
    return fakeInfo('Recorder');
  }
  *sort(array: number[]): Generator<AlgorithmStepResult, void, unknown> {
    RecorderSort.received.push(array);
    this.array = [...array].sort((a, b) => a - b);
    yield { operations: [], array: this.array, isComplete: true };
  }
  protected calculateProgress(): number {
    return 1;
  }
}

class RecorderSortB extends RecorderSort {
  getInfo(): AlgorithmInfo {
    return fakeInfo('RecorderB');
  }
}

/** Returns the array untouched (unsorted input stays unsorted). */
class BrokenSort extends SortingAlgorithm {
  getInfo(): AlgorithmInfo {
    return fakeInfo('Broken');
  }
  *sort(array: number[]): Generator<AlgorithmStepResult, void, unknown> {
    this.array = [...array];
    yield { operations: [], array: this.array, isComplete: true };
  }
  protected calculateProgress(): number {
    return 1;
  }
}

/** Sorts correctly but corrupts one value (sum check must catch it). */
class CorruptSort extends SortingAlgorithm {
  getInfo(): AlgorithmInfo {
    return fakeInfo('Corrupt');
  }
  *sort(array: number[]): Generator<AlgorithmStepResult, void, unknown> {
    this.array = [...array].sort((a, b) => a - b);
    if (this.array.length > 0) this.array[this.array.length - 1] += 1000;
    yield { operations: [], array: this.array, isComplete: true };
  }
  protected calculateProgress(): number {
    return 1;
  }
}

/** Throws inside the generator. */
class ThrowSort extends SortingAlgorithm {
  getInfo(): AlgorithmInfo {
    return fakeInfo('Thrower');
  }
  *sort(array: number[]): Generator<AlgorithmStepResult, void, unknown> {
    this.array = [...array];
    yield { operations: [], array: this.array, isComplete: false };
    throw new Error('boom');
  }
  protected calculateProgress(): number {
    return 0;
  }
}

/** Yields forever — used to prove cooperative cancellation. */
class SlowSort extends SortingAlgorithm {
  getInfo(): AlgorithmInfo {
    return fakeInfo('Slow');
  }
  *sort(array: number[]): Generator<AlgorithmStepResult, void, unknown> {
    this.array = [...array];
    while (true) {
      this.statistics.comparisons++;
      yield { operations: [], array: this.array, isComplete: false };
    }
  }
  protected calculateProgress(): number {
    return 0;
  }
}

/** Reports a different counter on every invocation (per-run isolation). */
class VaryingSort extends SortingAlgorithm {
  static calls = 0;
  getInfo(): AlgorithmInfo {
    return fakeInfo('Varying');
  }
  *sort(array: number[]): Generator<AlgorithmStepResult, void, unknown> {
    VaryingSort.calls++;
    this.array = [...array].sort((a, b) => a - b);
    for (let i = 0; i < VaryingSort.calls; i++) this.statistics.comparisons++;
    yield { operations: [], array: this.array, isComplete: true };
  }
  protected calculateProgress(): number {
    return 1;
  }
}

const REC_A = 'recorder-a' as unknown as AlgorithmId;
const REC_B = 'recorder-b' as unknown as AlgorithmId;
const BROKEN = 'broken' as unknown as AlgorithmId;
const CORRUPT = 'corrupt' as unknown as AlgorithmId;
const THROWER = 'thrower' as unknown as AlgorithmId;
const SLOW = 'slow' as unknown as AlgorithmId;
const VARYING = 'varying' as unknown as AlgorithmId;

AlgorithmRegistry.register('recorder-a', RecorderSort);
AlgorithmRegistry.register('recorder-b', RecorderSortB);
AlgorithmRegistry.register('broken', BrokenSort);
AlgorithmRegistry.register('corrupt', CorruptSort);
AlgorithmRegistry.register('thrower', ThrowSort);
AlgorithmRegistry.register('slow', SlowSort);
AlgorithmRegistry.register('varying', VaryingSort);

const baseConfig: SortConfig = {
  algorithm: 'quick',
  elementCount: 10000,
  visualizationMode: 'cubes',
  speed: 1,
  dataDistribution: 'random',
  soundEnabled: false,
};

beforeEach(() => {
  RecorderSort.received = [];
  VaryingSort.calls = 0;
});

// ---------------------------------------------------------------------------

describe('Correctness checks', () => {
  it('accepts a properly sorted array', () => {
    expect(checkCorrectness([3, 1, 2], [1, 2, 3]).ok).toBe(true);
  });

  it('rejects an unsorted array with an index reason', () => {
    const report = checkCorrectness([3, 1, 2], [3, 1, 2]);
    expect(report.ok).toBe(false);
    expect(report.reason).toContain('not sorted at index');
  });

  it('rejects a length mismatch', () => {
    const report = checkCorrectness([1, 2, 3], [1, 2]);
    expect(report.ok).toBe(false);
    expect(report.reason).toContain('length mismatch');
  });

  it('rejects sorted-but-corrupted data via the sum check', () => {
    const report = checkCorrectness([3, 1, 2], [1, 2, 1003]);
    expect(report.ok).toBe(false);
    expect(report.reason).toContain('sum mismatch');
  });

  it('handles empty arrays', () => {
    expect(checkCorrectness([], []).ok).toBe(true);
  });
});

describe('Benchmark runner (real execution)', () => {
  it('runs a real algorithm and reports success with real counters', async () => {
    const source = generateArray(500, 'random');
    const snapshot = [...source];
    const result = await runAlgorithmOnce('quick', source.slice(), {});
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.comparisons).toBeGreaterThan(0);
    expect(result.operations).toBeGreaterThan(0);
    expect(result.algorithmMs).toBeGreaterThanOrEqual(0);
    expect(source).toEqual(snapshot); // source never mutated
  });

  it('produces the same statistics as the visual pipeline (headless parity)', async () => {
    const source = generateArray(150, 'random');

    const visual = createAlgorithm('quick', baseConfig);
    const gen = visual.sort([...source]);
    while (!gen.next().done) {
      /* drain */
    }
    const visualStats = visual.getStatistics();

    const headless = await runAlgorithmOnce('quick', source.slice(), {});
    expect(headless.comparisons).toBe(visualStats.comparisons);
    expect(headless.swaps).toBe(visualStats.swaps);
    expect(headless.operations).toBe(visualStats.operations);
    expect(headless.arrayAccesses).toBe(visualStats.arrayAccesses);
  });

  it('marks a run failed when the result is not sorted', async () => {
    const result = await runAlgorithmOnce(BROKEN, [3, 1, 2], {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not sorted');
    expect(result.cancelled).toBeUndefined();
  });

  it('marks a run failed when sorted output does not match input values', async () => {
    const result = await runAlgorithmOnce(CORRUPT, [3, 1, 2], {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sum mismatch');
  });

  it('captures a thrown error instead of crashing the benchmark', async () => {
    const result = await runAlgorithmOnce(THROWER, [2, 1], {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('execution error: boom');
  });

  it('supports cooperative cancellation before the run starts', async () => {
    const result = await runAlgorithmOnce('quick', [3, 1, 2], {
      control: { cancelled: true },
    });
    expect(result.cancelled).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('cancels a long-running algorithm mid-chunk', async () => {
    const control = { cancelled: false };
    const result = await runAlgorithmOnce(SLOW, [3, 1, 2], {
      control,
      onChunk: () => {
        control.cancelled = true;
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('fingerprints arrays deterministically', () => {
    expect(arrayFingerprint([1, 2, 3])).toBe(arrayFingerprint([1, 2, 3]));
    expect(arrayFingerprint([1, 2, 3])).not.toBe(arrayFingerprint([1, 2, 4]));
  });
});

describe('Fair comparison (identical clones)', () => {
  it('gives every algorithm and every run an identical copy of the source', async () => {
    const source = generateArray(40, 'reversed');
    const snapshot = [...source];
    const result = await runBenchmark(
      {
        algorithmIds: [REC_A, REC_B],
        dataset: 'reversed',
        size: 40,
        runs: 2,
      },
      source,
      { cancelled: false }
    );

    // 2 algorithms × 2 runs
    expect(RecorderSort.received).toHaveLength(4);
    for (const received of RecorderSort.received) {
      expect(received).toEqual(source); // identical content
    }
    // every run got its own clone (no shared mutable array)
    const uniqueRefs = new Set(RecorderSort.received);
    expect(uniqueRefs.size).toBe(4);
    // source is untouched
    expect(source).toEqual(snapshot);
    expect(result.runs).toHaveLength(4);
    expect(result.runs.every((r) => r.ok)).toBe(true);
  });

  it('stores a fingerprint proving identical input', async () => {
    const source = [5, 4, 3, 2, 1];
    const result = await runBenchmark(
      { algorithmIds: [REC_A], dataset: 'reversed', size: 5, runs: 1 },
      source,
      { cancelled: false }
    );
    expect(result.sourceFingerprint).toBe(arrayFingerprint(source));
    expect(result.sourceLength).toBe(5);
  });

  it('scaling gives all algorithms the same array per size', async () => {
    const result = await runScaling(
      { algorithmIds: [REC_A, REC_B], dataset: 'random', sizes: [30] },
      { cancelled: false }
    );
    expect(RecorderSort.received).toHaveLength(2);
    expect(RecorderSort.received[0]).toEqual(RecorderSort.received[1]);
    expect(result.points).toHaveLength(2);
    expect(result.points.every((p) => p.ok)).toBe(true);
  });
});

describe('Benchmark orchestration', () => {
  it('produces runs for every (algorithm, run) pair with correct run indexes', async () => {
    const result = await runBenchmark(
      { algorithmIds: ['quick', 'merge'], dataset: 'random', size: 60, runs: 3 },
      generateArray(60, 'random'),
      { cancelled: false }
    );
    expect(result.runs).toHaveLength(6);
    for (const id of ['quick', 'merge'] as AlgorithmId[]) {
      const indexes = result.runs
        .filter((r) => r.algorithmId === id)
        .map((r) => r.runIndex)
        .sort((a, b) => a - b);
      expect(indexes).toEqual([0, 1, 2]);
    }
    expect(result.cancelled).toBe(false);
  });

  it('reports monotonic progress up to the total', async () => {
    const progress: number[] = [];
    const result = await runBenchmark(
      { algorithmIds: ['quick', 'heap'], dataset: 'random', size: 40, runs: 2 },
      generateArray(40, 'random'),
      { cancelled: false },
      (p) => progress.push(p.completed)
    );
    expect(result.runs).toHaveLength(4);
    expect(progress.length).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
    expect(progress[progress.length - 1]).toBe(4);
  });

  it('returns immediately as cancelled when the control is pre-cancelled', async () => {
    const result = await runBenchmark(
      { algorithmIds: ['quick'], dataset: 'random', size: 10, runs: 5 },
      generateArray(10, 'random'),
      { cancelled: true }
    );
    expect(result.cancelled).toBe(true);
    expect(result.runs).toHaveLength(0);
  });

  it('keeps partial completed runs when cancelled mid-benchmark', async () => {
    const control = { cancelled: false };
    const result = await runBenchmark(
      { algorithmIds: ['quick'], dataset: 'random', size: 30, runs: 5 },
      generateArray(30, 'random'),
      control,
      () => {
        control.cancelled = true;
      }
    );
    expect(result.cancelled).toBe(true);
    expect(result.runs.length).toBeGreaterThanOrEqual(1);
    expect(result.runs.every((r) => r.ok)).toBe(true);
  });

  it('does not hide failed runs — they stay in the result list', async () => {
    const result = await runBenchmark(
      { algorithmIds: [BROKEN, 'quick'], dataset: 'random', size: 20, runs: 2 },
      generateArray(20, 'random'),
      { cancelled: false }
    );
    expect(result.runs).toHaveLength(4);
    expect(countFailedRuns(result)).toBe(2);
    expect(result.runs.filter((r) => r.algorithmId === BROKEN).every((r) => !r.ok)).toBe(true);
  });

  it('runs the scaling test across sorted sizes', async () => {
    const result = await runScaling(
      { algorithmIds: ['quick', 'merge'], dataset: 'random', sizes: [200, 100] },
      { cancelled: false }
    );
    expect(result.points.map((p) => p.size)).toEqual([100, 100, 200, 200]);
    expect(result.points.every((p) => p.ok)).toBe(true);
  });
});

describe('Statistics (average / min / max / median)', () => {
  it('summarizes odd sample counts', () => {
    const s = summarize([3, 1, 2]);
    expect(s).toEqual({ average: 2, min: 1, max: 3, median: 2, samples: 3 });
  });

  it('averages the two middle values for even sample counts', () => {
    const s = summarize([4, 1, 2, 3]);
    expect(s.median).toBe(2.5);
    expect(s.average).toBe(2.5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(4);
  });

  it('handles empty input safely', () => {
    expect(summarize([])).toEqual({ average: 0, min: 0, max: 0, median: 0, samples: 0 });
  });

  it('splits successful and failed runs', () => {
    const runs = [
      fakeRun('quick', 0, true),
      fakeRun('quick', 1, false),
      fakeRun('quick', 2, true),
    ];
    const { successful, failed } = aggregateRuns(runs);
    expect(successful).toHaveLength(2);
    expect(failed).toHaveLength(1);
  });

  it('keeps every run independent (per-run counters are never merged)', async () => {
    const result = await runBenchmark(
      { algorithmIds: [VARYING], dataset: 'random', size: 10, runs: 4 },
      generateArray(10, 'random'),
      { cancelled: false }
    );
    expect(result.runs.map((r) => r.comparisons)).toEqual([1, 2, 3, 4]);
    const agg = aggregateAlgorithm(VARYING, result.runs);
    expect(agg.metrics?.comparisons.min).toBe(1);
    expect(agg.metrics?.comparisons.max).toBe(4);
    expect(agg.metrics?.comparisons.median).toBe(2.5);
    expect(agg.metrics?.comparisons.average).toBe(2.5);
  });

  it('produces null metrics when every run failed', () => {
    const runs = [fakeRun(BROKEN, 0, false), fakeRun(BROKEN, 1, false)];
    const agg = aggregateAlgorithm(BROKEN, runs);
    expect(agg.metrics).toBeNull();
    expect(agg.failedRuns).toHaveLength(2);
  });

  it('aggregates in config order and counts failures', async () => {
    const result = await runBenchmark(
      { algorithmIds: ['merge', 'quick', BROKEN], dataset: 'random', size: 30, runs: 1 },
      generateArray(30, 'random'),
      { cancelled: false }
    );
    const aggs = aggregateBenchmark(result);
    expect(aggs.map((a) => a.algorithmId)).toEqual(['merge', 'quick', BROKEN]);
    expect(countFailedRuns(result)).toBe(1);
  });
});

describe('Rankings / leaderboard', () => {
  it('ranks by real measured values ascending', () => {
    const rankings = computeRankings([
      fakeAggregate('bubble', 90, 100),
      fakeAggregate('quick', 10, 50),
      fakeAggregate('merge', 30, 70),
    ]);
    expect(rankings.fastest.map((e) => e.algorithmId)).toEqual(['quick', 'merge', 'bubble']);
    expect(rankings.fastest[0].value).toBe(10);
    expect(winnerOf(rankings)).toBe('quick');
  });

  it('excludes fully failed algorithms from every category', () => {
    const rankings = computeRankings([
      fakeAggregate('quick', 10, 50),
      { algorithmId: 'bubble', totalRuns: 1, failedRuns: [fakeRun('bubble', 0, false)], metrics: null },
    ]);
    expect(rankings.fastest).toHaveLength(1);
    expect(rankings.fewestComparisons).toHaveLength(1);
    expect(rankings.fewestSwaps).toHaveLength(1);
    expect(rankings.fewestOperations).toHaveLength(1);
  });

  it('breaks exact ties by algorithm id (stable, deterministic)', () => {
    const rankings = computeRankings([
      fakeAggregate('quick', 5, 5),
      fakeAggregate('heap', 5, 5),
    ]);
    expect(rankings.fastest.map((e) => e.algorithmId)).toEqual(['heap', 'quick']);
  });

  it('computes 1-based rank positions', () => {
    const entries = computeRankings([
      fakeAggregate('quick', 10, 10),
      fakeAggregate('merge', 20, 20),
    ]).fastest;
    expect(rankOf(entries, 'quick')).toBe(1);
    expect(rankOf(entries, 'merge')).toBe(2);
    expect(rankOf(entries, 'bubble')).toBeNull();
  });
});

describe('Smart warnings', () => {
  it('does not warn for light combinations', () => {
    expect(benchmarkWarning(['quick', 'merge', 'heap'], 10000, 3)).toBeNull();
    expect(benchmarkWarning(['bubble'], 5000, 10)).toBeNull();
  });

  it('warns for Bubble Sort at huge sizes', () => {
    const warning = benchmarkWarning(['quick', 'bubble'], 100000, 1);
    expect(warning).not.toBeNull();
    expect(warning!.heavyAlgorithms).toEqual(['bubble']);
    expect(warning!.message).toContain('O(n²)');
    expect(warning!.message).toContain('100,000');
  });

  it('warns for Bubble Sort at 10k only with many runs', () => {
    expect(benchmarkWarning(['bubble'], 10000, 1)).toBeNull();
    expect(benchmarkWarning(['bubble'], 10000, 5)).not.toBeNull();
  });

  it('ignores quadratic risk when Bubble is not selected', () => {
    expect(benchmarkWarning(['quick', 'merge', 'heap'], 100000, 10)).toBeNull();
  });

  it('warns for scaling tests that include Bubble at big sizes', () => {
    expect(scalingWarning(['bubble'], [1000, 10000, 50000])).not.toBeNull();
    expect(scalingWarning(['quick', 'merge'], [1000, 10000, 50000])).toBeNull();
    expect(scalingWarning(['bubble'], [1000, 5000])).toBeNull();
  });
});

describe('Benchmark history (local only)', () => {
  it('adds entries newest-first and respects the cap', () => {
    const history = createBenchmarkHistory(defaultBenchmarkStore(), 3);
    for (let i = 0; i < 5; i++) history.add(entry(`id-${i}`));
    expect(history.size()).toBe(3);
    expect(history.list().map((e) => e.id)).toEqual(['id-4', 'id-3', 'id-2']);
  });

  it('persists across instances sharing one store', () => {
    const store = defaultBenchmarkStore();
    const first = createBenchmarkHistory(store);
    first.add(entry('persisted'));
    const second = createBenchmarkHistory(store);
    expect(second.size()).toBe(1);
    expect(second.list()[0].id).toBe('persisted');
  });

  it('clears everything', () => {
    const history = createBenchmarkHistory(defaultBenchmarkStore());
    history.add(entry('x'));
    history.clear();
    expect(history.size()).toBe(0);
    expect(history.list()).toEqual([]);
  });

  it('tolerates corrupted JSON', () => {
    const store = defaultBenchmarkStore();
    store.setItem(BENCHMARK_HISTORY_KEY, '{not json');
    const history = createBenchmarkHistory(store);
    expect(history.list()).toEqual([]);
  });

  it('tolerates a non-array payload', () => {
    const store = defaultBenchmarkStore();
    store.setItem(BENCHMARK_HISTORY_KEY, '{"hello":1}');
    expect(createBenchmarkHistory(store).list()).toEqual([]);
  });

  it('keeps working when storage throws on read/write', () => {
    const failing = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('quota');
      },
    };
    const history = createBenchmarkHistory(failing);
    expect(history.list()).toEqual([]);
    expect(history.add(entry('a'))).toHaveLength(1); // in-memory copy survives
    expect(history.size()).toBe(1);
  });

  it('never exceeds the default cap in real usage', () => {
    const history = createBenchmarkHistory(defaultBenchmarkStore());
    for (let i = 0; i < MAX_BENCHMARK_HISTORY_ENTRIES + 5; i++) history.add(entry(`e${i}`));
    expect(history.size()).toBeLessThanOrEqual(MAX_BENCHMARK_HISTORY_ENTRIES);
  });

  it('builds entries from result fields', () => {
    const built = historyEntryFromResult({
      id: 'bench-1',
      timestamp: 123,
      mode: 'benchmark',
      algorithmIds: ['quick', 'merge'],
      dataset: 'random',
      sizes: [10000],
      runs: 5,
      bestAlgorithmId: 'quick',
      bestTimeMs: 842,
      failedCount: 0,
    });
    expect(built.bestAlgorithmId).toBe('quick');
    expect(built.runs).toBe(5);
  });
});

describe('CSV export', () => {
  it('emits a header and one row per algorithm', async () => {
    const result = await smallResult();
    const csv = benchmarkToCSV(result);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('Algorithm,Dataset,Size');
    expect(lines).toHaveLength(1 + 2); // header + 2 algorithms
    expect(lines[1]).toContain('Quick Sort');
    expect(lines[1]).toContain('OK');
  });

  it('marks failed algorithms FAILED with empty metrics', async () => {
    const result = await runBenchmark(
      { algorithmIds: [BROKEN], dataset: 'random', size: 20, runs: 1 },
      generateArray(20, 'random'),
      { cancelled: false }
    );
    const csv = benchmarkToCSV(result);
    expect(csv).toContain('FAILED');
    const row = csv.trim().split('\n')[1].split(',');
    expect(row[row.length - 1]).toBe('FAILED');
  });

  it('escapes quotes, commas and newlines per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(8.426)).toBe('8.426');
  });

  it('emits scaling rows sorted by size', async () => {
    const result = await runScaling(
      { algorithmIds: ['quick'], dataset: 'random', sizes: [150, 50] },
      { cancelled: false }
    );
    const lines = scalingToCSV(result).trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',50,');
    expect(lines[2]).toContain(',150,');
  });
});

describe('JSON export', () => {
  it('produces a structured, parseable document', async () => {
    const result = await smallResult();
    const doc = buildExportDocument(result);
    expect(doc.tool).toContain('Benchmark Lab');
    expect(doc.mode).toBe('benchmark');
    expect(doc.config.runs).toBe(1);
    expect(doc.aggregates).toHaveLength(2);
    expect(doc.rankings.fastest).toHaveLength(2);
    expect(doc.runs).toHaveLength(2);

    const parsed = JSON.parse(benchmarkToJSON(result));
    expect(parsed.config.size).toBe(200);
    expect(parsed.aggregates[0].algorithmId).toBe('quick');
  });

  it('exports scaling results as JSON', async () => {
    const result = await runScaling(
      { algorithmIds: ['quick'], dataset: 'random', sizes: [50] },
      { cancelled: false }
    );
    const parsed = JSON.parse(scalingToJSON(result));
    expect(parsed.mode).toBe('scaling');
    expect(parsed.points).toHaveLength(1);
    expect(parsed.points[0].ok).toBe(true);
  });
});

describe('Text report (COPY RESULTS)', () => {
  it('formats config and ranked algorithm lines', async () => {
    const result = await smallResult();
    const report = formatTextReport(result);
    expect(report).toContain('Sorting Visualizer Benchmark');
    expect(report).toContain('Dataset: Random');
    expect(report).toContain('Elements: 200');
    expect(report).toContain('Runs: 1');
    expect(report).toMatch(/1\. (Quick Sort|Merge Sort) — /);
    expect(report).toContain('Measured algorithm time');
  });

  it('flags cancelled runs', async () => {
    const result: BenchmarkResult = {
      id: 'b',
      createdAt: Date.now(),
      config: { algorithmIds: ['quick'], dataset: 'random', size: 10, runs: 1 },
      sourceFingerprint: 0,
      sourceLength: 10,
      runs: [],
      cancelled: true,
    };
    expect(formatTextReport(result)).toContain('CANCELLED');
  });

  it('formats durations for humans', () => {
    expect(formatDuration(8420)).toBe('8.42 s');
    expect(formatDuration(42.34)).toBe('42.3 ms');
    expect(formatDuration(0)).toBe('0.0 ms');
  });
});

describe('Chart series', () => {
  it('builds per-run lines and skips failed runs', async () => {
    const result = await smallResult();
    const series = runsChartSeries(result, 'algorithmMs');
    expect(series).toHaveLength(2);
    for (const s of series) {
      expect(s.points).toHaveLength(1);
      expect(s.points[0].x).toBe(1);
      expect(s.points[0].y).toBeGreaterThanOrEqual(0);
    }

    const withFailure = await runBenchmark(
      { algorithmIds: [BROKEN, 'quick'], dataset: 'random', size: 20, runs: 2 },
      generateArray(20, 'random'),
      { cancelled: false }
    );
    const brokenSeries = runsChartSeries(withFailure, 'comparisons').find(
      (s) => s.algorithmId === BROKEN
    );
    expect(brokenSeries?.points).toHaveLength(0); // no fabricated points
  });

  it('builds scaling lines sorted by size', async () => {
    const result = await runScaling(
      { algorithmIds: ['quick'], dataset: 'random', sizes: [100, 50, 150] },
      { cancelled: false }
    );
    const series = scalingChartSeries(result, 'algorithmMs');
    expect(series[0].points.map((p) => p.x)).toEqual([50, 100, 150]);
  });

  it('builds a benchmark view with aggregates and rankings together', async () => {
    const view = buildBenchmarkView(await smallResult());
    expect(view.aggregates).toHaveLength(2);
    expect(view.rankings.fastest).toHaveLength(2);
  });
});

describe('Dataset analysis (all values real)', () => {
  it('counts inversions exactly on known arrays', () => {
    expect(countInversions([1, 2, 3])).toBe(0);
    expect(countInversions([2, 1])).toBe(1);
    expect(countInversions([3, 1, 2])).toBe(2);
    expect(countInversions([2, 2, 1])).toBe(2);
  });

  it('matches the closed form for a fully reversed array', () => {
    const reversed = generateArray(1000, 'reversed');
    expect(countInversions(reversed)).toBe((1000 * 999) / 2);
  });

  it('describes a reversed dataset as 0% ascending / 100% descending', () => {
    const stats = analyzeDataset(generateArray(500, 'reversed'));
    expect(stats.ascendingFraction).toBe(0);
    expect(stats.descendingFraction).toBe(1);
    expect(stats.disorderFraction).toBe(1);
    expect(stats.inversions).toBe((500 * 499) / 2);
    expect(stats.uniqueCount).toBe(500);
  });

  it('describes an almost sorted dataset as mostly ascending', () => {
    const stats = analyzeDataset(generateArray(1000, 'nearly-sorted'));
    expect(stats.ascendingFraction).toBeGreaterThan(0.7);
    expect(stats.disorderFraction).toBeLessThan(0.3);
    expect(stats.inversions).toBeLessThan((1000 * 999) / 4);
  });

  it('describes a sorted array as disorder-free', () => {
    const stats = analyzeDataset([1, 2, 3, 4]);
    expect(stats.ascendingFraction).toBe(1);
    expect(stats.disorderFraction).toBe(0);
    expect(stats.inversions).toBe(0);
  });

  it('counts unique values for few-unique datasets', () => {
    const stats = analyzeDataset(generateArray(1000, 'few-unique'));
    expect(stats.uniqueCount).toBeLessThanOrEqual(100);
    expect(stats.uniqueCount).toBeGreaterThan(1);
  });

  it('handles single-element and empty arrays', () => {
    expect(analyzeDataset([7])).toMatchObject({
      count: 1,
      ascendingFraction: 1,
      inversions: 0,
      uniqueCount: 1,
    });
    expect(analyzeDataset([]).count).toBe(0);
    expect(countInversions([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------

function fakeRun(algorithmId: AlgorithmId, runIndex: number, ok: boolean): AlgorithmRunResult {
  return {
    algorithmId,
    runIndex,
    ok,
    algorithmMs: ok ? 10 : 0,
    comparisons: ok ? 5 : 0,
    swaps: ok ? 3 : 0,
    operations: ok ? 8 : 0,
    arrayAccesses: ok ? 12 : 0,
    ...(ok ? {} : { error: 'not sorted' }),
  };
}

function fakeAggregate(algorithmId: AlgorithmId, ms: number, comparisons: number) {
  const run = fakeRun(algorithmId, 0, true);
  return aggregateAlgorithm(algorithmId, [{ ...run, algorithmMs: ms, comparisons }]);
}

function entry(id: string): BenchmarkHistoryEntry {
  return {
    id,
    timestamp: Date.now(),
    mode: 'benchmark',
    algorithmIds: ['quick'],
    dataset: 'random',
    sizes: [10000],
    runs: 1,
    bestAlgorithmId: 'quick',
    bestTimeMs: 10,
    failedCount: 0,
  };
}

async function smallResult(): Promise<BenchmarkResult> {
  return runBenchmark(
    { algorithmIds: ['quick', 'merge'], dataset: 'random', size: 200, runs: 1 },
    generateArray(200, 'random'),
    { cancelled: false }
  );
}
