const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const authenticate = require('../middleware/auth');
const crypto = require('crypto');
const { sendEmail, renderTemplate } = require('../lib/email');

// GET /api/campaigns - list all campaigns
router.get('/', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaigns = db.prepare(`
            SELECT c.*,
                (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = c.id) as recipient_count
            FROM campaigns c
            ORDER BY c.created_at DESC
        `).all();

        res.json({ success: true, data: campaigns });
    } catch (error) {
        console.error('[CAMPAIGNS LIST ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to fetch campaigns', message: error.message });
    }
});

// GET /api/campaigns/:id - get campaign detail with recipients
router.get('/:id', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);

        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }

        const recipients = db.prepare(`
            SELECT cr.*, l.phone, l.status as lead_status
            FROM campaign_recipients cr
            LEFT JOIN leads l ON cr.lead_id = l.id
            WHERE cr.campaign_id = ?
            ORDER BY cr.name
        `).all(req.params.id);

        res.json({ success: true, data: { ...campaign, recipients } });
    } catch (error) {
        console.error('[CAMPAIGN DETAIL ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to fetch campaign', message: error.message });
    }
});

// POST /api/campaigns - create new campaign
router.post('/', authenticate, (req, res) => {
    try {
        const db = getDb();
        const { name, type, subject, html_content, text_content, trigger_event, from_name, from_email } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Campaign name is required' });
        }

        const id = crypto.randomUUID();

        db.prepare(`
            INSERT INTO campaigns (id, name, type, subject, html_content, text_content, trigger_event, from_name, from_email)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            name,
            type || 'custom',
            subject || '',
            html_content || '',
            text_content || '',
            trigger_event || null,
            from_name || null,
            from_email || null,
        );

        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
        res.json({ success: true, data: campaign });
    } catch (error) {
        console.error('[CAMPAIGN CREATE ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to create campaign', message: error.message });
    }
});

// PUT /api/campaigns/:id - update campaign
router.put('/:id', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);

        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }

        // Autoresponders (trigger_event set) can be edited any time.
        // Manual one-shot campaigns can only be edited while still draft.
        if (!campaign.trigger_event && campaign.status !== 'draft') {
            return res.status(400).json({ success: false, error: 'Can only edit draft campaigns' });
        }

        const { name, type, subject, html_content, text_content, from_name, from_email } = req.body;

        const fields = [];
        const values = [];
        if (name !== undefined) { fields.push('name = ?'); values.push(name); }
        if (type !== undefined) { fields.push('type = ?'); values.push(type); }
        if (subject !== undefined) { fields.push('subject = ?'); values.push(subject); }
        if (html_content !== undefined) { fields.push('html_content = ?'); values.push(html_content); }
        if (text_content !== undefined) { fields.push('text_content = ?'); values.push(text_content); }
        if (from_name !== undefined) { fields.push('from_name = ?'); values.push(from_name); }
        if (from_email !== undefined) { fields.push('from_email = ?'); values.push(from_email); }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        values.push(req.params.id);
        db.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`).run(...values);

        const updated = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('[CAMPAIGN UPDATE ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to update campaign', message: error.message });
    }
});

// DELETE /api/campaigns/:id - delete campaign (draft only)
router.delete('/:id', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);

        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }

        if (campaign.status !== 'draft') {
            return res.status(400).json({ success: false, error: 'Can only delete draft campaigns' });
        }

        db.prepare('DELETE FROM campaign_recipients WHERE campaign_id = ?').run(req.params.id);
        db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);

        res.json({ success: true });
    } catch (error) {
        console.error('[CAMPAIGN DELETE ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to delete campaign', message: error.message });
    }
});

