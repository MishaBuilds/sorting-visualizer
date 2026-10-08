/**
 * Rankings / leaderboard — derived exclusively from aggregated REAL
 * measurements. Algorithms whose every run failed never appear here.
 */

import type { AlgorithmId } from '../types';
import type { AlgorithmAggregate, BenchmarkRankings, RankedEntry, RankingKey } from './types';

function rankBy(
  aggregates: AlgorithmAggregate[],
  pick: (a: NonNullable<AlgorithmAggregate['metrics']>) => number
): RankedEntry[] {
  const entries: RankedEntry[] = [];
  for (const agg of aggregates) {
    if (!agg.metrics) continue; // failed algorithms are excluded from rankings
    entries.push({ algorithmId: agg.algorithmId, value: pick(agg.metrics) });
  }
  // Ascending — the smallest real value wins; name breaks ties stably.
  entries.sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    return a.algorithmId.localeCompare(b.algorithmId);
  });
  return entries;
}

export function computeRankings(aggregates: AlgorithmAggregate[]): BenchmarkRankings {
  return {
    fastest: rankBy(aggregates, (m) => m.algorithmMs.average),
    fewestComparisons: rankBy(aggregates, (m) => m.comparisons.average),
    fewestOperations: rankBy(aggregates, (m) => m.operations.average),
    fewestSwaps: rankBy(aggregates, (m) => m.swaps.average),
  };
}

export function winnerOf(rankings: BenchmarkRankings): AlgorithmId | null {
  return rankings.fastest[0]?.algorithmId ?? null;
}

/** Rank position (1-based) of an algorithm in a category, or null. */
export function rankOf(entries: RankedEntry[], algorithmId: AlgorithmId): number | null {
  const idx = entries.findIndex((e) => e.algorithmId === algorithmId);
  return idx === -1 ? null : idx + 1;
}

export const RANKING_LABELS: Record<RankingKey, string> = {
  fastest: 'FASTEST',
  fewestComparisons: 'FEWEST COMPARISONS',
  fewestOperations: 'FEWEST OPERATIONS',
  fewestSwaps: 'FEWEST SWAPS',
};
