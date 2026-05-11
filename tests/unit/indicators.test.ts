import { describe, it, expect } from 'vitest';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
} from '@/lib/indicators';

describe('Technical Indicators', () => {
  const prices = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  describe('SMA', () => {
    it('calculates simple moving average correctly', () => {
      const sma3 = calculateSMA(prices, 3);
      expect(sma3[0]).toBeNull();
      expect(sma3[1]).toBeNull();
      expect(sma3[2]).toBe(11); // (10+11+12)/3
      expect(sma3[10]).toBe(19); // (18+19+20)/3
    });
  });

  describe('EMA', () => {
    it('calculates exponential moving average correctly', () => {
      const ema3 = calculateEMA(prices, 3);
      expect(ema3[0]).toBeNull();
      expect(ema3[1]).toBeNull();
      expect(ema3[2]).toBe(11); // Seeded with SMA
      expect(ema3[3]).toBeGreaterThan(11); // Price 13 > 11, EMA should increase
    });
  });

  describe('RSI', () => {
    it('returns neutral value for insufficient data', () => {
      const rsi = calculateRSI([10, 11, 12], 14);
      expect(rsi).toBe(50);
    });

    it('calculates RSI for upward trend', () => {
      const uptrend = Array.from({ length: 20 }, (_, i) => 100 + i);
      const rsi = calculateRSI(uptrend, 14);
      expect(rsi).toBeGreaterThan(70);
    });

    it('calculates RSI for downward trend', () => {
      const downtrend = Array.from({ length: 20 }, (_, i) => 100 - i);
      const rsi = calculateRSI(downtrend, 14);
      expect(rsi).toBeLessThan(30);
    });
  });

  describe('MACD', () => {
    it('calculates MACD values', () => {
      const data = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 10);
      const result = calculateMACD(data);
      expect(result).toHaveProperty('macdLine');
      expect(result).toHaveProperty('signalLine');
      expect(result).toHaveProperty('histogram');
    });
  });

  describe('Bollinger Bands', () => {
    it('calculates BB correctly', () => {
      const result = calculateBollingerBands(prices, 5);
      expect(result.middle).toBe(18); // Avg of 16, 17, 18, 19, 20
      expect(result.upper).toBeGreaterThan(result.middle!);
      expect(result.lower).toBeLessThan(result.middle!);
    });
  });

  describe('ATR', () => {
    it('calculates ATR correctly', () => {
      const highs = [11, 12, 13, 14, 15];
      const lows = [9, 10, 11, 12, 13];
      const closes = [10, 11, 12, 13, 14];
      const atr = calculateATR(highs, lows, closes, 3);
      expect(atr).toBeGreaterThan(0);
      expect(atr).toBe(2); // In this simple case, range is always 2
    });
  });
});
