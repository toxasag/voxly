import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildTestApp, createTenant, createUser } from "./helpers/test-app.js";
import {
  createTestDatabase,
  dropTestDatabase,
  truncateTestData,
  withTestDb,
} from "./helpers/test-db.js";
import { KnowledgeBaseService } from "../modules/ai/knowledge.service.js";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingProvider,
  type EmbeddingResult,
} from "../services/embeddings.service.js";

// ---------------------------------------------------------------------------
// Интеграционные тесты базы знаний агентов (RAG).
//
// Провайдер эмбеддингов подменён детерминированной заглушкой: живой вызов шлюза
// в тестах означал бы зависимость от внешней сети, платный трафик и разные
// результаты между прогонами. Сам провайдер проверен отдельно живым вызовом
// (ответ ровно 1536 значений), а здесь проверяется то, что от него не зависит:
// изоляция арендаторов, каскады, ранжирование по расстоянию и права.
//
// Векторы строятся так, чтобы расстояния были предсказуемы: каждый вектор —
// единичный по одной оси, поэтому косинусное расстояние между разными осями
// ровно 1, а между одинаковыми — 0.
// ---------------------------------------------------------------------------

/** Единичный вектор по оси `axis`. */
function unitVector(axis: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[axis % EMBEDDING_DIMENSIONS] = 1;
  return vector;
}

/**
 * Заглушка провайдера: ось выбирается по первому слову текста.
 *
 * Так фрагмент про «гарантию» и вопрос про «гарантию» получают один и тот же
 * вектор (расстояние 0), а несвязанные — разные оси (расстояние 1, то есть выше
 * порога отсечения).
 */
class StubEmbeddingProvider implements EmbeddingProvider {
  public calls = 0;
  public readonly model = "stub-embeddings";

  constructor(public configured = true) {}

  get isConfigured(): boolean {
    return this.configured;
  }

  async embed(inputs: readonly string[]): Promise<EmbeddingResult> {
    this.calls += 1;

    const vectors = inputs.map((text) => {
      const word = text.trim().toLowerCase().split(/\s+/)[0] ?? "";
      // Устойчивое отображение слова в ось.
      let hash = 7;
      for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 1500;
      return unitVector(hash);
    });

    return { vectors, tokensUsed: inputs.length * 10, model: this.model };
  }
}

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
});

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, string[]> };
}

interface Signed {
  token: string;
  tenantId: string;
  agentId: string;
}

/** Арендатор с установленным модулем, владельцем и агентом. */
async function signedInWithAgent(): Promise<Signed> {
  const tenant = await createTenant();
  const owner = await createUser({ tenantId: tenant.tenantId, role: "owner" });

  await withTestDb(async (client) => {
    await client.query(
      `INSERT INTO installed_modules (tenant_id, slug, name)
       VALUES ($1, 'ai_bots', 'AI-агенты')`,
      [tenant.tenantId],
    );
  });

  const agentId = await withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO ai_agents (tenant_id, name, model, system_prompt)
       VALUES ($1, $2, 'gpt-4o-mini', 'Ты помощник.')
       RETURNING id`,
      [tenant.tenantId, `Агент ${Math.random().toString(36).slice(2, 8)}`],
    );
    return result.rows[0]?.id ?? "";
  });

  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: owner.email, password: owner.password },
  });

  return {
    token: login.json<{ data: { access_token: string } }>().data.access_token,
    tenantId: tenant.tenantId,
    agentId,
  };
}

async function createChannelAccount(tenantId: string, label = "Основной"): Promise<string> {
  return withTestDb(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status)
       VALUES ($1, 'telegram', $2, $3, 'connected')
       RETURNING id`,
      [tenantId, label, `@${label.toLowerCase()}_${Math.random().toString(36).slice(2, 7)}`],
    );
    return result.rows[0]?.id ?? "";
  });
}

