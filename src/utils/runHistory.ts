/**
 * In-session run history (browser session only — no backend, no database).
 *
 * The storage is injected, so tests can pass a plain object and the app
 * passes sessionStorage. Corrupted or unavailable storage degrades to an
 * empty history instead of throwing.
 */

import type { RunHistoryEntry } from '../types';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const HISTORY_STORAGE_KEY = 'sorting-visualizer:run-history';
export const MAX_HISTORY_ENTRIES = 8;

export interface RunHistory {
  add(entry: RunHistoryEntry): RunHistoryEntry[];
  list(): RunHistoryEntry[];
  clear(): void;
  size(): number;
}

export function createRunHistory(
  store: KeyValueStore,
  maxEntries: number = MAX_HISTORY_ENTRIES
): RunHistory {
  const load = (): RunHistoryEntry[] => {
    try {
      const raw = store.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as RunHistoryEntry[]) : [];
    } catch {
      return [];
    }
  };

  let entries: RunHistoryEntry[] = load();

  const persist = (): void => {
    try {
      store.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage full or unavailable (e.g. private mode): history simply
      // stays in memory for this session.
    }
  };

  return {
    add(entry: RunHistoryEntry): RunHistoryEntry[] {
      // Newest first, hard cap — the list can never grow unbounded.
      entries = [entry, ...entries].slice(0, maxEntries);
      persist();
      return [...entries];
    },
    list(): RunHistoryEntry[] {
      return [...entries];
    },
    clear(): void {
      entries = [];
      persist();
    },
    size(): number {
      return entries.length;
    },
  };
}
