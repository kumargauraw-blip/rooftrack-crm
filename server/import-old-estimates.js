#!/usr/bin/env node
/**
 * Import historical customers from the scanned paper-estimate stack
 * (OLD ESTIMATES FOR CRM/extracted_contacts.csv) into the CRM.
 *
 * These are PAST, CLOSED roofing sales, so they land as status='paid',
 * which is what /customers lists and what the campaign "status" filter
 * targets for a past-customer email blast.
 *
 * Design notes:
 *   - ADDITIVE. Never deletes or rewrites an existing lead. (Unlike
 *     ingest-customers.js, which wipes the leads table first.)
 *   - IDEMPOTENT. Re-running skips anything already in the DB, matched
 *     on normalized email, then phone, then name+street.
 *   - ONE LEAD PER PERSON. The OCR stack has the same customer on several
 *     sheets (realtors with 3 properties, re-shot pages). Sending the same
 *     inbox 3 campaign emails is worse than losing an address, so rows are
 *     collapsed by identity and the extra properties are kept in notes.
 *
 * Usage:
 *   node import-old-estimates.js                      # dry run
 *   node import-old-estimates.js --commit             # apply
 *   node import-old-estimates.js --csv <path> --commit
 *   DATABASE_PATH=/home/honestroof.com/crm/rooftrack.db node import-old-estimates.js --commit
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const commit = argv.includes('--commit');
const csvArgIdx = argv.indexOf('--csv');
const projectRoot = path.join(__dirname, '..');
const csvPath = csvArgIdx !== -1
    ? argv[csvArgIdx + 1]
    : path.join(projectRoot, 'OLD ESTIMATES FOR CRM', 'extracted_contacts.csv');

const rawDbPath = process.env.DATABASE_PATH || './rooftrack.db';
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(projectRoot, rawDbPath);

// The sheets were photographed on 2025-03-30. That is the date the record
// entered our books, NOT the date the roof was done -- the paper does not
// carry a job date. Every lead's notes say so explicitly.
const RECORD_DATE = '2025-03-30';
const SOURCE_TAG = 'old_estimates_import';

console.log(`CSV:      ${csvPath}`);
console.log(`Database: ${dbPath}`);
console.log(`Mode:     ${commit ? 'COMMIT (will write)' : 'DRY RUN (no changes)'}`);
console.log('');

// ----------------------------------------------------------------- csv

function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

// ----------------------------------------------------------- normalize

// Cities seen in the comma-delimited half of the data, used to split the
// comma-less half ("6213 Fox Run Rd Arlington 76016").
const CITIES = [
    'Arlington', 'Fort Worth', 'Grand Prairie', 'Dallas', 'Plano', 'Little Elm',
    'Frisco', 'Mansfield', 'Allen', 'Burleson', 'Cedar Hill', 'Hurst', 'Irving',
    'Killeen', 'McKinney', 'Bedford', 'Euless', 'Forney', 'Flower Mound', 'Azle',
    'Garland', 'Lewisville', 'Lantana', 'DeSoto', 'Saginaw', 'Colleyville',
    'Richardson', 'Crowley', 'Weatherford', 'Venus', 'Cleburne', 'Rockwall',
    'Carrollton', 'Watauga', 'Morgan', 'Sachse', 'Celina', 'Keller', 'Prosper',
    'Hickory Creek', 'Savannah', 'Princeton', 'Sanger', 'Sunnyvale', 'Forest Hill',
    'Glenn Heights', 'Denton', 'Lancaster', 'River Oaks', 'Highland Village',
    'Haltom City', 'Balch Springs', 'Wylie', 'Providence Village', 'Alvarado',
    'Southlake', 'Pantego', 'Joshua', 'Farmersville', 'Meridian', 'Benbrook',
    'Coppell', 'Mesquite', 'Corsicana', 'Farmers Branch', 'The Colony',
    'Richland Hills', 'Sherman', 'Kennedale', 'Haslet', 'Roanoke', 'Corinth',
    'North Richland Hills', 'Cross Roads', 'Crandall', 'Canton', 'Midlothian',
    'Waxahachie', 'Grapevine', 'Trophy Club', 'Argyle', 'Justin', 'Aledo',
    'Godley', 'Mineral Wells', 'Granbury', 'Rowlett', 'Seagoville', 'Anna',
    'Melissa', 'Krum', 'Ponder', 'Aubrey', 'Rhome', 'Boyd', 'Springtown',
    'Everman', 'White Settlement', 'Blue Mound', 'Addison', 'Murphy',
    'Wilmer', 'Red Oak', 'Ovilla', 'Ennis', 'Terrell', 'Kaufman', 'Duncanville',
    'Hutchins', 'Combine', 'Rendon',
].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b.length - a.length);

// Handwriting shorthand Dennis uses on the sheets.
const CITY_ALIASES = {
    'nrh': 'North Richland Hills',
    'ftw': 'Fort Worth',
    'ft worth': 'Fort Worth',
    'fw': 'Fort Worth',
    's. fort worth': 'Fort Worth',
    's fort worth': 'Fort Worth',
    'gp': 'Grand Prairie',
    'arl': 'Arlington',
    'desoto': 'DeSoto',
    'lake elm': 'Little Elm',   // flagged in the CSV as a likely mis-read
};

function titleCity(c) {
    const key = c.trim().toLowerCase();
    if (CITY_ALIASES[key]) return CITY_ALIASES[key];
    const known = CITIES.find(x => x.toLowerCase() === key);
    return known || c.trim();
}

function parseAddress(raw) {
    let a = (raw || '').trim();
    if (!a) return { street: '', city: '', state: 'TX', zip: '' };

    let zip = '';
    const zipMatch = a.match(/\b(\d{5})(?:-\d{4})?\s*$/);
    if (zipMatch) { zip = zipMatch[1]; a = a.slice(0, zipMatch.index).trim(); }

    a = a.replace(/,?\s*(TX|Texas)\.?\s*$/i, '').trim();
    a = a.replace(/,\s*$/, '').trim();

    // Comma form: "1036 Stephen St, Allen"
    const parts = a.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return {
            street: parts.slice(0, -1).join(', '),
            city: titleCity(parts[parts.length - 1]),
            state: 'TX',
            zip,
        };
    }

    // A handful of sheets carry only the printed city/zip fragment, no street.
    const lower = a.toLowerCase();
    if (CITIES.some(c => c.toLowerCase() === lower) || CITY_ALIASES[lower]) {
        return { street: '', city: titleCity(a), state: 'TX', zip };
    }

    // Comma-less form: "6213 Fox Run Rd Arlington"
    for (const city of CITIES) {
        const suffix = ' ' + city.toLowerCase();
        if (lower.endsWith(suffix)) {
            return { street: a.slice(0, a.length - suffix.length).trim(), city, state: 'TX', zip };
        }
    }
    for (const [alias, full] of Object.entries(CITY_ALIASES)) {
        const suffix = ' ' + alias;
        if (lower.endsWith(suffix)) {
            return { street: a.slice(0, a.length - suffix.length).trim(), city: full, state: 'TX', zip };
        }
    }

    return { street: a, city: '', state: 'TX', zip };
}

function normPhone(raw) {
    if (!raw) return { phone: '', extra: [] };
    // "512-501-0071 / 817-381-8198" -> primary + alternates
    const chunks = raw.split(/[\/;]/).map(s => s.trim()).filter(Boolean);
    const formatted = chunks.map(c => {
        const d = c.replace(/\D/g, '');
        if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
        if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
        return c; // truncated / unreadable -- keep verbatim so it can be fixed by hand
    });
    return { phone: formatted[0] || '', extra: formatted.slice(1) };
}

function phoneKey(p) {
    const d = (p || '').replace(/\D/g, '');
    if (d.length === 10) return d;
    if (d.length === 11 && d[0] === '1') return d.slice(1);
    return '';
}

// The OCR pass appended ".com" where it could; these 8 slipped through.
// The domain is unambiguous, but the repair is recorded on the lead so a
// bounce can be traced back to a guess rather than to a bad list.
const DOMAIN_FIXES = {
    'hotmail': 'hotmail.com', 'gmail': 'gmail.com', 'yahoo': 'yahoo.com',
    'aol': 'aol.com', 'icloud': 'icloud.com', 'icloud-': 'icloud.com',
    'outlook': 'outlook.com', 'att': 'att.net', 'sbcglobal': 'sbcglobal.net',
    'comcast': 'comcast.net', 'msn': 'msn.com', 'me': 'me.com',
};

function normEmail(raw) {
    let e = (raw || '').split(/[;,]/)[0].trim().toLowerCase().replace(/\s+/g, '');
    if (!e || !e.includes('@')) return { email: '', repaired: false, valid: false };
    let repaired = false;
    const at = e.lastIndexOf('@');
    const local = e.slice(0, at);
    let domain = e.slice(at + 1);
    if (!domain.includes('.')) {
        const fix = DOMAIN_FIXES[domain.replace(/[^a-z0-9.-]/g, '')];
        if (fix) { domain = fix; repaired = true; }
    }
    e = `${local}@${domain}`;
    const valid = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e);
    return { email: e, repaired, valid };
}

// ------------------------------------------------------------ csv load

if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
}
const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
const header = rows[0].map(h => h.trim());
const expected = ['source_file', 'name', 'phone', 'email', 'address', 'review_flags'];
if (header.join(',') !== expected.join(',')) {
    console.error(`Unexpected CSV header:\n  got:      ${header.join(',')}\n  expected: ${expected.join(',')}`);
    process.exit(1);
}

const records = [];
for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length !== 6 || !r.join('').trim()) continue;
    const [sourceFile, rawName, phoneRaw, emailRaw, addressRaw, flags] = r.map(f => (f || '').trim());

    // leads.name is NOT NULL, and the campaign greeting renders it verbatim.
    // One sheet has no legible name; keep the record (the email and address are
    // good) but make the placeholder loud so it gets fixed before any send.
    const nameMissing = !rawName;
    const name = rawName || `UNNAMED - see ${sourceFile}`;

    const { phone, extra: altPhones } = normPhone(phoneRaw);
    const { email, repaired, valid } = normEmail(emailRaw);
    const addr = parseAddress(addressRaw);

    records.push({
        line: i + 1, sourceFile, name, nameMissing, phone, altPhones, email,
        emailRepaired: repaired, emailValid: valid, flags,
        rawAddress: addressRaw, ...addr,
    });
}
console.log(`Parsed ${records.length} rows from CSV.\n`);

// ------------------------------------------------- collapse to persons

// Identity is the email address: an inbox is one recipient, and the whole
// point of collapsing is to not mail the same inbox three times.
//
// A shared phone number is NOT enough on its own. Several sheets reuse one
// number across genuinely different people (a realtor's cell on a client's
// sheet, a household landline), and those are two customers with two
// mailable addresses. So phone only merges when the surnames agree, which
// still catches the OCR variants ("Stankie"/"Stankiewicz", one typo'd
// domain) without folding strangers together.

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

function surname(name) {
    const tokens = name.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
    return tokens[tokens.length - 1] || '';
}

function namesAgree(a, b) {
    const la = a.toLowerCase(), lb = b.toLowerCase();
    if (la === lb || la.includes(lb) || lb.includes(la)) return true;
    const sa = surname(a), sb = surname(b);
    return !!sa && (sa === sb || sa.startsWith(sb) || sb.startsWith(sa));
}

const byEmail = new Map();
const byPhone = new Map();
const groups = [];

for (const r of records) {
    let group = r.email ? byEmail.get(r.email) : null;

    const pk = phoneKey(r.phone);
    if (!group && pk) {
        const cand = byPhone.get(pk);
        if (cand && cand.rows.some(o => namesAgree(o.name, r.name))) group = cand;
    }

    if (!group) {
        group = { rows: [] };
        groups.push(group);
    }
    group.rows.push(r);

    if (r.email && !byEmail.has(r.email)) byEmail.set(r.email, group);
    if (pk && !byPhone.has(pk)) byPhone.set(pk, group);
}

const people = groups.filter(g => g.rows.length);
console.log(`Collapsed to ${people.length} distinct people (${records.length - people.length} rows folded in as repeat sheets / extra properties).\n`);

// --------------------------------------------------------------- build

// Which of a person's sheets becomes the lead. Prefer the most complete one,
// and among equals prefer an email the OCR pass read whole over one whose TLD
// this importer had to guess.
function completeness(r) {
    return (r.email ? 8 : 0) + (r.email && !r.emailRepaired ? 4 : 0)
        + (r.phone ? 2 : 0) + (r.street ? 2 : 0) + (r.city ? 1 : 0) + (r.zip ? 1 : 0);
}

const candidates = [];
for (const g of people) {
    const sorted = [...g.rows].sort((a, b) => completeness(b) - completeness(a));
    const primary = sorted[0];
    const others = sorted.slice(1);

    const noteParts = [];
    noteParts.push('Historical customer imported from the paper estimate stack photographed 2025-03-30. Actual job date not recorded on the sheet.');
    noteParts.push(`Source sheet: ${g.rows.map(r => r.sourceFile).join(', ')}`);

    const extraAddresses = [...new Set(others.map(r => r.rawAddress).filter(a => a && a !== primary.rawAddress))];
    if (extraAddresses.length) noteParts.push(`Other properties on file: ${extraAddresses.join(' | ')}`);

    const extraEmails = [...new Set(others.map(r => r.email).filter(e => e && e !== primary.email))];
    if (extraEmails.length) noteParts.push(`Alt emails: ${extraEmails.join(', ')}`);

    const altPhones = [...new Set([
        ...primary.altPhones,
        ...others.flatMap(r => [r.phone, ...r.altPhones]),
    ].filter(p => p && phoneKey(p) !== phoneKey(primary.phone)))];
    if (altPhones.length) noteParts.push(`Alt phones: ${altPhones.join(', ')}`);

    const extraNames = [...new Set(others.map(r => r.name).filter(n => n.toLowerCase() !== primary.name.toLowerCase()))];
    if (extraNames.length) noteParts.push(`Also written as: ${extraNames.join(', ')}`);

    const allFlags = [...new Set(g.rows.map(r => r.flags).filter(Boolean))];
    if (allFlags.length) noteParts.push(`OCR review notes: ${allFlags.join(' || ')}`);

    if (primary.nameMissing) noteParts.push('NOTE: no legible name on the sheet -- fill this in from the photo BEFORE including this record in an email campaign, the greeting renders the name field verbatim.');
    if (primary.emailRepaired) noteParts.push('NOTE: email domain was completed by the importer (handwriting omitted the TLD) -- verify before relying on it.');
    if (primary.email && !primary.emailValid) noteParts.push('NOTE: email address is malformed and will not deliver -- needs manual correction.');
    if (!primary.email) noteParts.push('NOTE: no email on the sheet -- not reachable by email campaign.');
    if (!primary.phone) noteParts.push('NOTE: no phone on the sheet.');
    if (primary.phone && !phoneKey(primary.phone)) noteParts.push('NOTE: phone number is incomplete on the sheet -- needs manual correction.');
    if (!primary.street) noteParts.push('NOTE: no address on the sheet.');

    candidates.push({
        name: primary.name,
        email: primary.email,
        phone: primary.phone,
        address: primary.street,
        city: primary.city,
        state: primary.state,
        zip: primary.zip,
        notes: noteParts.join('\n'),
        emailUsable: !!primary.email && primary.emailValid,
        emailRepaired: primary.emailRepaired,
        nameMissing: primary.nameMissing,
        sheets: g.rows.map(r => r.sourceFile),
    });
}

// ------------------------------------------------------- dedupe vs. DB

// Journal mode is deliberately left alone -- database.js sets WAL on every
// server boot, and this script has no business changing how the live DB
// journals underneath a running process.
const db = new Database(dbPath);

const leadCols = new Set(db.pragma('table_info(leads)').map(c => c.name));
// The lifecycle columns are added by database.js migrations on server boot.
// Without paid_at a "paid" lead never shows up on /customers, so that one is
// non-negotiable; business_unit is newer and simply omitted if absent.
for (const required of ['status', 'paid_at', 'completed_at']) {
    if (!leadCols.has(required)) {
        console.error(`leads.${required} is missing -- this database predates the lifecycle migration.`);
        console.error('Start the server once so database.js runs its migrations, then re-run this import.');
        process.exit(1);
    }
}
const hasBusinessUnit = leadCols.has('business_unit');
const hasReferralSource = leadCols.has('referral_source');

const existing = db.prepare('SELECT id, name, email, phone, address FROM leads WHERE deleted_at IS NULL').all();
const existingEmail = new Map();
const existingPhone = new Map();
const existingNameAddr = new Map();
for (const l of existing) {
    const e = (l.email || '').trim().toLowerCase();
    if (e) existingEmail.set(e, l);
    const p = phoneKey(l.phone);
    if (p) existingPhone.set(p, l);
    const na = (l.name || '').trim().toLowerCase() + '|' + (l.address || '').trim().toLowerCase();
    if (na !== '|') existingNameAddr.set(na, l);
}
console.log(`Existing leads in DB: ${existing.length}\n`);

const toInsert = [];
const collisions = [];
for (const c of candidates) {
    const hit =
        (c.email && existingEmail.get(c.email)) ||
        (phoneKey(c.phone) && existingPhone.get(phoneKey(c.phone))) ||
        existingNameAddr.get(c.name.toLowerCase() + '|' + c.address.toLowerCase());
    if (hit) collisions.push({ candidate: c, existing: hit });
    else toInsert.push(c);
}

// ------------------------------------------------------------- summary

const noEmail = toInsert.filter(c => !c.email).length;
const badEmail = toInsert.filter(c => c.email && !c.emailUsable).length;
const mailable = toInsert.filter(c => c.emailUsable).length;
const repaired = toInsert.filter(c => c.emailRepaired).length;
const noCity = toInsert.filter(c => !c.city).length;
const noPhoneN = toInsert.filter(c => !phoneKey(c.phone)).length;

console.log('--- Plan ---');
console.log(`  New leads to insert:        ${toInsert.length}`);
console.log(`  Already in CRM (skipped):   ${collisions.length}`);
console.log(`  Mailable (valid email):     ${mailable}`);
console.log(`    of which TLD was guessed: ${repaired}`);
console.log(`    no email on sheet:        ${noEmail}`);
console.log(`    malformed email:          ${badEmail}`);
console.log(`  Missing phone:              ${noPhoneN}`);
console.log(`  City not resolved:          ${noCity}`);
console.log('');

if (collisions.length) {
    console.log('--- Already in CRM ---');
    collisions.slice(0, 25).forEach(({ candidate, existing }) =>
        console.log(`  ${candidate.name} <${candidate.email || 'no email'}>  ->  existing lead "${existing.name}" (${existing.id})`));
    if (collisions.length > 25) console.log(`  ... and ${collisions.length - 25} more`);
    console.log('');
}

const unnamed = toInsert.filter(c => c.nameMissing);
if (unnamed.length) {
    console.log('--- NEEDS A NAME before any campaign send (greeting renders leads.name verbatim) ---');
    unnamed.forEach(c => console.log(`  ${c.name}  <${c.email || 'no email'}>  ${c.address}, ${c.city} ${c.zip}`));
    console.log('');
}

if (noCity) {
    console.log('--- City not resolved (address kept verbatim in the street field) ---');
    toInsert.filter(c => !c.city).forEach(c => console.log(`  ${c.name}: "${c.address}" ${c.zip}`));
    console.log('');
}

// Write the full plan out so it can be eyeballed before --commit. It goes
// beside the CSV, which is the one directory we know exists and is already
// the right place for it: the plan carries the same customer PII, and on the
// dev box that folder is gitignored for exactly that reason.
const reportPath = path.join(path.dirname(path.resolve(csvPath)), 'import-plan.csv');
const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const report = ['action,name,email,email_usable,phone,address,city,state,zip,source_sheets']
    .concat(toInsert.map(c => ['insert', c.name, c.email, c.emailUsable, c.phone, c.address, c.city, c.state, c.zip, c.sheets.join(' ')].map(esc).join(',')))
    .concat(collisions.map(({ candidate: c, existing: e }) => ['skip-existing:' + e.id, c.name, c.email, c.emailUsable, c.phone, c.address, c.city, c.state, c.zip, c.sheets.join(' ')].map(esc).join(',')))
    .join('\n');
// The plan is a convenience, not the job. Never let an unwritable directory
// stop an import that is otherwise ready to run.
try {
    fs.writeFileSync(reportPath, report);
    console.log(`Full plan written to: ${reportPath}\n`);
} catch (e) {
    console.log(`Could not write the plan file to ${reportPath} (${e.code}) -- continuing anyway.\n`);
}

// -------------------------------------------------------------- insert

if (!commit) {
    console.log('Dry run -- nothing written. Re-run with --commit to apply.');
    db.close();
    process.exit(0);
}

const optionalCols = [
    hasReferralSource ? ["referral_source", "'past_customer'"] : null,
    hasBusinessUnit ? ['business_unit', "'honestroof'"] : null,
].filter(Boolean);

const insertLead = db.prepare(`
    INSERT INTO leads (
        id, name, email, phone, address, city, state, zip,
        source_channel, source_details, status, priority, assigned_to,
        notes, ${optionalCols.map(c => c[0] + ', ').join('')}
        created_at, updated_at, contacted_at, quoted_at, accepted_at,
        scheduled_at, completed_at, paid_at
    ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        'manual', ?, 'paid', 'warm', 'Dennis',
        ?, ${optionalCols.map(c => c[1] + ', ').join('')}
        ?, datetime('now'), ?, ?, ?,
        ?, ?, ?
    )
`);

const insertInteraction = db.prepare(`
    INSERT INTO interactions (id, lead_id, type, direction, summary, logged_by, created_at)
    VALUES (?, ?, 'system', 'internal', ?, 'import', ?)
`);

// Append-only guard. This script issues nothing but SELECT and INSERT, but on
// a live production database "it should only append" is worth enforcing rather
// than trusting: count every lead and interaction before and after, and if the
// arithmetic does not come out to exactly the rows we meant to add, throw so
// better-sqlite3 rolls the whole transaction back.
const countLeads = db.prepare('SELECT COUNT(*) c FROM leads');
const countInteractions = db.prepare('SELECT COUNT(*) c FROM interactions');
const leadsBefore = countLeads.get().c;
const interactionsBefore = countInteractions.get().c;

const run = db.transaction(items => {
    for (const c of items) {
        const id = randomUUID();
        insertLead.run(
            id, c.name, c.email || null, c.phone || null,
            c.address || null, c.city || null, c.state, c.zip || null,
            SOURCE_TAG, c.notes,
            RECORD_DATE, RECORD_DATE, RECORD_DATE, RECORD_DATE,
            RECORD_DATE, RECORD_DATE, RECORD_DATE
        );
        insertInteraction.run(
            randomUUID(), id,
            `Imported from paper estimate sheet ${c.sheets.join(', ')} (historical customer, closed sale).`,
            RECORD_DATE
        );
    }

    const leadsAfter = countLeads.get().c;
    const interactionsAfter = countInteractions.get().c;
    if (leadsAfter !== leadsBefore + items.length) {
        throw new Error(`Append-only check FAILED: leads went ${leadsBefore} -> ${leadsAfter}, expected ${leadsBefore + items.length}. Rolling back, nothing was written.`);
    }
    if (interactionsAfter !== interactionsBefore + items.length) {
        throw new Error(`Append-only check FAILED: interactions went ${interactionsBefore} -> ${interactionsAfter}, expected ${interactionsBefore + items.length}. Rolling back, nothing was written.`);
    }
});

try {
    run(toInsert);
} catch (e) {
    console.error(`\n${e.message}`);
    db.close();
    process.exit(1);
}

const allLeads = countLeads.get().c;
const total = db.prepare('SELECT COUNT(*) c FROM leads WHERE deleted_at IS NULL').get().c;
const paid = db.prepare("SELECT COUNT(*) c FROM leads WHERE deleted_at IS NULL AND status = 'paid'").get().c;
const tagged = db.prepare('SELECT COUNT(*) c FROM leads WHERE source_details = ?').get(SOURCE_TAG).c;

console.log('--- Committed ---');
console.log(`  Inserted:                    ${toInsert.length}`);
console.log(`  Total lead rows before/after: ${leadsBefore} -> ${allLeads} (append-only check passed)`);
console.log(`  Active leads in DB now:      ${total}`);
console.log(`  Status "paid":               ${paid}`);
console.log(`  Tagged ${SOURCE_TAG}:  ${tagged}`);

db.close();
