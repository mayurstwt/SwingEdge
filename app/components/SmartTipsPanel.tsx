'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type TipFilter = 'ALL' | 'STRONG_BUY' | 'MODERATE_BUY' | 'WATCH';

interface TradeTip {
  id: string;
  symbol: string;
  short_name?: string | null;
  sector?: string | null;
  tip_type: 'STRONG_BUY' | 'MODERATE_BUY' | 'WATCH';
  composite_score: number;
  suggested_price: number;
  suggested_qty: number;
  stop_loss?: number | null;
  target?: number | null;
  risk_reward?: number | null;
  technical_score?: number | null;
  market_context?: number | null;
  news_sentiment?: number | null;
  news_headlines?: string[] | null;
  reasoning: string;
  status: 'ACTIVE' | 'TRIGGERED' | 'EXPIRED' | 'CANCELLED';
  created_at?: string;
  expires_at?: string | null;
  user_action?: 'BUY' | 'IGNORE' | 'EXPIRED' | null;
}

interface TipsApiResponse {
  tips: TradeTip[];
  fetchedAt: string;
  schemaReady?: boolean;
  message?: string;
  error?: string;
}

export default function SmartTipsPanel() {
  const [tips, setTips] = useState<TradeTip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TipFilter>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [schemaMessage, setSchemaMessage] = useState<string | null>(null);

  const fetchTips = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/tips?limit=24', { cache: 'no-store' });
      const data: TipsApiResponse = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to load Smart Trade Tips');
      }

      setTips(data.tips ?? []);
      setSchemaMessage(data.schemaReady === false ? (data.message ?? 'Smart Trade Tips schema is not ready yet.') : null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Smart Trade Tips');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTips();
  }, [fetchTips]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to generate Smart Trade Tips');
      }

      setSchemaMessage(null);
      await fetchTips();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate Smart Trade Tips');
    } finally {
      setIsGenerating(false);
    }
  }, [fetchTips]);

  const handleTipAction = useCallback(async (id: string, action: 'BUY' | 'IGNORE' | 'DISMISS') => {
    setActiveActionId(id);
    setError(null);

    try {
      const res = await fetch(`/api/tips/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Tip action failed');
      }

      await fetchTips();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Tip action failed');
    } finally {
      setActiveActionId(null);
    }
  }, [fetchTips]);

  const filteredTips = useMemo(() => {
    const sorted = [...tips].sort((a, b) => {
      const scoreDiff = b.composite_score - a.composite_score;
      if (scoreDiff !== 0) return scoreDiff;
      return (b.created_at ?? '').localeCompare(a.created_at ?? '');
    });

    if (filter === 'ALL') return sorted;
    return sorted.filter((tip) => tip.tip_type === filter);
  }, [filter, tips]);

  const counts = useMemo(() => ({
    ALL: tips.length,
    STRONG_BUY: tips.filter((tip) => tip.tip_type === 'STRONG_BUY').length,
    MODERATE_BUY: tips.filter((tip) => tip.tip_type === 'MODERATE_BUY').length,
    WATCH: tips.filter((tip) => tip.tip_type === 'WATCH').length,
  }), [tips]);

  const formatDate = (value: string | null | undefined) => {
    if (!value) return '—';
    const date = new Date(value);
    return `${date.toLocaleDateString('en-IN')} @ ${date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  };

  return (
    <section className="tips-panel">
      <div className="dash-header">
        <div className="dash-title-block">
          <h2 className="dash-title">Smart Trade Tips</h2>
          <span className="dash-date">
            <span>💡</span>
            Conservative ideas from technicals, market regime, and news
          </span>
        </div>

        <div className="dash-actions">
          <button
            className={`run-btn ${isGenerating ? 'running' : ''}`}
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? 'Generating...' : 'Generate Tips'}
          </button>
          <button className="refresh-btn" onClick={fetchTips} disabled={isLoading}>
            Refresh
          </button>
        </div>
      </div>

      <div className="tips-disclaimer">
        Smart Tip: This is an algorithmic suggestion based on technical indicators, market context, and news sentiment. Not financial advice.
      </div>

      {schemaMessage && <div className="dash-error">{schemaMessage}</div>}

      <div className="signal-summary">
        {(['ALL', 'STRONG_BUY', 'MODERATE_BUY', 'WATCH'] as const).map((key) => {
          let colorClass = '';
          if (key === 'STRONG_BUY') colorClass = 'buy';
          else if (key === 'MODERATE_BUY') colorClass = 'hold';
          else if (key === 'WATCH') colorClass = 'avoid';

          return (
            <button
              key={key}
              className={`summary-pill ${colorClass} ${filter === key ? 'active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {key === 'ALL' ? `All (${counts.ALL})` : `${key.replace('_', ' ')} (${counts[key]})`}
            </button>
          );
        })}
      </div>

      {error && <div className="dash-error">{error}</div>}

      {isLoading ? (
        <div className="dash-loading">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton-row tall" />
          ))}
        </div>
      ) : filteredTips.length === 0 ? (
        <div className="dash-empty">
          <div className="empty-icon">💡</div>
          <div className="empty-title">No trade tips available</div>
          <div className="empty-sub">Run the strategy or generate tips manually to populate this panel.</div>
        </div>
      ) : (
        <div className="tips-list">
          {filteredTips.map((tip) => (
            <article
              key={tip.id}
              className={`tip-card ${tip.tip_type.toLowerCase().replace('_', '-')} ${tip.status.toLowerCase()}`}
            >
              <div className="tip-card-header">
                <div>
                  <div className="tip-card-topline">
                    <span className={`decision-badge ${tip.tip_type === 'STRONG_BUY' ? 'buy' : 'hold'}`}>
                      {tip.tip_type.replace('_', ' ')}
                    </span>
                    <span className="tip-symbol">{tip.symbol.replace('.NS', '')}</span>
                    <span className="tip-name">{tip.short_name ?? tip.symbol}</span>
                  </div>
                  <div className="tip-score-breakdown">
                    <span>Composite {tip.composite_score}</span>
                    <span>Technical {tip.technical_score ?? '—'}</span>
                    <span>Market {tip.market_context ?? 0}</span>
                    <span>News {tip.news_sentiment ?? 0}</span>
                  </div>
                </div>

                <div className={`tip-status-pill ${tip.status.toLowerCase()}`}>
                  {tip.status}
                </div>
              </div>

              <div className="tip-metrics-grid">
                <div className="tip-metric">
                  <span className="tip-metric-label">Buy</span>
                  <span className="tip-metric-value">₹{Number(tip.suggested_price).toFixed(2)}</span>
                </div>
                <div className="tip-metric">
                  <span className="tip-metric-label">Quantity</span>
                  <span className="tip-metric-value">{tip.suggested_qty}</span>
                </div>
                <div className="tip-metric">
                  <span className="tip-metric-label">Stop Loss</span>
                  <span className="tip-metric-value">₹{Number(tip.stop_loss ?? 0).toFixed(2)}</span>
                </div>
                <div className="tip-metric">
                  <span className="tip-metric-label">Target</span>
                  <span className="tip-metric-value">₹{Number(tip.target ?? 0).toFixed(2)}</span>
                </div>
              </div>

              <p className="tip-reasoning">{tip.reasoning}</p>

              {tip.news_headlines && tip.news_headlines.length > 0 && (
                <div className="tip-news-block">
                  {tip.news_headlines.slice(0, 2).map((headline) => (
                    <div key={headline} className="tip-news-line">📰 {headline}</div>
                  ))}
                </div>
              )}

              <div className="tip-card-footer">
                <div className="tip-meta-row">
                  <span>Expires: {formatDate(tip.expires_at)}</span>
                  <span>R/R: {tip.risk_reward ? tip.risk_reward.toFixed(2) : '—'}</span>
                </div>

                {tip.status === 'ACTIVE' ? (
                  <div className="tip-actions">
                    <button
                      className="tip-btn-buy"
                      onClick={() => handleTipAction(tip.id, 'BUY')}
                      disabled={activeActionId === tip.id}
                    >
                      {activeActionId === tip.id ? 'Placing...' : 'Buy Now'}
                    </button>
                    <button
                      className="tip-btn-secondary"
                      onClick={() => handleTipAction(tip.id, 'IGNORE')}
                      disabled={activeActionId === tip.id}
                    >
                      Ignore
                    </button>
                    <button
                      className="tip-btn-secondary"
                      onClick={() => handleTipAction(tip.id, 'DISMISS')}
                      disabled={activeActionId === tip.id}
                    >
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <div className="tip-meta-row">
                    <span>Created: {formatDate(tip.created_at)}</span>
                    <span>User action: {tip.user_action ?? '—'}</span>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
