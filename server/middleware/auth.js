const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, error: 'Invalid token' });
    }
};

/**
 * Like authenticate, but additionally requires the user's role to be 'admin'.
 * Used for user-management endpoints (create user, reset another user's
 * password). Returns 403 for authenticated-but-non-admin users.
 */
const requireAdmin = (req, res, next) => {
    authenticate(req, res, () => {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }
        next();
    });
};

// Default export stays the authenticate function for backward compatibility
// with the many routes that `require('../middleware/auth')` directly. Named
// helpers hang off it so callers can also destructure { requireAdmin }.
module.exports = authenticate;
module.exports.authenticate = authenticate;
module.exports.requireAdmin = requireAdmin;
