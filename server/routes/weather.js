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

// DFW area forecast zones mapped to counties, cities, and zip codes
const DFW_ZONES = {
    'TXZ100': { county: 'Tarrant', cities: ['Fort Worth', 'Arlington', 'Euless', 'Bedford', 'Hurst', 'Colleyville', 'Keller'], zips: ['76101-76140', '76001-76020', '76039-76040', '76021-76022', '76053', '76034', '76248'] },
    'TXZ103': { county: 'Dallas', cities: ['Dallas', 'Irving', 'Grand Prairie', 'Cedar Hill', 'Lancaster'], zips: ['75201-75398', '75038-75063', '75050-75054', '75104', '75134-75146'] },
    'TXZ104': { county: 'Collin', cities: ['Plano', 'McKinney', 'Allen', 'Frisco', 'Prosper'], zips: ['75023-75025', '75069-75071', '75002-75013', '75033-75036', '75078'] },
    'TXZ102': { county: 'Denton', cities: ['Denton', 'Lewisville', 'Flower Mound', 'Little Elm', 'Corinth'], zips: ['76201-76210', '75067', '75022-75028', '75068', '76210'] },
    'TXZ118': { county: 'Tarrant South', cities: ['Mansfield', 'Kennedale', 'Burleson'], zips: ['76063', '76060', '76028'] },
    'TXZ119': { county: 'Johnson', cities: ['Burleson', 'Cleburne'], zips: ['76028', '76031-76033'] },
    'TXZ091': { county: 'Parker', cities: ['Weatherford'], zips: ['76086-76088'] },
    'TXZ116': { county: 'Kaufman', cities: ['Forney', 'Terrell'], zips: ['75126', '75160'] },
    'TXZ117': { county: 'Rockwall', cities: ['Rockwall'], zips: ['75087', '75032'] },
    'TXZ092': { county: 'Wise', cities: ['Decatur'], zips: ['76234'] },
    'TXZ101': { county: 'Ellis', cities: ['Waxahachie', 'Midlothian'], zips: ['75165', '76065'] },
};
const DFW_ZONE_IDS = Object.keys(DFW_ZONES);

// In-memory cache
const cache = {
    alerts: { data: null, timestamp: 0 },
    forecast: { data: null, timestamp: 0 },
};
const ALERTS_TTL = 12 * 60 * 60 * 1000;   // 12 hours (refresh twice daily: 5 AM and 5 PM)
const FORECAST_TTL = 12 * 60 * 60 * 1000; // 12 hours

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
            const affectedAreas = mapAlertToAreas(p.geocode?.UGC || [], p.areaDesc);
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
                affectedAreas,
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
                    const affectedAreas = mapAlertToAreas(p.geocode?.UGC || [], p.areaDesc);
                    return {
                        id: p.id, event: p.event, severity: p.severity,
                        headline: p.headline, description: p.description,
                        areaDesc: p.areaDesc, onset: p.onset, expires: p.expires,
                        affectedAreas,
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
// Zone-to-area mapping helper
// -------------------------------------------------------------------
function mapAlertToAreas(ugcCodes, areaDesc) {
    const matched = [];
    // Try matching UGC codes first
    for (const code of ugcCodes) {
        if (DFW_ZONES[code]) {
            matched.push({ zone: code, ...DFW_ZONES[code] });
        }
    }
    // If no UGC match, try matching county names from areaDesc
    if (matched.length === 0 && areaDesc) {
        const desc = areaDesc.toLowerCase();
        for (const [zone, info] of Object.entries(DFW_ZONES)) {
            if (desc.includes(info.county.toLowerCase())) {
                matched.push({ zone, ...info });
            }
        }
    }
    // If still no match, return all DFW areas (area-wide alert)
    if (matched.length === 0) {
        return Object.entries(DFW_ZONES).map(([zone, info]) => ({ zone, ...info }));
    }
    return matched;
}

function getAllDFWAreas() {
    return Object.entries(DFW_ZONES).map(([zone, info]) => ({ zone, ...info }));
}

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

        // Determine affected areas
        let affectedAreas = [];
        if (dayAlerts.length > 0) {
            // Collect unique areas from alert-specific zones
            const seenZones = new Set();
            for (const a of dayAlerts) {
                for (const area of (a.affectedAreas || [])) {
                    if (!seenZones.has(area.zone)) {
                        seenZones.add(area.zone);
                        affectedAreas.push(area);
                    }
                }
            }
        }
        // For moderate+ risk with no alert-specific areas, show all DFW areas
        if (affectedAreas.length === 0 && RISK_LEVELS[riskKey].level >= 2) {
            affectedAreas = getAllDFWAreas();
        }

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
            affectedAreas,
            alerts: dayAlerts.map(a => ({
                event: a.event,
                severity: a.severity,
                headline: a.headline,
                description: a.description,
                affectedAreas: a.affectedAreas || [],
            })),
        });
    }

    return days;
}

module.exports = router;
