import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTestEnv, createTenant, createUser } from "./helpers/test-app.js";
import {
  createTestDatabase,
  dropTestDatabase,
  truncateTestData,
  withTestDb,
} from "./helpers/test-db.js";
import { AgentPipelineService } from "../modules/ai/agent-pipeline.service.js";
import { KnowledgeBaseService } from "../modules/ai/knowledge.service.js";
import type { ChatCompletionResult, ChatProvider } from "../services/chat.service.js";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingProvider,
  type EmbeddingResult,
} from "../services/embeddings.service.js";

// ---------------------------------------------------------------------------
// Интеграционные тесты пайплайна ответа агента.
//
// Провайдеры подменены: живой вызов модели означал бы платный трафик и разный
// результат в каждом прогоне, а проверяется здесь не качество ответа, а
// поведение вокруг него — выбор агента, режим, баланс, списание, журнал и
// изоляция арендаторов.
// ---------------------------------------------------------------------------

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Заглушка чата: возвращает заданный ответ и заданный расход токенов. */
class StubChatProvider implements ChatProvider {
  public calls: { model: string; systemPrompt: string; userText: string }[] = [];

  constructor(
    private readonly response: string | Error,
    private readonly usage: { tokensIn: number; tokensOut: number } = {
      tokensIn: 1000,
      tokensOut: 500,
    },
    public configured = true,
  ) {}

  get isConfigured(): boolean {
    return this.configured;
  }

  async complete(input: {
    model: string;
    messages: readonly { role: string; content: string }[];
  }): Promise<ChatCompletionResult> {
    this.calls.push({
      model: input.model,
      systemPrompt: input.messages.find((m) => m.role === "system")?.content ?? "",
      userText: input.messages.find((m) => m.role === "user")?.content ?? "",
    });

    if (this.response instanceof Error) throw this.response;

    return {
      content: this.response,
      tokensIn: this.usage.tokensIn,
      tokensOut: this.usage.tokensOut,
      model: input.model,
      latencyMs: 42,
    };
  }
}

/** Заглушка эмбеддингов: ось по первому слову, как в тестах базы знаний. */
class StubEmbeddingProvider implements EmbeddingProvider {
  public readonly model = "stub-embeddings";

  constructor(public configured = true) {}

  get isConfigured(): boolean {
    return this.configured;
  }

  async embed(inputs: readonly string[]): Promise<EmbeddingResult> {
    const vectors = inputs.map((text) => {
      const word = text.trim().toLowerCase().split(/\s+/)[0] ?? "";
      let hash = 7;
      for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 1500;
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      vector[hash % EMBEDDING_DIMENSIONS] = 1;
      return vector;
    });

    return { vectors, tokensUsed: inputs.length * 10, model: this.model };
  }
}

const GOOD_REPLY = JSON.stringify({
  message1: "Здравствуйте!",
  message2: "Гарантия на ремонт — 90 дней.",
  message3: "",
});

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
  agentId: string;
  accountId: string;
}

/** Арендатор с балансом, активным агентом в режиме автоответа и привязанным каналом. */
async function fixture(
  overrides: {
    balanceKopecks?: number;
    markupPercent?: number;
    status?: string;
    mode?: string;
    model?: string;
    bind?: boolean;
    enabled?: boolean;
  } = {},
): Promise<Fixture> {
  const tenant = await createTenant();
  await createUser({ tenantId: tenant.tenantId, role: "owner" });

  await withTestDb(async (client) => {
    await client.query(
      `UPDATE tenants SET ai_balance_kopecks = $2, ai_markup_percent = $3 WHERE id = $1`,
      [tenant.tenantId, overrides.balanceKopecks ?? 500_000, overrides.markupPercent ?? 30],
    );
  });

  const agentId = await withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO ai_agents (tenant_id, name, model, system_prompt, status, mode)
       VALUES ($1, $2, $3, 'Ты помощник сервисного центра.', $4, $5)
       RETURNING id`,
      [
        tenant.tenantId,
        `Агент ${Math.random().toString(36).slice(2, 8)}`,
        overrides.model ?? "gpt-4o-mini",
        overrides.status ?? "active",
        overrides.mode ?? "autoreply",
      ],
    );
    return result.rows[0]?.id ?? "";
  });

  const accountId = await withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status)
       VALUES ($1, 'telegram', 'Основной', $2, 'connected')
       RETURNING id`,
      [tenant.tenantId, `@acc_${Math.random().toString(36).slice(2, 7)}`],
    );
    return result.rows[0]?.id ?? "";
  });

  if (overrides.bind !== false) {
    await withTestDb(async (client) => {
      await client.query(
        `INSERT INTO ai_agent_channel_bindings (tenant_id, agent_id, channel_account_id, is_enabled)
         VALUES ($1, $2, $3, $4)`,
        [tenant.tenantId, agentId, accountId, overrides.enabled ?? true],
      );
    });
  }

  return { tenantId: tenant.tenantId, agentId, accountId };
}

