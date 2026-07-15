// Voxly AI Telegram Worker
// Handles AI-powered conversations on Telegram Business API / bot
// Multi-tenant, uses AI wallet for billing, supports human handoff

import { prisma } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { chargeAiUsage, hasAiBalance } from '@voxly/ai-core';
import { fireGoal } from '@voxly/analytics-dispatchers';
import type { ConversationMode } from '@voxly/shared';
import OpenAI from 'openai';

const PORT = 3005;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

if (!OPENAI_API_KEY) {
  console.warn('[ai-telegram] OPENAI_API_KEY not set — AI features disabled');
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Conversation context window (last N messages)
const CONTEXT_WINDOW = 20;

// Per-tenant system prompts
const DEFAULT_SYSTEM_PROMPT = `Ты — дружелюбный ассистент, который помогает клиентам.
Отвечай кратко, по делу и на русском языке.
Если не знаешь ответ — честно скажи об этом.`;

async function main() {
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/tg/')) {
      const parts = req.url.split('/').filter(Boolean);
      const tenantId = parts[1];
      const botId = parts[2];

      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const update = JSON.parse(body);
        await handleTelegramUpdate(update, tenantId, botId);
        res.writeHead(200);
        res.end('ok');
      } catch (err) {
        console.error('[ai-telegram] Error:', err);
        res.writeHead(500);
        res.end('error');
      }
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  server.listen(PORT, () => {
    console.log(`[ai-telegram-worker] Listening on port ${PORT}`);
  });
}

async function handleTelegramUpdate(update: any, tenantId: string, botId: string) {
  const bot = await prisma.botInstance.findFirst({
    where: { id: botId, tenantId, status: 'active', botType: 'ai_telegram' },
  });

  if (!bot || !bot.botTokenEncrypted) {
    console.warn(`[ai-telegram] Bot not found or inactive: ${botId}`);
    return;
  }

  const botToken = decrypt(bot.botTokenEncrypted);
  const botApi = `https://api.telegram.org/bot${botToken}`;

  // Handle regular messages
  if (update.message?.text) {
    await handleUserMessage(update, botApi, tenantId, botId);
    return;
  }

  // Handle callback query (mode switching, handoff)
  if (update.callback_query) {
    await handleCallback(update, botApi, tenantId, botId);
    return;
  }
}

/**
 * Handle a user text message — process with AI
 */
