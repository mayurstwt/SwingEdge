'use client';

interface WatchStock {
  symbol: string;
  name: string;
}

const WATCHLIST: WatchStock[] = [
  { symbol: 'RELIANCE.NS', name: 'Reliance' },
  { symbol: 'TCS.NS', name: 'TCS' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
  { symbol: 'INFY.NS', name: 'Infosys' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank' },
  { symbol: 'MARUTI.NS', name: 'Maruti' },
  { symbol: 'SUNPHARMA.NS', name: 'Sun Pharma' },
  { symbol: 'ZOMATO.NS', name: 'Zomato' },
];

interface MarketOverviewProps {
  onSelect: (symbol: string) => void;
  activeSymbol: string | null;
}

export default function MarketOverview({ onSelect, activeSymbol }: MarketOverviewProps) {
  return (
    <div className="market-overview" id="market-overview">
      <div className="overview-header">
        <span className="live-dot" />
        <h3 className="overview-title">Quick Watchlist</h3>
      </div>
      <div className="watchlist-chips">
        {WATCHLIST.map((stock) => (
          <button
            key={stock.symbol}
            id={`watchlist-${stock.symbol.replace('.NS', '').replace('&', 'and')}`}
            className={`watchlist-chip ${activeSymbol === stock.symbol ? 'active' : ''}`}
            onClick={() => onSelect(stock.symbol)}
            title={stock.symbol}
          >
            <span className="chip-dot" />
            {stock.name}
          </button>
        ))}
      </div>
    </div>
  );
}
