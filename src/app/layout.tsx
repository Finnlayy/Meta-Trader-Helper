// layout.tsx — shared application shell for Fable 5 Intelligence Terminal. Dependencies: Next.js, React.
import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Fable 5 | Quantitative Trading & EA Audit Terminal',
  description:
    'Multi-workspace quantitative terminal: CCXT market intelligence, 29 indicators, backtest lab, paper & semi-auto execution, FinBERT risk, MetaAPI/MQL5 EA auditor, and MCP console.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
