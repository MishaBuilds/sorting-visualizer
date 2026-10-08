/**
 * Compare Mode overlay: per-lane labels (name / time / counters /
 * progress) positioned over the scissored viewports, plus the verdict
 * card that appears when every lane has really finished.
 *
 * All displayed values come from the real per-lane streams.
 */

import type { AlgorithmId, CompareResult, CompareVerdicts, SortStatistics, LaneRect } from '../types';
import type { LaneLayout } from '../utils/compare';

const ALGO_NAMES: Record<AlgorithmId, string> = {
  bubble: 'Bubble Sort',
  quick: 'Quick Sort',
  merge: 'Merge Sort',
  heap: 'Heap Sort',
};

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export class CompareOverlay {
  private root: HTMLElement;
  private laneEls = new Map<AlgorithmId, HTMLElement>();
  private lastUpdate = new Map<AlgorithmId, number>();
  private verdictEl: HTMLElement;
  private callbacks: {
    onRunAgain?: () => void;
    onExit?: () => void;
  } = {};

  constructor(container: HTMLElement) {
    this.root = container;
    this.root.innerHTML = `
      <div class="verdict-overlay" id="verdict-overlay" style="display: none;">
        <div class="verdict-card">
          <div class="verdict-kicker">COMPARE COMPLETE</div>
          <div id="verdict-rows" class="verdict-rows"></div>
          <div id="verdict-table" class="verdict-table"></div>
          <div class="verdict-actions">
            <button id="verdict-again" class="btn btn-success">RUN AGAIN</button>
            <button id="verdict-exit" class="btn btn-secondary">EXIT COMPARE</button>
          </div>
        </div>
      </div>
    `;
    this.verdictEl = this.root.querySelector('#verdict-overlay')!;
    this.root.querySelector('#verdict-again')!.addEventListener('click', () => {
      this.hideVerdicts();
      this.callbacks.onRunAgain?.();
    });
    this.root.querySelector('#verdict-exit')!.addEventListener('click', () => {
      this.hideVerdicts();
      this.callbacks.onExit?.();
    });
  }

  /** Create (or recreate) the floating label for every lane. */
  showLanes(ids: AlgorithmId[], layout: LaneLayout): void {
    this.hideLanes();
    ids.forEach((id, i) => {
      const rect = layout.lanes[i];
      const el = document.createElement('div');
      el.className = 'lane-label';
      el.dataset.id = id;
      el.innerHTML = `
        <div class="lane-title">${ALGO_NAMES[id].toUpperCase()}</div>
        <div class="lane-stats">
          <span><b class="ls-time">0.0s</b><i>TIME</i></span>
          <span><b class="ls-cmp">0</b><i>CMP</i></span>
          <span><b class="ls-swp">0</b><i>SWP</i></span>
          <span><b class="ls-ops">0</b><i>OPS</i></span>
        </div>
        <div class="lane-progress"><div class="lane-progress-fill"></div></div>
      `;
      this.applyRect(el, rect);
      this.root.appendChild(el);
      this.laneEls.set(id, el);
      this.lastUpdate.set(id, 0);
    });
  }

  /** Reposition labels (window resize / layout change). */
  layout(lanes: LaneRect[]): void {
    let i = 0;
    for (const el of this.laneEls.values()) {
      const rect = lanes[i++];
      if (rect) this.applyRect(el, rect);
    }
  }

  private applyRect(el: HTMLElement, rect: LaneRect): void {
    el.style.left = `${Math.round(rect.x)}px`;
    el.style.top = `${Math.round(rect.y)}px`;
    el.style.width = `${Math.round(rect.w)}px`;
  }

  /**
   * Update one lane's readouts (throttled to ~10 Hz per lane).
   * `force` bypasses the throttle — used for the terminal update so a
   * lane never stays stuck at 99% after it has really finished.
   */
  updateLane(id: AlgorithmId, stats: SortStatistics, force = false): void {
    const el = this.laneEls.get(id);
    if (!el) return;
    const now = performance.now();
    if (!force && now - (this.lastUpdate.get(id) ?? 0) < 100) return;
    this.lastUpdate.set(id, now);

    el.querySelector('.ls-time')!.textContent = `${(stats.elapsedTime / 1000).toFixed(1)}s`;
    el.querySelector('.ls-cmp')!.textContent = compact(stats.comparisons);
    el.querySelector('.ls-swp')!.textContent = compact(stats.swaps);
    el.querySelector('.ls-ops')!.textContent = compact(stats.operations);
    const pct = Math.min(100, Math.floor(stats.progress * 100));
    const fill = el.querySelector('.lane-progress-fill') as HTMLElement;
    fill.style.width = `${pct}%`;
    if (pct >= 100) el.classList.add('lane-done');
  }

  /** Verdict card — every value taken from the real completed runs. */
  showVerdicts(results: CompareResult[], verdicts: CompareVerdicts): void {
    const byId = new Map(results.map((r) => [r.algorithmId, r]));
    const fastest = byId.get(verdicts.fastest)!;
    const fewest = byId.get(verdicts.fewestComparisons)!;
    const most = byId.get(verdicts.mostOperations)!;

    const row = (tag: string, cls: string, name: string, value: string) => `
      <div class="verdict-row">
        <span class="v-tag ${cls}">${tag}</span>
        <span class="v-name">${name}</span>
        <span class="v-val">${value}</span>
      </div>`;

    this.root.querySelector('#verdict-rows')!.innerHTML =
      row('FASTEST', 'fastest', ALGO_NAMES[verdicts.fastest], `${(fastest.elapsedMs / 1000).toFixed(2)} s`) +
      row('FEWEST COMPARISONS', 'fewest', ALGO_NAMES[verdicts.fewestComparisons], fewest.comparisons.toLocaleString('en-US')) +
      row('MOST OPERATIONS', 'most', ALGO_NAMES[verdicts.mostOperations], most.operations.toLocaleString('en-US'));

    this.root.querySelector('#verdict-table')!.innerHTML = `
      <div class="vtr vtr-head">
        <span>ALGORITHM</span><span>TIME</span><span>CMP</span><span>SWP</span><span>OPS</span>
      </div>` +
      results
        .map(
          (r) => `
      <div class="vtr">
        <span>${ALGO_NAMES[r.algorithmId]}</span>
        <span>${(r.elapsedMs / 1000).toFixed(2)} s</span>
        <span>${r.comparisons.toLocaleString('en-US')}</span>
        <span>${r.swaps.toLocaleString('en-US')}</span>
        <span>${r.operations.toLocaleString('en-US')}</span>
      </div>`
        )
        .join('');

    this.verdictEl.style.display = 'flex';
  }

  hideVerdicts(): void {
    this.verdictEl.style.display = 'none';
  }

  hasVerdicts(): boolean {
    return this.verdictEl.style.display !== 'none';
  }

  private hideLanes(): void {
    for (const el of this.laneEls.values()) {
      el.remove();
    }
    this.laneEls.clear();
    this.lastUpdate.clear();
  }

  hide(): void {
    this.hideLanes();
    this.hideVerdicts();
  }

  onRunAgain(cb: () => void): void {
    this.callbacks.onRunAgain = cb;
  }

  onExit(cb: () => void): void {
    this.callbacks.onExit = cb;
  }
}