function makePipeline(chat: ChatProvider, embeddings = new StubEmbeddingProvider()): AgentPipelineService {
  return new AgentPipelineService(silentLog, new KnowledgeBaseService(embeddings), chat);
}

async function run(
  pipeline: AgentPipelineService,
  fx: Fixture,
  text = "Сколько длится гарантия?",
) {
  const { runWithTenantContext } = await import("../db/client.js");

  return runWithTenantContext(fx.tenantId, () =>
    pipeline.prepareReply({
      tenantId: fx.tenantId,
      channelAccountId: fx.accountId,
      chatId: "555000",
      text,
    }),
  );
}

describe("Выбор агента", () => {
  it("отвечает привязанным активным агентом в режиме autoreply", async () => {
    const fx = await fixture();
    const chat = new StubChatProvider(GOOD_REPLY);

    const outcome = await run(makePipeline(chat), fx);

    expect(outcome.kind).toBe("replied");
    if (outcome.kind !== "replied") return;
    expect(outcome.reply.messages).toEqual(["Здравствуйте!", "Гарантия на ремонт — 90 дней."]);
  });

  it("молчит, если к аккаунту не привязан агент", async () => {
    const fx = await fixture({ bind: false });
    const chat = new StubChatProvider(GOOD_REPLY);

    const outcome = await run(makePipeline(chat), fx);

    expect(outcome.kind).toBe("no_agent");
    // Модель не должна вызываться вовсе: иначе платформа платила бы за вызовы,
    // результат которых некому отправить.
    expect(chat.calls).toHaveLength(0);
  });

  it("молчит при отключённой привязке", async () => {
    const fx = await fixture({ enabled: false });
    const outcome = await run(makePipeline(new StubChatProvider(GOOD_REPLY)), fx);

    expect(outcome.kind).toBe("no_agent");
  });

  it("молчит, если агент на паузе", async () => {
    const fx = await fixture({ status: "paused" });
    const chat = new StubChatProvider(GOOD_REPLY);

    const outcome = await run(makePipeline(chat), fx);

    expect(outcome.kind).toBe("agent_paused");
    expect(chat.calls).toHaveLength(0);
  });

  it("молчит в режиме suggester: черновики предназначены оператору", async () => {
    const fx = await fixture({ mode: "suggester" });
    const outcome = await run(makePipeline(new StubChatProvider(GOOD_REPLY)), fx);

    // Отправка черновика клиенту напрямую игнорировала бы выбор настройки.
    expect(outcome.kind).toBe("agent_paused");
  });

  it("не отвечает агентом чужого арендатора при совпадении аккаунта", async () => {
    const mine = await fixture({ bind: false });
    const other = await fixture();

    // Пытаемся ответить по аккаунту своего арендатора — привязки нет.
    const outcome = await run(makePipeline(new StubChatProvider(GOOD_REPLY)), mine);
    expect(outcome.kind).toBe("no_agent");

    // А у чужого арендатора привязка есть, и его агент работает.
    const foreign = await run(makePipeline(new StubChatProvider(GOOD_REPLY)), other);
    expect(foreign.kind).toBe("replied");
  });
});

