'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Stock {
  symbol: string;
  name: string;
  sector: string;
}

interface SearchBarProps {
  onSelect: (stock: Stock) => void;
  isLoading: boolean;
}

export default function SearchBar({ onSelect, isLoading }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Stock[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextOpenRef = useRef(false);

  const fetchResults = useCallback(async (q: string, autoOpen: boolean = true) => {
    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data);
      if (autoOpen && q.length > 0 && !skipNextOpenRef.current) setIsOpen(true);
      skipNextOpenRef.current = false;
      setActiveIndex(-1);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length === 0) {
      fetchResults('', false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      fetchResults(query);
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchResults]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) {
        handleSelect(results[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleSelect = (stock: Stock) => {
    skipNextOpenRef.current = true;
    setQuery(stock.name);
    setIsOpen(false);
    onSelect(stock);
  };

  const sectorColors: Record<string, string> = {
    IT: 'var(--sector-it)',
    Banking: 'var(--sector-banking)',
    FMCG: 'var(--sector-fmcg)',
    Auto: 'var(--sector-auto)',
    Pharma: 'var(--sector-pharma)',
    Energy: 'var(--sector-energy)',
    Finance: 'var(--sector-finance)',
    Metals: 'var(--sector-metals)',
    default: 'var(--sector-default)',
  };

  const getSectorColor = (sector: string) =>
    sectorColors[sector] ?? sectorColors.default;

  return (
    <div className="search-container" id="search-container">
      <div className="search-input-wrapper">
        <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          id="stock-search-input"
          type="text"
          className="search-input"
          placeholder="Search stocks — TCS, Reliance, HDFC..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setIsOpen(true); else fetchResults(query); }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          disabled={isLoading}
        />
        {isSearching && (
          <div className="search-spinner">
            <div className="spinner-ring" />
          </div>
        )}
        {query && !isSearching && (
          <button
            className="search-clear"
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div ref={dropdownRef} className="search-dropdown" role="listbox">
          {results.map((stock, i) => (
            <button
              key={stock.symbol}
              className={`search-result-item ${i === activeIndex ? 'active' : ''}`}
              onClick={() => handleSelect(stock)}
              role="option"
              aria-selected={i === activeIndex}
              id={`search-result-${i}`}
            >
              <div className="result-left">
                <span className="result-symbol">{stock.symbol.replace('.NS', '')}</span>
                <span className="result-name">{stock.name}</span>
              </div>
              <span
                className="result-sector"
                style={{ background: getSectorColor(stock.sector) + '22', color: getSectorColor(stock.sector) }}
              >
                {stock.sector}
              </span>
            </button>
          ))}
        </div>
      )}

      {isOpen && results.length === 0 && query.length > 0 && !isSearching && (
        <div ref={dropdownRef} className="search-dropdown">
          <div className="search-empty">
            <span>No stocks found for &quot;{query}&quot;</span>
          </div>
        </div>
      )}
    </div>
  );
}
