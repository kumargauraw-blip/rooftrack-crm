#!/usr/bin/env node
/**
 * Ingest real customer data from pipe-delimited file into RoofTrack CRM.
 * - Removes existing sample leads
 * - Parses and cleans customer records
 * - Skips duplicates (marked in notes) and UNREADABLE entries
 * - Sets all as status "completed" (past customers)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

// Use same DB path resolution as the app
const projectRoot = path.join(__dirname, '..');
const rawDbPath = process.env.DATABASE_PATH || './rooftrack.db';
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(projectRoot, rawDbPath);

console.log(`Database: ${dbPath}`);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Read the customer file
const dataFile = process.argv[2] || '/Users/govind/.openclaw-chanakya/media/inbound/9588f2cc-60ab-4a85-a577-812a232dcb85.txt';
const raw = fs.readFileSync(dataFile, 'utf8');
const lines = raw.trim().split('\n');

// Skip header
const header = lines[0]; // name|phone|email|company|title|address|notes
console.log(`Header: ${header}`);
console.log(`Total lines: ${lines.length - 1}`);

// Parse address into components
function parseAddress(addr) {
    if (!addr) return { address: '', city: '', state: 'TX', zip: '' };
    
    addr = addr.trim();
    
    // Common abbreviations in this dataset
    const cityAbbrevs = {
        'ARL': 'Arlington', 'Arl': 'Arlington', 'Arle': 'Arlington',
        'FTW': 'Fort Worth', 'Ftw': 'Fort Worth', 'FW': 'Fort Worth',
        'Ft Worth': 'Fort Worth', 'FW': 'Fort Worth',
        'GP': 'Grand Prairie', 'NRH': 'North Richland Hills',
        'ASN': 'Arlington', // likely typo for ARL
    };
    
    // Try to extract zip code
    let zip = '';
    const zipMatch = addr.match(/(\d{5})(?:\s*$|[,\s])/);
    if (zipMatch) {
        zip = zipMatch[1];
        addr = addr.replace(zipMatch[0], '').trim();
    }
    
    // Try to extract state
    let state = 'TX';
    const stateMatch = addr.match(/,?\s*(TX|Texas)\s*$/i);
    if (stateMatch) {
        addr = addr.replace(stateMatch[0], '').trim();
    }
    
    // Try to split street and city
    // Pattern: "street, city" or "street, city STATE ZIP"
    const parts = addr.split(',').map(p => p.trim());
    let street = parts[0] || '';
    let city = '';
    
    if (parts.length >= 2) {
        city = parts[parts.length - 1].trim();
        street = parts.slice(0, -1).join(', ').trim();
    }
    
    // Check for abbreviated cities and expand
    for (const [abbrev, full] of Object.entries(cityAbbrevs)) {
        if (city === abbrev) {
            city = full;
            break;
        }
        // Also check if city ends with the abbrev + zip was already stripped
        if (city.endsWith(` ${abbrev}`)) {
            city = city.replace(new RegExp(`\\s${abbrev}$`), ` ${full}`);
            break;
        }
    }
    
    // If no city found but zip exists, leave city empty
    if (!city && street) {
        // Try one more pattern: "123 Main St, Irving 75038"  
        // where city+zip were together
        const cityInStreet = street.match(/,\s*([A-Za-z\s]+?)\s*$/);
        if (cityInStreet) {
            city = cityInStreet[1].trim();
            street = street.replace(cityInStreet[0], '').trim();
        }
    }
    
    // Clean up trailing commas
    street = street.replace(/,\s*$/, '').trim();
    city = city.replace(/,\s*$/, '').trim();
    
    return { address: street, city: city || 'DFW Area', state, zip };
}

// Clean phone number - normalize format
function cleanPhone(phone) {
    if (!phone) return '';
    // Take first phone number if multiple (separated by ; or ,)
    phone = phone.split(';')[0].split(',')[0].trim();
    // Remove parens, dashes, spaces
    let digits = phone.replace(/[^0-9]/g, '');
    // Some entries have (8) instead of (817) - can't reliably fix those
    if (digits.length === 10) {
        return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
    }
    // Return cleaned but not reformatted if unusual length
    return phone.trim();
}

// Clean email
function cleanEmail(email) {
    if (!email) return '';
    email = email.trim();
    // Some have multiple emails separated by ;
    email = email.split(';')[0].trim();
    // Skip obviously broken emails
    if (!email.includes('@') && !email.includes('.')) return '';
    return email;
}

// Step 1: Remove existing sample/dummy leads and related data
console.log('\n--- Removing existing sample data ---');
const existingLeads = db.prepare('SELECT id FROM leads').all();
console.log(`Existing leads to remove: ${existingLeads.length}`);

db.exec('BEGIN TRANSACTION');
try {
    // Clear related tables first (FK constraints)
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM interactions');
    db.exec('DELETE FROM appointments');
    db.exec('DELETE FROM jobs');
    db.exec('DELETE FROM referral_incentives');
    db.exec('DELETE FROM referral_campaign_recipients');
    db.exec('DELETE FROM referral_campaigns');
    db.exec('DELETE FROM leads');
    db.exec('PRAGMA foreign_keys = ON');
    console.log('Cleared all existing leads and related data.');
    db.exec('COMMIT');
} catch (e) {
    db.exec('ROLLBACK');
    console.error('Failed to clear:', e.message);
    process.exit(1);
}

// Step 2: Parse and insert customers
console.log('\n--- Ingesting customers ---');

const insertLead = db.prepare(`
    INSERT INTO leads (id, name, email, phone, address, city, state, zip, 
        source_channel, source_details, status, priority, assigned_to, 
        notes, referral_source, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
`);

const insertInteraction = db.prepare(`
    INSERT INTO interactions (id, lead_id, type, summary, created_at)
    VALUES (?, ?, 'system', ?, datetime('now'))
`);

let inserted = 0;
let skipped = 0;
let duplicates = 0;
const seen = new Map(); // track by name+address for dedup

db.exec('BEGIN TRANSACTION');
try {
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const fields = line.split('|');
        if (fields.length < 7) {
            console.log(`  Skipping malformed line ${i}: ${line.substring(0, 50)}...`);
            skipped++;
            continue;
        }
        
        const [name, phone, email, company, title, rawAddress, notes] = fields.map(f => f ? f.trim() : '');
        
        // Skip UNREADABLE entries
        if (name === 'UNREADABLE' || name === '') {
            console.log(`  Skipping UNREADABLE/empty at line ${i}`);
            skipped++;
            continue;
        }
        
        // Skip entries marked as duplicates in notes
        if (notes && notes.toLowerCase().includes('duplicate')) {
            console.log(`  Skipping duplicate: ${name}`);
            duplicates++;
            continue;
        }
        
        // Dedup by name (keep first occurrence)
        const dedupKey = name.toLowerCase().trim();
        if (seen.has(dedupKey)) {
            // Check if same address - true duplicate
            const prev = seen.get(dedupKey);
            if (prev.address === rawAddress) {
                console.log(`  Dedup: ${name} (same address)`);
                duplicates++;
                continue;
            }
            // Different address = different property, allow it
        }
        seen.set(dedupKey, { address: rawAddress });
        
        const { address, city, state, zip } = parseAddress(rawAddress);
        const cleanedPhone = cleanPhone(phone);
        const cleanedEmail = cleanEmail(email);
        
        // Determine source from notes
        let source = 'manual';
        let sourceDetails = '';
        let referralSource = 'manual';
        if (notes && notes.toUpperCase().includes('ANGI')) {
            source = 'angi';
            sourceDetails = 'Angi lead';
            referralSource = 'angi';
        }
        
        // Build combined notes
        let fullNotes = '';
        const noteParts = [];
        if (company) noteParts.push(`Company: ${company}`);
        if (title) noteParts.push(`Title: ${title}`);
        if (notes) noteParts.push(notes);
        // Capture secondary phone numbers
        if (phone && phone.includes(';')) {
            const phones = phone.split(';').map(p => p.trim());
            if (phones.length > 1) {
                noteParts.push(`Alt phones: ${phones.slice(1).join(', ')}`);
            }
        }
        // Capture secondary emails
        if (email && email.includes(';')) {
            const emails = email.split(';').map(e => e.trim());
            if (emails.length > 1) {
                noteParts.push(`Alt emails: ${emails.slice(1).join(', ')}`);
            }
        }
        fullNotes = noteParts.join(' | ');
        
        const id = randomUUID();
        
        insertLead.run(
            id, name, cleanedEmail, cleanedPhone, address, city, state, zip,
            source, sourceDetails, 'completed', 'warm', 'Dennis',
            fullNotes || null, referralSource
        );
        
        // Log the import as an interaction
        insertInteraction.run(
            randomUUID(), id, 'Customer imported from business records'
        );
        
        inserted++;
    }
    
    db.exec('COMMIT');
} catch (e) {
    db.exec('ROLLBACK');
    console.error('Insert failed:', e.message);
    console.error(e.stack);
    process.exit(1);
}

console.log(`\n--- Results ---`);
console.log(`Inserted: ${inserted}`);
console.log(`Skipped: ${skipped}`);
console.log(`Duplicates: ${duplicates}`);
console.log(`Total in DB: ${db.prepare('SELECT count(*) as c FROM leads').get().c}`);

// Verify
console.log(`\n--- Sample customers ---`);
const sample = db.prepare('SELECT name, phone, city, status FROM leads LIMIT 5').all();
sample.forEach(r => console.log(`  ${r.name} | ${r.phone} | ${r.city} | ${r.status}`));

db.close();
console.log('\nDone!');
