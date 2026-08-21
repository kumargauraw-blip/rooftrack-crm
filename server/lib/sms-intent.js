'use strict';

/**
 * Inbound SMS triage for the Roofus SMS assistant.
 *
 * Roofus was replying to everything that hit the business line, including
 * lead-generation spam ("I can bring you 3-5 exclusive roofing leads daily")
 * and automated platform notifications from Yelp and Google Local Services.
 * The Yelp bots in particular got into 30-40 message loops with Roofus - two
 * robots texting each other, which is also exactly the traffic pattern that
 * puts an A2P campaign at risk.
 *
 * Triage runs BEFORE any Retell chat is created, so an ignored message costs
 * nothing and produces no reply at all.
 *
 * Design: deterministic fast paths first, LLM only for the ambiguous middle.
 *   1. Opt-out/help keywords   -> carrier handles them, we stay quiet
 *   2. Obvious customer intent -> ALWAYS respond, never ask the model
 *   3. Known bot signatures    -> ignore, never ask the model
 *   4. Everything else         -> classify with claude-haiku
 *
 * The bias is deliberately lopsided: we only stay silent when confident it is
 * junk. Anything unclear gets a reply, because a missed customer costs far
 * more than an unnecessary text.
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = 3000;

let client = null;
function getClient() {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return client;
}

/* ---------- 1. Carrier opt-out / help keywords ---------- */
// Twilio answers these at the carrier level for a registered A2P campaign.
// We must not spin up a chat or send our own reply on top of that.
const OPT_KEYWORDS = new Set([
    'stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit',
    'help', 'info', 'start', 'unstop',
]);

/* ---------- 2. Unambiguous customer intent ---------- */
// "ESTIMATE" is the keyword printed on the website, in the header/footer CTAs
// and registered with the A2P campaign - it must ALWAYS work, so it never
// depends on a model call or an API being up.
//
// IMPORTANT: these only short-circuit for SHORT messages. Lead-gen spam is
// full of roofing vocabulary ("I can bring you 3-5 exclusive roofing leads"),
// so a topical keyword inside a long pitch must NOT force a reply - those go
// to the classifier instead. A real customer texting the advertised keyword
// writes "Estimate", not three sentences about lead generation.
const SHORT_MESSAGE_CHARS = 60;
const CUSTOMER_SIGNALS = [
    /\bestimate\b/i,
    /\bquote\b/i,
    /\broof/i,
    /\bshingle/i,
    /\bleak/i,
    /\bhail\b/i,
    /\bstorm damage\b/i,
    /\bgutter/i,
    /\binspection\b/i,
    /\bmy (house|home|roof|property)\b/i,
    /\b(fence|plumb|hvac|air condition|electric|remodel|countertop|flooring|siding|window|door)/i,
    /\b\d{2,6}\s+[A-Za-z][A-Za-z.-]*\s+(st|street|rd|road|dr|drive|ln|lane|ave|avenue|blvd|ct|court|cir|circle|way|pkwy|trail|tr)\b/i,
    /\b\d{5}\b/,
];

/* ---------- 3. Known automated platform senders ---------- */
// Machine-generated notifications - never a customer talking to us.
const BOT_SIGNATURES = [
    /yelp.{0,3}s? customer success/i,
    /consultation with yelp/i,
    /opted in to texts from yelp/i,
    /google local services ads/i,
    /new message from a customer via google/i,
    /\bverification code\b/i,
    /\bone[- ]time (pass)?code\b/i,
];

/* ---------- 4. Known solicitation patterns ---------- */
// Deterministic backstop for the pitches that hit this line repeatedly, so
// they are still blocked even if the classifier is unavailable.
const SOLICITATION_SIGNATURES = [
    /exclusive\s+\w+\s+leads/i,
    /\b(i|we)\s+can\s+bring\s+you\s+\d/i,
    /bring you an extra\s+\d/i,
    /claim your free[^.]{0,40}listing/i,
    /appointment setter/i,
    /virtual assistant/i,
    /generate (organic |more )?leads/i,
    /partner with (companies|businesses) like yours/i,
    /drive new business/i,
    /grow your business/i,
    /\bseo\b/i,
    /keep your calendars full/i,
    /following up on (our|my) (message|email|text)/i,
    /\bno (upfront |setup )?cost\b.{0,40}\bleads?\b/i,
];

function normalise(text) {
    return String(text || '').trim();
}

/**
 * Deterministic pass. Returns a decision, or null when the LLM should judge.
 * @returns {{respond: boolean, reason: string, source: 'rule'}|null}
 */
