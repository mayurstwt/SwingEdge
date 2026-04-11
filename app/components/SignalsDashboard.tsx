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
  const [filter, setFilter] = useState<'ALL' | 'BUY' | 'HOLD' | 'AVOID'>('ALL');

  const fetchSignals = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/signals');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load signals');
      setSignals(data.signals ?? []);
      setRunDate(data.run_date ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSignals(); }, [fetchSignals]);

  const handleRunNow = async () => {
    setIsRunning(true);
    try {
      const res = await fetch('/api/run-strategy', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Strategy run failed');
      await fetchSignals();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Run failed');
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
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="signals-dashboard" id="signals-dashboard">
      {/* Header */}
      <div className="dash-header">
        <div className="dash-title-block">
          <h2 className="dash-title">Daily Signals</h2>
          {runDate && (
            <span className="dash-date">
              <span className="live-dot" />
              Last run: {formatDate(runDate)}
            </span>
          )}
        </div>
        <div className="dash-actions">
          <button
            id="run-strategy-btn"
            className={`run-btn ${isRunning ? 'running' : ''}`}
            onClick={handleRunNow}
            disabled={isRunning}
            title="Manually trigger strategy run"
          >
            {isRunning ? (
              <><span className="spinner-ring sm" /> Running…</>
            ) : (
              <>▶ Run Strategy Now</>
            )}
          </button>
          <button className="refresh-btn" onClick={fetchSignals} disabled={isLoading} title="Refresh signals">
            ⟳ Refresh
          </button>
        </div>
      </div>

      {/* Summary pills */}
      {signals.length > 0 && (
        <div className="signal-summary">
          {(['ALL', 'BUY', 'HOLD', 'AVOID'] as const).map(f => (
            <button
              key={f}
              className={`summary-pill ${f.toLowerCase()} ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
              id={`filter-${f.toLowerCase()}`}
            >
              {f === 'ALL' ? `All ${signals.length}` : `${f} ${counts[f]}`}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {isLoading && (
        <div className="dash-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <div className="dash-error" id="dash-error">
          <span>⚠ {error}</span>
        </div>
      )}

      {!isLoading && !error && signals.length === 0 && (
        <div className="dash-empty" id="dash-empty">
          <div className="empty-icon">📊</div>
          <p className="empty-title">No signals yet for today</p>
          <p className="empty-sub">
            Click <strong>Run Strategy Now</strong> to analyze the top 15 NSE stocks and populate today&apos;s signals,
            or wait for the automated GitHub Actions run at 9 PM IST.
          </p>
          <button className="run-btn" onClick={handleRunNow} disabled={isRunning} id="empty-run-btn">
            {isRunning ? 'Running…' : '▶ Run Strategy Now'}
          </button>
        </div>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <div className="signals-table-wrap">
          <table className="signals-table" id="signals-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Decision</th>
                <th>Score</th>
                <th>Price</th>
                <th>Stop Loss</th>
                <th>Target</th>
                <th>RSI</th>
                <th>Trend</th>
                <th>Chg%</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(sig => (
                <SignalRow key={sig.id} sig={sig} onSelect={onSelectStock} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SignalRow({ sig, onSelect }: { sig: SignalRow; onSelect: (s: string) => void }) {
  const decClass = sig.decision === 'BUY' ? 'buy' : sig.decision === 'AVOID' ? 'avoid' : 'hold';
  const trendIcon = sig.trend === 'UPTREND' ? '↗' : sig.trend === 'DOWNTREND' ? '↘' : '→';
  const isPos = (sig.change_pct ?? 0) >= 0;
  const fmt = (v: number | null) =>
    v !== null ? `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  return (
    <tr
      className="signal-table-row"
      onClick={() => onSelect(sig.symbol)}
      title={`Analyze ${sig.symbol} live`}
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onSelect(sig.symbol)}
    >
      <td>
        <div className="sym-cell">
          <span className="sym-ticker">{sig.symbol.replace('.NS', '')}</span>
          <span className="sym-name">{sig.short_name ?? '—'}</span>
        </div>
      </td>
      <td>
        <span className={`decision-badge ${decClass}`}>{sig.decision}</span>
      </td>
      <td>
        <div className="score-bar-cell">
          <span className="score-val">{sig.score}</span>
          <div className="score-bar-bg">
            <div className={`score-bar-fill ${decClass}`} style={{ width: `${sig.score}%` }} />
          </div>
        </div>
      </td>
      <td className="mono">{fmt(sig.price)}</td>
      <td className="mono avoid-color">{fmt(sig.stop_loss)}</td>
      <td className="mono buy-color">{fmt(sig.target)}</td>
      <td className={`mono ${sig.rsi > 65 ? 'avoid-color' : sig.rsi < 35 ? 'hold-color' : 'buy-color'}`}>
        {sig.rsi?.toFixed(1) ?? '—'}
      </td>
      <td>
        <span className={`trend-text ${sig.trend === 'UPTREND' ? 'buy-color' : sig.trend === 'DOWNTREND' ? 'avoid-color' : 'hold-color'}`}>
          {trendIcon} {sig.trend?.replace('TREND', '') ?? '—'}
        </span>
      </td>
      <td className={`mono ${isPos ? 'buy-color' : 'avoid-color'}`}>
        {isPos ? '+' : ''}{sig.change_pct?.toFixed(2) ?? '0'}%
      </td>
    </tr>
  );
}