async function handleUserMessage(
  update: any,
  botApi: string,
  tenantId: string,
  botId: string,
) {
  const chatId = update.message.chat.id;
  const text = update.message.text;
  const telegramId = update.message.from.id;
  const firstName = update.message.from.first_name;
  const username = update.message.from.username;

  // /start — show welcome
  if (text === '/start') {
    await sendBotMessage(botApi, chatId, (
      `👋 Привет${firstName ? ', ' + firstName : ''}!\n\n` +
      'Я AI-ассистент. Чем могу помочь?'
    ));
    await fireGoal({
      tenantId,
      goalName: 'ai_bot_start',
      subscriberId: String(telegramId),
    });
    return;
  }

  // /mode — show mode selector
  if (text === '/mode') {
    await showModeSelector(botApi, chatId);
    return;
  }

  // /handoff — switch to human mode
  if (text === '/handoff') {
    await switchToHuman(botApi, chatId, tenantId, telegramId);
    return;
  }

  // Find or create active conversation
  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId,
      botInstanceId: botId,
      platformUserId: String(telegramId),
      status: { in: ['open', 'waiting_for_human'] },
    },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: CONTEXT_WINDOW,
      },
    },
  });

  if (!conversation) {
    // Create new conversation
    const created = await prisma.conversation.create({
      data: {
        tenantId,
        botInstanceId: botId,
        platform: 'telegram',
        platformUserId: String(telegramId),
        platformUsername: username,
        platformFirstName: firstName,
        status: 'open',
        mode: 'ai',
        lastAiMessageAt: new Date(),
      },
    });
    conversation = { ...created, messages: [] };

    await fireGoal({
      tenantId,
      goalName: 'conversation_started',
      subscriberId: String(telegramId),
    });
  }

  // Store user message
  const userMsg = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: text,
    },
  });

  // Check if conversation is in human mode — don't auto-reply with AI
  if (conversation.mode === 'human') {
    // Notify operators (via Twenty CRM or Slack)
    await notifyHumanOperator(tenantId, conversation.id, text);
    return;
  }

  // Check AI wallet balance
  const hasBalance = await hasAiBalance(tenantId, 1);
  if (!hasBalance) {
    await sendBotMessage(botApi, chatId, (
      '⚠️ Баланс AI-ассистента исчерпан.\n\n' +
      'Пожалуйста, пополните баланс в личном кабинете.\n' +
      'А пока я переключу вас на оператора.'
    ));
    await switchToHuman(botApi, chatId, tenantId, telegramId);
    return;
  }

  // Get AI config for tenant
  const aiConfig = await getTenantAiConfig(tenantId);

  // Build messages for OpenAI
  const systemPrompt = aiConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history (reverse to chronological order)
  const history = [...conversation.messages].reverse();
  for (const msg of history) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
  }

  // Add current message
  messages.push({ role: 'user', content: text });

  // Call OpenAI
  try {
    const completion = await openai.chat.completions.create({
      model: aiConfig.model || 'gpt-4o-mini',
      messages,
      temperature: aiConfig.temperature ?? 0.7,
      max_tokens: aiConfig.maxTokens ?? 1000,
    });

    const aiResponse = completion.choices[0]?.message?.content || 'Извините, я не смог сформировать ответ.';
    const tokensUsed = completion.usage?.total_tokens || 0;
    const providerCost = calculateProviderCost(aiConfig.model || 'gpt-4o-mini', tokensUsed);

    // Charge AI wallet
    const chargeResult = await chargeAiUsage({
      tenantId,
      providerCostRub: providerCost,
      tokens: tokensUsed,
      model: aiConfig.model || 'gpt-4o-mini',
      requestType: 'text',
    });

    // Store AI message
    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: aiResponse,
        tokensUsed,
        modelUsed: aiConfig.model || 'gpt-4o-mini',
        providerCostRub: providerCost,
        chargedRub: chargeResult.chargedRub,
      },
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastAiMessageAt: new Date() },
    });

    // Send response to user
    await sendBotMessage(botApi, chatId, aiResponse);

    // If balance is now low, warn
    if (chargeResult.remainingBalance < 50 && chargeResult.remainingBalance > 0) {
      await sendBotMessage(botApi, chatId, '⚠️ Баланс AI-ассистента скоро закончится. Пожалуйста, пополните его в личном кабинете.');
    }

    // Fire goal
    await fireGoal({
      tenantId,
      goalName: 'ai_response_sent',
      subscriberId: String(telegramId),
    });

    // If paused due to balance, switch to human
    if (chargeResult.paused) {
      await switchToHuman(botApi, chatId, tenantId, telegramId);
    }
  } catch (err) {
    console.error('[ai-telegram] OpenAI error:', err);
    await sendBotMessage(botApi, chatId, 'Извините, произошла ошибка. Попробуйте позже или обратитесь к оператору командой /handoff');
  }
}

/**
 * Handle callback query (mode switching)
 */
async function handleCallback(update: any, botApi: string, tenantId: string, botId: string) {
  const callbackData = update.callback_query.data;
  const chatId = update.callback_query.message.chat.id;
  const telegramId = update.callback_query.from.id;

  // Answer callback
  await fetch(`${botApi}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: update.callback_query.id }),
  });

  switch (callbackData) {
    case 'mode_ai':
      await switchToAi(botApi, chatId, tenantId, telegramId);
      break;
    case 'mode_human':
      await switchToHuman(botApi, chatId, tenantId, telegramId);
      break;
  }
}

async function showModeSelector(botApi: string, chatId: number) {
  await fetch(`${botApi}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: 'Выберите режим общения:',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🤖 AI-ассистент', callback_data: 'mode_ai' }],
          [{ text: '👨‍💼 Оператор', callback_data: 'mode_human' }],
        ],
      },
    }),
  });
}

