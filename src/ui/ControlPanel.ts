/**
 * Control Panel UI Component
 */

import type {
  AlgorithmId,
  VisualizationMode,
  DataDistribution,
  SortConfig,
  AppState,
  PerformanceMode,
  DatasetStats,
} from '../types';
import { AlgorithmRegistry } from '../algorithms';
import { getInspectorData } from '../algorithms/inspector';
import { countsForMode, defaultCountForMode, isPerformanceCount } from '../utils/perfMode';

function formatCount(n: number): string {
  return n.toLocaleString('en-US').replace(/,/g, ' ');
}

export class ControlPanel {
  private container: HTMLElement;
  private config: SortConfig;
  private callbacks: {
    onConfigChange?: (config: Partial<SortConfig>) => void;
    onRandomize?: () => void;
    onSort?: () => void;
    onPause?: () => void;
    onResume?: () => void;
    onReset?: () => void;
    onResetCamera?: () => void;
    onCompare?: (ids: AlgorithmId[]) => void;
    onCompareStop?: () => void;
  } = {};

  private elements: {
    algorithmSelect: HTMLSelectElement;
    elementCountSelect: HTMLSelectElement;
    customCountInput: HTMLInputElement;
    visualizationSelect: HTMLSelectElement;
    speedSlider: HTMLInputElement;
    speedValue: HTMLElement;
    distributionSelect: HTMLSelectElement;
    randomizeBtn: HTMLButtonElement;
    sortBtn: HTMLButtonElement;
    pauseBtn: HTMLButtonElement;
    resetBtn: HTMLButtonElement;
    resetCameraBtn: HTMLButtonElement;
    inspectorToggle: HTMLButtonElement;
    inspectorBody: HTMLElement;
    inspectorTitle: HTMLElement;
    inspectorTag: HTMLElement;
    modeNormalBtn: HTMLButtonElement;
    modePerfBtn: HTMLButtonElement;
    perfChip: HTMLElement;
    warningBox: HTMLElement;
    datasetCard: HTMLElement;
    datasetName: HTMLElement;
    datasetDetail: HTMLElement;
    compareBtn: HTMLButtonElement;
    compareHint: HTMLElement;
    compareChecks: HTMLInputElement[];
  } = {} as any;

  private currentState: AppState = 'idle';
  private compareActive = false;
  private compareSelection: AlgorithmId[] = ['quick', 'merge', 'heap'];

