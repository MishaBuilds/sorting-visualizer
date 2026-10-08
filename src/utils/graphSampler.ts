/**
 * Bounded, interval-gated sampling for the live performance graph.
 *
 * Pure functions: time is always passed in explicitly, so behaviour is
 * deterministic and unit-testable without timers. The stored series can
 * never grow past `maxPoints` (no memory leak over long runs), and points
 * are collected at most every `intervalMs` (the graph is never rebuilt
 * for every internal operation).
 */

export interface SamplePoint<T> {
  t: number;
  values: T;
}

export interface SamplerOptions {
  /** Minimum milliseconds between stored samples. */
  intervalMs?: number;
  /** Hard cap on stored points; older points are decimated to fit. */
  maxPoints?: number;
}

/**
 * Evenly decimate a series down to `maxPoints`, always keeping the
 * first and the last point so the curve keeps its full time span.
 */
export function downsample<T>(points: readonly SamplePoint<T>[], maxPoints: number): SamplePoint<T>[] {
  if (maxPoints < 2) return points.slice(-1);
  if (points.length <= maxPoints) return [...points];

  const result: SamplePoint<T>[] = [];
  const lastIndex = points.length - 1;
  const step = lastIndex / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.round(i * step)]);
  }
  result[result.length - 1] = points[lastIndex];
  return result;
}

export interface SeriesSampler<T> {
  /** Returns true when the point was stored (false when gated/capped away). */
  push(t: number, values: T): boolean;
  points(): SamplePoint<T>[];
  size(): number;
  last(): SamplePoint<T> | null;
  reset(): void;
}

export function createSeriesSampler<T>(options: SamplerOptions = {}): SeriesSampler<T> {
  const intervalMs = options.intervalMs ?? 150;
  const maxPoints = options.maxPoints ?? 150;

  let points: SamplePoint<T>[] = [];
  let lastT = Number.NEGATIVE_INFINITY;

  return {
    push(t: number, values: T): boolean {
      if (points.length > 0 && t - lastT < intervalMs) return false;
      points.push({ t, values });
      lastT = t;
      if (points.length > maxPoints) {
        points = downsample(points, maxPoints);
      }
      return true;
    },
    points(): SamplePoint<T>[] {
      return [...points];
    },
    size(): number {
      return points.length;
    },
    last(): SamplePoint<T> | null {
      return points.length > 0 ? points[points.length - 1] : null;
    },
    reset(): void {
      points = [];
      lastT = Number.NEGATIVE_INFINITY;
    },
  };
}
