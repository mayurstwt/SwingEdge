import Parser from 'rss-parser';
import stocks from '@/data/stocks.json';
import { getSupabase } from '@/lib/supabase';
import type { NewsRow, TradeRow } from '@/lib/supabase';
import { createHash } from 'node:crypto';

export type NewsSourceType = 'MARKET' | 'COMPANY';

export interface NewsItem {
  source: string;
  source_type: NewsSourceType;
  title: string;
  summary: string | null;
  link: string;
  image_url: string | null;
  published_at: string | null;
  symbols: string[];
  fingerprint: string;
  relevance_score: number;
  synced_at: string;
}

export interface NewsSourceStatus {
  name: string;
  ok: boolean;
  fetched: number;
  error?: string;
}

export interface NewsResponse {
  items: Array<NewsItem & { related_to_open_trade: boolean }>;
  updatedAt: string | null;
  fromCache: boolean;
  usedPersistence: boolean;
  openTradeSymbols: string[];
  sources: NewsSourceStatus[];
}

interface FeedConfig {
  source: string;
  url: string;
  defaultType: NewsSourceType;
}

interface GetNewsOptions {
  forceRefresh?: boolean;
  limit?: number;
  sourceType?: NewsSourceType;
  symbol?: string;
}

const FEED_SOURCES: FeedConfig[] = [
  {
    source: 'Google News: NSE Market',
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(
      '(NSE OR "Nifty 50" OR "Sensex" OR "Indian stock market") when:1d'
    )}&hl=en-IN&gl=IN&ceid=IN:en`,
    defaultType: 'MARKET',
  },
  {
    source: 'Google News: Earnings',
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(
      '("NSE stock" OR earnings OR results OR "share price") India when:1d'
    )}&hl=en-IN&gl=IN&ceid=IN:en`,
    defaultType: 'COMPANY',
  },
  {
    source: 'Economic Times Markets',
    url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
    defaultType: 'MARKET',
  },
];

const STALE_MS = 30 * 60 * 1000;
const LOOKBACK_DAYS = 3;
const MAX_FETCH_ITEMS = 60;

const parser = new Parser({
  customFields: {
    item: [['media:content', 'mediaContent', { keepArray: true }]],
  },
});

const trackedStocks = stocks.map((stock) => {
  const ticker = stock.symbol.replace('.NS', '');
  const cleanedName = stock.name.replace(/\([^)]*\)/g, '').trim();

  return {
    symbol: stock.symbol,
    ticker,
    aliases: Array.from(
      new Set([
        ticker,
        cleanedName,
        cleanedName.replace(/&/g, 'and'),
        cleanedName.split(' ').slice(0, 2).join(' '),
      ])
    ).filter((value) => value.length >= 3),
  };
});