describe("Баланс и списание", () => {
  it("списывает стоимость с наценкой и пишет журнал", async () => {
    // gpt-4o-mini: 3 коп/1k входных, 11 коп/1k выходных.
    // 1000 вх + 500 вых = 3 + 5.5 = 8.5 коп, +30% = 11.05 → ceil = 12 коп.
    const fx = await fixture({ balanceKopecks: 100_000, markupPercent: 30 });
    const chat = new StubChatProvider(GOOD_REPLY, { tokensIn: 1000, tokensOut: 500 });

    const outcome = await run(makePipeline(chat), fx);

    expect(outcome.kind).toBe("replied");
    if (outcome.kind !== "replied") return;
    expect(outcome.chargedKopecks).toBe(12);

    const state = await withTestDb(async (client) => {
      const balance = await client.query<{ balance: string }>(
        `SELECT ai_balance_kopecks::text AS balance FROM tenants WHERE id = $1`,
        [fx.tenantId],
      );
      const log = await client.query<{
        tokens_in: number;
        tokens_out: number;
        charged: string;
        provider: string;
        status: string;
        user_id: string | null;
      }>(
        `SELECT tokens_in, tokens_out, charged_kopecks::text AS charged,
                provider_cost_kopecks::text AS provider, status, user_id
         FROM ai_usage_log WHERE tenant_id = $1`,
        [fx.tenantId],
      );
      return { balance: balance.rows[0]?.balance, log: log.rows[0] };
    });

    expect(state.balance).toBe(String(100_000 - 12));
    expect(state.log?.tokens_in).toBe(1000);
    expect(state.log?.tokens_out).toBe(500);
    expect(state.log?.charged).toBe("12");
    // Себестоимость без наценки: 8.5 → ceil = 9.
    expect(state.log?.provider).toBe("9");
    expect(state.log?.status).toBe("success");
    // Вызов инициирован клиентом из мессенджера, а не сотрудником.
    expect(state.log?.user_id).toBeNull();
  });

  it("не вызывает модель при недостаточном балансе", async () => {
    const fx = await fixture({ balanceKopecks: 50 });
    const chat = new StubChatProvider(GOOD_REPLY);

    const outcome = await run(makePipeline(chat), fx);

    expect(outcome.kind).toBe("insufficient_balance");
    // Стоимость известна только после ответа, поэтому без предварительной
    // проверки арендатор уходил бы в минус на каждом сообщении.
    expect(chat.calls).toHaveLength(0);

    const logs = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ai_usage_log WHERE tenant_id = $1`,
        [fx.tenantId],
      );
      return result.rows[0]?.count ?? "0";
    });

    expect(logs).toBe("0");
  });

  it("не уводит баланс в минус, если вызов дороже остатка", async () => {
    const fx = await fixture({ balanceKopecks: 150, markupPercent: 0 });
    // Крупный расход: 200k входных токенов по 3 коп/1k = 600 коп.
    const chat = new StubChatProvider(GOOD_REPLY, { tokensIn: 200_000, tokensOut: 0 });

    const outcome = await run(makePipeline(chat), fx);
    expect(outcome.kind).toBe("replied");

    const balance = await withTestDb(async (client) => {
      const result = await client.query<{ balance: string }>(
        `SELECT ai_balance_kopecks::text AS balance FROM tenants WHERE id = $1`,
        [fx.tenantId],
      );
      return result.rows[0]?.balance;
    });

    // Отрицательный остаток интерфейс показал бы как долг: разница — потеря
    // платформы, и она предпочтительнее.
    expect(balance).toBe("0");
  });

  it("списывает расход даже когда ответ вне формата JSON", async () => {
    const fx = await fixture({ balanceKopecks: 100_000 });
    const chat = new StubChatProvider("Извините, я не понял вопрос");

    const outcome = await run(makePipeline(chat), fx);

    expect(outcome.kind).toBe("unparsable");

    const log = await withTestDb(async (client) => {
      const result = await client.query<{ charged: string; status: string; error: string }>(
        `SELECT charged_kopecks::text AS charged, status, error_message AS error
         FROM ai_usage_log WHERE tenant_id = $1`,
        [fx.tenantId],
      );
      return result.rows[0];
    });

    // Токены провайдер уже потратил: не записать их означало бы, что платформа
    // платит за них сама.
    expect(Number(log?.charged)).toBeGreaterThan(0);
    expect(log?.status).toBe("error");
    expect(log?.error).toContain("JSON");
  });

  it("при отказе модели пишет журнал без списания", async () => {
    const fx = await fixture({ balanceKopecks: 100_000 });
    const chat = new StubChatProvider(new Error("gateway timeout"));

    const outcome = await run(makePipeline(chat), fx);

    expect(outcome.kind).toBe("llm_failed");

    const state = await withTestDb(async (client) => {
      const log = await client.query<{ charged: string; status: string; error: string }>(
        `SELECT charged_kopecks::text AS charged, status, error_message AS error
         FROM ai_usage_log WHERE tenant_id = $1`,
        [fx.tenantId],
      );
      const balance = await client.query<{ balance: string }>(
        `SELECT ai_balance_kopecks::text AS balance FROM tenants WHERE id = $1`,
        [fx.tenantId],
      );
      return { log: log.rows[0], balance: balance.rows[0]?.balance };
    });

    // Токенов не было — списывать нечего, но факт отказа должен быть виден.
    expect(state.log?.charged).toBe("0");
    expect(state.log?.status).toBe("error");
    expect(state.log?.error).toContain("gateway timeout");
    expect(state.balance).toBe("100000");
  });

  it("не отвечает при ненастроенном провайдере и не пишет журнал", async () => {
    const fx = await fixture();
    const chat = new StubChatProvider(GOOD_REPLY, { tokensIn: 0, tokensOut: 0 }, false);

    const outcome = await run(makePipeline(chat), fx);

    expect(outcome.kind).toBe("llm_unavailable");

    const logs = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ai_usage_log`,
      );
      return result.rows[0]?.count ?? "0";
    });

    expect(logs).toBe("0");
  });
});

