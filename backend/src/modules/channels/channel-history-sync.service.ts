import { query, queryOne, runWithTenantContext, transaction, withTenant } from "../../db/client.js";
import { queueManager } from "../../infrastructure/queue.js";
import { DealsService } from "../crm/deals/deals.service.js";
import { MaxBridgeService, type MaxBridgeDialog, type MaxPrivateDialogsResponse } from "./max-bridge.service.js";
import { normalizeMaxPhone, syncMaxContactIdentityFromDialog } from "./max-identity.js";
import { syncMaxDialogHistory } from "./max-integration.routes.js";
import { resolveTelegramHistorySyncer } from "./outbound-registry.js";
import { WhatsappEvolutionService } from "./whatsapp-evolution.service.js";
import { syncWhatsappDialogHistory } from "./whatsapp-integration.routes.js";

// ---------------------------------------------------------------------------
// Фоновая реконсиляция истории переписки при подключении канала (MAX, TG, WA).
//
// Инварианты:
//  1. Строгая изоляция по `tenant_id` (`withTenant` / `runWithTenantContext`).
//  2. Никаких внешних HTTP-вызовов к мессенджерам внутри транзакций PostgreSQL.
//  3. Идемпотентность: привязка к существующей активной сделке или создание
//     новой сделки с `chat_thread_id` ТОЛЬКО если у контакта реально есть
//     сообщения в мессенджере.
//  4. Защита ФИО и телефона контакта: существующие значения не затираются.
// ---------------------------------------------------------------------------

export type HistorySyncChannel = "max" | "telegram" | "whatsapp";

export interface ChannelHistorySyncJobData {
  tenantId: string;
  channelAccountId: string;
  channel: HistorySyncChannel;
}

interface CrmContactForSync {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  telegram_chat_id: string | number | null;
  telegram_username: string | null;
  messenger_id: string | null;
  socials: Array<{ kind?: string; value?: string }> | null;
  custom_fields: Record<string, unknown> | null;
}

const SYNC_SUPPORTED_CHANNELS = new Set<string>(["max", "telegram", "whatsapp"]);
const ACTIVE_SYNC_LOCK_MS = 5 * 60_000;

