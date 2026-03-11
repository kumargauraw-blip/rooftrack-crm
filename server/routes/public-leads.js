const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const crypto = require('crypto');

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

// POST /api/leads/public - public lead submission (no auth)
router.post('/', (req, res) => {
    try {
        // Honeypot check: if "website" field is filled, it's a bot
        if (req.body.website) {
            return res.json({ success: true, message: 'Thank you! We will contact you shortly.' });
        }

        // Rate limiting
        const ip = req.ip || req.connection.remoteAddress;
        if (isRateLimited(ip)) {
            return res.status(429).json({ success: false, error: 'Too many submissions. Please try again later.' });
        }

        const { name, phone, email, address, notes, source } = req.body;

        // Validate required fields
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Name is required.' });
        }
        if (!phone || !phone.trim()) {
            return res.status(400).json({ success: false, error: 'Phone is required.' });
        }

        const db = getDb();
        const id = crypto.randomUUID();

        db.prepare(`
            INSERT INTO leads (id, name, phone, email, address, notes, source_channel, status, priority, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'warm', datetime('now'))
        `).run(
            id,
            name.trim(),
            phone.trim(),
            email ? email.trim() : null,
            address ? address.trim() : null,
            notes ? notes.trim() : null,
            source || 'website'
        );

        db.prepare(`
            INSERT INTO interactions (id, lead_id, type, summary) VALUES (?, ?, 'system', ?)
        `).run(crypto.randomUUID(), id, `Lead submitted via ${source || 'website'}`);

        res.json({ success: true, message: 'Thank you! We will contact you shortly.' });
    } catch (error) {
        console.error('[PUBLIC LEAD ERROR]', error);
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
    }
});

module.exports = router;
