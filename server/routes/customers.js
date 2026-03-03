const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const authenticate = require('../middleware/auth');

// GET all customers (completed/paid/review_received leads)
router.get('/', authenticate, (req, res) => {
    try {
        const db = getDb();
        const { minSatisfaction, completedAfter, completedBefore, hasReferrals } = req.query;

        let sql = `
            SELECT l.*,
                (SELECT COUNT(*) FROM leads r WHERE r.referred_by = l.id) as referral_count
            FROM leads l
            WHERE l.status IN ('completed', 'paid', 'review_received')
        `;
        const params = [];

        if (minSatisfaction) {
            sql += ' AND l.satisfaction_score >= ?';
            params.push(Number(minSatisfaction));
        }
        if (completedAfter) {
            sql += ' AND l.completed_at >= ?';
            params.push(completedAfter);
        }
        if (completedBefore) {
            sql += ' AND l.completed_at <= ?';
            params.push(completedBefore);
        }
        if (hasReferrals === 'true') {
            sql += ' AND (SELECT COUNT(*) FROM leads r WHERE r.referred_by = l.id) > 0';
        } else if (hasReferrals === 'false') {
            sql += ' AND (SELECT COUNT(*) FROM leads r WHERE r.referred_by = l.id) = 0';
        }

        sql += ' ORDER BY l.completed_at DESC';

        const customers = db.prepare(sql).all(...params);
        res.json({ success: true, data: customers });
    } catch (error) {
        console.error('[CUSTOMERS GET ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to fetch customers', message: error.message });
    }
});

// PATCH set satisfaction score
router.patch('/:id/satisfaction', authenticate, (req, res) => {
    try {
        const db = getDb();
        const { satisfaction_score } = req.body;

        if (!satisfaction_score || satisfaction_score < 1 || satisfaction_score > 5) {
            return res.status(400).json({ success: false, error: 'Satisfaction score must be between 1 and 5' });
        }

        db.prepare("UPDATE leads SET satisfaction_score = ?, updated_at = datetime('now') WHERE id = ?")
            .run(satisfaction_score, req.params.id);

        res.json({ success: true });
    } catch (error) {
        console.error('[SATISFACTION UPDATE ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to update satisfaction', message: error.message });
    }
});

// GET referrals for a customer
router.get('/:id/referrals', authenticate, (req, res) => {
    try {
        const db = getDb();
        const referrals = db.prepare(
            'SELECT * FROM leads WHERE referred_by = ? ORDER BY created_at DESC'
        ).all(req.params.id);

        res.json({ success: true, data: referrals });
    } catch (error) {
        console.error('[CUSTOMER REFERRALS ERROR]', error);
        res.status(500).json({ success: false, error: 'Failed to fetch referrals', message: error.message });
    }
});

module.exports = router;
