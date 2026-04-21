'use client';

import { useEffect, useState } from 'react';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
);

interface PerformanceResponse {
  analytics?: {
    totalTrades: number;
    winRate: number;
    totalProfit: number;
    avgProfit: number;
    bestTrade: number;
    worstTrade: number;
    sectorStats: Array<{ sector: string; trades: number; profit: number; winRate: number }>;
    rrStats: Array<{ rr: string; trades: number; profit: number }>;
    bestStrategy?: { entryType: string; totalProfit: number; winRate: number } | null;
    worstStrategy?: { entryType: string; totalProfit: number; winRate: number } | null;
  };
  latestBacktest?: {
    id: string;
    name: string | null;
    final_equity: number;
    total_return_pct: number;
    max_drawdown_pct: number;
    win_rate: number;
    avg_risk_reward: number;
    total_trades: number;
    equity_curve: Array<{ date: string; equity: number }>;
    drawdown_curve: Array<{ date: string; drawdownPct: number }>;
    created_at: string;
  } | null;
  strategyPerformance?: Array<{
    entry_type: string;
    avg_profit: number;
    win_rate: number;
    trades_count: number;
    total_profit: number;
    dynamic_score_threshold: number;
    capital_weight: number;
    enabled: boolean;
  }>;
}

const currency = (value: number) =>
  `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  resizeDelay: 150,
  animation: false as const
};

export default function PerformanceDashboard() {
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningBacktest, setRunningBacktest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  async function fetchPerformance() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/performance');
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to load performance data');
      }
      setData(payload);
      setLastRefreshed(new Date().toLocaleTimeString('en-IN'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPerformance();
    // Auto-refresh every 60 seconds so charts update during the trading day
    const interval = setInterval(fetchPerformance, 60_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRunBacktest() {
    setRunningBacktest(true);
    setError(null);

    try {
      const response = await fetch('/api/backtest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Dashboard Baseline Backtest',
          initialCapital: 50000,
          settings: {
            symbolLimit: 20,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? 'Backtest failed');
      }
      await fetchPerformance();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setRunningBacktest(false);
    }
  }

  const latestBacktest = data?.latestBacktest;
  const analytics = data?.analytics;
  const strategyPerformance = data?.strategyPerformance ?? [];
  const strategyLabels = strategyPerformance.map((item) => item.entry_type);
  const strategyProfitData = strategyPerformance.map((item) => item.total_profit);
  const sectorLabels = analytics?.sectorStats?.map((item) => item.sector) ?? [];
  const sectorProfitData = analytics?.sectorStats?.map((item) => item.profit) ?? [];
  const rrLabels = analytics?.rrStats?.map((item) => `R${item.rr}`) ?? [];
  const rrProfitData = analytics?.rrStats?.map((item) => item.profit) ?? [];

  return (
    <section className="performance-dashboard">
      <div className="performance-header">
        <div>
          <p className="panel-pretitle">System Performance</p>
          <h2 className="panel-title">Backtests, drawdowns, and strategy diagnostics</h2>
          {lastRefreshed && (
            <span style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '2px', display: 'block' }}>
              Last refreshed: {lastRefreshed} • auto-updates every 60s
            </span>
          )}
        </div>
        <button className="run-btn" onClick={handleRunBacktest} disabled={runningBacktest}>
          {runningBacktest ? 'Running Backtest...' : 'Run Baseline Backtest'}
        </button>
      </div>

      {error && <div className="dash-error">{error}</div>}

      {loading ? (
        <div className="skeleton-row tall" />
      ) : (
        <>
          <div className="wallet-summary-grid">
            <div className="summary-card">
              <span className="summary-label">Latest Return</span>
              <span className={`summary-value ${Number(latestBacktest?.total_return_pct ?? 0) >= 0 ? 'buy-color' : 'avoid-color'}`}>
                {latestBacktest ? `${latestBacktest.total_return_pct}%` : '—'}
              </span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Max Drawdown</span>
              <span className="summary-value avoid-color">
                {latestBacktest ? `${latestBacktest.max_drawdown_pct}%` : '—'}
              </span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Latest Equity</span>
              <span className="summary-value">{latestBacktest ? currency(latestBacktest.final_equity) : '—'}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Best Strategy</span>
              <span className="summary-value">{analytics?.bestStrategy?.entryType ?? '—'}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Worst Strategy</span>
              <span className="summary-value">{analytics?.worstStrategy?.entryType ?? '—'}</span>
            </div>
          </div>

          <div className="performance-grid">
            <div className="chart-panel">
              <div className="chart-panel-head">
                <h3>Equity Curve</h3>
                <span>{latestBacktest ? `${latestBacktest.total_trades} trades` : 'No run yet'}</span>
              </div>
              {latestBacktest?.equity_curve?.length ? (
                <div className="chart-viewport">
                  <Line
                    data={{
                      labels: latestBacktest.equity_curve.map((point) => point.date),
                      datasets: [
                        {
                          label: 'Equity',
                          data: latestBacktest.equity_curve.map((point) => point.equity),
                          borderColor: '#00d4ff',
                          backgroundColor: 'rgba(0, 212, 255, 0.14)',
                          fill: true,
                          tension: 0.25,
                          pointRadius: 0,
                        },
                      ],
                    }}
                    options={chartOptions}
                  />
                </div>
              ) : (
                <div className="chart-empty">Run a backtest to populate the equity curve.</div>
              )}
            </div>

            <div className="chart-panel">
              <div className="chart-panel-head">
                <h3>Drawdown Curve</h3>
                <span>Risk compression</span>
              </div>
              {latestBacktest?.drawdown_curve?.length ? (
                <div className="chart-viewport">
                  <Line
                    data={{
                      labels: latestBacktest.drawdown_curve.map((point) => point.date),
                      datasets: [
                        {
                          label: 'Drawdown %',
                          data: latestBacktest.drawdown_curve.map((point) => point.drawdownPct),
                          borderColor: '#ff3d71',
                          backgroundColor: 'rgba(255, 61, 113, 0.12)',
                          fill: true,
                          tension: 0.25,
                          pointRadius: 0,
                        },
                      ],
                    }}
                    options={chartOptions}
                  />
                </div>
              ) : (
                <div className="chart-empty">No drawdown history yet.</div>
              )}
            </div>

            <div className="chart-panel">
              <div className="chart-panel-head">
                <h3>Strategy Breakdown</h3>
                <span>Capital-weighted</span>
              </div>
              {strategyLabels.length ? (
                <div className="chart-viewport">
                  <Bar
                    data={{
                      labels: strategyLabels,
                      datasets: [
                        {
                          label: 'Total Profit',
                          data: strategyProfitData,
                          backgroundColor: strategyProfitData.map((value) => value >= 0 ? 'rgba(0, 230, 118, 0.45)' : 'rgba(255, 61, 113, 0.45)'),
                          borderColor: strategyProfitData.map((value) => value >= 0 ? '#00e676' : '#ff3d71'),
                          borderWidth: 1,
                        },
                      ],
                    }}
                    options={chartOptions}
                  />
                </div>
              ) : (
                <div className="chart-empty">No strategy history yet.</div>
              )}
            </div>

            <div className="chart-panel">
              <div className="chart-panel-head">
                <h3>Sector Performance</h3>
                <span>Closed-trade P&amp;L</span>
              </div>
              {sectorLabels.length ? (
                <div className="chart-viewport">
                  <Bar
                    data={{
                      labels: sectorLabels,
                      datasets: [
                        {
                          label: 'Sector Profit',
                          data: sectorProfitData,
                          backgroundColor: 'rgba(251, 191, 36, 0.35)',
                          borderColor: '#fbbf24',
                          borderWidth: 1,
                        },
                      ],
                    }}
                    options={chartOptions}
                  />
                </div>
              ) : (
                <div className="chart-empty">No sector history yet.</div>
              )}
            </div>

            <div className="chart-panel wide">
              <div className="chart-panel-head">
                <h3>R:R Distribution</h3>
                <span>Profit by risk bucket</span>
              </div>
              {rrLabels.length ? (
                <div className="chart-viewport">
                  <Bar
                    data={{
                      labels: rrLabels,
                      datasets: [
                        {
                          label: 'Profit',
                          data: rrProfitData,
                          backgroundColor: 'rgba(96, 165, 250, 0.35)',
                          borderColor: '#60a5fa',
                          borderWidth: 1,
                        },
                      ],
                    }}
                    options={chartOptions}
                  />
                </div>
              ) : (
                <div className="chart-empty">No R:R history yet.</div>
              )}
            </div>
          </div>

          <div className="strategy-table-wrap">
            <table className="signals-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Win Rate</th>
                  <th>Avg Profit</th>
                  <th>Threshold</th>
                  <th>Capital Weight</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {strategyPerformance.map((item) => (
                  <tr key={item.entry_type}>
                    <td>{item.entry_type}</td>
                    <td>{item.win_rate}%</td>
                    <td className={Number(item.avg_profit) >= 0 ? 'buy-color' : 'avoid-color'}>{currency(item.avg_profit)}</td>
                    <td>{item.dynamic_score_threshold}</td>
                    <td>{item.capital_weight}x</td>
                    <td>
                      <span className={`decision-badge ${item.enabled ? 'buy' : 'avoid'}`}>
                        {item.enabled ? 'ENABLED' : 'BLOCKED'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
