'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import SearchBar from './components/SearchBar';
import MarketOverview from './components/MarketOverview';
import StockCard from './components/StockCard';
import SignalsDashboard from './components/SignalsDashboard';
import WalletPanel from './components/WalletPanel';
import DailyNewsPanel from './components/DailyNewsPanel';
import type { AnalysisResult } from '@/lib/strategy';

const PriceChart = dynamic(() => import('./components/PriceChart'), { ssr: false });

type StockData = AnalysisResult & {
  symbol: string;
  shortName: string;
  currency: string;
};

type MainTab = 'live' | 'signals' | 'news';

export default function Home() {
  const [activeTab, setActiveTab] = useState<MainTab>('signals');
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);

  const analyzeStock = useCallback(async (symbol: string) => {
    setActiveTab('live');
    setIsLoading(true);
    setError(null);
    setActiveSymbol(symbol);

    try {
      const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Analysis failed');
      setStockData(data);
      setTimeout(() => {
        document.getElementById('analysis-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStockData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSearchSelect = useCallback(
    (stock: { symbol: string; name: string; sector: string }) => analyzeStock(stock.symbol),
    [analyzeStock]
  );

  const handleWatchlistSelect = useCallback(
    (symbol: string) => analyzeStock(symbol),
    [analyzeStock]
  );

  // Called when user clicks a row in SignalsDashboard
  const handleSignalSelect = useCallback(
    (symbol: string) => analyzeStock(symbol),
    [analyzeStock]
  );

  return (
    <main className="main-layout">
      <div className="bg-grid" aria-hidden="true" />
      <div className="orb orb-1" aria-hidden="true" />
      <div className="orb orb-2" aria-hidden="true" />

      {/* ── Header ───────────────────────────── */}
      <header className="site-header" id="site-header">
        <div className="header-inner">
          <div className="logo-block">
            <div className="logo-icon" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none">
                <path d="M4 22L11 14L17 18L24 8L28 12" stroke="#00d4ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="11" cy="14" r="2" fill="#00ff88" />
                <circle cx="17" cy="18" r="2" fill="#ffb300" />
                <circle cx="24" cy="8" r="2" fill="#00d4ff" />
              </svg>
            </div>
            <div>
              <h1 className="site-title">SwingEdge</h1>
              <p className="site-tagline">NSE Swing Trading Signals</p>
            </div>
          </div>
          <div className="header-badges">
            <span className="badge badge-nse">NSE India</span>
            <span className="badge badge-live">
              <span className="live-dot" />
              Live Data
            </span>
            <span className="badge badge-db">Supabase DB</span>
          </div>
        </div>
      </header>

      {/* ── Main tabs ────────────────────────── */}
      <nav className="main-tabs" id="main-tabs" aria-label="Main navigation">
        <button
          id="tab-live"
          className={`main-tab ${activeTab === 'live' ? 'active' : ''}`}
          onClick={() => setActiveTab('live')}
        >
          <span className="tab-icon">⚡</span>
          Live Analysis
        </button>
        <button
          id="tab-signals"
          className={`main-tab ${activeTab === 'signals' ? 'active' : ''}`}
          onClick={() => setActiveTab('signals')}
        >
          <span className="tab-icon">📊</span>
          Daily Signals
          <span className="tab-badge">AUTO</span>
        </button>
        <button
          id="tab-news"
          className={`main-tab ${activeTab === 'news' ? 'active' : ''}`}
          onClick={() => setActiveTab('news')}
        >
          <span className="tab-icon">📰</span>
          Daily News
          <span className="tab-badge">FREE</span>
        </button>
      </nav>

      {/* ═══════════════════════════════════════
          LIVE ANALYSIS TAB
      ═══════════════════════════════════════ */}
      {activeTab === 'live' && (
        <>
          <section className="hero-section" id="hero-section">
            <div className="hero-content">
              <p className="hero-pre">Powered by Technical Analysis</p>
              <h2 className="hero-headline">
                BUY · HOLD · AVOID
                <span className="headline-glow" aria-hidden="true">BUY · HOLD · AVOID</span>
              </h2>
              <p className="hero-sub">
                RSI, MACD, Bollinger Bands &amp; SMA crossovers.
                <br />
                Dynamic stop-loss &amp; targets via ATR. Signals saved to Supabase.
              </p>
            </div>

            <div className="search-section" id="search-section">
              <SearchBar onSelect={handleSearchSelect} isLoading={isLoading} />
            </div>

            <MarketOverview onSelect={handleWatchlistSelect} activeSymbol={activeSymbol} />
          </section>

          {isLoading && (
            <section className="loading-section" id="loading-section" aria-live="polite">
              <div className="loading-card">
                <div className="loading-bars" aria-hidden="true">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="loading-bar" style={{ animationDelay: `${i * 0.1}s` }} />
                  ))}
                </div>
                <p className="loading-text">Fetching market data &amp; computing signals…</p>
                <div className="loading-steps">
                  {['Fetching OHLCV', 'Computing RSI / MACD', 'Scoring signals', 'Building chart'].map((step, i) => (
                    <span key={i} className="loading-step" style={{ animationDelay: `${i * 0.4}s` }}>{step}</span>
                  ))}
                </div>
              </div>
            </section>
          )}

          {!isLoading && error && (
            <section className="error-section" id="error-section" aria-live="assertive">
              <div className="error-card">
                <div className="error-icon">⚠</div>
                <p className="error-message">{error}</p>
                <p className="error-hint">Try searching a different stock symbol.</p>
              </div>
            </section>
          )}

          {!isLoading && !error && stockData && (
            <section className="results-section" id="analysis-results" aria-label="Stock analysis results">
              <div className="results-grid">
                <StockCard data={stockData} />
                <PriceChart
                  priceHistory={stockData.priceHistory}
                  sma50History={stockData.sma50History}
                  sma200History={stockData.sma200History}
                  symbol={stockData.symbol}
                />
              </div>
            </section>
          )}

          {!isLoading && !error && !stockData && (
            <section className="empty-section" id="empty-state">
              <div className="empty-cards-row" aria-hidden="true">
                {['BUY', 'HOLD', 'AVOID'].map((label) => (
                  <div key={label} className={`empty-demo-card demo-${label.toLowerCase()}`}>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <p className="empty-hint">Search for any NSE stock to get swing trading signals</p>
            </section>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════
          DAILY SIGNALS TAB
      ═══════════════════════════════════════ */}
      {activeTab === 'signals' && (
        <section className="signals-tab-content" id="signals-tab-content">
          <SignalsDashboard onSelectStock={handleSignalSelect} />
          <WalletPanel />
        </section>
      )}

      <section
        className="signals-tab-content"
        id="news-tab-content"
        style={{ display: activeTab === 'news' ? undefined : 'none' }}
      >
        <DailyNewsPanel />
      </section>

      <footer className="site-footer" id="site-footer">
        <p>SwingEdge — Educational purposes only. Not financial advice.</p>
        <p>Data: Yahoo Finance · DB: Supabase · Hosted: Netlify · Cron: GitHub Actions</p>
      </footer>
    </main>
  );
}
