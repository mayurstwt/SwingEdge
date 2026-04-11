'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TradeRow } from '@/lib/supabase';

export default function WalletPanel() {
  const [balance, setBalance] = useState<number | null>(null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
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

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet');
      const data = await res.json();
      setBalance(data.balance ?? 0);
      setTrades(data.trades ?? []);
    } catch {
      setError('Unable to fetch wallet data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  const handleDeposit = async () => {
    const val = parseFloat(depositAmount);
    if (isNaN(val) || val <= 0) return setError('Enter a valid amount');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deposit', amount: val }),
      });
      if (!res.ok) throw new Error('Deposit failed');
      setDepositAmount('');
      setShowDepositForm(false);
      await fetchWallet();
    } catch (err: any) { setError(err.message); } finally { setIsSubmitting(false); }
  };

  const handleWithdraw = async () => {
    const val = parseFloat(withdrawAmount);
    if (isNaN(val) || val <= 0) return setError('Enter a valid amount');
    if (balance !== null && val > balance) return setError('Insufficient funds');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'withdraw', amount: val }),
      });
      if (!res.ok) throw new Error('Withdrawal failed');
      setWithdrawAmount('');
      setShowWithdrawForm(false);
      await fetchWallet();
    } catch (err: any) { setError(err.message); } finally { setIsSubmitting(false); }
  };

  const handleOpenTrade = async () => {
    setError('');
    const price = parseFloat(tradeForm.buy_price);
    const qty = parseInt(tradeForm.quantity);
    if (!tradeForm.symbol || isNaN(price) || isNaN(qty)) return setError('Fill all fields');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'open',
          symbol: tradeForm.symbol.toUpperCase().includes('.NS') ? tradeForm.symbol.toUpperCase() : `${tradeForm.symbol.toUpperCase()}.NS`,
          short_name: tradeForm.short_name || tradeForm.symbol.toUpperCase(),
          buy_price: price,
          quantity: qty,
        }),
      });
      if (!res.ok) throw new Error('Failed to open trade');
      setTradeForm({ symbol: '', short_name: '', buy_price: '', quantity: '1' });
      setShowTradeForm(false);
      await fetchWallet();
    } catch (err: any) { setError(err.message); } finally { setIsSubmitting(false); }
  };

  const handleCloseTrade = async (trade: TradeRow) => {
    const sellPriceStr = prompt(`Closing ${trade.symbol.replace('.NS', '')}. Buy: ₹${trade.buy_price}.\nEnter Sell Price:`);
    if (!sellPriceStr) return;
    const sellPrice = parseFloat(sellPriceStr);
    if (isNaN(sellPrice)) return alert('Invalid price');
    const res = await fetch('/api/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', trade_id: trade.id, sell_price: sellPrice }),
    });
    if (!res.ok) alert('Close failed');
    else await fetchWallet();
  };

  const fmt = (v: number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const openTrades = trades.filter(t => t.status === 'OPEN');
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  const totalPnL = closedTrades.reduce((sum, t) => sum + (t.profit_loss ?? 0), 0);
  const totalCharges = trades.reduce((sum, t) => sum + (t.charges ?? 0), 0);

  if (isLoading) return <div className="wallet-panel"><div className="skeleton-row tall" /></div>;

  return (
    <div className="wallet-panel" id="wallet-panel">
      {/* ── Balance Strip ── */}
      <div className="wallet-balance-strip">
        <div className="balance-block">
          <span className="balance-label">Cash Balance</span>
          <span className="balance-value">{balance !== null ? fmt(balance) : '—'}</span>
          <div className="charges-note">
            Includes simulated <span className="avoid-color">slippage + charges</span>
          </div>
        </div>
        <div className="wallet-actions">
          <button className="add-funds-btn" onClick={() => { setShowDepositForm(!showDepositForm); setShowWithdrawForm(false); setShowTradeForm(false); }}>{showDepositForm ? '✕' : '+ Deposit'}</button>
          <button className="add-funds-btn" onClick={() => { setShowWithdrawForm(!showWithdrawForm); setShowDepositForm(false); setShowTradeForm(false); }}>{showWithdrawForm ? '✕' : '- Withdraw'}</button>
          <button className="open-trade-btn" onClick={() => { setShowTradeForm(!showTradeForm); setShowDepositForm(false); setShowWithdrawForm(false); }}>{showTradeForm ? '✕' : '+ Buy'}</button>
        </div>
      </div>

      {showDepositForm && (
        <div className="trade-form slide-in">
          <h4 className="form-title">Deposit Funds</h4>
          <div className="form-row">
            <input className="form-input" type="number" placeholder="₹ Amount" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
            <button className="submit-trade-btn" onClick={handleDeposit} disabled={isSubmitting}>Confirm</button>
          </div>
        </div>
      )}

      {showWithdrawForm && (
        <div className="trade-form slide-in">
          <h4 className="form-title">Withdraw Funds</h4>
          <div className="form-row">
            <input className="form-input" type="number" placeholder="₹ Amount" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} />
            <button className="submit-trade-btn" onClick={handleWithdraw} disabled={isSubmitting} style={{ background: 'rgba(255, 61, 113, 0.2)', color: 'var(--color-avoid)' }}>Confirm</button>
          </div>
        </div>
      )}

      {showTradeForm && (
        <div className="trade-form slide-in">
          <h4 className="form-title">Manual Paper Trade</h4>
          <div className="form-row">
            <input className="form-input" placeholder="Symbol" value={tradeForm.symbol} onChange={e => setTradeForm({ ...tradeForm, symbol: e.target.value })} />
            <input className="form-input" type="number" placeholder="Buy Price" value={tradeForm.buy_price} onChange={e => setTradeForm({ ...tradeForm, buy_price: e.target.value })} />
            <input className="form-input" type="number" placeholder="Qty" value={tradeForm.quantity} onChange={e => setTradeForm({ ...tradeForm, quantity: e.target.value })} />
          </div>
          <button className="submit-trade-btn" onClick={handleOpenTrade} disabled={isSubmitting}>Open Trade</button>
        </div>
      )}

      <div className="trade-tabs mt-4">
        <button className={`trade-tab ${activeTab === 'open' ? 'active' : ''}`} onClick={() => setActiveTab('open')}>Active Positions ({openTrades.length})</button>
        <button className={`trade-tab ${activeTab === 'closed' ? 'active' : ''}`} onClick={() => setActiveTab('closed')}>History</button>
      </div>

      <div className="trades-list">
        {(activeTab === 'open' ? openTrades : closedTrades).map(trade => (
          <div key={trade.id} className="trade-card">
            <div className="trade-left">
              <div className="trade-header-row">
                <span className="trade-sym">{trade.symbol.replace('.NS', '')}</span>
                {trade.executed_by === 'AUTO' && <span className="auto-badge">PRO {trade.strategy_version?.split(' ')[0]}</span>}
                <span className="sector-tag">{trade.sector || 'Misc'}</span>
              </div>
              <span className="trade-meta">{trade.quantity} @ {fmt(trade.buy_price)}</span>
              {trade.reason && <p className="trade-reason">"{trade.reason}"</p>}
              {trade.status === 'OPEN' && trade.stop_loss && (
                <div className="trade-levels">
                  <span className="level-item SL">SL: {fmt(trade.stop_loss)}</span>
                  <span className="level-item TGT">TGT: {fmt(trade.target || 0)}</span>
                </div>
              )}
            </div>
            <div className="trade-right">
              {trade.status === 'OPEN' ? (
                <button className="close-trade-btn" onClick={() => handleCloseTrade(trade)}>Sell</button>
              ) : (
                <div className="trade-result">
                  <span className="trade-meta">Sold at {fmt(trade.sell_price || 0)}</span>
                  <span className={`trade-pnl ${Number(trade.profit_loss) >= 0 ? 'buy-color' : 'avoid-color'}`}>
                    {Number(trade.profit_loss) >= 0 ? '+' : ''}{fmt(trade.profit_loss || 0)}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
