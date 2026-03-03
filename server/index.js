const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const cookieParser = require('cookie-parser');
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Serve static files in production BEFORE CORS (static files don't need CORS)
if (process.env.NODE_ENV === 'production') {
    const clientDist = path.join(__dirname, '../client/dist');
    app.use(express.static(clientDist));
}

// Middleware
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        // Allow localhost, hosting platforms, and gauraw.com
        if (origin.startsWith('http://localhost') || origin.includes('onrender.com') || origin.includes('railway.app') || origin.includes('gauraw.com')) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Database Initialization
db.initialize();

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/interactions', require('./routes/interactions'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/weather', require('./routes/weather'));

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// SPA catch-all in production - AFTER all /api routes
if (process.env.NODE_ENV === 'production') {
    const clientDist = path.join(__dirname, '../client/dist');
    const indexHtml = path.join(clientDist, 'index.html');
    
    // Serve static again (redundant but ensures coverage after API routes)
    app.use(express.static(clientDist));
    
    // SPA catch-all for client-side routing
    app.get('/{*splat}', async (req, res, next) => {
        try {
            await res.sendFile(indexHtml);
        } catch (err) {
            console.error('SPA fallback error:', err.message);
            next(err);
        }
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// Initialize Telegram bot if token is set
if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
        const { startBot } = require('./bot/telegram-bot');
        startBot(db.getDb());
    } catch (error) {
        console.error('Failed to start Telegram bot:', error.message);
    }
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
