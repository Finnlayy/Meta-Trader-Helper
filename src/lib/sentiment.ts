// sentiment.ts — FinBERT lexicon/shock risk scorer (from Finnlayy/Strategie-Runner) & RSS/Atom feed intelligence engine (from FinceptTerminal NewsService_Feed.cpp). Dependencies: schema.
import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { AppDatabase } from './bootstrap';
import { newsFeeds, sentimentEvents, sources } from './schema';

export type NewsPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ThreatLevel = 'critical' | 'high' | 'elevated' | 'normal';
export type CredibilityTier = 'tier1' | 'tier2' | 'tier3';

export type SentimentAssessment = {
  score: number; // [-1, 1]
  label: 'bullish' | 'neutral' | 'bearish';
  bullishMag: number;
  bearishMag: number;
  matchedLexicon: { term: string; weight: number }[];
  zScore: number;
  shockDetected: boolean;
  priority: NewsPriority;
  threatLevel: ThreatLevel;
  category: string;
  tickers: string[];
};

const POSITIVE_LEXICON: Record<string, number> = {
  surge: 1.5,
  surges: 1.5,
  surged: 1.5,
  rally: 1.4,
  rallies: 1.4,
  bullish: 1.4,
  beat: 1.3,
  beats: 1.3,
  outperform: 1.3,
  upgrade: 1.2,
  upgraded: 1.2,
  breakthrough: 1.4,
  approval: 1.3,
  approved: 1.3,
  growth: 1.0,
  profit: 1.0,
  profits: 1.0,
  dividend: 0.9,
  buyback: 1.1,
  expansion: 1.0,
  guidance_raised: 1.6,
  strong: 0.8,
  record_high: 1.5,
  inflow: 1.1,
  inflows: 1.1,
  adoption: 1.1,
  easing: 1.0,
  dovish: 1.0,
};

const NEGATIVE_LEXICON: Record<string, number> = {
  crash: -2.0,
  crashes: -2.0,
  plunge: -1.8,
  plunges: -1.8,
  bankrupt: -2.2,
  bankruptcy: -2.2,
  default: -2.0,
  defaults: -2.0,
  insolvent: -2.1,
  hack: -1.9,
  hacked: -1.9,
  exploit: -1.8,
  fraud: -2.0,
  lawsuit: -1.4,
  sanction: -1.6,
  sanctions: -1.6,
  sec_probe: -1.8,
  subpoena: -1.6,
  downgrade: -1.4,
  downgraded: -1.4,
  miss: -1.3,
  misses: -1.3,
  bearish: -1.4,
  recession: -1.6,
  layoffs: -1.3,
  halt: -1.5,
  halted: -1.5,
  liquidation: -1.8,
  liquidations: -1.8,
  outflow: -1.2,
  outflows: -1.2,
  hawkish: -1.1,
  inflation_spike: -1.4,
  war: -1.7,
  tariff: -1.3,
  tariffs: -1.3,
  warning: -1.1,
  slump: -1.4,
};

const CRITICAL_KEYWORDS = ['bankruptcy', 'default', 'halted', 'crash', 'nuclear', 'sanctions', 'emergency', 'rate hike', 'rate cut', 'hack', 'insolvent'];
const HIGH_KEYWORDS = ['sec', 'fed', 'fomc', 'ecb', 'cpi', 'nfp', 'earnings', 'downgrade', 'upgrade', 'merger', 'acquisition', 'guidance', 'tariff'];

const TIER1_SOURCES = new Set(['reuters', 'bloomberg', 'wsj', 'financial times', 'ft', 'cnbc', 'ecb', 'federal reserve', 'sec']);
const TIER2_SOURCES = new Set(['coindesk', 'the block', 'marketwatch', 'yahoo finance', 'seeking alpha', 'barrons', 'fxstreet', 'forexlive']);