async function switchToAi(botApi: string, chatId: number, tenantId: string, telegramId: number) {
  await prisma.conversation.updateMany({
    where: {
      tenantId,
      platformUserId: String(telegramId),
      status: { in: ['open', 'waiting_for_human'] },
    },
    data: { mode: 'ai', status: 'open' },
  });

  await sendBotMessage(botApi, chatId, '🤖 Режим AI-ассистента активирован.');
}

async function switchToHuman(botApi: string, chatId: number, tenantId: string, telegramId: number) {
  await prisma.conversation.updateMany({
    where: {
      tenantId,
      platformUserId: String(telegramId),
      status: { in: ['open', 'waiting_for_human'] },
    },
    data: { mode: 'human', status: 'waiting_for_human' },
  });

  await sendBotMessage(botApi, chatId, (
    '👨‍💼 Режим оператора активирован.\n\n' +
    'Ваше сообщение передано оператору. Ожидайте ответа.\n\n' +
    'Чтобы вернуться к AI-ассистенту, отправьте /mode'
  ));

  await fireGoal({
    tenantId,
    goalName: 'human_handoff',
    subscriberId: String(telegramId),
  });
}

/**
 * Notify human operator (via Twenty CRM or webhook)
 */
async function notifyHumanOperator(tenantId: string, conversationId: string, lastMessage: string) {
  // TODO: Send notification to Twenty CRM or external webhook
  console.log(`[ai-telegram] Human operator notification: tenant=${tenantId} conv=${conversationId} msg=${lastMessage}`);
}

/**
 * Get tenant AI configuration (system prompt, model, etc.)
 */
async function getTenantAiConfig(tenantId: string) {
  const settings = await prisma.platformSetting.findMany({
    where: {
      OR: [
        { key: { startsWith: `ai_config_${tenantId}_` } },
        { key: 'ai_default_model' },
        { key: 'ai_default_system_prompt' },
      ],
    },
  });

  const config: any = {};
  for (const s of settings) {
    if (s.key.startsWith(`ai_config_${tenantId}_`)) {
      const field = s.key.replace(`ai_config_${tenantId}_`, '');
      config[field] = s.value;
    } else if (s.key === 'ai_default_model') {
      config.model = config.model || s.value;
    } else if (s.key === 'ai_default_system_prompt') {
      config.systemPrompt = config.systemPrompt || s.value;
    }
  }

  return {
    model: config.model || 'gpt-4o-mini',
    systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    temperature: config.temperature ? parseFloat(config.temperature) : 0.7,
    maxTokens: config.maxTokens ? parseInt(config.maxTokens, 10) : 1000,
  };
}

/**
 * Calculate provider cost in RUB based on model and tokens
 */
function calculateProviderCost(model: string, tokens: number): number {
  // Approximate pricing per 1M tokens (in RUB, assuming 1 USD = 100 RUB)
  const pricingPer1M: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.5, output: 10 }, // USD per 1M
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4-turbo': { input: 10, output: 30 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  };

  const rates = pricingPer1M[model] || pricingPer1M['gpt-4o-mini'];
  // Assume 50/50 input/output split, convert USD to RUB (×100)
  const avgCostUsd = (rates.input + rates.output) / 2 / 1_000_000 * tokens;
  return Math.round(avgCostUsd * 100 * 100) / 100; // RUB, 2 decimal places
}

async function sendBotMessage(botApi: string, chatId: number, text: string) {
  await fetch(`${botApi}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });
}

main().catch(console.error);