describe("Контекст базы знаний", () => {
  it("подставляет найденные фрагменты в системный промпт", async () => {
    const fx = await fixture();
    const embeddings = new StubEmbeddingProvider();
    const knowledge = new KnowledgeBaseService(embeddings);
    const { runWithTenantContext } = await import("../db/client.js");

    await runWithTenantContext(fx.tenantId, () =>
      knowledge.addDocument({
        tenantId: fx.tenantId,
        agentId: fx.agentId,
        filename: "Регламент.txt",
        mimeType: "text/plain",
        text: "гарантия на выполненный ремонт составляет девяносто дней с даты выдачи устройства",
      }),
    );

    const chat = new StubChatProvider(GOOD_REPLY);
    const pipeline = new AgentPipelineService(silentLog, knowledge, chat);

    const outcome = await runWithTenantContext(fx.tenantId, () =>
      pipeline.prepareReply({
        tenantId: fx.tenantId,
        channelAccountId: fx.accountId,
        chatId: "555000",
        text: "гарантия сколько дней",
      }),
    );

    expect(outcome.kind).toBe("replied");

    const call = chat.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) return;

    expect(call.systemPrompt).toContain("Ты помощник сервисного центра.");
    expect(call.systemPrompt).toContain("девяносто дней");
    expect(call.systemPrompt).toContain("Регламент.txt");
    expect(call.systemPrompt).toContain("message1");
  });

  it("при пустой базе знаний запрещает называть цены и сроки", async () => {
    const fx = await fixture();
    const chat = new StubChatProvider(GOOD_REPLY);

    await run(makePipeline(chat), fx);

    const call = chat.calls[0];
    expect(call?.systemPrompt).toContain("нет материалов");
  });

  it("отвечает без контекста, если эмбеддинги недоступны", async () => {
    const fx = await fixture();
    const chat = new StubChatProvider(GOOD_REPLY);
    const pipeline = makePipeline(chat, new StubEmbeddingProvider(false));

    const outcome = await run(pipeline, fx);

    // Отсутствие базы знаний не должно ломать сам ответ.
    expect(outcome.kind).toBe("replied");
    expect(chat.calls).toHaveLength(1);
  });

  it("не подставляет документы чужого арендатора", async () => {
    const mine = await fixture();
    const other = await fixture();

    const embeddings = new StubEmbeddingProvider();
    const knowledge = new KnowledgeBaseService(embeddings);
    const { runWithTenantContext } = await import("../db/client.js");

    await runWithTenantContext(other.tenantId, () =>
      knowledge.addDocument({
        tenantId: other.tenantId,
        agentId: other.agentId,
        filename: "Секрет.txt",
        mimeType: "text/plain",
        text: "гарантия только для постоянных клиентов нашей компании особые условия",
      }),
    );

    const chat = new StubChatProvider(GOOD_REPLY);
    const pipeline = new AgentPipelineService(silentLog, knowledge, chat);

    await runWithTenantContext(mine.tenantId, () =>
      pipeline.prepareReply({
        tenantId: mine.tenantId,
        channelAccountId: mine.accountId,
        chatId: "555000",
        text: "гарантия условия",
      }),
    );

    const call = chat.calls[0];
    expect(call?.systemPrompt).not.toContain("Секрет.txt");
    expect(call?.systemPrompt).not.toContain("постоянных клиентов");
  });
});

describe("Модель агента", () => {
  it("переводит модель каталога в идентификатор шлюза", async () => {
    const fx = await fixture({ model: "claude-sonnet-4" });
    const chat = new StubChatProvider(GOOD_REPLY);

    await run(makePipeline(chat), fx);

    // Каталог хранит продуктовые имена (по ним считается цена), шлюз требует
    // полный идентификатор с провайдером.
    expect(chat.calls[0]?.model).toBe("openrouter/anthropic/claude-sonnet-4");
  });

  it("подставляет модель по умолчанию, если у агента незнакомая", async () => {
    const fx = await fixture({ model: "some-removed-model" });
    const chat = new StubChatProvider(GOOD_REPLY);

    const outcome = await run(makePipeline(chat), fx);

    // Иначе тарификация упала бы на неизвестном ключе каталога, и агент замолчал
    // бы после переименования модели в прайсе.
    expect(outcome.kind).toBe("replied");
    expect(chat.calls[0]?.model).toBe("openrouter/openai/gpt-4o-mini");

    const logged = await withTestDb(async (client) => {
      const result = await client.query<{ model: string }>(
        `SELECT model FROM ai_usage_log WHERE tenant_id = $1`,
        [fx.tenantId],
      );
      return result.rows[0]?.model;
    });

    expect(logged).toBe("gpt-4o-mini");
  });
});

describe("Текст пачки", () => {
  it("уходит в модель как одно сообщение пользователя", async () => {
    const fx = await fixture();
    const chat = new StubChatProvider(GOOD_REPLY);

    await run(makePipeline(chat), fx, "привет\nне работает телефон\nпосле падения");

    expect(chat.calls[0]?.userText).toBe("привет\nне работает телефон\nпосле падения");
  });
});