// POST /api/campaigns/:id/recipients - add recipients with filters
router.post('/:id/recipients', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);

        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }

        if (campaign.status !== 'draft') {
            return res.status(400).json({ success: false, error: 'Can only add recipients to draft campaigns' });
        }

        const { filter, statusValue, cityValue, leadIds } = req.body;

        let leads;
        if (filter === 'custom' && leadIds && leadIds.length > 0) {
            const placeholders = leadIds.map(() => '?').join(',');
            leads = db.prepare(`
                SELECT id, name, email FROM leads
                WHERE id IN (${placeholders}) AND email IS NOT NULL AND email != '' AND deleted_at IS NULL
            `).all(...leadIds);
        } else if (filter === 'status' && statusValue) {
            leads = db.prepare(`
                SELECT id, name, email FROM leads
                WHERE status = ? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL
            `).all(statusValue);
        } else if (filter === 'city' && cityValue) {
            leads = db.prepare(`
                SELECT id, name, email FROM leads
                WHERE city = ? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL
            `).all(cityValue);
        } else {
            // 'all' - all leads with email
            leads = db.prepare(`
                SELECT id, name, email FROM leads
                WHERE email IS NOT NULL AND email != '' AND deleted_at IS NULL
            `).all();
        }

        // Get existing recipient lead_ids for this campaign to avoid duplicates
        const existing = db.prepare(
            'SELECT lead_id FROM campaign_recipients WHERE campaign_id = ?'
        ).all(req.params.id).map(r => r.lead_id);

        const insertStmt = db.prepare(`
            INSERT INTO campaign_recipients (id, campaign_id, lead_id, email, name)
            VALUES (?, ?, ?, ?, ?)
        `);

        let added = 0;
        const insertMany = db.transaction((leads) => {
            for (const lead of leads) {
                if (existing.includes(lead.id)) continue;
                insertStmt.run(crypto.randomUUID(), req.params.id, lead.id, lead.email, lead.name);
                added++;
            }
        });

        insertMany(leads);

        // Update total_recipients count
        const count = db.prepare('SELECT COUNT(*) as cnt FROM campaign_recipients WHERE campaign_id = ?').get(req.params.id);
        db.prepare('UPDATE campaigns SET total_recipients = ? WHERE id = ?').run(count.cnt, req.params.id);

        res.json({ success: true, data: { added, total: count.cnt } });
    } catch (error) {
        console.error('[CAMPAIGN RECIPIENTS ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to add recipients', message: error.message });
    }
});

// POST /api/campaigns/:id/send - send the campaign
router.post('/:id/send', authenticate, async (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);

        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }

        if (campaign.status !== 'draft') {
            return res.status(400).json({ success: false, error: 'Campaign has already been sent' });
        }

        const recipients = db.prepare(
            'SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = ?'
        ).all(req.params.id, 'pending');

        if (recipients.length === 0) {
            return res.status(400).json({ success: false, error: 'No recipients to send to' });
        }

        // Mark campaign as sending
        db.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(req.params.id);

        // Respond immediately, process sends in background
        res.json({ success: true, data: { message: 'Campaign sending started', recipientCount: recipients.length } });

        // Send emails in background via shared helper (always BCCs Dennis).
        let sentCount = 0;
        let failedCount = 0;

        for (const recipient of recipients) {
            const recipientName = recipient.name || 'Valued Customer';
            const vars = { name: recipientName, first_name: recipientName.split(' ')[0] || recipientName };
            const htmlContent = renderTemplate(campaign.html_content || '', vars);
            const textContent = renderTemplate(campaign.text_content || '', vars);
            const subject = renderTemplate(campaign.subject || '', vars);

            const result = await sendEmail({
                toEmail: recipient.email,
                toName: recipientName,
                subject,
                htmlContent,
                textContent,
                fromEmail: campaign.from_email || undefined,
                fromName: campaign.from_name || undefined,
            });

            if (result.ok) {
                db.prepare(
                    "UPDATE campaign_recipients SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
                ).run(recipient.id);
                sentCount++;
            } else {
                db.prepare(
                    "UPDATE campaign_recipients SET status = 'failed', error_message = ? WHERE id = ?"
                ).run((result.error || 'unknown').substring(0, 200), recipient.id);
                failedCount++;
            }

            // 200ms delay between sends
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Update campaign final stats
        db.prepare(`
            UPDATE campaigns
            SET status = ?, sent_count = ?, failed_count = ?, sent_at = datetime('now')
            WHERE id = ?
        `).run(failedCount === recipients.length ? 'failed' : 'sent', sentCount, failedCount, req.params.id);

    } catch (error) {
        console.error('[CAMPAIGN SEND ERROR]', error);
        // Only send error response if we haven't already responded
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Failed to send campaign', message: error.message });
        }
    }
});

// GET /api/campaigns/:id/recipients/preview - preview recipient count for a filter
router.get('/:id/recipients/preview', authenticate, (req, res) => {
    try {
        const db = getDb();
        const { filter, statusValue, cityValue } = req.query;

        let count;
        if (filter === 'status' && statusValue) {
            count = db.prepare(`
                SELECT COUNT(*) as cnt FROM leads
                WHERE status = ? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL
            `).get(statusValue).cnt;
        } else if (filter === 'city' && cityValue) {
            count = db.prepare(`
                SELECT COUNT(*) as cnt FROM leads
                WHERE city = ? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL
            `).get(cityValue).cnt;
        } else {
            count = db.prepare(`
                SELECT COUNT(*) as cnt FROM leads
                WHERE email IS NOT NULL AND email != '' AND deleted_at IS NULL
            `).get().cnt;
        }

        // Subtract already-added recipients
        const existing = db.prepare(
            'SELECT COUNT(*) as cnt FROM campaign_recipients cr JOIN leads l ON cr.lead_id = l.id WHERE cr.campaign_id = ?'
        ).get(req.params.id).cnt;

        res.json({ success: true, data: { matching: count, alreadyAdded: existing, newRecipients: Math.max(0, count - existing) } });
    } catch (error) {
        console.error('[CAMPAIGN PREVIEW ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to preview recipients', message: error.message });
    }
});

