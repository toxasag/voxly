// Voxly Platform Bot (@GetVoxlybot): OTP deep-links + support inbox webhook.

const PLATFORM_BOT_TOKEN = process.env.PLATFORM_BOT_TOKEN || '';
const PLATFORM_BOT_USERNAME = process.env.PLATFORM_BOT_USERNAME || 'GetVoxlybot';
const WEBHOOK_PORT = parseInt(process.env.PLATFORM_BOT_PORT || '3009', 10);
const SAAS_API_URL = (process.env.SAAS_API_URL || 'http://saas-api:3002').replace(/\/+$/, '');
const SERVICE_TOKEN = process.env.VOXLY_SERVICE_TOKEN || '';
const USE_POLLING = process.env.PLATFORM_USE_POLLING === 'true';

if (!PLATFORM_BOT_TOKEN) {
  console.error('PLATFORM_BOT_TOKEN is required');
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${PLATFORM_BOT_TOKEN}`;

async function main() {
  if (USE_POLLING) {
    await fetch(`${TELEGRAM_API}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
    console.log('[platform-bot] Long-polling mode');
    void pollUpdates();
  } else {
    await setWebhook();
  }
  await startNodeServer();
  console.log(`[platform-bot] Listening on :${WEBHOOK_PORT} @${PLATFORM_BOT_USERNAME}`);
}

async function setWebhook() {
  const webhookUrl =
    process.env.PLATFORM_WEBHOOK_URL ||
    `http://platform-bot-service:${WEBHOOK_PORT}/webhook`;
  const res = await fetch(`${TELEGRAM_API}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message'],
      drop_pending_updates: process.env.PLATFORM_WEBHOOK_DROP_PENDING === 'true',
    }),
  });
  const data = (await res.json()) as { ok?: boolean };
  if (data.ok) console.log('[platform-bot] Webhook set');
  else console.error('[platform-bot] setWebhook failed:', data);
}

async function pollUpdates() {
  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(
        `${TELEGRAM_API}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`,
      );
      const data = (await res.json()) as {
        ok?: boolean;
        result?: Array<{
          update_id: number;
          message?: {
            text?: string;
            chat?: { id: number };
            from?: { id: number; username?: string; first_name?: string; last_name?: string };
          };
        }>;
      };
      if (!data.ok) {
        await sleep(3000);
        continue;
      }
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (err) {
      console.error('[platform-bot] poll error:', err);
      await sleep(3000);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function requestPath(url: string | undefined): string {
  return (url || '').split('?')[0] || '';
}

function isWebhookPath(pathname: string): boolean {
  return pathname === '/webhook' || pathname === '/bots/platform/webhook';
}

async function startNodeServer() {
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    const pathname = requestPath(req.url);
    if (req.method === 'POST' && isWebhookPath(pathname)) {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        await handleUpdate(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('[platform-bot] webhook error:', err);
        res.writeHead(500);
        res.end('error');
      }
      return;
    }
    if (req.method === 'GET' && (pathname === '/health' || pathname === '/bots/platform/health')) {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  server.listen(WEBHOOK_PORT);
}

async function handleUpdate(update: {
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
  };
}) {
  const msg = update.message;
  if (!msg?.chat?.id || !msg.from?.id) return;

  const text = String(msg.text || '').trim();
  const chatId = msg.chat.id;
  const telegramUserId = msg.from.id;
  const username = msg.from.username || null;

  const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  if (startMatch) {
    const payload = (startMatch[1] || '').trim();
    if (payload.startsWith('auth_')) {
      const nonce = payload.slice('auth_'.length);
      await callSaasApi('/api/internal/platform-bot/bind-auth', {
        nonce,
        telegramUserId,
        username,
        chatId,
      });
      return;
    }
    await callSaasApi('/api/internal/platform-bot/ensure-subscriber', {
      telegramUserId,
      username,
      chatId,
    });
    await sendTelegram(
      chatId,
      'Привет! Это бот Voxly.\n\n' +
        '• Для входа/регистрации откройте ссылку с сайта getvoxly.ru — я пришлю код подтверждения.\n' +
        '• По вопросам пишите сюда — ответит поддержка.',
    );
    return;
  }

  // Support inbox
  await callSaasApi('/api/internal/platform-bot/support-inbound', {
    telegramUserId,
    username,
    chatId,
    text: text || '[без текста]',
  });
  await sendTelegram(chatId, 'Сообщение принято. Поддержка ответит здесь.');
}

async function callSaasApi(path: string, body: Record<string, unknown>): Promise<void> {
  if (!SERVICE_TOKEN) {
    console.warn('[platform-bot] VOXLY_SERVICE_TOKEN unset — skip API', path);
    return;
  }
  try {
    const res = await fetch(`${SAAS_API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        'X-Voxly-Service': 'platform-bot',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(`[platform-bot] API ${path} → ${res.status}`, t.slice(0, 300));
    }
  } catch (err) {
    console.error(`[platform-bot] API ${path} failed:`, err);
  }
}

async function sendTelegram(chatId: number, text: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
