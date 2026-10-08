/**
 * BENCHMARK LAB — the V3 research dashboard.
 *
 * A fully separate view from the 3D visualizer:
 *  - never touches the WebGL renderer (main renderer is suspended meanwhile);
 *  - owns NO periodic timers — progress repaints are driven by runner
 *    callbacks and throttled to one paint per 120 ms;
 *  - every displayed number comes from real algorithm executions.
 *
 * Pipeline: Dataset → Clone → Algorithm → Real execution → Measured result
 *           → Statistics → Ranking / graphs / report.
 */

import type { AlgorithmId, DataDistribution, SortConfig } from '../types';
import type {
  BenchmarkConfig,
  BenchmarkControl,
  BenchmarkMetric,
  BenchmarkProgress,
  BenchmarkResult,
  ScalingConfig,
  ScalingResult,
} from '../benchmark/types';
import type { BenchmarkHistory, BenchmarkWarning, BenchmarkView } from '../benchmark';
import {
  ALGORITHM_NAMES,
  DATASET_NAMES,
  METRIC_LABELS,
  RANKING_LABELS,
  algorithmName,
  benchmarkToCSV,
  benchmarkToJSON,
  benchmarkWarning,
  buildBenchmarkView,
  copyText,
  countFailedRuns,
  createBenchmarkHistory,
  defaultBenchmarkStore,
  downloadFile,
  formatDuration,
  formatTextReport,
  historyEntryFromResult,
  runBenchmark,
  runScaling,
  runsChartSeries,
  scalingToCSV,
  scalingToJSON,
  scalingChartSeries,
  scalingWarning,
  winnerOf,
} from '../benchmark';
import { generateArray } from '../simulation';
import { analyzeDataset } from '../utils/datasetStats';
import { getInspectorData } from '../algorithms/inspector';
import { BenchmarkChart } from './BenchmarkChart';

export interface VisualizeWinnerPayload {
  algorithmId: AlgorithmId;
  array: number[];
  dataset: DataDistribution;
  size: number;
}

export interface BenchmarkLabCallbacks {
  onBack(): void;
  onVisualizeWinner(payload: VisualizeWinnerPayload): void;
}

const ALGORITHM_ORDER: AlgorithmId[] = ['quick', 'merge', 'heap', 'bubble'];
const SIZE_OPTIONS = [1000, 5000, 10000, 25000, 50000, 100000];
const RUN_OPTIONS = [1, 3, 5, 10];
const DATASET_OPTIONS: { id: DataDistribution; label: string }[] = [
  { id: 'random', label: 'Random' },
  { id: 'nearly-sorted', label: 'Nearly Sorted' },
  { id: 'reversed', label: 'Reversed' },
  { id: 'few-unique', label: 'Few Unique' },
];
const METRIC_KEYS: BenchmarkMetric[] = ['algorithmMs', 'comparisons', 'swaps', 'operations'];
const PROGRESS_PAINT_MS = 120;
const MIN_CUSTOM_SIZE = 10;
const MAX_SIZE = 100000;

const THEORY_NOTE =
  'Big-O describes how the cost GROWS as n gets large — it ignores constants, ' +
  'hardware and your specific data. The measured values above are this ' +
  'algorithm\u2019s own execution time and counters on THIS dataset. Different ' +
  'inputs (nearly sorted, reversed, few unique) shift the balance between ' +
  'algorithms, and implementation details matter too. No algorithm is ' +
  '\u201calways best\u201d.';

const EDUCATION_HTML = `
  <div class="edu-block">
    <p><strong>Big-O</strong> is a growth rate, not a stopwatch. O(n log n) says how
    work scales when n doubles — it says nothing about milliseconds on your machine.</p>
    <p><strong>Constants &amp; implementation</strong> — a clean O(n log n) can lose to a
    tight O(n²) loop at small n; pivot choice, early exits and JIT warm-up all count.</p>
    <p><strong>Input distribution</strong> — Reversed, Nearly Sorted and Few Unique
    change how many comparisons/swaps are actually needed. That is why this lab lets
    you re-run the same algorithm on different datasets.</p>
    <p><strong>Memory access</strong> — sequential reads are cache-friendly; swaps cost
    four memory operations, while merge-style writes avoid swaps entirely.</p>
    <p><strong>Measure, don\u2019t assume</strong> — every number on this page comes from
    a real run of the real algorithm, measured separately from rendering.</p>
  </div>`;

export class BenchmarkLab {
  private container: HTMLElement;
  private callbacks: BenchmarkLabCallbacks;
  private config: SortConfig;

  // configuration
  private selected: Set<AlgorithmId> = new Set(ALGORITHM_ORDER);
  private dataset: DataDistribution = 'random';
  private size = 10000;
  private runs = 1;

  // state
  private sourceArray: number[] | null = null;
  private lastResult: BenchmarkResult | null = null;
  private lastView: BenchmarkView | null = null;
  private lastScaling: ScalingResult | null = null;
  private control: BenchmarkControl | null = null;
  private running = false;
  private warningAck = false;
  private scalingAck = false;
  private metric: BenchmarkMetric = 'algorithmMs';
  private scalingMetric: BenchmarkMetric = 'algorithmMs';
  private lastPaint = 0;

  // components
  private history: BenchmarkHistory;
  private chart: BenchmarkChart;
  private scalingChart: BenchmarkChart;

  constructor(container: HTMLElement, config: SortConfig, callbacks: BenchmarkLabCallbacks) {
    this.container = container;
    this.config = config;
    this.callbacks = callbacks;
    this.history = createBenchmarkHistory(defaultBenchmarkStore());

    this.renderShell();
    this.chart = new BenchmarkChart(this.must('#lab-chart') as HTMLCanvasElement);
    this.scalingChart = new BenchmarkChart(this.must('#lab-scaling-chart') as HTMLCanvasElement);
    this.bind();
    this.regenerateSource();
    this.renderHistory();
    this.renderDatasetAnalysis();
    this.renderResultsDisabled();
    this.renderScalingDisabled();
  }

