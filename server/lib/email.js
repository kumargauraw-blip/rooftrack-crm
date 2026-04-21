/**
 * SendLayer email client with automatic Dennis-BCC.
 *
 * Every outbound email from the CRM (autoresponders, manual campaigns,
 * future notification features) MUST go through this module so that
 * Dennis always gets a copy via BCC.
 *
 * Required env:
 *   SENDLAYER_API_KEY       — from SendLayer dashboard
 *   SENDLAYER_FROM_EMAIL    — verified sender, e.g. website@honestroof.com
 * Optional env:
 *   SENDLAYER_FROM_NAME     — default: "HonestRoof.com"
 *   CRM_BCC_EMAIL           — default: "dennis@honestroof.com"
 */

const SENDLAYER_API_URL = 'https://console.sendlayer.com/api/v1/email';

/**
 * @param {object} opts
 * @param {string} opts.toEmail
 * @param {string} [opts.toName]
 * @param {string} opts.subject
 * @param {string} opts.htmlContent
 * @param {string} [opts.textContent]
 * @param {string} [opts.fromEmail]   per-send override of SENDLAYER_FROM_EMAIL
 * @param {string} [opts.fromName]    per-send override of SENDLAYER_FROM_NAME
 * @param {string[]} [opts.extraBcc]  additional BCC addresses on top of the
 *                                    always-on CRM_BCC_EMAIL
 * @returns {Promise<{ok:boolean, status?:number, error?:string, messageId?:string}>}
 */
async function sendEmail(opts) {
    const apiKey = process.env.SENDLAYER_API_KEY;
    const fromEmail = opts.fromEmail || process.env.SENDLAYER_FROM_EMAIL;
    const fromName = opts.fromName || process.env.SENDLAYER_FROM_NAME || 'HonestRoof.com';
    const dennisBcc = process.env.CRM_BCC_EMAIL || 'dennis@honestroof.com';

    if (!apiKey || !fromEmail) {
        return {
            ok: false,
            error: 'SendLayer not configured (missing SENDLAYER_API_KEY or SENDLAYER_FROM_EMAIL)',
        };
    }

    // Build BCC list: Dennis always, plus any caller-provided extras, minus
    // anyone who is already the direct recipient (SendLayer will 400 on dupes).
    const bccList = [];
    const seen = new Set([opts.toEmail.toLowerCase()]);
    const addBcc = (email, name) => {
        if (!email) return;
        const key = email.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        bccList.push({ name: name || '', email });
    };
    addBcc(dennisBcc, 'Dennis Harrison');
    if (Array.isArray(opts.extraBcc)) {
        for (const addr of opts.extraBcc) addBcc(addr);
    }

    const payload = {
        From: { name: fromName, email: fromEmail },
        To: [{ name: opts.toName || '', email: opts.toEmail }],
        Subject: opts.subject || '',
        ContentType: 'HTML',
        HTMLContent: opts.htmlContent || '',
        PlainContent: opts.textContent || '',
        ...(bccList.length > 0 && { BCC: bccList }),
    };

    try {
        const res = await fetch(SENDLAYER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const body = await res.text();
            return {
                ok: false,
                status: res.status,
                error: `HTTP ${res.status}: ${body.substring(0, 300)}`,
            };
        }

        const data = await res.json().catch(() => ({}));
        return { ok: true, messageId: data.MessageID };
    } catch (err) {
        return { ok: false, error: err.message || 'Unknown email error' };
    }
}

/**
 * Apply {{placeholder}} substitutions to a string template.
 * Unknown placeholders stay as-is.
 */
function renderTemplate(str, vars) {
    if (!str) return '';
    return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : `{{${key}}}`
    );
}

module.exports = { sendEmail, renderTemplate };
