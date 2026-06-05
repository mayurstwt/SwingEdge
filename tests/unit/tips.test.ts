import { describe, expect, it } from 'vitest';
import { buildReasoning, calculateNewsSentiment, classifyTip, getMarketContextScore, getTipExpiry } from '@/lib/tips';
import type { NewsRow } from '@/lib/supabase';

describe('Smart Trade Tips', () => {
  const baseNewsItem: NewsRow = {
    id: '1',
    source: 'Test Feed',
    source_type: 'COMPANY',
    title: 'Company beats estimates and raises guidance',
    summary: 'Banking business expansion continues',
    link: 'https://example.com/news/1',
    fingerprint: 'abc',
    symbols: ['HDFCBANK.NS'],
    published_at: new Date().toISOString(),
    relevance_score: 10,
    synced_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  it('scores market context from NIFTY trend', () => {
    expect(getMarketContextScore('UPTREND')).toBe(10);
    expect(getMarketContextScore('DOWNTREND')).toBe(-15);
    expect(getMarketContextScore('SIDEWAYS')).toBe(0);
  });

  it('classifies composite scores into tip bands', () => {
    expect(classifyTip(84)).toBe('STRONG_BUY');
    expect(classifyTip(68)).toBe('MODERATE_BUY');
    expect(classifyTip(52)).toBe('WATCH');
    expect(classifyTip(40)).toBeNull();
  });

  it('detects positive and negative news sentiment', () => {
    const positive = calculateNewsSentiment([baseNewsItem], 'Banking');
    const negative = calculateNewsSentiment([
      {
        ...baseNewsItem,
        id: '2',
        title: 'Broker downgrades stock after profit miss and FII outflow',
        summary: 'Banking sector sentiment weakens',
        fingerprint: 'def',
      },
    ], 'Banking');

    expect(positive).toBeGreaterThan(0);
    expect(negative).toBeLessThan(0);
  });

  it('builds readable reasoning from factor breakdown', () => {
    const reasoning = buildReasoning({
      technicalScore: 76,
      marketContext: 10,
      newsSentiment: 4,
      trend: 'UPTREND',
      headlines: ['Company beats estimates and raises guidance'],
      signals: ['Price above SMA200', 'MACD histogram positive'],
    });

    expect(reasoning).toContain('Technical score 76/100');
    expect(reasoning).toContain('NIFTY trend is supportive');
    expect(reasoning).toContain('Positive news tailwind');
  });

  it('assigns longer expiries to weaker ideas', () => {
    const now = new Date('2026-05-14T00:00:00.000Z');

    expect(getTipExpiry('STRONG_BUY', now)).toBe('2026-05-15T00:00:00.000Z');
    expect(getTipExpiry('MODERATE_BUY', now)).toBe('2026-05-17T00:00:00.000Z');
    expect(getTipExpiry('WATCH', now)).toBe('2026-05-19T00:00:00.000Z');
  });
});
