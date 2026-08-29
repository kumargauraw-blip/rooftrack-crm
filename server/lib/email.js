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
 * @param {boolean} [opts.skipBcc]    suppress the always-on Dennis BCC. Only for
 *                                    bulk campaign sends, where one BCC per
 *                                    recipient means hundreds of copies in his
 *                                    inbox. Those send him a single summary at
 *                                    the end instead (see routes/campaigns.js).
 *                                    Transactional mail must never set this.
 * @returns {Promise<{ok:boolean, status?:number, error?:string, messageId?:string, retryAfterMs?:number}>}
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
    if (!opts.skipBcc) addBcc(dennisBcc, 'Dennis Harrison');
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
        // 15s timeout - if SendLayer is slow or stuck we want to log and
        // move on, not hang the request indefinitely. Important because
        // callers like the Retell webhook need to return 200 to the
        // upstream within Retell's own retry budget.
        const res = await fetch(SENDLAYER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
            const body = await res.text();
            // On 429 SendLayer may tell us how long to wait. Honour it when
            // present so retries back off by the provider's own clock rather
            // than a number we guessed.
            let retryAfterMs;
            const ra = res.headers.get('retry-after');
            if (ra) {
                const secs = Number(ra);
                if (Number.isFinite(secs)) retryAfterMs = secs * 1000;
                else {
                    const when = Date.parse(ra);
                    if (!Number.isNaN(when)) retryAfterMs = Math.max(0, when - Date.now());
                }
            }
            return {
                ok: false,
                status: res.status,
                error: `HTTP ${res.status}: ${body.substring(0, 300)}`,
                ...(retryAfterMs !== undefined && { retryAfterMs }),
            };
        }

        const data = await res.json().catch(() => ({}));
        return { ok: true, messageId: data.MessageID };
    } catch (err) {
        return { ok: false, error: err.message || 'Unknown email error' };
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * sendEmail, but retrying when the provider rate-limits us (HTTP 429) or has a
 * transient server error (5xx).
 *
 * A fixed inter-send delay alone cannot solve rate limiting: the safe rate is
 * whatever SendLayer says it is on the day, and a delay tuned for one plan
 * silently breaks on another. Backing off when actually told to is what makes
 * a large send survive. 4xx errors other than 429 (bad address, rejected
 * sender) are permanent and returned immediately -- retrying those just burns
 * time and makes the campaign look slow.
 *
 * @param {object} opts             same shape as sendEmail
 * @param {object} [cfg]
 * @param {number} [cfg.retries]    max retry attempts after the first try
 * @param {number} [cfg.baseDelay]  first backoff step in ms, doubled each retry
 * @param {function} [cfg.onRetry]  called as ({attempt, waitMs, status}) before sleeping
 */
async function sendEmailWithRetry(opts, cfg = {}) {
    const retries = cfg.retries ?? 4;
    const baseDelay = cfg.baseDelay ?? 2000;

    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
        last = await sendEmail(opts);
        if (last.ok) return { ...last, attempts: attempt + 1 };

        const retryable = last.status === 429 || (last.status >= 500 && last.status < 600);
        if (!retryable || attempt === retries) break;

        // Honour Retry-After when given, else exponential backoff.
        const waitMs = last.retryAfterMs ?? baseDelay * Math.pow(2, attempt);
        cfg.onRetry?.({ attempt: attempt + 1, waitMs, status: last.status });
        await sleep(waitMs);
    }
    return { ...last, attempts: retries + 1 };
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

module.exports = { sendEmail, sendEmailWithRetry, renderTemplate };