export function scoreTextWithFinbertModel(
  text: string,
  rollingHistory: number[] = [],
): SentimentAssessment {
  const lower = text.toLowerCase();
  const normalized = lower
    .replace(/record high/g, 'record_high')
    .replace(/guidance raised/g, 'guidance_raised')
    .replace(/sec probe/g, 'sec_probe')
    .replace(/inflation spike/g, 'inflation_spike');
  const tokens = normalized.match(/[a-z0-9_]+/g) ?? [];

  let rawSum = 0;
  let bullishMag = 0;
  let bearishMag = 0;
  const matchedLexicon: { term: string; weight: number }[] = [];

  for (const tok of tokens) {
    if (POSITIVE_LEXICON[tok] !== undefined) {
      const w = POSITIVE_LEXICON[tok];
      rawSum += w;
      bullishMag += w;
      matchedLexicon.push({ term: tok, weight: w });
    } else if (NEGATIVE_LEXICON[tok] !== undefined) {
      const w = NEGATIVE_LEXICON[tok];
      rawSum += w;
      bearishMag += Math.abs(w);
      matchedLexicon.push({ term: tok, weight: w });
    }
  }

  // FinBERTRiskScorer formula: tanh(score / 3.0)
  const score = Number(Math.tanh(rawSum / 3.0).toFixed(4));
  const label: SentimentAssessment['label'] = score >= 0.15 ? 'bullish' : score <= -0.15 ? 'bearish' : 'neutral';

  // Rolling 100-entry 3-sigma shock detector from Strategie-Runner
  const window = rollingHistory.slice(-100);
  let zScore = 0;
  if (window.length >= 10) {
    const mean = window.reduce((s, v) => s + v, 0) / window.length;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
    const std = Math.sqrt(variance);
    if (std > 1e-6) {
      zScore = Number(((score - mean) / std).toFixed(3));
    }
  }
  const shockDetected = zScore < -3.0 && score < -0.65;

  const hasCritical = CRITICAL_KEYWORDS.some((kw) => lower.includes(kw)) || shockDetected;
  const hasHigh = HIGH_KEYWORDS.some((kw) => lower.includes(kw)) || Math.abs(score) >= 0.6;
  const priority: NewsPriority = hasCritical ? 'CRITICAL' : hasHigh ? 'HIGH' : Math.abs(score) >= 0.25 ? 'MEDIUM' : 'LOW';
  const threatLevel: ThreatLevel =
    priority === 'CRITICAL' ? 'critical' : priority === 'HIGH' ? 'high' : Math.abs(score) >= 0.35 ? 'elevated' : 'normal';

  const category =
    /\b(btc|eth|sol|crypto|bitcoin|ethereum|defi|token)\b/i.test(text)
      ? 'CRYPTO'
      : /\b(eur|usd|gbp|jpy|fx|forex|ecb|fed|boj|rates)\b/i.test(text)
        ? 'MACRO_FX'
        : /\b(earnings|eps|guidance|dividend|ipo|sec)\b/i.test(text)
          ? 'EQUITIES'
          : 'GENERAL';

  const tickerMatches = text.match(/(?:\$[A-Z]{2,6}\b|\b(?:BTC|ETH|SOL|XAU|EURUSD|GBPUSD|USDJPY|AAPL|NVDA|MSFT|SPY|QQQ|DAX)\b)/g) ?? [];
  const tickers = Array.from(new Set(tickerMatches.map((t) => t.replace(/^\$/, '').toUpperCase())));

  return {
    score,
    label,
    bullishMag: Number(bullishMag.toFixed(2)),
    bearishMag: Number(bearishMag.toFixed(2)),
    matchedLexicon,
    zScore,
    shockDetected,
    priority,
    threatLevel,
    category,
    tickers,
  };
}

