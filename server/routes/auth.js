const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');
const authenticate = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../lib/passwords');

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const db = getDb();

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    const result = user
        ? verifyPassword(password, user.password_hash)
        : { ok: false, legacy: false };

    if (!user || !result.ok) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Auto-upgrade legacy plaintext passwords to bcrypt on successful login,
    // so accounts drift to hashed storage without anyone having to reset.
    if (result.legacy) {
        try {
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
                .run(hashPassword(password), user.id);
        } catch (e) {
            console.error('[AUTH] password upgrade failed:', e.message);
        }
    }

    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );

    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24h
    });

    res.json({
        success: true,
        data: { user: { id: user.id, name: user.name, role: user.role } }
    });
});

router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

router.get('/me', (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json({ success: false });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({ success: true, data: decoded });
    } catch (e) {
        res.json({ success: false });
    }
});

/**
 * Change the logged-in user's own password.
 * Body: { currentPassword, newPassword }
 *
 * Note: a wrong current password returns 400 (not 401) on purpose - a 401
 * would trip the client's axios interceptor and bounce the user to /login
 * mid-action. 400 keeps them on the settings page with an inline error.
 */
router.post('/change-password', authenticate, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const db = getDb();

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, error: 'Current and new password are required' });
    }
    if (String(newPassword).length < 8) {
        return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    const result = verifyPassword(currentPassword, user.password_hash);
    if (!result.ok) {
        return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    }

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(hashPassword(newPassword), user.id);

    res.json({ success: true });
});

module.exports = router;
