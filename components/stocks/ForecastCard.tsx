import type { StockForecast } from '@/lib/actions/forecast.actions';

type ForecastCardProps = {
    forecast: StockForecast | null;
};

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
    }).format(value);
}

function formatPct(value: number, digits = 1) {
    return `${(value * 100).toFixed(digits)}%`;
}

function getSignalClass(signal: StockForecast['modelSignal']) {
    if (signal === 'Bullish') return 'text-emerald-400';
    if (signal === 'Bearish') return 'text-rose-400';
    return 'text-amber-300';
}

function getScoreBarClass(score: number) {
    if (score >= 0.2) return 'bg-emerald-400';
    if (score <= -0.2) return 'bg-rose-400';
    return 'bg-amber-300';
}

export default function ForecastCard({ forecast }: ForecastCardProps) {
    if (!forecast) {
        return (
            <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-5 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                    Forecast Model
                </p>
                <p className="mt-3 text-sm text-gray-400">
                    Forecast data is unavailable for this symbol with the current data providers.
                </p>
            </section>
        );
    }

    const sortedFactors = [...forecast.factors]
        .sort((a, b) => Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight))
        .slice(0, 12);

    const scorePosition = `${Math.max(0, Math.min(100, (forecast.score + 1) * 50))}%`;

    return (
        <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-5 backdrop-blur-sm">
            <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
                            Probabilistic Forecast
                        </p>
                        <h2 className="mt-2 text-xl font-semibold text-white">
                            {forecast.symbol} model signal: <span className={getSignalClass(forecast.modelSignal)}>{forecast.modelSignal}</span>
                        </h2>
                        <p className="mt-1 text-sm text-gray-400">
                            Monte Carlo scenario ranges from {forecast.factors.length} factors, news, analyst data, sentiment, and {forecast.priceHistorySource.toLowerCase()}.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-800 bg-black/20 p-4 md:min-w-[320px]">
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Current</p>
                            <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(forecast.currentPrice)}</p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Confidence</p>
                            <p className="mt-1 text-lg font-semibold text-white">{forecast.confidence}%</p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Drift</p>
                            <p className="mt-1 text-lg font-semibold text-white">{forecast.annualizedDriftPct.toFixed(1)}%</p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Volatility</p>
                            <p className="mt-1 text-lg font-semibold text-white">{forecast.annualizedVolatilityPct.toFixed(1)}%</p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-500">Price History</p>
                            <p className="mt-1 text-sm font-semibold text-white">
                                {forecast.priceHistoryDays > 0 ? `${forecast.priceHistoryDays} daily bars` : 'Aggregate fallback'}
                            </p>
                        </div>
                    </div>
                </div>

                <div>
                    <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                        <span>Bearish</span>
                        <span>Neutral</span>
                        <span>Bullish</span>
                    </div>
                    <div className="relative h-2 rounded-full bg-gradient-to-r from-rose-500 via-amber-300 to-emerald-400">
                        <div
                            className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black ${getScoreBarClass(forecast.score)}`}
                            style={{ left: scorePosition }}
                        />
                    </div>
                    <p className="mt-2 text-xs text-gray-500">Composite score: {forecast.score.toFixed(3)}</p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {forecast.scenarios.map((scenario) => (
                        <article key={scenario.horizonDays} className="rounded-xl border border-gray-800 bg-black/20 p-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-base font-semibold text-white">{scenario.horizonDays} days</h3>
                                <span className="text-xs font-medium text-gray-400">
                                    P(up): {formatPct(scenario.probabilityAboveCurrent)}
                                </span>
                            </div>
                            <div className="mt-4 space-y-2 text-sm">
                                <div className="flex justify-between text-rose-300"><span>P10</span><span>{formatCurrency(scenario.p10)}</span></div>
                                <div className="flex justify-between text-gray-200"><span>Median</span><span>{formatCurrency(scenario.p50)}</span></div>
                                <div className="flex justify-between text-emerald-300"><span>P90</span><span>{formatCurrency(scenario.p90)}</span></div>
                                <div className="flex justify-between text-gray-400"><span>Expected</span><span>{scenario.expectedReturnPct.toFixed(1)}%</span></div>
                            </div>
                        </article>
                    ))}
                </div>

                <div className="rounded-xl border border-gray-800 bg-black/20 p-4">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">
                        Top weighted inputs
                    </h3>
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                        {sortedFactors.map((factor) => (
                            <div key={`${factor.group}-${factor.name}`} className="rounded-lg border border-gray-800 bg-black/20 p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium text-white">{factor.name}</p>
                                        <p className="mt-1 text-xs text-gray-500">{factor.group}</p>
                                    </div>
                                    <span className={factor.score >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                                        {factor.value}
                                    </span>
                                </div>
                                <p className="mt-2 text-xs text-gray-500">{factor.note}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <p className="text-sm font-medium text-amber-200">Model limitations</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-100/80">
                        {forecast.limitations.map((limitation) => (
                            <li key={limitation}>{limitation}</li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    );
}
