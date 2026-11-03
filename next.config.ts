// next.config.ts — Next.js configuration. Dependencies: Next.js.
import type { NextConfig } from 'next';
const config: NextConfig = { reactStrictMode: true, serverExternalPackages: ['ccxt'] };
export default config;
