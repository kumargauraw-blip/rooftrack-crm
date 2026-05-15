'use strict';

/**
 * New-lead autoresponder, shared between the website public-leads route
 * and the Retell voice-assistant webhook. Lifted out of public-leads.js
 * so voice-captured leads can fire the same configured campaign that
 * website-captured leads do.
 *
 * Fire-and-forget by design — any failure is logged but never blocks
 * the upstream HTTP response. Callers wrap this in setImmediate().
 */

const crypto = require('crypto');
const { sendEmail, renderTemplate } = require('./email');

// Simple email sanity check. Defends against speech-to-text garbage
// like "bob at the gmail" coming in from voice leads. Intentionally
// permissive - just enough to reject obviously broken strings before
// we hand them to SendLayer (which would 400 on them anyway and waste
// an API call).
function looksLikeEmail(s) {
    if (!s || typeof s !== 'string') return false;
    const t = s.trim();
    if (t.length < 5 || t.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

/**
 * Fire the active "new_lead" autoresponder for this lead.
 *
 * @param {object} db     better-sqlite3 instance
 * @param {object} lead   { id, name, phone, email, address }
 */
async function fireNewLeadAutoresponder(db, lead) {
    if (!looksLikeEmail(lead.email)) {
        // No email or unusable email - skip silently. Voice leads
        // often arrive without one and that's fine.
        return;
    }

    let campaign;
    try {
        campaign = db.prepare(`
            SELECT * FROM campaigns
            WHERE trigger_event = 'new_lead'
              AND is_active = 1
              AND status != 'failed'
            ORDER BY created_at DESC
            LIMIT 1
        `).get();
    } catch (err) {
        console.error('[AUTORESPONDER] lookup failed:', err.message);
        return;
    }
    if (!campaign) return; // no active autoresponder configured

    const vars = {
        name: lead.name || 'there',
        first_name: (lead.name || '').split(' ')[0] || 'there',
        phone: lead.phone || '',
        email: lead.email || '',
        address: lead.address || '',
    };

    const subject = renderTemplate(campaign.subject || '', vars);
    const htmlContent = renderTemplate(campaign.html_content || '', vars);
    const textContent = renderTemplate(campaign.text_content || '', vars);

    const result = await sendEmail({
        toEmail: lead.email,
        toName: lead.name,
        subject,
        htmlContent,
        textContent,
        fromEmail: campaign.from_email || undefined,
        fromName: campaign.from_name || undefined,
    });

    try {
        if (result.ok) {
            console.log(`[AUTORESPONDER] sent to ${lead.email} (messageId=${result.messageId || 'n/a'})`);
            db.prepare(`
                INSERT INTO interactions (id, lead_id, type, summary)
                VALUES (?, ?, 'system', ?)
            `).run(
                crypto.randomUUID(),
                lead.id,
                `Autoresponder email sent: "${subject.substring(0, 100)}"`,
            );
        } else {
            console.error(`[AUTORESPONDER] send failed for ${lead.email}: ${result.error}`);
            db.prepare(`
                INSERT INTO interactions (id, lead_id, type, summary)
                VALUES (?, ?, 'system', ?)
            `).run(
                crypto.randomUUID(),
                lead.id,
                `Autoresponder FAILED: ${(result.error || 'unknown').substring(0, 200)}`,
            );
        }
    } catch (logErr) {
        console.error('[AUTORESPONDER] interaction log failed:', logErr.message);
    }
}

module.exports = { fireNewLeadAutoresponder, looksLikeEmail };
