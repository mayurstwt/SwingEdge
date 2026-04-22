'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LedgerRow, TradeRow } from '@/lib/supabase';

interface AnalyticsSummary {
  winRate?: number;
  totalTrades?: number;
  avgProfit?: number;
  bestTrade?: number;
  worstTrade?: number;
}

type WalletAction = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAW' | null;

interface DailyPnlRow {
  date: string;
  pnl: number;
  trades: number;
}

export default function WalletPanel() {
  const [balance, setBalance] = useState(0);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [signals, setSignals] = useState<{ symbol: string; price: number }[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'open' | 'closed' | 'daily'>('open');
  const [activeAction, setActiveAction] = useState<WalletAction>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [buyForm, setBuyForm] = useState({
    symbol: '',
    short_name: '',
    buy_price: '',
    quantity: '1',
  });
  const [sellForm, setSellForm] = useState({
    trade_id: '',
    sell_price: '',
  });

  const fmt = (value: number) =>
    `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet');
      const data = await res.json();
      setBalance(Number(data.balance ?? 0));
      setTrades(data.trades ?? []);
      setLedger(data.ledger ?? []);
      setSignals(data.signals ?? []);
    } catch {
      setError('Unable to fetch wallet data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics');
      const data = await res.json();
      setAnalytics(data.message ? null : data);
    } catch {
      setAnalytics(null);
    }
  }, []);

  useEffect(() => {
    fetchWallet();
    fetchAnalytics();

    const interval = setInterval(() => {
      fetchWallet();
      fetchAnalytics();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchWallet, fetchAnalytics]);

  const openTrades = useMemo(() => trades.filter((trade) => trade.status === 'OPEN'), [trades]);
  const closedTrades = useMemo(() => trades.filter((trade) => trade.status === 'CLOSED'), [trades]);
  const signalMap = useMemo(() => new Map(signals.map((signal) => [signal.symbol.trim(), signal.price])), [signals]);

  const investedCapital = openTrades.reduce((sum, trade) => sum + trade.buy_price * trade.quantity, 0);
  const realizedPnL = closedTrades.reduce((sum, trade) => sum + Number(trade.profit_loss ?? 0), 0);
  const unrealizedPnL = openTrades.reduce((sum, trade) => {
    const currentPrice = signalMap.get(trade.symbol.trim());
    if (!currentPrice) {
      return sum;
    }

    return sum + (currentPrice - trade.buy_price) * trade.quantity;
  }, 0);
  const overallPnL = realizedPnL + unrealizedPnL;

  const dailyPnlRows = useMemo(() => {
    // Aggregate closed trades by date
    const closedByDate = closedTrades.reduce<DailyPnlRow[]>((rows, trade) => {
      const date = (trade.closed_at ?? trade.opened_at).slice(0, 10);
      const existing = rows.find((row) => row.date === date);
      const pnl = Number(trade.profit_loss ?? 0);
      if (existing) {
        existing.pnl += pnl;
        existing.trades += 1;
      } else {
        rows.push({ date, pnl, trades: 1 });
      }
      return rows;
    }, []);

    // Add today's row with open-trade unrealized P&L even if no closes yet
    const todayDate = new Date().toISOString().slice(0, 10);

    // Detect trades opened today — compare date prefix tolerantly
    const tradesOpenedToday = openTrades.filter((t) => {
      const d = t.opened_at ? t.opened_at.slice(0, 10) : '';
      return d === todayDate;
    });

    const openUnrealizedToday = tradesOpenedToday.reduce((sum, t) => {
      const cp = signalMap.get(t.symbol.trim());
      return sum + (cp ? (cp - t.buy_price) * t.quantity : 0);
    }, 0);

    const todayRow = closedByDate.find((r) => r.date === todayDate);
    if (todayRow) {
      todayRow.pnl += openUnrealizedToday;
    } else {
      // Always show today if: any trades closed today, or any trades opened today
      const hasActivity =
        tradesOpenedToday.length > 0 ||
        closedTrades.some((t) => (t.closed_at ?? t.opened_at).slice(0, 10) === todayDate);
      if (hasActivity) {
        closedByDate.push({ date: todayDate, pnl: openUnrealizedToday, trades: 0 });
      }
    }

    return closedByDate.sort((a, b) => b.date.localeCompare(a.date));
  }, [closedTrades, openTrades, signalMap]);

  const today = new Date().toISOString().slice(0, 10);
  // Today P&L = realized closes today + unrealized open trades
  const todayPnl = dailyPnlRows.find((row) => row.date === today)?.pnl ?? 0;
  const openProfitCount = openTrades.filter((trade) => {
    const currentPrice = signalMap.get(trade.symbol.trim());
    return currentPrice !== undefined && currentPrice > trade.buy_price;
  }).length;

  useEffect(() => {
    if (activeAction !== 'SELL') {
      return;
    }

    const trade = openTrades.find((item) => item.id === sellForm.trade_id) ?? openTrades[0];
    if (!trade) {
      return;
    }

    const marketPrice =
      signals.find((signal) => signal.symbol.trim() === trade.symbol.trim())?.price ?? trade.buy_price;
    
    const priceStr = String(marketPrice);

    // Only update if state actually changed to prevent infinite loops
    if (sellForm.trade_id !== trade.id || (!sellForm.sell_price && priceStr)) {
      setSellForm((current) => {
        if (current.trade_id === trade.id && current.sell_price === (current.sell_price || priceStr)) {
          return current;
        }
        return {
          trade_id: trade.id,
          sell_price: current.sell_price || priceStr,
        };
      });
    }
  }, [activeAction, openTrades, sellForm.trade_id, sellForm.sell_price, signals]);

  async function submitAction(payload: Record<string, unknown>) {
    setIsSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Wallet action failed');
      }

      setSuccess('Wallet updated successfully.');
      setDepositAmount('');
      setWithdrawAmount('');
      setBuyForm({ symbol: '', short_name: '', buy_price: '', quantity: '1' });
      setSellForm({ trade_id: '', sell_price: '' });
      await Promise.all([fetchWallet(), fetchAnalytics()]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Wallet action failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDepositSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await submitAction({
      action: 'deposit',
      amount: Number(depositAmount),
    });
  }

  async function handleWithdrawSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await submitAction({
      action: 'withdraw',
      amount: Number(withdrawAmount),
    });
  }

  async function handleBuySubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await submitAction({
      action: 'open',
      symbol: buyForm.symbol.trim().toUpperCase(),
      short_name: buyForm.short_name.trim() || buyForm.symbol.trim().toUpperCase(),
      buy_price: Number(buyForm.buy_price),
      quantity: Number(buyForm.quantity),
    });
  }

  async function handleSellSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await submitAction({
      action: 'close',
      trade_id: sellForm.trade_id,
      sell_price: Number(sellForm.sell_price),
    });
  }

  if (isLoading) {
    return <div className="wallet-panel"><div className="skeleton-row tall" /></div>;
  }

  return (
    <div className="wallet-panel">
      <div className="wallet-balance-strip">
        <div className="balance-block">
          <span className="balance-label">Wallet Balance</span>
          <span className="balance-value">{fmt(balance)}</span>
          <span className="balance-sub">Paper trading capital available right now</span>
        </div>

        <div className="wallet-stats">
          <div className="wstat">
            <span className="wstat-label">Invested</span>
            <span className="wstat-val">{fmt(investedCapital)}</span>
          </div>
          <div className="wstat">
            <span className="wstat-label">Open Trades</span>
            <span className="wstat-val">{openTrades.length}</span>
          </div>
          <div className="wstat">
            <span className="wstat-label">Green Trades</span>
            <span className="wstat-val buy-color">{openProfitCount}</span>
          </div>
        </div>
      </div>

      {analytics && (
        <div className="wallet-summary-grid">
          <div className="summary-card">
            <span className="summary-label">Today P&amp;L</span>
            <span className={`summary-value ${todayPnl >= 0 ? 'buy-color' : 'avoid-color'}`}>
              {todayPnl >= 0 ? '+' : ''}{fmt(todayPnl)}
            </span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Overall P&amp;L</span>
            <span className={`summary-value ${overallPnL >= 0 ? 'buy-color' : 'avoid-color'}`}>
              {overallPnL >= 0 ? '+' : ''}{fmt(overallPnL)}
            </span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Realized P&amp;L</span>
            <span className={`summary-value ${realizedPnL >= 0 ? 'buy-color' : 'avoid-color'}`}>
              {realizedPnL >= 0 ? '+' : ''}{fmt(realizedPnL)}
            </span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Unrealized P&amp;L</span>
            <span className={`summary-value ${unrealizedPnL >= 0 ? 'buy-color' : 'avoid-color'}`}>
              {unrealizedPnL >= 0 ? '+' : ''}{fmt(unrealizedPnL)}
            </span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Win Rate</span>
            <span className="summary-value">{analytics.winRate ?? 0}%</span>
          </div>
          <div className="summary-card">
            <span className="summary-label">Total Trades</span>
            <span className="summary-value">{analytics.totalTrades ?? 0}</span>
          </div>
        </div>
      )}

      <div className="wallet-actions">
        {(['DEPOSIT', 'WITHDRAW', 'BUY', 'SELL'] as const).map((action) => (
          <button
            key={action}
            className={`wallet-action-btn ${activeAction === action ? 'active' : ''}`}
            onClick={() => {
              setActiveAction(activeAction === action ? null : action);
              setError('');
              setSuccess('');
            }}
          >
            {action}
          </button>
        ))}
      </div>

      {activeAction === 'DEPOSIT' && (
        <form className="trade-form" onSubmit={handleDepositSubmit}>
          <div className="form-row single">
            <input
              className="form-input"
              type="number"
              min="1"
              step="0.01"
              placeholder="Deposit amount"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
            />
          </div>
          <button className="submit-trade-btn deposit-btn" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Processing...' : 'Add Funds'}
          </button>
        </form>
      )}

      {activeAction === 'WITHDRAW' && (
        <form className="trade-form" onSubmit={handleWithdrawSubmit}>
          <div className="form-row single">
            <input
              className="form-input"
              type="number"
              min="1"
              step="0.01"
              placeholder="Withdraw amount"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
            />
          </div>
          <button className="submit-trade-btn withdraw-btn" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Processing...' : 'Withdraw Funds'}
          </button>
        </form>
      )}

      {activeAction === 'BUY' && (
        <form className="trade-form" onSubmit={handleBuySubmit}>
          <div className="form-row">
            <input
              className="form-input"
              placeholder="Symbol e.g. RELIANCE.NS"
              value={buyForm.symbol}
              onChange={(e) => setBuyForm((current) => ({ ...current, symbol: e.target.value }))}
            />
            <input
              className="form-input"
              placeholder="Short name"
              value={buyForm.short_name}
              onChange={(e) => setBuyForm((current) => ({ ...current, short_name: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <input
              className="form-input"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Buy price"
              value={buyForm.buy_price}
              onChange={(e) => setBuyForm((current) => ({ ...current, buy_price: e.target.value }))}
            />
            <input
              className="form-input"
              type="number"
              min="1"
              step="1"
              placeholder="Quantity"
              value={buyForm.quantity}
              onChange={(e) => setBuyForm((current) => ({ ...current, quantity: e.target.value }))}
            />
          </div>
          <button className="submit-trade-btn buy-btn" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Processing...' : 'Buy Stock'}
          </button>
        </form>
      )}

      {activeAction === 'SELL' && (
        <form className="trade-form" onSubmit={handleSellSubmit}>
          <div className="form-row">
            <select
              className="form-input"
              value={sellForm.trade_id}
              onChange={(e) => {
                const trade = openTrades.find((item) => item.id === e.target.value);
                setSellForm({
                  trade_id: e.target.value,
                  sell_price: String(
                    trade ? (signalMap.get(trade.symbol.trim()) ?? trade.buy_price) : ''
                  ),
                });
              }}
            >
              <option value="">Select open trade</option>
              {openTrades.map((trade) => (
                <option key={trade.id} value={trade.id}>
                  {trade.symbol} | Qty {trade.quantity} | Buy {fmt(trade.buy_price)}
                </option>
              ))}
            </select>
            <input
              className="form-input"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Sell price"
              value={sellForm.sell_price}
              onChange={(e) => setSellForm((current) => ({ ...current, sell_price: e.target.value }))}
            />
          </div>
          <button className="submit-trade-btn sell-btn" type="submit" disabled={isSubmitting || openTrades.length === 0}>
            {isSubmitting ? 'Processing...' : 'Sell Stock'}
          </button>
        </form>
      )}

      {error && <div className="dash-error">{error}</div>}
      {success && <div className="wallet-success">{success}</div>}

      <div className="trade-tabs mt-4">
        <button className={`trade-tab ${activeTab === 'open' ? 'active' : ''}`} onClick={() => setActiveTab('open')}>
          Active ({openTrades.length})
        </button>
        <button className={`trade-tab ${activeTab === 'closed' ? 'active' : ''}`} onClick={() => setActiveTab('closed')}>
          History ({closedTrades.length})
        </button>
        <button className={`trade-tab ${activeTab === 'daily' ? 'active' : ''}`} onClick={() => setActiveTab('daily')}>
          Daily P&amp;L ({dailyPnlRows.length})
        </button>
      </div>

      {activeTab === 'daily' ? (
        <div className="daily-pnl-list">
          {dailyPnlRows.length === 0 ? (
            <div className="trades-empty">
              No closed trades yet. Open trades will appear here once closed, or when opened today.
            </div>
          ) : (
            dailyPnlRows.map((row) => (
              <div key={row.date} className="daily-pnl-card">
                <div className="trade-left">
                  <span className="trade-sym">
                    {row.date === today ? '📅 Today' : row.date}
                  </span>
                  <span className="trade-meta">
                    {row.trades > 0
                      ? `${row.trades} closed trade${row.trades > 1 ? 's' : ''}`
                      : 'Open positions (unrealized)'}
                  </span>
                </div>
                <div className={`trade-right ${row.pnl >= 0 ? 'buy-color' : 'avoid-color'}`}>
                  {row.pnl >= 0 ? '+' : ''}{fmt(row.pnl)}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="trades-list">
          {(activeTab === 'open' ? openTrades : [...closedTrades].sort((a, b) =>
            new Date(b.closed_at ?? b.opened_at).getTime() -
            new Date(a.closed_at ?? a.opened_at).getTime()
          )).length === 0 ? (
            <div className="trades-empty">
              {activeTab === 'open' ? 'No open trades right now.' : 'No closed trades yet.'}
            </div>
          ) : (
            (() => {
              const list = activeTab === 'open'
                ? openTrades
                : [...closedTrades].sort((a, b) =>
                    new Date(b.closed_at ?? b.opened_at).getTime() -
                    new Date(a.closed_at ?? a.opened_at).getTime()
                  );

              if (activeTab === 'open') {
                return list.map((trade) => {
                  const currentPrice = signalMap.get(trade.symbol.trim());
                  const livePnl = currentPrice
                    ? (currentPrice - trade.buy_price) * trade.quantity
                    : 0;
                  return (
                    <div key={trade.id} className="trade-card">
                      <div className="trade-left">
                        <span className="trade-sym">{trade.symbol}</span>
                        <span className="trade-name">{trade.short_name ?? trade.symbol}</span>
                        <span className="trade-meta">
                          Qty {trade.quantity} @ {fmt(trade.buy_price)}
                          {currentPrice ? ` | LTP ${fmt(currentPrice)}` : ''}
                        </span>
                      </div>
                      <div className="trade-right stacked">
                        <span className="decision-badge hold">OPEN</span>
                        <span className={livePnl >= 0 ? 'buy-color' : 'avoid-color'}>
                          {livePnl >= 0 ? '+' : ''}{fmt(livePnl)}
                        </span>
                      </div>
                    </div>
                  );
                });
              }

              // History: group by date
              const byDate: Record<string, typeof list> = {};
              for (const trade of list) {
                const d = (trade.closed_at ?? trade.opened_at).slice(0, 10);
                if (!byDate[d]) byDate[d] = [];
                byDate[d].push(trade);
              }

              return Object.entries(byDate).map(([date, dateTrades]) => (
                <div key={date}>
                  <div style={{
                    padding: '6px 12px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted, #888)',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    marginTop: '8px',
                  }}>
                    {date === today ? '📅 Today' : date}
                  </div>
                  {dateTrades.map((trade) => {
                    const pnl = Number(trade.profit_loss ?? 0);
                    return (
                      <div key={trade.id} className="trade-card">
                        <div className="trade-left">
                          <span className="trade-sym">{trade.symbol}</span>
                          <span className="trade-name">{trade.short_name ?? trade.symbol}</span>
                          <span className="trade-meta">
                            Qty {trade.quantity} @ {fmt(trade.buy_price)}
                            {trade.sell_price ? ` → ${fmt(trade.sell_price)}` : ''}
                          </span>
                        </div>
                        <div className="trade-right stacked">
                          <span className={`decision-badge ${pnl >= 0 ? 'buy' : 'avoid'}`}>CLOSED</span>
                          <span className={pnl >= 0 ? 'buy-color' : 'avoid-color'}>
                            {pnl >= 0 ? '+' : ''}{fmt(pnl)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ));
            })()
          )}
        </div>
      )}

      {ledger.length > 0 && (
        <div className="ledger-panel">
          <div className="chart-panel-head">
            <h3>Cash Activity</h3>
            <span>Latest deposits and withdrawals</span>
          </div>
          <div className="trades-list">
            {ledger.slice(0, 5).map((entry) => (
              <div key={entry.id} className="trade-card">
                <div className="trade-left">
                  <span className="trade-sym">{entry.description ?? entry.type}</span>
                  <span className="trade-meta">{new Date(entry.created_at).toLocaleString('en-IN')}</span>
                </div>
                <div className={`trade-right ${entry.type === 'CREDIT' ? 'buy-color' : 'avoid-color'}`}>
                  {entry.type === 'CREDIT' ? '+' : '-'}{fmt(entry.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
