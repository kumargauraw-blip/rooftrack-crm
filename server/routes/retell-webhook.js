'use strict';

/**
 * Retell post-call webhook for the "Rufus" voice assistant.
 *
 * Replaces the standalone honestroof_rufus_webhook service. This version
 * (a) lands the lead in the CRM so it appears on the kanban under
 * source_channel='voice_assistant_rufus' and is searchable by the
 * Telegram bot, and (b) sends Dennis a notification email (the existing
 * shared sendEmail() BCCs him automatically; for this notification we
 * also address it To: him directly so it lands in his inbox).
 *
 * Flow:
 *   1. Verify x-retell-signature header against RETELL_API_KEY
 *   2. Gate: event=call_analyzed, right agent, customer_info_collected,
 *      qualified_roofing_lead truthy, at least one contact method
 *   3. Idempotency: skip if a lead with this call_id already exists
 *   4. INSERT lead with source_channel='voice_assistant_rufus'
 *   5. Send Dennis the notification email
 *
 * Autoresponder behavior: fires the same "new_lead" campaign the
 * website uses, but only if Rufus actually captured a syntactically
 * valid email address. Rationale: Rufus's call flow explicitly tells
 * the caller "You should receive an email shortly letting you know
 * your estimate is in progress" - so not sending the email would
 * leave a promise broken. The looksLikeEmail() check in autoresponder.js
 * defends against speech-to-text garbage.
 *
 * Required env:
 *   RETELL_API_KEY     - also used for webhook signature verification
 *   RETELL_AGENT_ID    - the Rufus agent to accept calls from
 *   CRM_BCC_EMAIL      - Dennis's email (default dennis@honestroof.com)
 *   SENDLAYER_API_KEY  - already used by the rest of the CRM
 *   SENDLAYER_FROM_EMAIL
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { verify: verifyRetellWebhook } = require('retell-sdk');
const { getDb } = require('../db/database');
const { sendEmail } = require('../lib/email');
const { fireNewLeadAutoresponder } = require('../lib/autoresponder');

// ---- helpers (mostly lifted from the standalone webhook, refactored
// for our coding style and to remove duplicated escape logic) ----

const CONTACT_FIELDS = ['customer_phone', 'customer_email'];

const FIELD_LABELS = {
    customer_name: 'Customer Name',
    customer_phone: 'Customer Phone',
    customer_email: 'Customer Email',
    property_address_or_area: 'Property / Area',
    project_type: 'Project Type',
    service_requested: 'Service Requested',
    roofing_need: 'Roofing Need',
    urgency: 'Urgency',
    preferred_callback_time: 'Preferred Callback Time',
    qualified_roofing_lead: 'Qualified Lead',
    other_project_mentioned: 'Other Project Mentioned',
    summary_for_team: 'Summary',
    recommended_next_action: 'Recommended Next Action',
};

/**
 * Rufus silently classifies every call as roofing work or other property
 * work (`project_type`). Map that to the business that owns the lead.
 *
 * Anything unrecognised — including calls from an older agent version that
 * never emitted `project_type` — falls back to 'honestroof'. That is the
 * safe default: it preserves the previous behaviour exactly.
 */
function resolveBusinessUnit(data = {}) {
    return cleanString(data.project_type).toLowerCase() === 'other_services'
        ? 'coffee_project'
        : 'honestroof';
}

