/**
 * UI Manager - coordinates all UI components and connects them to simulation/renderer
 *
 * V2 adds: Performance Mode throughput, the live performance graph, the
 * SORT COMPLETE overlay, session run history, the dataset card and the
 * full Compare Mode (2–4 real concurrent runs in scissored viewports).
 */

import type * as THREE from 'three';
import type {
  SortConfig,
  AppState,
  AlgorithmId,
  CompareResult,
  CompareVerdicts,
  RunHistoryEntry,
} from '../types';
import { ControlPanel } from './ControlPanel';
import { StatisticsPanel } from './StatisticsPanel';
import { CurrentOperationPanel } from './CurrentOperationPanel';
import { PerfGraph } from './PerfGraph';
import { ResultOverlay } from './ResultOverlay';
import { HistoryPanel } from './HistoryPanel';
import { CompareOverlay } from './CompareOverlay';
import { SortRenderer } from '../rendering';
import { CompareLane } from '../rendering/compareLane';
import { OperationStream } from '../simulation';
import { AnimationScheduler } from '../simulation';
import { generateArray } from '../simulation';
import { CompareController } from '../simulation/compareController';
import { computeDatasetStats } from '../utils/datasetStats';
import {
  longRunWarning,
  modeForCount,
  schedulerOpsPerFrame,
  isPerformanceCount,
} from '../utils/perfMode';
import { validateSelection, computeLaneLayout, type LaneLayout } from '../utils/compare';
import { createRunHistory, type KeyValueStore } from '../utils/runHistory';
import { BenchmarkLab, type VisualizeWinnerPayload } from './BenchmarkLab';

const ALGORITHM_NAMES: Record<AlgorithmId, string> = {
  bubble: 'Bubble Sort',
  quick: 'Quick Sort',
  merge: 'Merge Sort',
  heap: 'Heap Sort',
};

const DISTRIBUTION_NAMES: Record<string, string> = {
  random: 'Random',
  'nearly-sorted': 'Nearly Sorted',
  reversed: 'Reversed',
  'few-unique': 'Few Unique',
};

function sessionStore(): KeyValueStore {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.getItem('x'); // probe — can throw in private mode
      return window.sessionStorage;
    }
  } catch {
    // fall through to the in-memory store
  }
  return {
    getItem: () => null,
    setItem: () => undefined,
  };
}

export class UIManager {
  private rootContainer: HTMLElement;
  private renderer: SortRenderer;
  private operationStream: OperationStream;
  private scheduler: AnimationScheduler;

  private controlPanel: ControlPanel;
  private statisticsPanel: StatisticsPanel;
  private operationPanel: CurrentOperationPanel;
  private graph: PerfGraph;
  private resultOverlay: ResultOverlay;
  private historyPanel: HistoryPanel;
  private compareOverlay: CompareOverlay;
  private benchmarkLab: BenchmarkLab;

  private config: SortConfig;
  private state: AppState = 'idle';
  private currentArray: number[] = [];
  /** Snapshot of the algorithm a running sort was started with — the result
   *  card and history entry must describe the run that actually happened even
   *  if the user switches the selector mid-run. */
  private runAlgorithm: AlgorithmId | null = null;

  // Compare Mode state
  private compareActive = false;
  private compareController: CompareController | null = null;
  private compareLanes = new Map<AlgorithmId, CompareLane>();
  private laneLayout: LaneLayout | null = null;

  // V3 view state: 'benchmark' suspends the 3D renderer entirely
  private currentView: 'visualizer' | 'benchmark' = 'visualizer';

  // Callbacks for external control
  private onStateChangeCallback: ((state: AppState) => void) | null = null;
  private resizeHandler: () => void;

