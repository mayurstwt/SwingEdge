'use client';
import { useEffect, useRef, useMemo } from 'react';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler
);

interface PriceChartProps {
  priceHistory?: number[];
  sma50History?: (number | null)[];
  sma200History?: (number | null)[];
  symbol: string;
}

export default function PriceChart({
  priceHistory = [],
  sma50History = [],
  sma200History = [],
  symbol,
}: PriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  // Memoize labels to avoid re-creation on every render
  const labels = useMemo(() => {
    const n = priceHistory.length;
    return Array.from({ length: n }, (_, i) => {
      const daysAgo = n - 1 - i;
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      // Show monthly labels only
      if (daysAgo % 15 === 0) {
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      }
      return '';
    });
  }, [priceHistory.length]);

  useEffect(() => {
    if (!canvasRef.current || priceHistory.length === 0) return;

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Price gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.25)');
    gradient.addColorStop(1, 'rgba(0, 212, 255, 0.0)');

    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: symbol.replace('.NS', '') + ' Close',
            data: priceHistory,
            borderColor: '#00d4ff',
            borderWidth: 2,
            backgroundColor: gradient,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#00d4ff',
          },
          {
            label: 'SMA 50',
            data: sma50History,
            borderColor: '#f59e0b',
            borderWidth: 1.5,
            borderDash: [5, 3],
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 0,
          },
          {
            label: 'SMA 200',
            data: sma200History,
            borderColor: '#9b59b6',
            borderWidth: 1.5,
            borderDash: [8, 4],
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#94a3b8',
              boxWidth: 20,
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              padding: 16,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(10, 15, 30, 0.95)',
            borderColor: 'rgba(0, 212, 255, 0.3)',
            borderWidth: 1,
            titleColor: '#e2e8f0',
            bodyColor: '#94a3b8',
            padding: 12,
            titleFont: { family: "'JetBrains Mono', monospace", size: 12 },
            bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed.y;
                if (val === null || val === undefined) return '';
                return `  ${ctx.dataset.label}: ₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(148, 163, 184, 0.06)',
            },
            ticks: {
              color: '#64748b',
              font: { family: "'JetBrains Mono', monospace", size: 10 },
              maxRotation: 0,
            },
          },
          y: {
            position: 'right',
            grid: {
              color: 'rgba(148, 163, 184, 0.06)',
            },
            ticks: {
              color: '#64748b',
              font: { family: "'JetBrains Mono', monospace", size: 10 },
              callback: (v) => `₹${Number(v).toLocaleString('en-IN')}`,
            },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [priceHistory, sma50History, sma200History, symbol, labels]);

  // Show empty state when no data
  if (priceHistory.length === 0) {
    return (
      <div className="chart-container" id="price-chart-container">
        <div className="chart-header">
          <h3 className="chart-title">
            <span className="chart-symbol">{symbol.replace('.NS', '')}</span>
            <span className="chart-subtitle">6-Month Price Chart</span>
          </h3>
        </div>
        <div className="chart-empty">
          <p>Insufficient data to render chart</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chart-container" id="price-chart-container">
      <div className="chart-header">
        <h3 className="chart-title">
          <span className="chart-symbol">{symbol.replace('.NS', '')}</span>
          <span className="chart-subtitle">6-Month Price Chart</span>
        </h3>
        <div className="chart-legend-pills">
          <span className="legend-pill" style={{ borderColor: '#00d4ff' }}>Close</span>
          <span className="legend-pill" style={{ borderColor: '#f59e0b' }}>SMA 50</span>
          <span className="legend-pill" style={{ borderColor: '#9b59b6' }}>SMA 200</span>
        </div>
      </div>
      <div className="chart-canvas-wrapper">
        <canvas ref={canvasRef} id="price-chart-canvas" aria-label={`${symbol} price chart`} />
      </div>
    </div>
  );
}