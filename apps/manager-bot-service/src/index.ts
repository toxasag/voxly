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
  // Keep pending updates (ManagedBotUpdated) unless explicitly dropping.
  const dropPending = process.env.MANAGER_WEBHOOK_DROP_PENDING === 'true';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'managed_bot'],
      drop_pending_updates: dropPending,
    }),
  });
  const data = (await response.json()) as any;
  if (data.ok) {
    console.log('[manager-bot-service] Webhook set successfully');
  } else {
    console.error('[manager-bot-service] Failed to set webhook:', data);
  }
}

function requestPath(url: string | undefined): string {
  return (url || '').split('?')[0] || '';
}

/** Public Traefik path is /bots/manager/webhook; local/dev may hit /webhook. */
function isManagerWebhookPath(pathname: string): boolean {
  return pathname === '/webhook' || pathname === '/bots/manager/webhook';
}

async function startNodeServer() {
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    const pathname = requestPath(req.url);
    if (req.method === 'POST' && isManagerWebhookPath(pathname)) {
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
    } else if (req.method === 'GET' && (pathname === '/health' || pathname === '/bots/manager/health')) {
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
 * Move Telegram user id onto the tenant owner (unique constraint).
 * Clears the id from any other User first — one TG account = one portal owner.
 */
async function assignTelegramToTenantOwner(
  telegramUserId: number | bigint,
  tenantId: string,
): Promise<void> {
  const tgId = BigInt(telegramUserId);
  const owner = await prisma.tenantMember.findFirst({
    where: { tenantId, role: 'owner' },
    select: { userId: true },
  });
  if (!owner) return;

  await prisma.user.updateMany({
    where: { telegramUserId: tgId, NOT: { id: owner.userId } },
    data: { telegramUserId: null },
  });
  await prisma.user.update({
    where: { id: owner.userId },
    data: { telegramUserId: tgId },
  });
}

/**
 * Resolve which BotProvisionRequest a ManagedBotUpdated belongs to.
 *
 * INC-046: Telegram may already be linked to another tenant (e.g. antontest)
 * while the user provisions from john and picks a custom @username that does
 * not match suggestedUsername. Prefer username match, then pending on the
 * linked tenant, then a uniquely attributable pending (single tenant / single
 * ai_tg pending) so custom usernames still attach.
 */
async function resolveProvisionForManagedBot(opts: {
  creatorId: number;
  username?: string;
}): Promise<{ tenantId: string; provisionReq: { id: string; tenantId: string; botType: string } | null } | null> {
  const { creatorId, username } = opts;
  const uname = username?.replace(/^@/, '') || '';

  // 1) Strongest: pending suggestedUsername matches the bot Telegram created
  let provisionReq = uname
    ? await prisma.botProvisionRequest.findFirst({
        where: {
          status: 'pending',
          expiresAt: { gt: new Date() },
          OR: [{ suggestedUsername: uname }, { suggestedUsername: username! }],
        },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  const linkedUser = await prisma.user.findFirst({
    where: { telegramUserId: BigInt(creatorId) },
    include: { tenantMembers: { where: { role: 'owner' }, take: 1 } },
  });
  const linkedTenantId = linkedUser?.tenantMembers[0]?.tenantId as string | undefined;

  // 2) Linked tenant has any pending (user changed @username in Telegram UI)
  if (!provisionReq && linkedTenantId) {
    provisionReq = await prisma.botProvisionRequest.findFirst({
      where: {
        tenantId: linkedTenantId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 3) Linked tenant has no pending (wrong workspace linked) — if all live
  //    pendings belong to one tenant, use that tenant's newest request.
  if (!provisionReq) {
    const pending = await prisma.botProvisionRequest.findMany({
      where: { status: 'pending', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const tenantIds = [...new Set(pending.map((p) => p.tenantId))];
    if (tenantIds.length === 1) {
      provisionReq = pending[0] ?? null;
    } else if (pending.length > 0) {
      const aiOnly = pending.filter((p) => p.botType === 'ai_tg');
      const aiTenants = [...new Set(aiOnly.map((p) => p.tenantId))];
      if (aiTenants.length === 1) {
        provisionReq = aiOnly[0] ?? null;
      }
    }
  }

  const tenantId = provisionReq?.tenantId || linkedTenantId;
  if (!tenantId) return null;

  if (!provisionReq) {
    provisionReq = await prisma.botProvisionRequest.findFirst({
      where: {
        tenantId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  return {
    tenantId,
    provisionReq: provisionReq
      ? { id: provisionReq.id, tenantId: provisionReq.tenantId, botType: provisionReq.botType }
      : null,
  };
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

  const resolved = await resolveProvisionForManagedBot({ creatorId, username });
  if (!resolved) {
    console.warn(
      `[manager-bot-service] No tenant for telegram creator_id=${creatorId} username=@${username}`,
    );
    return;
  }

  const { tenantId } = resolved;
  let { provisionReq } = resolved;

  await assignTelegramToTenantOwner(creatorId, tenantId);
  console.log(
    `[manager-bot-service] Telegram ${creatorId} → tenant ${tenantId} (provision=${provisionReq?.id || 'none'})`,
  );

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
        tenantId, // reclaim if previously on wrong tenant
      },
    });
    if (provisionReq) {
      await prisma.botProvisionRequest.update({
        where: { id: provisionReq.id },
        data: { status: 'confirmed' },
      });
    }
    await registerChildBotWebhook(token, tenantId, existing.id, existing.botType);
    console.log(`[manager-bot-service] Bot @${username} token refreshed for tenant ${tenantId}`);
    return;
  }

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

  // Cancel sibling pending duplicates for this tenant+type (multi-click in portal)
  await prisma.botProvisionRequest.updateMany({
    where: {
      tenantId,
      botType: provisionReq.botType,
      status: 'pending',
      id: { not: provisionReq.id },
    },
    data: { status: 'cancelled' },
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

  const allowed_updates =
    botType === 'ai_tg'
      ? [
          'message',
          'callback_query',
          'business_connection',
          'business_message',
          'edited_business_message',
          'deleted_business_messages',
        ]
      : ['message', 'callback_query', 'chat_member'];

  const response = await fetch(`${botApi}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates,
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
    include: {
      tenant: {
        include: {
          users: { include: { user: true }, where: { role: 'owner' }, take: 1 },
        },
      },
    },
  });

  if (!provisionReq) {
    await sendManagerMessage(telegramUserId, '❌ Ссылка устарела или недействительна.');
    return;
  }

  await assignTelegramToTenantOwner(telegramUserId, provisionReq.tenantId);

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