describe("Схема базы знаний", () => {
  it("расширение vector установлено и HNSW-индекс создан", async () => {
    const state = await withTestDb(async (client) => {
      const extension = await client.query<{ extversion: string }>(
        `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
      );
      const index = await client.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_kb_chunks_embedding'`,
      );
      return { extension: extension.rows[0]?.extversion, index: index.rows[0]?.indexdef };
    });

    expect(state.extension).toBeDefined();
    // HNSW, а не IVFFlat: последний требует обучения на данных и на пустой
    // таблице даёт негодный индекс.
    expect(state.index).toContain("hnsw");
    expect(state.index).toContain("vector_cosine_ops");
  });

  it("отклоняет вектор неверной размерности", async () => {
    const session = await signedInWithAgent();

    await expect(
      withTestDb(async (client) => {
        const document = await client.query<{ id: string }>(
          `INSERT INTO knowledge_base_documents (tenant_id, filename, mime_type, file_size)
           VALUES ($1, 'x.txt', 'text/plain', 10) RETURNING id`,
          [session.tenantId],
        );

        await client.query(
          `INSERT INTO knowledge_base_chunks
             (tenant_id, document_id, chunk_index, content, embedding)
           VALUES ($1, $2, 0, 'текст', '[1,2,3]'::vector)`,
          [session.tenantId, document.rows[0]?.id],
        );
      }),
    ).rejects.toThrow(/expected 1536 dimensions|different vector dimensions/i);
  });
});

describe("KnowledgeBaseService", () => {
  it("сохраняет документ, режет на фрагменты и векторизует каждый", async () => {
    const session = await signedInWithAgent();
    const stub = new StubEmbeddingProvider();
    const service = new KnowledgeBaseService(stub);

    const { runWithTenantContext } = await import("../db/client.js");

    const text = Array.from(
      { length: 60 },
      (_, i) => `Пункт ${i + 1}. Гарантийный срок на ремонт составляет ${90 + i} дней.`,
    ).join(" ");

    const document = await runWithTenantContext(session.tenantId, () =>
      service.addDocument({
        tenantId: session.tenantId,
        agentId: session.agentId,
        filename: "Регламент.txt",
        mimeType: "text/plain",
        text,
      }),
    );

    expect(document.status).toBe("ready");
    expect(document.chunksCount).toBeGreaterThan(1);

    const stored = await withTestDb(async (client) => {
      const result = await client.query<{ count: string; dims: number }>(
        `SELECT count(*)::text AS count, MIN(vector_dims(embedding)) AS dims
         FROM knowledge_base_chunks WHERE document_id = $1`,
        [document.id],
      );
      return result.rows[0];
    });

    expect(Number(stored?.count)).toBe(document.chunksCount);
    expect(stored?.dims).toBe(EMBEDDING_DIMENSIONS);
  });

  it("отклоняет документ без текста, не создавая строки", async () => {
    const session = await signedInWithAgent();
    const service = new KnowledgeBaseService(new StubEmbeddingProvider());
    const { runWithTenantContext } = await import("../db/client.js");

    await expect(
      runWithTenantContext(session.tenantId, () =>
        service.addDocument({
          tenantId: session.tenantId,
          agentId: session.agentId,
          filename: "empty.txt",
          mimeType: "text/plain",
          text: "   \n\n  ",
        }),
      ),
    ).rejects.toThrow(/не содержит текста/);

    const count = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM knowledge_base_documents`,
      );
      return result.rows[0]?.count ?? "0";
    });

    // Пустой документ не должен оставлять следа: иначе список показывал бы
    // запись без фрагментов, выглядящую как успешная загрузка.
    expect(count).toBe("0");
  });

  it("без настроенного провайдера отказывает до создания документа", async () => {
    const session = await signedInWithAgent();
    const service = new KnowledgeBaseService(new StubEmbeddingProvider(false));
    const { runWithTenantContext } = await import("../db/client.js");

    await expect(
      runWithTenantContext(session.tenantId, () =>
        service.addDocument({
          tenantId: session.tenantId,
          agentId: session.agentId,
          filename: "x.txt",
          mimeType: "text/plain",
          text: "Достаточно текста для одного фрагмента.",
        }),
      ),
    ).rejects.toMatchObject({ code: "EMBEDDINGS_UNAVAILABLE" });

    const count = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM knowledge_base_documents`,
      );
      return result.rows[0]?.count ?? "0";
    });

    expect(count).toBe("0");
  });

  it("поиск возвращает ближайший фрагмент и отсекает нерелевантный", async () => {
    const session = await signedInWithAgent();
    const stub = new StubEmbeddingProvider();
    const service = new KnowledgeBaseService(stub);
    const { runWithTenantContext } = await import("../db/client.js");

    // Три отдельных документа: заглушка отображает первое слово в ось, поэтому
    // расстояние до совпадающего слова 0, до остальных 1.
    for (const text of [
      "гарантия на ремонт составляет 90 дней с даты выдачи устройства клиенту компании",
      "доставка выполняется курьером в течение двух рабочих дней по городу за счёт клиента",
      "оплата принимается наличными и картой, безналичный расчёт по счёту для организаций",
    ]) {
      await runWithTenantContext(session.tenantId, () =>
        service.addDocument({
          tenantId: session.tenantId,
          agentId: session.agentId,
          filename: `${text.split(" ")[0] ?? "doc"}.txt`,
          mimeType: "text/plain",
          text,
        }),
      );
    }

    const hits = await runWithTenantContext(session.tenantId, () =>
      service.search({
        tenantId: session.tenantId,
        agentId: session.agentId,
        question: "гарантия сколько дней",
      }),
    );

    expect(hits.length).toBe(1);
    expect(hits[0]?.content).toContain("гарантия");
    expect(hits[0]?.distance).toBeCloseTo(0, 5);

    // Вопрос не по теме: все расстояния равны 1, порог 0.75 их отсекает, и агент
    // отвечает без контекста вместо выдумки на случайном фрагменте.
    const noHits = await runWithTenantContext(session.tenantId, () =>
      service.search({
        tenantId: session.tenantId,
        agentId: session.agentId,
        question: "борщ рецепт приготовления",
      }),
    );

    expect(noHits).toHaveLength(0);
  });

  it("поиск без настроенного провайдера возвращает пустой результат, а не ошибку", async () => {
    const session = await signedInWithAgent();
    const service = new KnowledgeBaseService(new StubEmbeddingProvider(false));
    const { runWithTenantContext } = await import("../db/client.js");

    // Отсутствие базы знаний не должно ломать вызов модели: агент просто отвечает
    // без контекста.
    const hits = await runWithTenantContext(session.tenantId, () =>
      service.search({
        tenantId: session.tenantId,
        agentId: session.agentId,
        question: "гарантия",
      }),
    );

    expect(hits).toEqual([]);
  });

  it("векторизует пачками, а не по одному вызову на фрагмент", async () => {
    const session = await signedInWithAgent();
    const stub = new StubEmbeddingProvider();
    const service = new KnowledgeBaseService(stub);
    const { runWithTenantContext } = await import("../db/client.js");

    const text = Array.from(
      { length: 200 },
      (_, i) => `Пункт ${i + 1}. Условие обслуживания номер ${i + 1} действует для всех клиентов.`,
    ).join(" ");

    const document = await runWithTenantContext(session.tenantId, () =>
      service.addDocument({
        tenantId: session.tenantId,
        agentId: session.agentId,
        filename: "big.txt",
        mimeType: "text/plain",
        text,
      }),
    );

    expect(document.chunksCount).toBeGreaterThan(5);
    // Один вызов на фрагмент дал бы столько round-trip'ов, сколько фрагментов.
    expect(stub.calls).toBeLessThan(document.chunksCount);
  });
});

