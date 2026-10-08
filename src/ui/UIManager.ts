/**
 * UI Manager - coordinates all UI components and connects them to simulation/renderer
 */

import type { SortConfig, AppState } from '../types';
import { ControlPanel } from './ControlPanel';
import { StatisticsPanel } from './StatisticsPanel';
import { CurrentOperationPanel } from './CurrentOperationPanel';
import { SortRenderer } from '../rendering';
import { OperationStream } from '../simulation';
import { AnimationScheduler } from '../simulation';
import { generateArray } from '../simulation';

export class UIManager {
  private rootContainer: HTMLElement;
  private renderer: SortRenderer;
  private operationStream: OperationStream;
  private scheduler: AnimationScheduler;

  private controlPanel: ControlPanel;
  private statisticsPanel: StatisticsPanel;
  private operationPanel: CurrentOperationPanel;

  private config: SortConfig;
  private state: AppState = 'idle';
  private currentArray: number[] = [];

  // Callbacks for external control
  private onStateChangeCallback: ((state: AppState) => void) | null = null;

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

    // Initialize simulation
    this.operationStream = new OperationStream(this.config);
    this.scheduler = new AnimationScheduler(this.operationStream, {
      targetFPS: 60,
      maxOperationsPerFrame: 500,
      speedMultiplier: this.config.speed,
    });

    // Initialize UI panels
    const controlContainer = this.rootContainer.querySelector('#control-panel') as HTMLElement;
    const statsContainer = this.rootContainer.querySelector('#stats-panel') as HTMLElement;
    const opContainer = this.rootContainer.querySelector('#operation-panel') as HTMLElement;

    this.controlPanel = new ControlPanel(controlContainer, this.config);
    this.statisticsPanel = new StatisticsPanel(statsContainer);
    this.operationPanel = new CurrentOperationPanel(opContainer);

    // Wire everything together
    this.bindCallbacks();
    this.connectSchedulerToRenderer();
    this.connectSchedulerToUI();

    // Generate the initial array so the first frame shows real data
    this.handleRandomize();
  }

  private createLayout(): void {
    this.rootContainer.innerHTML = `
      <div class="app-container">
        <header class="app-header">
          <h1>SORTING VISUALIZER</h1>
          <div class="header-info">
            <span id="element-count-display">10 000 elements</span>
            <span id="algorithm-display">Quick Sort</span>
          </div>
        </header>
        <div class="app-main">
          <div class="canvas-wrapper">
            <div id="canvas-container"></div>
            <div class="canvas-overlay">
              <div class="hover-info" id="hover-info" style="display: none;"></div>
            </div>
          </div>
          <div class="panels-wrapper">
            <div id="control-panel" class="side-panel"></div>
            <div id="stats-panel" class="side-panel"></div>
            <div id="operation-panel" class="side-panel"></div>
          </div>
        </div>
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

      // Update current operation
      if (operations.length > 0) {
        this.operationPanel.update(operations);
      }

      // Update status
      if (isComplete) {
        this.statisticsPanel.setStatus('COMPLETED');
        this.operationPanel.setCompleted();
        this.setState('completed');
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

  private connectSchedulerToUI(): void {
    // Update element count display
    const countDisplay = this.rootContainer.querySelector('#element-count-display');
    if (countDisplay) {
      countDisplay.textContent = `${this.formatNumber(this.config.elementCount)} elements`;
    }

    // Update algorithm display
    const algoDisplay = this.rootContainer.querySelector('#algorithm-display');
    if (algoDisplay) {
      const algoNames: Record<string, string> = {
        bubble: 'Bubble Sort',
        quick: 'Quick Sort',
        merge: 'Merge Sort',
        heap: 'Heap Sort',
      };
      algoDisplay.textContent = algoNames[this.config.algorithm] || this.config.algorithm;
    }
  }

  private async handleConfigChange(config: Partial<SortConfig>): Promise<void> {
    const oldElementCount = this.config.elementCount;
    const oldVizMode = this.config.visualizationMode;
    const oldAlgorithm = this.config.algorithm;

    this.config = { ...this.config, ...config };

    // Handle element count change
    if (config.elementCount && config.elementCount !== oldElementCount) {
      this.renderer.setElementCount(config.elementCount);
      this.scheduler.setMaxOperationsPerFrame(Math.max(100, Math.floor(500000 / config.elementCount)));
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
    }

    // Update header displays
    const countDisplay = this.rootContainer.querySelector('#element-count-display');
    if (countDisplay) {
      countDisplay.textContent = `${this.formatNumber(this.config.elementCount)} elements`;
    }

    const algoDisplay = this.rootContainer.querySelector('#algorithm-display');
    if (algoDisplay) {
      const algoNames: Record<string, string> = {
        bubble: 'Bubble Sort',
        quick: 'Quick Sort',
        merge: 'Merge Sort',
        heap: 'Heap Sort',
      };
      algoDisplay.textContent = algoNames[this.config.algorithm] || this.config.algorithm;
    }
  }

  private handleRandomize(): void {
    if (this.state === 'sorting' || this.state === 'paused') {
      this.scheduler.stop();
      this.operationStream.stop();
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

    this.setState('idle');
  }

  private handleSort(): void {
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
    this.setState('sorting');
    this.statisticsPanel.setStatus('SORTING...');
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
    // Stop everything
    this.scheduler.stop();
    this.operationStream.stop();

    // Reset to initial state
    this.currentArray = generateArray(this.config.elementCount, this.config.dataDistribution);
    this.renderer.reset();
    this.renderer.updateArray(this.currentArray);
    this.statisticsPanel.reset();
    this.operationPanel.reset();

    this.setState('idle');
  }

  private handleResetCamera(): void {
    this.renderer.resetCamera();
  }

  private markAllSorted(): void {
    const indices = Array.from({ length: this.currentArray.length }, (_, i) => i);
    this.renderer.markSorted(indices);
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
    this.scheduler.stop();
    this.operationStream.stop();
    this.renderer.dispose();
  }
}