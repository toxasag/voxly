// Voxly AI WhatsApp Worker
// Handles AI-powered conversations via WhatsApp Cloud API
// Reuses ai-core for billing, supports human handoff

import { prisma } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { chargeAiUsage, hasAiBalance } from '@voxly/ai-core';
import { fireGoal } from '@voxly/analytics-dispatchers';
import OpenAI from 'openai';

const PORT = 3006;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v20.0';

if (!OPENAI_API_KEY) {
  console.warn('[ai-whatsapp] OPENAI_API_KEY not set — AI features disabled');
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const DEFAULT_SYSTEM_PROMPT = `Ты — дружелюбный ассистент, который помогает клиентам.
Отвечай кратко, по делу и на русском языке.`;

const CONTEXT_WINDOW = 20;

async function main() {
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    // WhatsApp webhook verification (GET with hub.challenge)
    if (req.method === 'GET' && req.url?.startsWith('/wa/')) {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      const parts = url.pathname.split('/').filter(Boolean);
      const tenantId = parts[1];
      const phoneNumberId = parts[2];

      // Verify token (should match tenant's verify token)
      const expectedToken = `voxly_${tenantId}`;
      if (mode === 'subscribe' && token === expectedToken) {
        console.log(`[ai-whatsapp] Webhook verified for tenant ${tenantId}`);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(challenge);
        return;
      }
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // WhatsApp webhook (POST)
    if (req.method === 'POST' && req.url?.startsWith('/wa/')) {
      const parts = req.url.split('/').filter(Boolean);
      const tenantId = parts[1];
      const phoneNumberId = parts[2];

      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const data = JSON.parse(body);
        await handleWhatsAppWebhook(data, tenantId, phoneNumberId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'received' }));
      } catch (err) {
        console.error('[ai-whatsapp] Error:', err);
        res.writeHead(500);
        res.end('error');
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end('ok');
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  server.listen(PORT, () => {
    console.log(`[ai-whatsapp-worker] Listening on port ${PORT}`);
  });
}

/**
 * Handle WhatsApp Cloud API webhook
 */
async function handleWhatsAppWebhook(data: any, tenantId: string, phoneNumberId: string) {
  // WhatsApp sends: { entry: [{ changes: [{ value: { messages: [...] } }] }] }
  if (!data.entry) return;

  for (const entry of data.entry) {
    for (const change of entry.changes || []) {
      const value = change.value;

      // Handle incoming messages
      if (value.messages) {
        for (const message of value.messages) {
          await handleWhatsAppMessage(message, value, tenantId, phoneNumberId);
        }
      }

      // Handle message status updates (delivered, read)
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status, tenantId);
        }
      }
    }
  }
}

/**
 * Handle a single WhatsApp message
 */
async function handleWhatsAppMessage(message: any, value: any, tenantId: string, phoneNumberId: string) {
  if (message.type !== 'text') return; // Only text for now

  const from = message.from; // WhatsApp phone number
  const text = message.text.body;
  const messageId = message.id;
  const contactName = value.contacts?.[0]?.profile?.name;

  // Get tenant's WhatsApp credentials
  const bot = await prisma.botInstance.findFirst({
    where: {
      tenantId,
      botType: 'ai_whatsapp',
      status: 'active',
      phoneNumberId,
    },
  });

  if (!bot) {
    console.warn(`[ai-whatsapp] No bot found for tenant ${tenantId} phone ${phoneNumberId}`);
    return;
  }

  if (!bot.botTokenEncrypted) {
    console.warn(`[ai-whatsapp] Bot has no encrypted token for tenant ${tenantId}`);
    return;
  }

  const whatsappToken = decrypt(bot.botTokenEncrypted);
  const whatsappApi = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;

  // Find or create conversation
  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId,
      botInstanceId: bot.id,
      platform: 'whatsapp',
      platformUserId: from,
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
    const created = await prisma.conversation.create({
      data: {
        tenantId,
        botInstanceId: bot.id,
        platform: 'whatsapp',
        platformUserId: from,
        platformUsername: contactName,
        status: 'open',
        mode: 'ai',
        lastAiMessageAt: new Date(),
      },
    });
    conversation = { ...created, messages: [] };

    await fireGoal({
      tenantId,
      goalName: 'whatsapp_conversation_started',
      subscriberId: from,
    });
  }

  // Store user message
  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: text,
      externalMessageId: messageId,
    },
  });

  // If in human mode, notify operator
  if (conversation.mode === 'human') {
    await notifyHumanOperator(tenantId, conversation.id, text);
    return;
  }

  // Check AI balance
  const hasBalance = await hasAiBalance(tenantId, 1);
  if (!hasBalance) {
    await sendWhatsAppMessage(whatsappApi, whatsappToken, from, (
      '⚠️ Баланс AI-ассистента исчерпан.\n' +
      'Пожалуйста, пополните баланс в личном кабинете.'
    ));
    await switchToHuman(whatsappApi, whatsappToken, from, tenantId, bot.id);
    return;
  }

  // Get AI config
  const aiConfig = await getTenantAiConfig(tenantId);

  // Build OpenAI messages
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: aiConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT },
  ];

  const history = [...conversation.messages].reverse();
  for (const msg of history) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
  }
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
      addonId: bot.addonId || undefined,
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

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastAiMessageAt: new Date() },
    });

    // Send response via WhatsApp
    await sendWhatsAppMessage(whatsappApi, whatsappToken, from, aiResponse);

    await fireGoal({
      tenantId,
      goalName: 'whatsapp_ai_response',
      subscriberId: from,
    });

    if (chargeResult.paused) {
      await switchToHuman(whatsappApi, whatsappToken, from, tenantId, bot.id);
    }
  } catch (err) {
    console.error('[ai-whatsapp] OpenAI error:', err);
    await sendWhatsAppMessage(whatsappApi, whatsappToken, from, 'Извините, произошла ошибка. Попробуйте позже.');
  }
}

/**
 * Handle message status update
 */
async function handleStatusUpdate(status: any, tenantId: string) {
  // status: { id, status: 'sent'|'delivered'|'read', recipient_id }
  // Update ChatMessage status if needed
}

async function sendWhatsAppMessage(apiUrl: string, token: string, to: string, text: string) {
  await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    }),
  });
}

async function switchToHuman(apiUrl: string, token: string, from: string, tenantId: string, botId: string) {
  await prisma.conversation.updateMany({
    where: {
      tenantId,
      botInstanceId: botId,
      platformUserId: from,
      status: { in: ['open', 'waiting_for_human'] },
    },
    data: { mode: 'human', status: 'waiting_for_human' },
  });

  await sendWhatsAppMessage(apiUrl, token, from, '👨‍💼 Режим оператора активирован. Ожидайте ответа.');
}

async function notifyHumanOperator(tenantId: string, conversationId: string, lastMessage: string) {
  console.log(`[ai-whatsapp] Human operator notification: tenant=${tenantId} conv=${conversationId}`);
}

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

function calculateProviderCost(model: string, tokens: number): number {
  const pricingPer1M: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4-turbo': { input: 10, output: 30 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  };

  const rates = pricingPer1M[model] || pricingPer1M['gpt-4o-mini'];
  const avgCostUsd = (rates.input + rates.output) / 2 / 1_000_000 * tokens;
  return Math.round(avgCostUsd * 100 * 100) / 100;
}

main().catch(console.error);
