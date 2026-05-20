'use client';

import React, { useEffect, useMemo, useState } from 'react';
import WatchlistStockChip from './WatchlistStockChip';
import TradingViewWatchlist from './TradingViewWatchlist';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowDownAZ, ArrowUp, ArrowUpDown, ArrowUpZA } from 'lucide-react';
import { WatchlistItem } from '@/database/models/watchlist.model';
import { formatCurrency } from '@/lib/utils';

interface WatchlistManagerProps {
    initialItems: WatchlistItem[]; // Using the DB model type directly or a simplified version
    userId: string;
}

export default function WatchlistManager({ initialItems, userId }: WatchlistManagerProps) {
    // Sort state: 'asc' (A-Z), 'desc' (Z-A), or null (added order/default)
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);
    const [quotes, setQuotes] = useState<Record<string, { price: number; changePercent: number }>>({});

    const toggleSort = () => {
        if (sortOrder === null) setSortOrder('asc');
        else if (sortOrder === 'asc') setSortOrder('desc');
        else setSortOrder(null);
    };

    const sortedItems = useMemo(() => {
        if (!sortOrder) return initialItems;

        return [...initialItems].sort((a, b) => {
            if (sortOrder === 'asc') {
                return a.symbol.localeCompare(b.symbol);
            } else {
                return b.symbol.localeCompare(a.symbol);
            }
        });
    }, [initialItems, sortOrder]);

    const watchlistSymbols = sortedItems.map((item) => item.symbol);
    const symbolsKey = watchlistSymbols.join('|');

    useEffect(() => {
        if (!symbolsKey) {
            setQuotes({});
            return;
        }

        let active = true;

        const refreshPrices = async () => {
            const symbols = symbolsKey.split('|').filter(Boolean);
            if (symbols.length === 0) return;

            try {
                const { getWatchlistData } = await import('@/lib/actions/finnhub.actions');
                const latest = await getWatchlistData(symbols);
                if (!active) return;

                setQuotes(Object.fromEntries(
                    latest.map((stock) => [
                        stock.symbol,
                        {
                            price: stock.price,
                            changePercent: stock.changePercent,
                        },
                    ]),
                ));
            } catch (error) {
                console.error('Failed to refresh watchlist quotes', error);
            }
        };

        refreshPrices();
        const intervalId = window.setInterval(refreshPrices, 60_000);

        return () => {
            active = false;
            window.clearInterval(intervalId);
        };
    }, [symbolsKey]);

    return (
        <div className="space-y-6">
            <div className="bg-gray-900/30 rounded-xl border border-gray-800 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center">
                        <span className="mr-2">Manage Symbols</span>
                        <span className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">
                            {watchlistSymbols.length}
                        </span>
                    </h3>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleSort}
                        className="h-8 px-2 text-gray-400 hover:text-white hover:bg-white/10"
                        title={
                            sortOrder === 'asc'
                                ? 'Sorted A-Z'
                                : sortOrder === 'desc'
                                    ? 'Sorted Z-A'
                                    : 'Default Order'
                        }
                    >
                        {sortOrder === 'asc' && <ArrowDownAZ className="w-4 h-4 mr-2" />}
                        {sortOrder === 'desc' && <ArrowUpZA className="w-4 h-4 mr-2" />}
                        {sortOrder === null && <ArrowUpDown className="w-4 h-4 mr-2" />}
                        <span className="text-xs">
                            {sortOrder === 'asc'
                                ? 'A-Z'
                                : sortOrder === 'desc'
                                    ? 'Z-A'
                                    : 'Sort'}
                        </span>
                    </Button>
                </div>

                {watchlistSymbols.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {sortedItems.map((item) => (
                            <WatchlistStockChip
                                key={item.symbol}
                                symbol={item.symbol}
                                userId={userId}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500 italic">No stocks in watchlist.</p>
                )}
            </div>

            {watchlistSymbols.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {watchlistSymbols.map((symbol) => {
                        const quote = quotes[symbol];
                        const isPositive = (quote?.changePercent ?? 0) >= 0;

                        return (
                            <div key={symbol} className="rounded-lg border border-white/10 bg-black/35 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-mono text-sm font-semibold text-white">{symbol}</span>
                                    <span className={`flex items-center rounded-md px-2 py-1 text-xs font-semibold ${isPositive ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>
                                        {isPositive ? <ArrowUp className="mr-1 h-3 w-3" /> : <ArrowDown className="mr-1 h-3 w-3" />}
                                        {quote ? `${Math.abs(quote.changePercent).toFixed(2)}%` : '--'}
                                    </span>
                                </div>
                                <p className="mt-3 text-2xl font-semibold text-white">
                                    {quote?.price ? formatCurrency(quote.price) : 'Loading'}
                                </p>
                                <p className="mt-1 text-xs text-gray-500">Refreshes every minute when this page is open.</p>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="min-h-[550px]">
                <TradingViewWatchlist symbols={watchlistSymbols} />
            </div>
        </div>
    );
}
