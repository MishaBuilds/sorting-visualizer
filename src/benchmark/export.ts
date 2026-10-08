/**
 * Export results — CSV (Excel/Sheets friendly), structured JSON and a
 * plain-text report for the clipboard. Everything is generated locally;
 * nothing is sent anywhere.
 */

import type { AlgorithmId, DataDistribution } from '../types';
import type {
  AlgorithmAggregate,
  BenchmarkRankings,
  BenchmarkResult,
  ScalingResult,
} from './types';
import { aggregateBenchmark } from './statistics';
import { computeRankings } from './ranking';

export const ALGORITHM_NAMES: Record<AlgorithmId, string> = {
  bubble: 'Bubble Sort',
  quick: 'Quick Sort',
  merge: 'Merge Sort',
  heap: 'Heap Sort',
};

export const DATASET_NAMES: Record<DataDistribution, string> = {
  random: 'Random',
  'nearly-sorted': 'Nearly Sorted',
  reversed: 'Reversed',
  'few-unique': 'Few Unique',
};

/** Display name for any algorithm id (unknown ids pass through untouched). */
export function algorithmName(id: AlgorithmId): string {
  return ALGORITHM_NAMES[id] ?? String(id);
}

/** Escape a CSV cell per RFC 4180 (quotes doubled, wrapped when needed). */
export function csvCell(value: string | number): string {
  const s = typeof value === 'number' ? formatNumberForCsv(value) : value;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatNumberForCsv(value: number): string {
  if (Number.isFinite(value)) {
    // Keep full precision for counters; round only fractional seconds.
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  }
  return String(value);
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(',');
}

function seconds(ms: number): number {
  return Math.round((ms / 1000) * 1000) / 1000;
}

/** One row per algorithm: aggregate over successful runs + failure info. */
export function benchmarkToCSV(result: BenchmarkResult, aggregates?: AlgorithmAggregate[]): string {
  const aggs = aggregates ?? aggregateBenchmark(result);
  const lines: string[] = [];
  lines.push(
    csvRow([
      'Algorithm',
      'Dataset',
      'Size',
      'Runs Planned',
      'Runs OK',
      'Runs Failed',
      'Avg Time (s)',
      'Min Time (s)',
      'Max Time (s)',
      'Median Time (s)',
      'Avg Comparisons',
      'Avg Swaps',
      'Avg Operations',
      'Avg Array Accesses',
      'Status',
    ])
  );
  for (const agg of aggs) {
    const okRuns = agg.totalRuns - agg.failedRuns.length;
    const m = agg.metrics;
    lines.push(
      csvRow([
        algorithmName(agg.algorithmId),
        DATASET_NAMES[result.config.dataset],
        result.config.size,
        result.config.runs,
        okRuns,
        agg.failedRuns.length,
        m ? seconds(m.algorithmMs.average) : '',
        m ? seconds(m.algorithmMs.min) : '',
        m ? seconds(m.algorithmMs.max) : '',
        m ? seconds(m.algorithmMs.median) : '',
        m ? Math.round(m.comparisons.average) : '',
        m ? Math.round(m.swaps.average) : '',
        m ? Math.round(m.operations.average) : '',
        m ? Math.round(m.arrayAccesses.average) : '',
        m ? 'OK' : agg.failedRuns.length > 0 ? 'FAILED' : 'NOT RUN',
      ])
    );
  }
  return lines.join('\n') + '\n';
}

/** One row per (algorithm, size) measurement. */
export function scalingToCSV(result: ScalingResult): string {
  const lines: string[] = [];
  lines.push(
    csvRow([
      'Algorithm',
      'Dataset',
      'Size',
      'Time (s)',
      'Comparisons',
      'Swaps',
      'Operations',
      'Array Accesses',
      'Status',
    ])
  );
  for (const p of [...result.points].sort((a, b) => a.size - b.size || a.algorithmId.localeCompare(b.algorithmId))) {
    lines.push(
      csvRow([
        algorithmName(p.algorithmId),
        DATASET_NAMES[result.config.dataset],
        p.size,
        p.ok ? seconds(p.algorithmMs) : '',
        p.ok ? p.comparisons : '',
        p.ok ? p.swaps : '',
        p.ok ? p.operations : '',
        p.ok ? p.arrayAccesses : '',
        p.ok ? 'OK' : p.cancelled ? 'CANCELLED' : 'FAILED',
      ])
    );
  }
  return lines.join('\n') + '\n';
}

export interface BenchmarkExportDocument {
  tool: string;
  version: number;
  exportedAt: string;
  mode: 'benchmark';
  config: BenchmarkResult['config'];
  sourceFingerprint: number;
  sourceLength: number;
  cancelled: boolean;
  aggregates: AlgorithmAggregate[];
  rankings: BenchmarkRankings;
  runs: BenchmarkResult['runs'];
}

export function buildExportDocument(result: BenchmarkResult): BenchmarkExportDocument {
  const aggregates = aggregateBenchmark(result);
  return {
    tool: 'Sorting Visualizer Benchmark Lab',
    version: 3,
    exportedAt: new Date(result.createdAt).toISOString(),
    mode: 'benchmark',
    config: result.config,
    sourceFingerprint: result.sourceFingerprint,
    sourceLength: result.sourceLength,
    cancelled: result.cancelled,
    aggregates,
    rankings: computeRankings(aggregates),
    runs: result.runs,
  };
}

export function benchmarkToJSON(result: BenchmarkResult): string {
  return JSON.stringify(buildExportDocument(result), null, 2);
}

export function scalingToJSON(result: ScalingResult): string {
  return JSON.stringify(
    {
      tool: 'Sorting Visualizer Benchmark Lab',
      version: 3,
      exportedAt: new Date(result.createdAt).toISOString(),
      mode: 'scaling',
      config: result.config,
      cancelled: result.cancelled,
      points: result.points,
    },
    null,
    2
  );
}

export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(1)} ms`;
}

/** Clipboard-ready plain-text report (COPY RESULTS). */
export function formatTextReport(result: BenchmarkResult): string {
  const aggregates = aggregateBenchmark(result);
  const rankings = computeRankings(aggregates);
  const cfg = result.config;
  const lines: string[] = [];
  lines.push('Sorting Visualizer Benchmark');
  lines.push('');
  lines.push(`Dataset: ${DATASET_NAMES[cfg.dataset]}`);
  lines.push(`Elements: ${cfg.size.toLocaleString('en-US')}`);
  lines.push(`Runs: ${cfg.runs}`);
  if (result.cancelled) lines.push('Status: CANCELLED (partial results)');
  lines.push('');
  rankings.fastest.forEach((entry, i) => {
    const agg = aggregates.find((a) => a.algorithmId === entry.algorithmId);
    const time = agg?.metrics ? formatDuration(agg.metrics.algorithmMs.average) : 'n/a';
    lines.push(`${i + 1}. ${algorithmName(entry.algorithmId)} — ${time}`);
  });
  const failed = aggregates.filter((a) => a.metrics === null);
  if (failed.length > 0) {
    lines.push('');
    lines.push(
      `Failed: ${failed.map((a) => algorithmName(a.algorithmId)).join(', ')} (correctness check)`
    );
  }
  lines.push('');
  lines.push('Measured algorithm time (excludes rendering).');
  return lines.join('\n');
}

/**
 * Trigger a local file download (browser only; no server involved).
 * Safe to call in non-DOM environments — becomes a no-op.
 */
export function downloadFile(filename: string, mime: string, content: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return false;
  }
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** Copy text to the clipboard with a textarea fallback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
