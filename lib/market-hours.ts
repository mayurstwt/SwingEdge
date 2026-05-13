/**
 * NSE Market Hours Utility — ZERO MAINTENANCE, runs forever.
 *
 * Checks if the Indian stock market (NSE) is currently open.
 * NSE trading session: 9:15 AM – 3:30 PM IST, Monday–Friday
 *
 * Holiday detection strategy (no hardcoded dates, no yearly updates):
 *   1. Weekends are rejected instantly (always correct)
 *   2. On weekdays during market hours, we check if Yahoo Finance has
 *      intraday data for NIFTY 50 (^NSEI) today. If the exchange is
 *      closed for a holiday, there will be zero intraday bars.
 *   3. Results are cached for 30 minutes to avoid repeated API calls.
 *   4. If the Yahoo check fails (network error), we assume the market
 *      is open and let the rest of the pipeline handle it gracefully.
 */

import { fetchYahooChart } from '@/lib/yahoo-finance';

// ================================
// 🗓️ DYNAMIC HOLIDAY DETECTION
// ================================

interface HolidayCheckCache {
  dateStr: string;
  isHoliday: boolean;
  checkedAt: number;
}

let holidayCheckCache: HolidayCheckCache | null = null;
const HOLIDAY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Check if today is an NSE holiday by probing Yahoo Finance for
 * intraday NIFTY 50 data. If there are 0 candles during market hours,
 * the exchange is closed.
 *
 * This is only called on weekdays during market hours, so it should
 * always have data on a normal trading day.
 *
 * Returns: true if today is a holiday (no trading data), false otherwise.
 */
async function isNSEHolidayToday(dateStr: string, istHours: number, istMinutes: number): Promise<boolean> {
  // Return cached result if fresh
  if (
    holidayCheckCache &&
    holidayCheckCache.dateStr === dateStr &&
    Date.now() - holidayCheckCache.checkedAt < HOLIDAY_CACHE_TTL_MS
  ) {
    return holidayCheckCache.isHoliday;
  }

  try {
    const result = await fetchYahooChart('^NSEI', '1d', '5m', 8000, 1);

    const timestamps: number[] = result.timestamp ?? [];

    // Check if any of the timestamps are from today (IST)
    const todayTimestamps = timestamps.filter((ts) => {
      const d = new Date(ts * 1000);
      const istStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      return istStr === dateStr;
    });

    let isHoliday = todayTimestamps.length === 0;

    // Robustness: If 0 bars but it’s early in session (< 10:00 AM), don't flag as holiday.
    // Yahoo Finance can be slow to publish bars in the first 30-45 min of trading.
    const totalMinutes = istHours * 60 + istMinutes;
    const tenAM = 10 * 60;
    if (isHoliday && totalMinutes < tenAM) {
      console.log(`⏰ Only ${todayTimestamps.length} bar(s) for ${dateStr} but it’s before 10:00 AM — not flagging as holiday yet`);
      return false;
    }

    // Secondary check: regularMarketTime meta
    if (isHoliday && result.meta?.regularMarketTime) {
      const marketDate = new Date((result.meta.regularMarketTime as number) * 1000);
      const marketDateStr = marketDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (marketDateStr === dateStr) {
        isHoliday = false; // It’s today, so not a holiday!
      }
    }

    holidayCheckCache = { dateStr, isHoliday, checkedAt: Date.now() };

    if (isHoliday) {
      console.log(`📅 NSE holiday detected: no trading data for ${dateStr} (${todayTimestamps.length} bars after 10:00 AM)`);
    } else {
      console.log(`✅ NSE open: ${todayTimestamps.length} intraday bar(s) found for ${dateStr}`);
    }

    return isHoliday;
  } catch (err) {
    console.warn('⚠️ NSE holiday check failed, assuming market is open:', err);
    // On failure, assume not a holiday — the rest of the pipeline
    // (empty Yahoo data → no signals → no trades) handles it safely.
    return false;
  }
}

// ================================
// 🕐 IST TIME HELPERS
// ================================

export function getISTNow(): { dateStr: string; hours: number; minutes: number; dayOfWeek: number } {
  const now = new Date();
  // Build IST representation using Intl (handles IST correctly forever — India has no DST)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hours = parseInt(get('hour'));
  const minutes = parseInt(get('minute'));

  // Day of week: Use UTC date with IST year/month/day to get correct weekday regardless of server timezone
  const istDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const dayOfWeek = istDate.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  return {
    dateStr: `${year}-${month}-${day}`,
    hours,
    minutes,
    dayOfWeek,
  };
}

function formatTimeIST(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// ================================
// 📊 PUBLIC API
// ================================

export interface MarketStatus {
  isOpen: boolean;
  reason: string;
  currentTimeIST: string;
}

/**
 * Check if the NSE market is currently open for trading.
 *
 * Market hours: 9:15 AM – 3:30 PM IST, Monday–Friday (excluding holidays)
 *
 * @param bufferMinutes — extends the window on both sides (e.g. 5 = allows 9:10 AM start)
 */
export async function isMarketOpen(bufferMinutes: number = 0): Promise<MarketStatus> {
  const ist = getISTNow();
  const currentTimeIST = `${ist.dateStr} ${formatTimeIST(ist.hours, ist.minutes)} IST`;

  // 1. Weekend check (instant, always correct)
  if (ist.dayOfWeek === 0 || ist.dayOfWeek === 6) {
    return {
      isOpen: false,
      reason: `Market closed: weekend (${ist.dayOfWeek === 0 ? 'Sunday' : 'Saturday'})`,
      currentTimeIST,
    };
  }

  // 2. Time check: 9:15 AM – 3:30 PM IST (with optional buffer)
  const totalMinutes = ist.hours * 60 + ist.minutes;
  const marketOpen = 9 * 60 + 15 - bufferMinutes;   // 9:15 AM minus buffer
  const marketClose = 15 * 60 + 30 + bufferMinutes;  // 3:30 PM plus buffer

  if (totalMinutes < marketOpen) {
    return {
      isOpen: false,
      reason: `Market closed: pre-market (current: ${formatTimeIST(ist.hours, ist.minutes)}, opens at 09:15 IST)`,
      currentTimeIST,
    };
  }

  if (totalMinutes > marketClose) {
    return {
      isOpen: false,
      reason: `Market closed: post-market (current: ${formatTimeIST(ist.hours, ist.minutes)}, closed at 15:30 IST)`,
      currentTimeIST,
    };
  }

  // 3. Holiday check: probe Yahoo Finance for today’s NIFTY data
  //    Only runs on weekdays during market hours (most efficient)
  const isHoliday = await isNSEHolidayToday(ist.dateStr, ist.hours, ist.minutes);
  if (isHoliday) {
    return {
      isOpen: false,
      reason: `Market closed: NSE holiday detected (no trading data for ${ist.dateStr})`,
      currentTimeIST,
    };
  }

  return {
    isOpen: true,
    reason: 'Market is open',
    currentTimeIST,
  };
}

/**
 * Check if today is a trading day (Mon–Fri).
 * Does NOT check holidays or time — use this for signal generation that can run anytime.
 * For full market-open check (including holidays + time), use isMarketOpen().
 */
export async function isTradingDay(): Promise<boolean> {
  const ist = getISTNow();
  if (ist.dayOfWeek === 0 || ist.dayOfWeek === 6) return false;
  return true;
}