function safeDate(value: string | undefined): string | null {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stripHtml(value: string | undefined): string | null {
  if (!value) return null;

  const text = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return text || null;
}

function normalizeForSearch(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSymbols(text: string): string[] {
  const normalized = normalizeForSearch(text);
  const matches = new Set<string>();

  for (const stock of trackedStocks) {
    const tickerRegex = new RegExp(`\\b${escapeRegExp(stock.ticker)}\\b`);

    if (tickerRegex.test(normalized)) {
      matches.add(stock.symbol);
      continue;
    }

    for (const alias of stock.aliases) {
      const normalizedAlias = normalizeForSearch(alias);
      if (normalizedAlias.length >= 4 && normalized.includes(normalizedAlias)) {
        matches.add(stock.symbol);
        break;
      }
    }
  }

  return Array.from(matches);
}

function scoreNewsItem(title: string, summary: string | null, symbols: string[], source: string): number {
  const haystack = normalizeForSearch(`${title} ${summary ?? ''}`);
  let score = symbols.length > 0 ? 6 : 2;

  for (const keyword of ['RESULT', 'EARNINGS', 'GUIDANCE', 'DIVIDEND', 'ORDER', 'BOARD', 'MERGER', 'ACQUISITION']) {
    if (haystack.includes(keyword)) score += 3;
  }

  for (const keyword of ['NIFTY', 'SENSEX', 'RBI', 'SEBI', 'FII', 'DII', 'IPO']) {
    if (haystack.includes(keyword)) score += 2;
  }

  if (source.includes('Economic Times')) score += 1;
  if (source.includes('Google News')) score += 1;

  return score;
}

function pickSourceType(defaultType: NewsSourceType, symbols: string[]): NewsSourceType {
  return symbols.length > 0 ? 'COMPANY' : defaultType;
}

function buildFingerprint(source: string, title: string, link: string): string {
  return createHash('sha1').update(`${source}|${title}|${link}`).digest('hex');
}

function dedupeItems(items: NewsItem[]): NewsItem[] {
  const byKey = new Map<string, NewsItem>();

  for (const item of items) {
    const key = item.link || item.fingerprint;
    const existing = byKey.get(key);

    if (!existing || item.relevance_score > existing.relevance_score) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (b.relevance_score !== a.relevance_score) {
      return b.relevance_score - a.relevance_score;
    }

    return (b.published_at ?? '').localeCompare(a.published_at ?? '');
  });
}

async function fetchFeed(config: FeedConfig): Promise<{ items: NewsItem[]; status: NewsSourceStatus }> {
  try {
    const response = await fetch(config.url, {
      headers: {
        'User-Agent': 'SwingEdge/1.0 (+https://netlify.com)',
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Feed request failed with ${response.status}`);
    }

    const xml = await response.text();
    const feed = await parser.parseString(xml);
    const syncedAt = new Date().toISOString();

    const items = (feed.items ?? [])
      .slice(0, 25)
      .map((item) => {
        const title = item.title?.trim() ?? 'Untitled';
        const summary = stripHtml(item.contentSnippet ?? item.content ?? item.summary);
        const link = item.link?.trim() ?? '';
        const publishedAt = safeDate(item.isoDate ?? item.pubDate);
        const symbols = extractSymbols(`${title} ${summary ?? ''}`);
        const sourceType = pickSourceType(config.defaultType, symbols);

        return {
          source: config.source,
          source_type: sourceType,
          title,
          summary,
          link,
          image_url: null,
          published_at: publishedAt,
          symbols,
          fingerprint: buildFingerprint(config.source, title, link),
          relevance_score: scoreNewsItem(title, summary, symbols, config.source),
          synced_at: syncedAt,
        } satisfies NewsItem;
      })
      .filter((item) => item.link);

    return {
      items,
      status: {
        name: config.source,
        ok: true,
        fetched: items.length,
      },
    };
  } catch (error: unknown) {
    return {
      items: [],
      status: {
        name: config.source,
        ok: false,
        fetched: 0,
        error: error instanceof Error ? error.message : 'Unknown feed error',
      },
    };
  }
}

async function fetchLatestFromSources(): Promise<{ items: NewsItem[]; statuses: NewsSourceStatus[] }> {
  const settled = await Promise.all(FEED_SOURCES.map(fetchFeed));

  return {
    items: dedupeItems(settled.flatMap((entry) => entry.items)).slice(0, MAX_FETCH_ITEMS),
    statuses: settled.map((entry) => entry.status),
  };
}

async function getOpenTradeSymbols() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('trades')
      .select('symbol, status')
      .eq('status', 'OPEN');

    if (error || !data) return [];

    return Array.from(
      new Set((data as Pick<TradeRow, 'symbol'>[]).map((trade) => trade.symbol).filter(Boolean))
    );
  } catch {
    return [];
  }
}

async function readCachedNews() {
  try {
    const supabase = getSupabase();
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('market_news')
      .select('*')
      .gte('published_at', since)
      .order('published_at', { ascending: false });

    if (error) {
      return { items: null, latestSync: null, usedPersistence: false };
    }

    const rows = (data ?? []) as NewsRow[];
    const latestSync = rows.reduce<string | null>((latest, row) => {
      if (!row.synced_at) return latest;
      if (!latest) return row.synced_at;
      return row.synced_at > latest ? row.synced_at : latest;
    }, null);

    return {
      items: rows.map((row) => ({
        source: row.source,
        source_type: row.source_type,
        title: row.title,
        summary: row.summary ?? null,
        link: row.link,
        image_url: row.image_url ?? null,
        published_at: row.published_at ?? null,
        symbols: row.symbols ?? [],
        fingerprint: row.fingerprint,
        relevance_score: row.relevance_score ?? 0,
        synced_at: row.synced_at ?? row.created_at ?? new Date().toISOString(),
      })),
      latestSync,
      usedPersistence: true,
    };
  } catch {
    return { items: null, latestSync: null, usedPersistence: false };
  }
}

async function saveNewsItems(items: NewsItem[]) {
  try {
    const supabase = getSupabase();
    const rows = items.map((item) => ({
      source: item.source,
      source_type: item.source_type,
      title: item.title,
      summary: item.summary,
      link: item.link,
      image_url: item.image_url,
      published_at: item.published_at,
      symbols: item.symbols,
      fingerprint: item.fingerprint,
      relevance_score: item.relevance_score,
      synced_at: item.synced_at,
    }));

    const { error } = await supabase
      .from('market_news')
      .upsert(rows, { onConflict: 'fingerprint' });

    if (error) {
      console.warn('[news] unable to persist market_news cache:', error.message);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function applyFilters(items: NewsItem[], options: GetNewsOptions) {
  let filtered = [...items];

  if (options.sourceType) {
    filtered = filtered.filter((item) => item.source_type === options.sourceType);
  }

  if (options.symbol) {
    filtered = filtered.filter((item) => item.symbols.includes(options.symbol as string));
  }

  return filtered.slice(0, options.limit ?? 20);
}

function tagRelatedItems(items: NewsItem[], openTradeSymbols: string[]) {
  const openSet = new Set(openTradeSymbols);

  return items.map((item) => ({
    ...item,
    related_to_open_trade: item.symbols.some((symbol) => openSet.has(symbol)),
  }));
}

export async function getNewsFeed(options: GetNewsOptions = {}): Promise<NewsResponse> {
  const [cached, openTradeSymbols] = await Promise.all([readCachedNews(), getOpenTradeSymbols()]);
  const cachedIsFresh =
    !options.forceRefresh &&
    cached.items &&
    cached.items.length > 0 &&
    cached.latestSync &&
    Date.now() - new Date(cached.latestSync).getTime() < STALE_MS;

  if (cachedIsFresh) {
    const items = tagRelatedItems(applyFilters(cached.items ?? [], options), openTradeSymbols);

    return {
      items,
      updatedAt: cached.latestSync,
      fromCache: true,
      usedPersistence: cached.usedPersistence,
      openTradeSymbols,
      sources: [],
    };
  }

  const live = await fetchLatestFromSources();
  const persisted = live.items.length > 0 ? await saveNewsItems(live.items) : cached.usedPersistence;
  const fallbackItems = live.items.length > 0 ? live.items : (cached.items ?? []);
  const updatedAt = live.items[0]?.synced_at ?? cached.latestSync ?? null;

  return {
    items: tagRelatedItems(applyFilters(fallbackItems, options), openTradeSymbols),
    updatedAt,
    fromCache: live.items.length === 0 && Boolean(cached.items?.length),
    usedPersistence: persisted,
    openTradeSymbols,
    sources: live.statuses,
  };
}
