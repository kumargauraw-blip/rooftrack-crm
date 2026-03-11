const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const authenticate = require('../middleware/auth');
const crypto = require('crypto');

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
        const { name, type, subject, html_content, text_content } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Campaign name is required' });
        }

        const id = crypto.randomUUID();

        db.prepare(`
            INSERT INTO campaigns (id, name, type, subject, html_content, text_content)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, name, type || 'custom', subject || '', html_content || '', text_content || '');

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

        if (campaign.status !== 'draft') {
            return res.status(400).json({ success: false, error: 'Can only edit draft campaigns' });
        }

        const { name, type, subject, html_content, text_content } = req.body;

        const fields = [];
        const values = [];
        if (name !== undefined) { fields.push('name = ?'); values.push(name); }
        if (type !== undefined) { fields.push('type = ?'); values.push(type); }
        if (subject !== undefined) { fields.push('subject = ?'); values.push(subject); }
        if (html_content !== undefined) { fields.push('html_content = ?'); values.push(html_content); }
        if (text_content !== undefined) { fields.push('text_content = ?'); values.push(text_content); }

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

        const apiKey = process.env.SENDLAYER_API_KEY;
        const fromEmail = process.env.SENDLAYER_FROM_EMAIL;

        if (!apiKey || !fromEmail) {
            return res.status(500).json({ success: false, error: 'SendLayer API not configured. Set SENDLAYER_API_KEY and SENDLAYER_FROM_EMAIL.' });
        }

        // Mark campaign as sending
        db.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(req.params.id);

        // Respond immediately, process sends in background
        res.json({ success: true, data: { message: 'Campaign sending started', recipientCount: recipients.length } });

        // Send emails in background
        let sentCount = 0;
        let failedCount = 0;

        for (const recipient of recipients) {
            try {
                // Replace {{name}} placeholder
                const recipientName = recipient.name || 'Valued Customer';
                const htmlContent = (campaign.html_content || '').replace(/\{\{name\}\}/g, recipientName);
                const textContent = (campaign.text_content || '').replace(/\{\{name\}\}/g, recipientName);

                const response = await fetch('https://console.sendlayer.com/api/v1/email', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        From: { name: 'Dennis Harrison', email: fromEmail },
                        To: [{ name: recipientName, email: recipient.email }],
                        Subject: (campaign.subject || '').replace(/\{\{name\}\}/g, recipientName),
                        ContentType: 'HTML',
                        HTMLContent: htmlContent,
                        PlainContent: textContent
                    })
                });

                if (response.ok) {
                    db.prepare(
                        "UPDATE campaign_recipients SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
                    ).run(recipient.id);
                    sentCount++;
                } else {
                    const errorBody = await response.text();
                    db.prepare(
                        "UPDATE campaign_recipients SET status = 'failed', error_message = ? WHERE id = ?"
                    ).run(`HTTP ${response.status}: ${errorBody.substring(0, 200)}`, recipient.id);
                    failedCount++;
                }
            } catch (sendError) {
                db.prepare(
                    "UPDATE campaign_recipients SET status = 'failed', error_message = ? WHERE id = ?"
                ).run(sendError.message.substring(0, 200), recipient.id);
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

module.exports = router;
