import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTestEnv, createTenant, createUser } from "./helpers/test-app.js";
import {
  createTestDatabase,
  dropTestDatabase,
  truncateTestData,
  withTestDb,
} from "./helpers/test-db.js";
import {
  CrmPipelineService,
  type ChannelProfile,
} from "../modules/crm/crm-pipeline.service.js";
import { runWithTenantContext } from "../db/client.js";

// ---------------------------------------------------------------------------
// Наполнение контакта при получении из канала.
//
// Что было сломано. Транспорт передавал `senderName: batch.peerId`, то есть
// числовой id Telegram, и `processIncoming` разбирал его как ФИО: в контакт
// попадало имя вида `123456789`, а в заголовок сделки — «Заявка от 123456789
// (Telegram)». Профиль Telegram не запрашивался вовсе (поиск по
// `getEntity|firstName|username|phone` по транспорту давал ноль совпадений),
// поэтому реальные имя, `@username` и номер не заполнялись ничем. В `socials`
// писался `@{chatId}` — нерабочая ссылка: `t.me/123456789` не открывается.
//
// Отдельно: ветка `socials` жёстко проверяла `channel === "telegram"`, поэтому у
// клиента из MAX мессенджер в карточке не появлялся, хотя канал разрешён в
// `channel_accounts`.
//
// Профиль подаётся аргументом, а не запрашивается внутри: живой MTProto в тестах
// означал бы сетевые вызовы, а проверяется здесь раскладка профиля по полям
// контакта, а не работа Telegram.
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

const service = new CrmPipelineService();

interface Fixture {
  tenantId: string;
  channelAccountId: string;
}

async function fixture(channel = "telegram"): Promise<Fixture> {
  const tenant = await createTenant();
  await createUser({ tenantId: tenant.tenantId, role: "owner" });

  const channelAccountId = await withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status)
       VALUES ($1, $2, 'Основной', $3, 'connected')
       RETURNING id`,
      [tenant.tenantId, channel, `@acc_${Math.random().toString(36).slice(2, 7)}`],
    );
    return result.rows[0]?.id ?? "";
  });

  return { tenantId: tenant.tenantId, channelAccountId };
}

async function incoming(
  base: Fixture,
  input: {
    chatId: string;
    channel?: string;
    text?: string;
    senderName?: string;
    profile?: ChannelProfile;
  },
) {
  return runWithTenantContext(base.tenantId, () =>
    service.processIncoming({
      tenantId: base.tenantId,
      channel: input.channel ?? "telegram",
      channelAccountId: base.channelAccountId,
      chatId: input.chatId,
      text: input.text ?? "Здравствуйте",
      senderName: input.senderName ?? input.chatId,
      senderTelegramChatId: (input.channel ?? "telegram") === "telegram" ? input.chatId : undefined,
      profile: input.profile,
    }),
  );
}

interface ContactRow {
  first_name: string;
  last_name: string;
  phone: string;
  telegram_username: string | null;
  whatsapp: string | null;
  socials: { kind: string; value: string }[];
  channel: string;
}

async function contactRow(tenantId: string, contactId: string): Promise<ContactRow | undefined> {
  return withTestDb(async (client) => {
    const result = await client.query<ContactRow>(
      `SELECT first_name, last_name, phone, telegram_username, whatsapp, socials, channel
       FROM contacts WHERE tenant_id = $1 AND id = $2`,
      [tenantId, contactId],
    );
    return result.rows[0];
  });
}

async function dealTitles(tenantId: string): Promise<string[]> {
  return withTestDb(async (client) => {
    const result = await client.query<{ title: string }>(
      `SELECT title FROM deals WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );
    return result.rows.map((row) => row.title);
  });
}

async function dealTitle(tenantId: string): Promise<string | undefined> {
  return (await dealTitles(tenantId))[0];
}

