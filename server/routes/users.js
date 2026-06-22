'use strict';

/**
 * Admin-only user management.
 *
 * All routes require an authenticated admin (see middleware/auth.requireAdmin).
 *   GET    /api/users                  - list users (no password material)
 *   POST   /api/users                  - create a user { username, name, password, role }
 *   POST   /api/users/:id/reset-password - admin resets another user's password { newPassword }
 *
 * Passwords are always stored as bcrypt hashes (see lib/passwords).
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { hashPassword } = require('../lib/passwords');

const VALID_ROLES = ['admin', 'user'];

function cleanString(v) {
    return v === undefined || v === null ? '' : String(v).trim();
}

// List users - never return password_hash.
router.get('/', requireAdmin, (req, res) => {
    const db = getDb();
    const users = db
        .prepare('SELECT id, username, name, role, created_at FROM users ORDER BY created_at ASC')
        .all();
    res.json({ success: true, data: users });
});

// Create a new user.
router.post('/', requireAdmin, (req, res) => {
    const db = getDb();
    const username = cleanString(req.body?.username).toLowerCase();
    const name = cleanString(req.body?.name);
    const password = req.body?.password;
    const role = VALID_ROLES.includes(req.body?.role) ? req.body.role : 'user';

    if (!username || !name || !password) {
        return res.status(400).json({ success: false, error: 'Username, name, and password are required' });
    }
    if (!/^[a-z0-9._-]{3,}$/.test(username)) {
        return res.status(400).json({ success: false, error: 'Username must be at least 3 chars: lowercase letters, numbers, . _ -' });
    }
    if (String(password).length < 8) {
        return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
        return res.status(409).json({ success: false, error: 'That username is already taken' });
    }

    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, username, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
        .run(id, username, hashPassword(password), name, role);

    res.json({ success: true, data: { id, username, name, role } });
});

// Admin reset another user's password.
router.post('/:id/reset-password', requireAdmin, (req, res) => {
    const db = getDb();
    const { newPassword } = req.body || {};

    if (!newPassword || String(newPassword).length < 8) {
        return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(hashPassword(newPassword), user.id);

    res.json({ success: true, data: { id: user.id, username: user.username } });
});

module.exports = router;
