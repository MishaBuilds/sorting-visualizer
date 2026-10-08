/**
 * Benchmark Lab layer barrel.
 *
 * Pure logic only — no rendering, no DOM. Pipeline:
 *   Dataset → Clone → Algorithm → Real execution → Measured result →
 *   Statistics → Ranking / graphs / report
 */

export * from './types';
export {
  CHUNK_BUDGET_MS,
  checkCorrectness,
  arrayFingerprint,
  runAlgorithmOnce,
  runBenchmark,
  runScaling,
} from './runner';
export {
  summarize,
  aggregateRuns,
  aggregateAlgorithm,
  aggregateBenchmark,
  countFailedRuns,
} from './statistics';
export { computeRankings, winnerOf, rankOf, RANKING_LABELS } from './ranking';
export { benchmarkWarning, scalingWarning, WARNING_SIZE_THRESHOLD } from './warning';
export type { BenchmarkWarning } from './warning';
export {
  BENCHMARK_HISTORY_KEY,
  MAX_BENCHMARK_HISTORY_ENTRIES,
  defaultBenchmarkStore,
} from './storage';
export type { KeyValueStore } from './storage';
export { createBenchmarkHistory, historyEntryFromResult } from './history';
export type { BenchmarkHistory } from './history';
export {
  ALGORITHM_NAMES,
  DATASET_NAMES,
  algorithmName,
  benchmarkToCSV,
  scalingToCSV,
  benchmarkToJSON,
  scalingToJSON,
  buildExportDocument,
  formatDuration,
  formatTextReport,
  csvCell,
  downloadFile,
  copyText,
} from './export';
export type { BenchmarkExportDocument } from './export';
export {
  METRIC_LABELS,
  buildBenchmarkView,
  runsChartSeries,
  scalingChartSeries,
} from './results';
export type { BenchmarkView, ChartSeries } from './results';
