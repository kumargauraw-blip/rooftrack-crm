#!/usr/bin/env node
/**
 * One-off backfill: graduate legacy `completed` leads to `paid`.
 *
 * Background: ingest-customers.js seeded historical customers with
 * status='completed' (the Paid stage didn't exist yet). After the
 * lifecycle redesign, those records sit in Service Delivered forever
 * because they have no paid_at. They should be on /customers instead.
 *
 * What this does:
 *   For every lead where status='completed' (and not deleted),
 *   set status='paid' and paid_at = COALESCE(completed_at, created_at).
 *
 * Usage:
 *   node backfill-completed-to-paid.js          # dry run (default)
 *   node backfill-completed-to-paid.js --commit # apply changes
 */

const Database = require('better-sqlite3');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const rawDbPath = process.env.DATABASE_PATH || './rooftrack.db';
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(projectRoot, rawDbPath);

const commit = process.argv.includes('--commit');

console.log(`Database: ${dbPath}`);
console.log(`Mode:     ${commit ? 'COMMIT (will mutate data)' : 'DRY RUN (no changes)'}`);
console.log('');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const candidates = db.prepare(`
    SELECT id, name, completed_at, created_at, paid_at, status
    FROM leads
    WHERE deleted_at IS NULL
      AND status = 'completed'
    ORDER BY COALESCE(completed_at, created_at) ASC
`).all();

console.log(`Found ${candidates.length} 'completed' leads to graduate.`);
console.log('');

if (candidates.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
}

console.log('Sample (first 5):');
for (const c of candidates.slice(0, 5)) {
    const newPaidAt = c.completed_at || c.created_at;
    console.log(`  id=${c.id}  name="${c.name}"  completed_at=${c.completed_at || '(null)'}  ->  paid_at=${newPaidAt}`);
}
if (candidates.length > 5) console.log(`  ... and ${candidates.length - 5} more`);
console.log('');

if (!commit) {
    console.log('Dry run complete. Re-run with --commit to apply.');
    process.exit(0);
}

const update = db.prepare(`
    UPDATE leads
    SET status = 'paid',
        paid_at = COALESCE(completed_at, created_at),
        updated_at = datetime('now')
    WHERE id = ?
      AND status = 'completed'
      AND deleted_at IS NULL
`);

const tx = db.transaction((rows) => {
    let updated = 0;
    for (const r of rows) {
        const result = update.run(r.id);
        updated += result.changes;
    }
    return updated;
});

const updated = tx(candidates);
console.log(`Updated ${updated} rows. Done.`);
