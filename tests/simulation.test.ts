import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OperationStream } from '../src/simulation/operationStream';
import { AnimationScheduler } from '../src/simulation/scheduler';
import { generateArray } from '../src/simulation/dataGenerator';
import { initializeAlgorithms } from '../src/algorithms';
import type { SortConfig } from '../src/types';

initializeAlgorithms();

// Mock requestAnimationFrame for node environment
const rafCallbacks = new Map<number, (time: number) => void>();
let rafId = 0;
let rafTime = 0;

beforeAll(() => {
  (globalThis as any).requestAnimationFrame = (cb: (time: number) => void): number => {
    const id = ++rafId;
    rafCallbacks.set(id, cb);
    return id;
  };
  (globalThis as any).cancelAnimationFrame = (id: number): void => {
    rafCallbacks.delete(id);
  };
});

afterAll(() => {
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
});

function flushRafFrames(count: number): void {
  for (let i = 0; i < count; i++) {
    rafTime += 16.67;
    const callbacks = Array.from(rafCallbacks.values());
    rafCallbacks.clear();
    for (const cb of callbacks) {
      cb(rafTime);
    }
  }
}

/**
 * Runs an OperationStream to completion and collects all emitted operations.
 */
function runStream(
  algorithmId: string,
  array: number[]
): Promise<{
  finalArray: number[];
  operations: { type: string; indices: number[] }[];
  stats: any;
  error?: Error;
}> {
  return new Promise((resolve) => {
    const config: SortConfig = {
      algorithm: algorithmId as SortConfig['algorithm'],
      elementCount: array.length,
      visualizationMode: 'cubes',
      speed: 1,
      dataDistribution: 'random',
      soundEnabled: false,
    };
    const stream = new OperationStream(config);
    const operations: { type: string; indices: number[] }[] = [];
    let error: Error | undefined;

    stream.onBatch((batch) => {
      operations.push(...batch.operations);
    });

    stream.onComplete((finalArray, stats) => {
      resolve({ finalArray, operations, stats, error });
    });

    stream.onError((err) => {
      error = err;
      resolve({ finalArray: [], operations, stats: null, error });
    });

    stream.start(array);
  });
}

const baseConfig: SortConfig = {
  algorithm: 'quick',
  elementCount: 100,
  visualizationMode: 'cubes',
  speed: 1,
  dataDistribution: 'random',
  soundEnabled: false,
};

function isSorted(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1] > arr[i]) return false;
  }
  return true;
}

describe('OperationStream', () => {
  it('generates real compare and swap operations for bubble sort', async () => {
    const array = [5, 3, 8, 1, 2];
    const result = await runStream('bubble', array);

    expect(result.error).toBeUndefined();
    const types = new Set(result.operations.map((op) => op.type));
    expect(types.has('compare')).toBe(true);
    expect(types.has('swap')).toBe(true);

    expect(result.stats.comparisons).toBeGreaterThan(0);
    expect(result.stats.swaps).toBeGreaterThan(0);
    expect(result.stats.operations).toBeGreaterThan(0);
    expect(isSorted(result.finalArray)).toBe(true);
  });

  it('generates pivot, compare and swap operations for quick sort', async () => {
    const array = generateArray(50, 'random');
    const result = await runStream('quick', array);

    expect(result.error).toBeUndefined();
    const types = new Set(result.operations.map((op) => op.type));
    expect(types.has('pivot')).toBe(true);
    expect(types.has('compare')).toBe(true);
    expect(types.has('swap')).toBe(true);

    expect(result.stats.comparisons).toBeGreaterThan(0);
    expect(isSorted(result.finalArray)).toBe(true);
  });

  it('generates merge, compare and overwrite operations for merge sort', async () => {
    const array = generateArray(50, 'random');
    const result = await runStream('merge', array);

    expect(result.error).toBeUndefined();
    const types = new Set(result.operations.map((op) => op.type));
    expect(types.has('merge')).toBe(true);
    expect(types.has('compare')).toBe(true);
    expect(types.has('overwrite')).toBe(true);

    expect(result.stats.comparisons).toBeGreaterThan(0);
    expect(isSorted(result.finalArray)).toBe(true);
  });

  it('generates heapify, compare and swap operations for heap sort', async () => {
    const array = generateArray(50, 'random');
    const result = await runStream('heap', array);

    expect(result.error).toBeUndefined();
    const types = new Set(result.operations.map((op) => op.type));
    expect(types.has('heapify')).toBe(true);
    expect(types.has('compare')).toBe(true);
    expect(types.has('swap')).toBe(true);

    expect(result.stats.comparisons).toBeGreaterThan(0);
    expect(isSorted(result.finalArray)).toBe(true);
  });

  it('counts statistics proportional to array size', async () => {
    const small = await runStream('quick', generateArray(50, 'random'));
    const large = await runStream('quick', generateArray(500, 'random'));

    expect(large.stats.comparisons).toBeGreaterThan(small.stats.comparisons);
    expect(large.stats.operations).toBeGreaterThan(small.stats.operations);
  });

  it('stop() halts the stream and prevents old operations', async () => {
    const config = { ...baseConfig, algorithm: 'bubble' as const };
    const stream = new OperationStream(config);
    // Large enough that the sort cannot finish inside a single generation hop
    const array = generateArray(3000, 'random');

    let completed = false;
    stream.onComplete(() => { completed = true; });

    stream.start(array);
    expect(stream.isActive()).toBe(true);
    stream.stop();

    let batchesAfterStop = 0;
    stream.onBatch(() => { batchesAfterStop++; });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(completed).toBe(false);
    expect(stream.isActive()).toBe(false);
    expect(batchesAfterStop).toBe(0);
  });

  it('pause/resume works correctly', async () => {
    const config = { ...baseConfig, algorithm: 'quick' as const };
    const stream = new OperationStream(config);
    // Multi-hop sort: 10000 elements cannot be quick-sorted inside one 8ms hop
    const array = generateArray(10000, 'random');

    const completion = new Promise<void>((resolve) => {
      stream.onComplete(() => resolve());
    });

    // Pause from inside the first batch — guarantees mid-flight pause
    let firstBatch = true;
    stream.onBatch(() => {
      if (firstBatch) {
        firstBatch = false;
        stream.pause();
      }
    });

    stream.start(array);
    stream.pause();
    expect(stream.isPausedState()).toBe(true);

    const statsWhilePaused = stream.getStatistics().operations;
    await new Promise((resolve) => setTimeout(resolve, 100));
    // No progress while paused
    expect(stream.getStatistics().operations).toBe(statsWhilePaused);
    expect(stream.isPausedState()).toBe(true);

    stream.resume();
    expect(stream.isPausedState()).toBe(false);

    await completion;
    expect(stream.isActive()).toBe(false);
    expect(isSorted(stream.getCurrentArray())).toBe(true);
  }, 15000);
});

