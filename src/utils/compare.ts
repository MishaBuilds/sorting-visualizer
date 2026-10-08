/**
 * Pure Compare Mode helpers: selection validation, the shared input
 * array, winner computation from real measurements, and the viewport
 * grid layout. No DOM, no WebGL — fully unit-testable.
 */

import type { AlgorithmId, CompareResult, CompareVerdicts, LaneRect } from '../types';

export const COMPARE_MIN_ALGORITHMS = 2;
export const COMPARE_MAX_ALGORITHMS = 4;

export interface SelectionValidation {
  ok: boolean;
  error?: string;
}

export function validateSelection(ids: AlgorithmId[]): SelectionValidation {
  if (ids.length < COMPARE_MIN_ALGORITHMS) {
    return { ok: false, error: `Select at least ${COMPARE_MIN_ALGORITHMS} algorithms` };
  }
  if (ids.length > COMPARE_MAX_ALGORITHMS) {
    return { ok: false, error: `Select at most ${COMPARE_MAX_ALGORITHMS} algorithms` };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'Each algorithm may be selected only once' };
  }
  return { ok: true };
}

/**
 * Every compared algorithm gets its own independent copy of the *same*
 * base array — identical input, no shared mutable state.
 */
export function prepareSharedArray(
  base: readonly number[],
  ids: readonly AlgorithmId[]
): Map<AlgorithmId, number[]> {
  const map = new Map<AlgorithmId, number[]>();
  for (const id of ids) {
    map.set(id, [...base]);
  }
  return map;
}

/**
 * Winners computed exclusively from the real measurements of a compare
 * run. Ties resolve deterministically to the first result in input order.
 */
export function computeVerdicts(results: readonly CompareResult[]): CompareVerdicts | null {
  if (results.length < COMPARE_MIN_ALGORITHMS) return null;

  let fastest = results[0];
  let fewest = results[0];
  let most = results[0];

  for (let i = 1; i < results.length; i++) {
    const r = results[i];
    if (r.elapsedMs < fastest.elapsedMs) fastest = r;
    if (r.comparisons < fewest.comparisons) fewest = r;
    if (r.operations > most.operations) most = r;
  }

  return {
    fastest: fastest.algorithmId,
    fewestComparisons: fewest.algorithmId,
    mostOperations: most.algorithmId,
  };
}

export interface LaneLayout {
  lanes: LaneRect[];
  /** The unused grid cell (used as a summary placeholder), if any. */
  emptyCell: LaneRect | null;
  rows: number;
  cols: number;
}

/**
 * Split a canvas into `count` viewport lanes (top-left origin, CSS px).
 * 2 lanes → 1×2 split; 3–4 lanes → 2×2 grid with the leftover cell
 * free for the live summary.
 */
export function computeLaneLayout(
  count: number,
  width: number,
  height: number,
  gap = 6
): LaneLayout {
  const n = Math.max(COMPARE_MIN_ALGORITHMS, Math.min(count, COMPARE_MAX_ALGORITHMS));
  const rows = n <= 2 ? 1 : 2;
  const cols = n <= 1 ? 1 : 2;

  const cellW = width / cols;
  const cellH = height / rows;
  const lanes: LaneRect[] = [];

  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    lanes.push({
      x: c * cellW + gap / 2,
      y: r * cellH + gap / 2,
      w: Math.max(1, cellW - gap),
      h: Math.max(1, cellH - gap),
    });
  }

  let emptyCell: LaneRect | null = null;
  const totalCells = rows * cols;
  if (n < totalCells) {
    const idx = n;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    emptyCell = {
      x: c * cellW + gap / 2,
      y: r * cellH + gap / 2,
      w: Math.max(1, cellW - gap),
      h: Math.max(1, cellH - gap),
    };
  }

  return { lanes, emptyCell, rows, cols };
}
