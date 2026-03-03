const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const authenticate = require('../middleware/auth');
const crypto = require('crypto');

// GET revenue attribution stats
router.get('/stats', authenticate, (req, res) => {
    try {
        const db = getDb();

        // Count + value by referral_source
        const bySource = db.prepare(`
            SELECT
                COALESCE(referral_source, 'unknown') as source,
                COUNT(*) as lead_count,
                SUM(CASE WHEN status IN ('completed', 'paid', 'review_received') THEN 1 ELSE 0 END) as converted_count,
                COALESCE(SUM(CASE WHEN status IN ('completed', 'paid', 'review_received') THEN COALESCE(actual_value, estimated_value, 0) ELSE 0 END), 0) as total_revenue
            FROM leads
            GROUP BY COALESCE(referral_source, 'unknown')
            ORDER BY total_revenue DESC
        `).all();

        // Referral-specific conversion rate
        const referralStats = db.prepare(`
            SELECT
                COUNT(*) as total_referrals,
                SUM(CASE WHEN status IN ('completed', 'paid', 'review_received') THEN 1 ELSE 0 END) as converted_referrals,
                COALESCE(SUM(CASE WHEN status IN ('completed', 'paid', 'review_received') THEN COALESCE(actual_value, estimated_value, 0) ELSE 0 END), 0) as referral_revenue
            FROM leads
            WHERE referred_by IS NOT NULL
        `).get();

        res.json({ success: true, data: { bySource, referralStats } });
    } catch (error) {
        console.error('[REFERRAL STATS ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to fetch stats', message: error.message });
    }
});

// POST create referral campaign (draft)
router.post('/campaigns', authenticate, (req, res) => {
    try {
        const db = getDb();
        const { name, message_template, incentive_type, incentive_value, criteria } = req.body;
        const id = crypto.randomUUID();

        db.prepare(`
            INSERT INTO referral_campaigns (id, name, message_template, incentive_type, incentive_value, criteria)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, name, message_template || null, incentive_type || null, incentive_value || null, criteria ? JSON.stringify(criteria) : null);

        res.json({ success: true, data: { id, message: 'Campaign created' } });
    } catch (error) {
        console.error('[CREATE CAMPAIGN ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to create campaign', message: error.message });
    }
});

// GET list all campaigns
router.get('/campaigns', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaigns = db.prepare(`
            SELECT c.*,
                (SELECT COUNT(*) FROM referral_campaign_recipients r WHERE r.campaign_id = c.id) as recipient_count,
                (SELECT COUNT(*) FROM referral_campaign_recipients r WHERE r.campaign_id = c.id AND r.responded = 1) as responded_count
            FROM referral_campaigns c
            ORDER BY c.created_at DESC
        `).all();

        res.json({ success: true, data: campaigns });
    } catch (error) {
        console.error('[LIST CAMPAIGNS ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to fetch campaigns', message: error.message });
    }
});

// GET campaign detail with recipients
router.get('/campaigns/:id', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM referral_campaigns WHERE id = ?').get(req.params.id);

        if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

        const recipients = db.prepare(`
            SELECT r.*, l.name as customer_name, l.phone as customer_phone, l.email as customer_email,
                l.satisfaction_score
            FROM referral_campaign_recipients r
            JOIN leads l ON l.id = r.customer_lead_id
            WHERE r.campaign_id = ?
            ORDER BY l.name
        `).all(req.params.id);

        res.json({ success: true, data: { ...campaign, recipients } });
    } catch (error) {
        console.error('[CAMPAIGN DETAIL ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to fetch campaign', message: error.message });
    }
});

// POST send campaign (mark as sent)
router.post('/campaigns/:id/send', authenticate, (req, res) => {
    try {
        const db = getDb();
        const campaign = db.prepare('SELECT * FROM referral_campaigns WHERE id = ?').get(req.params.id);
        if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
        if (campaign.status === 'sent') return res.status(400).json({ success: false, error: 'Campaign already sent' });

        db.prepare("UPDATE referral_campaigns SET status = 'sent', sent_at = datetime('now') WHERE id = ?")
            .run(req.params.id);

        db.prepare("UPDATE referral_campaign_recipients SET sent_at = datetime('now') WHERE campaign_id = ?")
            .run(req.params.id);

        res.json({ success: true, message: 'Campaign sent' });
    } catch (error) {
        console.error('[SEND CAMPAIGN ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to send campaign', message: error.message });
    }
});

// POST add recipients to campaign
router.post('/campaigns/:id/recipients', authenticate, (req, res) => {
    try {
        const db = getDb();
        const { leadIds } = req.body;

        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ success: false, error: 'leadIds array is required' });
        }

        const stmt = db.prepare(`
            INSERT OR IGNORE INTO referral_campaign_recipients (id, campaign_id, customer_lead_id)
            VALUES (?, ?, ?)
        `);

        const added = [];
        for (const leadId of leadIds) {
            const id = crypto.randomUUID();
            const result = stmt.run(id, req.params.id, leadId);
            if (result.changes > 0) added.push(id);
        }

        res.json({ success: true, data: { added: added.length } });
    } catch (error) {
        console.error('[ADD RECIPIENTS ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to add recipients', message: error.message });
    }
});

// DELETE remove recipient from campaign
router.delete('/campaigns/:id/recipients/:recipientId', authenticate, (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM referral_campaign_recipients WHERE id = ? AND campaign_id = ?')
            .run(req.params.recipientId, req.params.id);

        res.json({ success: true });
    } catch (error) {
        console.error('[REMOVE RECIPIENT ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to remove recipient', message: error.message });
    }
});

// GET list all incentives
router.get('/incentives', authenticate, (req, res) => {
    try {
        const db = getDb();
        const incentives = db.prepare(`
            SELECT i.*,
                referrer.name as referrer_name,
                referred.name as referred_name
            FROM referral_incentives i
            JOIN leads referrer ON referrer.id = i.referrer_lead_id
            JOIN leads referred ON referred.id = i.referred_lead_id
            ORDER BY i.created_at DESC
        `).all();

        res.json({ success: true, data: incentives });
    } catch (error) {
        console.error('[LIST INCENTIVES ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to fetch incentives', message: error.message });
    }
});

// PATCH update incentive status
router.patch('/incentives/:id', authenticate, (req, res) => {
    try {
        const db = getDb();
        const { status } = req.body;

        if (!['pending', 'approved', 'paid'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Status must be pending, approved, or paid' });
        }

        let sql = 'UPDATE referral_incentives SET status = ?';
        const params = [status];

        if (status === 'paid') {
            sql += ", paid_at = datetime('now')";
        }

        sql += ' WHERE id = ?';
        params.push(req.params.id);

        db.prepare(sql).run(...params);
        res.json({ success: true });
    } catch (error) {
        console.error('[UPDATE INCENTIVE ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to update incentive', message: error.message });
    }
});

module.exports = router;
