import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { LogLevel } from "telegram/extensions/Logger.js";

import { getEnv } from "../../config/env.js";
import { query, queryOne, runWithPlatformScope, runWithTenantContext } from "../../db/client.js";
import { decryptSecret, isEncrypted } from "../../services/credentials-cipher.js";
import { AgentPipelineService } from "../ai/agent-pipeline.service.js";
import { CrmPipelineService } from "../crm/crm-pipeline.service.js";
import { nextTypingPauseMs } from "../ai/agent-reply.js";
import { IncomingMessageBuffer, type BufferedIncoming } from "./incoming-buffer.js";
import { registerOutboundSender } from "./outbound-registry.js";
import { ChannelProfileCache } from "./profile-cache.js";
import type { ChannelProfile } from "../crm/crm-pipeline.service.js";

// ---------------------------------------------------------------------------
// Транспорт входящих и исходящих сообщений Telegram (M7.5.16).
//
// Работает через MTProto (GramJS) от имени подключённого аккаунта пользователя, а
// не через бота: клиенты пишут в личку компании, и бот их сообщений не видит.
//
// Соединения живут всё время работы процесса. Это отличает слушателя от
// `TelegramMtprotoService`, где клиент создаётся на один вызов и закрывается:
// подписка на обновления требует постоянного сокета, иначе Telegram не доставит
// `NewMessage`.
//
// Реплики: слушатель поднимается только в одном процессе. При нескольких
// репликах бэкенда каждая подписалась бы на те же аккаунты, и клиент получил бы
// по ответу от каждой. Пока бэкенд запускается одним контейнером; при
// масштабировании понадобится блокировка (advisory lock в PostgreSQL) — отмечено
// в ROADMAP.
// ---------------------------------------------------------------------------

/** Таймаут подключения к Telegram, как в `TelegramMtprotoService`. */
const CONNECTION_TIMEOUT_MS = 20_000;
const CONNECTION_RETRIES = 3;

/**
 * Задержка первого подъёма сессий после старта процесса.
 *
 * Не сразу: миграции в entrypoint только что завершились, и нагружать старт
 * подключением к Telegram по всем аккаунтам одновременно с прогревом приложения
 * незачем. Плюс healthcheck успевает пройти до первой сетевой операции.
 */
const STARTUP_DELAY_MS = 15_000;

/**
 * Периодическая сверка списка аккаунтов.
 *
 * Аккаунт могли подключить или отключить после старта процесса. Опрос раз в
 * минуту вместо подписки на изменения в БД: LISTEN/NOTIFY потребовал бы
 * отдельного соединения из пула, а задержка до минуты для подключения канала
 * незаметна.
 */
const RESYNC_INTERVAL_MS = 60_000;

interface Logger {
  info: (obj: object, message: string) => void;
  warn: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

interface AccountRow {
  id: string;
  tenant_id: string;
  label: string;
  credentials: { session?: string } | null;
  credentials_encrypted: boolean;
}

interface ActiveConnection {
  accountId: string;
  tenantId: string;
  client: TelegramClient;
  /** Снятие обработчика при отключении аккаунта. */
  detach: () => void;
}

export class TelegramTransportService {
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly buffer: IncomingMessageBuffer;
  /** Профили собеседников: имя не меняется каждое сообщение. */
  private readonly profiles = new ChannelProfileCache();
  private startupTimer: NodeJS.Timeout | null = null;
  private resyncTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** Снятие регистрации в реестре исходящих; ставится в `start()`. */
  private unregisterOutbound: (() => void) | null = null;

  constructor(
    private readonly log: Logger,
    private readonly pipeline: AgentPipelineService = new AgentPipelineService(log),
    private readonly crm: CrmPipelineService = new CrmPipelineService(),
  ) {
    this.buffer = new IncomingMessageBuffer((batch) => this.handleBatch(batch), log);
  }

  get isConfigured(): boolean {
    const env = getEnv();
    return env.TELEGRAM_API_ID !== undefined && env.TELEGRAM_API_HASH !== undefined;
  }