function ruleVerdict(message) {
    const text = normalise(message);
    if (!text) return { respond: false, reason: 'empty_message', source: 'rule' };

    const bare = text.toLowerCase().replace(/[^a-z]/g, '');
    if (OPT_KEYWORDS.has(bare)) {
        return { respond: false, reason: 'carrier_keyword', source: 'rule' };
    }

    // Machine senders and known pitches lose outright, regardless of length.
    for (const re of BOT_SIGNATURES) {
        if (re.test(text)) return { respond: false, reason: 'platform_bot', source: 'rule' };
    }
    for (const re of SOLICITATION_SIGNATURES) {
        if (re.test(text)) return { respond: false, reason: 'solicitation', source: 'rule' };
    }

    // Only a SHORT message may be waved through on a keyword alone. Longer
    // messages go to the classifier even when they mention roofing.
    if (text.length <= SHORT_MESSAGE_CHARS) {
        for (const re of CUSTOMER_SIGNALS) {
            if (re.test(text)) return { respond: true, reason: 'customer_signal', source: 'rule' };
        }
    }
    return null; // ambiguous - hand to the model
}

const SYSTEM_PROMPT = `You classify inbound SMS messages sent to a Dallas-Fort Worth home services business.

The business is HonestRoof.com, a roofing company since 1954. It also arranges non-roofing property work (fencing, plumbing, HVAC, electrical, remodeling, flooring, painting, siding, windows, doors, concrete, general repairs, and make-ready work) through a partner company.

Texts come from homeowners, realtors and property managers - and also from spammers.

Classify the message into exactly one category:
- "customer": someone who might want work done, is asking about services, is following up on their own job, or is simply opening a conversation ("hi", "hey there", "are you available?"). A short or vague greeting from a real person IS a customer.
- "solicitation": someone selling something TO the business - lead generation, marketing, SEO, web design, staffing, appointment setters, virtual assistants, business loans, insurance, software, or partnership pitches.
- "platform_bot": an automated notification from a platform or service (Yelp, Google, directories, review sites, appointment systems, verification codes).
- "unclear": genuinely impossible to tell.

Be biased toward "customer". Only use "solicitation" or "platform_bot" when the message is clearly trying to sell to the business or is clearly machine-generated. When in doubt, choose "customer" or "unclear".

Respond ONLY with compact JSON: {"category":"...","confidence":0.0-1.0,"reason":"few words"}`;

/**
 * Ask the model to judge an ambiguous message.
 * Any failure (no key, timeout, bad JSON) returns null so the caller can fall
 * back to responding - we never drop a message because of an outage.
 */
async function llmVerdict(message) {
    const c = getClient();
    if (!c) return null;
    try {
        const res = await c.messages.create(
            {
                model: MODEL,
                max_tokens: 100,
                system: SYSTEM_PROMPT,
                messages: [
                    {
                        role: 'user',
                        content: 'Message received:\n"""\n' + normalise(message).slice(0, 1500) + '\n"""',
                    },
                ],
            },
            { timeout: TIMEOUT_MS },
        );
        const raw = (res.content || []).map((b) => b.text || '').join('').trim();
        const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
        const parsed = JSON.parse(json);
        const confidence = Number(parsed.confidence);
        return {
            category: String(parsed.category || '').toLowerCase(),
            confidence: Number.isFinite(confidence) ? confidence : 0,
            reason: String(parsed.reason || '').slice(0, 80),
        };
    } catch (err) {
        console.error('[SMS TRIAGE] classifier failed, defaulting to respond:', err.message);
        return null;
    }
}

/** Confidence required before we stay silent. */
const BLOCK_CONFIDENCE = 0.7;

/**
 * Decide whether Roofus should reply to an inbound SMS.
 * @returns {Promise<{respond: boolean, reason: string, source: string}>}
 */
async function shouldRespondToSms(message) {
    const ruled = ruleVerdict(message);
    if (ruled) return ruled;

    const verdict = await llmVerdict(message);
    if (!verdict) return { respond: true, reason: 'classifier_unavailable', source: 'fallback' };

    const junk = verdict.category === 'solicitation' || verdict.category === 'platform_bot';
    if (junk && verdict.confidence >= BLOCK_CONFIDENCE) {
        return {
            respond: false,
            reason: verdict.category + ' (' + verdict.confidence.toFixed(2) + ': ' + verdict.reason + ')',
            source: 'llm',
        };
    }
    return {
        respond: true,
        reason: (verdict.category || 'unknown') + ' (' + verdict.confidence.toFixed(2) + ')',
        source: 'llm',
    };
}

module.exports = { shouldRespondToSms, ruleVerdict, llmVerdict, BLOCK_CONFIDENCE };
