const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');

// NWS API configuration
const NWS_BASE = 'https://api.weather.gov';
const NWS_HEADERS = {
    'User-Agent': 'RoofTrackCRM/1.0 (contact@honestroof.com)',
    'Accept': 'application/geo+json',
};
const DFW_POINT = '32.8998,-97.0403';
const DFW_GRID = 'FWD/80,109';

// DFW area forecast zones (counties within ~50 miles)
const DFW_ZONES = [
    'TXZ100', 'TXZ101', 'TXZ102', 'TXZ103', 'TXZ104',
    'TXZ119', 'TXZ120', 'TXZ121', 'TXZ130', 'TXZ131',
];

// In-memory cache
const cache = {
    alerts: { data: null, timestamp: 0 },
    forecast: { data: null, timestamp: 0 },
};
const ALERTS_TTL = 15 * 60 * 1000;   // 15 minutes
const FORECAST_TTL = 60 * 60 * 1000; // 1 hour

async function fetchNWS(url) {
    const res = await fetch(url, { headers: NWS_HEADERS });
    if (!res.ok) {
        throw new Error(`NWS API ${res.status}: ${res.statusText}`);
    }
    return res.json();
}

function isCacheValid(entry, ttl) {
    return entry.data && (Date.now() - entry.timestamp < ttl);
}

// -------------------------------------------------------------------
// GET /api/weather/alerts — Active NWS alerts for DFW area
// -------------------------------------------------------------------
router.get('/alerts', authenticate, async (req, res) => {
    try {
        if (isCacheValid(cache.alerts, ALERTS_TTL)) {
            return res.json({ success: true, data: cache.alerts.data, cached: true });
        }

        const raw = await fetchNWS(`${NWS_BASE}/alerts/active?point=${DFW_POINT}`);
        const alerts = (raw.features || []).map(f => {
            const p = f.properties;
            return {
                id: p.id,
                event: p.event,
                severity: p.severity,       // Extreme, Severe, Moderate, Minor, Unknown
                certainty: p.certainty,
                urgency: p.urgency,
                headline: p.headline,
                description: p.description,
                instruction: p.instruction,
                areaDesc: p.areaDesc,
                onset: p.onset,
                expires: p.expires,
                senderName: p.senderName,
            };
        });

        cache.alerts = { data: alerts, timestamp: Date.now() };
        res.json({ success: true, data: alerts, cached: false });
    } catch (err) {
        console.error('Weather alerts fetch error:', err.message);
        // Return stale cache if available
        if (cache.alerts.data) {
            return res.json({ success: true, data: cache.alerts.data, cached: true, stale: true });
        }
        res.status(502).json({ success: false, error: 'Weather data unavailable' });
    }
});

// -------------------------------------------------------------------
// GET /api/weather/forecast — 7-day forecast for DFW
// -------------------------------------------------------------------
router.get('/forecast', authenticate, async (req, res) => {
    try {
        if (isCacheValid(cache.forecast, FORECAST_TTL)) {
            return res.json({ success: true, data: cache.forecast.data, cached: true });
        }

        const raw = await fetchNWS(`${NWS_BASE}/gridpoints/${DFW_GRID}/forecast`);
        const periods = (raw.properties?.periods || []).map(p => ({
            number: p.number,
            name: p.name,
            startTime: p.startTime,
            endTime: p.endTime,
            isDaytime: p.isDaytime,
            temperature: p.temperature,
            temperatureUnit: p.temperatureUnit,
            windSpeed: p.windSpeed,
            windDirection: p.windDirection,
            shortForecast: p.shortForecast,
            detailedForecast: p.detailedForecast,
            probabilityOfPrecipitation: p.probabilityOfPrecipitation?.value ?? null,
            icon: p.icon,
        }));

        cache.forecast = { data: periods, timestamp: Date.now() };
        res.json({ success: true, data: periods, cached: false });
    } catch (err) {
        console.error('Weather forecast fetch error:', err.message);
        if (cache.forecast.data) {
            return res.json({ success: true, data: cache.forecast.data, cached: true, stale: true });
        }
        res.status(502).json({ success: false, error: 'Weather data unavailable' });
    }
});

// -------------------------------------------------------------------
// GET /api/weather/storm-risk — Aggregated 7-day storm risk assessment
// -------------------------------------------------------------------
router.get('/storm-risk', authenticate, async (req, res) => {
    try {
        // Fetch alerts + forecast (use cache-aware helpers)
        let alerts, forecast;

        if (isCacheValid(cache.alerts, ALERTS_TTL)) {
            alerts = cache.alerts.data;
        } else {
            try {
                const raw = await fetchNWS(`${NWS_BASE}/alerts/active?point=${DFW_POINT}`);
                alerts = (raw.features || []).map(f => {
                    const p = f.properties;
                    return {
                        id: p.id, event: p.event, severity: p.severity,
                        headline: p.headline, description: p.description,
                        areaDesc: p.areaDesc, onset: p.onset, expires: p.expires,
                    };
                });
                cache.alerts = { data: alerts, timestamp: Date.now() };
            } catch {
                alerts = cache.alerts.data || [];
            }
        }

        if (isCacheValid(cache.forecast, FORECAST_TTL)) {
            forecast = cache.forecast.data;
        } else {
            try {
                const raw = await fetchNWS(`${NWS_BASE}/gridpoints/${DFW_GRID}/forecast`);
                forecast = (raw.properties?.periods || []).map(p => ({
                    number: p.number, name: p.name,
                    startTime: p.startTime, endTime: p.endTime,
                    isDaytime: p.isDaytime, temperature: p.temperature,
                    temperatureUnit: p.temperatureUnit,
                    windSpeed: p.windSpeed, windDirection: p.windDirection,
                    shortForecast: p.shortForecast,
                    detailedForecast: p.detailedForecast,
                    probabilityOfPrecipitation: p.probabilityOfPrecipitation?.value ?? null,
                }));
                cache.forecast = { data: forecast, timestamp: Date.now() };
            } catch {
                forecast = cache.forecast.data || [];
            }
        }

        // Build 7-day risk assessment
        const days = buildDailyRisk(alerts, forecast);

        res.json({
            success: true,
            data: {
                days,
                alertCount: alerts.length,
                lastUpdated: new Date().toISOString(),
            },
        });
    } catch (err) {
        console.error('Storm risk assessment error:', err.message);
        res.status(502).json({ success: false, error: 'Weather data unavailable' });
    }
});

