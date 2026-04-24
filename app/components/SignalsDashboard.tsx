// app/components/SignalsDashboard.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Signal } from '@/lib/trading/types';

interface SignalsDashboardProps {
  onSelectStock: (symbol: string) => void;
}

interface SignalsApiResponse {
  signals: Signal[];
  run_date: string | null;
  last_updated_at: string | null;
  fetched_at: string;
  error?: string;
}

interface StrategyRunResponse {
  logs?: string[];
  error?: string;
  openTrades?: number;
  availableCapital?: number;
  totalCapital?: number;
}

export default function SignalsDashboard({ onSelectStock }: SignalsDashboardProps) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [runDate, setRunDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'BUY' | 'HOLD' | 'AVOID'>('ALL');

  const fetchSignals = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/signals');
      const data: SignalsApiResponse = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Failed to load signals');

      setSignals(data.signals ?? []);
      setRunDate(data.last_updated_at ?? data.run_date ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load signals');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  const handleRunNow = async () => {
    setIsRunning(true);
    setError(null);
    setDebugLogs([]);

    try {
      // Strategy route accepts both GET and POST
      const res = await fetch('/api/run-strategy', { 
        method: 'GET', // Use GET for cron-compatible trigger
      });
      const data: StrategyRunResponse = await res.json();

      if (data.logs) setDebugLogs(data.logs);

      if (!res.ok) {
        throw new Error(data.error ?? 'Strategy run failed');
      }

      await fetchSignals();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Strategy run failed');
    } finally {
      setIsRunning(false);
    }
  };

  const sortedSignals = [...signals].sort((a, b) => {
    const weights: Record<string, number> = { BUY: 1, HOLD: 2, AVOID: 3, SHORT: 4 };

    if (weights[a.decision] !== weights[b.decision]) {
      return weights[a.decision] - weights[b.decision];
    }

    return b.score - a.score;
  });

  const filtered =
    filter === 'ALL'
      ? sortedSignals
      : sortedSignals.filter(s => s.decision === filter);

  const counts = {
    BUY: signals.filter(s => s.decision === 'BUY').length,
    HOLD: signals.filter(s => s.decision === 'HOLD').length,
    AVOID: signals.filter(s => s.decision === 'AVOID').length,
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';

    const date = new Date(d);

    return `${date.toLocaleDateString('en-IN')} @ ${date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  };

  // Helper to get signals array from DB reason field or signals array
  const getSignalReasons = (sig: Signal): string => {
    // Handle both old 'reason' string field and new 'signals' array
    if (sig.signals && Array.isArray(sig.signals) && sig.signals.length > 0) {
      return sig.signals.join(', ');
    }
    // Fallback for DB records that have 'reason' instead of 'signals'
    if ((sig as unknown as Record<string, unknown>).reason) {
      return String((sig as unknown as Record<string, unknown>).reason);
    }
    return '—';
  };

  return (
    <div className="signals-dashboard">
      <div className="dash-header">
        <div className="dash-title-block">
          <h2 className="dash-title">Daily Signals</h2>
          {runDate && (
            <span className="dash-date">
              <span>🕐</span>
              Latest: {formatDate(runDate)}
            </span>
          )}
        </div>

        <div className="dash-actions">
          <button 
            className={`run-btn ${isRunning ? 'running' : ''}`}
            onClick={handleRunNow} 
            disabled={isRunning}
          >
            {isRunning && <span className="spinner-ring sm" />}
            {isRunning ? 'Running...' : 'Run Strategy'}
          </button>
          <button className="refresh-btn" onClick={fetchSignals} disabled={isLoading}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="dash-error">{error}</div>}

      {debugLogs.length > 0 && (
        <div className="debug-logs">
          {debugLogs.map((log, i) => (
            <div key={i} className="log-line">• {log}</div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="dash-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton-row" />
          ))}
        </div>
      ) : signals.length > 0 ? (
        <>
          <div className="signal-summary">
            {(['ALL', 'BUY', 'HOLD', 'AVOID'] as const).map(f => (
              <button 
                key={f} 
                className={`summary-pill ${f.toLowerCase()} ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'ALL' ? `All (${signals.length})` : `${f} (${counts[f]})`}
              </button>
            ))}
          </div>

          <div className="signals-table-wrap">
            <table className="signals-table">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Decision</th>
                  <th>Score</th>
                  <th>Signals</th>
                  <th>Price</th>
                  <th>Trend</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((sig, index) => (
                  <tr 
                    key={`${sig.symbol}-${index}`} 
                    className="signal-table-row"
                    onClick={() => onSelectStock(sig.symbol)}
                  >
                    <td>
                      <div className="sym-cell">
                        <span className="sym-ticker">{sig.symbol.replace('.NS', '')}</span>
                        <span className="sym-name">{sig.shortName ?? sig.symbol}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`decision-badge ${sig.decision.toLowerCase()}`}>
                        {sig.decision}
                      </span>
                    </td>
                    <td>
                      <div className="score-bar-cell">
                        <span className="score-val">{sig.score}</span>
                        <div className="score-bar-bg">
                          <div 
                            className={`score-bar-fill ${sig.decision.toLowerCase()}`}
                            style={{ width: `${Math.min(sig.score, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="reason-cell">{getSignalReasons(sig)}</td>
                    <td className="mono">₹{sig.price?.toFixed(2) ?? '—'}</td>
                    <td className={`trend-text ${sig.trend?.toLowerCase().includes('up') ? 'buy-color' : sig.trend?.toLowerCase().includes('down') ? 'avoid-color' : 'hold-color'}`}>
                      {sig.trend ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="dash-empty">
          <div className="empty-icon">📭</div>
          <div className="empty-title">No signals found</div>
          <div className="empty-sub">
            Run the strategy to generate today&apos;s trading signals, or check back during market hours.
          </div>
          <button className="run-btn" onClick={handleRunNow} disabled={isRunning}>
            {isRunning ? 'Running...' : 'Run Strategy Now'}
          </button>
        </div>
      )}
    </div>
  );
}