  /** Сколько аккаунтов слушается. Для диагностики и тестов. */
  get activeCount(): number {
    return this.connections.size;
  }

  // -------------------------------------------------------------------------
  // Жизненный цикл
  // -------------------------------------------------------------------------

  /**
   * Ставит подъём сессий на расписание и возвращает функцию остановки.
   *
   * Не поднимает сразу и не бросает при ошибке: недоступный Telegram или
   * отозванная сессия не должны мешать старту API. Отказ по конкретному аккаунту
   * логируется, остальные продолжают работать.
   */
  start(): () => void {
    if (!this.isConfigured) {
      this.log.warn(
        {},
        "TELEGRAM_API_ID/TELEGRAM_API_HASH are not set — Telegram transport is disabled",
      );
      return () => undefined;
    }

    // Регистрация сразу, до подъёма сессий: маршрут отправки спрашивает
    // отправителя по каналу, а не по конкретному соединению, и до `resync`
    // получает честный отказ «аккаунт не подключён» вместо «канал не умеет
    // отправлять». Без регистрации отказ был бы одинаковым для выключенного
    // транспорта и для ещё не поднятого аккаунта.
    this.unregisterOutbound = registerOutboundSender("telegram", (message) =>
      this.sendOutbound(message),
    );

    this.startupTimer = setTimeout(() => {
      void this.resync();

      this.resyncTimer = setInterval(() => void this.resync(), RESYNC_INTERVAL_MS);
      this.resyncTimer.unref();
    }, STARTUP_DELAY_MS);

    // `unref()`: иначе ожидающий таймер удерживал бы event loop и процесс не
    // завершался бы по SIGTERM.
    this.startupTimer.unref();

    return () => void this.stop();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.unregisterOutbound !== null) {
      this.unregisterOutbound();
      this.unregisterOutbound = null;
    }

    if (this.startupTimer !== null) clearTimeout(this.startupTimer);
    if (this.resyncTimer !== null) clearInterval(this.resyncTimer);

    // Буфер снимается без отправки: обработчик обращается к БД и Telegram, а на
    // остановке пул уже закрывается.
    this.buffer.clear();
    this.profiles.clear();

    for (const connection of this.connections.values()) {
      connection.detach();
      await this.destroy(connection.client);
    }

    this.connections.clear();
  }

  /**
   * Приводит набор соединений к списку подключённых аккаунтов.
   *
   * Идемпотентна: уже подключённые аккаунты не переподключаются, исчезнувшие
   * отключаются. Поэтому её можно вызывать по расписанию без учёта предыдущего
   * состояния.
   */
  private async resync(): Promise<void> {
    if (this.stopped) return;

    let accounts: AccountRow[];

    try {
      // Только `connected`: `pending` — не завершённая авторизация, `error` и
      // `disabled` — сознательно выключенные администратором.
      //
      // Читается в platform-scope, потому что слушатель обслуживает всех
      // арендаторов сразу и до чтения строки не знает, какому она принадлежит.
      // Без этого запрос возвращал бы ноль строк: `channel_accounts` под RLS, и
      // вне tenant-контекста `current_tenant_id()` — NULL, поэтому политика не
      // пропускает ничего. Проверено на живой БД: под `app_user` с пустым GUC
      // существующий подключённый аккаунт не виден.
      //
      // Запись при этом остаётся в контексте арендатора: в `WITH CHECK` политики
      // нет `platform_scope()`, поэтому обновления идут через
      // `runWithTenantContext`.
      accounts = await runWithPlatformScope(() =>
        query<AccountRow>(
          `SELECT id, tenant_id, label, credentials, credentials_encrypted
           FROM channel_accounts
           WHERE channel = 'telegram'
             AND status = 'connected'
             AND deleted_at IS NULL`,
        ),
      );
    } catch (error) {
      this.log.error({ error }, "Failed to list Telegram accounts for transport");
      return;
    }

    const wanted = new Set(accounts.map((account) => account.id));

    // Отключаем исчезнувшие.
    for (const [accountId, connection] of this.connections) {
      if (wanted.has(accountId)) continue;

      connection.detach();
      await this.destroy(connection.client);
      this.connections.delete(accountId);
      // Сессия при переподключении будет другой, а вместе с ней и права на
      // просмотр профилей: держать прежние записи нельзя.
      this.profiles.forgetAccount(accountId);

      this.log.info({ accountId }, "Telegram account disconnected from transport");
    }

    // Подключаем новые.
    for (const account of accounts) {
      if (this.connections.has(account.id)) continue;
      if (this.stopped) return;

      await this.attach(account);
    }
  }

