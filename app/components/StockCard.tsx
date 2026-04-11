'use client';

import type { AnalysisResult } from '@/lib/strategy';

interface StockCardProps {
  data: AnalysisResult & { symbol: string; shortName: string; currency: string };
}

export default function StockCard({ data }: StockCardProps) {
  const {
    symbol,
    shortName,
    decision,
    score,
    confidence,
    price,
    change,
    changePercent,
    rsi,
    macd,
    sma50,
    sma200,
    bollingerBands,
    entryZone,
    stopLoss,
    target,
    riskReward,
    volumeRatio,
    trend,
    signals,
  } = data;

  const isPositive = change >= 0;
  const decisionClass =
    decision === 'BUY' ? 'decision-buy' : decision === 'AVOID' ? 'decision-avoid' : 'decision-hold';

  const trendIcon =
    trend === 'UPTREND' ? '↗' : trend === 'DOWNTREND' ? '↘' : '→';
  const trendClass =
    trend === 'UPTREND' ? 'trend-up' : trend === 'DOWNTREND' ? 'trend-down' : 'trend-side';

  const formatPrice = (v: number | null) =>
    v !== null ? `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  return (
    <div className={`stock-card ${decisionClass}`} id="stock-analysis-card">
      {/* Header */}
      <div className="card-header">
        <div className="card-title-block">
          <div className="stock-identity">
            <h2 className="stock-symbol">{symbol.replace('.NS', '')}</h2>
            <span className={`trend-badge ${trendClass}`}>{trendIcon} {trend}</span>
          </div>
          <p className="stock-full-name">{shortName}</p>
        </div>
        <div className="price-block">
          <span className="current-price">{formatPrice(price)}</span>
          <span className={`price-change ${isPositive ? 'positive' : 'negative'}`}>
            {isPositive ? '▲' : '▼'} {Math.abs(change).toFixed(2)} ({Math.abs(changePercent).toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Decision Badge */}
      <div className="decision-banner" id={`decision-${decision.toLowerCase()}`}>
        <div className="decision-glow" />
        <span className="decision-label">{decision}</span>
        <div className="score-ring">
          <svg viewBox="0 0 60 60" className="score-svg">
            <circle cx="30" cy="30" r="25" className="score-track" />
            <circle
              cx="30"
              cy="30"
              r="25"
              className="score-fill"
              strokeDasharray={`${(score / 100) * 157} 157`}
              strokeDashoffset="0"
              transform="rotate(-90 30 30)"
            />
          </svg>
          <span className="score-number">{score}</span>
        </div>
        <span className="confidence-label">Confidence {confidence}%</span>
      </div>

      {/* Key Metrics Grid */}
      <div className="metrics-grid">
        <MetricPill label="RSI" value={rsi.toFixed(1)} status={rsi > 65 ? 'warn' : rsi < 35 ? 'danger' : 'good'} />
        <MetricPill
          label="MACD"
          value={macd.histogram !== null ? (macd.histogram >= 0 ? `+${macd.histogram.toFixed(2)}` : macd.histogram.toFixed(2)) : '—'}
          status={macd.histogram !== null ? (macd.histogram >= 0 ? 'good' : 'danger') : 'neutral'}
        />
        <MetricPill label="SMA 50" value={formatPrice(sma50)} status={sma50 !== null && price > sma50 ? 'good' : 'danger'} />
        <MetricPill label="SMA 200" value={formatPrice(sma200)} status={sma200 !== null && price > sma200 ? 'good' : 'danger'} />
        <MetricPill label="BB Upper" value={formatPrice(bollingerBands.upper)} status="neutral" />
        <MetricPill label="BB Lower" value={formatPrice(bollingerBands.lower)} status="neutral" />
        <MetricPill
          label="Volume"
          value={`${volumeRatio}x`}
          status={volumeRatio > 1.2 ? 'good' : volumeRatio < 0.7 ? 'warn' : 'neutral'}
        />
        <MetricPill
          label="Risk/Reward"
          value={`1:${riskReward}`}
          status={riskReward >= 1.5 ? 'good' : 'warn'}
        />
      </div>

      {/* Trade Setup */}
      <div className="trade-setup" id="trade-setup">
        <h3 className="setup-title">Trade Setup</h3>
        <div className="setup-grid">
          <SetupRow label="Entry Zone" value={`${formatPrice(entryZone.low)} – ${formatPrice(entryZone.high)}`} type="entry" />
          <SetupRow label="Stop Loss" value={formatPrice(stopLoss)} type="stop" />
          <SetupRow label="Target" value={formatPrice(target)} type="target" />
        </div>

        {/* Price ruler visualization */}
        <div className="price-ruler">
          <PriceRuler low={stopLoss} entry={price} target={target} />
        </div>
      </div>

      {/* Signals */}
      <div className="signals-list" id="signals-list">
        <h3 className="setup-title">Signals</h3>
        <ul className="signal-items">
          {signals.map((s, i) => (
            <li key={i} className="signal-item">{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MetricPill({ label, value, status }: { label: string; value: string; status: 'good' | 'warn' | 'danger' | 'neutral' }) {
  return (
    <div className={`metric-pill metric-${status}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}

function SetupRow({ label, value, type }: { label: string; value: string; type: 'entry' | 'stop' | 'target' }) {
  return (
    <div className={`setup-row setup-${type}`}>
      <span className="setup-label">{label}</span>
      <span className="setup-value">{value}</span>
    </div>
  );
}

function PriceRuler({ low, entry, target }: { low: number; entry: number; target: number }) {
  const range = target - low;
  const stopPct = 0;
  const entryPct = ((entry - low) / range) * 100;
  const targetPct = 100;

  return (
    <div className="ruler-container" aria-label="Price ruler from stop loss to target">
      <div className="ruler-bar">
        <div className="ruler-stop" style={{ left: `${stopPct}%` }} title={`Stop: ₹${low}`} />
        <div className="ruler-entry" style={{ left: `${entryPct}%` }} title={`Entry: ₹${entry}`} />
        <div className="ruler-target" style={{ left: `${targetPct}%` }} title={`Target: ₹${target}`} />
        <div className="ruler-fill stop-to-entry" style={{ left: `${stopPct}%`, width: `${entryPct}%` }} />
        <div className="ruler-fill entry-to-target" style={{ left: `${entryPct}%`, width: `${targetPct - entryPct}%` }} />
      </div>
      <div className="ruler-labels">
        <span className="ruler-label-stop">SL</span>
        <span className="ruler-label-entry" style={{ left: `${entryPct}%` }}>CMP</span>
        <span className="ruler-label-target">TGT</span>
      </div>
    </div>
  );
}
