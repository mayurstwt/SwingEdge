import { analyzeStock } from '@/lib/strategy';
import { getSupabaseAdmin, type NewsRow } from '@/lib/supabase';
import { getMarketDataFull } from '@/lib/trading/market-data';
import { calculatePositionSize } from '@/lib/trading/risk';
import { getWallet } from '@/lib/wallet';

export type TipType = 'STRONG_BUY' | 'MODERATE_BUY' | 'WATCH';
export type TipStatus = 'ACTIVE' | 'TRIGGERED' | 'EXPIRED' | 'CANCELLED';

export interface TipCandidate {
  symbol: string;
  shortName: string;
  sector: string;
  technicalScore: number;
  price: number;
  stopLoss: number;
  target: number;
  riskReward: number | null;
  trend: string;
  signals: string[];
  runId?: string;
}

export interface GeneratedTip {
  symbol: string;
  shortName: string;
  sector: string;
  tipType: TipType;
  compositeScore: number;
  suggestedPrice: number;
  suggestedQty: number;
  stopLoss: number;
  target: number;
  riskReward: number | null;
  technicalScore: number;
  marketContext: number;
  newsSentiment: number;
  newsHeadlines: string[];
  reasoning: string;
  runId?: string;
  expiresAt: string;
}

const TIP_SIGNAL_MIN_SCORE = 60;
const TIP_MAX_RECENT_NEWS = 6;
const POSITIVE_KEYWORDS = ['beat', 'beats', 'upgrade', 'raised', 'raise', 'growth', 'order', 'win', 'guidance', 'dividend', 'expansion'];
const NEGATIVE_KEYWORDS = ['miss', 'downgrade', 'cut', 'loss', 'selloff', 'outflow', 'geopolitical', 'probe', 'fraud', 'fall', 'slump'];

export function getMarketContextScore(trend: string | null | undefined): number {
  if (trend === 'UPTREND') return 10;
  if (trend === 'DOWNTREND') return -15;
  return 0;
}

export function classifyTip(compositeScore: number): TipType | null {
  if (compositeScore >= 80) return 'STRONG_BUY';
  if (compositeScore >= 65) return 'MODERATE_BUY';
  if (compositeScore >= 50) return 'WATCH';
  return null;
}

export function calculateNewsSentiment(newsItems: NewsRow[], sector: string): number {
  let score = 0;
  const sectorTerm = sector.trim().toLowerCase();
  const nowMs = Date.now();

  for (const item of newsItems) {
    const text = `${item.title} ${item.summary ?? ''}`.toLowerCase();
    const positiveMatches = POSITIVE_KEYWORDS.filter((keyword) => text.includes(keyword)).length;
    const negativeMatches = NEGATIVE_KEYWORDS.filter((keyword) => text.includes(keyword)).length;
    const sectorMatch = sectorTerm.length >= 3 && text.includes(sectorTerm);
    const publishedMs = item.published_at ? new Date(item.published_at).getTime() : NaN;
    const isFresh = Number.isFinite(publishedMs) && nowMs - publishedMs <= 24 * 60 * 60 * 1000;

    if (positiveMatches > negativeMatches) {
      score += 3;
      if (isFresh) score += 1;
      if (sectorMatch) score += 1;
      continue;
    }

    if (negativeMatches > positiveMatches) {
      score -= 3;
      if (isFresh) score -= 1;
      if (sectorMatch) score -= 1;
    }
  }

  return Math.max(-15, Math.min(15, score));
}

export function buildReasoning(params: {
  technicalScore: number;
  marketContext: number;
  newsSentiment: number;
  trend: string;
  headlines: string[];
  signals: string[];
}): string {
  const parts: string[] = [];

  parts.push(`Technical score ${params.technicalScore}/100 with ${params.trend.toLowerCase()}`);

  if (params.signals.length > 0) {
    parts.push(params.signals.slice(0, 2).join('; '));
  }

  if (params.marketContext > 0) {
    parts.push('NIFTY trend is supportive');
  } else if (params.marketContext < 0) {
    parts.push('NIFTY trend is bearish, so risk is higher');
  }

  if (params.newsSentiment > 0 && params.headlines[0]) {
    parts.push(`Positive news tailwind: ${params.headlines[0]}`);
  } else if (params.newsSentiment < 0) {
    parts.push('Recent news flow is negative');
  }

  return `${parts.join('. ')}.`;
}

export function getTipExpiry(tipType: TipType, now: Date = new Date()): string {
  const expiresAt = new Date(now);

  if (tipType === 'STRONG_BUY') {
    expiresAt.setDate(expiresAt.getDate() + 1);
  } else if (tipType === 'MODERATE_BUY') {
    expiresAt.setDate(expiresAt.getDate() + 3);
  } else {
    expiresAt.setDate(expiresAt.getDate() + 5);
  }

  return expiresAt.toISOString();
}

