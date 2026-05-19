'use server';

import { getStockSentimentInsights } from './adanos.actions';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const DEFAULT_SIMULATIONS = 5000;

type QuotePayload = {
    c?: number;
    d?: number;
    dp?: number;
    h?: number;
    l?: number;
    o?: number;
    pc?: number;
};

type MetricPayload = {
    metric?: Record<string, unknown>;
};

type RecommendationPayload = {
    strongBuy?: number;
    buy?: number;
    hold?: number;
    sell?: number;
    strongSell?: number;
    period?: string;
};

type EarningsPayload = {
    actual?: number | null;
    estimate?: number | null;
    surprise?: number | null;
    surprisePercent?: number | null;
    period?: string;
};

type NewsPayload = {
    headline?: string;
    summary?: string;
};

export type ForecastFactor = {
    name: string;
    group: string;
    value: string;
    score: number;
    weight: number;
    note: string;
};

export type ForecastScenario = {
    horizonDays: number;
    p10: number;
    p50: number;
    p90: number;
    probabilityAboveCurrent: number;
    expectedReturnPct: number;
};

export type StockForecast = {
    symbol: string;
    currentPrice: number;
    generatedAt: string;
    modelSignal: 'Bullish' | 'Neutral' | 'Bearish';
    score: number;
    confidence: number;
    annualizedDriftPct: number;
    annualizedVolatilityPct: number;
    scenarios: ForecastScenario[];
    factors: ForecastFactor[];
    newsSampleSize: number;
    sentimentSources: number;
    limitations: string[];
};

function getFinnhubToken() {
    return process.env.NEXT_PUBLIC_FINNHUB_API_KEY || '';
}