// POST /api/campaigns/:id/clone - clone a campaign as a new draft
router.post('/:id/clone', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);

        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }

        const newId = crypto.randomUUID();
        const newName = campaign.name + ' (Copy)';

        db.prepare(`
            INSERT INTO campaigns (id, name, type, subject, html_content, text_content, status, total_recipients, sent_count, failed_count)
            VALUES (?, ?, ?, ?, ?, ?, 'draft', 0, 0, 0)
        `).run(newId, newName, campaign.type, campaign.subject, campaign.html_content, campaign.text_content);

        const cloned = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(newId);
        res.json({ success: true, data: cloned });
    } catch (error) {
        console.error('[CAMPAIGN CLONE ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to clone campaign', message: error.message });
    }
});

// ──────────────────────────────────────────────────────────────────────────
// Autoresponder endpoints
// ──────────────────────────────────────────────────────────────────────────

// GET /api/campaigns/autoresponders - list all autoresponder campaigns
// (i.e. campaigns where trigger_event is set). Sorted active-first.
router.get('/autoresponders/list', authenticate, (req, res) => {
    try {
        const db = getDb();
        const rows = db.prepare(`
            SELECT * FROM campaigns
            WHERE trigger_event IS NOT NULL
            ORDER BY is_active DESC, created_at DESC
        `).all();
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('[AUTORESPONDER LIST ERROR]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/campaigns/autoresponders/active/:trigger - fetch the currently
// active autoresponder for a trigger (e.g. 'new_lead'). Returns null if none.
router.get('/autoresponders/active/:trigger', authenticate, (req, res) => {
    try {
        const db = getDb();
        const row = db.prepare(`
            SELECT * FROM campaigns
            WHERE trigger_event = ? AND is_active = 1
            ORDER BY created_at DESC
            LIMIT 1
        `).get(req.params.trigger);
        res.json({ success: true, data: row || null });
    } catch (error) {
        console.error('[AUTORESPONDER ACTIVE ERROR]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/campaigns/:id/activate - activate this campaign as THE autoresponder
// for its trigger_event, deactivating any other autoresponder on the same trigger.
router.post('/:id/activate', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
        if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
        if (!campaign.trigger_event) {
            return res.status(400).json({ success: false, error: 'Only autoresponder campaigns (with trigger_event) can be activated' });
        }

        // Deactivate all others on this trigger, then activate this one — atomically.
        const activate = db.transaction(() => {
            db.prepare('UPDATE campaigns SET is_active = 0 WHERE trigger_event = ?').run(campaign.trigger_event);
            db.prepare("UPDATE campaigns SET is_active = 1, status = 'sent' WHERE id = ?").run(req.params.id);
            // status 'sent' here is a bit of a misnomer but keeps list views tidy;
            // autoresponders aren't really "sent" as a batch, they fire per-lead.
        });
        activate();

        const updated = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('[AUTORESPONDER ACTIVATE ERROR]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/campaigns/:id/deactivate - mark this autoresponder inactive.
// Leaves status/content alone; lead ingestion simply stops firing it.
router.post('/:id/deactivate', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
        if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

        db.prepare("UPDATE campaigns SET is_active = 0, status = 'draft' WHERE id = ?").run(req.params.id);
        const updated = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('[AUTORESPONDER DEACTIVATE ERROR]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/campaigns/:id/test-send - send a one-off test of an autoresponder
// (or any campaign) to a supplied email. Always BCCs Dennis.
router.post('/:id/test-send', authenticate, async (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
        if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

        const { to_email, to_name } = req.body;
        if (!to_email) return res.status(400).json({ success: false, error: 'to_email is required' });

        const vars = {
            name: to_name || 'Valued Customer',
            first_name: (to_name || '').split(' ')[0] || 'there',
            phone: '555-555-5555',
            email: to_email,
            address: '123 Test Lane',
        };
        const subject = `[TEST] ${renderTemplate(campaign.subject || '', vars)}`;
        const htmlContent = renderTemplate(campaign.html_content || '', vars);
        const textContent = renderTemplate(campaign.text_content || '', vars);

        const result = await sendEmail({
            toEmail: to_email,
            toName: to_name,
            subject,
            htmlContent,
            textContent,
            fromEmail: campaign.from_email || undefined,
            fromName: campaign.from_name || undefined,
        });

        if (!result.ok) {
            return res.status(502).json({ success: false, error: result.error });
        }
        res.json({ success: true, data: { messageId: result.messageId } });
    } catch (error) {
        console.error('[CAMPAIGN TEST SEND ERROR]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