  constructor(rootContainer: HTMLElement, initialConfig: SortConfig) {
    this.rootContainer = rootContainer;
    this.config = { ...initialConfig };

    // Create UI structure
    this.createLayout();

    // Initialize renderer
    const canvasContainer = this.rootContainer.querySelector('#canvas-container') as HTMLElement;
    this.renderer = new SortRenderer(canvasContainer);
    this.renderer.setElementCount(this.config.elementCount);
    this.renderer.setVisualizationMode(this.config.visualizationMode);
    this.renderer.setPerformanceMode(modeForCount(this.config.elementCount) === 'performance');

    // Initialize simulation
    this.operationStream = new OperationStream(this.config);
    this.scheduler = new AnimationScheduler(this.operationStream, {
      targetFPS: 60,
      maxOperationsPerFrame: schedulerOpsPerFrame(modeForCount(this.config.elementCount)),
      speedMultiplier: this.config.speed,
    });

    // Initialize UI panels
    const controlContainer = this.rootContainer.querySelector('#control-panel') as HTMLElement;
    const statsContainer = this.rootContainer.querySelector('#stats-panel') as HTMLElement;
    const opContainer = this.rootContainer.querySelector('#operation-panel') as HTMLElement;
    const graphContainer = this.rootContainer.querySelector('#graph-panel') as HTMLElement;
    const historyContainer = this.rootContainer.querySelector('#history-panel') as HTMLElement;
    const resultRoot = this.rootContainer.querySelector('#result-overlay-root') as HTMLElement;
    const compareRoot = this.rootContainer.querySelector('#compare-overlay-root') as HTMLElement;

    this.controlPanel = new ControlPanel(controlContainer, this.config);
    this.statisticsPanel = new StatisticsPanel(statsContainer);
    this.operationPanel = new CurrentOperationPanel(opContainer);
    this.graph = new PerfGraph(graphContainer);
    this.historyPanel = new HistoryPanel(historyContainer, createRunHistory(sessionStore()));
    this.resultOverlay = new ResultOverlay(resultRoot);
    this.compareOverlay = new CompareOverlay(compareRoot);

    // V3: Benchmark Lab — a fully separate view with its own DOM subtree;
    // the WebGL renderer is suspended while it is active.
    const labRoot = this.rootContainer.querySelector('#benchmark-root') as HTMLElement;
    this.benchmarkLab = new BenchmarkLab(labRoot, this.config, {
      onBack: () => this.switchView('visualizer'),
      onVisualizeWinner: (payload) => this.visualizeWinner(payload),
    });

    // Wire everything together
    this.bindCallbacks();
    this.connectSchedulerToRenderer();
    this.updateHeaderDisplays();

    this.resizeHandler = () => this.handleWindowResize();
    window.addEventListener('resize', this.resizeHandler);

    // Generate the initial array so the first frame shows real data
    this.handleRandomize();
  }

  private createLayout(): void {
    this.rootContainer.innerHTML = `
      <div class="app-container">
        <header class="app-header">
          <div class="header-brand">
            <h1>SORTING VISUALIZER</h1>
            <p class="header-subtitle">Real-time algorithm visualization</p>
          </div>
          <nav class="view-tabs" aria-label="Mode">
            <button type="button" class="view-tab active" id="tab-visualizer">VISUALIZER</button>
            <button type="button" class="view-tab" id="tab-benchmark">BENCHMARK LAB</button>
          </nav>
          <div class="header-info">
            <span id="element-count-display">10 000 elements</span>
            <span id="algorithm-display">Quick Sort</span>
            <span id="perf-badge" class="perf-badge" style="display: none;">PERFORMANCE MODE</span>
          </div>
        </header>
        <div class="app-main">
          <div class="canvas-wrapper">
            <div id="canvas-container"></div>
            <div class="canvas-overlay">
              <div class="hover-info" id="hover-info" style="display: none;"></div>
              <div class="state-legend">
                <span class="legend-item"><i style="background:#ff6b35"></i>COMPARING</span>
                <span class="legend-item"><i style="background:#ffd700"></i>SWAPPING</span>
                <span class="legend-item"><i style="background:#00ff88"></i>PIVOT</span>
                <span class="legend-item"><i style="background:#7b68ee"></i>RANGE</span>
                <span class="legend-item"><i style="background:#ff69b4"></i>MERGING</span>
                <span class="legend-item"><i style="background:#4ecdc4"></i>SORTED</span>
              </div>
              <div id="result-overlay-root" class="overlay-root"></div>
              <div id="compare-overlay-root" class="overlay-root"></div>
            </div>
          </div>
          <div class="panels-wrapper">
            <div id="control-panel" class="side-panel"></div>
            <div id="stats-panel" class="side-panel"></div>
            <div id="graph-panel" class="side-panel"></div>
            <div id="operation-panel" class="side-panel"></div>
            <div id="history-panel" class="side-panel"></div>
          </div>
        </div>
        <div id="benchmark-root" class="benchmark-root"></div>
      </div>
    `;
  }

