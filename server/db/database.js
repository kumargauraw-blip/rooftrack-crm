const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Resolve DATABASE_PATH relative to project root, not CWD.
// __dirname = server/db/, project root = 2 levels up
const projectRoot = path.join(__dirname, '../..');
const rawDbPath = process.env.DATABASE_PATH || './rooftrack.db';
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(projectRoot, rawDbPath);
const schemaPath = path.join(__dirname, 'schema.sql');
const seedPath = path.join(__dirname, 'seed.sql');

let db;

function connect() {
    if (!db) {
        db = new Database(dbPath, { verbose: console.log });
        db.pragma('journal_mode = WAL');
    }
    return db;
}

function ensureLeadColumns(db) {
    // Add columns introduced by Customer Lifecycle & Referral Tracking feature
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leads'").all();
    if (tables.length === 0) return;

    const newCols = [
        { name: 'satisfaction_score', def: 'INTEGER' },
        { name: 'referred_by', def: 'TEXT' },
        { name: 'referral_source', def: 'TEXT' },
        { name: 'payment_date', def: 'TEXT' },
        { name: 'completed_at', def: 'TEXT' },
        { name: 'contacted_at', def: 'TEXT' },
        { name: 'scheduled_at', def: 'TEXT' },
        { name: 'quoted_at', def: 'TEXT' },
        { name: 'accepted_at', def: 'TEXT' },
        { name: 'paid_at', def: 'TEXT' },
        { name: 'review_received_at', def: 'TEXT' },
        { name: 'lost_at', def: 'TEXT' },
        // Website lead attribution — populated by POST /api/leads/public when
        // the honestroof.com forms submit an `attribution` payload.
        { name: 'heard_about', def: 'TEXT' },        // self-reported dropdown value
        { name: 'heard_about_other', def: 'TEXT' },  // free text when "Other" chosen
        { name: 'utm_source', def: 'TEXT' },
        { name: 'utm_medium', def: 'TEXT' },
        { name: 'utm_campaign', def: 'TEXT' },
        { name: 'utm_content', def: 'TEXT' },
        { name: 'utm_term', def: 'TEXT' },
        { name: 'gclid', def: 'INTEGER DEFAULT 0' },   // 0/1 flag — did they click a Google Ad
        { name: 'fbclid', def: 'INTEGER DEFAULT 0' },  // 0/1 flag — did they click a Meta Ad
        { name: 'msclkid', def: 'INTEGER DEFAULT 0' }, // 0/1 flag — did they click a Bing Ad
        { name: 'referrer', def: 'TEXT' },             // external referrer URL
        { name: 'landing_page', def: 'TEXT' },         // first page they hit on our site
        { name: 'is_repeat', def: 'INTEGER DEFAULT 0' }, // 0/1 flag — cookie-based repeat submitter
    ];
    const existing = db.pragma('table_info(leads)').map(c => c.name);
    for (const col of newCols) {
        if (!existing.includes(col.name)) {
            db.exec(`ALTER TABLE leads ADD COLUMN ${col.name} ${col.def}`);
            console.log(`Added column leads.${col.name}`);
        }
    }
    // Ensure indexes on lifecycle columns
    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_leads_referred_by ON leads(referred_by)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_leads_referral_source ON leads(referral_source)');
        // Attribution indexes — for "leads by channel" queries
        db.exec('CREATE INDEX IF NOT EXISTS idx_leads_heard_about ON leads(heard_about)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_leads_utm_source ON leads(utm_source)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_leads_utm_campaign ON leads(utm_campaign)');
    } catch (e) { /* indexes may already exist */ }
}

function ensureCampaignAutoresponderColumns(db) {
    // Add columns to `campaigns` that turn it into an autoresponder system
    // on top of the existing one-shot manual campaigns. See campaigns.js.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='campaigns'").all();
    if (tables.length === 0) return;

    const newCols = [
        { name: 'trigger_event', def: 'TEXT' },        // e.g. 'new_lead', NULL = manual
        { name: 'is_active', def: 'INTEGER DEFAULT 0' }, // only autoresponders use this; 1 = currently firing
        { name: 'from_name', def: 'TEXT' },            // optional per-campaign override of EMAIL_FROM_NAME
        { name: 'from_email', def: 'TEXT' },           // optional per-campaign override of SENDLAYER_FROM_EMAIL
    ];
    const existing = db.pragma('table_info(campaigns)').map(c => c.name);
    for (const col of newCols) {
        if (!existing.includes(col.name)) {
            db.exec(`ALTER TABLE campaigns ADD COLUMN ${col.name} ${col.def}`);
            console.log(`Added column campaigns.${col.name}`);
        }
    }
    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_campaigns_trigger_active ON campaigns(trigger_event, is_active)');
    } catch (e) { /* index may already exist */ }
}

function initialize() {
    const db = connect();

    // Run schema first (creates tables if they don't exist)
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    // Then ensure all columns exist (handles both fresh and existing DBs)
    ensureLeadColumns(db);
    ensureCampaignAutoresponderColumns(db);

    // Backfill completed_at for imported customers
    try {
        db.exec(`UPDATE leads SET completed_at = '2025-12-31' WHERE status IN ('completed', 'paid', 'review_received') AND completed_at IS NULL`);
    } catch (e) {
        console.log('Backfill note:', e.message);
    }

    // Seed if empty
    const userCount = db.prepare('SELECT count(*) as count FROM users').get();
    if (userCount.count === 0 && fs.existsSync(seedPath)) {
        console.log('Seeding database...');
        const seed = fs.readFileSync(seedPath, 'utf8');
        db.exec(seed);
        console.log('Database seeded!');
    }
}

module.exports = {
    connect,
    initialize,
    getDb: () => db
};