async function dealTitleById(tenantId: string, dealId: string): Promise<string | undefined> {
  return withTestDb(async (client) => {
    const result = await client.query<{ title: string }>(
      `SELECT title FROM deals WHERE tenant_id = $1 AND id = $2`,
      [tenantId, dealId],
    );
    return result.rows[0]?.title;
  });
}

describe("Профиль канала в контакт", () => {
  it("подставляет имя из профиля, а не идентификатор", async () => {
    const base = await fixture();

    const result = await incoming(base, {
      chatId: "123456789",
      profile: { firstName: "Иван", lastName: "Петров", username: "ivanp", phone: "79161234567" },
    });

    const contact = await contactRow(base.tenantId, result.contactId);

    // Раньше здесь оказывалось «123456789»: senderName был peerId, и его
    // разбирали как ФИО.
    expect(contact?.first_name).toBe("Иван");
    expect(contact?.last_name).toBe("Петров");
  });

  it("пишет рабочий username в socials и в колонку", async () => {
    const base = await fixture();

    const result = await incoming(base, {
      chatId: "123456789",
      profile: { firstName: "Иван", username: "ivanp" },
    });

    const contact = await contactRow(base.tenantId, result.contactId);

    // Ссылка `t.me/ivanp` открывается, а прежний `@123456789` — нет.
    expect(contact?.socials).toEqual([{ kind: "telegram", value: "@ivanp" }]);
    expect(contact?.telegram_username).toBe("@ivanp");
  });

  it("сохраняет телефон из профиля, когда он открыт настройками приватности", async () => {
    const base = await fixture();

    const result = await incoming(base, {
      chatId: "123456789",
      profile: { firstName: "Иван", phone: "79161234567" },
    });

    expect((await contactRow(base.tenantId, result.contactId))?.phone).toBe("+79161234567");
  });

  it("заголовок сделки содержит имя, а не идентификатор", async () => {
    const base = await fixture();

    await incoming(base, { chatId: "123456789", profile: { firstName: "Иван", lastName: "Петров" } });

    expect(await dealTitle(base.tenantId)).toBe("Заявка от Иван Петров (Telegram)");
  });
});

describe("Профиль канала недоступен", () => {
  it("ставит «Клиент», а не идентификатор", async () => {
    const base = await fixture();

    const result = await incoming(base, { chatId: "123456789" });
    const contact = await contactRow(base.tenantId, result.contactId);

    // Идентификатор остаётся в telegram_chat_id, где ему и место.
    expect(contact?.first_name).toBe("Клиент");
    expect(contact?.last_name).toBe("");
    expect(await dealTitle(base.tenantId)).toBe("Заявка от Клиент (Telegram)");
  });

  it("не пишет идентификатор в socials", async () => {
    const base = await fixture();

    const result = await incoming(base, { chatId: "123456789" });

    // Прежний `@123456789` давал нерабочую ссылку в карточке: хуже, чем пусто.
    expect(await contactRow(base.tenantId, result.contactId)).toMatchObject({ socials: [] });
  });

  it("телефон не выдумывается из chatId", async () => {
    const base = await fixture();

    const result = await incoming(base, { chatId: "123456789" });

    // chatId Telegram — не номер телефона, и подстановка его в `phone` ломала
    // поиск контакта по номеру.
    expect((await contactRow(base.tenantId, result.contactId))?.phone).toBe("");
  });
});