  private bindCallbacks(): void {
    // Control panel callbacks
    this.controlPanel.onConfigChange((config) => this.handleConfigChange(config));
    this.controlPanel.onRandomize(() => this.handleRandomize());
    this.controlPanel.onSort(() => this.handleSort());
    this.controlPanel.onPause(() => this.handlePause());
    this.controlPanel.onResume(() => this.handleResume());
    this.controlPanel.onReset(() => this.handleReset());
    this.controlPanel.onResetCamera(() => this.handleResetCamera());
    this.controlPanel.onCompare((ids) => this.startCompare(ids));
    this.controlPanel.onCompareStop(() => this.stopCompare());

    // Result overlay actions
    this.resultOverlay.onSortAgain(() => this.handleSort());
    this.resultOverlay.onRandomize(() => this.handleRandomize());
    this.resultOverlay.onCompare(() => {
      // Dismiss the modal first so the compare section it scrolls to is
      // actually reachable (otherwise the overlay blocks the checkboxes).
      this.resultOverlay.hide();
      const section = this.rootContainer.querySelector('#compare-section');
      section?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    // Compare verdict actions
    this.compareOverlay.onRunAgain(() => {
      const ids = this.compareController?.getIds() ?? [];
      if (ids.length >= 2) {
        this.stopCompare();
        this.startCompare(ids);
      }
    });
    this.compareOverlay.onExit(() => this.stopCompare());

    // Renderer hover callback
    this.renderer.onHover((index, value) => {
      const hoverInfo = this.rootContainer.querySelector('#hover-info') as HTMLElement;
      if (index !== null && value !== null) {
        hoverInfo.textContent = `Index: ${index} | Value: ${value}`;
        hoverInfo.style.display = 'block';
      } else {
        hoverInfo.style.display = 'none';
      }
    });

    // View switch: visualizer ↔ benchmark lab
    this.rootContainer
      .querySelector('#tab-visualizer')
      ?.addEventListener('click', () => this.switchView('visualizer'));
    this.rootContainer
      .querySelector('#tab-benchmark')
      ?.addEventListener('click', () => this.switchView('benchmark'));
  }

  private connectSchedulerToRenderer(): void {
    this.scheduler.onUpdate((operations, array, stats, isComplete) => {
      // Update renderer with operations — these are the only source of
      // value/position changes during a sort. Calling updateArray() here
      // would clobber state colors and swap movement every frame.
      if (operations.length > 0) {
        this.renderer.applyOperations(operations);
      }

      // Track the algorithm's working array (for hover info / reset logic)
      this.currentArray = array;

      // Update statistics
      this.statisticsPanel.update(stats);

      // Live graph — the sampler decides whether this frame stores a point
      this.graph.sample(stats.elapsedTime, stats);

      // Update current operation
      if (operations.length > 0) {
        this.operationPanel.update(operations);
      }

      // Update status
      if (isComplete) {
        this.statisticsPanel.setStatus('COMPLETED');
        this.operationPanel.setCompleted();
        this.setState('completed');
        this.graph.freeze();
        this.showFinalResult(stats);
      } else if (this.state === 'sorting') {
        this.statisticsPanel.setStatus('SORTING...');
      }
    });

    this.scheduler.onComplete((finalArray) => {
      this.currentArray = finalArray;
      // Renderer state is already correct (values followed the operations);
      // only apply the final "sorted" highlight.
      this.markAllSorted();
    });
  }

  private updateHeaderDisplays(): void {
    const countDisplay = this.rootContainer.querySelector('#element-count-display');
    if (countDisplay) {
      countDisplay.textContent = `${this.formatNumber(this.config.elementCount)} elements`;
    }

    const algoDisplay = this.rootContainer.querySelector('#algorithm-display');
    if (algoDisplay) {
      algoDisplay.textContent = ALGORITHM_NAMES[this.config.algorithm] || this.config.algorithm;
    }

    const perfBadge = this.rootContainer.querySelector('#perf-badge') as HTMLElement | null;
    if (perfBadge) {
      perfBadge.style.display = isPerformanceCount(this.config.elementCount) ? 'inline-flex' : 'none';
    }

    // Non-blocking long-run warning (shown, never enforced)
    this.controlPanel.setWarning(longRunWarning(this.config.algorithm, this.config.elementCount));
  }

  private async handleConfigChange(config: Partial<SortConfig>): Promise<void> {
    const oldElementCount = this.config.elementCount;
    const oldVizMode = this.config.visualizationMode;
    const oldAlgorithm = this.config.algorithm;

    this.config = { ...this.config, ...config };

    // Handle element count change
    if (config.elementCount && config.elementCount !== oldElementCount) {
      if (this.compareActive) this.stopCompare();
      this.renderer.setElementCount(config.elementCount);
      this.handleRandomize(); // Regenerate array for new count
    }

    // Handle visualization mode change
    if (config.visualizationMode && config.visualizationMode !== oldVizMode) {
      // Presentation-only: the renderer keeps its own logical state
      // (values, slots, owner mapping), so switching modes mid-sort
      // cannot desync the ongoing operation replay. Do NOT re-sync from
      // currentArray here — it runs ahead of the replayed operations.
      this.renderer.setVisualizationMode(config.visualizationMode);
    }

    // Handle algorithm change
    if (config.algorithm && config.algorithm !== oldAlgorithm) {
      this.operationStream.setConfig(this.config);
      this.scheduler.setSpeed(this.config.speed);
    }

    // Handle speed change
    if (config.speed !== undefined) {
      this.scheduler.setSpeed(config.speed);
      this.compareController?.setSpeed(config.speed);
    }

    // Performance Mode throughput: real stream, larger batches (2 000
    // ops/frame vs the normal 500) + snappier renderer animations.
    const effectiveMode = modeForCount(this.config.elementCount);
    this.scheduler.setMaxOperationsPerFrame(schedulerOpsPerFrame(effectiveMode));
    this.renderer.setPerformanceMode(effectiveMode === 'performance');

    this.updateHeaderDisplays();
  }

  private handleRandomize(): void {
    if (this.state === 'sorting' || this.state === 'paused') {
      this.scheduler.stop();
      this.operationStream.stop();
    }
    if (this.compareActive) {
      this.stopCompare();
    }

    this.setState('generating');

    // Generate new array
    this.currentArray = generateArray(this.config.elementCount, this.config.dataDistribution);

    // Update renderer
    this.renderer.reset();
    this.renderer.updateArray(this.currentArray);

    // Reset statistics and operation panel
    this.statisticsPanel.reset();
    this.operationPanel.reset();

    // Reset run-scoped widgets (graph, result overlay) and publish the
    // dataset facts computed from the fresh array.
    this.graph.reset();
    this.resultOverlay.hide();
    const datasetStats = computeDatasetStats(this.currentArray);
    this.controlPanel.setDatasetStats(
      datasetStats,
      DISTRIBUTION_NAMES[this.config.dataDistribution] || this.config.dataDistribution
    );

    this.setState('idle');
  }

  private handleSort(): void {
    if (this.compareActive) return;

    if (this.state === 'sorting') {
      this.handlePause();
      return;
    }

    if (this.state === 'paused') {
      this.handleResume();
      return;
    }

    if (this.state === 'completed') {
      // Re-randomize first, then sort
      this.handleRandomize();
      // Small delay to let UI update
      setTimeout(() => this.startSorting(), 50);
      return;
    }

    this.startSorting();
  }

  private startSorting(): void {
    this.runAlgorithm = this.config.algorithm;
    this.setState('sorting');
    this.statisticsPanel.setStatus('SORTING...');
    this.graph.reset();
    this.scheduler.start(this.currentArray);
  }

  private handlePause(): void {
    if (this.state !== 'sorting') return;
    this.scheduler.pause();
    this.setState('paused');
    this.statisticsPanel.setStatus('PAUSED');
  }

  private handleResume(): void {
    if (this.state !== 'paused') return;
    this.scheduler.resume();
    this.setState('sorting');
    this.statisticsPanel.setStatus('SORTING...');
  }

  private handleReset(): void {
    // Stop everything (single sort and/or compare)
    this.scheduler.stop();
    this.operationStream.stop();
    if (this.compareActive) this.stopCompare();

    this.handleRandomize();
  }

  private handleResetCamera(): void {
    this.renderer.resetCamera();
  }

  /**
   * Switch between the 3D visualizer and the Benchmark Lab.
   *
   * Entering the lab stops any active sort/compare and suspends the WebGL
   * render loop (no extra contexts, no competing frames). Leaving the lab
   * aborts in-flight benchmark work so the visualizer never shares the CPU
   * with background runs.
   */
  switchView(view: 'visualizer' | 'benchmark'): void {
    if (view === this.currentView) return;
    const appContainer = this.rootContainer.querySelector('.app-container');

    if (view === 'benchmark') {
      if (this.state === 'sorting' || this.state === 'paused') this.handleReset();
      if (this.compareActive) this.stopCompare();
      this.renderer.setSuspended(true);
      appContainer?.classList.add('view-benchmark');
    } else {
      this.benchmarkLab.cancelActive();
      appContainer?.classList.remove('view-benchmark');
      this.renderer.setSuspended(false);
    }

    this.currentView = view;
    this.rootContainer
      .querySelector('#tab-visualizer')
      ?.classList.toggle('active', view === 'visualizer');
    this.rootContainer
      .querySelector('#tab-benchmark')
      ?.classList.toggle('active', view === 'benchmark');
  }

  getView(): 'visualizer' | 'benchmark' {
    return this.currentView;
  }

  /**
   * VISUALIZE WINNER — load the benchmark's exact source array + winning
   * algorithm into the normal 3D pipeline and start the sort, so the user
   * can watch the measurement they just read about.
   */
  private visualizeWinner(payload: VisualizeWinnerPayload): void {
    if (this.state === 'sorting' || this.state === 'paused') {
      this.scheduler.stop();
      this.operationStream.stop();
    }
    if (this.compareActive) this.stopCompare();

    this.switchView('visualizer');

    const effectiveMode = modeForCount(payload.array.length);
    this.config = {
      ...this.config,
      algorithm: payload.algorithmId,
      elementCount: payload.array.length,
      dataDistribution: payload.dataset,
      performanceMode: effectiveMode,
    };

    // Sync every consumer of the config (panel selects, stream, scheduler, renderer)
    this.controlPanel.setConfig({
      algorithm: payload.algorithmId,
      elementCount: payload.array.length,
      dataDistribution: payload.dataset,
      performanceMode: effectiveMode,
    });
    this.operationStream.setConfig(this.config);
    this.scheduler.setSpeed(this.config.speed);
    this.scheduler.setMaxOperationsPerFrame(schedulerOpsPerFrame(effectiveMode));
    this.renderer.setPerformanceMode(effectiveMode === 'performance');
    this.renderer.setElementCount(payload.array.length);

    // Load the exact benchmark source array (not a regenerated one)
    this.currentArray = payload.array.slice();
    this.setState('generating');
    this.renderer.reset();
    this.renderer.updateArray(this.currentArray);
    this.statisticsPanel.reset();
    this.operationPanel.reset();
    this.graph.reset();
    this.resultOverlay.hide();
    this.controlPanel.setDatasetStats(
      computeDatasetStats(this.currentArray),
      DISTRIBUTION_NAMES[payload.dataset] || payload.dataset
    );
    this.setState('idle');
    this.updateHeaderDisplays();

    // Watch the winner actually work
    this.startSorting();
  }

  private markAllSorted(): void {
    const indices = Array.from({ length: this.currentArray.length }, (_, i) => i);
    this.renderer.markSorted(indices);
  }

  private showFinalResult(stats: {
    elapsedTime: number;
    comparisons: number;
    swaps: number;
    operations: number;
  }): void {
    const algorithm = this.runAlgorithm ?? this.config.algorithm;
    const algorithmName = ALGORITHM_NAMES[algorithm] || algorithm;

    const entry: RunHistoryEntry = {
      algorithm,
      algorithmName,
      elementCount: this.config.elementCount,
      elapsedMs: stats.elapsedTime,
      comparisons: stats.comparisons,
      swaps: stats.swaps,
      operations: stats.operations,
      timestamp: Date.now(),
    };
    this.historyPanel.add(entry);

    this.resultOverlay.show({
      algorithmName,
      elementCount: this.config.elementCount,
      elapsedMs: stats.elapsedTime,
      comparisons: stats.comparisons,
      swaps: stats.swaps,
      operations: stats.operations,
    });
  }

  // ------------------------------------------------------------------
  // Compare Mode
  // ------------------------------------------------------------------

  private startCompare(ids: AlgorithmId[]): void {
    if (this.compareActive) return;
    if (this.state === 'sorting' || this.state === 'paused') return;

    const validation = validateSelection(ids);
    if (!validation.ok) {
      console.warn(`Compare Mode: ${validation.error}`);
      return;
    }

    // Everyone gets the same freshly generated input array
    this.handleRandomize();
    const base = [...this.currentArray];
    const count = this.config.elementCount;

    const container = this.rootContainer.querySelector('#canvas-container') as HTMLElement;
    this.laneLayout = computeLaneLayout(ids.length, container.clientWidth, container.clientHeight);

    for (const id of ids) {
      const lane = new CompareLane(count);
      lane.updateArray(base);
      this.compareLanes.set(id, lane);
    }

    this.compareController = new CompareController(ids, base, this.config, {
      onLaneUpdate: (id, operations, stats) => {
        this.compareLanes.get(id)?.applyOperations(operations);
        this.compareOverlay.updateLane(id, stats);
      },
      onLaneComplete: (id, result) => {
        // Final stats for this lane (verdicts are computed when everyone
        // has finished) — force-refresh the label with the terminal
        // numbers so it always ends at 100%.
        this.compareOverlay.updateLane(
          id,
          {
            comparisons: result.comparisons,
            swaps: result.swaps,
            arrayAccesses: result.arrayAccesses,
            operations: result.operations,
            elapsedTime: result.elapsedMs,
            progress: 1,
          },
          true
        );
      },
      onAllComplete: (results, verdicts) => this.onCompareAllComplete(results, verdicts),
    });

    this.renderer.setCompareRenderFn((gl) => this.renderCompareLanes(gl));
    this.compareOverlay.showLanes(ids, this.laneLayout);
    this.controlPanel.setCompareActive(true);
    this.compareActive = true;
    this.statisticsPanel.setStatus('COMPARE...');

    this.compareController.start();
  }

  private renderCompareLanes(gl: THREE.WebGLRenderer): void {
    if (!this.laneLayout) return;
    const container = this.rootContainer.querySelector('#canvas-container') as HTMLElement;
    const height = container.clientHeight;
    let i = 0;
    for (const lane of this.compareLanes.values()) {
      const rect = this.laneLayout.lanes[i++];
      if (rect) lane.render(gl, rect, height);
    }
  }

  private onCompareAllComplete(results: CompareResult[], verdicts: CompareVerdicts): void {
    this.compareOverlay.showVerdicts(results, verdicts);
    this.statisticsPanel.setStatus('COMPLETED');
  }

  private stopCompare(): void {
    if (this.compareController) {
      this.compareController.stop();
      this.compareController = null;
    }
    for (const lane of this.compareLanes.values()) {
      lane.dispose();
    }
    this.compareLanes.clear();
    this.laneLayout = null;
    this.renderer.setCompareRenderFn(null);
    this.compareOverlay.hide();
    this.controlPanel.setCompareActive(false);
    this.compareActive = false;
    this.statisticsPanel.setStatus('IDLE');
    this.setState('idle');
  }

  private handleWindowResize(): void {
    if (this.compareActive && this.laneLayout) {
      const container = this.rootContainer.querySelector('#canvas-container') as HTMLElement;
      this.laneLayout = computeLaneLayout(
        this.compareLanes.size,
        container.clientWidth,
        container.clientHeight
      );
      this.compareOverlay.layout(this.laneLayout.lanes);
    }
  }

  private setState(state: AppState): void {
    this.state = state;
    this.controlPanel.setState(state);
    this.onStateChangeCallback?.(state);
  }

  private formatNumber(num: number): string {
    return num.toLocaleString();
  }

  onStateChange(callback: (state: AppState) => void): void {
    this.onStateChangeCallback = callback;
  }

  getState(): AppState {
    return this.state;
  }

  getConfig(): SortConfig {
    return { ...this.config };
  }

  getRenderer(): SortRenderer {
    return this.renderer;
  }

  dispose(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.scheduler.stop();
    this.operationStream.stop();
    if (this.compareController) this.compareController.stop();
    for (const lane of this.compareLanes.values()) lane.dispose();
    this.compareLanes.clear();
    this.graph.dispose();
    this.benchmarkLab.dispose();
    this.renderer.dispose();
  }
}
