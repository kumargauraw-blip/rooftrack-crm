'use strict';

/**
 * Thin client for Retell's chat-completion API. Encapsulates the two
 * calls the Twilio SMS bridge needs:
 *   - createChat(agentId)       -> { chat_id, ... }
 *   - createChatCompletion(chatId, content) -> agent reply text + tool calls
 *
 * Required env:
 *   RETELL_API_KEY          - the same key the voice webhook uses for sig verify
 *   RETELL_SMS_AGENT_ID     - the chat agent id created via /create-chat-agent
 */

const RETELL_BASE = 'https://api.retellai.com';

async function retellFetch(path, init = {}) {
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) {
        return { ok: false, error: 'RETELL_API_KEY not set' };
    }
    try {
        const res = await fetch(`${RETELL_BASE}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                ...(init.headers || {}),
            },
            signal: AbortSignal.timeout(15_000),
        });
        const text = await res.text();
        let body;
        try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
        if (!res.ok) {
            return { ok: false, status: res.status, error: body.error_message || body.message || `HTTP ${res.status}`, body };
        }
        return { ok: true, body };
    } catch (err) {
        return { ok: false, error: err.message || 'fetch failed' };
    }
}

/**
 * Start a new chat session for the configured SMS agent.
 * @returns {Promise<{ok:boolean, chat_id?:string, error?:string}>}
 */
async function createChat() {
    const agentId = process.env.RETELL_SMS_AGENT_ID;
    if (!agentId) return { ok: false, error: 'RETELL_SMS_AGENT_ID not set' };
    const result = await retellFetch('/create-chat', {
        method: 'POST',
        body: JSON.stringify({ agent_id: agentId }),
    });
    if (!result.ok) return result;
    return { ok: true, chat_id: result.body.chat_id };
}

/**
 * Send a user message into an existing chat. Returns the agent's reply
 * text. Tool calls are handled by Retell server-side (Retell POSTs to
 * our tool URL), so by the time this returns the tool has already
 * fired - and the reply may reference whatever the tool said.
 *
 * @param {string} chatId
 * @param {string} content
 * @returns {Promise<{ok:boolean, replies?:string[], rawMessages?:Array, error?:string}>}
 */
async function createChatCompletion(chatId, content) {
    const result = await retellFetch('/create-chat-completion', {
        method: 'POST',
        body: JSON.stringify({ chat_id: chatId, content }),
    });
    if (!result.ok) return result;

    // The response has a `messages` array (or `message_with_tool_calls`
    // depending on SDK version). Pull out agent text replies regardless
    // of whether the role is reported as 'agent' or 'assistant', and
    // skip tool-call internal messages.
    const msgs = result.body.messages || result.body.message_with_tool_calls || [];
    const AGENT_ROLES = new Set(['agent', 'assistant']);
    const replies = msgs
        .filter((m) => AGENT_ROLES.has(m.role) && typeof m.content === 'string' && m.content.trim())
        .map((m) => m.content.trim());
    return { ok: true, replies, rawMessages: msgs };
}

module.exports = { createChat, createChatCompletion };
