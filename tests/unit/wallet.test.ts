import { describe, it, expect } from 'vitest';
import { calculatePnL, calculateCharges } from '@/lib/wallet';

describe('Wallet Logic', () => {
  describe('PnL Calculation', () => {
    it('calculates long profit correctly', () => {
      const pnl = calculatePnL('LONG', 100, 110, 10);
      expect(pnl).toBe(100);
    });

    it('calculates long loss correctly', () => {
      const pnl = calculatePnL('LONG', 100, 90, 10);
      expect(pnl).toBe(-100);
    });
  });

  describe('Brokerage & Charges', () => {
    it('calculates buy charges', () => {
      const charges = calculateCharges(10000, 'buy');
      // Brokerage: min(20, 10000 * 0.0003) = 3
      // STT: 0
      // Transaction: 10000 * 0.0000325 = 0.325
      // GST: (3 + 0.325) * 0.18 = 0.5985
      // Total: 3 + 0.325 + 0.5985 = 3.9235
      expect(charges).toBeCloseTo(3.92, 1);
    });

    it('calculates sell charges with STT', () => {
      const charges = calculateCharges(10000, 'sell');
      // STT: 10000 * 0.001 = 10
      // Others: ~3.92
      // Total: ~13.92
      expect(charges).toBeGreaterThan(10);
    });
  });
});
