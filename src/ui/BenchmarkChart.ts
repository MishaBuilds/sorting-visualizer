/**
 * BenchmarkLab chart — a canvas line chart drawn strictly on demand
 * (no animation loop, no timers, bounded point counts by construction:
 * runs ≤ 10 points per line, scaling ≤ 6 sizes per line).
 *
 * Used for both the benchmark runs view (x = run index) and the scaling
 * test (x = array size on a log10 axis).
 */

import type { AlgorithmId } from '../types';

export const ALGORITHM_COLORS: Record<AlgorithmId, string> = {
  quick: '#4ecdc4',
  merge: '#ffd700',
  heap: '#7b68ee',
  bubble: '#ff6b35',
};

export interface ChartSeriesData {
  algorithmId: AlgorithmId;
  label: string;
  points: { x: number; y: number }[];
}

export interface ChartXAxis {
  /** Ticks to label on the x axis (values are data-space x coordinates). */
  ticks: { value: number; label: string }[];
  /** 'log' spaces positions by log10(value) — scaling growth charts. */
  scale: 'linear' | 'log';
}

export interface ChartRenderConfig {
  series: ChartSeriesData[];
  xAxis: ChartXAxis;
  yLabel: string;
  formatY: (value: number) => string;
}

const PADDING = { top: 18, right: 16, bottom: 34, left: 74 };
const GRID_LINES = 4;

export class BenchmarkChart {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private lastConfig: ChartRenderConfig | null = null;
  private resizeHandler: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  render(config: ChartRenderConfig): void {
    this.lastConfig = config;
    this.draw(config);

    if (!this.resizeHandler) {
      this.resizeHandler = () => {
        if (this.lastConfig) this.draw(this.lastConfig);
      };
      window.addEventListener('resize', this.resizeHandler);
    }
  }

  /** Redraw with the last config (used after container layout changes). */
  refresh(): void {
    if (this.lastConfig) this.draw(this.lastConfig);
  }

  dispose(): void {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    this.lastConfig = null;
  }

  private draw(config: ChartRenderConfig): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = this.canvas.clientWidth || 600;
    const cssHeight = this.canvas.clientHeight || 320;
    this.canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const allPoints = config.series.flatMap((s) => s.points);
    if (allPoints.length === 0) {
      ctx.fillStyle = 'rgba(160,175,200,0.7)';
      ctx.font = '13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No successful measurements yet', cssWidth / 2, cssHeight / 2);
      ctx.textAlign = 'left';
      return;
    }

    const plotW = cssWidth - PADDING.left - PADDING.right;
    const plotH = cssHeight - PADDING.top - PADDING.bottom;

    // ---- x mapping -------------------------------------------------------
    const xValues = allPoints.map((p) => p.x);
    const useLog = config.xAxis.scale === 'log';
    const mapX = (x: number): number => {
      if (useLog) {
        const lo = Math.log10(Math.min(...xValues));
        const hi = Math.log10(Math.max(...xValues));
        if (hi === lo) return PADDING.left + plotW / 2;
        return PADDING.left + ((Math.log10(x) - lo) / (hi - lo)) * plotW;
      }
      const lo = Math.min(...xValues);
      const hi = Math.max(...xValues);
      if (hi === lo) return PADDING.left + plotW / 2;
      return PADDING.left + ((x - lo) / (hi - lo)) * plotW;
    };

    // ---- y mapping -------------------------------------------------------
    let yMax = 0;
    for (const p of allPoints) if (p.y > yMax) yMax = p.y;
    if (yMax === 0) yMax = 1;
    const mapY = (y: number): number => PADDING.top + plotH - (y / yMax) * plotH;

    // ---- grid + y labels -------------------------------------------------
    ctx.strokeStyle = 'rgba(120,140,180,0.15)';
    ctx.fillStyle = 'rgba(160,175,200,0.85)';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_LINES; i++) {
      const value = (yMax / GRID_LINES) * i;
      const y = mapY(value);
      ctx.beginPath();
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(PADDING.left + plotW, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(config.formatY(value), PADDING.left - 8, y + 4);
    }

    // ---- x labels --------------------------------------------------------
    ctx.textAlign = 'center';
    for (const tick of config.xAxis.ticks) {
      const x = mapX(tick.value);
      ctx.fillText(tick.label, x, cssHeight - PADDING.bottom + 18);
      ctx.strokeStyle = 'rgba(120,140,180,0.25)';
      ctx.beginPath();
      ctx.moveTo(x, PADDING.top);
      ctx.lineTo(x, PADDING.top + plotH);
      ctx.stroke();
    }

    // axis titles
    ctx.fillStyle = 'rgba(160,175,200,0.75)';
    ctx.textAlign = 'left';
    ctx.fillText(config.yLabel, 8, 12);
    ctx.textAlign = 'right';
    ctx.fillText(useLog ? 'SIZE (log)' : 'RUN', cssWidth - PADDING.right, cssHeight - 4);
    ctx.textAlign = 'left';

    // ---- series lines ----------------------------------------------------
    for (const series of config.series) {
      const color = ALGORITHM_COLORS[series.algorithmId] ?? '#4ecdc4';
      if (series.points.length > 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        series.points.forEach((p, i) => {
          const x = mapX(p.x);
          const y = mapY(p.y);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        for (const p of series.points) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(mapX(p.x), mapY(p.y), 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // value label on the last point
      const last = series.points[series.points.length - 1];
      if (last) {
        ctx.fillStyle = color;
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(
          config.formatY(last.y),
          Math.min(mapX(last.x) + 60, cssWidth - PADDING.right),
          mapY(last.y) - 8
        );
        ctx.textAlign = 'left';
      }
    }
  }
}
