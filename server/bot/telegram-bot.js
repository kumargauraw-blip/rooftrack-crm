const TelegramBot = require('node-telegram-bot-api');
const { parseMessage } = require('./ai-parser');
const handlers = require('./handlers');
const { startReminderChecker } = require('./reminders');
const crypto = require('crypto');

function uuid() {
    return crypto.randomUUID();
}

function startBot(db) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!token) {
        console.log('TELEGRAM_BOT_TOKEN not set, skipping bot initialization');
        return null;
    }

    console.log('Starting Telegram bot...');
    
    const bot = new TelegramBot(token, { polling: true });

    const ADMIN_TELEGRAM_ID = process.env.BOT_ADMIN_TELEGRAM_ID;

    // Helper to check if user is approved
    function isApproved(telegramId) {
        const user = db.prepare('SELECT * FROM bot_users WHERE telegram_id = ? AND approved = 1').get(telegramId.toString());
        return !!user;
    }

    // Helper to check if user is admin
    function isAdmin(telegramId) {
        return telegramId.toString() === ADMIN_TELEGRAM_ID;
    }

    // Register or get user
    function getOrCreateUser(msg) {
        const telegramId = msg.from.id.toString();
        let user = db.prepare('SELECT * FROM bot_users WHERE telegram_id = ?').get(telegramId);
        
        if (!user) {
            const userId = uuid();
            const isAdminUser = isAdmin(msg.from.id);
            
            db.prepare(`
                INSERT INTO bot_users (id, telegram_id, telegram_username, display_name, role, approved, created_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            `).run(
                userId,
                telegramId,
                msg.from.username || null,
                msg.from.first_name || 'Unknown',
                isAdminUser ? 'admin' : 'contractor',
                isAdminUser ? 1 : 0
            );
            
            user = db.prepare('SELECT * FROM bot_users WHERE telegram_id = ?').get(telegramId);
        }
        
        return user;
    }

    // /start command
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const user = getOrCreateUser(msg);

        let message = `👋 Welcome to RoofTrack CRM Bot!\n\n`;
        
        if (user.approved) {
            message += `You're registered and ready to go!\n\n`;
            message += `Commands:\n`;
            message += `/help - Show all commands\n`;
            message += `/status - Pipeline summary\n`;
            message += `/leads - Recent leads\n`;
            message += `/find [query] - Search leads\n\n`;
            message += `Or just type naturally:\n`;
            message += `_"Add lead John Smith 214-555-1234"_\n`;
            message += `_"Schedule inspection for John tomorrow at 2pm"_`;
        } else {
            message += `Your account is pending approval.\n`;
            message += `Your Telegram ID: \`${msg.from.id}\`\n\n`;
            message += `Please contact the admin to get approved.`;
        }

        await bot.sendMessage(chatId, message);
    });

    // /help command
    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isApproved(msg.from.id) && !isAdmin(msg.from.id)) {
            await bot.sendMessage(chatId, '⚠️ You are not approved to use this bot.');
            return;
        }

        const message = `📖 RoofTrack Bot Commands\n\n` +
            `*Slash Commands:*\n` +
            `/start - Register/welcome\n` +
            `/help - Show this help\n` +
            `/status - Pipeline summary\n` +
            `/leads - List recent 10 leads\n` +
            `/find [query] - Search by name/phone\n\n` +
            `*Natural Language Examples:*\n` +
            `_"Add lead John Smith 214-555-1234 storm damage"_\n` +
            `_"Update John Smith status to scheduled"_\n` +
            `_"Schedule inspection for John Smith on 2024-02-15 at 10am"_\n` +
            `_"Add note for John: spoke with insurance"_\n` +
            `_"Remind me to call John tomorrow at 9am"_\n` +
            `_"What's the pipeline status?"_`;

        await bot.sendMessage(chatId, message);
    });

    // /status command
    bot.onText(/\/status/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isApproved(msg.from.id) && !isAdmin(msg.from.id)) {
            await bot.sendMessage(chatId, '⚠️ You are not approved to use this bot.');
            return;
        }

        await handlers.handleStatusCheck(db, bot, chatId);
    });

    // /leads command
    bot.onText(/\/leads/, async (msg) => {
        const chatId = msg.chat.id;
        
        if (!isApproved(msg.from.id) && !isAdmin(msg.from.id)) {
            await bot.sendMessage(chatId, '⚠️ You are not approved to use this bot.');
            return;
        }

        const leads = db.prepare(`
            SELECT * FROM leads 
            WHERE deleted_at IS NULL 
            ORDER BY created_at DESC 
            LIMIT 10
        `).all();

        if (leads.length === 0) {
            await bot.sendMessage(chatId, '📋 No leads found.');
            return;
        }

        const STATUS_EMOJI = {
            new: '🆕', contacted: '📞', scheduled: '📅', inspected: '🔍',
            quoted: '💰', accepted: '✅', in_progress: '🔨', completed: '🏠',
            paid: '💵', lost: '❌'
        };

        let message = `📋 Recent Leads (${leads.length}):\n\n`;
        
        for (const lead of leads) {
            const emoji = STATUS_EMOJI[lead.status] || '📋';
            message += `${emoji} ${lead.name}\n`;
            if (lead.phone) message += `   📱 ${lead.phone}\n`;
            message += `   Status: ${lead.status}\n\n`;
        }

        await bot.sendMessage(chatId, message);
    });

    // /find command
    bot.onText(/\/find (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        
        if (!isApproved(msg.from.id) && !isAdmin(msg.from.id)) {
            await bot.sendMessage(chatId, '⚠️ You are not approved to use this bot.');
            return;
        }

        const query = match[1];
        await handlers.handleSearchLead(db, bot, chatId, query);
    });

    // Handle all other messages (natural language)
    bot.on('message', async (msg) => {
        // Skip commands
        if (msg.text && msg.text.startsWith('/')) return;
        
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        
        // Check approval
        if (!isApproved(telegramId) && !isAdmin(telegramId)) {
            return; // Silently ignore unapproved users for regular messages
        }

        if (!msg.text) return;

        try {
            // Parse with AI
            const parsed = await parseMessage(msg.text);
            
            if (!parsed || !parsed.intent) {
                await bot.sendMessage(chatId, `🤔 I didn't understand that. Try /help for examples.`);
                return;
            }

            // Route to appropriate handler
            switch (parsed.intent) {
                case 'add_lead':
                    await handlers.handleNewLead(db, bot, chatId, parsed);
                    break;
                case 'update_lead':
                    await handlers.handleUpdateLead(db, bot, chatId, parsed);
                    break;
                case 'search_lead':
                    await handlers.handleSearchLead(db, bot, chatId, parsed.name || parsed.phone || parsed.lead_name_reference);
                    break;
                case 'add_appointment':
                    await handlers.handleAddAppointment(db, bot, chatId, parsed);
                    break;
                case 'status_check':
                    await handlers.handleStatusCheck(db, bot, chatId);
                    break;
                case 'add_note':
                    await handlers.handleAddNote(db, bot, chatId, parsed);
                    break;
                case 'set_reminder':
                    await handlers.handleSetReminder(db, bot, chatId, telegramId, parsed);
                    break;
                default:
                    await bot.sendMessage(chatId, `🤔 I didn't understand that. Try /help for examples.`);
            }
        } catch (error) {
            console.error('Bot message handler error:', error);
            await bot.sendMessage(chatId, `❌ An error occurred. Please try again.`);
        }
    });

    // Start reminder checker
    startReminderChecker(db, bot);

    console.log('Telegram bot started successfully');
    
    return bot;
}

module.exports = { startBot };
