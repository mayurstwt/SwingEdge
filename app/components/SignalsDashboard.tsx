// app/components/SignalsDashboard.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Signal } from '@/lib/trading/types';

interface SignalsDashboardProps {
  onSelectStock: (symbol: string) => void;
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
      const data = await res.json();

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
      const res = await fetch('/api/run-strategy', { method: 'POST' });
      const data = await res.json();

      if (data.logs) setDebugLogs(data.logs);

      if (!res.ok) {
        throw new Error(data.error ?? 'Strategy run failed');
      }

      await fetchSignals();
      await fetch('/api/wallet');
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

  return (
    <div className="signals-dashboard">
      <div className="dash-header">
        <div>
          <h2>Daily Signals</h2>
          {runDate && <small>Latest: {formatDate(runDate)}</small>}
        </div>

        <div>
          <button onClick={handleRunNow} disabled={isRunning}>
            {isRunning ? 'Running...' : 'Run Strategy'}
          </button>
          <button onClick={fetchSignals}>Refresh</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {signals.length > 0 ? (
        <>
          <div>
            {(['ALL', 'BUY', 'HOLD', 'AVOID'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}>
                {f === 'ALL' ? `All (${signals.length})` : `${f} (${counts[f]})`}
              </button>
            ))}
          </div>

          <table>
            <thead>
              <tr>
                <th>Stock</th>
                <th>Decision</th>
                <th>Score</th>
                <th>Signals</th>
                <th>Price</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((sig, index) => (
                <tr key={index} onClick={() => onSelectStock(sig.symbol)}>
                  <td>{sig.symbol}</td>
                  <td>{sig.decision}</td>
                  <td>{sig.score}</td>

                  {/* ✅ FIXED: signals instead of reason */}
                  <td>{sig.signals?.join(', ') || '—'}</td>

                  <td>₹{sig.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        !isLoading && <div>No signals found</div>
      )}
    </div>
  );
}