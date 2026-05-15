'use strict';

/**
 * Twilio helpers: verify inbound webhook signatures, send outbound SMS.
 *
 * Required env:
 *   TWILIO_ACCOUNT_SID   - starts with AC...
 *   TWILIO_AUTH_TOKEN    - used both for signature verification and
 *                          Basic auth on the outbound Messages API
 *   TWILIO_FROM_NUMBER   - the E.164 phone number we send from
 *                          (e.g. +18178097000)
 */

const crypto = require('crypto');

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/**
 * Verify the X-Twilio-Signature header on an inbound webhook request.
 *
 * Algorithm (per Twilio docs): the signature is base64(HMAC-SHA1(
 *   url + sortedKey1 + value1 + sortedKey2 + value2 + ...,
 *   AUTH_TOKEN
 * )).
 *
 * @param {string} url        Full URL Twilio called (must include scheme + host + path + querystring)
 * @param {object} params     Form-encoded body params from req.body
 * @param {string} signature  Value of the X-Twilio-Signature header
 * @returns {boolean}
 */
function verifyTwilioSignature(url, params, signature) {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) return false;
    if (!signature) return false;

    const keys = Object.keys(params || {}).sort();
    let data = url;
    for (const k of keys) {
        data += k + (params[k] == null ? '' : String(params[k]));
    }

    const expected = crypto
        .createHmac('sha1', authToken)
        .update(Buffer.from(data, 'utf-8'))
        .digest('base64');

    // Constant-time comparison
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * Send an SMS via Twilio's Messages API.
 *
 * @param {object} opts
 * @param {string} opts.to     E.164 phone number to send to
 * @param {string} opts.body   Message text (Twilio handles segmentation)
 * @returns {Promise<{ok:boolean, sid?:string, error?:string, status?:number}>}
 */
async function sendSms({ to, body }) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;

    if (!sid || !token || !from) {
        return { ok: false, error: 'Twilio not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER)' };
    }

    const url = `${TWILIO_API_BASE}/Accounts/${sid}/Messages.json`;
    const form = new URLSearchParams();
    form.set('From', from);
    form.set('To', to);
    form.set('Body', body);

    const basicAuth = Buffer.from(`${sid}:${token}`).toString('base64');

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
            signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
            const text = await res.text();
            return { ok: false, status: res.status, error: `HTTP ${res.status}: ${text.substring(0, 300)}` };
        }
        const data = await res.json().catch(() => ({}));
        return { ok: true, sid: data.sid };
    } catch (err) {
        return { ok: false, error: err.message || 'Twilio fetch failed' };
    }
}

module.exports = { verifyTwilioSignature, sendSms };