  /**
   * Поднимает соединение по одному аккаунту.
   *
   * Сессия хранится зашифрованной (`credentials.session`, AES-256-GCM). Строки,
   * созданные до миграции 0013, могут быть в открытом виде — признак
   * `credentials_encrypted` отличает их, и `isEncrypted` страхует от двойной
   * расшифровки.
   */
  private async attach(account: AccountRow): Promise<void> {
    const stored = account.credentials?.session;

    if (typeof stored !== "string" || stored.length === 0) {
      this.log.warn(
        { accountId: account.id },
        "Telegram account has no stored session — skipping",
      );
      return;
    }

    let sessionState: string;

    try {
      sessionState = isEncrypted(stored) ? decryptSecret(stored) : stored;
    } catch (error) {
      this.log.error(
        { error, accountId: account.id },
        "Failed to decrypt Telegram session — skipping",
      );
      return;
    }

    const env = getEnv();
    const apiId = env.TELEGRAM_API_ID;
    const apiHash = env.TELEGRAM_API_HASH;

    if (apiId === undefined || apiHash === undefined) return;

    let client: TelegramClient | null = null;

    try {
      client = new TelegramClient(new StringSession(sessionState), apiId, apiHash, {
        connectionRetries: CONNECTION_RETRIES,
        timeout: Math.floor(CONNECTION_TIMEOUT_MS / 1000),
        deviceModel: "GETVOXLY CRM",
        systemVersion: "1.0",
        appVersion: "1.0",
        useWSS: false,
      });

      // Логгер приглушён: на info GramJS печатает содержимое пакетов MTProto,
      // включая фрагменты чужих сообщений, в stdout контейнера.
      client.setLogLevel(LogLevel.ERROR);
      await client.connect();

      const authorized = await client.checkAuthorization();

      if (!authorized) {
        // Пользователь отозвал сессию в приложении Telegram. Помечаем аккаунт,
        // чтобы интерфейс показал причину, а не «подключён» при мёртвой сессии.
        await this.markAccountError(account, "Сессия отозвана в Telegram");
        await this.destroy(client);
        return;
      }

      const handler = (event: NewMessageEvent): void => {
        void this.onIncoming(account, event);
      };

      // M5.3: слушаем входящие и нативные исходящие (fromMe). Исходящие от оператора
      // фиксируются в CRM и включают AI handoff (паузу бота на 30 мин).
      const messageFilter = new NewMessage({});
      client.addEventHandler(handler, messageFilter);

      this.connections.set(account.id, {
        accountId: account.id,
        tenantId: account.tenant_id,
        client,
        detach: () => client?.removeEventHandler(handler, messageFilter),
      });

      // Запись — в контексте арендатора: `WITH CHECK` политики не содержит
      // `platform_scope()`, поэтому в platform-scope этот UPDATE не затронул бы
      // ни одной строки и молча ничего не сделал.
      await runWithTenantContext(account.tenant_id, () =>
        query(`UPDATE channel_accounts SET last_sync_at = now() WHERE id = $1`, [account.id]),
      );

      this.log.info(
        { accountId: account.id, label: account.label },
        "Telegram account attached to transport",
      );
    } catch (error) {
      this.log.error(
        { error, accountId: account.id },
        "Failed to attach Telegram account to transport",
      );

      if (client !== null) await this.destroy(client);
    }
  }

