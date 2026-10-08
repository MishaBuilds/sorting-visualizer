/**
 * Statistics Panel UI Component
 */

import type { SortStatistics } from '../types';

export class StatisticsPanel {
  private container: HTMLElement;
  private elements: {
    comparisons: HTMLElement;
    swaps: HTMLElement;
    arrayAccesses: HTMLElement;
    operations: HTMLElement;
    elapsedTime: HTMLElement;
    progress: HTMLElement;
    progressBar: HTMLElement;
    progressFill: HTMLElement;
    status: HTMLElement;
  } = {} as any;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    this.cacheElements();
    this.reset();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="statistics-panel">
        <h2>STATISTICS</h2>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">COMPARISONS</span>
            <span class="stat-value" id="stat-comparisons">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">SWAPS</span>
            <span class="stat-value" id="stat-swaps">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">ARRAY ACCESSES</span>
            <span class="stat-value" id="stat-array-accesses">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">OPERATIONS</span>
            <span class="stat-value" id="stat-operations">0</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">ELAPSED TIME</span>
            <span class="stat-value" id="stat-elapsed-time">0.00 s</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">PROGRESS</span>
            <span class="stat-value" id="stat-progress">0%</span>
          </div>
        </div>
        <div class="progress-container">
          <div class="progress-bar" id="progress-bar">
            <div class="progress-fill" id="progress-fill"></div>
          </div>
        </div>
        <div class="status-container">
          <span class="status-label">STATUS</span>
          <span class="status-value" id="stat-status">IDLE</span>
        </div>
      </div>
    `;
  }

  private cacheElements(): void {
    this.elements = {
      comparisons: this.container.querySelector('#stat-comparisons')!,
      swaps: this.container.querySelector('#stat-swaps')!,
      arrayAccesses: this.container.querySelector('#stat-array-accesses')!,
      operations: this.container.querySelector('#stat-operations')!,
      elapsedTime: this.container.querySelector('#stat-elapsed-time')!,
      progress: this.container.querySelector('#stat-progress')!,
      progressBar: this.container.querySelector('#progress-bar')!,
      progressFill: this.container.querySelector('#progress-fill')!,
      status: this.container.querySelector('#stat-status')!,
    };
  }

  update(stats: SortStatistics): void {
    this.elements.comparisons.textContent = this.formatNumber(stats.comparisons);
    this.elements.swaps.textContent = this.formatNumber(stats.swaps);
    this.elements.arrayAccesses.textContent = this.formatNumber(stats.arrayAccesses);
    this.elements.operations.textContent = this.formatNumber(stats.operations);
    this.elements.elapsedTime.textContent = `${(stats.elapsedTime / 1000).toFixed(2)} s`;
    // Floor (not round) so a capped 0.999 renders as 99% — the bar must
    // never read 100% before the visualization has fully completed.
    this.elements.progress.textContent = `${Math.floor(stats.progress * 100)}%`;
    (this.elements.progressFill as HTMLElement).style.width = `${Math.min(100, stats.progress * 100)}%`;
  }

  setStatus(status: string): void {
    this.elements.status.textContent = status;
    this.elements.status.className = 'status-value';
    if (status === 'SORTING...') this.elements.status.classList.add('status-sorting');
    else if (status === 'PAUSED') this.elements.status.classList.add('status-paused');
    else if (status === 'COMPLETED') this.elements.status.classList.add('status-completed');
    else if (status === 'IDLE') this.elements.status.classList.add('status-idle');
  }

  reset(): void {
    this.elements.comparisons.textContent = '0';
    this.elements.swaps.textContent = '0';
    this.elements.arrayAccesses.textContent = '0';
    this.elements.operations.textContent = '0';
    this.elements.elapsedTime.textContent = '0.00 s';
    this.elements.progress.textContent = '0%';
    (this.elements.progressFill as HTMLElement).style.width = '0%';
    this.setStatus('IDLE');
  }

  private formatNumber(num: number): string {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }
}