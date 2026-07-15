// Voxly Manager Bot Service
// Handles Telegram Managed Bots: receives ManagedBotUpdated updates,
// retrieves child bot tokens, links them to tenant bot instances.

import { prisma } from '@voxly/db';
import { encrypt } from '@voxly/crypto';

const MANAGER_BOT_TOKEN = process.env.TELEGRAM_MANAGER_BOT_TOKEN || '';
const MANAGER_BOT_USERNAME = process.env.TELEGRAM_MANAGER_BOT_USERNAME || 'VoxlyManagerBot';
const WEBHOOK_PORT = 3003;

if (!MANAGER_BOT_TOKEN) {
  console.error('TELEGRAM_MANAGER_BOT_TOKEN is required');
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${MANAGER_BOT_TOKEN}`;

declare const Bun: { serve?: (...args: any[]) => unknown } | undefined;

async function main() {
  // Set webhook for manager bot
  await setManagerWebhook();

  // Start HTTP server to receive updates
  const server = typeof Bun !== 'undefined' && Bun.serve
    ? startBunServer()
    : await startNodeServer();

  console.log(`[manager-bot-service] Listening on port ${WEBHOOK_PORT}`);
  console.log(`[manager-bot-service] Manager bot: @${MANAGER_BOT_USERNAME}`);
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
 * Process ManagedBotUpdated: a child bot was created or token rotated
 */
async function handleManagedBotUpdated(managedBot: any) {
  const { user_id, bot_id, username, added, revoked } = managedBot;

  console.log(`[manager-bot-service] ManagedBotUpdated: user_id=${user_id}, bot=${username}, added=${added}, revoked=${revoked}`);

  if (added) {
    // New bot created — fetch its token
    const token = await getManagedBotToken(user_id);
    if (!token) {
      console.error(`[manager-bot-service] Failed to get token for managed bot user_id=${user_id}`);
      return;
    }

    // Find the provision request by telegram user_id
    // The user who created the bot should have a pending provision request
    const user = await prisma.user.findFirst({
      where: { telegramUserId: BigInt(user_id) },
      include: {
        tenantMembers: { where: { role: 'owner' }, take: 1 },
      },
    });

    if (!user || !user.tenantMembers[0]) {
      console.warn(`[manager-bot-service] No tenant found for telegram user_id=${user_id}`);
      // Store token temporarily, will be linked later
      return;
    }

    const tenantId = user.tenantMembers[0].tenantId;

    // Find pending provision request
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

    // Create bot instance
    const encryptedToken = encrypt(token);
    await prisma.botInstance.create({
      data: {
        tenantId,
        managedBotUserId: BigInt(user_id),
        botUsername: username,
        botTokenEncrypted: encryptedToken,
        provisionedVia: 'managed',
        botType: provisionReq.botType,
        status: 'active',
      },
    });

    // Mark provision request as confirmed
    await prisma.botProvisionRequest.update({
      where: { id: provisionReq.id },
      data: { status: 'confirmed' },
    });

    // Register webhook for the child bot
    await registerChildBotWebhook(token, tenantId);

    console.log(`[manager-bot-service] Bot @${username} linked to tenant ${tenantId}`);
  }

  if (revoked) {
    // Token was rotated or revoked — update or deactivate
    await prisma.botInstance.updateMany({
      where: { managedBotUserId: BigInt(user_id) },
      data: { status: 'inactive', botTokenEncrypted: null },
    });
    console.log(`[manager-bot-service] Bot for user_id=${user_id} revoked`);
  }
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
 */
async function registerChildBotWebhook(botToken: string, tenantId: string) {
  const botApi = `https://api.telegram.org/bot${botToken}`;
  // Webhook goes to gift-bot-worker (or ai-telegram-worker based on bot type)
  // For now, route to saas-api which will forward
  const webhookUrl = `https://api.${process.env.VOXLY_DOMAIN || 'getvoxly.ru'}/bots/webhook/${tenantId}`;
  const secretToken = generateSecret();

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
    console.log(`[manager-bot-service] Webhook registered for tenant ${tenantId}`);
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
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

main().catch(console.error);
