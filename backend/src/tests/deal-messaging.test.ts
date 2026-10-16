import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildTestApp, createTenant, createUser } from "./helpers/test-app.js";
import {
  createTestDatabase,
  dropTestDatabase,
  truncateTestData,
  withTestDb,
} from "./helpers/test-db.js";
import {
  clearOutboundSenders,
  registerOutboundSender,
  type OutboundMessage,
} from "../modules/channels/outbound-registry.js";

// ---------------------------------------------------------------------------
// Отправка ответа менеджера в канал (`POST /crm/deals/:id/messages`).
//
// До этой правки маршрут только писал строку в `deal_messages`, транспорт не
// вызывался вовсе: менеджер печатал в карточке, сообщение появлялось в
// таймлайне, клиент в Telegram не получал ничего. Чат работал как журнал.
//
// Транспорт подменён отправителем-заглушкой: живой MTProto означал бы сетевые
// соединения и чужие сообщения в тестах, а проверяется здесь не Telegram, а
// поведение вокруг отправки — кому уходит, с какого аккаунта, что попадает в
// статус доставки при отказе.
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  await createTestDatabase();
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  const { closePool } = await import("../db/client.js");
  await closePool();
  await dropTestDatabase();
});

beforeEach(async () => {
  await truncateTestData();
  clearOutboundSenders();
});

afterEach(() => {
  clearOutboundSenders();
});

interface Fixture {
  token: string;
  tenantId: string;
  dealId: string;
  contactId: string;
  channelAccountId: string;
}

/**
 * Арендатор со сделкой, связанной с контактом из Telegram, и входящим
 * сообщением от него: именно так выглядит переписка, на которую отвечает
 * менеджер.
 */
async function fixture(
  overrides: { telegramChatId?: number | null; withInbound?: boolean } = {},
): Promise<Fixture> {
  const tenant = await createTenant();
  const owner = await createUser({ tenantId: tenant.tenantId, role: "owner" });

  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: owner.email, password: owner.password },
  });

  const token = login.json<{ data: { access_token: string } }>().data.access_token;

  const ids = await withTestDb(async (client) => {
    const account = await client.query<{ id: string }>(
      `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status)
       VALUES ($1, 'telegram', 'Основной', $2, 'connected')
       RETURNING id`,
      [tenant.tenantId, `@acc_${Math.random().toString(36).slice(2, 7)}`],
    );

    const contact = await client.query<{ id: string }>(
      `INSERT INTO contacts (tenant_id, first_name, telegram_chat_id, channel)
       VALUES ($1, 'Клиент', $2, 'telegram')
       RETURNING id`,
      [
        tenant.tenantId,
        overrides.telegramChatId === undefined ? 123456789 : overrides.telegramChatId,
      ],
    );

    const pipeline = await client.query<{ id: string }>(
      `INSERT INTO pipelines (tenant_id, name, sort_order) VALUES ($1, 'Основная', 0) RETURNING id`,
      [tenant.tenantId],
    );

    const stage = await client.query<{ id: string }>(
      `INSERT INTO stages (pipeline_id, name, sort_order) VALUES ($1, 'Новый лид', 0) RETURNING id`,
      [pipeline.rows[0]?.id ?? ""],
    );

    const deal = await client.query<{ id: string }>(
      `INSERT INTO deals (tenant_id, pipeline_id, stage_id, contact_id, title, created_by)
       VALUES ($1, $2, $3, $4, 'Заявка из Telegram', $5)
       RETURNING id`,
      [
        tenant.tenantId,
        pipeline.rows[0]?.id ?? "",
        stage.rows[0]?.id ?? "",
        contact.rows[0]?.id ?? "",
        owner.id,
      ],
    );

    if (overrides.withInbound !== false) {
      await client.query(
        `INSERT INTO deal_messages
           (tenant_id, deal_id, channel_account_id, source, direction, sender_name, content, channel)
         VALUES ($1, $2, $3, 'client', 'inbound', 'Клиент', 'Здравствуйте', 'telegram')`,
        [tenant.tenantId, deal.rows[0]?.id ?? "", account.rows[0]?.id ?? ""],
      );
    }

    return {
      dealId: deal.rows[0]?.id ?? "",
      contactId: contact.rows[0]?.id ?? "",
      channelAccountId: account.rows[0]?.id ?? "",
    };
  });

  return { token, tenantId: tenant.tenantId, ...ids };
}

interface MessageBody {
  id: string;
  content: string;
  deliveryStatus: string;
  deliveryError: string | null;
}

async function postMessage(
  base: Fixture,
  payload: Record<string, unknown> = { content: "Добрый день!", channel: "telegram" },
) {
  return app.inject({
    method: "POST",
    url: `/api/v1/crm/deals/${base.dealId}/messages`,
    headers: { authorization: `Bearer ${base.token}` },
    payload,
  });
}

