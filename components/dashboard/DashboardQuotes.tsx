'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { getWatchlistData } from '@/lib/actions/finnhub.actions';
import { formatCurrency } from '@/lib/utils';

const DASHBOARD_SYMBOLS = ['IREN', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'AMD', 'MRAM'];

type DashboardQuote = {
    symbol: string;
    name: string;
    price: number;
    changePercent: number;
};

export default function DashboardQuotes() {
    const [quotes, setQuotes] = useState<DashboardQuote[]>([]);
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;

        const refreshQuotes = async () => {
            try {
                const latest = await getWatchlistData(DASHBOARD_SYMBOLS);
                if (!active) return;

                setQuotes(latest.map((stock) => ({
                    symbol: stock.symbol,
                    name: stock.name,
                    price: stock.price,
                    changePercent: stock.changePercent,
                })));
                setLastUpdated(new Date().toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                }));
            } catch (error) {
                console.error('Failed to refresh dashboard quotes', error);
            } finally {
                if (active) setLoading(false);
            }
        };

        refreshQuotes();
        const intervalId = window.setInterval(refreshQuotes, 60_000);

        return () => {
            active = false;
            window.clearInterval(intervalId);
        };
    }, []);

    return (
        <section className="w-full rounded-xl border border-white/10 bg-black/40 p-4 shadow-xl backdrop-blur-md">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-white">Market Prices</h2>
                    <p className="text-xs text-gray-500">
                        Delayed quotes refresh every minute. Last update: {lastUpdated || 'loading'}
                    </p>
                </div>
                <RefreshCw className={`h-4 w-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {DASHBOARD_SYMBOLS.map((symbol) => {
                    const quote = quotes.find((item) => item.symbol === symbol);
                    const isPositive = (quote?.changePercent ?? 0) >= 0;

                    return (
                        <article key={symbol} className="rounded-lg border border-white/10 bg-gray-950/60 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="font-mono text-sm font-semibold text-white">{symbol}</p>
                                    <p className="mt-1 line-clamp-1 text-xs text-gray-500">{quote?.name || symbol}</p>
                                </div>
                                <span className={`flex items-center rounded-md px-2 py-1 text-xs font-semibold ${isPositive ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>
                                    {isPositive ? <ArrowUp className="mr-1 h-3 w-3" /> : <ArrowDown className="mr-1 h-3 w-3" />}
                                    {quote ? `${Math.abs(quote.changePercent).toFixed(2)}%` : '--'}
                                </span>
                            </div>
                            <p className="mt-3 text-2xl font-semibold text-white">
                                {quote?.price ? formatCurrency(quote.price) : 'Loading'}
                            </p>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
