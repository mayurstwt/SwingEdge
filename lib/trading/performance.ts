import type {
  DrawdownPoint,
  EquityPoint,
  EntryType,
  SimulatedTrade,
  StrategyPerformanceSnapshot,
} from "@/lib/trading/types";
import type { TradeRow } from "@/lib/supabase";
import { computeDynamicScoreThreshold, computeStrategyWeight } from "@/lib/trading/risk";

interface AggregateBucket {
  entryType: EntryType;
  tradesCount: number;
  wins: number;
  totalProfit: number;
}

export function calculateDrawdownCurve(equityCurve: EquityPoint[]): DrawdownPoint[] {
  let peak = 0;

  return equityCurve.map((point) => {
    peak = Math.max(peak, point.equity);
    const drawdownPct = peak === 0 ? 0 : ((peak - point.equity) / peak) * 100;

    return {
      date: point.date,
      drawdownPct: Number(drawdownPct.toFixed(2)),
    };
  });
}

export function calculateMaxDrawdownPct(equityCurve: EquityPoint[]): number {
  return calculateDrawdownCurve(equityCurve).reduce((max, point) => Math.max(max, point.drawdownPct), 0);
}

export function averageRiskReward(trades: Array<{ riskReward: number | null }>): number {
  const values = trades.map((trade) => trade.riskReward).filter((value): value is number => value !== null);
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function summarizeStrategyPerformance(
  trades: Array<Pick<SimulatedTrade, "entryType" | "netPnl" | "riskReward">>
): StrategyPerformanceSnapshot[] {
  const buckets = new Map<EntryType, AggregateBucket>();

  for (const trade of trades) {
    const bucket = buckets.get(trade.entryType) ?? {
      entryType: trade.entryType,
      tradesCount: 0,
      wins: 0,
      totalProfit: 0,
    };

    bucket.tradesCount += 1;
    bucket.totalProfit += trade.netPnl;
    if (trade.netPnl > 0) {
      bucket.wins += 1;
    }

    buckets.set(trade.entryType, bucket);
  }

  return Array.from(buckets.values())
    .map((bucket) => {
      const winRate = bucket.tradesCount === 0 ? 0 : (bucket.wins / bucket.tradesCount) * 100;
      const avgProfit = bucket.tradesCount === 0 ? 0 : bucket.totalProfit / bucket.tradesCount;
      const dynamicScoreThreshold = computeDynamicScoreThreshold({
        avgProfit,
        winRate,
        tradesCount: bucket.tradesCount,
      });
      const capitalWeight = computeStrategyWeight({
        avgProfit,
        winRate,
        tradesCount: bucket.tradesCount,
      });
      const enabled = !(winRate < 40 && bucket.totalProfit < 0);

      return {
        entryType: bucket.entryType,
        avgProfit: Number(avgProfit.toFixed(2)),
        winRate: Number(winRate.toFixed(2)),
        tradesCount: bucket.tradesCount,
        totalProfit: Number(bucket.totalProfit.toFixed(2)),
        dynamicScoreThreshold,
        capitalWeight,
        enabled,
      };
    })
    .sort((left, right) => right.totalProfit - left.totalProfit);
}

export function buildLiveEquityCurve(trades: TradeRow[], startingCapital: number): EquityPoint[] {
  let cumulative = startingCapital;

  return trades
    .slice()
    .sort((left, right) => {
      const leftDate = left.closed_at ?? left.opened_at;
      const rightDate = right.closed_at ?? right.opened_at;
      return new Date(leftDate).getTime() - new Date(rightDate).getTime();
    })
    .filter((trade) => trade.status === "CLOSED")
    .map((trade) => {
      cumulative += Number(trade.profit_loss ?? 0);

      return {
        date: (trade.closed_at ?? trade.opened_at).slice(0, 10),
        equity: Number(cumulative.toFixed(2)),
      };
    });
}