async function fetchRelevantNews(symbol: string, sector: string): Promise<NewsRow[]> {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const [companyNewsRes, marketNewsRes] = await Promise.all([
    supabase
      .from('market_news')
      .select('*')
      .contains('symbols', [symbol])
      .gte('published_at', since)
      .order('published_at', { ascending: false })
      .limit(TIP_MAX_RECENT_NEWS),
    supabase
      .from('market_news')
      .select('*')
      .eq('source_type', 'MARKET')
      .gte('published_at', since)
      .order('published_at', { ascending: false })
      .limit(TIP_MAX_RECENT_NEWS),
  ]);

  const combined = [...(companyNewsRes.data ?? []), ...(marketNewsRes.data ?? [])];
  const deduped = Array.from(new Map(combined.map((item) => [item.fingerprint, item])).values());
  const sectorTerm = sector.trim().toLowerCase();

  return deduped
    .filter((item) => {
      if ((item.symbols ?? []).includes(symbol)) return true;
      if (!sectorTerm) return item.source_type === 'MARKET';
      const text = `${item.title} ${item.summary ?? ''}`.toLowerCase();
      return item.source_type === 'MARKET' || text.includes(sectorTerm);
    })
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
    .slice(0, TIP_MAX_RECENT_NEWS) as NewsRow[];
}

export async function generateTradeTip(
  candidate: TipCandidate,
  marketTrend: string | null | undefined
): Promise<GeneratedTip | null> {
  if (candidate.technicalScore < TIP_SIGNAL_MIN_SCORE) {
    return null;
  }

  const [wallet, newsItems] = await Promise.all([
    getWallet(),
    fetchRelevantNews(candidate.symbol, candidate.sector),
  ]);

  const marketContext = getMarketContextScore(marketTrend);
  const newsSentiment = calculateNewsSentiment(newsItems, candidate.sector);
  const compositeScore = candidate.technicalScore + marketContext + newsSentiment;
  const tipType = classifyTip(compositeScore);

  if (!tipType) {
    return null;
  }

  const sizing = calculatePositionSize({
    price: candidate.price,
    stopLoss: candidate.stopLoss,
    currentEquity: wallet?.balance ?? 0,
    availableCash: (wallet?.balance ?? 0) * 0.9,
    riskTier: 'CONSERVATIVE',
    strategyWeight: 0.5,
    capitalLimitPct: 0.9,
  });

  if (sizing.quantity <= 0) {
    return null;
  }

  const headlines = newsItems.slice(0, 3).map((item) => item.title);
  const reasoning = buildReasoning({
    technicalScore: candidate.technicalScore,
    marketContext,
    newsSentiment,
    trend: candidate.trend,
    headlines,
    signals: candidate.signals,
  });

  return {
    symbol: candidate.symbol,
    shortName: candidate.shortName,
    sector: candidate.sector,
    tipType,
    compositeScore,
    suggestedPrice: Number(candidate.price.toFixed(2)),
    suggestedQty: sizing.quantity,
    stopLoss: Number(candidate.stopLoss.toFixed(2)),
    target: Number(candidate.target.toFixed(2)),
    riskReward: candidate.riskReward ?? null,
    technicalScore: candidate.technicalScore,
    marketContext,
    newsSentiment,
    newsHeadlines: headlines,
    reasoning,
    runId: candidate.runId,
    expiresAt: getTipExpiry(tipType),
  };
}

export async function generateTipsForCandidates(
  candidates: TipCandidate[],
  marketTrend: string | null | undefined
): Promise<GeneratedTip[]> {
  const tips = await Promise.all(candidates.map((candidate) => generateTradeTip(candidate, marketTrend)));
  return tips.filter((tip): tip is GeneratedTip => tip !== null);
}

export async function persistTradeTips(tips: GeneratedTip[]): Promise<number> {
  if (tips.length === 0) {
    return 0;
  }

  const supabase = getSupabaseAdmin();
  const rows = tips.map((tip) => ({
    symbol: tip.symbol,
    short_name: tip.shortName,
    sector: tip.sector,
    tip_type: tip.tipType,
    composite_score: tip.compositeScore,
    suggested_price: tip.suggestedPrice,
    suggested_qty: tip.suggestedQty,
    stop_loss: tip.stopLoss,
    target: tip.target,
    risk_reward: tip.riskReward,
    technical_score: tip.technicalScore,
    market_context: tip.marketContext,
    news_sentiment: tip.newsSentiment,
    news_headlines: tip.newsHeadlines,
    reasoning: tip.reasoning,
    status: 'ACTIVE' as TipStatus,
    run_id: tip.runId ?? null,
    expires_at: tip.expiresAt,
    notified: false,
  }));

  const symbols = Array.from(new Set(tips.map((tip) => tip.symbol)));
  if (symbols.length > 0) {
    await supabase
      .from('trade_tips')
      .update({ status: 'CANCELLED' })
      .in('symbol', symbols)
      .eq('status', 'ACTIVE');
  }

  const { error } = await supabase.from('trade_tips').insert(rows);
  if (error) {
    throw new Error(`Failed to save trade tips: ${error.message}`);
  }

  return rows.length;
}

export async function expireTradeTips(): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from('trade_tips')
    .update({ status: 'EXPIRED', user_action: 'EXPIRED' })
    .eq('status', 'ACTIVE')
    .lt('expires_at', new Date().toISOString());
}

export async function inferMarketTrend(): Promise<string> {
  const niftyData = await getMarketDataFull('^NSEI', { range: '3mo', interval: '1d' });
  const niftyAnalysis = analyzeStock(niftyData.closes, niftyData.highs, niftyData.lows, niftyData.volumes);
  return niftyAnalysis.trend;
}
