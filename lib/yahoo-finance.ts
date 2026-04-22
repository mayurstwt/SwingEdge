/**
 * Yahoo Finance API utility
 * Centralized fetcher with:
 *  - Native fetch (avoids axios adapter issues on newer Next.js)
 *  - Exponential-backoff retry (handles transient 429s)
 *  - Dual-endpoint fallback (query1 → query2)
 *  - Configurable timeout via AbortController
 */

const YAHOO_ENDPOINTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
];

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Origin: 'https://finance.yahoo.com',
  Referer: 'https://finance.yahoo.com/',
};

export interface YahooChartResult {
  meta: Record<string, unknown>;
  timestamp: number[];
  indicators: {
    quote: Array<{
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }>;
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch Yahoo Finance chart data with retry + endpoint fallback.
 * @param symbol  e.g. "RELIANCE.NS"
 * @param range   e.g. "1y", "3y"
 * @param interval e.g. "1d"
 * @param timeoutMs per-attempt timeout (default 12s)
 * @param maxRetries total attempts (default 2 per endpoint)
 */
export async function fetchYahooChart(
  symbol: string,
  range: string = '1y',
  interval: string = '1d',
  timeoutMs: number = 12000,
  maxRetries: number = 2,
): Promise<YahooChartResult> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&events=div,splits&includePrePost=false`;

  let lastError: Error = new Error('Yahoo Finance fetch failed after all retries');

  for (const base of YAHOO_ENDPOINTS) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) await sleep(500 * attempt); // back-off

        const res = await fetchWithTimeout(`${base}${path}`, timeoutMs);

        if (res.status === 429) {
          // Rate limited — wait longer before retry
          await sleep(2000 * (attempt + 1));
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${base}`);
        }

        const json = await res.json();
        const result = json?.chart?.result?.[0];
        if (!result) {
          throw new Error(`No chart data for ${symbol}`);
        }

        return result as YahooChartResult;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // AbortError = timeout; try next endpoint immediately
        if (lastError.name === 'AbortError') break;
      }
    }
  }

  throw lastError;
}
