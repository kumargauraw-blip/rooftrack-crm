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
    } catch (e) { /* indexes may already exist */ }
}

function initialize() {
    const db = connect();

    // Run schema first (creates tables if they don't exist)
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    // Then ensure all columns exist (handles both fresh and existing DBs)
    ensureLeadColumns(db);

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