describe('AnimationScheduler', () => {
  it('batches operations and calls onUpdate until completion', async () => {
    const config = { ...baseConfig, algorithm: 'quick' as const };
    const stream = new OperationStream(config);
    const scheduler = new AnimationScheduler(stream, {
      targetFPS: 60,
      maxOperationsPerFrame: 1000,
      speedMultiplier: 10,
    });

    const array = generateArray(100, 'random');
    let updateCount = 0;
    let completed = false;

    scheduler.onUpdate((_ops, _arr, _stats, isComplete) => {
      updateCount++;
      if (isComplete) completed = true;
    });

    scheduler.start(array);

    const deadline = Date.now() + 8000;
    while (!completed && Date.now() < deadline) {
      flushRafFrames(5);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(completed).toBe(true);
    expect(updateCount).toBeGreaterThan(0);
    scheduler.stop();
  }, 12000);

  it('stop() cancels the animation loop and clears pending work', () => {
    const config = { ...baseConfig, algorithm: 'quick' as const };
    const stream = new OperationStream(config);
    const scheduler = new AnimationScheduler(stream, {
      targetFPS: 60,
      maxOperationsPerFrame: 100,
      speedMultiplier: 1,
    });

    const array = generateArray(100, 'random');
    scheduler.start(array);
    scheduler.stop();

    expect(scheduler.isRunning()).toBe(false);
  });

  it('does not create duplicate animation loops across restarts', async () => {
    const config = { ...baseConfig, algorithm: 'bubble' as const };
    const stream = new OperationStream(config);
    const scheduler = new AnimationScheduler(stream, {
      targetFPS: 60,
      maxOperationsPerFrame: 1000,
      speedMultiplier: 10,
    });

    const array = generateArray(50, 'random');

    let updates = 0;
    let currentRun: 1 | 2 = 1;
    let run1FinalOps = 0;
    let run2FinalOps = 0;
    scheduler.onUpdate((_ops, _arr, stats, isComplete) => {
      updates++;
      if (isComplete) {
        if (currentRun === 1) run1FinalOps = stats.operations;
        else run2FinalOps = stats.operations;
      }
    });

    // First run
    scheduler.start(array);
    const deadline1 = Date.now() + 5000;
    while (scheduler.isRunning() && Date.now() < deadline1) {
      flushRafFrames(3);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const run1Updates = updates;
    if (run1FinalOps === 0) run1FinalOps = scheduler.getStatistics().operations;
    scheduler.stop();

    // Second run after stop/reset
    updates = 0;
    currentRun = 2;
    scheduler.start(generateArray(50, 'random'));
    const deadline2 = Date.now() + 5000;
    while (scheduler.isRunning() && Date.now() < deadline2) {
      flushRafFrames(3);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const run2Updates = updates;
    if (run2FinalOps === 0) run2FinalOps = scheduler.getStatistics().operations;
    scheduler.stop();

    expect(run1Updates).toBeGreaterThan(0);
    expect(run2Updates).toBeGreaterThan(0);
    // Statistics must reset between runs: run2 final ops should be in the same
    // ballpark as run1 (not run1 + run2 accumulated).
    expect(run2FinalOps).toBeGreaterThan(0);
    expect(run2FinalOps).toBeLessThan(run1FinalOps * 1.5);
  }, 15000);
});

describe('DataGenerator', () => {
  it('generates random distribution', () => {
    const arr = generateArray(100, 'random');
    expect(arr.length).toBe(100);
    const sorted = [...arr].sort((a, b) => a - b);
    expect(sorted[0]).toBe(1);
    expect(sorted[99]).toBe(100);
  });

  it('generates nearly-sorted distribution', () => {
    const arr = generateArray(100, 'nearly-sorted');
    expect(arr.length).toBe(100);
  });

  it('generates reversed distribution', () => {
    const arr = generateArray(100, 'reversed');
    expect(arr.length).toBe(100);
    expect(arr[0]).toBe(100);
    expect(arr[99]).toBe(1);
  });

  it('generates few-unique distribution', () => {
    const arr = generateArray(100, 'few-unique');
    expect(arr.length).toBe(100);
    const unique = new Set(arr);
    expect(unique.size).toBeLessThan(20);
  });
});