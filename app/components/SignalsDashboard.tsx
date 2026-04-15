'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SignalRow } from '@/lib/supabase';

interface SignalsDashboardProps {
  onSelectStock: (symbol: string) => void;
}

export default function SignalsDashboard({ onSelectStock }: SignalsDashboardProps) {
  const [signals, setSignals] = useState<SignalRow[]>([]);
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load signals');
      setSignals(data.signals ?? []);
      setRunDate(data.last_updated_at ?? data.run_date ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSignals(); }, [fetchSignals]);

  const handleRunNow = async () => {
    setIsRunning(true);
    setError(null);
    setDebugLogs([]);
    try {
      const res = await fetch('/api/run-strategy', { method: 'POST' });
      const data = await res.json();
      
      if (data.logs) setDebugLogs(data.logs);

      if (!res.ok) {
        throw new Error(data.error ?? 'Strategy run failed');
      }
      
      if (data.processed === 0 && data.logs?.length > 0) {
        setError("Strategy processed 0 stocks. See logs below.");
      }

      await fetchSignals();
      await fetch('/api/wallet');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsRunning(false);
    }
  };

  const filtered = filter === 'ALL' ? signals : signals.filter(s => s.decision === filter);
  const counts = {
    BUY:   signals.filter(s => s.decision === 'BUY').length,
    HOLD:  signals.filter(s => s.decision === 'HOLD').length,
    AVOID: signals.filter(s => s.decision === 'AVOID').length,
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    const date = new Date(d);
    const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} @ ${timeStr}`;
  };

  return (
    <div className="signals-dashboard" id="signals-dashboard">
      <div className="dash-header">
        <div className="dash-title-block">
          <h2 className="dash-title">Daily Signals <span className="auto-label">AUTO</span></h2>
          {runDate && (
            <span className="dash-date">
              <span className="live-dot" />
              Latest Data: {formatDate(runDate)}
            </span>
          )}
        </div>
        <div className="dash-actions">
          <button className={`run-btn ${isRunning ? 'running' : ''}`} onClick={handleRunNow} disabled={isRunning}>
            {isRunning ? 'Running Scan...' : '▶ Run Strategy Now'}
          </button>
          <button className="refresh-btn" onClick={fetchSignals} disabled={isLoading}>⟳</button>
        </div>
      </div>

      {error && (
        <div className="dash-error slide-in">
          <span>⚠ {error}</span>
          {debugLogs.length > 0 && (
            <div className="debug-logs">
              {debugLogs.slice(0, 5).map((l, i) => <div key={i} className="log-line">{l}</div>)}
            </div>
          )}
        </div>
      )}

      {signals.length > 0 ? (
        <>
          <div className="signal-summary">
            {(['ALL', 'BUY', 'HOLD', 'AVOID'] as const).map(f => (
              <button key={f} className={`summary-pill ${f.toLowerCase()} ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
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
                  <th>Reason</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(sig => (
                  <tr key={sig.id} className="signal-table-row" onClick={() => onSelectStock(sig.symbol)}>
                    <td>
                      <div className="sym-cell">
                        <span className="sym-ticker">{sig.symbol.replace('.NS', '')}</span>
                        <span className="sym-name">{sig.short_name}</span>
                      </div>
                    </td>
                    <td><span className={`decision-badge ${sig.decision.toLowerCase()}`}>{sig.decision}</span></td>
                    <td>{sig.score}</td>
                    <td className="reason-cell">{sig.reason || '—'}</td>
                    <td className="mono">₹{sig.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        !isLoading && !isRunning && (
          <div className="dash-empty">
            <p>No signals found in the database.</p>
            <p className="sub">Click "Run Strategy Now" to scan the market.</p>
          </div>
        )
      )}

      {isLoading && <div className="skeleton-row tall" />}
    </div>
  );
}