export function classifySourceCredibility(sourceName: string): CredibilityTier {
  const lower = sourceName.trim().toLowerCase();
  for (const t1 of TIER1_SOURCES) {
    if (lower.includes(t1)) return 'tier1';
  }
  for (const t2 of TIER2_SOURCES) {
    if (lower.includes(t2)) return 'tier2';
  }
  return 'tier3';
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ParsedFeedArticle = {
  title: string;
  summary: string;
  url: string;
  publishedAt: Date;
};

export function parseRssOrAtomXml(xml: string): ParsedFeedArticle[] {
  const articles: ParsedFeedArticle[] = [];
  const itemBlocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];

  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = block.match(/<(?:description|summary|content)\b[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i);
    const linkHrefMatch = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    const linkTextMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const dateMatch = block.match(/<(?:pubDate|published|updated)\b[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i);

    const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : '';
    if (!title) continue;
    const summary = descMatch ? decodeXmlEntities(descMatch[1]).slice(0, 600) : '';
    const url = decodeXmlEntities(linkHrefMatch?.[1] ?? linkTextMatch?.[1] ?? '');
    const parsedDate = dateMatch ? new Date(decodeXmlEntities(dateMatch[1])) : new Date();
    const publishedAt = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

    articles.push({ title, summary, url, publishedAt });
  }
  return articles;
}

export async function ingestNewsArticle(
  db: AppDatabase,
  input: { title: string; summary?: string; source?: string; url?: string; sourceType?: string; publishedAt?: Date },
) {
  const recentRows = await db
    .select({ score: sentimentEvents.score })
    .from(sentimentEvents)
    .orderBy(desc(sentimentEvents.createdAt))
    .limit(100);
  const rollingHistory = recentRows.map((r) => r.score).reverse();

  const text = `${input.title}. ${input.summary ?? ''}`.trim();
  const assessment = scoreTextWithFinbertModel(text, rollingHistory);
  const sourceName = input.source?.trim() || 'Operator Feed';
  const tier = classifySourceCredibility(sourceName);
  const hashBase = input.url?.trim() || `${sourceName}:${input.title.trim().toLowerCase()}`;
  const id = `news-${createHash('sha1').update(hashBase).digest('hex').slice(0, 14)}`;

  const [saved] = await db
    .insert(sentimentEvents)
    .values({
      id,
      sourceType: input.sourceType ?? 'rss',
      sourceName,
      title: input.title.trim(),
      textSnippet: (input.summary || input.title).trim().slice(0, 500),
      score: assessment.score,
      label: assessment.label,
      bullishMag: assessment.bullishMag,
      bearishMag: assessment.bearishMag,
      zScore: assessment.zScore,
      shockTriggered: assessment.shockDetected,
      priority: assessment.priority,
      impact: assessment.priority === 'CRITICAL' || assessment.priority === 'HIGH' ? 'HIGH' : 'LOW',
      threatLevel: assessment.threatLevel.toUpperCase(),
      threatCategory: assessment.category,
      sourceFlag: tier.toUpperCase(),
      tickers: assessment.tickers,
      link: (input.url ?? '').trim() || null,
      publishedAt: input.publishedAt ?? new Date(),
    })
    .onConflictDoUpdate({
      target: sentimentEvents.id,
      set: {
        score: assessment.score,
        label: assessment.label,
        zScore: assessment.zScore,
        shockTriggered: assessment.shockDetected,
        priority: assessment.priority,
        threatLevel: assessment.threatLevel.toUpperCase(),
      },
    })
    .returning();

  return { article: saved, assessment };
}

export async function refreshRssFeeds(
  db: AppDatabase,
  timeoutMs = 5000,
): Promise<{
  ingested: number;
  status: 'LIVE' | 'DEGRADED' | 'OFFLINE';
  errors: string[];
}> {
  const enabledFeeds = await db.select().from(newsFeeds).where(eq(newsFeeds.enabled, true));
  let ingested = 0;
  const errors: string[] = [];
  let succeededFeeds = 0;

  for (const feed of enabledFeeds) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(feed.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Fable5-Intelligence-Terminal/1.0' },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      const parsed = parseRssOrAtomXml(xml).slice(0, 15);
      for (const art of parsed) {
        await ingestNewsArticle(db, {
          title: art.title,
          summary: art.summary,
          source: feed.name,
          url: art.url,
          sourceType: 'rss',
          publishedAt: art.publishedAt,
        });
        ingested++;
      }
      succeededFeeds++;
    } catch (err) {
      errors.push(`${feed.name}: ${err instanceof Error ? err.message : 'Network error'}`);
    }
  }

  const status: 'LIVE' | 'DEGRADED' | 'OFFLINE' =
    enabledFeeds.length > 0 && succeededFeeds === enabledFeeds.length
      ? 'LIVE'
      : succeededFeeds > 0
        ? 'DEGRADED'
        : 'OFFLINE';

  await db
    .insert(sources)
    .values({
      id: 'news:rss',
      name: 'Global Financial RSS Wire',
      category: 'news',
      status: status === 'LIVE' ? 'LIVE' : 'OFFLINE',
      lastSuccess: succeededFeeds > 0 ? new Date() : null,
      lastError: errors.length > 0 ? errors.join(' | ').slice(0, 500) : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: sources.id,
      set: {
        status: status === 'LIVE' ? 'LIVE' : 'OFFLINE',
        ...(succeededFeeds > 0 ? { lastSuccess: new Date() } : {}),
        lastError: errors.length > 0 ? errors.join(' | ').slice(0, 500) : null,
        updatedAt: new Date(),
      },
    });

  return { ingested, status, errors };
}

export async function listNewsIntelligence(db: AppDatabase, limit = 50) {
  const [items, feeds] = await Promise.all([
    db.select().from(sentimentEvents).orderBy(desc(sentimentEvents.createdAt)).limit(limit),
    db.select().from(newsFeeds),
  ]);
  const avgSentiment =
    items.length > 0 ? Number((items.reduce((s, a) => s + a.score, 0) / items.length).toFixed(4)) : 0;
  const shocks = items.filter((a) => a.shockTriggered);
  const criticalCount = items.filter((a) => a.priority === 'CRITICAL').length;
  return {
    items,
    feeds,
    summary: {
      count: items.length,
      avgSentiment,
      shockCount: shocks.length,
      criticalCount,
      shockAlert: shocks.length > 0,
    },
  };
}