  // ---------------------------------------------------------------------------
  // DOM shell
  // ---------------------------------------------------------------------------

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="lab">
        <div class="lab-hero">
          <div class="lab-hero-text">
            <h2>BENCHMARK LAB</h2>
            <p>Real algorithm executions · measured algorithm time · no simulated results</p>
          </div>
          <div class="lab-tabs">
            <button type="button" class="lab-tab active" data-labtab="benchmark">BENCHMARK</button>
            <button type="button" class="lab-tab" data-labtab="scaling">SCALING TEST</button>
          </div>
          <button type="button" class="btn btn-secondary" id="lab-back">&larr; VISUALIZER</button>
        </div>

        <div class="lab-body">
          <!-- ================= BENCHMARK TAB ================= -->
          <section class="lab-grid" id="lab-tab-benchmark">
            <div class="lab-card lab-config">
              <h3>ALGORITHMS</h3>
              <div class="algo-checks">
                ${ALGORITHM_ORDER.map(
                  (id) => `
                  <label class="algo-check" data-algo="${id}">
                    <input type="checkbox" id="lab-algo-${id}" checked>
                    <span class="algo-dot" style="background: var(--algo-${id})"></span>
                    ${ALGORITHM_NAMES[id]}
                  </label>`
                ).join('')}
              </div>

              <h3>DATASET</h3>
              <div class="option-row" id="lab-dataset-row">
                ${DATASET_OPTIONS.map(
                  (d) => `
                  <label class="option-chip">
                    <input type="radio" name="lab-dataset" value="${d.id}"${
                      d.id === 'random' ? ' checked' : ''
                    }>
                    <span>${d.label}</span>
                  </label>`
                ).join('')}
              </div>

              <h3>SIZE</h3>
              <div class="option-row">
                <select id="lab-size-select" class="lab-select">
                  ${SIZE_OPTIONS.map((s) => `<option value="${s}"${
                    s === 10000 ? ' selected' : ''
                  }>${s.toLocaleString('en-US')}</option>`).join('')}
                  <option value="custom">Custom</option>
                </select>
                <input type="number" id="lab-size-custom" class="lab-input" min="${MIN_CUSTOM_SIZE}"
                  max="${MAX_SIZE}" step="10" value="10000" hidden>
              </div>

              <h3>RUNS</h3>
              <div class="option-row" id="lab-runs-row">
                ${RUN_OPTIONS.map(
                  (r) => `
                  <label class="option-chip">
                    <input type="radio" name="lab-runs" value="${r}"${r === 1 ? ' checked' : ''}>
                    <span>${r}</span>
                  </label>`
                ).join('')}
              </div>

              <div class="lab-run-row">
                <button type="button" class="btn btn-success" id="lab-run">RUN BENCHMARK</button>
                <button type="button" class="btn btn-danger" id="lab-cancel" hidden>CANCEL</button>
              </div>

              <div class="lab-warning" id="lab-warning" hidden>
                <div class="lab-warning-title">&#9888; HEAVY BENCHMARK</div>
                <div class="lab-warning-body" id="lab-warning-text"></div>
                <div class="lab-warning-actions">
                  <button type="button" class="btn btn-danger" id="lab-warning-anyway">RUN ANYWAY</button>
                  <button type="button" class="btn btn-secondary" id="lab-warning-cancel">CANCEL</button>
                </div>
              </div>

              <div class="lab-progress" id="lab-progress" hidden>
                <div class="lab-progress-track"><div class="lab-progress-fill" id="lab-progress-fill"></div></div>
                <div class="lab-progress-label" id="lab-progress-label"></div>
              </div>
            </div>

            <div class="lab-card lab-dataset-card">
              <h3>DATASET ANALYSIS <span class="lab-ds-name" id="lab-ds-name"></span></h3>
              <dl class="ds-stats" id="lab-ds-stats"></dl>
              <p class="lab-note">All values computed from the exact array used by this benchmark.</p>
            </div>

            <div class="lab-card lab-results" id="lab-results" hidden>
              <div class="lab-results-head">
                <h3>RESULTS</h3>
                <span class="lab-chip" id="lab-status-chip"></span>
              </div>
              <p class="lab-note">ALGORITHM TIME = pure algorithm execution time (excludes rendering &amp; UI).</p>
              <div class="table-scroll">
                <table class="lab-table" id="lab-table"></table>
              </div>
              <div class="leaderboard" id="lab-leaderboard"></div>
              <div class="chart-block">
                <div class="metric-toggles" id="lab-metric-toggles">
                  ${METRIC_KEYS.map(
                    (m) =>
                      `<button type="button" class="metric-btn${
                        m === 'algorithmMs' ? ' active' : ''
                      }" data-metric="${m}">${METRIC_LABELS[m]}</button>`
                  ).join('')}
                </div>
                <canvas id="lab-chart" class="lab-chart"></canvas>
              </div>
              <div class="algo-reports" id="lab-reports"></div>
              <div class="lab-actions">
                <button type="button" class="btn btn-success" id="lab-again">RUN AGAIN</button>
                <button type="button" class="btn btn-primary" id="lab-repeat">REPEAT SAME TEST</button>
                <button type="button" class="btn btn-secondary" id="lab-new">NEW TEST</button>
                <button type="button" class="btn btn-warning" id="lab-winner">&#9654; VISUALIZE WINNER</button>
                <span class="lab-actions-sep"></span>
                <button type="button" class="btn btn-secondary" id="lab-export-csv">EXPORT CSV</button>
                <button type="button" class="btn btn-secondary" id="lab-export-json">EXPORT JSON</button>
                <button type="button" class="btn btn-secondary" id="lab-copy">COPY RESULTS</button>
                <span class="lab-action-status" id="lab-action-status"></span>
              </div>
            </div>

            <div class="lab-card lab-history">
              <div class="lab-history-head">
                <h3>BENCHMARK HISTORY</h3>
                <button type="button" class="btn btn-danger btn-small" id="lab-history-clear">CLEAR BENCHMARK HISTORY</button>
              </div>
              <ul class="history-list" id="lab-history-list"></ul>
            </div>

