const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const crypto = require('crypto');
const { fireNewLeadAutoresponder } = require('../lib/autoresponder');

// In-memory rate limiting: max 5 submissions per IP per hour
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry) {
        rateLimitMap.set(ip, { timestamps: [now] });
        return false;
    }

    // Remove timestamps older than the window
    entry.timestamps = entry.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);

    if (entry.timestamps.length >= RATE_LIMIT_MAX) {
        return true;
    }

    entry.timestamps.push(now);
    return false;
}

// Periodically clean up stale entries (every 10 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        entry.timestamps = entry.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
        if (entry.timestamps.length === 0) {
            rateLimitMap.delete(ip);
        }
    }
}, 10 * 60 * 1000).unref();

/** Cap a string and coerce to null if empty after trim. */
function cleanStr(v, max = 500) {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
}

/**
 * Extract the subset of attribution fields we store as columns on `leads`.
 * Accepts an attribution object from the frontend (see honestroof-web/src/lib/attribution.ts).
 * Everything is length-capped and coerced to safe SQL types.
 */
function extractAttribution(attr) {
    if (!attr || typeof attr !== 'object') return {};
    return {
        heard_about: cleanStr(attr.heard_about, 64),
        heard_about_other: cleanStr(attr.heard_about_other, 200),
        utm_source: cleanStr(attr.utm_source, 128),
        utm_medium: cleanStr(attr.utm_medium, 128),
        utm_campaign: cleanStr(attr.utm_campaign, 200),
        utm_content: cleanStr(attr.utm_content, 200),
        utm_term: cleanStr(attr.utm_term, 200),
        gclid: attr.gclid ? 1 : 0,
        fbclid: attr.fbclid ? 1 : 0,
        msclkid: attr.msclkid ? 1 : 0,
        referrer: cleanStr(attr.referrer, 500),
        landing_page: cleanStr(attr.landing_page, 500),
        is_repeat: attr.is_repeat ? 1 : 0,
    };
}

// POST /api/leads/public - public lead submission (no auth).
// Server-to-server callers (e.g. the honestroof.com Next.js site) can
// include an `X-Internal-Key` header matching CRM_INTERNAL_API_KEY to
// bypass the honeypot + rate limit — those protections are meant for
// raw browser traffic, not a trusted upstream that already did its own
// spam filtering.
router.post('/', (req, res) => {
    try {
        // Trusted internal caller detection
        const providedKey = req.headers['x-internal-key'];
        const expectedKey = process.env.CRM_INTERNAL_API_KEY;
        const isTrustedInternal =
            expectedKey && providedKey && providedKey === expectedKey;

        if (!isTrustedInternal) {
            // Honeypot check: if "website" field is filled, it's a bot
            if (req.body.website) {
                return res.json({ success: true, message: 'Thank you! We will contact you shortly.' });
            }

            // Rate limiting — only applied to direct public traffic
            const ip = req.ip || req.connection.remoteAddress;
            if (isRateLimited(ip)) {
                return res.status(429).json({ success: false, error: 'Too many submissions. Please try again later.' });
            }
        }

        const { name, phone, email, address, notes, source, attribution } = req.body;

        // Validate required fields
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Name is required.' });
        }
        if (!phone || !phone.trim()) {
            return res.status(400).json({ success: false, error: 'Phone is required.' });
        }

        // Storm Damage File Builder leads are INFORMATIONAL, not estimate
        // requests. The homeowner used the free documentation tool; they did
        // not ask for a quote. So we file them under a distinct channel, mark
        // them low-priority (not a hot estimate lead), and never fire the
        // customer autoresponder for them (see below).
        const STORM_SOURCES = new Set([
            'DFW Storm Damage File Builder',
            'storm_damage_file',
        ]);
        const isStormInfoLead = STORM_SOURCES.has((source || '').trim());
        const sourceChannel = isStormInfoLead
            ? 'storm_damage_file'
            : source || 'website';
        const priority = isStormInfoLead ? 'cold' : 'warm';

        const db = getDb();
        const id = crypto.randomUUID();
        const attr = extractAttribution(attribution);

        db.prepare(`
            INSERT INTO leads (
                id, name, phone, email, address, notes, source_channel, status, priority, created_at,
                heard_about, heard_about_other,
                utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                gclid, fbclid, msclkid,
                referrer, landing_page, is_repeat
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, 'new', ?, datetime('now'),
                ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?
            )
        `).run(
            id,
            name.trim(),
            phone.trim(),
            email ? email.trim() : null,
            address ? address.trim() : null,
            notes ? notes.trim() : null,
            sourceChannel,
            priority,
            attr.heard_about, attr.heard_about_other,
            attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.utm_content, attr.utm_term,
            attr.gclid, attr.fbclid, attr.msclkid,
            attr.referrer, attr.landing_page, attr.is_repeat,
        );

        db.prepare(`
            INSERT INTO interactions (id, lead_id, type, summary) VALUES (?, ?, 'system', ?)
        `).run(
            crypto.randomUUID(),
            id,
            isStormInfoLead
                ? 'Informational lead — used the free Storm Damage File Builder (did NOT request an estimate). Potential soft follow-up.'
                : `Lead submitted via ${source || 'website'}`,
        );

        // Respond immediately to the website; autoresponder runs after
        res.json({ success: true, message: 'Thank you! We will contact you shortly.' });

        // The autoresponder is OPT-IN. Only fires when the caller explicitly
        // sends `_trigger_autoresponder: true`. The honestroof.com website
        // forms send this flag automatically. Manual recoveries (curl, ssh,
        // scripts, admin tools) just omit the flag and the autoresponder
        // stays silent — safer default for backfilling leads we already
        // contacted by phone/email.
        // Storm-info leads never get the estimate autoresponder, regardless
        // of the flag — they didn't ask for an estimate.
        const shouldTriggerAutoresponder =
            req.body._trigger_autoresponder === true && !isStormInfoLead;
        if (!shouldTriggerAutoresponder) {
            console.log(
                `[AUTORESPONDER] suppressed for lead ${id}` +
                    (isStormInfoLead ? ' (storm info lead)' : ' (no _trigger_autoresponder flag)'),
            );
            return;
        }

        // Fire-and-forget autoresponder. Wrap in setImmediate so an exception
        // in the async boundary can't poison the response that already went out.
        setImmediate(() => {
            fireNewLeadAutoresponder(db, {
                id,
                name: name.trim(),
                phone: phone.trim(),
                email: email ? email.trim() : null,
                address: address ? address.trim() : null,
            }).catch((err) => {
                console.error('[AUTORESPONDER] unhandled:', err);
            });
        });
    } catch (error) {
        console.error('[PUBLIC LEAD ERROR]', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
        }
    }
});

module.exports = router;
