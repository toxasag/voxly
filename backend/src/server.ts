import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { closePool, queryOne } from "./db/client.js";
import { getEnv } from "./config/env.js";
import { TelegramService } from "./modules/auth/telegram.service.js";
import { MaxService } from "./services/max.service.js";
import { scheduleAuthMaintenance } from "./services/auth-maintenance.service.js";
import { scheduleTaskReminders } from "./modules/crm/tasks/task-reminders.service.js";
import { initBackgroundWorker, shutdownWorker } from "./worker.js";
import { TelegramTransportService } from "./modules/channels/telegram-transport.service.js";
import { registerOutboundSender } from "./modules/channels/outbound-registry.js";
import { MaxBridgeService } from "./modules/channels/max-bridge.service.js";
import { WhatsappEvolutionService } from "./modules/channels/whatsapp-evolution.service.js";

/**
 * Прописывает адрес webhook у бота при старте.
 *
 * Делается автоматически, а не разово вручную, потому что у бота обнаружился
 * webhook на `https://api.getvoxly.ru/bots/platform/webhook` — адрес снятого
 * легаси-стека, отдающий 404. Telegram молча доставлял обновления в никуда, и
 * привязка чата не работала бы, даже если код верен. Автоматическая
 * регистрация не даёт адресу разойтись с фактическим маршрутом.
 */
async function registerTelegramWebhook(app: FastifyInstance): Promise<void> {
  const env = getEnv();
  const telegram = new TelegramService();

  if (!telegram.isConfigured) {
    app.log.warn("TELEGRAM_AUTH_BOT_TOKEN is not set — Telegram code delivery is disabled");
    return;
  }

  const base = env.PUBLIC_API_URL;

  if (base === undefined || base.length === 0) {
    app.log.warn("PUBLIC_API_URL is not set — skipping Telegram webhook registration");
    return;
  }

  const url = `${base.replace(/\/+$/, "")}/auth/telegram/webhook`;
  const result = await telegram.setWebhook(url, env.TELEGRAM_WEBHOOK_SECRET);

  if (result.ok) app.log.info({ url }, "Telegram webhook registered");
  else app.log.error({ url, reason: result.description }, "Telegram webhook registration failed");
}

/**
 * Подписывает MAX-бота на события при старте.
 *
 * Обязательно на каждом старте, а не разово: MAX отписывает бота автоматически,
 * если endpoint не отвечает 8 часов, поэтому после простоя подписку нужно
 * восстанавливать. Кроме того, платформа принимает только HTTPS на порту 443 —
 * при `PUBLIC_API_URL` на http подписка не создастся, и это видно в логе.
 */
async function registerMaxWebhook(app: FastifyInstance): Promise<void> {
  const env = getEnv();
  const max = new MaxService();

  if (!max.isConfigured) {
    app.log.warn("MAX_BOT_TOKEN is not set — MAX code delivery is disabled");
    return;
  }

  const base = env.PUBLIC_API_URL;

  if (base === undefined || base.length === 0) {
    app.log.warn("PUBLIC_API_URL is not set — skipping MAX webhook registration");
    return;
  }

  const url = `${base.replace(/\/+$/, "")}/auth/max/webhook`;

  if (!url.startsWith("https://")) {
    app.log.error({ url }, "MAX webhook requires HTTPS on port 443 — registration skipped");
    return;
  }

  const result = await max.setWebhook(url, env.MAX_WEBHOOK_SECRET);

  if (result.ok) app.log.info({ url }, "MAX webhook registered");
  else app.log.error({ url, reason: result.reason }, "MAX webhook registration failed");
}

