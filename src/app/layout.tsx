// layout.tsx — shared application shell. Dependencies: Next.js, React.
import type { Metadata } from 'next';
import './styles.css';
export const metadata: Metadata = { title: 'Fable 5 | Terminal', description: 'Trading intelligence terminal foundation' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
