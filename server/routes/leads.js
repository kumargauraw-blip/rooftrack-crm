const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const authenticate = require('../middleware/auth');
const crypto = require('crypto');
const { addDays, addWeeks, addMonths, nextDay, parse, format } = require('date-fns');

// ---- Status timestamp column mapping ----
const STATUS_DATE_COLUMNS = {
    contacted: 'contacted_at',
    scheduled: 'scheduled_at',
    quoted: 'quoted_at',
    accepted: 'accepted_at',
    completed: 'completed_at',
    paid: 'paid_at',
    review_received: 'review_received_at',
    lost: 'lost_at'
};

// ---- Smart note parsing for auto-appointments ----
function parseNotesForDates(notes, leadId, db) {
    if (!notes || typeof notes !== 'string') return [];

    const now = new Date();
    const appointments = [];

    // Pattern: "after X days" / "in X days"
    const afterDaysMatch = notes.match(/(?:after|in)\s+(\d+)\s+days?/i);
    if (afterDaysMatch) {
        const days = parseInt(afterDaysMatch[1]);
        const date = addDays(now, days);
        appointments.push({
            date: format(date, 'yyyy-MM-dd'),
            time: '10:00',
            note: afterDaysMatch[0]
        });
    }

    // Pattern: "in X week(s)" / "after X week(s)"
    const afterWeeksMatch = notes.match(/(?:after|in)\s+(\d+)\s+weeks?/i);
    if (afterWeeksMatch) {
        const weeks = parseInt(afterWeeksMatch[1]);
        const date = addWeeks(now, weeks);
        appointments.push({
            date: format(date, 'yyyy-MM-dd'),
            time: '10:00',
            note: afterWeeksMatch[0]
        });
    }

    // Pattern: "in X month(s)" / "after X month(s)"
    const afterMonthsMatch = notes.match(/(?:after|in)\s+(\d+)\s+months?/i);
    if (afterMonthsMatch) {
        const months = parseInt(afterMonthsMatch[1]);
        const date = addMonths(now, months);
        appointments.push({
            date: format(date, 'yyyy-MM-dd'),
            time: '10:00',
            note: afterMonthsMatch[0]
        });
    }

    // Pattern: "on March 3rd" / "on 3rd March" / "on March 3" / "on 3 March"
    const monthNames = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
        jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };

    // "on March 3rd" or "on March 3"
    const onMonthDayMatch = notes.match(/on\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
    if (onMonthDayMatch) {
        const month = monthNames[onMonthDayMatch[1].toLowerCase()];
        const day = parseInt(onMonthDayMatch[2]);
        let year = now.getFullYear();
        const date = new Date(year, month, day);
        if (date < now) date.setFullYear(year + 1);
        appointments.push({
            date: format(date, 'yyyy-MM-dd'),
            time: '10:00',
            note: onMonthDayMatch[0]
        });
    }

    // "on 3rd March" or "on 3 March"
    const onDayMonthMatch = notes.match(/on\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)/i);
    if (onDayMonthMatch && !onMonthDayMatch) {
        const day = parseInt(onDayMonthMatch[1]);
        const month = monthNames[onDayMonthMatch[2].toLowerCase()];
        let year = now.getFullYear();
        const date = new Date(year, month, day);
        if (date < now) date.setFullYear(year + 1);
        appointments.push({
            date: format(date, 'yyyy-MM-dd'),
            time: '10:00',
            note: onDayMonthMatch[0]
        });
    }

    // Pattern: "next Monday/Tuesday/etc"
    const dayNames = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
    };
    const nextDayMatch = notes.match(/next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i);
    if (nextDayMatch) {
        const targetDay = dayNames[nextDayMatch[1].toLowerCase()];
        const date = nextDay(now, targetDay);
        appointments.push({
            date: format(date, 'yyyy-MM-dd'),
            time: '10:00',
            note: nextDayMatch[0]
        });
    }

    // Pattern: "tomorrow"
    if (/\btomorrow\b/i.test(notes)) {
        const date = addDays(now, 1);
        appointments.push({
            date: format(date, 'yyyy-MM-dd'),
            time: '10:00',
            note: 'tomorrow'
        });
    }

    // Create the appointments in DB
    const created = [];
    for (const apt of appointments) {
        // Avoid duplicates - check if similar appointment already exists
        const existing = db.prepare(
            "SELECT id FROM appointments WHERE lead_id = ? AND scheduled_date = ? AND type = 'follow_up'"
        ).get(leadId, apt.date);

        if (!existing) {
            const aptId = crypto.randomUUID();
            db.prepare(`
                INSERT INTO appointments (id, lead_id, type, scheduled_date, scheduled_time, notes)
                VALUES (?, ?, 'follow_up', ?, ?, ?)
            `).run(aptId, leadId, apt.date, apt.time, `Auto-scheduled: "${apt.note}"`);

            db.prepare(`
                INSERT INTO interactions (id, lead_id, type, summary) VALUES (?, ?, 'system', ?)
            `).run(crypto.randomUUID(), leadId, `Auto-scheduled follow-up for ${apt.date} based on notes: "${apt.note}"`);

            created.push({ id: aptId, date: apt.date, note: apt.note });
        }
    }

    return created;
}

// ---- Ensure timestamp columns exist (migration) ----
function ensureTimestampColumns() {
    const db = getDb();
    const columns = [
        'contacted_at', 'scheduled_at', 'quoted_at', 'accepted_at',
        'completed_at', 'paid_at', 'review_received_at', 'lost_at'
    ];

    // Get existing columns
    const existingCols = db.prepare("PRAGMA table_info(leads)").all().map(c => c.name);

    for (const col of columns) {
        if (!existingCols.includes(col)) {
            db.exec(`ALTER TABLE leads ADD COLUMN ${col} TEXT`);
        }
    }
}