  /** Запись в контексте арендатора: `WITH CHECK` политики требует его. */
  private async markAccountError(account: AccountRow, reason: string): Promise<void> {
    try {
      await runWithTenantContext(account.tenant_id, () =>
        query(
          `UPDATE channel_accounts
           SET status = 'error', status_message = $2, updated_at = now()
           WHERE id = $1`,
          [account.id, reason],
        ),
      );
    } catch (error) {
      this.log.error(
        { error, accountId: account.id },
        "Failed to mark Telegram account as errored",
      );
    }
  }

  // -------------------------------------------------------------------------
  // Входящие
  // -------------------------------------------------------------------------

  /**
   * Обработчик `NewMessage`.
   *
   * Фильтрует всё, что не является личным сообщением от клиента: группы, каналы,
   * служебные сообщения и собственные исходящие. Без фильтра агент отвечал бы в
   * рабочих чатах компании и в каналах, где аккаунт состоит подписчиком.
   */
  private async onIncoming(account: AccountRow, event: NewMessageEvent): Promise<void> {
    try {
      const message = event.message;

      // Только личные диалоги: `isPrivate` ложно для групп и каналов.
      if (event.isGroup === true || event.isChannel === true) return;

      const senderId = message.senderId?.toString();
      const chatId = message.chatId?.toString() ?? senderId;

      if (senderId === undefined || chatId === undefined) return;

      const text = typeof message.message === "string" ? message.message.trim() : "";

      // M5.3: Зеркалирование нативных исходящих от оператора (fromMe)
      if (message.out === true) {
        if (text.length > 0) {
          await runWithTenantContext(account.tenant_id, () =>
            this.crm.processNativeOutbound({
              tenantId: account.tenant_id,
              channel: "telegram",
              channelAccountId: account.id,
              chatId,
              text,
              senderName: "Менеджер",
              pauseMinutes: 30,
            }),
          ).catch((error) => {
            this.log.error(
              { error, accountId: account.id, chatId },
              "Failed to mirror native outbound message",
            );
          });
        }
        return;
      }

      // Медиа без подписи пропускаем: распознавание голоса и изображений не
      // реализовано, а ответ «не понял» на голосовое хуже молчания оператора.
      if (text.length === 0) {
        this.log.info(
          { accountId: account.id },
          "Incoming message without text (media/voice) — ignored",
        );
        return;
      }

      this.buffer.add({
        tenantId: account.tenant_id,
        channelAccountId: account.id,
        chatId,
        peerId: senderId,
        text,
      });
    } catch (error) {
      this.log.error({ error, accountId: account.id }, "Failed to handle incoming message");
    }
  }

