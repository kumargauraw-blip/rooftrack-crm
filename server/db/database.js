const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Resolve DATABASE_PATH relative to project root (app/), not CWD,
// so the path is stable regardless of how the server is started.
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
    // Skip if leads table doesn't exist yet (fresh DB — schema.sql will create it with all cols)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leads'").all();
    if (tables.length === 0) return;

    const newCols = [
        { name: 'satisfaction_score', def: 'INTEGER' },
        { name: 'referred_by', def: 'TEXT' },
        { name: 'referral_source', def: 'TEXT' },
        { name: 'payment_date', def: 'TEXT' },
    ];
    const existing = db.pragma('table_info(leads)').map(c => c.name);
    for (const col of newCols) {
        if (!existing.includes(col.name)) {
            db.exec(`ALTER TABLE leads ADD COLUMN ${col.name} ${col.def}`);
            console.log(`Added column leads.${col.name}`);
        }
    }
}

function initialize() {
    const db = connect();

    // Migrate: add new columns to existing leads table BEFORE schema
    // (schema.sql creates indexes on these columns, so they must exist first)
    ensureLeadColumns(db);

    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    // Check if we need to seed
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
