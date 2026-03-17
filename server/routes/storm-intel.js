const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');

// DFW area forecast zones (same as weather.js)
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

// DFW bounding box
const DFW_BOUNDS = { latMin: 32.0, latMax: 33.7, lonMin: -98.2, lonMax: -96.2 };

// In-memory cache: key = date string, value = { data, timestamp }
const hailCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function formatDateYYMMDD(date) {
    const yy = String(date.getFullYear()).slice(2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
}

function isDFW(lat, lon) {
    return lat >= DFW_BOUNDS.latMin && lat <= DFW_BOUNDS.latMax &&
           lon >= DFW_BOUNDS.lonMin && lon <= DFW_BOUNDS.lonMax;
}

function findNearestZone(lat, lon) {
    // Zone approximate center coordinates
    const zoneCenters = {
        'TXZ100': { lat: 32.75, lon: -97.33 },  // Tarrant
        'TXZ103': { lat: 32.78, lon: -96.80 },  // Dallas
        'TXZ104': { lat: 33.20, lon: -96.63 },  // Collin
        'TXZ102': { lat: 33.21, lon: -97.13 },  // Denton
        'TXZ118': { lat: 32.56, lon: -97.14 },  // Tarrant South
        'TXZ119': { lat: 32.35, lon: -97.39 },  // Johnson
        'TXZ091': { lat: 32.76, lon: -97.80 },  // Parker
        'TXZ116': { lat: 32.60, lon: -96.30 },  // Kaufman
        'TXZ117': { lat: 32.93, lon: -96.46 },  // Rockwall
        'TXZ092': { lat: 33.28, lon: -97.59 },  // Wise
        'TXZ101': { lat: 32.39, lon: -96.85 },  // Ellis
    };

    let nearestZone = null;
    let minDist = Infinity;

    for (const [zone, center] of Object.entries(zoneCenters)) {
        const dist = Math.sqrt(
            Math.pow(lat - center.lat, 2) + Math.pow(lon - center.lon, 2)
        );
        if (dist < minDist) {
            minDist = dist;
            nearestZone = zone;
        }
    }

    return nearestZone;
}

function parseSPCCsv(csvText, dateStr) {
    const lines = csvText.split('\n');
    const reports = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Skip header lines - SPC CSV has a header row like "Time,Size,Location,County,State,Lat,Lon,Comments"
        // There may also be a line with just the word "Time" or column headers
        if (line.startsWith('Time') || line.startsWith('time')) continue;

        const parts = line.split(',');
        if (parts.length < 7) continue;

        const time = parts[0].trim();
        const size = parts[1].trim();
        const location = parts[2].trim();
        const county = parts[3].trim();
        const state = parts[4].trim();
        const lat = parseFloat(parts[5]);
        const lon = parseFloat(parts[6]);
        const comments = parts.slice(7).join(',').trim();

        if (isNaN(lat) || isNaN(lon)) continue;

        reports.push({ time, size, location, county, state, lat, lon, comments, date: dateStr });
    }

    return reports;
}

async function fetchHailReports(dateStr) {
    // Check cache
    const cached = hailCache.get(dateStr);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return cached.data;
    }

    const url = `https://www.spc.noaa.gov/climo/reports/${dateStr}_rpts_hail.csv`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'RoofTrackCRM/1.0 (contact@honestroof.com)' }
    });

    if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error(`SPC API ${res.status}: ${res.statusText}`);
    }

    const csvText = await res.text();
    const allReports = parseSPCCsv(csvText, dateStr);

    // Filter to Texas reports in DFW area
    const dfwReports = allReports
        .filter(r => r.state === 'TX' && isDFW(r.lat, r.lon))
        .map(r => {
            const zone = findNearestZone(r.lat, r.lon);
            const zoneInfo = zone ? DFW_ZONES[zone] : null;
            const hailSize = parseInt(r.size, 10) / 100; // Convert hundredths to inches

            return {
                date: r.date,
                time: r.time,
                hailSize,
                location: r.location,
                county: r.county,
                state: r.state,
                lat: r.lat,
                lon: r.lon,
                comments: r.comments,
                zone,
                zoneInfo: zoneInfo ? { county: zoneInfo.county, cities: zoneInfo.cities, zips: zoneInfo.zips } : null,
            };
        });

    hailCache.set(dateStr, { data: dfwReports, timestamp: Date.now() });
    return dfwReports;
}

// -------------------------------------------------------------------
// GET /api/storm-intel/hail-reports?date=YYMMDD
// -------------------------------------------------------------------
router.get('/hail-reports', authenticate, async (req, res) => {
    try {
        const dateStr = req.query.date || formatDateYYMMDD(new Date());
        const reports = await fetchHailReports(dateStr);

        res.json({ success: true, data: reports, date: dateStr });
    } catch (err) {
        console.error('Hail reports fetch error:', err.message);
        res.status(502).json({ success: false, error: 'SPC data unavailable' });
    }
});

// -------------------------------------------------------------------
// GET /api/storm-intel/hail-reports/recent — Last 3 days
// -------------------------------------------------------------------
router.get('/hail-reports/recent', authenticate, async (req, res) => {
    try {
        const dates = [];
        for (let i = 0; i < 3; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dates.push(formatDateYYMMDD(d));
        }

        const results = await Promise.all(dates.map(d => fetchHailReports(d)));
        const combined = results.flat().sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            return b.time.localeCompare(a.time);
        });

        res.json({ success: true, data: combined, dates });
    } catch (err) {
        console.error('Recent hail reports fetch error:', err.message);
        res.status(502).json({ success: false, error: 'SPC data unavailable' });
    }
});

// -------------------------------------------------------------------
// GET /api/storm-intel/swath-summary — Grouped by zone
// -------------------------------------------------------------------
router.get('/swath-summary', authenticate, async (req, res) => {
    try {
        // Fetch last 3 days
        const dates = [];
        for (let i = 0; i < 3; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dates.push(formatDateYYMMDD(d));
        }

        const results = await Promise.all(dates.map(d => fetchHailReports(d)));
        const allReports = results.flat();

        // Group by zone
        const zoneMap = new Map();
        for (const report of allReports) {
            if (!report.zone) continue;
            if (!zoneMap.has(report.zone)) {
                zoneMap.set(report.zone, {
                    zone: report.zone,
                    county: report.zoneInfo?.county || report.county,
                    cities: report.zoneInfo?.cities || [],
                    zips: report.zoneInfo?.zips || [],
                    reportCount: 0,
                    maxHailSize: 0,
                    latestReport: null,
                    reports: [],
                });
            }
            const entry = zoneMap.get(report.zone);
            entry.reportCount++;
            if (report.hailSize > entry.maxHailSize) {
                entry.maxHailSize = report.hailSize;
            }
            if (!entry.latestReport || report.date > entry.latestReport.date ||
                (report.date === entry.latestReport.date && report.time > entry.latestReport.time)) {
                entry.latestReport = { date: report.date, time: report.time };
            }
            entry.reports.push(report);
        }

        const summary = Array.from(zoneMap.values()).sort((a, b) => b.maxHailSize - a.maxHailSize);

        res.json({ success: true, data: summary, dates });
    } catch (err) {
        console.error('Swath summary fetch error:', err.message);
        res.status(502).json({ success: false, error: 'SPC data unavailable' });
    }
});

module.exports = router;
