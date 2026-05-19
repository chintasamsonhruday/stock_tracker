'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

type StockPageAutoRefreshProps = {
    intervalMs?: number;
};

function getNewYorkMarketMinutes(now: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(now);

    const weekday = parts.find((part) => part.type === 'weekday')?.value;
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);

    if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (weekday === 'Sat' || weekday === 'Sun') return null;

    return hour * 60 + minute;
}

function isRegularUsMarketOpen(now = new Date()) {
    const minutes = getNewYorkMarketMinutes(now);
    if (minutes === null) return false;

    return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export default function StockPageAutoRefresh({ intervalMs = 60_000 }: StockPageAutoRefreshProps) {
    const router = useRouter();

    useEffect(() => {
        const refreshIfActive = () => {
            if (document.visibilityState === 'visible' && isRegularUsMarketOpen()) {
                router.refresh();
            }
        };

        const intervalId = window.setInterval(refreshIfActive, intervalMs);
        return () => window.clearInterval(intervalId);
    }, [intervalMs, router]);

    return null;
}
