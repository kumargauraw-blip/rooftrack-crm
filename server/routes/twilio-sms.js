'use strict';

/**
 * POST /api/webhooks/twilio-sms
 *
 * Inbound SMS bridge:
 *   1. Twilio POSTs the message here (application/x-www-form-urlencoded).
 *   2. Verify the X-Twilio-Signature header.
 *   3. Look up or create a Retell chat session for this sender's phone.
 *   4. Send the inbound text into the Retell chat agent (Roofus SMS).
 *   5. Get the agent's reply, send it back via Twilio's Messages API.
 *
 * Lead capture itself is handled OUT OF BAND: when Roofus collects the
 * four required fields he invokes the record_sms_lead custom function,
 * which Retell POSTs to /api/webhooks/retell-tools/record-sms-lead.
 * That endpoint inserts the CRM lead and emails Dennis. See
 * routes/retell-tools.js.
 *
 * Note about middleware: this route needs express.urlencoded(), not
 * express.json(), because Twilio sends form-encoded bodies. We apply
 * it at the route level so it doesn't interfere with the rest of the
 * API.
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { verifyTwilioSignature, sendSms } = require('../lib/twilio');
const { createChat, createChatCompletion } = require('../lib/retell-chat');

// 24h freshness window — silence longer than this starts a new chat.
const SESSION_FRESHNESS_MS = 24 * 60 * 60 * 1000;

router.post('/', express.urlencoded({ extended: false }), async (req, res) => {
    // Twilio expects an HTTP 200 (any 2xx) for "received". We respond
    // with empty TwiML at the very end. If anything throws, we still
    // 200 so Twilio doesn't pile on retries with the same message.
    const params = req.body || {};
    const from = params.From;
    const messageBody = (params.Body || '').trim();
    const messageSid = params.MessageSid;

    try {
        // 1. Signature verification. Twilio signs the EXACT URL it was
        // configured to call. Because LiteSpeed proxies to Node, what we
        // see in req.headers.host is the upstream (localhost:3001), not
        // the public hostname Twilio used. Two ways to fix:
        //   (a) Trust X-Forwarded-Host/Proto if LiteSpeed sets them.
        //   (b) Pin the URL via TWILIO_WEBHOOK_URL env (definitive -
        //       must match exactly what's saved in the Twilio console).
        // We try (b) first, then (a), then fall back to a guess. On
        // failure we log the URL we tried so you can compare it to the
        // URL pasted in the Twilio console.
        const sig = req.headers['x-twilio-signature'];
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const reconstructedUrl = `${proto}://${host}${req.originalUrl}`;
        const url = process.env.TWILIO_WEBHOOK_URL || reconstructedUrl;
        if (!verifyTwilioSignature(url, params, sig)) {
            console.warn(`[TWILIO SMS] invalid signature from ${from} sid=${messageSid} tried_url=${url}${url !== reconstructedUrl ? ` (header_reconstruction=${reconstructedUrl})` : ''}`);
            return res.status(401).send('<Response/>');
        }

        if (!from || !messageBody) {
            // Probably a delivery status callback, not a user message.
            return res.status(200).type('application/xml').send('<Response/>');
        }

        const db = getDb();

        // 2. Find or create a Retell chat session for this phone.
        const now = Date.now();
        const cutoffIso = new Date(now - SESSION_FRESHNESS_MS).toISOString();
        let session = db
            .prepare(`SELECT * FROM sms_chat_sessions WHERE phone = ? AND last_seen_at >= ?`)
            .get(from, cutoffIso);

        if (!session) {
            const created = await createChat();
            if (!created.ok) {
                console.error(`[TWILIO SMS] failed to create Retell chat: ${created.error}`);
                return res.status(200).type('application/xml').send('<Response/>');
            }
            const nowIso = new Date().toISOString();
            // Upsert pattern: if there's a stale row for this phone,
            // replace its retell_chat_id and reset state.
            db.prepare(`
                INSERT INTO sms_chat_sessions (phone, retell_chat_id, last_seen_at, created_at, status)
                VALUES (?, ?, ?, ?, 'active')
                ON CONFLICT(phone) DO UPDATE SET
                    retell_chat_id = excluded.retell_chat_id,
                    last_seen_at = excluded.last_seen_at,
                    created_at = excluded.created_at,
                    lead_id = NULL,
                    status = 'active'
            `).run(from, created.chat_id, nowIso, nowIso);
            session = { phone: from, retell_chat_id: created.chat_id };
            console.log(`[TWILIO SMS] new chat ${created.chat_id} for ${from}`);
        }

        // 3. Hand the user's message to Retell.
        const completion = await createChatCompletion(session.retell_chat_id, messageBody);
        if (!completion.ok) {
            console.error(`[TWILIO SMS] chat completion failed: ${completion.error}`);
            // Best-effort: tell the customer we'll follow up so the
            // conversation doesn't feel dead. Dennis will see the lead
            // is missing details and reach out manually.
            await sendSms({
                to: from,
                body: "Sorry, we're having a hiccup. We've noted your message and someone from HonestRoof will reach out shortly.",
            });
            return res.status(200).type('application/xml').send('<Response/>');
        }

        // 4. Push each agent reply back as SMS. Usually there's one,
        // but if Retell emits multiples we honor that.
        for (const reply of completion.replies) {
            const out = await sendSms({ to: from, body: reply });
            if (!out.ok) {
                console.error(`[TWILIO SMS] sendSms failed: ${out.error}`);
            }
        }

        // 5. Bump last_seen so the session stays fresh for 24h.
        db.prepare(`UPDATE sms_chat_sessions SET last_seen_at = ? WHERE phone = ?`)
            .run(new Date().toISOString(), from);

        return res.status(200).type('application/xml').send('<Response/>');
    } catch (err) {
        console.error('[TWILIO SMS] unhandled:', err);
        return res.status(200).type('application/xml').send('<Response/>');
    }
});

module.exports = router;
