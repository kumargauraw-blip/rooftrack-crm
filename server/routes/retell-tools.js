'use strict';

/**
 * POST /api/webhooks/retell-tools/record-sms-lead
 *
 * Invoked by Retell when the Roofus SMS chat agent calls the
 * record_sms_lead custom function. Retell's request body shape (per
 * their docs and observed behavior) is roughly:
 *
 *   {
 *     "name": "record_sms_lead",
 *     "args": { name, email, property_address, callback_phone },
 *     "call": { ... } | "chat": { chat_id, ... }
 *   }
 *
 * We accept defensively - args may be a stringified JSON or already
 * parsed, and the chat reference may be nested under different keys
 * across SDK versions.
 *
 * Behavior:
 *   1. Pull out the four fields plus the chat_id.
 *   2. Look up the SMS session by chat_id (or by callback_phone as
 *      fallback) so we can update its lead_id.
 *   3. INSERT a lead with source_channel='sms_assistant_rufus'.
 *   4. Email Dennis - flagged as SMS, needs fast follow-up.
 *   5. Return a small string Retell can read back to the customer.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { sendEmail } = require('../lib/email');

function cleanString(v) {
    if (v === undefined || v === null) return '';
    return String(v).replace(/\s+/g, ' ').trim();
}

function escapeHtml(v) {
    return cleanString(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseArgs(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return {}; }
}

function buildDennisEmail(lead, chatRef) {
    const subject = `New SMS Lead via Roofus: ${lead.name} — needs fast follow-up`;
    const rows = [
        ['Source', 'SMS Assistant (Roofus)'],
        ['Name', lead.name],
        ['Email', lead.email],
        ['Property Address', lead.address],
        ['Callback Phone', lead.phone],
        ['Retell chat_id', chatRef || 'unknown'],
    ];
    const tableRows = rows
        .map(([k, v]) => `<tr><th align="left" style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top;">${escapeHtml(k)}</th><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(v)}</td></tr>`)
        .join('\n');
    const html = `<!doctype html>
<html><body style="font-family:Arial,sans-serif;line-height:1.45;color:#111;">
  <h2>New SMS Lead via Roofus</h2>
  <p><strong>SMS leads need fast follow-up</strong> - the customer just confirmed their info via text and is waiting to hear back.</p>
  <p>The lead is in the CRM dashboard under New, source_channel <code>sms_assistant_rufus</code>. Please validate the details and call them.</p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${tableRows}</table>
</body></html>`;
    const plain = [
        'New SMS Lead via Roofus',
        'SMS leads need fast follow-up - the customer just confirmed their info via text and is waiting.',
        'The lead is in the CRM dashboard under New, source_channel sms_assistant_rufus.',
        '',
        ...rows.map(([k, v]) => `${k}: ${v}`),
    ].join('\n');
    return { subject, html, plain };
}

router.post('/record-sms-lead', async (req, res) => {
    try {
        const body = req.body || {};
        // Retell sends function args either as a parsed object or a
        // stringified JSON. Cover both. Also tolerate the args being at
        // the top level (some Retell variants flatten this).
        const args = parseArgs(body.args || body.arguments || body);
        const name = cleanString(args.name);
        const email = cleanString(args.email);
        const address = cleanString(args.property_address || args.address);
        const phone = cleanString(args.callback_phone || args.phone);

        // chat_id can live in body.chat.chat_id, body.chat_id, body.call.chat_id, etc.
        const chatId =
            cleanString(body.chat?.chat_id) ||
            cleanString(body.chat_id) ||
            cleanString(body.call?.chat_id) ||
            null;

        if (!name || !phone) {
            console.warn('[RETELL TOOL] record-sms-lead missing required fields', { name, phone });
            return res.json({ success: false, error: 'missing name or phone' });
        }

        const db = getDb();

        // Idempotency: if this chat already produced a lead, return that
        // one instead of inserting a duplicate (Retell may retry tool
        // calls on transient failures).
        if (chatId) {
            const existing = db
                .prepare(`SELECT lead_id FROM sms_chat_sessions WHERE retell_chat_id = ? AND lead_id IS NOT NULL`)
                .get(chatId);
            if (existing?.lead_id) {
                console.log(`[RETELL TOOL] duplicate record-sms-lead for chat ${chatId}, lead ${existing.lead_id} already exists`);
                return res.json({ success: true, lead_id: existing.lead_id, duplicate: true });
            }
        }

        const leadId = crypto.randomUUID();
        try {
            db.prepare(`
                INSERT INTO leads (id, name, phone, email, address, source_channel, status, priority, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'sms_assistant_rufus', 'new', 'hot', ?, datetime('now'), datetime('now'))
            `).run(
                leadId,
                name,
                phone,
                email || null,
                address || null,
                chatId ? `Retell chat_id: ${chatId}` : null,
            );
        } catch (e) {
            console.error('[RETELL TOOL] lead insert failed:', e.message);
            return res.status(500).json({ success: false, error: 'insert_failed' });
        }

        db.prepare(`INSERT INTO interactions (id, lead_id, type, summary) VALUES (?, ?, 'system', ?)`)
            .run(crypto.randomUUID(), leadId, `Lead captured by Roofus SMS assistant${chatId ? ` (chat_id ${chatId})` : ''}`);

        // Link the session row so future inbound messages on this chat
        // know a lead's been captured.
        if (chatId) {
            db.prepare(`UPDATE sms_chat_sessions SET lead_id = ?, status = 'lead_captured' WHERE retell_chat_id = ?`)
                .run(leadId, chatId);
        }

        // Email Dennis. Send TO him directly; sendEmail still BCCs him
        // but the dedupe Set prevents the duplicate.
        const dennisEmail = process.env.CRM_BCC_EMAIL || 'dennis@honestroof.com';
        const built = buildDennisEmail({ name, email, address, phone }, chatId);
        const emailResult = await sendEmail({
            toEmail: dennisEmail,
            toName: 'Dennis Harrison',
            subject: built.subject,
            htmlContent: built.html,
            textContent: built.plain,
        });
        if (!emailResult.ok) {
            console.error(`[RETELL TOOL] Dennis email failed for lead ${leadId}: ${emailResult.error}`);
        }

        // The string returned here is what Retell can read back to the
        // user via the tool result. Keep it terse.
        return res.json({
            success: true,
            lead_id: leadId,
            message: 'Lead captured. Dennis has been notified.',
        });
    } catch (err) {
        console.error('[RETELL TOOL] unhandled:', err);
        return res.status(500).json({ success: false, error: 'internal_error' });
    }
});

module.exports = router;
