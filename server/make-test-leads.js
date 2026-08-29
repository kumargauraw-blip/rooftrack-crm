#!/usr/bin/env node
/**
 * Create (and later remove) throwaway leads for test-sending a campaign.
 *
 * Why this exists: the Add Recipients modal only filters by all / status /
 * city, and a campaign can only ever be sent once. So to test a campaign you
 * need a second campaign aimed at a recipient set you control. The cheapest
 * handle the UI gives you is `city`, so these leads get a city nothing else
 * uses -- ZZ-TEST -- and you point the test campaign at that.
 *
 * They are created with status 'new' on purpose: the real blast filters on
 * status = 'paid', so these can never be swept into it.
 *
 * Usage:
 *   node make-test-leads.js --add "Dennis Harrison <dennis@honestroof.com>" "you@example.com"
 *   node make-test-leads.js --list
 *   node make-test-leads.js --remove          # soft-deletes them (sets deleted_at)
 *
 * Every recipient query filters on deleted_at IS NULL, so --remove is enough
 * to take them out of circulation without hard-deleting rows a sent campaign
 * still references.
 */

const Database = require('better-sqlite3');
const path = require('path');
const { randomUUID } = require('crypto');

const TEST_CITY = 'ZZ-TEST';

const argv = process.argv.slice(2);
const mode = argv.includes('--add') ? 'add'
    : argv.includes('--remove') ? 'remove'
    : argv.includes('--list') ? 'list'
    : null;

if (!mode) {
    console.error('Pick one: --add "<Name> <email>" [...]  |  --list  |  --remove');
    process.exit(1);
}

const projectRoot = path.join(__dirname, '..');
const rawDbPath = process.env.DATABASE_PATH || './rooftrack.db';
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(projectRoot, rawDbPath);

console.log(`Database: ${dbPath}`);
const db = new Database(dbPath);

const leadCols = new Set(db.pragma('table_info(leads)').map(c => c.name));

if (mode === 'list') {
    const rows = db.prepare(
        `SELECT id, name, email, status, deleted_at FROM leads WHERE city = ? ORDER BY name`
    ).all(TEST_CITY);
    if (!rows.length) {
        console.log(`\nNo ${TEST_CITY} leads.`);
    } else {
        console.log(`\n${rows.length} ${TEST_CITY} lead(s):`);
        rows.forEach(r => console.log(`  ${r.deleted_at ? '[removed] ' : '[active]  '}${r.name} <${r.email}>  status=${r.status}`));
    }
    db.close();
    process.exit(0);
}

if (mode === 'remove') {
    const res = db.prepare(
        `UPDATE leads SET deleted_at = datetime('now') WHERE city = ? AND deleted_at IS NULL`
    ).run(TEST_CITY);
    console.log(`\nSoft-deleted ${res.changes} test lead(s). They are now invisible to every campaign filter.`);
    db.close();
    process.exit(0);
}

// ---- add ----

// Accept "Name <email>" or a bare email.
const inputs = argv.slice(argv.indexOf('--add') + 1).filter(a => !a.startsWith('--'));
if (!inputs.length) {
    console.error('Give me at least one address, e.g. --add "Dennis Harrison <dennis@honestroof.com>"');
    process.exit(1);
}

const people = inputs.map(raw => {
    const m = raw.match(/^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/);
    if (m && m[2]) return { name: m[1] || m[2].split('@')[0], email: m[2] };
    return { name: raw.split('@')[0], email: raw.trim() };
});

const bad = people.filter(p => !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(p.email));
if (bad.length) {
    console.error(`Not a valid email: ${bad.map(b => b.email).join(', ')}`);
    process.exit(1);
}

const optional = [
    leadCols.has('referral_source') ? ['referral_source', "'test'"] : null,
    leadCols.has('business_unit') ? ['business_unit', "'honestroof'"] : null,
].filter(Boolean);

const insert = db.prepare(`
    INSERT INTO leads (
        id, name, email, phone, address, city, state, zip,
        source_channel, source_details, status, priority, assigned_to, notes,
        ${optional.map(c => c[0] + ', ').join('')}
        created_at, updated_at
    ) VALUES (
        ?, ?, ?, NULL, NULL, '${TEST_CITY}', 'TX', NULL,
        'manual', 'campaign_test', 'new', 'cold', 'Dennis', ?,
        ${optional.map(c => c[1] + ', ').join('')}
        datetime('now'), datetime('now')
    )
`);

const notes = `Throwaway lead for campaign test sends. City is ${TEST_CITY} so a test campaign can target it by city. Status is 'new' so it can never be picked up by a status='paid' blast. Remove with: node server/make-test-leads.js --remove`;

const added = [];
const run = db.transaction(list => {
    for (const p of list) {
        const dupe = db.prepare(
            'SELECT id FROM leads WHERE lower(email) = lower(?) AND city = ? AND deleted_at IS NULL'
        ).get(p.email, TEST_CITY);
        if (dupe) { console.log(`  already a test lead: ${p.email}`); continue; }
        insert.run(randomUUID(), p.name, p.email, notes);
        added.push(p);
    }
});
run(people);

console.log(`\nAdded ${added.length} test lead(s) in city "${TEST_CITY}":`);
added.forEach(p => console.log(`  ${p.name} <${p.email}>`));

const live = db.prepare(
    'SELECT COUNT(*) c FROM leads WHERE city = ? AND deleted_at IS NULL'
).get(TEST_CITY).c;
console.log(`\nTotal active test leads: ${live}`);
console.log(`\nNext: create a SEPARATE campaign, add recipients with filter "City" = ${TEST_CITY}, and send that one.`);
console.log(`When you're done: node server/make-test-leads.js --remove`);

db.close();
