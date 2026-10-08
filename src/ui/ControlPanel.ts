/**
 * Control Panel UI Component
 */

import type { AlgorithmId, VisualizationMode, DataDistribution, SortConfig, AppState } from '../types';
import { AlgorithmRegistry } from '../algorithms';

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
    algorithmInfo: HTMLElement;
  } = {} as any;

  private currentState: AppState = 'idle';

  constructor(container: HTMLElement, initialConfig: SortConfig) {
    this.container = container;
    this.config = { ...initialConfig };
    this.render();
    this.bindEvents();
    this.updateAlgorithmInfo();
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
          <div id="algorithm-info" class="algorithm-info"></div>
        </div>

        <div class="panel-section">
          <h2>ELEMENTS</h2>
          <div class="control-group">
            <label for="element-count">Count</label>
            <div class="input-group">
              <select id="element-count" class="control-select">
                <option value="1000">1 000</option>
                <option value="5000">5 000</option>
                <option value="10000" selected>10 000</option>
                <option value="25000">25 000</option>
                <option value="50000">50 000</option>
                <option value="100000">100 000</option>
                <option value="custom">Custom</option>
              </select>
              <input type="number" id="custom-count" class="control-input" placeholder="1 – 100000" min="1" max="100000" style="display: none;">
            </div>
          </div>
          <div class="control-group">
            <label for="distribution">Data Distribution</label>
            <select id="distribution" class="control-select">
              <option value="random">Random</option>
              <option value="nearly-sorted">Nearly Sorted</option>
              <option value="reversed">Reversed</option>
              <option value="few-unique">Few Unique</option>
            </select>
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
      </div>
    `;

    this.cacheElements();
    this.applyConfig();
  }

  private getAlgorithmOptions(): string {
    const algorithms = AlgorithmRegistry.getAll();
    return Array.from(algorithms.entries()).map(([id, AlgorithmClass]) => {
      const instance = new AlgorithmClass(this.config);
      const info = instance.getInfo();
      return `<option value="${id}">${info.name}</option>`;
    }).join('');
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
      algorithmInfo: this.container.querySelector('#algorithm-info')!,
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

    this.elements.visualizationSelect.value = this.config.visualizationMode;
    this.elements.speedSlider.value = String(this.config.speed);
    this.elements.speedValue.textContent = `${this.config.speed.toFixed(1)}x`;
    this.elements.distributionSelect.value = this.config.dataDistribution;
  }

  private updateAlgorithmInfo(): void {
    const AlgorithmClass = AlgorithmRegistry.get(this.config.algorithm);
    if (!AlgorithmClass) return;

    const instance = new AlgorithmClass(this.config);
    const info = instance.getInfo();

    this.elements.algorithmInfo.innerHTML = `
      <div class="algo-complexity">
        <div class="complexity-row">
          <span class="complexity-label">BEST</span>
          <span class="complexity-value">${info.bestComplexity}</span>
        </div>
        <div class="complexity-row">
          <span class="complexity-label">AVERAGE</span>
          <span class="complexity-value">${info.averageComplexity}</span>
        </div>
        <div class="complexity-row">
          <span class="complexity-label">WORST</span>
          <span class="complexity-value">${info.worstComplexity}</span>
        </div>
        <div class="complexity-row">
          <span class="complexity-label">SPACE</span>
          <span class="complexity-value">${info.spaceComplexity}</span>
        </div>
        <div class="complexity-row">
          <span class="complexity-label">STABLE</span>
          <span class="complexity-value">${info.stable ? 'Yes' : 'No'}</span>
        </div>
      </div>
      <p class="algo-description">${info.description}</p>
    `;
  }

  setState(state: AppState): void {
    this.currentState = state;

    switch (state) {
      case 'idle':
      case 'generating':
        this.elements.sortBtn.textContent = 'SORT';
        this.elements.sortBtn.className = 'btn btn-success';
        this.elements.sortBtn.disabled = false;
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
        this.elements.sortBtn.disabled = false;
        this.elements.pauseBtn.disabled = true;
        this.elements.pauseBtn.textContent = 'PAUSE';
        break;
    }
  }

  getConfig(): SortConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<SortConfig>): void {
    this.config = { ...this.config, ...config };
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
}