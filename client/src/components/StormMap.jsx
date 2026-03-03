import { useState } from 'react';
import { useStormRisk } from '../hooks/useWeather';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CloudLightning, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

const RISK_BG = {
    none: 'bg-green-500/20 border-green-500/40',
    low: 'bg-yellow-500/20 border-yellow-500/40',
    moderate: 'bg-orange-500/20 border-orange-500/40',
    high: 'bg-red-500/20 border-red-500/40',
    extreme: 'bg-purple-500/20 border-purple-500/40',
};

const RISK_TEXT = {
    none: 'text-green-400',
    low: 'text-yellow-400',
    moderate: 'text-orange-400',
    high: 'text-red-400',
    extreme: 'text-purple-400',
};

const RISK_BADGE = {
    none: 'bg-green-500/30 text-green-300 border-green-500/50',
    low: 'bg-yellow-500/30 text-yellow-300 border-yellow-500/50',
    moderate: 'bg-orange-500/30 text-orange-300 border-orange-500/50',
    high: 'bg-red-500/30 text-red-300 border-red-500/50',
    extreme: 'bg-purple-500/30 text-purple-300 border-purple-500/50',
};

const ALERT_SEVERITY = {
    Extreme: 'bg-red-600 text-white',
    Severe: 'bg-red-500 text-white',
    Moderate: 'bg-orange-500 text-white',
    Minor: 'bg-yellow-500 text-black',
    Unknown: 'bg-gray-500 text-white',
};

function timeAgo(isoString) {
    if (!isoString) return '';
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
}

