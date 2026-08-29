const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const authenticate = require('../middleware/auth');
const crypto = require('crypto');
const { sendEmail, sendEmailWithRetry, renderTemplate } = require('../lib/email');

// SendLayer enforces a per-MINUTE sending rate, and exceeding it doesn't just
// reject the extra messages -- it blocks the whole account until the window
// resets. So the knob that matters is emails-per-minute, expressed the same way
// SendLayer expresses it, not an opaque millisecond delay.
//
// Set CAMPAIGN_EMAILS_PER_MINUTE to your plan's documented limit minus some
// headroom. The default is deliberately timid: a slow campaign that arrives is
// worth more than a fast one that gets the account blocked.
const EMAILS_PER_MINUTE = Number(process.env.CAMPAIGN_EMAILS_PER_MINUTE) || 30;
const SEND_DELAY_MS = Number(process.env.CAMPAIGN_SEND_DELAY_MS) || Math.ceil(60000 / EMAILS_PER_MINUTE);

// Once the account is blocked, every send fails no matter how we pace. Retrying
// each of 600 recipients through a full backoff ladder then wastes hours to
// deliver nothing, so give up after this many recipients fail back-to-back and
// leave the rest untouched for a later run.
const CONSECUTIVE_FAILURE_LIMIT = Number(process.env.CAMPAIGN_ABORT_AFTER_FAILURES) || 5;

// A 429 here means "blocked until the minute window resets", so the useful wait
// is roughly a window, not the couple of seconds that suits a transient 5xx.
const RATE_LIMIT_BACKOFF_MS = Number(process.env.CAMPAIGN_RATE_LIMIT_BACKOFF_MS) || 65000;

/**
 * Deliver every 'pending' recipient of a campaign. Shared by the initial send
 * and by retry-failed so both pace, retry and account identically.
 *
 * Counters are read from the campaign row and incremented, never overwritten:
 * a retry run must add to what the first run already delivered, not replace it.
 */