export function isHistorySyncSupportedChannel(channel: string): channel is HistorySyncChannel {
  return SYNC_SUPPORTED_CHANNELS.has(channel);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function digitsLast10(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function contactDisplayName(contact: CrmContactForSync): string {
  const full = [contact.first_name ?? "", contact.last_name ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
  return full || contact.phone || "Клиент";
}

function channelTitleLabel(channel: HistorySyncChannel): string {
  if (channel === "max") return "MAX";
  if (channel === "whatsapp") return "WhatsApp";
  return "Telegram";
}

async function updateSyncProgress(
  tenantId: string,
  channelAccountId: string,
  fields: {
    status?: "idle" | "queued" | "syncing" | "completed" | "error";
    total?: number;
    processed?: number;
    messages?: number;
    error?: string | null;
    started?: boolean;
    finished?: boolean;
  },
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.query(
      `UPDATE channel_accounts
       SET history_sync_status = COALESCE($3, history_sync_status),
           history_sync_total = COALESCE($4, history_sync_total),
           history_sync_processed = COALESCE($5, history_sync_processed),
           history_sync_messages = COALESCE($6, history_sync_messages),
           history_sync_error = CASE WHEN $7::boolean THEN $8 ELSE history_sync_error END,
           history_sync_started_at = CASE WHEN $9::boolean THEN now() ELSE history_sync_started_at END,
           history_sync_finished_at = CASE WHEN $10::boolean THEN now() ELSE history_sync_finished_at END,
           last_sync_at = CASE WHEN $10::boolean THEN now() ELSE last_sync_at END,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [
        tenantId,
        channelAccountId,
        fields.status ?? null,
        fields.total ?? null,
        fields.processed ?? null,
        fields.messages ?? null,
        fields.error !== undefined,
        fields.error ?? null,
        Boolean(fields.started),
        Boolean(fields.finished),
      ],
    );
  });
}

/**
 * Находит активную сделку контакта или создаёт новую в первом этапе воронки
 * с `chat_thread_id` (строго внутри короткой транзакции без внешних HTTP-вызовов).
 */
async function findOrCreateDealForContactSync(opts: {
  tenantId: string;
  contact: CrmContactForSync;
  channel: HistorySyncChannel;
  chatThreadId: string;
  lastMessagePreview?: string;
}): Promise<string | null> {
  const { tenantId, contact, channel, chatThreadId } = opts;

  return transaction(async (tx) => {
    // 1. Сначала ищем по chat_thread_id (инвариант дедупликации сделок)
    if (chatThreadId) {
      const byThread = await tx.queryOne<{ id: string }>(
        `SELECT id FROM deals
         WHERE tenant_id = $1 AND chat_thread_id = $2 AND deleted_at IS NULL AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1`,
        [tenantId, chatThreadId],
      );
      if (byThread) return byThread.id;
    }

    // 2. Затем ищем активную открытую сделку этого контакта
    const byContact = await tx.queryOne<{ id: string; chat_thread_id: string | null }>(
      `SELECT d.id, d.chat_thread_id FROM deals d
       LEFT JOIN stages s ON s.id = d.stage_id
       WHERE d.tenant_id = $1 AND d.contact_id = $2 AND d.deleted_at IS NULL
         AND COALESCE(d.status, 'active') = 'active'
         AND COALESCE(s.is_won, false) = false
         AND COALESCE(s.is_lost, false) = false
       ORDER BY d.updated_at DESC LIMIT 1`,
      [tenantId, contact.id],
    );

    if (byContact) {
      if (chatThreadId && !byContact.chat_thread_id) {
        await tx.query(
          `UPDATE deals SET chat_thread_id = $1, updated_at = now()
           WHERE id = $2 AND tenant_id = $3 AND chat_thread_id IS NULL`,
          [chatThreadId, byContact.id, tenantId],
        );
      }
      return byContact.id;
    }

    // 3. Создаём новую сделку в первом этапе первой воронки
    const pipeline = await tx.queryOne<{ id: string }>(
      `SELECT id FROM pipelines WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
      [tenantId],
    );
    if (!pipeline) return null;

    const stage = await tx.queryOne<{ id: string }>(
      `SELECT id FROM stages
       WHERE pipeline_id = $1 AND is_won = false AND is_lost = false
       ORDER BY sort_order ASC LIMIT 1`,
      [pipeline.id],
    );
    if (!stage) return null;

    const owner = await tx.queryOne<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    );
    if (!owner) return null;

    const dealsService = new DealsService();
    const created = await dealsService.createInTx(tx, tenantId, owner.id, {
      title: `Переписка: ${contactDisplayName(contact)} (${channelTitleLabel(channel)})`,
      description: opts.lastMessagePreview?.trim() || "",
      budget: 0,
      currency: "RUB",
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      contact_id: contact.id,
      chat_thread_id: chatThreadId || undefined,
      status: "active",
    });

    return created.id;
  });
}

/**
 * Ставит задачу массовой синхронизации истории по существующим контактам CRM в очередь `timeline-sync`.
 */
