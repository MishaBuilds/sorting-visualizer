/**
 * Local storage for benchmark history — browser only (localStorage with
 * sessionStorage/in-memory fallback). No backend, no network.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const BENCHMARK_HISTORY_KEY = 'sorting-visualizer:benchmark-history';
export const MAX_BENCHMARK_HISTORY_ENTRIES = 10;

/** Probe storage availability; degrade to a silent in-memory store. */
export function defaultBenchmarkStore(): KeyValueStore {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('sorting-visualizer:probe', '1');
      window.localStorage.removeItem('sorting-visualizer:probe');
      return window.localStorage;
    }
  } catch {
    // private mode / storage disabled — fall through
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
  };
}
