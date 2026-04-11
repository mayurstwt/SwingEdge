import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SwingEdge — NSE Swing Trading Signals',
  description:
    'Get BUY / HOLD / AVOID swing trading signals for NSE stocks using RSI, MACD, Bollinger Bands, and SMA analysis. Dynamic stop-loss and targets via ATR.',
  keywords: ['swing trading', 'NSE', 'stock analysis', 'RSI', 'MACD', 'technical analysis', 'India stocks'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