  /**
   * Обрабатывает пачку по истечении дебаунса: сохраняет входящее сообщение в CRM,
   * спрашивает агента, сохраняет ответ и отправляет его.
   */
  private async handleBatch(batch: BufferedIncoming): Promise<void> {
    const connection = this.connections.get(batch.channelAccountId);

    if (connection === undefined) {
      this.log.warn(
        { channelAccountId: batch.channelAccountId },
        "Batch ready but the account is no longer connected",
      );
      return;
    }

    // 1. Профиль собеседника — до записи в CRM: контакт создаётся один раз, и
    // заполнить имя потом будет нечем. Отказ не мешает сохранить переписку.
    const profile = await this.fetchProfile(connection, batch.peerId);

    // 2. Сохраняем входящее сообщение в CRM и получаем/создаём контакт и сделку.
    let dealId: string | null = null;

    try {
      const crmResult = await runWithTenantContext(batch.tenantId, () =>
        this.crm.processIncoming({
          tenantId: batch.tenantId,
          channel: "telegram",
          channelAccountId: batch.channelAccountId,
          chatId: batch.chatId,
          text: batch.text,
          senderName: batch.peerId,
          senderTelegramChatId: batch.peerId,
          profile: profile ?? undefined,
        }),
      );

      dealId = crmResult.dealId;
    } catch (error) {
      this.log.error(
        { error, chatId: batch.chatId, channelAccountId: batch.channelAccountId },
        "Failed to process CRM pipeline for incoming batch",
      );
    }

    // 3. Проверяем AI Handoff (пауза бота при недавнем ответе оператора).
    if (dealId !== null) {
      const isPaused = await runWithTenantContext(batch.tenantId, async () => {
        const row = await queryOne<{ id: string }>(
          `SELECT id FROM deals
           WHERE tenant_id = $1 AND id = $2 AND ai_paused_until > now()
           LIMIT 1`,
          [batch.tenantId, dealId],
        );
        return row !== null;
      }).catch(() => false);

      if (isPaused) {
        this.log.info(
          { dealId, channelAccountId: batch.channelAccountId },
          "AI bot paused due to active operator handoff",
        );
        return;
      }
    }

    // 4. Спрашиваем агента (в контексте арендатора, как раньше).
    const outcome = await runWithTenantContext(batch.tenantId, () =>
      this.pipeline.prepareReply({
        tenantId: batch.tenantId,
        channelAccountId: batch.channelAccountId,
        chatId: batch.chatId,
        text: batch.text,
      }),
    );

    // 4. Сохраняем ответ агента в CRM и отправляем в Telegram.
    if (outcome.kind === "replied" && dealId !== null) {
      try {
        await runWithTenantContext(batch.tenantId, () =>
          this.crm.saveAgentReply({
            tenantId: batch.tenantId,
            dealId,
            reply: outcome.reply,
            channel: "telegram",
            channelAccountId: batch.channelAccountId,
          }),
        );
      } catch (error) {
        this.log.error(
          { error, dealId, channelAccountId: batch.channelAccountId },
          "Failed to save agent reply to CRM",
        );
      }

      await this.sendReply({
        client: connection.client,
        peerId: batch.peerId,
        messages: outcome.reply.messages,
      });

      this.log.info(
        {
          chatId: batch.chatId,
          channelAccountId: batch.channelAccountId,
          messageCount: batch.messageCount,
          sent: outcome.reply.messages.length,
          chargedKopecks: outcome.chargedKopecks,
          model: outcome.model,
        },
        "Agent replied to the incoming batch",
      );
      return;
    }

    // Агент не ответил — только логируем.
    this.log.info(
      {
        reason: outcome.kind,
        chatId: batch.chatId,
        channelAccountId: batch.channelAccountId,
        messageCount: batch.messageCount,
      },
      "Agent did not reply to the incoming batch",
    );
  }

  // -------------------------------------------------------------------------
  // Профиль собеседника
  // -------------------------------------------------------------------------

  /**
   * Имя, username и номер собеседника.
   *
   * Нужны при автосоздании контакта: без них в CRM попадал числовой id Telegram
   * вместо имени, а в `socials` — нерабочая ссылка `t.me/{chatId}`.
   *
   * Отказ проглатывается и кэшируется как «профиля нет»: сохранить переписку
   * важнее, чем заполнить имя, а повторять неудачный запрос на каждое сообщение
   * значит не иметь кэша вовсе. Приватность Telegram — обычная причина отказа, а
   * не сбой.
   *
   * `getEntity`, а не `GetFullUser`: полный профиль здесь не нужен (о себе
   * клиент ничего не писал), а `getEntity` использует внутренний кэш GramJS и
   * обходится без сетевого вызова, когда peer уже известен по этому же
   * сообщению.
   */
  private async fetchProfile(
    connection: ActiveConnection,
    peerId: string,
  ): Promise<ChannelProfile | null> {
    const cached = this.profiles.get(connection.accountId, peerId);
    if (cached !== undefined) return cached;

    let profile: ChannelProfile | null = null;

    try {
      const entity = await connection.client.getEntity(peerId);

      if (entity instanceof Api.User) {
        profile = {
          firstName: entity.firstName ?? undefined,
          lastName: entity.lastName ?? undefined,
          username: entity.username ?? undefined,
          // Номер приходит только если открыт настройками приватности или
          // собеседник в контактах аккаунта.
          phone: entity.phone ?? undefined,
        };
      }
    } catch (error) {
      this.log.warn(
        { error, peerId, accountId: connection.accountId },
        "Failed to fetch Telegram profile — contact will be created without a name",
      );
    }

    this.profiles.set(connection.accountId, peerId, profile);
    return profile;
  }

