'use server';

import { getStockSentimentInsights } from './adanos.actions';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
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

type AlphaVantageDailyPayload = {
    'Time Series (Daily)'?: Record<string, {
        '1. open'?: string;
        '2. high'?: string;
        '3. low'?: string;
        '4. close'?: string;
        '5. volume'?: string;
    }>;
    'Error Message'?: string;
    Information?: string;
    Note?: string;
};

type DailyPriceBar = {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

type DailyPriceStats = {
    bars: DailyPriceBar[];
    logReturns: number[];
    annualizedMeanReturn: number | null;
    annualizedVolatility: number | null;
    simpleReturn5d: number | null;
    simpleReturn20d: number | null;
    simpleReturn60d: number | null;
    closeVsSma20Pct: number | null;
    closeVsSma50Pct: number | null;
    volumeVsSma20Pct: number | null;
    recentRangePosition: number | null;
    historicalDrift: number | null;
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
    priceHistorySource: 'Alpha Vantage raw daily prices' | 'Finnhub aggregate metrics';
    priceHistoryDays: number;
    limitations: string[];
};

function getFinnhubToken() {
    return process.env.NEXT_PUBLIC_FINNHUB_API_KEY || '';
}

function getAlphaVantageToken() {
    return process.env.ALPHA_VANTAGE_API_KEY || '';
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

async function fetchAlphaVantageDailyPrices(symbol: string): Promise<DailyPriceBar[]> {
    const token = getAlphaVantageToken();
    if (!token) return [];

    const url = new URL(ALPHA_VANTAGE_BASE_URL);
    url.searchParams.set('function', 'TIME_SERIES_DAILY');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('outputsize', 'compact');
    url.searchParams.set('apikey', token);

    try {
        const response = await fetch(url.toString(), {
            next: { revalidate: 60 * 60 * 6 },
        });
        if (!response.ok) {
            console.error(`Alpha Vantage daily prices failed: ${response.status}`);
            return [];
        }

        const payload = (await response.json()) as AlphaVantageDailyPayload;
        const series = payload['Time Series (Daily)'];
        if (!series) {
            console.error('Alpha Vantage daily prices unavailable', payload.Note || payload.Information || payload['Error Message']);
            return [];
        }

        return Object.entries(series)
            .map(([date, values]) => ({
                date,
                open: Number(values['1. open']),
                high: Number(values['2. high']),
                low: Number(values['3. low']),
                close: Number(values['4. close']),
                volume: Number(values['5. volume']),
            }))
            .filter((bar) => (
                Number.isFinite(bar.open)
                && Number.isFinite(bar.high)
                && Number.isFinite(bar.low)
                && Number.isFinite(bar.close)
                && Number.isFinite(bar.volume)
                && bar.close > 0
            ))
            .sort((a, b) => a.date.localeCompare(b.date));
    } catch (error) {
        console.error('Alpha Vantage daily prices request failed', error);
        return [];
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

function mean(values: number[]) {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
    const average = mean(values);
    if (average === null || values.length < 2) return null;
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}

function simpleReturnPct(bars: DailyPriceBar[], days: number) {
    if (bars.length <= days) return null;
    const latest = bars[bars.length - 1];
    const prior = bars[bars.length - 1 - days];
    if (!latest || !prior || prior.close <= 0) return null;
    return ((latest.close - prior.close) / prior.close) * 100;
}

function movingAverage(values: number[], periods: number) {
    if (values.length < periods) return null;
    const slice = values.slice(-periods);
    return mean(slice);
}

function computeDailyPriceStats(bars: DailyPriceBar[]): DailyPriceStats | null {
    if (bars.length < 10) return null;

    const closes = bars.map((bar) => bar.close);
    const volumes = bars.map((bar) => bar.volume);
    const latest = bars[bars.length - 1];
    const logReturns: number[] = [];

    for (let i = 1; i < closes.length; i += 1) {
        if (closes[i - 1] > 0 && closes[i] > 0) {
            logReturns.push(Math.log(closes[i] / closes[i - 1]));
        }
    }

    const returnMean = mean(logReturns);
    const returnStd = standardDeviation(logReturns);
    const sma20 = movingAverage(closes, 20);
    const sma50 = movingAverage(closes, 50);
    const volumeSma20 = movingAverage(volumes, 20);
    const rangeBars = bars.slice(-60);
    const rangeHigh = Math.max(...rangeBars.map((bar) => bar.high));
    const rangeLow = Math.min(...rangeBars.map((bar) => bar.low));
    const recentRangePosition = rangeHigh > rangeLow
        ? ((latest.close - rangeLow) / (rangeHigh - rangeLow)) * 100
        : null;

    return {
        bars,
        logReturns,
        annualizedMeanReturn: returnMean === null ? null : returnMean * 252,
        annualizedVolatility: returnStd === null ? null : returnStd * Math.sqrt(252),
        simpleReturn5d: simpleReturnPct(bars, 5),
        simpleReturn20d: simpleReturnPct(bars, 20),
        simpleReturn60d: simpleReturnPct(bars, 60),
        closeVsSma20Pct: sma20 && sma20 > 0 ? ((latest.close - sma20) / sma20) * 100 : null,
        closeVsSma50Pct: sma50 && sma50 > 0 ? ((latest.close - sma50) / sma50) * 100 : null,
        volumeVsSma20Pct: volumeSma20 && volumeSma20 > 0 ? ((latest.volume - volumeSma20) / volumeSma20) * 100 : null,
        recentRangePosition,
        historicalDrift: returnMean === null ? null : returnMean * 252,
    };
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

    const [quote, metricPayload, recommendations, earnings, news, sentiment, dailyPrices] = await Promise.all([
        fetchFinnhub<QuotePayload>('/quote', { symbol: normalizedSymbol }),
        fetchFinnhub<MetricPayload>('/stock/metric', { symbol: normalizedSymbol, metric: 'all' }),
        fetchFinnhub<RecommendationPayload[]>('/stock/recommendation', { symbol: normalizedSymbol }),
        fetchFinnhub<EarningsPayload[]>('/stock/earnings', { symbol: normalizedSymbol }),
        fetchFinnhub<NewsPayload[]>('/company-news', { symbol: normalizedSymbol, from, to }),
        getStockSentimentInsights(normalizedSymbol),
        fetchAlphaVantageDailyPrices(normalizedSymbol),
    ]);

    const metric = metricPayload?.metric || {};
    const dailyStats = computeDailyPriceStats(dailyPrices);
    const latestDailyClose = dailyStats?.bars.at(-1)?.close || null;
    const currentPrice = toNumber(quote?.c) || latestDailyClose || toNumber(metric['currentEv/freeCashFlowTTM']) || 0;
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

    addFactor(factors, 'Raw daily price sample', 'Price history', dailyStats?.bars.length ?? 0, scoreFromRange(dailyStats?.bars.length ?? 0, 50, 50), 0.3, 'Alpha Vantage daily OHLCV records available to the model.', ' days', 0);
    addFactor(factors, 'Alpha 5 day close return', 'Price history', dailyStats?.simpleReturn5d ?? null, scorePositivePercent(dailyStats?.simpleReturn5d ?? null, 15), 1.0, 'Return calculated from raw Alpha Vantage daily closes.', '%');
    addFactor(factors, 'Alpha 20 day close return', 'Price history', dailyStats?.simpleReturn20d ?? null, scorePositivePercent(dailyStats?.simpleReturn20d ?? null, 30), 1.1, 'One-month return from raw daily closes.', '%');
    addFactor(factors, 'Alpha 60 day close return', 'Price history', dailyStats?.simpleReturn60d ?? null, scorePositivePercent(dailyStats?.simpleReturn60d ?? null, 55), 0.9, 'Three-month return from raw daily closes.', '%');
    addFactor(factors, 'Close versus 20 day average', 'Price history', dailyStats?.closeVsSma20Pct ?? null, scorePositivePercent(dailyStats?.closeVsSma20Pct ?? null, 18), 0.9, 'Latest close versus short moving average.', '%');
    addFactor(factors, 'Close versus 50 day average', 'Price history', dailyStats?.closeVsSma50Pct ?? null, scorePositivePercent(dailyStats?.closeVsSma50Pct ?? null, 25), 0.8, 'Latest close versus medium moving average.', '%');
    addFactor(factors, '60 day range position', 'Price history', dailyStats?.recentRangePosition ?? null, scoreFromRange(dailyStats?.recentRangePosition ?? null, 50, 35), 0.7, 'Latest close position inside the recent high-low range.', '%');
    addFactor(factors, 'Volume versus 20 day average', 'Price history', dailyStats?.volumeVsSma20Pct ?? null, scorePositivePercent(dailyStats?.volumeVsSma20Pct ?? null, 80), 0.6, 'Latest raw daily volume versus recent average.', '%');

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

    const rawAnnualVolatility = dailyStats?.annualizedVolatility ?? null;
    const rawHistoricalDrift = dailyStats?.historicalDrift ?? null;
    const volatility = clamp(rawAnnualVolatility ?? ((annualVolatilityPct || 55) / 100), 0.15, 2.5);
    const momentumTilt = (
        (dailyStats?.simpleReturn5d ?? toNumber(metric['5DayPriceReturnDaily']) ?? 0) * 0.01 +
        (dailyStats?.simpleReturn20d ?? 0) * 0.004 +
        (dailyStats?.simpleReturn60d ?? toNumber(metric['13WeekPriceReturnDaily']) ?? 0) * 0.002
    );
    const historyDriftTilt = rawHistoricalDrift === null ? 0 : clamp(rawHistoricalDrift, -1.2, 1.2) * 0.35;
    const annualDrift = clamp(weightedScore * 0.45 + historyDriftTilt + momentumTilt, -0.9, 0.9);
    const confidence = clamp(
        35
        + Math.min(factors.filter((factor) => factor.value !== 'N/A').length, 34) * 1.7
        + (dailyStats ? 6 : 0)
        - volatility * 12,
        20,
        88,
    );
    const priceHistorySource = dailyStats ? 'Alpha Vantage raw daily prices' : 'Finnhub aggregate metrics';

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
        priceHistorySource,
        priceHistoryDays: dailyStats?.bars.length ?? 0,
        limitations: [
            dailyStats
                ? `Raw daily prices came from Alpha Vantage (${dailyStats.bars.length} recent daily bars). Adjusted prices are unavailable on this free key, so splits/dividends are not adjusted.`
                : 'Alpha Vantage raw daily prices were unavailable or rate-limited, so volatility and drift used Finnhub aggregate metrics.',
            'Monte Carlo simulations are random scenario ranges, not guaranteed future prices.',
            'This is educational analysis and not financial advice or a buy/sell instruction.',
        ],
    };
}
