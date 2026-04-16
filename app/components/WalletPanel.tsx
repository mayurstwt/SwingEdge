'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TradeRow, LedgerRow } from '@/lib/supabase';

export default function WalletPanel() {
  const [balance, setBalance] = useState<number | null>(null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [signals, setSignals] = useState<{ symbol: string; price: number }[]>([]);

  // 🔥 NEW: analytics state
  const [analytics, setAnalytics] = useState<any>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'open' | 'closed'>('open');

  const [showTradeForm, setShowTradeForm] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);

  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [tradeForm, setTradeForm] = useState({ symbol: '', short_name: '', buy_price: '', quantity: '1' });

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 🔥 FETCH WALLET
  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet');
      const data = await res.json();
      setBalance(data.balance ?? 0);
      setTrades(data.trades ?? []);
      setLedger(data.ledger ?? []);
      setSignals(data.signals ?? []);
    } catch {
      setError('Unable to fetch wallet data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 🔥 FETCH ANALYTICS
  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics');
      const data = await res.json();
      setAnalytics(data);
    } catch {
      console.log('Analytics failed');
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

  const fmt = (v: number) =>
    `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const openTrades = trades.filter(t => t.status === 'OPEN');
  const closedTrades = trades.filter(t => t.status === 'CLOSED');

  // 🔥 PnL
  const realizedPnL = closedTrades.reduce((sum, t) => sum + (t.profit_loss ?? 0), 0);

  const signalMap = new Map(signals.map(s => [s.symbol.trim(), s.price]));

  const unrealizedPnL = openTrades.reduce((sum, t) => {
    const currentPrice = signalMap.get(t.symbol.trim());
    if (!currentPrice) return sum;
    return sum + ((currentPrice - t.buy_price) * t.quantity);
  }, 0);

  const totalPnL = realizedPnL + unrealizedPnL;

  if (isLoading) return <div className="wallet-panel"><div className="skeleton-row tall" /></div>;

  return (
    <div className="wallet-panel">

      {/* 🔥 NEW: ANALYTICS DASHBOARD */}
      {analytics && (
        <div className="wallet-summary-grid">
          <div className="summary-card">
            <span className="summary-label">Win Rate</span>
            <span className="summary-value">{analytics.winRate}%</span>
          </div>

          <div className="summary-card">
            <span className="summary-label">Total Trades</span>
            <span className="summary-value">{analytics.totalTrades}</span>
          </div>

          <div className="summary-card">
            <span className="summary-label">Avg Profit</span>
            <span className="summary-value">{fmt(analytics.avgProfit)}</span>
          </div>

          <div className="summary-card">
            <span className="summary-label">Best Trade</span>
            <span className="summary-value buy-color">{fmt(analytics.bestTrade)}</span>
          </div>

          <div className="summary-card">
            <span className="summary-label">Worst Trade</span>
            <span className="summary-value avoid-color">{fmt(analytics.worstTrade)}</span>
          </div>
        </div>
      )}

      {/* EXISTING SUMMARY */}
      <div className="wallet-summary-grid mt-4">
        <div className="summary-card">
          <span className="summary-label">Total P&L</span>
          <span className={`summary-value ${totalPnL >= 0 ? 'buy-color' : 'avoid-color'}`}>
            {totalPnL >= 0 ? '+' : ''}{fmt(totalPnL)}
          </span>
        </div>
      </div>

      {/* TRADES */}
      <div className="trade-tabs mt-4">
        <button className={`trade-tab ${activeTab === 'open' ? 'active' : ''}`} onClick={() => setActiveTab('open')}>
          Active ({openTrades.length})
        </button>
        <button className={`trade-tab ${activeTab === 'closed' ? 'active' : ''}`} onClick={() => setActiveTab('closed')}>
          History
        </button>
      </div>

      <div className="trades-list">
        {(activeTab === 'open' ? openTrades : closedTrades).map(trade => (
          <div key={trade.id} className="trade-card">
            <div className="trade-left">
              <span>{trade.symbol}</span>
              <span>{trade.quantity} @ {fmt(trade.buy_price)}</span>
            </div>
            <div className="trade-right">
              {trade.status === 'OPEN' ? (
                <span>OPEN</span>
              ) : (
                <span className={Number(trade.profit_loss) >= 0 ? 'buy-color' : 'avoid-color'}>
                  {fmt(trade.profit_loss || 0)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}