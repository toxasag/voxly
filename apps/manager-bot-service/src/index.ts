// Voxly Manager Bot Service
// Handles Telegram Managed Bots: receives ManagedBotUpdated updates,
// retrieves child bot tokens, links them to tenant bot instances.

import { randomBytes } from 'node:crypto';
import { prisma } from '@voxly/db';
import { encrypt } from '@voxly/crypto';

const MANAGER_BOT_TOKEN = process.env.TELEGRAM_MANAGER_BOT_TOKEN || '';
const MANAGER_BOT_USERNAME = process.env.TELEGRAM_MANAGER_BOT_USERNAME || 'VoxlyGiftbot';
const WEBHOOK_PORT = 3003;
const USE_POLLING =
  process.env.MANAGER_USE_POLLING === 'true' ||
  process.env.GIFT_BOT_USE_POLLING === 'true';

if (!MANAGER_BOT_TOKEN) {
  console.error('TELEGRAM_MANAGER_BOT_TOKEN is required');
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${MANAGER_BOT_TOKEN}`;

declare const Bun: { serve?: (...args: any[]) => unknown } | undefined;

async function main() {
  if (USE_POLLING) {
    await fetch(`${TELEGRAM_API}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
    console.log('[manager-bot-service] Long-polling mode enabled');
    void pollManagerUpdates();
  } else {
    await setManagerWebhook();
  }

  // Health server always on
  if (typeof Bun !== 'undefined' && Bun.serve) {
    startBunServer();
  } else {
    await startNodeServer();
  }

  console.log(`[manager-bot-service] Listening on port ${WEBHOOK_PORT}`);
  console.log(`[manager-bot-service] Manager bot: @${MANAGER_BOT_USERNAME}`);
}

async function pollManagerUpdates() {
  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(
        `${TELEGRAM_API}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'managed_bot']))}`,
      );
      const data = (await res.json()) as any;
      if (!data.ok) {
        console.error('[manager-bot-service] getUpdates failed:', data);
        await sleep(3000);
        continue;
      }
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (err) {
      console.error('[manager-bot-service] poll error:', err);
      await sleep(3000);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function setManagerWebhook() {
  const webhookUrl = process.env.MANAGER_WEBHOOK_URL || `http://manager-bot-service:${WEBHOOK_PORT}/webhook`;
  const url = `${TELEGRAM_API}/setWebhook`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'managed_bot'],
      drop_pending_updates: true,
    }),
  });
  const data = (await response.json()) as any;
  if (data.ok) {
    console.log('[manager-bot-service] Webhook set successfully');
  } else {
    console.error('[manager-bot-service] Failed to set webhook:', data);
  }
}

async function startNodeServer() {
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const update = JSON.parse(body);
        await handleUpdate(update);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('[manager-bot-service] Error handling update:', err);
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
  server.listen(WEBHOOK_PORT);
  return server;
}

function startBunServer() {
  // Placeholder for Bun runtime
  return null;
}

/**
 * Handle incoming Telegram update
 */
async function handleUpdate(update: any) {
  // Handle ManagedBotUpdated event
  if (update.managed_bot) {
    await handleManagedBotUpdated(update.managed_bot);
    return;
  }

  // Handle regular messages (client writing to manager bot)
  if (update.message) {
    await handleManagerMessage(update.message);
    return;
  }
}

/**
 * Process ManagedBotUpdated (Bot API 9.6+):
 * shape is { user: User, bot: User } — creator + managed bot.
 * getManagedBotToken(user_id) expects the managed bot's telegram id.
 */