            <details class="lab-card lab-education">
              <summary>WHY RESULTS DIFFER</summary>
              ${EDUCATION_HTML}
            </details>
          </section>

          <!-- ================= SCALING TAB ================= -->
          <section class="lab-grid" id="lab-tab-scaling" hidden>
            <div class="lab-card lab-config">
              <h3>SCALING TEST</h3>
              <p class="lab-note">Selected algorithms run on every checked size — one shared
              source array per size, cloned identically for each algorithm.</p>
              <h3>ALGORITHMS</h3>
              <div class="algo-checks">
                ${ALGORITHM_ORDER.map(
                  (id) => `
                  <label class="algo-check" data-algo="${id}">
                    <input type="checkbox" id="lab-scaling-algo-${id}" checked>
                    <span class="algo-dot" style="background: var(--algo-${id})"></span>
                    ${ALGORITHM_NAMES[id]}
                  </label>`
                ).join('')}
              </div>
              <h3>SIZES</h3>
              <div class="option-row" id="lab-scaling-sizes">
                ${SIZE_OPTIONS.map(
                  (s) => `
                  <label class="option-chip">
                    <input type="checkbox" name="lab-scaling-size" value="${s}" checked>
                    <span>${s >= 1000 ? `${s / 1000}k` : s}</span>
                  </label>`
                ).join('')}
              </div>
              <div class="lab-run-row">
                <button type="button" class="btn btn-success" id="lab-scaling-run">RUN SCALING TEST</button>
                <button type="button" class="btn btn-danger" id="lab-scaling-cancel" hidden>CANCEL</button>
              </div>
              <div class="lab-warning" id="lab-scaling-warning" hidden>
                <div class="lab-warning-title">&#9888; HEAVY SCALING TEST</div>
                <div class="lab-warning-body" id="lab-scaling-warning-text"></div>
                <div class="lab-warning-actions">
                  <button type="button" class="btn btn-danger" id="lab-scaling-anyway">RUN ANYWAY</button>
                  <button type="button" class="btn btn-secondary" id="lab-scaling-cancel-warn">CANCEL</button>
                </div>
              </div>
              <div class="lab-progress" id="lab-scaling-progress" hidden>
                <div class="lab-progress-track"><div class="lab-progress-fill" id="lab-scaling-fill"></div></div>
                <div class="lab-progress-label" id="lab-scaling-label"></div>
              </div>
            </div>

            <div class="lab-card lab-results" id="lab-scaling-results" hidden>
              <div class="lab-results-head">
                <h3>SCALING RESULTS</h3>
                <span class="lab-chip" id="lab-scaling-chip"></span>
              </div>
              <p class="lab-note">ALGORITHM TIME per size (excludes rendering). Chart lines show growth.</p>
              <div class="chart-block">
                <div class="metric-toggles" id="lab-scaling-toggles">
                  ${METRIC_KEYS.map(
                    (m) =>
                      `<button type="button" class="metric-btn${
                        m === 'algorithmMs' ? ' active' : ''
                      }" data-metric="${m}">${METRIC_LABELS[m]}</button>`
                  ).join('')}
                </div>
                <canvas id="lab-scaling-chart" class="lab-chart"></canvas>
              </div>
              <div class="table-scroll">
                <table class="lab-table" id="lab-scaling-table"></table>
              </div>
              <div class="lab-actions">
                <button type="button" class="btn btn-secondary" id="lab-scaling-csv">EXPORT CSV</button>
                <button type="button" class="btn btn-secondary" id="lab-scaling-json">EXPORT JSON</button>
                <span class="lab-action-status" id="lab-scaling-status"></span>
              </div>
            </div>

