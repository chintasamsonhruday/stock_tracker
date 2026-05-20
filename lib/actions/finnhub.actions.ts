'use server';

import { getDateRange, validateArticle, formatArticle } from '@/lib/utils';
import { POPULAR_STOCK_SYMBOLS } from '@/lib/constants';
import { cache } from 'react';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const STOOQ_QUOTE_URL = 'https://stooq.com/q/l/';
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? '';

type FinnhubQuote = {
    c?: number;
    d?: number;
    dp?: number;
};

type FinnhubCompanyProfile = {
    currency?: string;
    exchange?: string;
    logo?: string;
    marketCapitalization?: number;
    name?: string;
    ticker?: string;
};

type SearchStockCandidate = FinnhubSearchResult & {
    __exchange?: string;
};

const FALLBACK_SEARCH_STOCKS: StockWithWatchlistStatus[] = [
    { symbol: 'IREN', name: 'IREN Limited', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'MSFT', name: 'Microsoft Corp', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'GOOGL', name: 'Alphabet Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'AMZN', name: 'Amazon.com Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'TSLA', name: 'Tesla Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'META', name: 'Meta Platforms Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'NVDA', name: 'NVIDIA Corp', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'AMD', name: 'Advanced Micro Devices Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'NFLX', name: 'Netflix Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'ORCL', name: 'Oracle Corp', exchange: 'NYSE', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'CRM', name: 'Salesforce Inc', exchange: 'NYSE', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'COIN', name: 'Coinbase Global Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'PLTR', name: 'Palantir Technologies Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'MARA', name: 'MARA Holdings Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
    { symbol: 'RIOT', name: 'Riot Platforms Inc', exchange: 'NASDAQ', type: 'Common Stock', isInWatchlist: false },
];

function searchFallbackStocks(query?: string) {
    const trimmed = typeof query === 'string' ? query.trim().toLowerCase() : '';

    if (!trimmed) {
        return FALLBACK_SEARCH_STOCKS.slice(0, 10);
    }

    return FALLBACK_SEARCH_STOCKS
        .filter((stock) => {
            const haystack = `${stock.symbol} ${stock.name} ${stock.exchange} ${stock.type}`.toLowerCase();
            return haystack.includes(trimmed);
        })
        .slice(0, 15);
}

const FINNHUB_EXCHANGE_SUFFIXES = new Set([
    'AS', 'AT', 'AX', 'BA', 'BK', 'BO', 'BR', 'CO', 'DE', 'F', 'HE', 'HK',
    'IL', 'IS', 'JK', 'JO', 'KL', 'KQ', 'KS', 'L', 'LS', 'MC', 'MI', 'MX',
    'NS', 'NZ', 'OL', 'PA', 'PR', 'SA', 'SI', 'SS', 'ST', 'SW', 'SZ', 'T',
    'TA', 'TO', 'TW', 'TWO', 'V', 'VI', 'WA',
]);

async function fetchJSON<T>(url: string, revalidateSeconds?: number): Promise<T> {
    const options: RequestInit & { next?: { revalidate?: number } } = revalidateSeconds
        ? { cache: 'force-cache', next: { revalidate: revalidateSeconds } }
        : { cache: 'no-store' };

    const res = await fetch(url, options);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Fetch failed ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
}

export { fetchJSON };

function parseCsvRow(row: string) {
    const values: string[] = [];
    let current = '';
    let quoted = false;

    for (let i = 0; i < row.length; i += 1) {
        const char = row[i];
        if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    values.push(current);
    return values.map((value) => value.trim());
}

function toStooqSymbol(symbol: string) {
    const normalized = symbol.trim().toLowerCase();
    if (!normalized) return '';
    if (normalized.includes('.')) return normalized;

    return `${normalized}.us`;
}

function toFiniteNumber(value: string | undefined) {
    if (!value || value === 'N/D') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

async function getStooqQuote(symbol: string): Promise<FinnhubQuote | null> {
    const stooqSymbol = toStooqSymbol(symbol);
    if (!stooqSymbol) return null;

    const url = new URL(STOOQ_QUOTE_URL);
    url.searchParams.set('s', stooqSymbol);
    url.searchParams.set('f', 'sd2t2lcpohv');
    url.searchParams.set('h', '');
    url.searchParams.set('e', 'csv');

    try {
        const response = await fetch(url.toString(), {
            cache: 'force-cache',
            next: { revalidate: 60 },
        });
        if (!response.ok) return null;

        const csv = await response.text();
        const lines = csv.trim().split(/\r?\n/);
        if (lines.length < 2) return null;

        const headers = parseCsvRow(lines[0]);
        const values = parseCsvRow(lines[1]);
        const row = new Map(headers.map((header, index) => [header, values[index]]));
        const close = toFiniteNumber(row.get('Close'));
        const previousClose = toFiniteNumber(row.get('Prev'));

        if (!close || close <= 0) return null;

        const change = previousClose && previousClose > 0 ? close - previousClose : 0;
        const changePercent = previousClose && previousClose > 0 ? (change / previousClose) * 100 : 0;

        return {
            c: close,
            d: change,
            dp: changePercent,
        };
    } catch (error) {
        console.error('Error fetching Stooq quote for', symbol, error);
        return null;
    }
}

function getExchangeLabel(symbol: string, exchange?: string) {
    if (exchange?.trim()) {
        return exchange.trim();
    }

    const parts = symbol.split('.');
    const suffix = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';

    if (!suffix) {
        return 'US';
    }

    return FINNHUB_EXCHANGE_SUFFIXES.has(suffix) ? suffix : 'US';
}

export async function getQuote(symbol: string) {
    const normalizedSymbol = symbol?.trim().toUpperCase();
    if (!normalizedSymbol) return null;

    try {
        const token = NEXT_PUBLIC_FINNHUB_API_KEY;
        if (token) {
            const url = `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(normalizedSymbol)}&token=${token}`;
            const quote = await fetchJSON<FinnhubQuote>(url, 0);
            if (quote?.c && quote.c > 0) return quote;
        }
    } catch (e) {
        console.warn('Finnhub quote unavailable, falling back to Stooq for', normalizedSymbol);
    }

    return getStooqQuote(normalizedSymbol);
}

export async function getCompanyProfile(symbol: string) {
    try {
        const token = NEXT_PUBLIC_FINNHUB_API_KEY;
        if (!token) return null;

        const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`;
        // Cache profile for 24 hours
        return await fetchJSON<FinnhubCompanyProfile>(url, 86400);
    } catch (e) {
        console.error('Error fetching profile for', symbol, e);
        return null;
    }
}

export async function getWatchlistData(symbols: string[]) {
    if (!symbols || symbols.length === 0) return [];

    // Fetch quotes and profiles in parallel
    const promises = symbols.map(async (sym) => {
        const [quote, profile] = await Promise.all([
            getQuote(sym),
            getCompanyProfile(sym)
        ]);

        return {
            symbol: sym,
            price: quote?.c || 0,
            change: quote?.d || 0,
            changePercent: quote?.dp || 0,
            currency: profile?.currency || 'USD',
            name: profile?.name || sym,
            logo: profile?.logo,
            marketCap: profile?.marketCapitalization,
            peRatio: 0 // Finnhub 'quote' and 'profile2' don't easily give real-time PE. Might need 'metric' endpoint, but skipping for now to save rate limits.
        };
    });

    return await Promise.all(promises);
}


export async function getNews(symbols?: string[]): Promise<MarketNewsArticle[]> {
    try {
        const range = getDateRange(5);
        const token = NEXT_PUBLIC_FINNHUB_API_KEY;
        if (!token) {
            console.warn('Finnhub API key is not configured; skipping market news.');
            return [];
        }
        const cleanSymbols = (symbols || [])
            .map((s) => s?.trim().toUpperCase())
            .filter((s): s is string => Boolean(s));

        const maxArticles = 6;

        // If we have symbols, try to fetch company news per symbol and round-robin select
        if (cleanSymbols.length > 0) {
            const perSymbolArticles: Record<string, RawNewsArticle[]> = {};

            await Promise.all(
                cleanSymbols.map(async (sym) => {
                    try {
                        const url = `${FINNHUB_BASE_URL}/company-news?symbol=${encodeURIComponent(sym)}&from=${range.from}&to=${range.to}&token=${token}`;
                        const articles = await fetchJSON<RawNewsArticle[]>(url, 300);
                        perSymbolArticles[sym] = (articles || []).filter(validateArticle);
                    } catch (e) {
                        console.error('Error fetching company news for', sym, e);
                        perSymbolArticles[sym] = [];
                    }
                })
            );

            const collected: MarketNewsArticle[] = [];
            // Round-robin up to 6 picks
            for (let round = 0; round < maxArticles; round++) {
                for (let i = 0; i < cleanSymbols.length; i++) {
                    const sym = cleanSymbols[i];
                    const list = perSymbolArticles[sym] || [];
                    if (list.length === 0) continue;
                    const article = list.shift();
                    if (!article || !validateArticle(article)) continue;
                    collected.push(formatArticle(article, true, sym, round));
                    if (collected.length >= maxArticles) break;
                }
                if (collected.length >= maxArticles) break;
            }

            if (collected.length > 0) {
                // Sort by datetime desc
                collected.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
                return collected.slice(0, maxArticles);
            }
            // If none collected, fall through to general news
        }

        // General market news fallback or when no symbols provided
        const generalUrl = `${FINNHUB_BASE_URL}/news?category=general&token=${token}`;
        const general = await fetchJSON<RawNewsArticle[]>(generalUrl, 300);

        const seen = new Set<string>();
        const unique: RawNewsArticle[] = [];
        for (const art of general || []) {
            if (!validateArticle(art)) continue;
            const key = `${art.id}-${art.url}-${art.headline}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(art);
            if (unique.length >= 20) break; // cap early before final slicing
        }

        const formatted = unique.slice(0, maxArticles).map((a, idx) => formatArticle(a, false, undefined, idx));
        return formatted;
    } catch (err) {
        console.error('getNews error:', err);
        throw new Error('Failed to fetch news');
    }
}

export const searchStocks = cache(async (query?: string): Promise<StockWithWatchlistStatus[]> => {
    try {
        const token = NEXT_PUBLIC_FINNHUB_API_KEY;
        if (!token) {
            return searchFallbackStocks(query);
        }

        const trimmed = typeof query === 'string' ? query.trim() : '';

        let results: SearchStockCandidate[] = [];

        if (!trimmed) {
            // Fetch top 10 popular symbols' profiles
            const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);
            const profiles = await Promise.all(
                top.map(async (sym) => {
                    try {
                        const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`;
                        // Revalidate every hour
                        const profile = await fetchJSON<FinnhubCompanyProfile>(url, 3600);
                        return { sym, profile } as { sym: string; profile: FinnhubCompanyProfile | null };
                    } catch (e) {
                        console.error('Error fetching profile2 for', sym, e);
                        return { sym, profile: null } as { sym: string; profile: FinnhubCompanyProfile | null };
                    }
                })
            );

            results = profiles
                .map(({ sym, profile }) => {
                    const symbol = sym.toUpperCase();
                    const name: string | undefined = profile?.name || profile?.ticker || undefined;
                    const exchange: string | undefined = profile?.exchange || undefined;
                    if (!name) return undefined;
                    const r: SearchStockCandidate = {
                        symbol,
                        description: name,
                        displaySymbol: symbol,
                        type: 'Common Stock',
                    };
                    r.__exchange = exchange;
                    return r;
                })
                .filter((x): x is SearchStockCandidate => Boolean(x));
        } else {
            const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(trimmed)}&token=${token}`;
            const data = await fetchJSON<FinnhubSearchResponse>(url, 1800);
            results = Array.isArray(data?.result) ? data.result : [];
        }

        const mapped: StockWithWatchlistStatus[] = results
            .map((r) => {
                const upper = (r.symbol || '').toUpperCase();
                const name = r.description || upper;
                const exchangeFromProfile = r.__exchange;
                const exchange = getExchangeLabel(upper, exchangeFromProfile);
                const type = r.type || 'Stock';
                const item: StockWithWatchlistStatus = {
                    symbol: upper,
                    name,
                    exchange,
                    type,
                    isInWatchlist: false,
                };
                return item;
            })
            .slice(0, 15);

        return mapped;
    } catch (err) {
        console.error('Error in stock search:', err);
        return searchFallbackStocks(query);
    }
});