// ---- Ensure referral/lifecycle columns exist (migration) ----
function ensureLifecycleColumns() {
    const db = getDb();
    const newColumns = [
        { name: 'satisfaction_score', type: 'INTEGER' },
        { name: 'referred_by', type: 'TEXT' },
        { name: 'referral_source', type: 'TEXT' },
        { name: 'payment_date', type: 'TEXT' },
    ];

    const existingCols = db.prepare("PRAGMA table_info(leads)").all().map(c => c.name);

    for (const col of newColumns) {
        if (!existingCols.includes(col.name)) {
            db.exec(`ALTER TABLE leads ADD COLUMN ${col.name} ${col.type}`);
        }
    }
}

// Run migrations on module load
try {
    ensureTimestampColumns();
    ensureLifecycleColumns();
} catch (e) {
    // DB might not be initialized yet, will retry on first request
    console.log('Will retry column migrations on first request');
}

let migrationDone = false;

// GET all leads (with filters)
router.get('/', authenticate, (req, res) => {
    if (!migrationDone) {
        try { ensureTimestampColumns(); ensureLifecycleColumns(); migrationDone = true; } catch (e) { /* ignore */ }
    }
    const db = getDb();
    const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
    res.json({ success: true, data: leads });
});

// GET single lead details
router.get('/:id', authenticate, (req, res) => {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);

    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const interactions = db.prepare('SELECT * FROM interactions WHERE lead_id = ? ORDER BY created_at DESC').all(req.params.id);
    const appointments = db.prepare('SELECT * FROM appointments WHERE lead_id = ? ORDER BY scheduled_date DESC').all(req.params.id);
    const jobs = db.prepare('SELECT * FROM jobs WHERE lead_id = ? ORDER BY created_at DESC').all(req.params.id);

    res.json({
        success: true,
        data: { ...lead, interactions, appointments, jobs }
    });
});

// POST create lead
router.post('/', authenticate, (req, res) => {
    const db = getDb();
    const { name, phone, email, address, source_channel, notes, referred_by, referral_source } = req.body;
    const id = crypto.randomUUID();

    try {
        const stmt = db.prepare(`
            INSERT INTO leads (id, name, email, phone, address, source_channel, notes, referred_by, referral_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, name, email, phone, address, source_channel || 'manual', notes, referred_by || null, referral_source || null);

        db.prepare(`
            INSERT INTO interactions (id, lead_id, type, summary) VALUES (?, ?, 'system', 'Lead created manually')
        `).run(crypto.randomUUID(), id);

        // Auto-create referral incentive if referred_by is set
        if (referred_by) {
            db.prepare(`
                INSERT INTO referral_incentives (id, referrer_lead_id, referred_lead_id, incentive_type, incentive_value, status)
                VALUES (?, ?, ?, 'gift_card', 50.00, 'pending')
            `).run(crypto.randomUUID(), referred_by, id);
        }

        // Smart note parsing - auto-create appointments
        const autoAppointments = parseNotesForDates(notes, id, db);

        res.json({
            success: true,
            data: {
                id,
                message: 'Lead created',
                autoAppointments: autoAppointments.length > 0 ? autoAppointments : undefined
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Failed to create lead' });
    }
});

// PATCH update lead status (with timestamp tracking)
router.patch('/:id/status', authenticate, (req, res) => {
    try {
        if (!migrationDone) {
            try { ensureTimestampColumns(); ensureLifecycleColumns(); migrationDone = true; } catch (e) { /* ignore */ }
        }

        const db = getDb();
        if (!db) {
            return res.status(500).json({ success: false, error: 'Database not initialized' });
        }

        const status = req.body?.status;
        if (!status) {
            return res.status(400).json({ success: false, error: 'Status is required' });
        }

        // Build update query with status-specific timestamp
        const dateCol = STATUS_DATE_COLUMNS[status];
        if (dateCol) {
            db.prepare(`UPDATE leads SET status = ?, ${dateCol} = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(status, req.params.id);
        } else {
            db.prepare(`UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, req.params.id);
        }

        db.prepare(`
            INSERT INTO interactions (id, lead_id, type, summary) VALUES (?, ?, 'system', ?)
        `).run(crypto.randomUUID(), req.params.id, `Status changed to ${status}`);

        res.json({ success: true });
    } catch (error) {
        console.error('[STATUS UPDATE ERROR]', error);
        res.status(500).json({ success: false, error: 'Update failed', message: error.message });
    }
});

// PATCH update lead notes (with smart date parsing)
router.patch('/:id/notes', authenticate, (req, res) => {
    try {
        const db = getDb();
        if (!db) {
            return res.status(500).json({ success: false, error: 'Database not initialized' });
        }

        const notes = req.body?.notes;

        db.prepare("UPDATE leads SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(notes, req.params.id);

        db.prepare(`
            INSERT INTO interactions (id, lead_id, type, summary) VALUES (?, ?, 'system', 'Notes updated')
        `).run(crypto.randomUUID(), req.params.id);

        // Smart note parsing - auto-create appointments
        const autoAppointments = parseNotesForDates(notes, req.params.id, db);

        res.json({
            success: true,
            data: {
                message: 'Notes updated',
                autoAppointments: autoAppointments.length > 0 ? autoAppointments : undefined
            }
        });
    } catch (error) {
        console.error('[NOTES UPDATE ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to update notes', message: error.message });
    }
});

module.exports = router;
