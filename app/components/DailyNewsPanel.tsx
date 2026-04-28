'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type NewsFilter = 'all' | 'company' | 'related';

interface NewsItem {
  source: string;
  source_type: 'MARKET' | 'COMPANY';
  title: string;
  summary: string | null;
  link: string;
  published_at: string | null;
  symbols: string[];
  relevance_score: number;
  related_to_open_trade: boolean;
}

interface NewsSourceStatus {
  name: string;
  ok: boolean;
  fetched: number;
  error?: string;
}

interface NewsApiResponse {
  items: NewsItem[];
  updatedAt: string | null;
  fromCache: boolean;
  usedPersistence: boolean;
  openTradeSymbols: string[];
  sources: NewsSourceStatus[];
  error?: string;
}

export default function DailyNewsPanel() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [openTradeSymbols, setOpenTradeSymbols] = useState<string[]>([]);
  const [sources, setSources] = useState<NewsSourceStatus[]>([]);
  const [usedPersistence, setUsedPersistence] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<NewsFilter>('all');

  const fetchNews = useCallback(async (refresh = false) => {
    const endpoint = refresh ? '/api/news/refresh' : '/api/news?limit=30';

    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setError(null);

    try {
      const res = await fetch(endpoint, {
        method: refresh ? 'POST' : 'GET',
        cache: 'no-store',
      });
      const data: NewsApiResponse = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to load Daily News');
      }

      setItems(data.items ?? []);
      setUpdatedAt(data.updatedAt ?? null);
      setOpenTradeSymbols(data.openTradeSymbols ?? []);
      setSources(data.sources ?? []);
      setUsedPersistence(Boolean(data.usedPersistence));
      setFromCache(Boolean(data.fromCache));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Daily News');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();

    const interval = setInterval(() => {
      fetchNews();
    }, 15 * 60 * 1000);

    return () => clearInterval(interval);
  }, [fetchNews]);

  const filteredItems = useMemo(() => {
    if (filter === 'company') {
      return items.filter((item) => item.source_type === 'COMPANY');
    }

    if (filter === 'related') {
      return items.filter((item) => item.related_to_open_trade);
    }

    return items;
  }, [filter, items]);

  const filterCounts = useMemo(() => ({
    all: items.length,
    company: items.filter((item) => item.source_type === 'COMPANY').length,
    related: items.filter((item) => item.related_to_open_trade).length,
  }), [items]);

  const formatDate = (value: string | null) => {
    if (!value) return '—';

    const date = new Date(value);
    return `${date.toLocaleDateString('en-IN')} @ ${date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  };

  return (
    <section className="news-panel">
      <div className="dash-header">
        <div className="dash-title-block">
          <h2 className="dash-title">Daily News</h2>
          <span className="dash-date">
            <span>📰</span>
            Latest: {formatDate(updatedAt)}
          </span>
          <span className={`news-cache-badge ${usedPersistence ? 'persisted' : 'live'}`}>
            {usedPersistence ? (fromCache ? 'Cached Feed' : 'Cached + Live') : 'Live Feed'}
          </span>
        </div>

        <div className="dash-actions">
          <button
            className={`run-btn ${isRefreshing ? 'running' : ''}`}
            onClick={() => fetchNews(true)}
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh News'}
          </button>
        </div>
      </div>

      {openTradeSymbols.length > 0 && (
        <div className="news-open-trades">
          Tracking open trades:
          {openTradeSymbols.map((symbol) => (
            <span key={symbol} className="news-symbol-chip">{symbol.replace('.NS', '')}</span>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <div className="news-sources-row">
          {sources.map((source) => (
            <span key={source.name} className={`news-source-pill ${source.ok ? 'ok' : 'error'}`}>
              {source.name}: {source.ok ? `${source.fetched} items` : source.error}
            </span>
          ))}
        </div>
      )}

      <div className="signal-summary">
        {([
          ['all', `All (${filterCounts.all})`],
          ['company', `Company (${filterCounts.company})`],
          ['related', `Related (${filterCounts.related})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`summary-pill ${filter === key ? 'active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="dash-error">{error}</div>}

      {isLoading ? (
        <div className="dash-loading">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton-row tall" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="dash-empty">
          <div className="empty-icon">🗞️</div>
          <div className="empty-title">No news matched this filter</div>
          <div className="empty-sub">Try a different filter or refresh the feed.</div>
        </div>
      ) : (
        <div className="news-list">
          {filteredItems.map((item) => (
            <article key={item.link} className={`news-card ${item.related_to_open_trade ? 'related' : ''}`}>
              <div className="news-card-top">
                <div className="news-card-meta">
                  <span className={`decision-badge ${item.source_type === 'COMPANY' ? 'buy' : 'hold'}`}>
                    {item.source_type}
                  </span>
                  <span className="news-source">{item.source}</span>
                  <span className="news-time">{formatDate(item.published_at)}</span>
                </div>

                {item.related_to_open_trade && (
                  <span className="news-related-flag">Open trade match</span>
                )}
              </div>

              <a
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="news-title-link"
              >
                {item.title}
              </a>

              {item.summary && (
                <p className="news-summary">{item.summary}</p>
              )}

              <div className="news-card-bottom">
                <div className="news-symbols">
                  {item.symbols.slice(0, 5).map((symbol) => (
                    <span key={symbol} className="news-symbol-chip">{symbol.replace('.NS', '')}</span>
                  ))}
                </div>

                <span className="news-score">Score {item.relevance_score}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
