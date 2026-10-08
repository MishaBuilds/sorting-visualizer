/**
 * "SORT COMPLETE" overlay — shown over the canvas after a real run,
 * with the run's actual measurements and follow-up actions.
 */

export interface ResultData {
  algorithmName: string;
  elementCount: number;
  elapsedMs: number;
  comparisons: number;
  swaps: number;
  operations: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export class ResultOverlay {
  private root: HTMLElement;
  private card: HTMLElement;
  private callbacks: {
    onSortAgain?: () => void;
    onRandomize?: () => void;
    onCompare?: () => void;
  } = {};

  constructor(container: HTMLElement) {
    this.root = container;
    this.root.innerHTML = `
      <div class="result-overlay" style="display: none;">
        <div class="result-card" role="dialog" aria-label="Sort complete">
          <div class="result-kicker">SORT COMPLETE</div>
          <div class="result-title" id="result-title">QUICK SORT</div>
          <div class="result-sub" id="result-sub">10,000 ELEMENTS · 8.42 s</div>
          <div class="result-grid">
            <div class="result-stat">
              <span class="result-num" id="result-comparisons">0</span>
              <span class="result-lbl">COMPARISONS</span>
            </div>
            <div class="result-stat">
              <span class="result-num" id="result-swaps">0</span>
              <span class="result-lbl">SWAPS</span>
            </div>
            <div class="result-stat">
              <span class="result-num" id="result-operations">0</span>
              <span class="result-lbl">OPERATIONS</span>
            </div>
          </div>
          <div class="result-actions">
            <button id="result-sort-again" class="btn btn-success">SORT AGAIN</button>
            <button id="result-randomize" class="btn btn-primary">RANDOMIZE</button>
            <button id="result-compare" class="btn btn-compare">COMPARE</button>
          </div>
        </div>
      </div>
    `;

    this.card = this.root.querySelector('.result-card')!;
    this.root.querySelector('#result-sort-again')!.addEventListener('click', () => {
      this.hide();
      this.callbacks.onSortAgain?.();
    });
    this.root.querySelector('#result-randomize')!.addEventListener('click', () => {
      this.hide();
      this.callbacks.onRandomize?.();
    });
    this.root.querySelector('#result-compare')!.addEventListener('click', () => {
      this.hide();
      this.callbacks.onCompare?.();
    });
  }

  show(data: ResultData): void {
    this.root.querySelector('#result-title')!.textContent = data.algorithmName.toUpperCase();
    this.root.querySelector('#result-sub')!.textContent =
      `${fmt(data.elementCount)} ELEMENTS · ${(data.elapsedMs / 1000).toFixed(2)} s`;
    this.root.querySelector('#result-comparisons')!.textContent = fmt(data.comparisons);
    this.root.querySelector('#result-swaps')!.textContent = fmt(data.swaps);
    this.root.querySelector('#result-operations')!.textContent = fmt(data.operations);

    const overlay = this.root.querySelector('.result-overlay') as HTMLElement;
    overlay.style.display = 'flex';
    // Restart the subtle entry transition
    this.card.classList.remove('result-in');
    void this.card.offsetWidth;
    this.card.classList.add('result-in');
  }

  hide(): void {
    const overlay = this.root.querySelector('.result-overlay') as HTMLElement;
    overlay.style.display = 'none';
  }

  isVisible(): boolean {
    const overlay = this.root.querySelector('.result-overlay') as HTMLElement;
    return overlay.style.display !== 'none';
  }

  onSortAgain(cb: () => void): void {
    this.callbacks.onSortAgain = cb;
  }

  onRandomize(cb: () => void): void {
    this.callbacks.onRandomize = cb;
  }

  onCompare(cb: () => void): void {
    this.callbacks.onCompare = cb;
  }
}