export default function StormMap() {
    const { data, isLoading, isError, dataUpdatedAt } = useStormRisk();
    const queryClient = useQueryClient();
    const [selectedDay, setSelectedDay] = useState(0);
    const [expandedAlerts, setExpandedAlerts] = useState({});
    const [refreshing, setRefreshing] = useState(false);

    const handleRefresh = async () => {
        setRefreshing(true);
        await queryClient.invalidateQueries({ queryKey: ['storm-risk'] });
        setTimeout(() => setRefreshing(false), 1000);
    };

    const toggleAlert = (idx) => {
        setExpandedAlerts(prev => ({ ...prev, [idx]: !prev[idx] }));
    };

    // Loading state
    if (isLoading) {
        return (
            <Card className="col-span-4">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <CloudLightning className="h-5 w-5" />
                        DFW Storm Forecast
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-[280px] flex items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Loading weather data...</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // Error / unavailable state
    if (isError || !data?.days) {
        return (
            <Card className="col-span-4">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <CloudLightning className="h-5 w-5" />
                        DFW Storm Forecast
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-[280px] flex items-center justify-center">
                        <div className="flex flex-col items-center gap-3 text-center">
                            <AlertTriangle className="h-8 w-8 text-yellow-500" />
                            <p className="text-sm text-muted-foreground">Weather data unavailable</p>
                            <button
                                onClick={handleRefresh}
                                className="text-xs text-blue-400 hover:text-blue-300 underline"
                            >
                                Try again
                            </button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const { days, alertCount, lastUpdated } = data;
    const day = days[selectedDay];

    // Collect all active alerts across all days (deduplicated)
    const allAlerts = [];
    const seenAlerts = new Set();
    for (const d of days) {
        for (const a of d.alerts) {
            const key = a.headline || a.event;
            if (!seenAlerts.has(key)) {
                seenAlerts.add(key);
                allAlerts.push(a);
            }
        }
    }

    return (
        <Card className="col-span-4">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="flex items-center gap-2">
                    <CloudLightning className="h-5 w-5" />
                    DFW Storm Forecast
                </CardTitle>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        Updated {timeAgo(lastUpdated)}
                    </span>
                    <button
                        onClick={handleRefresh}
                        className="p-1 rounded hover:bg-accent transition-colors"
                        title="Refresh weather data"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* 7-Day Storm Risk Bar */}
                <div className="grid grid-cols-7 gap-1.5">
                    {days.map((d, i) => (
                        <button
                            key={d.date}
                            onClick={() => setSelectedDay(i)}
                            className={`
                                relative flex flex-col items-center gap-0.5 p-2 rounded-lg border transition-all cursor-pointer
                                ${RISK_BG[d.riskKey]}
                                ${selectedDay === i ? 'ring-2 ring-white/30 scale-[1.02]' : 'hover:scale-[1.01]'}
                            `}
                        >
                            <span className="text-[10px] font-medium text-muted-foreground">{d.dayName}</span>
                            <span className="text-xl leading-none">{d.emoji}</span>
                            <span className={`text-[10px] font-semibold ${RISK_TEXT[d.riskKey]}`}>
                                {d.riskLevel}
                            </span>
                            {d.temperature !== null && (
                                <span className="text-[10px] text-muted-foreground">
                                    {d.temperature}°
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Active Alerts */}
                {allAlerts.length > 0 && (
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                            <span className="text-xs font-semibold text-red-400">
                                {alertCount} Active Alert{alertCount !== 1 ? 's' : ''}
                            </span>
                        </div>
                        {allAlerts.map((alert, idx) => (
                            <div key={idx} className="rounded-md border border-red-500/30 bg-red-500/10 p-2">
                                <button
                                    onClick={() => toggleAlert(idx)}
                                    className="w-full flex items-center justify-between text-left"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${ALERT_SEVERITY[alert.severity] || ALERT_SEVERITY.Unknown}`}>
                                            {alert.severity}
                                        </span>
                                        <span className="text-xs font-medium truncate">
                                            {alert.event}
                                        </span>
                                    </div>
                                    {expandedAlerts[idx]
                                        ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                        : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    }
                                </button>
                                {alert.headline && (
                                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{alert.headline}</p>
                                )}
                                {expandedAlerts[idx] && alert.description && (
                                    <p className="text-[11px] text-muted-foreground mt-2 leading-snug whitespace-pre-line border-t border-red-500/20 pt-2">
                                        {alert.description.slice(0, 500)}{alert.description.length > 500 ? '...' : ''}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Selected Day Detail */}
                {day && (
                    <div className="rounded-lg border bg-accent/30 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">{day.emoji}</span>
                                <span className="text-sm font-semibold">{day.dayName}</span>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${RISK_BADGE[day.riskKey]}`}>
                                    {day.riskLevel} Risk
                                </span>
                            </div>
                            {day.temperature !== null && (
                                <div className="text-right">
                                    <span className="text-lg font-bold">{day.temperature}°{day.temperatureUnit}</span>
                                    {day.temperatureNight !== null && (
                                        <span className="text-xs text-muted-foreground ml-1">/ {day.temperatureNight}°</span>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-xs">
                            {day.windSpeed && (
                                <div>
                                    <span className="text-muted-foreground">Wind</span>
                                    <p className="font-medium">{day.windDirection} {day.windSpeed}</p>
                                </div>
                            )}
                            {day.precipChance !== null && (
                                <div>
                                    <span className="text-muted-foreground">Precip</span>
                                    <p className="font-medium">{day.precipChance}%</p>
                                </div>
                            )}
                            <div>
                                <span className="text-muted-foreground">Forecast</span>
                                <p className="font-medium">{day.summary}</p>
                            </div>
                        </div>

                        {day.detailedForecast && (
                            <p className="text-[11px] text-muted-foreground leading-snug">
                                {day.detailedForecast}
                            </p>
                        )}

                        {/* Storm campaign suggestion for moderate+ risk */}
                        {['moderate', 'high', 'extreme'].includes(day.riskKey) && (
                            <div className="flex items-center gap-2 mt-1 p-2 rounded bg-orange-500/10 border border-orange-500/30">
                                <CloudLightning className="h-4 w-4 text-orange-400 shrink-0" />
                                <p className="text-[11px] text-orange-300">
                                    <span className="font-semibold">Storm Alert:</span> Consider launching a storm damage outreach campaign for {day.dayName.toLowerCase()}.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
