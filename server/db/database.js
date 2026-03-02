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

function initialize() {
    const db = connect();
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