async function main(): Promise<void> {
  // Fail fast on bad configuration, before a port is bound or a pool opened.
  let env: ReturnType<typeof getEnv>;

  try {
    env = getEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const app = await buildApp();

  const { HOST: host, PORT: port } = env;

  // Инициализация обработчиков фоновых очередей (M7.2).
  initBackgroundWorker();

  // Периодическая очистка просроченных строк аутентификации (M0.8.12).
  // Ставится здесь, а не в buildApp: `buildApp` используется и тестами, где
  // фоновый таймер только мешал бы.
  const stopMaintenance = scheduleAuthMaintenance(app.log);

  // Периодическая проверка напоминаний по задачам (Twenty CRM Parity).
  const stopReminders = scheduleTaskReminders(app.log);

  // Транспорт входящих сообщений Telegram (M7.5.16).
  //
  // Тоже здесь, а не в buildApp: слушатель держит постоянные MTProto-сокеты по
  // всем подключённым аккаунтам, и в тестах это означало бы сетевые соединения на
  // каждый прогон.
  //
  // Только в одном процессе: при нескольких репликах каждая подписалась бы на те
  // же аккаунты, и клиент получил бы по ответу от каждой.
  const transport = new TelegramTransportService(app.log);
  const stopTransport = transport.start();

  // Регистрация исходящих сообщений через личный аккаунт MAX (max-bridge) или бота платформы MAX
  const unregisterMaxOutbound = registerOutboundSender("max", async (message) => {
    const maxBridge = new MaxBridgeService();
    try {
      const account = await queryOne<{ label: string }>(
        `SELECT label FROM channel_accounts
         WHERE tenant_id = $1 AND id = $2 AND channel = 'max' AND deleted_at IS NULL`,
        [message.tenantId, message.channelAccountId],
      );
      if (account) {
        const res = await maxBridge.sendMessage({
          tenantId: message.tenantId,
          name: account.label,
          chatId: message.recipient,
          text: message.text,
        });
        if (res.ok) return { ok: true };
      }
    } catch {
      // Fallback к Bot API
    }

    const max = new MaxService();
    if (!max.isConfigured) {
      return { ok: false, reason: "MAX не настроен на платформе" };
    }
    const res = await max.sendMessage(message.recipient, message.text);
    if (res.ok) return { ok: true };
    return { ok: false, reason: res.reason ?? "Неизвестная ошибка платформы MAX" };
  });

  // Регистрация исходящих сообщений через WhatsApp Evolution API
  const unregisterWhatsappOutbound = registerOutboundSender("whatsapp", async (message) => {
    const evo = new WhatsappEvolutionService();
    if (!evo.isConfigured) {
      return { ok: false, reason: "Evolution API (WhatsApp) не настроен" };
    }
    try {
      const account = await queryOne<{ credentials: { instanceName?: string } }>(
        `SELECT credentials FROM channel_accounts
         WHERE tenant_id = $1 AND id = $2 AND channel = 'whatsapp' AND deleted_at IS NULL`,
        [message.tenantId, message.channelAccountId],
      );
      const instanceName = account?.credentials?.instanceName;
      if (!instanceName) {
        return { ok: false, reason: "Инстанс WhatsApp не найден у подключения" };
      }
      const res = await evo.sendTextMessage(instanceName, message.recipient, message.text);
      if (res.ok) return { ok: true };
      return { ok: false, reason: res.error ?? "Ошибка отправки WhatsApp" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  });

  // Drain in-flight requests, then release DB connections.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down");

    try {
      // Первым делом: прогон очистки или ответ агента, начавшийся во время
      // остановки, обращался бы к уже закрытому пулу.
      stopMaintenance();
      stopReminders();
      await shutdownWorker();
      stopTransport();
      unregisterMaxOutbound();
      unregisterWhatsappOutbound();
      await app.close();
      await closePool();
      process.exit(0);
    } catch (error) {
      app.log.error(error, "Graceful shutdown failed");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ host, port });
    app.log.info(`Server listening on http://${host}:${port}`);

    // Регистрируется после начала приёма запросов, иначе платформа успела бы
    // прислать обновление в ещё не поднятый сервер. Ошибка не фатальна: без
    // webhook остаётся вход по паролю, поэтому сервер продолжает работу.
    await registerTelegramWebhook(app);
    await registerMaxWebhook(app);
  } catch (error) {
    app.log.error(error);
    await closePool();
    process.exit(1);
  }
}

void main();