describe("RLS базы знаний", () => {
  it("не показывает документы и фрагменты чужого арендатора", async () => {
    const mine = await signedInWithAgent();
    const other = await signedInWithAgent();

    const service = new KnowledgeBaseService(new StubEmbeddingProvider());
    const { query, runWithTenantContext } = await import("../db/client.js");

    await runWithTenantContext(mine.tenantId, () =>
      service.addDocument({
        tenantId: mine.tenantId,
        agentId: mine.agentId,
        filename: "мой.txt",
        mimeType: "text/plain",
        text: "гарантия на ремонт девяносто дней с даты выдачи устройства владельцу",
      }),
    );

    // Запрос сознательно без `WHERE tenant_id`: проверяется политика, а не фильтр
    // в SQL.
    const foreignDocs = await runWithTenantContext(other.tenantId, () =>
      query<{ id: string }>(`SELECT id FROM knowledge_base_documents`),
    );
    const foreignChunks = await runWithTenantContext(other.tenantId, () =>
      query<{ id: string }>(`SELECT id FROM knowledge_base_chunks`),
    );

    expect(foreignDocs).toHaveLength(0);
    expect(foreignChunks).toHaveLength(0);

    const ownDocs = await runWithTenantContext(mine.tenantId, () =>
      query<{ id: string }>(`SELECT id FROM knowledge_base_documents`),
    );
    expect(ownDocs).toHaveLength(1);
  });

  it("поиск чужого арендатора не находит фрагменты по тому же вопросу", async () => {
    const mine = await signedInWithAgent();
    const other = await signedInWithAgent();

    const service = new KnowledgeBaseService(new StubEmbeddingProvider());
    const { runWithTenantContext } = await import("../db/client.js");

    await runWithTenantContext(mine.tenantId, () =>
      service.addDocument({
        tenantId: mine.tenantId,
        agentId: mine.agentId,
        filename: "секрет.txt",
        mimeType: "text/plain",
        text: "гарантия распространяется только на постоянных клиентов нашей компании",
      }),
    );

    const hits = await runWithTenantContext(other.tenantId, () =>
      service.search({
        tenantId: other.tenantId,
        agentId: other.agentId,
        question: "гарантия для клиентов",
      }),
    );

    expect(hits).toHaveLength(0);
  });

  it("удаление документа каскадно удаляет фрагменты", async () => {
    const session = await signedInWithAgent();
    const service = new KnowledgeBaseService(new StubEmbeddingProvider());
    const { runWithTenantContext } = await import("../db/client.js");

    const document = await runWithTenantContext(session.tenantId, () =>
      service.addDocument({
        tenantId: session.tenantId,
        agentId: session.agentId,
        filename: "удаляемый.txt",
        mimeType: "text/plain",
        text: Array.from({ length: 40 }, (_, i) => `Пункт ${i}. Условие обслуживания.`).join(" "),
      }),
    );

    expect(document.chunksCount).toBeGreaterThan(0);

    await runWithTenantContext(session.tenantId, () =>
      service.deleteDocument(session.tenantId, session.agentId, document.id),
    );

    const remaining = await withTestDb(async (client) => {
      const result = await client.query<{ chunks: string }>(
        `SELECT count(*)::text AS chunks FROM knowledge_base_chunks WHERE document_id = $1`,
        [document.id],
      );
      return result.rows[0]?.chunks ?? "0";
    });

    // Каскад по `document_id`: отдельный DELETE был бы вторым источником истины о
    // том, что связано с документом.
    expect(remaining).toBe("0");
  });

  it("удаление агента каскадно удаляет его базу знаний", async () => {
    const session = await signedInWithAgent();
    const service = new KnowledgeBaseService(new StubEmbeddingProvider());
    const { runWithTenantContext } = await import("../db/client.js");

    await runWithTenantContext(session.tenantId, () =>
      service.addDocument({
        tenantId: session.tenantId,
        agentId: session.agentId,
        filename: "материал.txt",
        mimeType: "text/plain",
        text: "гарантия на выполненный ремонт составляет девяносто дней с даты выдачи",
      }),
    );

    await withTestDb(async (client) => {
      await client.query(`DELETE FROM ai_agents WHERE id = $1`, [session.agentId]);
    });

    const left = await withTestDb(async (client) => {
      const docs = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM knowledge_base_documents`,
      );
      const chunks = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM knowledge_base_chunks`,
      );
      return { docs: docs.rows[0]?.count, chunks: chunks.rows[0]?.count };
    });

    expect(left.docs).toBe("0");
    expect(left.chunks).toBe("0");
  });
});

