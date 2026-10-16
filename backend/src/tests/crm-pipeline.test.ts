import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTestEnv, createTenant, createUser } from "./helpers/test-app.js";
import {
  createTestDatabase,
  dropTestDatabase,
  truncateTestData,
  withTestDb,
} from "./helpers/test-db.js";
import { CrmPipelineService } from "../modules/crm/crm-pipeline.service.js";
import { runWithTenantContext } from "../db/client.js";

// ---------------------------------------------------------------------------
// Автосоздание контакта и сделки из канала (`CrmPipelineService.processIncoming`).
//
// Проверяется связь сделки с контактом, а не CRUD: без `contact_id` в payload
// `findActiveDeal` (поиск открытой сделки идёт по `contact_id`) не находит
// прежнюю сделку, и каждое следующее сообщение того же клиента создаёт новую.
// То есть один дефект в одной строке даёт дубли сделок на проде и пустую
// секцию «Сделки» на карточке контакта.
//
// Транспорт здесь не участвует: `processIncoming` вызывается напрямую в
// контексте арендатора, как это делает `TelegramTransportService`.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await createTestDatabase();
  applyTestEnv();
});

afterAll(async () => {
  const { closePool } = await import("../db/client.js");
  await closePool();
  await dropTestDatabase();
});

beforeEach(async () => {
  await truncateTestData();
});

interface Fixture {
  tenantId: string;
  channelAccountId: string;
}

/** Арендатор с активным владельцем (создатель сделки) и подключённым каналом. */
async function fixture(): Promise<Fixture> {
  const tenant = await createTenant();
  await createUser({ tenantId: tenant.tenantId, role: "owner" });

  const channelAccountId = await withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status)
       VALUES ($1, 'telegram', 'Основной', $2, 'connected')
       RETURNING id`,
      [tenant.tenantId, `@acc_${Math.random().toString(36).slice(2, 7)}`],
    );
    return result.rows[0]?.id ?? "";
  });

  return { tenantId: tenant.tenantId, channelAccountId };
}

const service = new CrmPipelineService();

/** Входящее сообщение от клиента Telegram — так его формирует транспорт. */
async function incoming(
  base: Fixture,
  input: { chatId: string; text: string; senderName?: string },
) {
  return runWithTenantContext(base.tenantId, () =>
    service.processIncoming({
      tenantId: base.tenantId,
      channel: "telegram",
      channelAccountId: base.channelAccountId,
      chatId: input.chatId,
      text: input.text,
      senderName: input.senderName ?? input.chatId,
      senderTelegramChatId: input.chatId,
    }),
  );
}

async function dealRows(
  tenantId: string,
): Promise<{ id: string; contact_id: string | null }[]> {
  return withTestDb(async (client) => {
    const result = await client.query<{ id: string; contact_id: string | null }>(
      `SELECT id, contact_id FROM deals WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );
    return result.rows;
  });
}

describe("Автосоздание из канала: связь сделки с контактом", () => {
  it("два сообщения одного клиента дают одну сделку, а не две", async () => {
    const base = await fixture();

    const first = await incoming(base, { chatId: "123456789", text: "Здравствуйте" });
    const second = await incoming(base, { chatId: "123456789", text: "Вы работаете?" });

    // Контакт находится по telegram_chat_id — это уже работало.
    expect(second.contactId).toBe(first.contactId);
    expect(second.isNewContact).toBe(false);

    // А сделка — по contact_id, и именно этого не происходило: сделка
    // создавалась без связи, поиск открытой сделки её не находил, и канал
    // плодил по сделке на каждое сообщение.
    expect(second.dealId).toBe(first.dealId);
    expect(second.isNewDeal).toBe(false);
    expect(await dealRows(base.tenantId)).toHaveLength(1);
  });

  it("созданная сделка связана с контактом", async () => {
    const base = await fixture();

    const result = await incoming(base, { chatId: "987654321", text: "Нужен ремонт" });

    const rows = await dealRows(base.tenantId);
    expect(rows).toHaveLength(1);
    // Без этой связи секция «Сделки» на карточке контакта фильтрует по
    // contact_id и остаётся пустой, а contactName в таблице сделок — пустым.
    expect(rows[0]?.contact_id).toBe(result.contactId);
  });

  it("оба сообщения попадают в таймлайн одной сделки", async () => {
    const base = await fixture();

    await incoming(base, { chatId: "555000111", text: "Первое" });
    await incoming(base, { chatId: "555000111", text: "Второе" });

    const messages = await withTestDb(async (client) => {
      const result = await client.query<{ content: string; deal_id: string }>(
        `SELECT content, deal_id FROM deal_messages WHERE tenant_id = $1 ORDER BY created_at`,
        [base.tenantId],
      );
      return result.rows;
    });

    expect(messages.map((row) => row.content)).toEqual(["Первое", "Второе"]);
    // Переписка не должна разъезжаться по разным сделкам: иначе менеджер
    // видит половину диалога.
    expect(new Set(messages.map((row) => row.deal_id)).size).toBe(1);
  });

  it("разные клиенты получают разные сделки", async () => {
    const base = await fixture();

    const first = await incoming(base, { chatId: "111111111", text: "Привет" });
    const second = await incoming(base, { chatId: "222222222", text: "Привет" });

    expect(second.contactId).not.toBe(first.contactId);
    expect(second.dealId).not.toBe(first.dealId);
    expect(await dealRows(base.tenantId)).toHaveLength(2);
  });
});