export async function enqueueChannelHistorySync(params: {
  tenantId: string;
  channelAccountId: string;
  channel: string;
  force?: boolean;
}): Promise<boolean> {
  if (!isHistorySyncSupportedChannel(params.channel)) {
    return false;
  }

  const acc = await runWithTenantContext(params.tenantId, () =>
    queryOne<{
      id: string;
      status: string;
      history_sync_status: string;
      history_sync_started_at: Date | string | null;
    }>(
      `SELECT id, status, history_sync_status, history_sync_started_at
       FROM channel_accounts
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [params.tenantId, params.channelAccountId],
    ),
  );

  if (!acc || acc.status !== "connected") {
    return false;
  }

  if (!params.force && (acc.history_sync_status === "syncing" || acc.history_sync_status === "queued")) {
    const startedMs = acc.history_sync_started_at ? new Date(acc.history_sync_started_at).getTime() : 0;
    if (startedMs > 0 && Date.now() - startedMs < ACTIVE_SYNC_LOCK_MS) {
      return false;
    }
  }

  await updateSyncProgress(params.tenantId, params.channelAccountId, {
    status: "queued",
    total: 0,
    processed: 0,
    messages: 0,
    error: null,
  });

  await queueManager.enqueue<ChannelHistorySyncJobData>({
    queue: "timeline-sync",
    tenantId: params.tenantId,
    name: "channel-history-sync",
    data: {
      tenantId: params.tenantId,
      channelAccountId: params.channelAccountId,
      channel: params.channel,
    },
    maxAttempts: 2,
    backoffMs: 5000,
  });

  return true;
}

/**
 * Выполняет синхронизацию истории переписки по всем имеющимся контактам CRM для подключённого аккаунта.
 */
export async function runChannelHistorySync(data: ChannelHistorySyncJobData): Promise<{
  processedContacts: number;
  syncedMessages: number;
}> {
  const { tenantId, channelAccountId, channel } = data;
  if (!isHistorySyncSupportedChannel(channel)) {
    return { processedContacts: 0, syncedMessages: 0 };
  }

  const account = await runWithTenantContext(tenantId, () =>
    queryOne<{
      id: string;
      status: string;
      credentials: { instanceName?: string; provider?: string; adapter?: string } | null;
    }>(
      `SELECT id, status, credentials FROM channel_accounts
       WHERE tenant_id = $1 AND id = $2 AND channel = $3 AND deleted_at IS NULL`,
      [tenantId, channelAccountId, channel],
    ),
  );

  if (!account || account.status !== "connected") {
    return { processedContacts: 0, syncedMessages: 0 };
  }

  const contacts = await runWithTenantContext(tenantId, () =>
    query<CrmContactForSync>(
      `SELECT id, first_name, last_name, phone, telegram_chat_id, telegram_username,
              messenger_id, socials, custom_fields
       FROM contacts
       WHERE tenant_id = $1 AND deleted_at IS NULL
         AND (
           (phone IS NOT NULL AND phone <> '')
           OR telegram_chat_id IS NOT NULL
           OR (telegram_username IS NOT NULL AND telegram_username <> '')
           OR (messenger_id IS NOT NULL AND messenger_id <> '')
           OR (socials IS NOT NULL AND jsonb_array_length(socials) > 0)
           OR (custom_fields ? 'max_chat_id')
           OR (custom_fields ? 'max_user_id')
         )
       ORDER BY updated_at DESC
       LIMIT 300`,
      [tenantId],
    ),
  );

  await updateSyncProgress(tenantId, channelAccountId, {
    status: "syncing",
    total: contacts.length,
    processed: 0,
    messages: 0,
    error: null,
    started: true,
  });

  let processed = 0;
  let totalMessages = 0;

  try {
    if (channel === "max") {
      const provider = account.credentials?.provider || account.credentials?.adapter;
      const isNative = provider === "native-ts" || provider === "ts";
      let dialogsResp: MaxPrivateDialogsResponse;
      if (isNative) {
        const { messagingRegistry } = await import("../messaging/messaging-registry.js");
        dialogsResp = await messagingRegistry
          .getMaxTsAdapter()
          .getPrivateDialogs(tenantId, channelAccountId, 100, 50);
      } else {
        const bridge = new MaxBridgeService();
        dialogsResp = await bridge.getPrivateDialogs({
          botId: channelAccountId,
          dialogLimit: 100,
          messageLimit: 50,
        });
      }

      if (dialogsResp.ok && Array.isArray(dialogsResp.dialogs)) {
        const byChatOrUser = new Map<string, MaxBridgeDialog>();
        const byPhone10 = new Map<string, MaxBridgeDialog>();

        for (const d of dialogsResp.dialogs) {
          if (d.chatId) byChatOrUser.set(String(d.chatId).trim(), d);
          if (d.userId) byChatOrUser.set(String(d.userId).trim(), d);
          const p10 = digitsLast10(normalizeMaxPhone(d.phone, dialogsResp.selfPhone));
          if (p10) byPhone10.set(p10, d);
        }

        for (const contact of contacts) {
          processed++;
          const cf = contact.custom_fields ?? {};
          const maxChatId = typeof cf.max_chat_id === "string" ? cf.max_chat_id.trim() : "";
          const maxUserId = typeof cf.max_user_id === "string" ? cf.max_user_id.trim() : "";
          const maxSocial = contact.socials?.find((s) => s.kind === "max")?.value?.trim() ?? "";
          const p10 = digitsLast10(contact.phone);

          const dialog =
            (maxChatId ? byChatOrUser.get(maxChatId) : undefined) ??
            (maxUserId ? byChatOrUser.get(maxUserId) : undefined) ??
            (contact.messenger_id ? byChatOrUser.get(contact.messenger_id.trim()) : undefined) ??
            (maxSocial ? byChatOrUser.get(maxSocial) : undefined) ??
            (p10 ? byPhone10.get(p10) : undefined);

          if (dialog && Array.isArray(dialog.messages) && dialog.messages.length > 0) {
            try {
              // Независимо от создания сделки безопасно дозаполняем пустые телефон/ФИО из MAX.
              await syncMaxContactIdentityFromDialog({
                tenantId,
                contactId: contact.id,
                existingContact: contact,
                dialog,
                selfPhone: dialogsResp.selfPhone,
              });

              const dealId = await findOrCreateDealForContactSync({
                tenantId,
                contact,
                channel: "max",
                chatThreadId: dialog.chatId,
                lastMessagePreview: dialog.messages[dialog.messages.length - 1]?.text,
              });

              if (dealId) {
                const inserted = await syncMaxDialogHistory({
                  tenantId,
                  dealId,
                  channelAccountId,
                  peerId: dialog.chatId,
                  peerPhone: contact.phone,
                  peerUserId: dialog.userId ?? (maxUserId || null),
                  senderName: contactDisplayName(contact),
                  preloadedDialogs: dialogsResp,
                });
                totalMessages += inserted;
              }
            } catch {
              // Игнорируем ошибку отдельного контакта (например, контакт в статусе поставщика), не прерывая общий синк
            }
          }

          if (processed % 10 === 0) {
            await updateSyncProgress(tenantId, channelAccountId, {
              processed,
              messages: totalMessages,
            });
          }
        }
      }
    } else if (channel === "telegram") {
      const syncer = resolveTelegramHistorySyncer();
      if (syncer) {
        for (const contact of contacts) {
          processed++;
          const tgChatId = contact.telegram_chat_id ? String(contact.telegram_chat_id).trim() : "";
          const tgSocial = contact.socials?.find((s) => s.kind === "telegram")?.value?.replace(/^@/, "").trim() ?? "";
          const tgUsername = contact.telegram_username?.replace(/^@/, "").trim() ?? "";
          const cleanPhone = contact.phone ? contact.phone.replace(/\D/g, "") : "";
          const peer = tgChatId || tgSocial || tgUsername || (cleanPhone.length >= 10 ? cleanPhone : "");

          if (peer) {
            try {
              const inserted = await syncer({
                tenantId,
                resolveDealId: () =>
                  findOrCreateDealForContactSync({
                    tenantId,
                    contact,
                    channel: "telegram",
                    chatThreadId: tgChatId || peer,
                  }),
                channelAccountId,
                peerId: peer,
                username: tgSocial || tgUsername || undefined,
                phone: contact.phone ?? undefined,
                senderName: contactDisplayName(contact),
                limit: 50,
              });
              totalMessages += inserted;
            } catch {
              // Продолжаем по остальным контактам; ошибки отдельных диалогов не роняют весь синк
            }
            // Анти-флуд пауза для Telegram MTProto (защита от FloodWait)
            await sleep(250);
          }

          if (processed % 5 === 0) {
            await updateSyncProgress(tenantId, channelAccountId, {
              processed,
              messages: totalMessages,
            });
          }
        }
      }
    } else if (channel === "whatsapp") {
      const evolution = new WhatsappEvolutionService();
      const instanceName = account.credentials?.instanceName;

      if (evolution.isConfigured && instanceName) {
        for (const contact of contacts) {
          processed++;
          const waSocial = contact.socials?.find((s) => s.kind === "whatsapp")?.value?.trim() ?? "";
          const rawPhone = waSocial || contact.phone || "";
          const cleanPhone = rawPhone.replace(/\D/g, "");

          if (cleanPhone.length >= 10) {
            try {
              let records = await evolution.findMessages(instanceName, {
                remoteJid: `${cleanPhone}@s.whatsapp.net`,
                offset: 50,
              });
              if (!records || records.length === 0) {
                records = await evolution.findMessages(instanceName, {
                  remoteJid: `${cleanPhone}@lid`,
                  offset: 50,
                });
              }

              if (records && records.length > 0) {
                const dealId = await findOrCreateDealForContactSync({
                  tenantId,
                  contact,
                  channel: "whatsapp",
                  chatThreadId: cleanPhone,
                });
                if (dealId) {
                  const inserted = await syncWhatsappDialogHistory({
                    tenantId,
                    dealId,
                    channelAccountId,
                    phone: rawPhone,
                    senderName: contactDisplayName(contact),
                    preloadedRecords: records,
                  });
                  totalMessages += inserted;
                }
              }
            } catch {
              // Продолжаем по остальным контактам
            }
            await sleep(100);
          }

          if (processed % 5 === 0) {
            await updateSyncProgress(tenantId, channelAccountId, {
              processed,
              messages: totalMessages,
            });
          }
        }
      }
    }

    await updateSyncProgress(tenantId, channelAccountId, {
      status: "completed",
      processed: contacts.length,
      messages: totalMessages,
      error: null,
      finished: true,
    });

    return { processedContacts: contacts.length, syncedMessages: totalMessages };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSyncProgress(tenantId, channelAccountId, {
      status: "error",
      processed,
      messages: totalMessages,
      error: message.slice(0, 500),
      finished: true,
    });
    throw err;
  }
}