describe("Известный контакт", () => {
  it("новая сделка берёт имя из карточки, а не из недоступного профиля", async () => {
    const base = await fixture();

    // Первое сообщение: профиль доступен, контакт создаётся с ФИО.
    const first = await incoming(base, {
      chatId: "123456789",
      profile: { firstName: "Иван", lastName: "Петров" },
    });

    // Сделку закрываем — следующее сообщение создаст новую.
    await withTestDb(async (client) => {
      await client.query(
        `UPDATE stages SET is_won = true
         WHERE id = (SELECT stage_id FROM deals WHERE id = $1)`,
        [first.dealId],
      );
    });

    // Второе сообщение: профиль недоступен (клиент закрыл приватность).
    const second = await incoming(base, { chatId: "123456789", text: "Ещё вопрос" });

    expect(second.contactId).toBe(first.contactId);
    expect(second.isNewDeal).toBe(true);
    expect(second.dealId).not.toBe(first.dealId);

    // Проверяется заголовок именно НОВОЙ сделки: у первой он верный в любом
    // случае, и проверка по всему списку прошла бы и на прежнем коде.
    // Без правки здесь появилась бы «Заявка от Клиент» при заполненном ФИО.
    expect(await dealTitleById(base.tenantId, second.dealId)).toBe(
      "Заявка от Иван Петров (Telegram)",
    );
  });

  it("профиль не переписывает уже заполненное имя контакта", async () => {
    const base = await fixture();

    const first = await incoming(base, {
      chatId: "123456789",
      profile: { firstName: "Иван", lastName: "Петров" },
    });

    // Клиент сменил имя в Telegram на что-то служебное.
    await incoming(base, {
      chatId: "123456789",
      text: "Ещё вопрос",
      profile: { firstName: "deleted" },
    });

    const contact = await contactRow(base.tenantId, first.contactId);

    // Профиль запрашивается для заполнения нового контакта, а не для затирания
    // существующего: менеджер мог поправить ФИО руками.
    expect(contact?.first_name).toBe("Иван");
    expect(contact?.last_name).toBe("Петров");
  });
});

describe("Соцсети для остальных каналов", () => {
  it("клиент из MAX получает мессенджер в карточке", async () => {
    const base = await fixture("max");

    const result = await incoming(base, {
      chatId: "@ivanmax",
      channel: "max",
      profile: { firstName: "Иван", username: "ivanmax" },
    });

    const contact = await contactRow(base.tenantId, result.contactId);

    // Условие раньше жёстко проверяло `channel === "telegram"`, поэтому
    // мессенджер клиента из MAX в карточке не появлялся вовсе.
    expect(contact?.socials).toEqual([{ kind: "max", value: "@ivanmax" }]);
  });

  it("клиент из WhatsApp получает номер мессенджера", async () => {
    const base = await fixture("whatsapp");

    const result = await incoming(base, {
      chatId: "79161234567",
      channel: "whatsapp",
      profile: { firstName: "Иван", phone: "79161234567" },
    });

    const contact = await contactRow(base.tenantId, result.contactId);

    expect(contact?.socials).toEqual([{ kind: "whatsapp", value: "+79161234567" }]);
    // Колонка нужна транспорту каналов и поддерживается в согласии со списком.
    expect(contact?.whatsapp).toBe("+79161234567");
  });

  it("канал MAX пишется в contacts.channel как rumax", async () => {
    const base = await fixture("max");

    const result = await incoming(base, {
      chatId: "@ivanmax",
      channel: "max",
      profile: { firstName: "Иван" },
    });

    // Слаги расходятся: в `channel_accounts` канал называется `max`, а
    // `contacts.channel` знает только `rumax`. Приведение типа это скрывало, а
    // `CHECK` на колонке нет — в БД попадало значение, которого нет в схеме
    // фронта, и цвет метки канала не находился.
    expect((await contactRow(base.tenantId, result.contactId))?.channel).toBe("rumax");
  });

  it("неизвестный канал не пишется в contacts.channel", async () => {
    const base = await fixture("avito");

    const result = await incoming(base, {
      chatId: "avito-42",
      channel: "avito",
      profile: { firstName: "Иван" },
    });

    // `avito` в `contactChannelSchema` нет. Вместо записи неизвестного значения
    // остаётся `phone` — канал переписки виден в самих сообщениях.
    expect((await contactRow(base.tenantId, result.contactId))?.channel).toBe("phone");
  });
});