async function deliverCampaign(db, campaignId) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    const recipients = db.prepare(
        "SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending'"
    ).all(campaignId);

    let sentCount = campaign.sent_count || 0;
    let failedCount = campaign.failed_count || 0;
    let delivered = 0;
    let failed = 0;
    let rateLimited = 0;
    let consecutiveFailures = 0;
    let aborted = false;

    const markSent = db.prepare("UPDATE campaign_recipients SET status = 'sent', sent_at = datetime('now'), error_message = NULL WHERE id = ?");
    const markFailed = db.prepare("UPDATE campaign_recipients SET status = 'failed', error_message = ? WHERE id = ?");
    const bumpStats = db.prepare('UPDATE campaigns SET sent_count = ?, failed_count = ? WHERE id = ?');

    console.log(`[CAMPAIGN ${campaignId}] delivering ${recipients.length} recipient(s) at ${EMAILS_PER_MINUTE}/min (${SEND_DELAY_MS}ms spacing)`);

    for (const recipient of recipients) {
        const recipientName = recipient.name || 'Valued Customer';
        const vars = { name: recipientName, first_name: recipientName.split(' ')[0] || recipientName };

        const result = await sendEmailWithRetry({
            toEmail: recipient.email,
            toName: recipientName,
            subject: renderTemplate(campaign.subject || '', vars),
            htmlContent: renderTemplate(campaign.html_content || '', vars),
            textContent: renderTemplate(campaign.text_content || '', vars),
            fromEmail: campaign.from_email || undefined,
            fromName: campaign.from_name || undefined,
            // Bulk send: Dennis gets one summary at the end, not one copy per
            // recipient. See the summary block below.
            skipBcc: true,
        }, {
            retries: 2,
            baseDelay: RATE_LIMIT_BACKOFF_MS,
            onRetry: ({ attempt, waitMs, status }) => {
                if (status === 429) rateLimited++;
                console.warn(`[CAMPAIGN ${campaignId}] ${status} for ${recipient.email}, retry ${attempt} in ${Math.round(waitMs / 1000)}s`);
            },
        });

        if (result.ok) {
            markSent.run(recipient.id);
            sentCount++; delivered++;
            consecutiveFailures = 0;
        } else {
            markFailed.run((result.error || 'unknown').substring(0, 200), recipient.id);
            failedCount++; failed++;
            consecutiveFailures++;

            // Every send failing in a row means the account is blocked, not that
            // these particular addresses are bad. Stop, and leave everyone we
            // haven't attempted as 'pending' so the next run picks them up
            // untouched rather than burning through them for nothing.
            if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
                aborted = true;
                console.error(`[CAMPAIGN ${campaignId}] ABORTED after ${consecutiveFailures} consecutive failures — last error: ${result.error}`);
                break;
            }
        }

        // Persist progress as we go, so a crash or restart mid-send doesn't
        // lose the record of who already received the email.
        bumpStats.run(sentCount, failedCount, campaignId);

        await new Promise(resolve => setTimeout(resolve, SEND_DELAY_MS));
    }

    const stillPending = db.prepare(
        "SELECT COUNT(*) c FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending'"
    ).get(campaignId).c;
    const anyFailed = db.prepare(
        "SELECT COUNT(*) c FROM campaign_recipients WHERE campaign_id = ? AND status = 'failed'"
    ).get(campaignId).c;

    db.prepare(`
        UPDATE campaigns SET status = ?, sent_count = ?, failed_count = ?, sent_at = datetime('now')
        WHERE id = ?
    `).run(
        sentCount === 0 && anyFailed > 0 ? 'failed' : 'sent',
        sentCount, failedCount, campaignId
    );

    console.log(`[CAMPAIGN ${campaignId}] ${aborted ? 'ABORTED' : 'done'} — ${delivered} delivered, ${failed} failed, ${rateLimited} rate-limit retries, ${stillPending} still pending`);
    if (aborted) {
        console.error(`[CAMPAIGN ${campaignId}] ${stillPending} recipient(s) left untouched. Fix the sending limit, then hit Retry to resume.`);
    }

    // One summary to Dennis instead of one BCC per recipient. This keeps the
    // "Dennis always knows what went out" rule that the per-send BCC existed
    // to enforce, without burying his inbox.
    if (delivered + failed > 0) {
        const summaryTo = process.env.CRM_BCC_EMAIL || 'dennis@honestroof.com';
        const lines = [
            `Campaign: ${campaign.name}`,
            `Subject:  ${campaign.subject || '(none)'}`,
            '',
            aborted ? 'RUN ABORTED — the email provider blocked sending.' : 'Run completed.',
            '',
            `Delivered this run: ${delivered}`,
            `Failed this run:    ${failed}`,
            `Rate-limit retries: ${rateLimited}`,
            `Not yet attempted:  ${stillPending}`,
            '',
            `Campaign totals — sent: ${sentCount}, failed: ${failedCount}`,
            aborted ? '\nNobody left over was contacted. Fix the sending limit, then hit Retry to resume.' : '',
        ].join('\n');

        await sendEmail({
            toEmail: summaryTo,
            toName: 'Dennis Harrison',
            subject: aborted
                ? `[Campaign PAUSED] ${campaign.name} — blocked after ${delivered} delivered`
                : `[Campaign sent] ${campaign.name} — ${delivered} delivered, ${failed} failed`,
            htmlContent: `<pre style="font-family:monospace;font-size:14px">${lines.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
            textContent: lines,
            skipBcc: true, // he is the direct recipient here
        }).catch(e => console.error('[CAMPAIGN SUMMARY ERROR]', e.message));
    }

    return { delivered, failed, rateLimited };
}

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

        await deliverCampaign(db, req.params.id);

    } catch (error) {
        console.error('[CAMPAIGN SEND ERROR]', error);
        // Only send error response if we haven't already responded
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Failed to send campaign', message: error.message });
        }
    }
});

// POST /api/campaigns/:id/retry-failed - re-send only to recipients that failed
//
// Deliberately does NOT touch recipients already marked 'sent', so re-running a
// partially-delivered campaign can never double-email anyone who got it.
// Permanently bad addresses will simply fail again and stay marked failed.
router.post('/:id/retry-failed', authenticate, async (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }
        if (campaign.status === 'sending') {
            return res.status(400).json({ success: false, error: 'Campaign is currently sending' });
        }

        // Optionally narrow to the ones that failed for rate limiting only.
        const { onlyRateLimited } = req.body || {};
        const failed = onlyRateLimited
            ? db.prepare("SELECT id FROM campaign_recipients WHERE campaign_id = ? AND status = 'failed' AND error_message LIKE '%429%'").all(req.params.id)
            : db.prepare("SELECT id FROM campaign_recipients WHERE campaign_id = ? AND status = 'failed'").all(req.params.id);

        // An aborted run leaves untried recipients as 'pending'. Those need
        // resuming too, so a retry is valid when either bucket has anything in it.
        const alreadyPending = db.prepare(
            "SELECT COUNT(*) c FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending'"
        ).get(req.params.id).c;

        if (failed.length === 0 && alreadyPending === 0) {
            return res.status(400).json({ success: false, error: 'Nothing left to send — no failed or pending recipients' });
        }

        const reset = db.prepare("UPDATE campaign_recipients SET status = 'pending', error_message = NULL WHERE id = ?");
        const resetAll = db.transaction(rows => { for (const r of rows) reset.run(r.id); });
        resetAll(failed);

        // failed_count is rebuilt by deliverCampaign from what actually happens,
        // so drop the ones we just moved back to pending.
        db.prepare('UPDATE campaigns SET failed_count = ?, status = ? WHERE id = ?')
            .run(Math.max(0, (campaign.failed_count || 0) - failed.length), 'sending', req.params.id);

        res.json({ success: true, data: { message: 'Retry started', retrying: failed.length + alreadyPending } });

        await deliverCampaign(db, req.params.id);

    } catch (error) {
        console.error('[CAMPAIGN RETRY ERROR]', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Failed to retry campaign', message: error.message });
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
//
// Body (all optional):
//   name            override the auto-generated "<original> (Copy)"
//   copyRecipients  also copy the source's recipient list, reset to pending
//
// The clone always comes back as a fresh draft with zeroed counters, so it can
// be re-targeted and sent independently of the campaign it came from.
router.post('/:id/clone', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);

        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }

        const { name, copyRecipients } = req.body || {};

        // Cloning a clone shouldn't produce "Storm blast (Copy) (Copy) (Copy)".
        // Strip any existing copy suffix, then find the first free number.
        let newName = (name || '').trim();
        if (!newName) {
            const base = campaign.name.replace(/\s*\(Copy(?:\s+\d+)?\)$/i, '');
            newName = `${base} (Copy)`;
            let n = 2;
            while (db.prepare('SELECT 1 FROM campaigns WHERE name = ?').get(newName)) {
                newName = `${base} (Copy ${n++})`;
            }
        }

        const newId = crypto.randomUUID();

        const doClone = db.transaction(() => {
            db.prepare(`
                INSERT INTO campaigns (
                    id, name, type, subject, html_content, text_content,
                    trigger_event, is_active, from_name, from_email,
                    status, total_recipients, sent_count, failed_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'draft', 0, 0, 0)
            `).run(
                newId, newName, campaign.type, campaign.subject,
                campaign.html_content, campaign.text_content,
                // Keep the trigger so an autoresponder clones as an autoresponder,
                // but never as an active one -- two live autoresponders on the same
                // trigger would double-send to every new lead.
                campaign.trigger_event || null,
                campaign.from_name || null,
                campaign.from_email || null,
            );

            if (copyRecipients) {
                const rows = db.prepare(
                    'SELECT lead_id, email, name FROM campaign_recipients WHERE campaign_id = ?'
                ).all(req.params.id);
                const ins = db.prepare(`
                    INSERT INTO campaign_recipients (id, campaign_id, lead_id, email, name, status)
                    VALUES (?, ?, ?, ?, ?, 'pending')
                `);
                for (const r of rows) {
                    ins.run(crypto.randomUUID(), newId, r.lead_id, r.email, r.name);
                }
                db.prepare('UPDATE campaigns SET total_recipients = ? WHERE id = ?').run(rows.length, newId);
            }
        });

        doClone();

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