async function handleManagedBotUpdated(managedBot: any) {
  const creator = managedBot.user;
  const botUser = managedBot.bot;
  const creatorId = creator?.id;
  const managedBotId = botUser?.id;
  const username = botUser?.username as string | undefined;

  console.log(
    `[manager-bot-service] ManagedBotUpdated: creator=${creatorId}, bot_id=${managedBotId}, @${username}`,
  );

  if (!creatorId || !managedBotId) {
    console.error('[manager-bot-service] ManagedBotUpdated missing user/bot ids', managedBot);
    return;
  }

  const token = await getManagedBotToken(managedBotId);
  if (!token) {
    console.error(`[manager-bot-service] Failed to get token for managed bot id=${managedBotId}`);
    return;
  }

  const user = await prisma.user.findFirst({
    where: { telegramUserId: BigInt(creatorId) },
    include: {
      tenantMembers: { where: { role: 'owner' }, take: 1 },
    },
  });

  if (!user || !user.tenantMembers[0]) {
    console.warn(`[manager-bot-service] No tenant found for telegram creator_id=${creatorId}`);
    return;
  }

  const tenantId = user.tenantMembers[0].tenantId;

  const existing = await prisma.botInstance.findFirst({
    where: {
      OR: [
        { managedBotUserId: BigInt(managedBotId) },
        ...(username ? [{ botUsername: username, tenantId }] : []),
      ],
    },
  });

  if (existing) {
    await prisma.botInstance.update({
      where: { id: existing.id },
      data: {
        botTokenEncrypted: encrypt(token),
        botUsername: username || existing.botUsername,
        managedBotUserId: BigInt(managedBotId),
        status: 'active',
      },
    });
    await registerChildBotWebhook(token, tenantId, existing.id, existing.botType);
    console.log(`[manager-bot-service] Bot @${username} token refreshed for tenant ${tenantId}`);
    return;
  }

  const provisionReq = await prisma.botProvisionRequest.findFirst({
    where: {
      tenantId,
      status: 'pending',
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!provisionReq) {
    console.warn(`[manager-bot-service] No pending provision request for tenant ${tenantId}`);
    return;
  }

  const addonType = provisionReq.botType === 'gift' ? 'gift_bot' : provisionReq.botType;
  const addon = await prisma.addon.findUnique({
    where: { tenantId_type: { tenantId, type: addonType } },
    select: { id: true },
  });

  const botInstance = await prisma.botInstance.create({
    data: {
      tenantId,
      managedBotUserId: BigInt(managedBotId),
      botUsername: username,
      botTokenEncrypted: encrypt(token),
      provisionedVia: 'managed',
      botType: provisionReq.botType,
      status: 'active',
      addonId: addon?.id,
    },
  });

  await prisma.botProvisionRequest.update({
    where: { id: provisionReq.id },
    data: { status: 'confirmed' },
  });

  await registerChildBotWebhook(token, tenantId, botInstance.id, provisionReq.botType);

  console.log(`[manager-bot-service] Bot @${username} linked to tenant ${tenantId} bot=${botInstance.id}`);
}

/**
 * Get managed bot token via Bot API
 */
async function getManagedBotToken(userId: number): Promise<string | null> {
  const response = await fetch(`${TELEGRAM_API}/getManagedBotToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  const data = await response.json() as any;
  if (data.ok) {
    return data.result; // token string
  }
  console.error('[manager-bot-service] getManagedBotToken failed:', data);
  return null;
}

/**
 * Register webhook for a child bot (route to gift-bot-worker or ai-telegram-worker)
 * Path contract: /tg/{tenantId}/{botId}
 */
async function registerChildBotWebhook(
  botToken: string,
  tenantId: string,
  botId: string,
  botType: string,
) {
  const botApi = `https://api.telegram.org/bot${botToken}`;
  const publicBase =
    process.env.GIFT_BOT_WEBHOOK_BASE_URL ||
    process.env.BOT_WEBHOOK_BASE_URL ||
    `https://api.${process.env.VOXLY_DOMAIN || 'getvoxly.ru'}`;
  const webhookUrl = `${publicBase.replace(/\/+$/, '')}/tg/${tenantId}/${botId}`;
  const secretToken = generateSecret();

  // Local/dev without public HTTPS: skip setWebhook — gift-bot-worker can long-poll
  if (process.env.GIFT_BOT_USE_POLLING === 'true' || webhookUrl.includes('localhost')) {
    console.log(
      `[manager-bot-service] Skipping setWebhook (polling mode). Expected path ${webhookUrl}`,
    );
    await prisma.botInstance.update({
      where: { id: botId },
      data: { webhookSecret: secretToken },
    });
    return;
  }

  const response = await fetch(`${botApi}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query', 'chat_member'],
      drop_pending_updates: true,
    }),
  });
  const data = await response.json() as any;
  if (data.ok) {
    await prisma.botInstance.update({
      where: { id: botId },
      data: { webhookSecret: secretToken },
    });
    console.log(`[manager-bot-service] Webhook registered ${webhookUrl} type=${botType}`);
  } else {
    console.error(`[manager-bot-service] Failed to register webhook:`, data);
  }
}

/**
 * Handle direct messages to manager bot (e.g., /start, provisioning)
 */
async function handleManagerMessage(message: any) {
  const chatId = message.chat.id;
  const text = message.text || '';

  if (text.startsWith('/start')) {
    // Check if start payload contains a provision nonce
    const payload = text.split(' ')[1];
    if (payload && payload.startsWith('voxly_')) {
      // Link telegram user to platform user
      await linkTelegramUser(chatId, payload);
    } else {
      await sendManagerMessage(chatId, (
        '👋 Добро пожаловать в Voxly!\n\n' +
        'Я помогу вам создать бота для вашего канала.\n' +
        'Перейдите в личный кабинет, чтобы начать.'
      ));
    }
  }
}

/**
 * Link a Telegram user to platform account via nonce
 */
async function linkTelegramUser(telegramUserId: number, nonce: string) {
  // Find provision request by nonce
  const provisionReq = await prisma.botProvisionRequest.findFirst({
    where: { nonce: nonce.replace('voxly_', ''), status: 'pending' },
    include: { tenant: { include: { users: { include: { user: true }, where: { role: 'owner' }, take: 1 } } } },
  });

  if (!provisionReq) {
    await sendManagerMessage(telegramUserId, '❌ Ссылка устарела или недействительна.');
    return;
  }

  // Update the platform user with telegram_user_id
  const ownerUser = provisionReq.tenant.users[0]?.user;
  if (ownerUser) {
    await prisma.user.update({
      where: { id: ownerUser.id },
      data: { telegramUserId: BigInt(telegramUserId) },
    });
  }

  await sendManagerMessage(telegramUserId, (
    '✅ Аккаунт привязан!\n\n' +
    `Воркспейс: ${provisionReq.tenant.slug}\n` +
    'Теперь вы можете создать бота из личного кабинета.'
  ));
}

async function sendManagerMessage(chatId: number, text: string) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

function generateSecret(): string {
  return randomBytes(24).toString('hex');
}

main().catch(console.error);