function cleanString(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
    return cleanString(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isTruthy(value) {
    if (value === true) return true;
    if (typeof value === 'string') return ['true', 'yes', 'y', '1'].includes(value.trim().toLowerCase());
    return false;
}

function getCustomAnalysisData(call = {}) {
    return (
        call.call_analysis?.custom_analysis_data ||
        call.call_analysis?.custom_data ||
        call.custom_analysis_data ||
        {}
    );
}

function hasReliableContact(data = {}, call = {}) {
    if (CONTACT_FIELDS.some((field) => cleanString(data[field]))) return true;
    if (cleanString(call.from_number)) return true;
    return false;
}

function shouldSendLeadEmail(payload = {}) {
    if (payload.event !== 'call_analyzed') return { send: false, reason: 'ignored_event' };
    const call = payload.call || {};
    const expectedAgentId = process.env.RETELL_AGENT_ID;
    if (expectedAgentId && call.agent_id && call.agent_id !== expectedAgentId) {
        return { send: false, reason: 'wrong_agent' };
    }
    const data = getCustomAnalysisData(call);
    if (!isTruthy(data.customer_info_collected)) {
        return { send: false, reason: 'customer_info_not_collected' };
    }
    // If qualified_roofing_lead is omitted entirely, treat as qualified
    // (the Rufus prompt may not always emit this field). If present and
    // explicitly false, skip.
    if (data.qualified_roofing_lead !== undefined && !isTruthy(data.qualified_roofing_lead)) {
        return { send: false, reason: 'not_qualified_roofing_lead' };
    }
    if (!hasReliableContact(data, call)) return { send: false, reason: 'missing_contact_method' };
    return { send: true, reason: 'qualified_lead' };
}

function urgencyToPriority(urgency) {
    const u = cleanString(urgency).toLowerCase();
    if (!u) return 'warm';
    if (/(asap|urgent|emergency|today|leak|immediate)/i.test(u)) return 'hot';
    if (/(this week|few days|soon|days)/i.test(u)) return 'warm';
    return 'cold';
}

function buildEmail(payload = {}, businessUnit = 'honestroof') {
    const call = payload.call || {};
    const data = getCustomAnalysisData(call);
    const subjectName =
        cleanString(data.customer_name) ||
        cleanString(data.customer_phone) ||
        cleanString(call.from_number) ||
        'New caller';
    const isRoofing = businessUnit === 'honestroof';
    const subject = isRoofing
        ? `New HonestRoof Lead via Voice Assistant Rufus: ${subjectName}`
        : `New NON-ROOFING Lead via Rufus (Coffee & Project): ${subjectName}`;
    const heading = isRoofing
        ? 'New HonestRoof Lead via Voice Assistant Rufus'
        : 'New Non-Roofing Lead via Voice Assistant Rufus';
    const blurb = isRoofing
        ? 'Rufus collected an identified roofing lead. Please review and follow up.'
        : 'Rufus collected a NON-ROOFING lead - this one is for Coffee &amp; Project. '
          + 'No roofing estimate email was sent to the customer, so they are expecting a call.';

    const rows = [
        ['Source', 'Voice Assistant Rufus'],
        ['Business', isRoofing ? 'HonestRoof (roofing)' : 'Coffee & Project (non-roofing)'],
        ['Call ID', cleanString(call.call_id) || 'unknown'],
        ['Direction', cleanString(call.direction) || 'unknown'],
        ['Caller Number', cleanString(call.from_number) || 'not provided'],
        ['Disconnection Reason', cleanString(call.disconnection_reason) || 'not provided'],
    ];

    for (const [field, label] of Object.entries(FIELD_LABELS)) {
        const value = cleanString(data[field]);
        if (value) rows.push([label, value]);
    }

    const tableRows = rows
        .map(
            ([label, value]) =>
                `<tr><th align="left" style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top;">${escapeHtml(label)}</th><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(value)}</td></tr>`,
        )
        .join('\n');
    const transcript = cleanString(call.transcript);
    const html = `<!doctype html>
<html><body style="font-family:Arial,sans-serif;line-height:1.45;color:#111;">
  <h2>${escapeHtml(heading)}</h2>
  <p>${blurb}</p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${tableRows}</table>
  ${transcript ? `<h3>Transcript</h3><pre style="white-space:pre-wrap;background:#f7f7f7;padding:12px;border-radius:6px;">${escapeHtml(transcript)}</pre>` : ''}
</body></html>`;
    const plain = [
        heading,
        blurb.replace(/&amp;/g, '&'),
        '',
        ...rows.map(([label, value]) => `${label}: ${value}`),
        transcript ? `\nTranscript:\n${transcript}` : '',
    ]
        .filter(Boolean)
        .join('\n');

    return { subject, html, plain };
}

// ---- the route ----

router.post('/', async (req, res) => {
    // 1. Verify signature against the raw request body. index.js sets up
    // express.json() with a verify hook that stashes req.rawBody for us.
    const apiKey = process.env.RETELL_API_KEY;
    const signature = req.headers['x-retell-signature'];
    if (!apiKey) {
        console.error('[RETELL WEBHOOK] missing RETELL_API_KEY env');
        return res.status(500).json({ ok: false, reason: 'misconfigured' });
    }
    if (!signature) return res.status(401).json({ ok: false, reason: 'missing_signature' });
    if (!req.rawBody) {
        console.error('[RETELL WEBHOOK] req.rawBody not captured - check express.json verify hook in index.js');
        return res.status(500).json({ ok: false, reason: 'raw_body_missing' });
    }
    if (!verifyRetellWebhook(req.rawBody, apiKey, signature)) {
        return res.status(401).json({ ok: false, reason: 'invalid_signature' });
    }

    try {
        // 2. Gate: is this actually a qualified Rufus lead worth acting on?
        const payload = req.body || {};
        const decision = shouldSendLeadEmail(payload);
        if (!decision.send) {
            console.log(`[RETELL WEBHOOK] no-op: ${decision.reason} (call_id=${payload.call?.call_id || 'unknown'})`);
            return res.json({ ok: true, sent: false, reason: decision.reason });
        }

        // 3. Pull out fields for the lead row.
        const call = payload.call || {};
        const data = getCustomAnalysisData(call);
        const callId = cleanString(call.call_id) || null;
        const db = getDb();

        // Pre-flight idempotency check. Cheap path - DB unique index is
        // the actual guarantee below.
        if (callId) {
            const existing = db
                .prepare('SELECT id FROM leads WHERE retell_call_id = ?')
                .get(callId);
            if (existing) {
                console.log(`[RETELL WEBHOOK] duplicate call_id ${callId}; lead ${existing.id} already created`);
                return res.json({ ok: true, sent: false, reason: 'duplicate_call_id', lead_id: existing.id });
            }
        }

        const leadId = crypto.randomUUID();
        const name =
            cleanString(data.customer_name) ||
            cleanString(data.customer_phone) ||
            cleanString(call.from_number) ||
            'New caller (Rufus)';
        const phone = cleanString(data.customer_phone) || cleanString(call.from_number) || null;
        const email = cleanString(data.customer_email) || null;
        const address = cleanString(data.property_address_or_area) || null;
        const priority = urgencyToPriority(data.urgency);
        const businessUnit = resolveBusinessUnit(data);

        // Stash everything we don't have a dedicated column for in notes,
        // so Dennis can see it on the lead detail page.
        const noteParts = [];
        if (businessUnit === 'coffee_project') {
            noteParts.push('NON-ROOFING lead — Coffee & Project. No roofing estimate email was sent to the customer.');
        }
        if (data.service_requested) noteParts.push(`Service requested: ${cleanString(data.service_requested)}`);
        if (data.other_project_mentioned) noteParts.push(`Also mentioned: ${cleanString(data.other_project_mentioned)}`);
        if (data.roofing_need) noteParts.push(`Roofing need: ${cleanString(data.roofing_need)}`);
        if (data.urgency) noteParts.push(`Urgency: ${cleanString(data.urgency)}`);
        if (data.preferred_callback_time) noteParts.push(`Preferred callback: ${cleanString(data.preferred_callback_time)}`);
        if (data.summary_for_team) noteParts.push(`Summary: ${cleanString(data.summary_for_team)}`);
        if (data.recommended_next_action) noteParts.push(`Next action: ${cleanString(data.recommended_next_action)}`);
        if (callId) noteParts.push(`Retell call_id: ${callId}`);
        const notes = noteParts.join('\n');

        // 4. Insert the lead. The UNIQUE INDEX on retell_call_id catches
        // any race where two webhook deliveries arrive within milliseconds.
        try {
            db.prepare(
                `INSERT INTO leads (id, name, phone, email, address, source_channel, business_unit, priority, notes, retell_call_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'voice_assistant_rufus', ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            ).run(leadId, name, phone, email, address, businessUnit, priority, notes, callId);
        } catch (e) {
            if (/UNIQUE/i.test(String(e.message))) {
                console.log(`[RETELL WEBHOOK] race on call_id ${callId}, treating as duplicate`);
                return res.json({ ok: true, sent: false, reason: 'duplicate_call_id_race' });
            }
            throw e;
        }

        // 5. Log the interaction for the lead detail timeline.
        db.prepare(
            `INSERT INTO interactions (id, lead_id, type, summary) VALUES (?, ?, 'system', ?)`,
        ).run(
            crypto.randomUUID(),
            leadId,
            businessUnit === 'coffee_project'
                ? `Non-roofing lead captured by Rufus for Coffee & Project${callId ? ` (call_id ${callId})` : ''}`
                : `Lead captured by Rufus voice assistant${callId ? ` (call_id ${callId})` : ''}`,
        );

        // 6. Fire the new-lead autoresponder — ROOFING LEADS ONLY.
        // The active new_lead campaign is the roofing "your estimate is in
        // progress" email. Sending that to someone who called about a fence,
        // a water heater or a kitchen remodel is wrong and confusing, so
        // non-roofing leads are skipped: Dennis gets the notification email
        // in step 7 and his team follows up directly. When Coffee & Project
        // has its own campaign, route to it here instead of skipping.
        if (businessUnit === 'honestroof') {
            // Fire-and-forget via setImmediate so a slow SendLayer can't push
            // us past Retell's webhook timeout (10s).
            setImmediate(() => {
                fireNewLeadAutoresponder(db, {
                    id: leadId,
                    name,
                    phone,
                    email,
                    address,
                }).catch((err) => {
                    console.error('[RETELL WEBHOOK] autoresponder unhandled:', err);
                });
            });
        } else {
            console.log(`[RETELL WEBHOOK] roofing autoresponder suppressed for lead ${leadId} (business_unit=${businessUnit})`);
        }

        // 7. Email Dennis. We send TO him (not via the implicit BCC that
        // sendEmail adds for customer emails) because this email is FOR
        // Dennis. sendEmail still tries to BCC him - the dedupe Set in
        // there will skip the BCC since he's already the To: recipient.
        const dennisEmail = process.env.CRM_BCC_EMAIL || 'dennis@honestroof.com';
        const built = buildEmail(payload, businessUnit);
        const emailResult = await sendEmail({
            toEmail: dennisEmail,
            toName: 'Dennis Harrison',
            subject: built.subject,
            htmlContent: built.html,
            textContent: built.plain,
        });
        if (!emailResult.ok) {
            // Lead is already saved; surface the email failure but don't
            // 500 (Retell would retry, and we'd skip-as-duplicate next time
            // anyway). Logging is enough for Dennis to notice later.
            console.error(`[RETELL WEBHOOK] email failed for lead ${leadId}:`, emailResult.error);
        }

        return res.json({
            ok: true,
            sent: emailResult.ok,
            lead_id: leadId,
            call_id: callId,
        });
    } catch (error) {
        console.error('[RETELL WEBHOOK ERROR]', error);
        return res.status(500).json({ ok: false, error: 'internal_error' });
    }
});

// Health probe so you can curl this endpoint from the box during setup.
router.get('/health', (req, res) => {
    res.json({
        ok: true,
        agent_id_configured: Boolean(process.env.RETELL_AGENT_ID),
        retell_key_configured: Boolean(process.env.RETELL_API_KEY),
    });
});

module.exports = router;

// Exported for tests / future reuse.
module.exports.shouldSendLeadEmail = shouldSendLeadEmail;
module.exports.buildEmail = buildEmail;
module.exports.urgencyToPriority = urgencyToPriority;