async function fetchFinnhub<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const token = getFinnhubToken();
    if (!token) return null;

    const url = new URL(`${FINNHUB_BASE_URL}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set('token', token);

    try {
        const response = await fetch(url.toString(), { cache: 'no-store' });
        if (!response.ok) {
            console.error(`Finnhub ${path} failed: ${response.status}`);
            return null;
        }

        return (await response.json()) as T;
    } catch (error) {
        console.error(`Finnhub ${path} request failed`, error);
        return null;
    }
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function scoreFromRange(value: number | null, neutral: number, spread: number, invert = false) {
    if (value === null) return 0;
    const raw = clamp((value - neutral) / spread, -1, 1);
    return invert ? -raw : raw;
}

function scorePositivePercent(value: number | null, spread = 25) {
    return scoreFromRange(value, 0, spread);
}

function formatNumber(value: number | null, suffix = '', digits = 2) {
    if (value === null || !Number.isFinite(value)) return 'N/A';
    return `${value.toFixed(digits)}${suffix}`;
}

function addFactor(
    factors: ForecastFactor[],
    name: string,
    group: string,
    rawValue: number | null,
    score: number,
    weight: number,
    note: string,
    suffix = '',
    digits = 2,
) {
    factors.push({
        name,
        group,
        value: formatNumber(rawValue, suffix, digits),
        score: clamp(score, -1, 1),
        weight,
        note,
    });
}

function getNewsToneScore(news: NewsPayload[]) {
    const positiveWords = ['beat', 'beats', 'growth', 'surge', 'jump', 'upgrade', 'bullish', 'profit', 'record', 'partnership', 'confidence', 'expansion'];
    const negativeWords = ['miss', 'misses', 'drop', 'falls', 'downgrade', 'bearish', 'loss', 'lawsuit', 'probe', 'weak', 'concern', 'demanding'];
    let score = 0;

    for (const article of news.slice(0, 30)) {
        const text = `${article.headline || ''} ${article.summary || ''}`.toLowerCase();
        for (const word of positiveWords) {
            if (text.includes(word)) score += 1;
        }
        for (const word of negativeWords) {
            if (text.includes(word)) score -= 1;
        }
    }

    return clamp(score / 12, -1, 1);
}

function randomNormal() {
    const u1 = Math.max(Math.random(), Number.EPSILON);
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function percentile(sorted: number[], p: number) {
    if (sorted.length === 0) return 0;
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function simulateScenario(
    currentPrice: number,
    annualDrift: number,
    annualVolatility: number,
    horizonDays: number,
): ForecastScenario {
    const years = horizonDays / 252;
    const outcomes: number[] = [];

    for (let i = 0; i < DEFAULT_SIMULATIONS; i += 1) {
        const shock = annualVolatility * Math.sqrt(years) * randomNormal();
        const drift = (annualDrift - 0.5 * annualVolatility ** 2) * years;
        outcomes.push(currentPrice * Math.exp(drift + shock));
    }

    outcomes.sort((a, b) => a - b);
    const p50 = percentile(outcomes, 0.5);
    const mean = outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length;

    return {
        horizonDays,
        p10: percentile(outcomes, 0.1),
        p50,
        p90: percentile(outcomes, 0.9),
        probabilityAboveCurrent: outcomes.filter((value) => value > currentPrice).length / outcomes.length,
        expectedReturnPct: ((mean - currentPrice) / currentPrice) * 100,
    };
}

export async function getStockForecast(symbol: string): Promise<StockForecast | null> {
    const normalizedSymbol = symbol?.trim().toUpperCase();
    if (!normalizedSymbol) return null;

    const toDate = new Date();
    const fromDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const to = toDate.toISOString().slice(0, 10);
    const from = fromDate.toISOString().slice(0, 10);

    const [quote, metricPayload, recommendations, earnings, news, sentiment] = await Promise.all([
        fetchFinnhub<QuotePayload>('/quote', { symbol: normalizedSymbol }),
        fetchFinnhub<MetricPayload>('/stock/metric', { symbol: normalizedSymbol, metric: 'all' }),
        fetchFinnhub<RecommendationPayload[]>('/stock/recommendation', { symbol: normalizedSymbol }),
        fetchFinnhub<EarningsPayload[]>('/stock/earnings', { symbol: normalizedSymbol }),
        fetchFinnhub<NewsPayload[]>('/company-news', { symbol: normalizedSymbol, from, to }),
        getStockSentimentInsights(normalizedSymbol),
    ]);

    const metric = metricPayload?.metric || {};
    const currentPrice = toNumber(quote?.c) || toNumber(metric['currentEv/freeCashFlowTTM']) || 0;
    if (!currentPrice || currentPrice <= 0) return null;

    const latestRecommendation = Array.isArray(recommendations) ? recommendations[0] : null;
    const latestEarnings = Array.isArray(earnings) ? earnings[0] : null;
    const recentNews = Array.isArray(news) ? news : [];
    const factors: ForecastFactor[] = [];

    const dayRange = (toNumber(quote?.h) || 0) - (toNumber(quote?.l) || 0);
    const dayRangePosition = dayRange > 0 ? ((currentPrice - (toNumber(quote?.l) || currentPrice)) / dayRange) * 100 : null;
    const openToCurrentPct = quote?.o ? ((currentPrice - quote.o) / quote.o) * 100 : null;
    const gapPct = quote?.pc && quote?.o ? ((quote.o - quote.pc) / quote.pc) * 100 : null;

    addFactor(factors, 'Daily price change', 'Price action', toNumber(quote?.dp), scorePositivePercent(toNumber(quote?.dp), 8), 1.1, 'Current session momentum.', '%');
    addFactor(factors, 'Day range position', 'Price action', dayRangePosition, scoreFromRange(dayRangePosition, 50, 35), 0.8, 'Where price sits between intraday high and low.', '%');
    addFactor(factors, 'Open to current move', 'Price action', openToCurrentPct, scorePositivePercent(openToCurrentPct, 8), 0.7, 'Intraday follow-through after open.', '%');
    addFactor(factors, 'Opening gap', 'Price action', gapPct, scorePositivePercent(gapPct, 8), 0.5, 'Gap from previous close to today open.', '%');
    addFactor(factors, '5 day return', 'Momentum', toNumber(metric['5DayPriceReturnDaily']), scorePositivePercent(toNumber(metric['5DayPriceReturnDaily']), 15), 1.0, 'Short-term momentum.', '%');
    addFactor(factors, '13 week return', 'Momentum', toNumber(metric['13WeekPriceReturnDaily']), scorePositivePercent(toNumber(metric['13WeekPriceReturnDaily']), 35), 1.2, 'Quarterly momentum.', '%');
    addFactor(factors, '26 week return', 'Momentum', toNumber(metric['26WeekPriceReturnDaily']), scorePositivePercent(toNumber(metric['26WeekPriceReturnDaily']), 45), 0.9, 'Medium-term trend.', '%');
    addFactor(factors, '52 week return', 'Momentum', toNumber(metric['52WeekPriceReturnDaily']), scorePositivePercent(toNumber(metric['52WeekPriceReturnDaily']), 80), 0.8, 'Long-term trend.', '%');

    const high52 = toNumber(metric['52WeekHigh']);
    const low52 = toNumber(metric['52WeekLow']);
    const range52Position = high52 && low52 && high52 > low52 ? ((currentPrice - low52) / (high52 - low52)) * 100 : null;
    const drawdownFromHigh = high52 ? ((currentPrice - high52) / high52) * 100 : null;
    addFactor(factors, '52 week range position', 'Price action', range52Position, scoreFromRange(range52Position, 50, 35), 0.8, 'Position inside the yearly range.', '%');
    addFactor(factors, 'Drawdown from 52 week high', 'Risk', drawdownFromHigh, scoreFromRange(drawdownFromHigh, -25, 25), 0.6, 'Distance from recent high; deep drawdowns reduce confidence.', '%');

    const annualVolatilityPct = toNumber(metric['3MonthADReturnStd']);
    const beta = toNumber(metric['beta']);
    addFactor(factors, '3 month return volatility', 'Risk', annualVolatilityPct, scoreFromRange(annualVolatilityPct, 45, 60, true), 1.1, 'Higher volatility widens forecast range.', '%');
    addFactor(factors, 'Beta', 'Risk', beta, scoreFromRange(beta, 1.2, 1.8, true), 0.8, 'Sensitivity versus the broader market.');

    const volume10 = toNumber(metric['10DayAverageTradingVolume']);
    const volume3m = toNumber(metric['3MonthAverageTradingVolume']);
    const volumeAcceleration = volume10 && volume3m ? ((volume10 - volume3m) / volume3m) * 100 : null;
    addFactor(factors, '10 day average volume', 'Liquidity', volume10, scoreFromRange(volume10, 5, 30), 0.4, 'Near-term liquidity level.');
    addFactor(factors, 'Volume acceleration', 'Liquidity', volumeAcceleration, scorePositivePercent(volumeAcceleration, 60), 0.7, 'Recent volume versus 3-month average.', '%');

    addFactor(factors, 'Market capitalization', 'Fundamentals', toNumber(metric['marketCapitalization']), scoreFromRange(Math.log10(Math.max(toNumber(metric['marketCapitalization']) || 1, 1)), 3.4, 1.8), 0.5, 'Larger companies usually have lower financing risk.');
    addFactor(factors, 'P/E TTM', 'Valuation', toNumber(metric['peTTM']), scoreFromRange(toNumber(metric['peTTM']), 35, 70, true), 0.7, 'High multiples increase valuation risk.');
    addFactor(factors, 'P/S TTM', 'Valuation', toNumber(metric['psTTM']), scoreFromRange(toNumber(metric['psTTM']), 8, 18, true), 0.6, 'Revenue multiple versus growth expectations.');
    addFactor(factors, 'P/B annual', 'Valuation', toNumber(metric['pbAnnual']), scoreFromRange(toNumber(metric['pbAnnual']), 5, 8, true), 0.5, 'Book-value multiple.');
    addFactor(factors, 'Operating margin TTM', 'Fundamentals', toNumber(metric['operatingMarginTTM']), scoreFromRange(toNumber(metric['operatingMarginTTM']), 5, 35), 0.8, 'Operating profitability.');
    addFactor(factors, 'Net margin TTM', 'Fundamentals', toNumber(metric['netProfitMarginTTM']), scoreFromRange(toNumber(metric['netProfitMarginTTM']), 5, 25), 0.8, 'Bottom-line profitability.');
    addFactor(factors, 'ROE TTM', 'Fundamentals', toNumber(metric['roeTTM']), scoreFromRange(toNumber(metric['roeTTM']), 10, 25), 0.7, 'Return on equity.');
    addFactor(factors, 'Revenue growth TTM YoY', 'Growth', toNumber(metric['revenueGrowthTTMYoy']), scoreFromRange(toNumber(metric['revenueGrowthTTMYoy']), 15, 60), 1.0, 'Top-line growth.');
    addFactor(factors, 'Current ratio annual', 'Balance sheet', toNumber(metric['currentRatioAnnual']), scoreFromRange(toNumber(metric['currentRatioAnnual']), 1.5, 2.5), 0.5, 'Near-term liquidity buffer.');
    addFactor(factors, 'Debt/equity annual', 'Balance sheet', toNumber(metric['totalDebt/totalEquityAnnual']), scoreFromRange(toNumber(metric['totalDebt/totalEquityAnnual']), 80, 120, true), 0.6, 'Balance-sheet leverage.');

    const strongBuy = toNumber(latestRecommendation?.strongBuy) || 0;
    const buy = toNumber(latestRecommendation?.buy) || 0;
    const hold = toNumber(latestRecommendation?.hold) || 0;
    const sell = toNumber(latestRecommendation?.sell) || 0;
    const strongSell = toNumber(latestRecommendation?.strongSell) || 0;
    const analystTotal = strongBuy + buy + hold + sell + strongSell;
    const analystBullishPct = analystTotal ? ((strongBuy + buy) / analystTotal) * 100 : null;
    const analystBearishPct = analystTotal ? ((sell + strongSell) / analystTotal) * 100 : null;
    addFactor(factors, 'Analyst bullish share', 'Analyst', analystBullishPct, scoreFromRange(analystBullishPct, 50, 35), 0.9, 'Share of recent analyst ratings that are buy or strong buy.', '%');
    addFactor(factors, 'Analyst bearish share', 'Analyst', analystBearishPct, scoreFromRange(analystBearishPct, 15, 25, true), 0.6, 'Share of recent analyst ratings that are sell or strong sell.', '%');
    addFactor(factors, 'Latest earnings surprise', 'Earnings', toNumber(latestEarnings?.surprisePercent), scorePositivePercent(toNumber(latestEarnings?.surprisePercent), 80), 0.8, 'Most recent EPS surprise versus estimate.', '%');

    const newsTone = getNewsToneScore(recentNews);
    addFactor(factors, 'Recent company news volume', 'News', recentNews.length, scoreFromRange(recentNews.length, 8, 20), 0.4, 'More news means more active information flow.');
    addFactor(factors, 'Headline tone score', 'News', newsTone, newsTone, 0.8, 'Simple positive/negative headline keyword score.');

    addFactor(factors, 'Sentiment source coverage', 'Sentiment', sentiment?.availableSources ?? 0, scoreFromRange(sentiment?.availableSources ?? 0, 2, 2), 0.4, 'How many external sentiment sources reported data.');
    addFactor(factors, 'Average sentiment buzz', 'Sentiment', sentiment?.averageBuzz ?? null, scoreFromRange(sentiment?.averageBuzz ?? null, 50, 35), 0.7, 'Adanos cross-source attention score.', '/100', 1);
    addFactor(factors, 'Bullish sentiment average', 'Sentiment', sentiment?.bullishAverage ?? null, scoreFromRange(sentiment?.bullishAverage ?? null, 50, 30), 1.0, 'Average bullish percentage across sentiment sources.', '%');
    const alignmentScore = sentiment?.sourceAlignment === 'Bullish alignment'
        ? 0.8
        : sentiment?.sourceAlignment === 'Bearish alignment'
            ? -0.8
            : sentiment?.sourceAlignment === 'Wide divergence'
                ? -0.3
                : sentiment?.sourceAlignment === 'Tight alignment'
                    ? 0.2
                    : 0;
    addFactor(factors, 'Sentiment alignment', 'Sentiment', alignmentScore, alignmentScore, 0.6, sentiment?.sourceAlignment || 'No sentiment data.');

    const weightedScore = factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0)
        / factors.reduce((sum, factor) => sum + factor.weight, 0);

    const volatility = clamp((annualVolatilityPct || 55) / 100, 0.15, 2.5);
    const momentumTilt = (
        (toNumber(metric['5DayPriceReturnDaily']) || 0) * 0.01 +
        (toNumber(metric['13WeekPriceReturnDaily']) || 0) * 0.004 +
        (toNumber(metric['26WeekPriceReturnDaily']) || 0) * 0.002
    );
    const annualDrift = clamp(weightedScore * 0.55 + momentumTilt, -0.9, 0.9);
    const confidence = clamp(
        35 + Math.min(factors.filter((factor) => factor.value !== 'N/A').length, 30) * 1.7 - volatility * 12,
        20,
        82,
    );

    return {
        symbol: normalizedSymbol,
        currentPrice,
        generatedAt: new Date().toISOString(),
        modelSignal: weightedScore >= 0.2 ? 'Bullish' : weightedScore <= -0.2 ? 'Bearish' : 'Neutral',
        score: Number(weightedScore.toFixed(3)),
        confidence: Number(confidence.toFixed(0)),
        annualizedDriftPct: Number((annualDrift * 100).toFixed(1)),
        annualizedVolatilityPct: Number((volatility * 100).toFixed(1)),
        scenarios: [7, 30, 90].map((days) => simulateScenario(currentPrice, annualDrift, volatility, days)),
        factors,
        newsSampleSize: recentNews.length,
        sentimentSources: sentiment?.availableSources ?? 0,
        limitations: [
            'Finnhub candle history is unavailable on the current plan, so volatility and drift use Finnhub metric aggregates instead of raw daily closes.',
            'Monte Carlo simulations are random scenario ranges, not guaranteed future prices.',
            'This is educational analysis and not financial advice or a buy/sell instruction.',
        ],
    };
}