describe("HTTP: база знаний", () => {
  it("возвращает пустой список и метаданные раздела", async () => {
    const session = await signedInWithAgent();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ai/agents/${session.agentId}/knowledge`,
      headers: { authorization: `Bearer ${session.token}` },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json<{
      data: unknown[];
      meta: { vectorisationAvailable: boolean; supportedExtensions: string[] };
    }>();

    expect(body.data).toEqual([]);
    // В тестах ключ шлюза не задан, поэтому интерфейс обязан узнать об этом до
    // попытки загрузки.
    expect(body.meta.vectorisationAvailable).toBe(false);
    expect(body.meta.supportedExtensions).toContain("docx");
  });

  it("отвечает 503 при загрузке без настроенного провайдера", async () => {
    const session = await signedInWithAgent();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/ai/agents/${session.agentId}/knowledge`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: { title: "Регламент", text: "Гарантия на ремонт составляет 90 дней." },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json<ErrorBody>().error.code).toBe("EMBEDDINGS_UNAVAILABLE");
  });

  it("отвечает 404 на чужого агента", async () => {
    const mine = await signedInWithAgent();
    const other = await signedInWithAgent();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ai/agents/${other.agentId}/knowledge`,
      headers: { authorization: `Bearer ${mine.token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("закрывает раздел от рядовой роли", async () => {
    const tenant = await createTenant();
    const viewer = await createUser({ tenantId: tenant.tenantId, role: "viewer" });

    await withTestDb(async (client) => {
      await client.query(
        `INSERT INTO installed_modules (tenant_id, slug, name) VALUES ($1, 'ai_bots', 'AI')`,
        [tenant.tenantId],
      );
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: viewer.email, password: viewer.password },
    });
    const token = login.json<{ data: { access_token: string } }>().data.access_token;

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ai/agents/00000000-0000-0000-0000-000000000000/knowledge`,
      headers: { authorization: `Bearer ${token}` },
    });

    // `ai_bots:read` нет у наблюдателя: гейт срабатывает до обращения к агенту.
    expect(res.statusCode).toBe(403);
  });

  it("требует установленного модуля ai_bots", async () => {
    const tenant = await createTenant();
    const owner = await createUser({ tenantId: tenant.tenantId, role: "owner" });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: owner.email, password: owner.password },
    });
    const token = login.json<{ data: { access_token: string } }>().data.access_token;

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ai/agents/00000000-0000-0000-0000-000000000000/knowledge`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorBody>().error.code).toBe("MODULE_NOT_INSTALLED");
  });
});