  // -------------------------------------------------------------------------
  // Исходящие
  // -------------------------------------------------------------------------

  /**
   * Отправка ответа менеджера из карточки сделки.
   *
   * Публичный вход для реестра исходящих: соединение выбирается по аккаунту, с
   * которого идёт переписка, а не создаётся заново — авторизация лежит в сессии
   * подключённого аккаунта, и второе соединение по той же сессии Telegram
   * воспринимает как новый вход.
   *
   * Без имитации печати, в отличие от ответа агента: менеджер печатал сам, и
   * пауза перед доставкой означала бы, что клиент ждёт дольше без причины.
   */
  async sendOutbound(message: {
    channelAccountId: string;
    recipient: string;
    text: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const connection = this.connections.get(message.channelAccountId);

    if (connection === undefined) {
      return { ok: false, reason: "Аккаунт Telegram не подключён к транспорту" };
    }

    try {
      await connection.client.sendMessage(message.recipient, { message: message.text });
      return { ok: true };
    } catch (error) {
      this.log.error(
        { error, channelAccountId: message.channelAccountId },
        "Failed to send manager reply to Telegram",
      );

      // Текст ошибки Telegram попадает в таймлайн, поэтому берётся сообщение
      // исключения, а не общая фраза: «USER_IS_BLOCKED» и «FLOOD_WAIT» требуют
      // разных действий оператора.
      const reason = error instanceof Error ? error.message : "Неизвестная ошибка Telegram";
      return { ok: false, reason: `Telegram отклонил отправку: ${reason}` };
    }
  }

  /**
   * Отправляет набор сообщений с имитацией печати.
   *
   * Порядок по заданию: «печатает» → первое сообщение → пауза 2.5–4.5 с со
   * статусом «печатает» → следующее. Статус ставится перед каждым сообщением, а
   * не один раз: Telegram гасит его через ~5 секунд, и при паузе до 4.5 с он
   * успевал бы исчезнуть.
   *
   * Ошибка отправки одного сообщения прерывает остаток: если Telegram отклонил
   * первую реплику (блокировка, flood wait), остальные тем более не уйдут, а
   * попытка их отправить продлила бы ограничение.
   */
  private async sendReply(input: {
    client: TelegramClient;
    peerId: string;
    messages: readonly string[];
  }): Promise<void> {
    for (const [index, text] of input.messages.entries()) {
      try {
        if (index > 0) {
          await this.setTyping(input.client, input.peerId);
          await this.sleep(nextTypingPauseMs());
        } else {
          await this.setTyping(input.client, input.peerId);
          // Короткая пауза перед первым сообщением: мгновенный ответ через 15
          // секунд тишины выглядит как автоответчик, а не как человек, который
          // прочитал и печатает.
          await this.sleep(1200);
        }

        await input.client.sendMessage(input.peerId, { message: text });
      } catch (error) {
        this.log.error(
          { error, peerId: input.peerId, index },
          "Failed to send agent reply message",
        );
        return;
      }
    }
  }

  /**
   * Статус «печатает».
   *
   * Отказ проглатывается: индикатор — украшение, и его недоступность не должна
   * мешать отправке самого ответа.
   */
  private async setTyping(client: TelegramClient, peerId: string): Promise<void> {
    try {
      await client.invoke(
        new Api.messages.SetTyping({
          peer: peerId,
          action: new Api.SendMessageTypingAction(),
        }),
      );
    } catch (error) {
      this.log.warn({ error, peerId }, "Failed to set typing status");
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref();
    });
  }

  private async destroy(client: TelegramClient): Promise<void> {
    try {
      await client.destroy();
    } catch {
      /* соединение всё равно отбрасывается */
    }
  }
}
