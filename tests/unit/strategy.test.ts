import { describe, it, expect } from 'vitest';
import { analyzeStock } from '@/lib/strategy';

describe('Trading Strategy', () => {
  // Generate a mock uptrend prices array (250 days for indicators)
  const downtrendPrices = Array.from({ length: 250 }, (_, i) => 200 - i * 0.5);

  // Generate a mock healthy uptrend prices array (250 days)
  // We use a slight oscillation to keep RSI from being 100
  const healthyUptrend = Array.from({ length: 250 }, (_, i) => {
    // Large historical base to ensure SMA200/SMA50 are low
    if (i < 200) return 50 + i * 0.1;
    // Recent price action: steady rise with small pullbacks to keep RSI 50-70
    // Pattern: +1, -0.4, +1, -0.4...
    const recentIdx = i - 200;
    const base = 70 + recentIdx * 0.6;
    return (recentIdx % 2 === 0) ? base : base - 0.4;
  });

  it('generates a HOLD or BUY signal for an uptrend', () => {
    const result = analyzeStock(healthyUptrend);
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(['BUY', 'HOLD']).toContain(result.decision);
    expect(result.trend).toBe('UPTREND');
  });

  it('generates an AVOID signal for a strong downtrend', () => {
    const result = analyzeStock(downtrendPrices);
    expect(result.score).toBeLessThan(50);
    expect(result.decision).toBe('AVOID');
    expect(result.trend).toBe('DOWNTREND');
  });

  it('calculates trade setup with correct risk/reward', () => {
    const result = analyzeStock(healthyUptrend);
    expect(result.entry).toBe(healthyUptrend[healthyUptrend.length - 1]);
    expect(result.stopLoss).toBeLessThan(result.entry);
    expect(result.target).toBeGreaterThan(result.entry);
    expect(result.riskReward).toBeCloseTo(2.0, 1);
  });

  it('includes reasoning in signals', () => {
    const result = analyzeStock(healthyUptrend);
    expect(result.signals.length).toBeGreaterThan(0);
  });
});