  constructor(container: HTMLElement, initialConfig: SortConfig) {
    this.container = container;
    this.config = { ...initialConfig };
    this.render();
    this.bindEvents();
    this.updateAlgorithmInfo();
    this.updateCompareHint();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="control-panel">
        <div class="panel-section">
          <h2>SORTING ALGORITHM</h2>
          <div class="control-group">
            <label for="algorithm-select">Algorithm</label>
            <select id="algorithm-select" class="control-select">
              ${this.getAlgorithmOptions()}
            </select>
          </div>
          <div class="inspector">
            <button id="inspector-toggle" class="inspector-toggle" aria-expanded="false">
              <span class="inspector-heading">
                <span class="inspector-title" id="inspector-title">Quick Sort</span>
                <span class="inspector-tag" id="inspector-tag">Divide &amp; Conquer</span>
              </span>
              <span class="inspector-chevron">▾</span>
            </button>
            <div id="algorithm-info" class="inspector-body" hidden></div>
          </div>
        </div>

        <div class="panel-section">
          <h2>ELEMENTS</h2>
          <div class="mode-toggle" role="group" aria-label="Element count mode">
            <button id="mode-normal" class="mode-btn active" type="button">NORMAL</button>
            <button id="mode-perf" class="mode-btn" type="button">PERFORMANCE</button>
          </div>
          <div class="control-group">
            <label for="element-count">Count</label>
            <div class="input-group">
              <select id="element-count" class="control-select"></select>
              <input type="number" id="custom-count" class="control-input" placeholder="1 – 100000" min="1" max="100000" style="display: none;">
            </div>
            <span id="perf-chip" class="perf-chip" style="display: none;">PERFORMANCE MODE</span>
          </div>
          <div id="long-run-warning" class="long-run-warning" style="display: none;"></div>
          <div class="control-group">
            <label for="distribution">Data Distribution</label>
            <select id="distribution" class="control-select">
              <option value="random">Random</option>
              <option value="nearly-sorted">Nearly Sorted</option>
              <option value="reversed">Reversed</option>
              <option value="few-unique">Few Unique</option>
            </select>
            <div id="dataset-card" class="dataset-card" style="display: none;">
              <span class="dataset-label">DATASET</span>
              <span class="dataset-name" id="dataset-name">Random</span>
              <span class="dataset-detail" id="dataset-detail"></span>
            </div>
          </div>
        </div>

        <div class="panel-section">
          <h2>VISUALIZATION</h2>
          <div class="control-group">
            <label for="viz-mode">Mode</label>
            <select id="viz-mode" class="control-select">
              <option value="cubes">3D Cubes</option>
              <option value="bars">3D Bars</option>
              <option value="numbers">Numbers</option>
            </select>
          </div>
          <div class="control-group">
            <label for="speed">Speed <span id="speed-value">1.0x</span></label>
            <input type="range" id="speed" class="control-slider" min="0.1" max="10" step="0.1" value="1">
          </div>
        </div>

        <div class="panel-section">
          <h2>CONTROLS</h2>
          <div class="button-group">
            <button id="randomize-btn" class="btn btn-primary">RANDOMIZE</button>
            <button id="sort-btn" class="btn btn-success">SORT</button>
            <button id="pause-btn" class="btn btn-warning" disabled>PAUSE</button>
            <button id="reset-btn" class="btn btn-secondary">RESET</button>
            <button id="reset-camera-btn" class="btn btn-secondary">RESET CAMERA</button>
          </div>
        </div>

        <div class="panel-section" id="compare-section">
          <h2>COMPARE MODE</h2>
          <div class="compare-select-list">
            ${this.getCompareOptions()}
          </div>
          <button id="compare-btn" class="btn btn-compare">START COMPARE</button>
          <div id="compare-hint" class="compare-hint"></div>
        </div>
      </div>
    `;

    this.cacheElements();
    this.renderElementOptions();
    this.applyConfig();
    this.syncModeButtons();
  }

  private getAlgorithmOptions(): string {
    const algorithms = AlgorithmRegistry.getAll();
    return Array.from(algorithms.entries()).map(([id, AlgorithmClass]) => {
      const instance = new AlgorithmClass(this.config);
      const info = instance.getInfo();
      return `<option value="${id}">${info.name}</option>`;
    }).join('');
  }

  private getCompareOptions(): string {
    const algorithms = AlgorithmRegistry.getAll();
    return Array.from(algorithms.entries()).map(([id, AlgorithmClass]) => {
      const instance = new AlgorithmClass(this.config);
      const info = instance.getInfo();
      const checked = this.compareSelection.includes(id as AlgorithmId) ? 'checked' : '';
      return `
        <label class="compare-check">
          <input type="checkbox" class="compare-checkbox" value="${id}" ${checked}>
          <span class="compare-check-label">${info.name}</span>
        </label>`;
    }).join('');
  }

  /** Rebuild the count <select> for the active NORMAL/PERFORMANCE mode. */
  private renderElementOptions(): void {
    const mode = this.config.performanceMode ?? 'normal';
    const counts = countsForMode(mode);
    const label = mode === 'performance' ? 'PERFORMANCE' : 'NORMAL';
    const options = counts
      .map((c) => `<option value="${c}">${formatCount(c)}</option>`)
      .join('');
    this.elements.elementCountSelect.innerHTML = `
      <optgroup label="${label}">${options}</optgroup>
      <option value="custom">Custom</option>`;
  }

  private cacheElements(): void {
    this.elements = {
      algorithmSelect: this.container.querySelector('#algorithm-select')!,
      elementCountSelect: this.container.querySelector('#element-count')!,
      customCountInput: this.container.querySelector('#custom-count')!,
      visualizationSelect: this.container.querySelector('#viz-mode')!,
      speedSlider: this.container.querySelector('#speed')!,
      speedValue: this.container.querySelector('#speed-value')!,
      distributionSelect: this.container.querySelector('#distribution')!,
      randomizeBtn: this.container.querySelector('#randomize-btn')!,
      sortBtn: this.container.querySelector('#sort-btn')!,
      pauseBtn: this.container.querySelector('#pause-btn')!,
      resetBtn: this.container.querySelector('#reset-btn')!,
      resetCameraBtn: this.container.querySelector('#reset-camera-btn')!,
      inspectorToggle: this.container.querySelector('#inspector-toggle')!,
      inspectorBody: this.container.querySelector('#algorithm-info')!,
      inspectorTitle: this.container.querySelector('#inspector-title')!,
      inspectorTag: this.container.querySelector('#inspector-tag')!,
      modeNormalBtn: this.container.querySelector('#mode-normal')!,
      modePerfBtn: this.container.querySelector('#mode-perf')!,
      perfChip: this.container.querySelector('#perf-chip')!,
      warningBox: this.container.querySelector('#long-run-warning')!,
      datasetCard: this.container.querySelector('#dataset-card')!,
      datasetName: this.container.querySelector('#dataset-name')!,
      datasetDetail: this.container.querySelector('#dataset-detail')!,
      compareBtn: this.container.querySelector('#compare-btn')!,
      compareHint: this.container.querySelector('#compare-hint')!,
      compareChecks: Array.from(this.container.querySelectorAll<HTMLInputElement>('.compare-checkbox')),
    };
  }

  private bindEvents(): void {
    this.elements.algorithmSelect.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.config.algorithm = target.value as AlgorithmId;
      this.updateAlgorithmInfo();
      this.callbacks.onConfigChange?.({ algorithm: this.config.algorithm });
    });

    this.elements.elementCountSelect.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      const value = target.value;
      if (value === 'custom') {
        // Keep the select visible so the user can switch back to presets
        this.elements.customCountInput.style.display = 'block';
        this.elements.customCountInput.focus();
      } else {
        this.elements.customCountInput.style.display = 'none';
        this.elements.customCountInput.classList.remove('invalid');
        this.config.elementCount = parseInt(value, 10);
        this.updatePerfChip();
        this.callbacks.onConfigChange?.({ elementCount: this.config.elementCount });
      }
    });

    this.elements.customCountInput.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const value = parseInt(target.value, 10);
      if (Number.isInteger(value) && value >= 1 && value <= 100000) {
        // Valid: accept and apply
        target.classList.remove('invalid');
        this.config.elementCount = value;
        this.updatePerfChip();
        this.callbacks.onConfigChange?.({ elementCount: this.config.elementCount });
      } else {
        // Invalid: reject the input and keep the previous element count
        target.classList.add('invalid');
        target.value = '';
        target.placeholder = 'Enter 1 – 100000';
      }
    });

    this.elements.visualizationSelect.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.config.visualizationMode = target.value as VisualizationMode;
      this.callbacks.onConfigChange?.({ visualizationMode: this.config.visualizationMode });
    });

    this.elements.speedSlider.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const value = parseFloat(target.value);
      this.config.speed = value;
      this.elements.speedValue.textContent = `${value.toFixed(1)}x`;
      this.callbacks.onConfigChange?.({ speed: this.config.speed });
    });

    this.elements.distributionSelect.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.config.dataDistribution = target.value as DataDistribution;
      this.callbacks.onConfigChange?.({ dataDistribution: this.config.dataDistribution });
    });

    this.elements.modeNormalBtn.addEventListener('click', () => this.switchPerformanceMode('normal'));
    this.elements.modePerfBtn.addEventListener('click', () => this.switchPerformanceMode('performance'));

    this.elements.inspectorToggle.addEventListener('click', () => {
      const body = this.elements.inspectorBody;
      const collapsed = body.hasAttribute('hidden');
      if (collapsed) {
        body.removeAttribute('hidden');
      } else {
        body.setAttribute('hidden', '');
      }
      this.elements.inspectorToggle.setAttribute('aria-expanded', String(collapsed));
      this.elements.inspectorToggle.classList.toggle('open', collapsed);
    });

    for (const check of this.elements.compareChecks) {
      check.addEventListener('change', () => {
        this.compareSelection = this.elements.compareChecks
          .filter((c) => c.checked)
          .map((c) => c.value as AlgorithmId);
        this.updateCompareHint();
      });
    }

    this.elements.compareBtn.addEventListener('click', () => {
      if (this.compareActive) {
        this.callbacks.onCompareStop?.();
      } else {
        this.callbacks.onCompare?.(this.compareSelection);
      }
    });

    this.elements.randomizeBtn.addEventListener('click', () => {
      this.callbacks.onRandomize?.();
    });

    this.elements.sortBtn.addEventListener('click', () => {
      if (this.currentState === 'sorting') {
        this.callbacks.onPause?.();
      } else if (this.currentState === 'paused') {
        this.callbacks.onResume?.();
      } else {
        this.callbacks.onSort?.();
      }
    });

    this.elements.pauseBtn.addEventListener('click', () => {
      if (this.currentState === 'sorting') {
        this.callbacks.onPause?.();
      } else {
        this.callbacks.onResume?.();
      }
    });

    this.elements.resetBtn.addEventListener('click', () => {
      this.callbacks.onReset?.();
    });

    this.elements.resetCameraBtn.addEventListener('click', () => {
      this.callbacks.onResetCamera?.();
    });
  }

  private switchPerformanceMode(mode: PerformanceMode): void {
    const current = this.config.performanceMode ?? 'normal';
    if (current === mode) return;

    this.config.performanceMode = mode;
    const newCount = defaultCountForMode(mode, this.config.elementCount);
    const countChanged = newCount !== this.config.elementCount;
    this.config.elementCount = newCount;

    this.renderElementOptions();
    this.syncModeButtons();
    this.applyConfig();

    this.callbacks.onConfigChange?.({
      performanceMode: mode,
      ...(countChanged ? { elementCount: newCount } : {}),
    });
  }

  private syncModeButtons(): void {
    const mode = this.config.performanceMode ?? 'normal';
    this.elements.modeNormalBtn.classList.toggle('active', mode === 'normal');
    this.elements.modePerfBtn.classList.toggle('active', mode === 'performance');
    this.updatePerfChip();
  }

  private updatePerfChip(): void {
    const perf = isPerformanceCount(this.config.elementCount);
    this.elements.perfChip.style.display = perf ? 'inline-block' : 'none';
    if (perf) {
      this.elements.perfChip.textContent = `${formatCount(this.config.elementCount)} ELEMENTS · PERFORMANCE MODE`;
    }
  }

  private applyConfig(): void {
    this.elements.algorithmSelect.value = this.config.algorithm;

    const countValue = String(this.config.elementCount);
    const hasPreset = Array.from(this.elements.elementCountSelect.options).some(
      (o) => o.value === countValue
    );
    if (hasPreset) {
      this.elements.elementCountSelect.value = countValue;
      this.elements.customCountInput.style.display = 'none';
    } else {
      this.elements.elementCountSelect.value = 'custom';
      this.elements.customCountInput.style.display = 'block';
      this.elements.customCountInput.value = countValue;
    }
    this.updatePerfChip();

    this.elements.visualizationSelect.value = this.config.visualizationMode;
    this.elements.speedSlider.value = String(this.config.speed);
    this.elements.speedValue.textContent = `${this.config.speed.toFixed(1)}x`;
    this.elements.distributionSelect.value = this.config.dataDistribution;
    this.syncModeButtons();
  }

  private updateAlgorithmInfo(): void {
    const data = getInspectorData(this.config.algorithm, this.config);
    if (!data) return;

    this.elements.inspectorTitle.textContent = data.name.toUpperCase();
    this.elements.inspectorTag.textContent = data.tag;
    this.elements.inspectorBody.innerHTML = `
      <div class="algo-complexity">
        <div class="complexity-row">
          <span class="complexity-label">BEST</span>
          <span class="complexity-value">${data.bestComplexity}</span>
        </div>
        <div class="complexity-row">
          <span class="complexity-label">AVERAGE</span>
          <span class="complexity-value">${data.averageComplexity}</span>
        </div>
        <div class="complexity-row">
          <span class="complexity-label">WORST</span>
          <span class="complexity-value">${data.worstComplexity}</span>
        </div>
        <div class="complexity-row">
          <span class="complexity-label">SPACE</span>
          <span class="complexity-value">${data.spaceComplexity}</span>
        </div>
        <div class="complexity-row">
          <span class="complexity-label">STABLE</span>
          <span class="complexity-value">${data.stable ? 'Yes' : 'No'}</span>
        </div>
      </div>
      <p class="algo-description">${data.description}</p>
    `;
  }

  /** Non-blocking long-run warning (shown, never enforced). */
  setWarning(message: string | null): void {
    const box = this.elements.warningBox;
    if (message) {
      box.textContent = message;
      box.style.display = 'block';
    } else {
      box.textContent = '';
      box.style.display = 'none';
    }
  }

  /** DATASET card — values are computed from the real generated array. */
  setDatasetStats(stats: DatasetStats, distributionName: string): void {
    this.elements.datasetCard.style.display = 'block';
    this.elements.datasetName.textContent = distributionName;
    const percent = (stats.ascendingFraction * 100).toFixed(1);
    this.elements.datasetDetail.textContent =
      stats.count > 1
        ? `${percent}% already ascending · ${stats.uniqueCount.toLocaleString('en-US')} unique`
        : `${stats.count} element`;
  }

  private updateCompareHint(): void {
    const n = this.compareSelection.length;
    const hint = this.elements.compareHint;
    if (n < 2) {
      hint.textContent = 'Select at least 2 algorithms.';
      hint.classList.remove('hint-warning');
      this.elements.compareBtn.disabled = true;
      return;
    }
    // Compare can't start while a single sort is running or while it is
    // already active (in that case the button acts as STOP).
    const busy = this.compareActive || this.currentState === 'sorting' || this.currentState === 'paused';
    this.elements.compareBtn.disabled = this.compareActive ? false : busy;
    if (this.compareSelection.includes('bubble') && n >= 3) {
      hint.textContent = `${n} algorithms · Bubble Sort may take much longer than the others.`;
      hint.classList.add('hint-warning');
    } else {
      hint.textContent = `${n} algorithms · identical input array for everyone.`;
      hint.classList.remove('hint-warning');
    }
  }

  setCompareActive(active: boolean): void {
    this.compareActive = active;
    this.elements.compareBtn.textContent = active ? 'STOP COMPARE' : 'START COMPARE';
    this.elements.compareBtn.classList.toggle('stop', active);
    for (const check of this.elements.compareChecks) {
      check.disabled = active;
    }
    this.updateCompareHint();
    // Single-run controls are locked while compare lanes own the screen
    this.setState(this.currentState);
    if (active) {
      this.elements.sortBtn.disabled = true;
      this.elements.randomizeBtn.disabled = true;
    }
  }

  setState(state: AppState): void {
    this.currentState = state;

    switch (state) {
      case 'idle':
      case 'generating':
        this.elements.sortBtn.textContent = 'SORT';
        this.elements.sortBtn.className = 'btn btn-success';
        this.elements.sortBtn.disabled = this.compareActive;
        this.elements.pauseBtn.disabled = true;
        this.elements.pauseBtn.textContent = 'PAUSE';
        break;
      case 'sorting':
        this.elements.sortBtn.textContent = 'PAUSE';
        this.elements.sortBtn.className = 'btn btn-warning';
        this.elements.sortBtn.disabled = false;
        this.elements.pauseBtn.disabled = false;
        this.elements.pauseBtn.textContent = 'PAUSE';
        break;
      case 'paused':
        this.elements.sortBtn.textContent = 'RESUME';
        this.elements.sortBtn.className = 'btn btn-success';
        this.elements.sortBtn.disabled = false;
        this.elements.pauseBtn.disabled = false;
        this.elements.pauseBtn.textContent = 'RESUME';
        break;
      case 'completed':
        this.elements.sortBtn.textContent = 'SORT';
        this.elements.sortBtn.className = 'btn btn-success';
        this.elements.sortBtn.disabled = this.compareActive;
        this.elements.pauseBtn.disabled = true;
        this.elements.pauseBtn.textContent = 'PAUSE';
        break;
    }
    if (this.compareActive) {
      this.elements.randomizeBtn.disabled = true;
    } else {
      this.elements.randomizeBtn.disabled = false;
    }
    // Keep the compare button in sync with run state (disabled while a
    // single sort is in progress, STOP when compare is active).
    this.updateCompareHint();
  }

  getConfig(): SortConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<SortConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.performanceMode !== undefined) {
      this.renderElementOptions();
      this.syncModeButtons();
    }
    this.applyConfig();
    if (config.algorithm) {
      this.updateAlgorithmInfo();
    }
  }

  onConfigChange(callback: (config: Partial<SortConfig>) => void): void {
    this.callbacks.onConfigChange = callback;
  }

  onRandomize(callback: () => void): void {
    this.callbacks.onRandomize = callback;
  }

  onSort(callback: () => void): void {
    this.callbacks.onSort = callback;
  }

  onPause(callback: () => void): void {
    this.callbacks.onPause = callback;
  }

  onResume(callback: () => void): void {
    this.callbacks.onResume = callback;
  }

  onReset(callback: () => void): void {
    this.callbacks.onReset = callback;
  }

  onResetCamera(callback: () => void): void {
    this.callbacks.onResetCamera = callback;
  }

  onCompare(callback: (ids: AlgorithmId[]) => void): void {
    this.callbacks.onCompare = callback;
  }

  onCompareStop(callback: () => void): void {
    this.callbacks.onCompareStop = callback;
  }
}