// -------------------------------------------------------------------
// Risk calculation helpers
// -------------------------------------------------------------------
const RISK_LEVELS = {
    none:     { level: 0, color: '#22c55e', label: 'None' },
    low:      { level: 1, color: '#eab308', label: 'Low' },
    moderate: { level: 2, color: '#f97316', label: 'Moderate' },
    high:     { level: 3, color: '#ef4444', label: 'High' },
    extreme:  { level: 4, color: '#a855f7', label: 'Extreme' },
};

function classifyAlert(event) {
    const e = (event || '').toLowerCase();
    if (e.includes('tornado warning') || e.includes('tornado emergency')) return 'extreme';
    if (e.includes('severe thunderstorm warning') || e.includes('hail')) return 'extreme';
    if (e.includes('tornado watch') || e.includes('severe thunderstorm watch')) return 'high';
    if (e.includes('flash flood') || e.includes('flood warning')) return 'high';
    if (e.includes('wind advisory') || e.includes('flood watch')) return 'moderate';
    if (e.includes('winter') || e.includes('ice') || e.includes('freeze')) return 'moderate';
    return 'low';
}

function classifyForecast(shortForecast) {
    const f = (shortForecast || '').toLowerCase();
    if (f.includes('severe') || f.includes('tornado')) return 'high';
    if (f.includes('thunderstorm') || f.includes('storm') || f.includes('t-storm')) return 'moderate';
    if (f.includes('rain') || f.includes('shower') || f.includes('drizzle')) return 'low';
    return 'none';
}

function pickEmoji(shortForecast, riskKey) {
    const f = (shortForecast || '').toLowerCase();
    if (riskKey === 'extreme') return '🌪️';
    if (f.includes('tornado')) return '🌪️';
    if (f.includes('thunderstorm') || f.includes('t-storm') || f.includes('storm')) return '⛈️';
    if (f.includes('rain') || f.includes('shower')) return '🌧️';
    if (f.includes('snow') || f.includes('ice') || f.includes('sleet')) return '❄️';
    if (f.includes('partly') || f.includes('mostly cloudy')) return '⛅';
    if (f.includes('cloud')) return '🌤️';
    return '☀️';
}

function buildDailyRisk(alerts, forecast) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });

        // Find matching daytime forecast period
        const dayForecast = (forecast || []).find(p => {
            if (!p.startTime) return false;
            const pDate = p.startTime.split('T')[0];
            return pDate === dateStr && p.isDaytime;
        });

        // Find matching nighttime forecast period
        const nightForecast = (forecast || []).find(p => {
            if (!p.startTime) return false;
            const pDate = p.startTime.split('T')[0];
            return pDate === dateStr && !p.isDaytime;
        });

        // Find alerts active on this date
        const dayAlerts = (alerts || []).filter(a => {
            const onset = a.onset ? new Date(a.onset) : null;
            const expires = a.expires ? new Date(a.expires) : null;
            const dayStart = new Date(date);
            const dayEnd = new Date(date);
            dayEnd.setDate(dayEnd.getDate() + 1);

            if (onset && expires) {
                return onset < dayEnd && expires > dayStart;
            }
            if (onset) return onset < dayEnd && onset >= dayStart;
            return false;
        });

        // Determine highest risk
        let riskKey = 'none';
        let maxLevel = 0;

        for (const a of dayAlerts) {
            const k = classifyAlert(a.event);
            if (RISK_LEVELS[k].level > maxLevel) {
                maxLevel = RISK_LEVELS[k].level;
                riskKey = k;
            }
        }

        if (dayForecast) {
            const fk = classifyForecast(dayForecast.shortForecast);
            if (RISK_LEVELS[fk].level > maxLevel) {
                maxLevel = RISK_LEVELS[fk].level;
                riskKey = fk;
            }
        }

        const risk = RISK_LEVELS[riskKey];
        const shortForecast = dayForecast?.shortForecast || '';

        days.push({
            date: dateStr,
            dayName: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayName,
            riskLevel: risk.label,
            riskKey,
            riskColor: risk.color,
            emoji: pickEmoji(shortForecast, riskKey),
            summary: shortForecast || 'No forecast available',
            temperature: dayForecast?.temperature ?? null,
            temperatureUnit: dayForecast?.temperatureUnit ?? 'F',
            temperatureNight: nightForecast?.temperature ?? null,
            windSpeed: dayForecast?.windSpeed || '',
            windDirection: dayForecast?.windDirection || '',
            precipChance: dayForecast?.probabilityOfPrecipitation ?? null,
            detailedForecast: dayForecast?.detailedForecast || '',
            alerts: dayAlerts.map(a => ({
                event: a.event,
                severity: a.severity,
                headline: a.headline,
                description: a.description,
            })),
        });
    }

    return days;
}

module.exports = router;