/** Отправитель-заглушка: запоминает вызовы и отвечает заданным результатом. */
function stubSender(result: { ok: true } | { ok: false; reason: string } | Error) {
  const calls: OutboundMessage[] = [];

  registerOutboundSender("telegram", async (message) => {
    calls.push(message);
    if (result instanceof Error) throw result;
    return result;
  });

  return calls;
}

describe("Ответ менеджера уходит в канал", () => {
  it("вызывает транспорт с получателем и аккаунтом переписки", async () => {
    const base = await fixture();
    const calls = stubSender({ ok: true });

    const res = await postMessage(base);

    expect(res.statusCode).toBe(201);
    // Именно этого не было: маршрут писал строку и на транспорт не обращался.
    expect(calls).toHaveLength(1);
    // Получатель — числовой telegram_chat_id контакта: по нему транспорт нашёл
    // контакт на входящем сообщении, обратный путь тот же.
    expect(calls[0]?.recipient).toBe("123456789");
    // Аккаунт — тот, на который клиент писал, а не первый подключённый: у
    // арендатора их может быть несколько.
    expect(calls[0]?.channelAccountId).toBe(base.channelAccountId);
    expect(calls[0]?.text).toBe("Добрый день!");
  });

  it("помечает доставленное сообщение как sent", async () => {
    const base = await fixture();
    stubSender({ ok: true });

    const res = await postMessage(base);
    const message = res.json<{ data: MessageBody }>().data;

    expect(message.deliveryStatus).toBe("sent");
    expect(message.deliveryError).toBeNull();
  });

  it("сохраняет сообщение и помечает failed, когда транспорт отказал", async () => {
    const base = await fixture();
    stubSender({ ok: false, reason: "Telegram отклонил отправку: USER_IS_BLOCKED" });

    const res = await postMessage(base);

    // Ответ остаётся 201: текст сохранён, и ошибка 5xx оставила бы фронт в
    // неизвестности — сохранено или нет.
    expect(res.statusCode).toBe(201);

    const message = res.json<{ data: MessageBody }>().data;
    expect(message.deliveryStatus).toBe("failed");
    expect(message.deliveryError).toContain("USER_IS_BLOCKED");

    // Строка в таймлайне есть: менеджер не должен потерять набранный текст
    // из-за отказа сети.
    const stored = await withTestDb(async (client) => {
      const result = await client.query<{ content: string; delivery_status: string }>(
        `SELECT content, delivery_status FROM deal_messages
         WHERE tenant_id = $1 AND direction = 'outbound'`,
        [base.tenantId],
      );
      return result.rows;
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]?.delivery_status).toBe("failed");
  });

  it("не роняет запрос, когда транспорт бросает исключение", async () => {
    const base = await fixture();
    stubSender(new Error("socket hang up"));

    const res = await postMessage(base);

    expect(res.statusCode).toBe(201);
    expect(res.json<{ data: MessageBody }>().data.deliveryStatus).toBe("failed");
  });

  it("помечает failed, когда канал не отправляет в этом процессе", async () => {
    const base = await fixture();
    // Отправитель не зарегистрирован: транспорт выключен или процесс без
    // слушателя. Для менеджера это тот же результат — сообщение не ушло.

    const res = await postMessage(base);
    const message = res.json<{ data: MessageBody }>().data;

    expect(message.deliveryStatus).toBe("failed");
    expect(message.deliveryError).toContain("не отправляет");
  });

  it("помечает failed, когда у контакта нет адреса в канале", async () => {
    const base = await fixture({ telegramChatId: null });
    const calls = stubSender({ ok: true });

    const message = (await postMessage(base)).json<{ data: MessageBody }>().data;

    expect(calls).toHaveLength(0);
    expect(message.deliveryStatus).toBe("failed");
    expect(message.deliveryError).toContain("адресом в этом канале");
  });

  it("внутреннюю заметку в канал не отправляет", async () => {
    const base = await fixture();
    const calls = stubSender({ ok: true });

    const message = (
      await postMessage(base, {
        content: "Позвонить после обеда",
        channel: "telegram",
        source: "system",
        direction: "neutral",
      })
    ).json<{ data: MessageBody }>().data;

    // Доставлять некуда, и статус обязан отличаться от «не удалось»: иначе
    // заметка выглядела бы как неотправленное сообщение клиенту.
    expect(calls).toHaveLength(0);
    expect(message.deliveryStatus).toBe("neutral");
  });

  it("статус доставки виден в таймлайне при повторном чтении", async () => {
    const base = await fixture();
    stubSender({ ok: false, reason: "Аккаунт Telegram не подключён к транспорту" });

    await postMessage(base);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/crm/deals/${base.dealId}/messages`,
      headers: { authorization: `Bearer ${base.token}` },
    });

    const messages = res.json<{ data: MessageBody[] }>().data;
    const outbound = messages.find((m) => m.content === "Добрый день!");

    // Статус на строке, а не тостом: иначе после перезагрузки страницы
    // неотправленное сообщение выглядит как отправленное.
    expect(outbound?.deliveryStatus).toBe("failed");
    expect(outbound?.deliveryError).toContain("не подключён");
  });
});
