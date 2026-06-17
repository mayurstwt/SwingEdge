import { describe, it, expect } from 'vitest';
import { calculatePositionSize } from '@/lib/trading/risk';

describe('Risk Management', () => {
  const baseInput = {
    price: 100,
    stopLoss: 95, // 5% risk
    currentEquity: 100000,
    availableCash: 50000,
    riskTier: 'NORMAL' as const,
    strategyWeight: 1,
    capitalLimitPct: 0.9,
  };

  it('calculates position size correctly for normal risk', () => {
    // Risk is 1.25% of 100k = 1250. Risk per share is 5. 
    // Volatility = 5/100 = 0.05. Volatility factor = 0.95.
    // Adjusted risk = 1250 * 0.95 = 1187.5.
    // Quantity = 1187.5 / 5 = 237.5 -> Math.floor(237.5) = 237.
    const result = calculatePositionSize(baseInput);
    expect(result.quantity).toBe(237);
    expect(result.riskAmount).toBe(1187.5);
    expect(result.capitalCommitted).toBe(23700);
  });

  it('respects available cash limits', () => {
    const lowCashInput = { ...baseInput, availableCash: 5000 };
    // Quantity 200 would cost 20000, but we only have 5000.
    // Max quantity by capital = 5000 * 0.9 / 100 = 45.
    const result = calculatePositionSize(lowCashInput);
    expect(result.quantity).toBeLessThanOrEqual(50);
    expect(result.capitalCommitted).toBeLessThanOrEqual(5000);
  });

  it('reduces risk during drawdown', () => {
    const drawdownInput = {
      ...baseInput,
      peakEquity: 120000, // 20k drawdown on 120k is ~16.6%
    };
    const normalResult = calculatePositionSize(baseInput);
    const drawdownResult = calculatePositionSize(drawdownInput);
    
    expect(drawdownResult.quantity).toBeLessThan(normalResult.quantity);
  });

  it('filters out extremely risky trades (wide stop loss)', () => {
    const riskyInput = {
      ...baseInput,
      stopLoss: 90, // 10% risk, limit is 6%
    };
    const result = calculatePositionSize(riskyInput);
    expect(result.quantity).toBe(0);
  });
});
