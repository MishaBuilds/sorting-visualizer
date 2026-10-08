/**
 * Recent runs — session-only history (no backend, no database).
 */

import type { RunHistoryEntry } from '../types';
import type { RunHistory } from '../utils/runHistory';
import { MAX_HISTORY_ENTRIES } from '../utils/runHistory';

export class HistoryPanel {
  private container: HTMLElement;
  private history: RunHistory;
  private listEl: HTMLElement;

  constructor(container: HTMLElement, history: RunHistory) {
    this.container = container;
    this.history = history;
    this.container.innerHTML = `
      <div class="history-panel">
        <div class="history-head">
          <h2>RECENT RUNS</h2>
          <button id="history-clear" class="history-clear" type="button">CLEAR HISTORY</button>
        </div>
        <div id="history-list" class="history-list"></div>
      </div>
    `;
    this.listEl = this.container.querySelector('#history-list')!;
    this.container.querySelector('#history-clear')!.addEventListener('click', () => {
      this.history.clear();
      this.refresh();
    });
    this.refresh();
  }

  add(entry: RunHistoryEntry): void {
    this.history.add(entry);
    this.refresh();
  }

  refresh(): void {
    const entries = this.history.list();
    if (entries.length === 0) {
      this.listEl.innerHTML = `<div class="history-empty">No runs yet — complete a sort to record it.</div>`;
      return;
    }
    this.listEl.innerHTML = entries
      .slice(0, MAX_HISTORY_ENTRIES)
      .map(
        (e) => `
        <div class="history-item">
          <div class="history-main">
            <span class="history-algo">${e.algorithmName}</span>
            <span class="history-count">${e.elementCount.toLocaleString('en-US')}</span>
          </div>
          <div class="history-time">${(e.elapsedMs / 1000).toFixed(2)} s</div>
          <div class="history-meta">${e.comparisons.toLocaleString('en-US')} cmp · ${e.operations.toLocaleString('en-US')} ops</div>
        </div>`
      )
      .join('');
  }

  size(): number {
    return this.history.size();
  }
}
