/**
 * Live performance graph — compact 2D canvas chart of the real counters.
 *
 * Sampling is interval-gated and point-capped (utils/graphSampler), so
 * the chart is never rebuilt per internal operation and the series can
 * never leak memory. After completion the graph freezes and keeps the
 * run's result on screen.
 */

import { createSeriesSampler, type SeriesSampler } from '../utils/graphSampler';
import type { SortStatistics } from '../types';

export type GraphSeries = 'comparisons' | 'swaps' | 'operations';

const SERIES_META: Record<GraphSeries, { label: string; color: string; fill: string }> = {
  comparisons: { label: 'COMPARISONS', color: '#58a6ff', fill: 'rgba(88, 166, 255, 0.14)' },
  swaps: { label: 'SWAPS', color: '#ffd700', fill: 'rgba(255, 215, 0, 0.13)' },
  operations: { label: 'OPERATIONS', color: '#a371f7', fill: 'rgba(163, 113, 247, 0.15)' },
};

export interface GraphSample {
  comparisons: number;
  swaps: number;
  operations: number;
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export class PerfGraph {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sampler: SeriesSampler<GraphSample>;
  private series: GraphSeries = 'comparisons';
  private frozen = false;
  private seriesButtons: HTMLButtonElement[];
  private currentValueEl: HTMLElement;
  private currentLabelEl: HTMLElement;
  private resizeHandler: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="graph-panel">
        <div class="graph-header">
          <h2>LIVE PERFORMANCE</h2>
          <div class="series-toggle" role="group" aria-label="Graph series">
            <button class="series-btn active" data-series="comparisons" title="Comparisons">CMP</button>
            <button class="series-btn" data-series="swaps" title="Swaps">SWP</button>
            <button class="series-btn" data-series="operations" title="Operations">OPS</button>
          </div>
        </div>
        <canvas id="perf-graph-canvas" class="graph-canvas" width="240" height="120"></canvas>
        <div class="graph-current">
          <span class="graph-current-value" id="graph-current-value">0</span>
          <span class="graph-current-label" id="graph-current-label">COMPARISONS</span>
        </div>
      </div>
    `;

    this.canvas = this.container.querySelector('#perf-graph-canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.currentValueEl = this.container.querySelector('#graph-current-value')!;
    this.currentLabelEl = this.container.querySelector('#graph-current-label')!;
    this.seriesButtons = Array.from(this.container.querySelectorAll('.series-btn'));

    // 2 samples/sec, hard cap of 160 points — bounded work per draw.
    this.sampler = createSeriesSampler<GraphSample>({ intervalMs: 200, maxPoints: 160 });

    for (const btn of this.seriesButtons) {
      btn.addEventListener('click', () => {
        this.series = btn.dataset.series as GraphSeries;
        for (const b of this.seriesButtons) b.classList.toggle('active', b === btn);
        this.currentLabelEl.textContent = SERIES_META[this.series].label;
        this.draw();
      });
    }

    this.resizeHandler = () => this.draw();
    window.addEventListener('resize', this.resizeHandler);
    this.draw();
  }

  /** Feed real statistics; the sampler decides whether to store a point. */
  sample(elapsedMs: number, stats: SortStatistics): void {
    if (this.frozen) return;
    const stored = this.sampler.push(elapsedMs, {
      comparisons: stats.comparisons,
      swaps: stats.swaps,
      operations: stats.operations,
    });
    if (stored) this.draw();
  }

  /** Keep the finished run's curve visible. */
  freeze(): void {
    this.frozen = true;
    const last = this.sampler.last();
    if (last) {
      this.currentValueEl.textContent = formatCompact(last.values[this.series]);
    }
    this.draw();
  }

  reset(): void {
    this.sampler.reset();
    this.frozen = false;
    this.currentValueEl.textContent = '0';
    this.draw();
  }

  setSeries(series: GraphSeries): void {
    this.series = series;
    for (const b of this.seriesButtons) b.classList.toggle('active', b.dataset.series === series);
    this.currentLabelEl.textContent = SERIES_META[series].label;
    this.draw();
  }

  getPointCount(): number {
    return this.sampler.size();
  }

  private draw(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const points = this.sampler.points();
    const meta = SERIES_META[this.series];

    if (points.length === 0) {
      ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.fillStyle = '#6e7681';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NO DATA YET', w / 2, h / 2);
      return;
    }

    const pad = { l: 46, r: 12, t: 12, b: 20 };
    const plotW = Math.max(1, w - pad.l - pad.r);
    const plotH = Math.max(1, h - pad.t - pad.b);

    let maxVal = 1;
    let maxT = 1;
    for (const p of points) {
      const v = p.values[this.series];
      if (v > maxVal) maxVal = v;
      if (p.t > maxT) maxT = p.t;
    }

    const xOf = (t: number) => pad.l + (t / maxT) * plotW;
    const yOf = (v: number) => pad.t + plotH - (v / maxVal) * plotH;

    // Horizontal grid + Y labels
    ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (plotH * i) / 4;
      const value = maxVal * (1 - i / 4);
      ctx.strokeStyle = i === 4 ? '#30363d' : '#21262d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillStyle = '#6e7681';
      ctx.fillText(formatCompact(value), pad.l - 6, y);
    }

    // X labels (seconds)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#6e7681';
    const midT = (maxT / 1000) * 0.5;
    ctx.fillText('0s', pad.l, h - pad.b + 5);
    ctx.fillText(`${midT.toFixed(1)}s`, pad.l + plotW / 2, h - pad.b + 5);
    ctx.fillText(`${(maxT / 1000).toFixed(1)}s`, w - pad.r, h - pad.b + 5);

    // Series path (fill + line)
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = xOf(points[i].t);
      const y = yOf(points[i].values[this.series]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const lastX = xOf(points[points.length - 1].t);
    ctx.lineTo(lastX, pad.t + plotH);
    ctx.lineTo(pad.l, pad.t + plotH);
    ctx.closePath();
    ctx.fillStyle = meta.fill;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = xOf(points[i].t);
      const y = yOf(points[i].values[this.series]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Head dot
    const headY = yOf(points[points.length - 1].values[this.series]);
    ctx.beginPath();
    ctx.arc(lastX, headY, 3, 0, Math.PI * 2);
    ctx.fillStyle = meta.color;
    ctx.fill();

    // Current value readout
    this.currentValueEl.textContent = formatCompact(points[points.length - 1].values[this.series]);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resizeHandler);
  }
}