describe("HTTP: привязка каналов", () => {
  it("возвращает аккаунты арендатора с признаком привязки", async () => {
    const session = await signedInWithAgent();
    await createChannelAccount(session.tenantId);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ai/agents/${session.agentId}/channels`,
      headers: { authorization: `Bearer ${session.token}` },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json<{ data: { isBound: boolean; channel: string }[] }>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.isBound).toBe(false);
    expect(body.data[0]?.channel).toBe("telegram");
  });

  it("сохраняет и снимает привязку", async () => {
    const session = await signedInWithAgent();
    const accountId = await createChannelAccount(session.tenantId);

    const bound = await app.inject({
      method: "PUT",
      url: `/api/v1/ai/agents/${session.agentId}/channels`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: { channel_account_ids: [accountId] },
    });

    expect(bound.statusCode).toBe(200);
    expect(bound.json<{ data: { isBound: boolean }[] }>().data[0]?.isBound).toBe(true);

    const cleared = await app.inject({
      method: "PUT",
      url: `/api/v1/ai/agents/${session.agentId}/channels`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: { channel_account_ids: [] },
    });

    expect(cleared.json<{ data: { isBound: boolean }[] }>().data[0]?.isBound).toBe(false);

    const rows = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ai_agent_channel_bindings`,
      );
      return result.rows[0]?.count ?? "0";
    });

    expect(rows).toBe("0");
  });

  it("замена набора идемпотентна и не порождает дублей", async () => {
    const session = await signedInWithAgent();
    const accountId = await createChannelAccount(session.tenantId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/ai/agents/${session.agentId}/channels`,
        headers: { authorization: `Bearer ${session.token}` },
        payload: { channel_account_ids: [accountId, accountId] },
      });
      expect(res.statusCode).toBe(200);
    }

    const rows = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ai_agent_channel_bindings`,
      );
      return result.rows[0]?.count ?? "0";
    });

    // Дубликат в запросе не должен нарушать первичный ключ (agent_id, account_id).
    expect(rows).toBe("1");
  });

  it("отклоняет аккаунт чужого арендатора", async () => {
    const mine = await signedInWithAgent();
    const other = await signedInWithAgent();
    const foreignAccount = await createChannelAccount(other.tenantId, "Чужой");

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/ai/agents/${mine.agentId}/channels`,
      headers: { authorization: `Bearer ${mine.token}` },
      payload: { channel_account_ids: [foreignAccount] },
    });

    // 404 с понятным текстом, а не ошибка БД от RLS.
    expect(res.statusCode).toBe(404);

    const rows = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ai_agent_channel_bindings`,
      );
      return result.rows[0]?.count ?? "0";
    });

    expect(rows).toBe("0");
  });

  it("удаление аккаунта канала снимает привязку каскадом", async () => {
    const session = await signedInWithAgent();
    const accountId = await createChannelAccount(session.tenantId);

    await app.inject({
      method: "PUT",
      url: `/api/v1/ai/agents/${session.agentId}/channels`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: { channel_account_ids: [accountId] },
    });

    await withTestDb(async (client) => {
      await client.query(`DELETE FROM channel_accounts WHERE id = $1`, [accountId]);
    });

    const rows = await withTestDb(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ai_agent_channel_bindings`,
      );
      return result.rows[0]?.count ?? "0";
    });

    // Иначе осталась бы привязка к несуществующему аккаунту, и обработчик
    // входящих искал бы агента по мёртвому идентификатору.
    expect(rows).toBe("0");
  });
});