            <details class="lab-card lab-education">
              <summary>WHY RESULTS DIFFER</summary>
              ${EDUCATION_HTML}
            </details>
          </section>
        </div>
      </div>
    `;
  }

  private must(selector: string): Element {
    const el = this.container.querySelector(selector);
    if (!el) throw new Error(`BenchmarkLab: missing ${selector}`);
    return el;
  }

  private el<T extends Element>(selector: string): T {
    return this.must(selector) as T;
  }

  private esc(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  private bind(): void {
    // view tabs
    this.container.querySelectorAll<HTMLButtonElement>('.lab-tab').forEach((btn) => {
      btn.addEventListener('click', () => this.setTab(btn.dataset.labtab as 'benchmark' | 'scaling'));
    });
    this.el<HTMLButtonElement>('#lab-back').addEventListener('click', () => this.callbacks.onBack());

    // config: algorithms
    ALGORITHM_ORDER.forEach((id) => {
      const box = this.el<HTMLInputElement>(`#lab-algo-${id}`);
      box.addEventListener('change', () => {
        if (box.checked) this.selected.add(id);
        else this.selected.delete(id);
        this.warningAck = false;
        this.hideWarning();
      });
    });

    // config: dataset (regenerates the source array + analysis)
    this.container.querySelectorAll<HTMLInputElement>('input[name="lab-dataset"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        this.dataset = radio.value as DataDistribution;
        this.warningAck = false;
        this.hideWarning();
        this.regenerateSource();
        this.renderDatasetAnalysis();
      });
    });

    // config: size
    const sizeSelect = this.el<HTMLSelectElement>('#lab-size-select');
    const sizeCustom = this.el<HTMLInputElement>('#lab-size-custom');
    sizeSelect.addEventListener('change', () => {
      if (sizeSelect.value === 'custom') {
        sizeCustom.hidden = false;
        this.applyCustomSize(sizeCustom.value);
        sizeCustom.focus();
      } else {
        sizeCustom.hidden = true;
        this.size = Number(sizeSelect.value);
        this.warningAck = false;
        this.hideWarning();
        this.regenerateSource();
        this.renderDatasetAnalysis();
      }
    });
    sizeCustom.addEventListener('change', () => this.applyCustomSize(sizeCustom.value));

    // config: runs (keeps the source array — same data, more repetitions)
    this.container.querySelectorAll<HTMLInputElement>('input[name="lab-runs"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        this.runs = Number(radio.value);
        this.warningAck = false;
        this.hideWarning();
      });
    });

    // run flow
    this.el<HTMLButtonElement>('#lab-run').addEventListener('click', () =>
      this.startBenchmark({ reuseSource: false })
    );
    this.el<HTMLButtonElement>('#lab-cancel').addEventListener('click', () => this.cancelActive());
    this.el<HTMLButtonElement>('#lab-warning-anyway').addEventListener('click', () => {
      this.warningAck = true;
      this.hideWarning();
      this.startBenchmark({ reuseSource: false });
    });
    this.el<HTMLButtonElement>('#lab-warning-cancel').addEventListener('click', () => {
      this.warningAck = false;
      this.hideWarning();
    });

    // result actions
    this.el<HTMLButtonElement>('#lab-again').addEventListener('click', () =>
      this.startBenchmark({ reuseSource: false })
    );
    this.el<HTMLButtonElement>('#lab-repeat').addEventListener('click', () =>
      this.startBenchmark({ reuseSource: true })
    );
    this.el<HTMLButtonElement>('#lab-new').addEventListener('click', () =>
      this.startBenchmark({ reuseSource: false })
    );
    this.el<HTMLButtonElement>('#lab-winner').addEventListener('click', () => this.visualizeWinner());
    this.el<HTMLButtonElement>('#lab-export-csv').addEventListener('click', () => this.exportCSV());
    this.el<HTMLButtonElement>('#lab-export-json').addEventListener('click', () => this.exportJSON());
    this.el<HTMLButtonElement>('#lab-copy').addEventListener('click', () => void this.copyResults());

    // metric toggles
    this.bindMetricToggles('#lab-metric-toggles', (metric) => {
      this.metric = metric;
      this.paintRunsChart();
    });
    this.bindMetricToggles('#lab-scaling-toggles', (metric) => {
      this.scalingMetric = metric;
      this.paintScalingChart();
    });

    // history
    this.el<HTMLButtonElement>('#lab-history-clear').addEventListener('click', () => {
      this.history.clear();
      this.renderHistory();
      this.setActionStatus('Benchmark history cleared.');
    });

    // scaling flow
    this.el<HTMLButtonElement>('#lab-scaling-run').addEventListener('click', () =>
      this.startScaling({ ack: this.scalingAck })
    );
    this.el<HTMLButtonElement>('#lab-scaling-cancel').addEventListener('click', () => this.cancelActive());
    this.el<HTMLButtonElement>('#lab-scaling-anyway').addEventListener('click', () => {
      this.scalingAck = true;
      this.hideScalingWarning();
      this.startScaling({ ack: true });
    });
    this.el<HTMLButtonElement>('#lab-scaling-cancel-warn').addEventListener('click', () => {
      this.scalingAck = false;
      this.hideScalingWarning();
    });
    this.el<HTMLButtonElement>('#lab-scaling-csv').addEventListener('click', () => this.exportScalingCSV());
    this.el<HTMLButtonElement>('#lab-scaling-json').addEventListener('click', () => this.exportScalingJSON());

    // any scaling config change resets the acknowledgement
    this.container
      .querySelectorAll<HTMLInputElement>('input[id^="lab-scaling-algo-"], input[name="lab-scaling-size"]')
      .forEach((input) => {
        input.addEventListener('change', () => {
          this.scalingAck = false;
          this.hideScalingWarning();
        });
      });
  }

  private bindMetricToggles(selector: string, onMetric: (metric: BenchmarkMetric) => void): void {
    this.container.querySelectorAll<HTMLButtonElement>(`${selector} .metric-btn`).forEach((btn) => {
      btn.addEventListener('click', () => {
        this.container.querySelectorAll(`${selector} .metric-btn`).forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        onMetric(btn.dataset.metric as BenchmarkMetric);
      });
    });
  }

  private setTab(tab: 'benchmark' | 'scaling'): void {
    this.container.querySelectorAll('.lab-tab').forEach((btn) => {
      const isActive = (btn as HTMLElement).dataset.labtab === tab;
      btn.classList.toggle('active', isActive);
    });
    this.el<HTMLElement>('#lab-tab-benchmark').hidden = tab !== 'benchmark';
    this.el<HTMLElement>('#lab-tab-scaling').hidden = tab !== 'scaling';
    if (tab === 'benchmark') this.chart.refresh();
    else this.scalingChart.refresh();
  }

  // ---------------------------------------------------------------------------
  // Configuration helpers
  // ---------------------------------------------------------------------------

  private applyCustomSize(raw: string): void {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(MIN_CUSTOM_SIZE, Math.min(MAX_SIZE, Math.floor(parsed)));
    if (clamped === this.size) return;
    this.size = clamped;
    this.warningAck = false;
    this.hideWarning();
    this.regenerateSource();
    this.renderDatasetAnalysis();
  }

  private getSelectedIds(): AlgorithmId[] {
    return ALGORITHM_ORDER.filter((id) => this.selected.has(id));
  }

  private getScalingIds(): AlgorithmId[] {
    return ALGORITHM_ORDER.filter(
      (id) => this.el<HTMLInputElement>(`#lab-scaling-algo-${id}`).checked
    );
  }

  private getScalingSizes(): number[] {
    const sizes: number[] = [];
    this.container.querySelectorAll<HTMLInputElement>('input[name="lab-scaling-size"]').forEach(
      (box) => {
        if (box.checked) sizes.push(Number(box.value));
      }
    );
    return sizes;
  }

  /** Fresh source array for the current dataset/size (fairness anchor). */
  private regenerateSource(): void {
    this.sourceArray = generateArray(this.size, this.dataset);
  }

  // ---------------------------------------------------------------------------
  // Dataset analysis card
  // ---------------------------------------------------------------------------

  private renderDatasetAnalysis(): void {
    if (!this.sourceArray) return;
    const stats = analyzeDataset(this.sourceArray);
    const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

    this.el('#lab-ds-name').textContent = `${DATASET_NAMES[this.dataset]} · ${this.size.toLocaleString('en-US')}`;
    this.el('#lab-ds-stats').innerHTML = `
      <div class="ds-row"><dt>Unique values</dt><dd>${stats.uniqueCount.toLocaleString('en-US')}</dd></div>
      <div class="ds-row"><dt>Already ascending</dt><dd>${pct(stats.ascendingFraction)}</dd></div>
      <div class="ds-row"><dt>Descending</dt><dd>${pct(stats.descendingFraction)}</dd></div>
      <div class="ds-row"><dt>Disorder</dt><dd>${pct(stats.disorderFraction)}</dd></div>
      <div class="ds-row"><dt>Inversions</dt><dd>${stats.inversions.toLocaleString('en-US')}</dd></div>
      <div class="ds-row"><dt>Value range</dt><dd>${stats.min} … ${stats.max}</dd></div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Benchmark run
  // ---------------------------------------------------------------------------

  private showWarning(warning: BenchmarkWarning): void {
    this.el('#lab-warning-text').textContent = warning.message;
    this.el<HTMLElement>('#lab-warning').hidden = false;
  }

  private hideWarning(): void {
    this.el<HTMLElement>('#lab-warning').hidden = true;
  }

  private setRunningUI(running: boolean, progressId: string): void {
    this.running = running;
    this.el<HTMLButtonElement>('#lab-run').disabled = running;
    this.el<HTMLButtonElement>('#lab-scaling-run').disabled = running;
    this.el<HTMLButtonElement>('#lab-cancel').hidden = !(running && progressId === 'run');
    this.el<HTMLButtonElement>('#lab-scaling-cancel').hidden = !(running && progressId === 'scaling');
    this.el<HTMLElement>(progressId === 'run' ? '#lab-progress' : '#lab-scaling-progress').hidden = !running;
  }

  private async startBenchmark(options: { reuseSource: boolean }): Promise<void> {
    if (this.running) return;

    const ids = this.getSelectedIds();
    if (ids.length === 0) {
      this.setActionStatus('Select at least one algorithm.');
      return;
    }

    const warning = benchmarkWarning(ids, this.size, this.runs);
    if (warning && !this.warningAck) {
      this.showWarning(warning);
      return;
    }
    this.hideWarning();

    if (!options.reuseSource || !this.sourceArray || this.sourceArray.length !== this.size) {
      this.regenerateSource();
      this.renderDatasetAnalysis();
    }
    const source = this.sourceArray!;
    const control: BenchmarkControl = { cancelled: false };
    this.control = control;

    this.setRunningUI(true, 'run');
    this.el<HTMLElement>('#lab-results').hidden = true;
    this.el<HTMLButtonElement>('#lab-copy').disabled = true;
    this.setActionStatus('');
    this.lastPaint = 0;
    this.paintProgress(0, 1, 'Preparing benchmark…');

    const config: BenchmarkConfig = {
      algorithmIds: ids,
      dataset: this.dataset,
      size: this.size,
      runs: this.runs,
    };

    const result = await runBenchmark(config, source, control, (p) => this.onBenchmarkProgress(p));

    this.setRunningUI(false, 'run');
    this.el<HTMLElement>('#lab-progress').hidden = true;

    if (result.runs.length === 0 && result.cancelled) {
      this.setActionStatus('Benchmark cancelled before any run finished.');
      return;
    }

    this.lastResult = result;
    this.lastView = buildBenchmarkView(result);
    this.renderResults();
    this.addHistoryFromResult(result);
    this.el<HTMLButtonElement>('#lab-copy').disabled = false;
    this.setActionStatus(
      result.cancelled ? 'Benchmark cancelled — showing partial results.' : 'Benchmark complete.'
    );
  }

  private onBenchmarkProgress(p: BenchmarkProgress): void {
    const now = performance.now();
    const done = p.completed >= p.total;
    if (!done && now - this.lastPaint < PROGRESS_PAINT_MS) return;
    this.lastPaint = now;

    const inner = Math.max(0, Math.min(1, p.innerProgress));
    const fraction = p.total > 0 ? (p.completed + inner) / p.total : 0;
    const label = p.currentAlgorithmId
      ? `${algorithmName(p.currentAlgorithmId)} · run ${p.currentRunIndex + 1}/${this.runs} · ${p.completed}/${p.total} finished`
      : `${p.completed}/${p.total} finished`;
    this.paintProgress(fraction, 1, label);
  }

  private paintProgress(value: number, max: number, label: string): void {
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
    this.el<HTMLElement>('#lab-progress-fill').style.width = `${pct}%`;
    this.el('#lab-progress-label').textContent = label;
  }

  // ---------------------------------------------------------------------------
  // Results rendering
  // ---------------------------------------------------------------------------

  private renderResultsDisabled(): void {
    this.el<HTMLElement>('#lab-results').hidden = true;
  }

  private fmtCount(n: number): string {
    return Math.round(n).toLocaleString('en-US');
  }

  private renderResults(): void {
    const result = this.lastResult;
    const view = this.lastView;
    if (!result || !view) return;

    this.el<HTMLElement>('#lab-results').hidden = false;

    // ---- status chip ------------------------------------------------------
    const total = result.runs.length;
    const okCount = result.runs.filter((r) => r.ok).length;
    const chip = this.el<HTMLElement>('#lab-status-chip');
    if (result.cancelled) {
      chip.textContent = `PARTIAL · ${okCount} RUNS`;
      chip.className = 'lab-chip chip-warn';
    } else if (okCount === total) {
      chip.textContent = `${total} RUN${total > 1 ? 'S' : ''} · ALL SORTED ✓`;
      chip.className = 'lab-chip chip-ok';
    } else {
      chip.textContent = `${okCount}/${total} OK · ${total - okCount} FAILED`;
      chip.className = 'lab-chip chip-fail';
    }

    // ---- results table ----------------------------------------------------
    const rows = view.aggregates
      .map((agg) => {
        const m = agg.metrics;
        const status = m
          ? `OK · ${agg.totalRuns - agg.failedRuns.length}/${agg.totalRuns} runs`
          : agg.failedRuns.length > 0
            ? `FAILED · ${this.esc(agg.failedRuns[0]?.error ?? 'correctness check')}`
            : 'NOT RUN · cancelled';
        const dot = `<span class="algo-dot" style="background: var(--algo-${agg.algorithmId})"></span>`;
        if (!m) {
          return `<tr class="row-failed"><td>${dot}${algorithmName(agg.algorithmId)}</td>
            <td colspan="7" class="cell-muted">no successful runs</td>
            <td class="status-fail">${status}</td></tr>`;
        }
        return `<tr>
          <td>${dot}${algorithmName(agg.algorithmId)}</td>
          <td class="cell-strong">${formatDuration(m.algorithmMs.average)}</td>
          <td>${formatDuration(m.algorithmMs.min)}</td>
          <td>${formatDuration(m.algorithmMs.max)}</td>
          <td>${formatDuration(m.algorithmMs.median)}</td>
          <td>${this.fmtCount(m.comparisons.average)}</td>
          <td>${this.fmtCount(m.swaps.average)}</td>
          <td>${this.fmtCount(m.operations.average)}</td>
          <td class="status-ok">${status}</td>
        </tr>`;
      })
      .join('');

    this.el('#lab-table').innerHTML = `
      <thead>
        <tr>
          <th>ALGORITHM</th><th>AVG TIME</th><th>MIN</th><th>MAX</th><th>MEDIAN</th>
          <th>AVG COMPARISONS</th><th>AVG SWAPS</th><th>AVG OPERATIONS</th><th>STATUS</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    `;

    // ---- leaderboard ------------------------------------------------------
    const categoryOrder: ('fastest' | 'fewestComparisons' | 'fewestOperations' | 'fewestSwaps')[] = [
      'fastest',
      'fewestComparisons',
      'fewestOperations',
      'fewestSwaps',
    ];
    this.el('#lab-leaderboard').innerHTML = categoryOrder
      .map((key) => {
        const entries = view.rankings[key];
        const items = entries
          .map((entry, i) => {
            const value =
              key === 'fastest'
                ? formatDuration(entry.value)
                : this.fmtCount(entry.value);
            const medal = i === 0 ? ' leader-first' : '';
            return `<li class="lb-entry${medal}"><span class="lb-pos">${i + 1}</span>
              <span class="algo-dot" style="background: var(--algo-${entry.algorithmId})"></span>
              <span class="lb-name">${algorithmName(entry.algorithmId)}</span>
              <span class="lb-value">${value}</span></li>`;
          })
          .join('');
        return `<div class="lb-card"><h4>${RANKING_LABELS[key]}</h4><ol>${
          items || '<li class="lb-empty">no successful runs</li>'
        }</ol></div>`;
      })
      .join('');

    // ---- chart ------------------------------------------------------------
    this.paintRunsChart();

    // ---- algorithm reports ------------------------------------------------
    this.el('#lab-reports').innerHTML = view.aggregates
      .map((agg) => this.renderReport(agg))
      .join('');

    // ---- buttons ----------------------------------------------------------
    this.el<HTMLButtonElement>('#lab-winner').disabled = winnerOf(view.rankings) === null;

    // ---- config echo ------------------------------------------------------
    const head = this.el('.lab-results-head h3');
    if (head) {
      head.textContent = `RESULTS · ${DATASET_NAMES[result.config.dataset].toUpperCase()} · ${result.config.size.toLocaleString('en-US')} · ${result.config.runs} RUN${result.config.runs > 1 ? 'S' : ''}${countFailedRuns(result) > 0 ? ` · ${countFailedRuns(result)} FAILED` : ''}`;
    }
  }

  private renderReport(agg: BenchmarkView['aggregates'][number]): string {
    const theory = getInspectorData(agg.algorithmId, this.config);
    const name = algorithmName(agg.algorithmId);
    const m = agg.metrics;
    const measurement = m
      ? `
        <div class="report-grid">
          <div class="report-cell"><span>Measured (avg)</span><strong>${formatDuration(m.algorithmMs.average)}</strong></div>
          <div class="report-cell"><span>Min / Max</span><strong>${formatDuration(m.algorithmMs.min)} / ${formatDuration(m.algorithmMs.max)}</strong></div>
          <div class="report-cell"><span>Median</span><strong>${formatDuration(m.algorithmMs.median)}</strong></div>
          <div class="report-cell"><span>Comparisons</span><strong>${this.fmtCount(m.comparisons.average)}</strong></div>
          <div class="report-cell"><span>Swaps</span><strong>${this.fmtCount(m.swaps.average)}</strong></div>
          <div class="report-cell"><span>Operations</span><strong>${this.fmtCount(m.operations.average)}</strong></div>
        </div>`
      : `<p class="status-fail">Every run failed the correctness check — excluded from rankings.</p>`;

    const theoryGrid = theory
      ? `<div class="report-grid theory-grid">
          <div class="report-cell"><span>Average</span><strong>${theory.averageComplexity}</strong></div>
          <div class="report-cell"><span>Best</span><strong>${theory.bestComplexity}</strong></div>
          <div class="report-cell"><span>Worst</span><strong>${theory.worstComplexity}</strong></div>
          <div class="report-cell"><span>Space</span><strong>${theory.spaceComplexity}</strong></div>
        </div>`
      : '';

    return `
      <details class="algo-report">
        <summary><span class="algo-dot" style="background: var(--algo-${agg.algorithmId})"></span>${name}
          ${m ? `<span class="report-summary-time">${formatDuration(m.algorithmMs.average)}</span>` : '<span class="status-fail">FAILED</span>'}
        </summary>
        <div class="report-body">
          <h5>THEORY</h5>
          ${theoryGrid}
          <h5>MEASURED · this benchmark</h5>
          ${measurement}
          <h5>THEORY VS MEASUREMENT</h5>
          <p class="theory-note">${THEORY_NOTE}</p>
        </div>
      </details>`;
  }

  private paintRunsChart(): void {
    const result = this.lastResult;
    if (!result) return;
    const series = runsChartSeries(result, this.metric);
    const ticks = Array.from({ length: result.config.runs }, (_, i) => ({
      value: i + 1,
      label: String(i + 1),
    }));
    this.chart.render({
      series,
      xAxis: { ticks, scale: 'linear' },
      yLabel: METRIC_LABELS[this.metric],
      formatY: (v) => this.formatMetric(v, this.metric),
    });
  }

  private formatMetric(value: number, metric: BenchmarkMetric): string {
    if (metric === 'algorithmMs') {
      return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
    }
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(Math.round(value));
  }

  // ---------------------------------------------------------------------------
  // Result actions
  // ---------------------------------------------------------------------------

  private setActionStatus(text: string): void {
    this.el('#lab-action-status').textContent = text;
  }

  private exportCSV(): void {
    if (!this.lastResult) return;
    const ok = downloadFile(
      `benchmark-${this.dataset}-${this.size}.csv`,
      'text/csv;charset=utf-8',
      benchmarkToCSV(this.lastResult)
    );
    this.setActionStatus(ok ? 'CSV file downloaded.' : 'CSV export unavailable in this browser.');
  }

  private exportJSON(): void {
    if (!this.lastResult) return;
    const ok = downloadFile(
      `benchmark-${this.dataset}-${this.size}.json`,
      'application/json;charset=utf-8',
      benchmarkToJSON(this.lastResult)
    );
    this.setActionStatus(ok ? 'JSON file downloaded.' : 'JSON export unavailable in this browser.');
  }

  private async copyResults(): Promise<void> {
    if (!this.lastResult) return;
    const ok = await copyText(formatTextReport(this.lastResult));
    this.setActionStatus(ok ? 'Report copied to clipboard.' : 'Clipboard unavailable — use EXPORT instead.');
  }

  private visualizeWinner(): void {
    const winner = this.lastView ? winnerOf(this.lastView.rankings) : null;
    if (!winner || !this.lastResult) return;
    this.callbacks.onVisualizeWinner({
      algorithmId: winner,
      array: (this.sourceArray ?? []).slice(),
      dataset: this.dataset,
      size: this.size,
    });
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  private addHistoryFromResult(result: BenchmarkResult): void {
    const view = this.lastView;
    const winner = view ? winnerOf(view.rankings) : null;
    const winnerAgg = view?.aggregates.find((a) => a.algorithmId === winner);
    this.history.add(
      historyEntryFromResult({
        id: result.id,
        timestamp: result.createdAt,
        mode: 'benchmark',
        algorithmIds: result.config.algorithmIds,
        dataset: result.config.dataset,
        sizes: [result.config.size],
        runs: result.config.runs,
        bestAlgorithmId: winner,
        bestTimeMs: winnerAgg?.metrics?.algorithmMs.average ?? null,
        failedCount: countFailedRuns(result),
      })
    );
    this.renderHistory();
  }

  private renderHistory(): void {
    const entries = this.history.list();
    const list = this.el('#lab-history-list');
    if (entries.length === 0) {
      list.innerHTML = '<li class="history-empty">No benchmarks yet — results appear here after each run.</li>';
      return;
    }
    list.innerHTML = entries
      .map((entry) => {
        const algos = entry.algorithmIds.map((id) => algorithmName(id).replace(' Sort', '')).join(' / ');
        const sizeLabel =
          entry.mode === 'scaling'
            ? entry.sizes.map((s) => (s >= 1000 ? `${s / 1000}k` : String(s))).join(' → ')
            : entry.sizes[0].toLocaleString('en-US');
        const runsLabel = entry.mode === 'scaling' ? '1 run / size' : `${entry.runs} run${entry.runs > 1 ? 's' : ''}`;
        const best = entry.bestAlgorithmId
          ? `Best: ${algorithmName(entry.bestAlgorithmId)}${
              entry.bestTimeMs !== null ? ` — ${formatDuration(entry.bestTimeMs)}` : ''
            }`
          : 'No successful runs';
        const time = new Date(entry.timestamp).toLocaleString();
        return `<li class="history-item">
          <div class="hist-mode">${entry.mode === 'scaling' ? 'SCALING' : 'BENCHMARK'}</div>
          <div class="hist-algos">${algos}</div>
          <div class="hist-meta">${DATASET_NAMES[entry.dataset]} · ${sizeLabel} · ${runsLabel}</div>
          <div class="hist-best">${best}${entry.failedCount > 0 ? ` · ${entry.failedCount} failed` : ''}</div>
          <div class="hist-time">${time}</div>
        </li>`;
      })
      .join('');
  }

  // ---------------------------------------------------------------------------
  // Scaling test
  // ---------------------------------------------------------------------------

  private hideScalingWarning(): void {
    this.el<HTMLElement>('#lab-scaling-warning').hidden = true;
  }

  private renderScalingDisabled(): void {
    this.el<HTMLElement>('#lab-scaling-results').hidden = true;
  }

  private async startScaling(options: { ack: boolean }): Promise<void> {
    if (this.running) return;

    const ids = this.getScalingIds();
    const sizes = this.getScalingSizes();
    if (ids.length === 0) {
      this.el('#lab-scaling-status').textContent = 'Select at least one algorithm.';
      return;
    }
    if (sizes.length === 0) {
      this.el('#lab-scaling-status').textContent = 'Check at least one size.';
      return;
    }

    const warning = scalingWarning(ids, sizes);
    if (warning && !options.ack) {
      this.el('#lab-scaling-warning-text').textContent = warning.message;
      this.el<HTMLElement>('#lab-scaling-warning').hidden = false;
      return;
    }
    this.hideScalingWarning();

    const control: BenchmarkControl = { cancelled: false };
    this.control = control;

    this.setRunningUI(true, 'scaling');
    this.el<HTMLElement>('#lab-scaling-results').hidden = true;
    this.el('#lab-scaling-status').textContent = '';
    this.lastPaint = 0;
    this.paintScalingProgress(0, 'Preparing scaling test…');

    const config: ScalingConfig = { algorithmIds: ids, dataset: this.dataset, sizes };
    const result = await runScaling(config, control, (p) => this.onScalingProgress(p));

    this.setRunningUI(false, 'scaling');
    this.el<HTMLElement>('#lab-scaling-progress').hidden = true;

    if (result.points.length === 0 && result.cancelled) {
      this.el('#lab-scaling-status').textContent = 'Scaling test cancelled before any point finished.';
      return;
    }

    this.lastScaling = result;
    this.renderScaling();
    this.addHistoryFromScaling(result);
    this.el('#lab-scaling-status').textContent = result.cancelled
      ? 'Cancelled — showing partial results.'
      : 'Scaling test complete.';
  }

  private onScalingProgress(p: BenchmarkProgress): void {
    const now = performance.now();
    const done = p.completed >= p.total;
    if (!done && now - this.lastPaint < PROGRESS_PAINT_MS) return;
    this.lastPaint = now;
    const inner = Math.max(0, Math.min(1, p.innerProgress));
    const fraction = p.total > 0 ? (p.completed + inner) / p.total : 0;
    const label = p.currentAlgorithmId
      ? `${algorithmName(p.currentAlgorithmId)} @ ${p.currentRunIndex.toLocaleString('en-US')} · ${p.completed}/${p.total} finished`
      : `${p.completed}/${p.total} finished`;
    this.paintScalingProgress(fraction, label);
  }

  private paintScalingProgress(fraction: number, label: string): void {
    this.el<HTMLElement>('#lab-scaling-fill').style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    this.el('#lab-scaling-label').textContent = label;
  }

  private renderScaling(): void {
    const result = this.lastScaling;
    if (!result) return;
    this.el<HTMLElement>('#lab-scaling-results').hidden = false;

    const okCount = result.points.filter((p) => p.ok).length;
    const chip = this.el<HTMLElement>('#lab-scaling-chip');
    chip.textContent = result.cancelled
      ? `PARTIAL · ${okCount}/${result.points.length}`
      : okCount === result.points.length
        ? `${result.points.length} POINTS · ALL SORTED ✓`
        : `${okCount}/${result.points.length} OK`;
    chip.className = okCount === result.points.length && !result.cancelled ? 'lab-chip chip-ok' : 'lab-chip chip-warn';

    // ---- table: rows = sizes, columns = algorithms (time) -----------------
    const ids = result.config.algorithmIds;
    const sizes = [...result.config.sizes].sort((a, b) => a - b);
    const lookup = new Map(result.points.map((p) => [`${p.algorithmId}:${p.size}`, p]));
    const head = ids
      .map(
        (id) =>
          `<th><span class="algo-dot" style="background: var(--algo-${id})"></span>${algorithmName(id)}</th>`
      )
      .join('');
    const body = sizes
      .map((size) => {
        const cells = ids
          .map((id) => {
            const point = lookup.get(`${id}:${size}`);
            if (!point) return `<td class="cell-muted">—</td>`;
            if (!point.ok) {
              const reason = point.cancelled ? 'cancelled' : point.error ?? 'failed';
              return `<td class="status-fail" title="${this.esc(reason)}">✗</td>`;
            }
            return `<td class="cell-strong">${formatDuration(point.algorithmMs)}</td>`;
          })
          .join('');
        return `<tr><td class="cell-size">${size.toLocaleString('en-US')}</td>${cells}</tr>`;
      })
      .join('');

    this.el('#lab-scaling-table').innerHTML = `
      <thead><tr><th>SIZE</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    `;

    this.paintScalingChart();
  }

  private paintScalingChart(): void {
    const result = this.lastScaling;
    if (!result) return;
    const series = scalingChartSeries(result, this.scalingMetric);
    const sizes = [...result.config.sizes].sort((a, b) => a - b);
    this.scalingChart.render({
      series,
      xAxis: {
        ticks: sizes.map((s) => ({
          value: s,
          label: s >= 1000 ? `${s / 1000}k` : String(s),
        })),
        scale: 'log',
      },
      yLabel: METRIC_LABELS[this.scalingMetric],
      formatY: (v) => this.formatMetric(v, this.scalingMetric),
    });
  }

  private addHistoryFromScaling(result: ScalingResult): void {
    // Best = lowest average time across the successful sizes.
    const perAlgorithm = result.config.algorithmIds
      .map((id) => {
        const ok = result.points.filter((p) => p.algorithmId === id && p.ok);
        if (ok.length === 0) return { id, avg: Number.POSITIVE_INFINITY };
        return { id, avg: ok.reduce((sum, p) => sum + p.algorithmMs, 0) / ok.length };
      })
      .filter((e) => Number.isFinite(e.avg))
      .sort((a, b) => a.avg - b.avg);

    this.history.add(
      historyEntryFromResult({
        id: result.id,
        timestamp: result.createdAt,
        mode: 'scaling',
        algorithmIds: result.config.algorithmIds,
        dataset: result.config.dataset,
        sizes: result.config.sizes,
        runs: 1,
        bestAlgorithmId: perAlgorithm[0]?.id ?? null,
        bestTimeMs: perAlgorithm[0]?.avg ?? null,
        failedCount: result.points.filter((p) => !p.ok).length,
      })
    );
    this.renderHistory();
  }

  private exportScalingCSV(): void {
    if (!this.lastScaling) return;
    const ok = downloadFile(
      `scaling-${this.dataset}.csv`,
      'text/csv;charset=utf-8',
      scalingToCSV(this.lastScaling)
    );
    this.el('#lab-scaling-status').textContent = ok ? 'CSV file downloaded.' : 'CSV export unavailable.';
  }

  private exportScalingJSON(): void {
    if (!this.lastScaling) return;
    const ok = downloadFile(
      `scaling-${this.dataset}.json`,
      'application/json;charset=utf-8',
      scalingToJSON(this.lastScaling)
    );
    this.el('#lab-scaling-status').textContent = ok ? 'JSON file downloaded.' : 'JSON export unavailable.';
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Called when the user leaves the lab — abort any in-flight run. */
  cancelActive(): void {
    if (this.control && !this.control.cancelled) {
      this.control.cancelled = true;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  dispose(): void {
    this.cancelActive();
    this.chart.dispose();
    this.scalingChart.dispose();
  }
}
