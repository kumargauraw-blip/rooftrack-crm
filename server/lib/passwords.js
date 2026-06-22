'use strict';

/**
 * Password hashing helpers.
 *
 * The CRM historically stored login passwords in PLAIN TEXT in the
 * users.password_hash column (despite the column name). This module moves
 * us to bcrypt while staying backward-compatible with any legacy plaintext
 * rows that haven't been migrated yet:
 *
 *   - hashPassword()   always produces a bcrypt hash for new/changed passwords.
 *   - verifyPassword() accepts a bcrypt hash OR a legacy plaintext value, so
 *     existing users can still log in until their row is upgraded.
 *
 * On a successful legacy login, callers should re-hash and store the result
 * (see routes/auth.js) so every account drifts to bcrypt over time.
 */

const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

/** True if `stored` looks like a bcrypt hash ($2a$/$2b$/$2y$ prefix). */
function isBcryptHash(stored) {
    return typeof stored === 'string' && /^\$2[aby]\$/.test(stored);
}

/** Hash a plaintext password with bcrypt. Synchronous - fine for this app's volume. */
function hashPassword(plain) {
    return bcrypt.hashSync(String(plain), BCRYPT_ROUNDS);
}

/**
 * Verify a plaintext password against a stored value.
 * Handles both bcrypt hashes and legacy plaintext.
 * @returns {{ ok: boolean, legacy: boolean }} legacy=true means the stored
 *          value was plaintext and the caller should upgrade it to bcrypt.
 */
function verifyPassword(plain, stored) {
    if (stored == null) return { ok: false, legacy: false };
    if (isBcryptHash(stored)) {
        return { ok: bcrypt.compareSync(String(plain), stored), legacy: false };
    }
    // Legacy plaintext comparison.
    return { ok: String(plain) === String(stored), legacy: true };
}

module.exports = { hashPassword, verifyPassword, isBcryptHash, BCRYPT_ROUNDS };
