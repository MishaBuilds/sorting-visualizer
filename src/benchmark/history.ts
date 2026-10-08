/**
 * Benchmark history — session-local list of benchmark/scaling sessions.
 *
 * Tolerates corrupted JSON and failing storage (degrades to memory).
 * Hard-capped so localStorage can never grow without bound.
 */

import type { BenchmarkHistoryEntry } from './types';
import {
  BENCHMARK_HISTORY_KEY,
  MAX_BENCHMARK_HISTORY_ENTRIES,
  type KeyValueStore,
} from './storage';

export interface BenchmarkHistory {
  add(entry: BenchmarkHistoryEntry): BenchmarkHistoryEntry[];
  list(): BenchmarkHistoryEntry[];
  clear(): void;
  size(): number;
}

export function createBenchmarkHistory(
  store: KeyValueStore,
  maxEntries: number = MAX_BENCHMARK_HISTORY_ENTRIES
): BenchmarkHistory {
  const load = (): BenchmarkHistoryEntry[] => {
    try {
      const raw = store.getItem(BENCHMARK_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as BenchmarkHistoryEntry[]) : [];
    } catch {
      return [];
    }
  };

  let entries = load();

  const persist = (): void => {
    try {
      store.setItem(BENCHMARK_HISTORY_KEY, JSON.stringify(entries));
    } catch {
      // quota / private mode — keep the in-memory copy for this session
    }
  };

  return {
    add(entry) {
      entries = [entry, ...entries].slice(0, maxEntries);
      persist();
      return [...entries];
    },
    list() {
      return [...entries];
    },
    clear() {
      entries = [];
      persist();
    },
    size() {
      return entries.length;
    },
  };
}

/** Build a history entry from a finished benchmark result. */
export function historyEntryFromResult(input: {
  id: string;
  timestamp: number;
  mode: 'benchmark' | 'scaling';
  algorithmIds: BenchmarkHistoryEntry['algorithmIds'];
  dataset: BenchmarkHistoryEntry['dataset'];
  sizes: number[];
  runs: number;
  bestAlgorithmId: BenchmarkHistoryEntry['bestAlgorithmId'];
  bestTimeMs: BenchmarkHistoryEntry['bestTimeMs'];
  failedCount: number;
}): BenchmarkHistoryEntry {
  return { ...input };
}
