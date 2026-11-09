import { query, queryOne, transaction, withTenant } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import {
  EMBEDDING_DIMENSIONS,
  GatewayEmbeddingProvider,
  type EmbeddingProvider,
} from "../../services/embeddings.service.js";
import { chunkText, type TextChunk } from "./knowledge-text.js";

// ---------------------------------------------------------------------------
// База знаний агентов (RAG).
//
// Документ загружается текстом или файлом, режется на перекрывающиеся фрагменты,
// каждый превращается в вектор и складывается в `knowledge_base_chunks`. Перед
// вызовом модели вопрос пользователя векторизуется тем же способом, и ближайшие
// фрагменты подставляются в контекст.
//
// Все запросы фильтруют `tenant_id` явно, RLS остаётся второй линией (§4).
// ---------------------------------------------------------------------------

/**
 * Размер пачки при векторизации.
 *
 * Один вызов на фрагмент означал бы сотни round-trip'ов на документ; вся пачка
 * целиком — риск упереться в предел размера запроса у шлюза и потерять работу по
 * всему документу из-за одного длинного фрагмента. 32 × 1500 символов ≈ 48 КБ на
 * запрос, что заведомо в пределах.
 */
const EMBEDDING_BATCH_SIZE = 32;

/** Сколько фрагментов подставляется в контекст (задание: LIMIT 4). */
const SEARCH_LIMIT = 4;

/**
 * Порог косинусного расстояния для попадания в контекст.
 *
 * `<=>` даёт 0 для совпадающих направлений и 2 для противоположных. Порог нужен
 * потому, что без него поиск всегда возвращает четыре фрагмента, даже когда в базе
 * нет ничего по теме: модель получала бы случайный текст как «найденное в
 * документах», а это прямой путь к уверенным выдумкам в ответе.
 *
 * Значение подобрано **по измерениям** на реальном регламенте сервисного центра
 * (`text-embedding-3-small`, вопросы на русском):
 *
 *   гарантия на ремонт            0.35  ← по теме
 *   стоимость диагностики         0.49  ← по теме
 *   срок возврата денег           0.65  ← по теме, формулировка расходится с текстом
 *   погода в Москве               0.84  ← не по теме
 *   рецепт борща                  0.90  ← не по теме
 *
 * Первоначальные 0.6 отсекали валидный вопрос про возврат денег (0.648), то есть
 * агент отвечал бы «в документах ничего нет» при наличии прямого ответа. 0.75
 * лежит в разрыве между 0.65 и 0.84 и отделяет по теме от не по теме с запасом с
 * обеих сторон.
 */
const SEARCH_MAX_DISTANCE = 0.75;

export type DocumentStatus = "draft" | "processing" | "ready" | "failed" | "approved";

export interface KnowledgeDocumentDTO {
  id: string;
  agentId: string | null;
  filename: string;
  mimeType: string;
  fileSize: number;
  status: DocumentStatus;
  errorMessage: string;
  chunksCount: number;
  createdAt: string;
  category?: string;
  sourceUrl?: string | null;
}

export interface KnowledgeDocumentDetailDTO extends KnowledgeDocumentDTO {
  contentText: string;
}

export interface KnowledgeSearchHit {
  content: string;
  distance: number;
  documentId: string;
  filename: string;
}

interface DocumentRow {
  id: string;
  agent_id: string | null;
  filename: string;
  mime_type: string;
  file_size: number;
  status: DocumentStatus;
  error_message: string;
  chunks_count: string;
  category?: string;
  source_url?: string | null;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDTO(row: DocumentRow): KnowledgeDocumentDTO {
  return {
    id: row.id,
    agentId: row.agent_id,
    filename: row.filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    status: row.status,
    errorMessage: row.error_message,
    // COUNT приходит строкой: pg не приводит bigint к number.
    chunksCount: Number(row.chunks_count),
    createdAt: toIso(row.created_at),
    category: row.category ?? "general",
    sourceUrl: row.source_url ?? null,
  };
}

/**
 * Вектор в текстовом литерале pgvector: `[0.1,0.2,...]`.
 *
 * Массив чисел нельзя передать параметром напрямую — драйвер отправил бы его как
 * `float8[]`, а `vector` из массива неявно не приводится. Значение всё равно
 * идёт через bind-параметр, поэтому интерполяции в SQL здесь нет.
 */
function toVectorLiteral(vector: readonly number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Vector length ${vector.length} does not match schema (${EMBEDDING_DIMENSIONS})`,
    );
  }
  return `[${vector.join(",")}]`;
}

const DOCUMENT_SELECT = `
  SELECT d.id, d.agent_id, d.filename, d.mime_type, d.file_size, d.status,
         d.error_message, d.created_at, COALESCE(d.category, 'general') AS category,
         d.source_url,
         COALESCE(c.chunks_count, 0)::text AS chunks_count
  FROM knowledge_base_documents d
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS chunks_count
    FROM knowledge_base_chunks ch
    WHERE ch.document_id = d.id
  ) c ON true
`;

export class KnowledgeBaseService {
  constructor(private readonly embeddings: EmbeddingProvider = new GatewayEmbeddingProvider()) {}

  /** Настроена ли векторизация: интерфейс показывает это до попытки загрузки. */
  get isVectorisationAvailable(): boolean {
    return this.embeddings.isConfigured;
  }

  // -------------------------------------------------------------------------
  // Чтение
  // -------------------------------------------------------------------------

  /**
   * Документы агента.
   *
   * Документы без агента (`agent_id IS NULL`) видны всем агентам арендатора: это
   * общие материалы вроде регламента компании, и дублировать их на каждого агента
   * означало бы платить за векторизацию столько раз, сколько агентов.
   *
   * Существование агента проверяется и здесь, хотя выборка и так ограничена
   * `tenant_id`. Без проверки чужой или несуществующий идентификатор отвечал
   * `200` с пустым списком: данные не утекали, но интерфейс по неверному URL
   * показывал бы «база знаний пуста» вместо «агент не найден», а поведение
   * расходилось с `GET /agents/:id`, который отдаёт `404`. Обнаружено тестом.
   */
  async listDocuments(tenantId: string, agentId: string): Promise<KnowledgeDocumentDTO[]> {
    await this.assertAgentExists(tenantId, agentId);

    const rows = await query<DocumentRow>(
      `${DOCUMENT_SELECT}
       WHERE d.tenant_id = $1 AND (d.agent_id = $2 OR d.agent_id IS NULL)
       ORDER BY d.created_at DESC`,
      [tenantId, agentId],
    );

    return rows.map(toDTO);
  }

  /**
   * Получение полной информации о документе вместе с текстом (для просмотра и редактирования).
   */
  async getDocument(tenantId: string, agentId: string | null | undefined, documentId: string): Promise<KnowledgeDocumentDetailDTO> {
    if (agentId) {
      await this.assertAgentExists(tenantId, agentId);
    }

    const row = await queryOne<DocumentRow & { content_text: string | null }>(
      `SELECT d.id, d.agent_id, d.filename, d.mime_type, d.file_size, d.content_text, d.status,
              d.error_message, d.created_at,
              COALESCE(c.chunks_count, 0)::text AS chunks_count
       FROM knowledge_base_documents d
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS chunks_count
         FROM knowledge_base_chunks ch
         WHERE ch.document_id = d.id
       ) c ON true
       WHERE d.tenant_id = $1 AND d.id = $2 AND ($3::uuid IS NULL OR d.agent_id = $3 OR d.agent_id IS NULL)`,
      [tenantId, documentId, agentId ?? null],
    );

    if (row === null) throw new NotFoundError("Документ не найден");

    return {
      ...toDTO(row),
      contentText: row.content_text ?? "",
    };
  }

  /**
   * Возвращает список всех сырых векторных чанков документа для инспекции RAG.
   */
  async listDocumentChunks(tenantId: string, agentId: string, documentId: string): Promise<Array<{
    id: string;
    chunkIndex: number;
    content: string;
    charsCount: number;
  }>> {
    await this.assertAgentExists(tenantId, agentId);

    const rows = await query<{
      id: string;
      chunk_index: number;
      content: string;
    }>(
      `SELECT id, chunk_index, content
       FROM knowledge_base_chunks
       WHERE tenant_id = $1 AND document_id = $2 AND (agent_id = $3 OR agent_id IS NULL)
       ORDER BY chunk_index ASC`,
      [tenantId, documentId, agentId],
    );

    return rows.map((r) => ({
      id: r.id,
      chunkIndex: r.chunk_index,
      content: r.content,
      charsCount: r.content.length,
    }));
  }

  /**
   * Обновление текста документа и его перевекторизация.
   * Позволяет на лету менять цены, услуги и регламенты.
   */
  async updateDocument(input: {
    tenantId: string;
    agentId: string;
    documentId: string;
    text: string;
    filename?: string;
  }): Promise<KnowledgeDocumentDetailDTO> {
    await this.assertAgentExists(input.tenantId, input.agentId);

    const existing = await queryOne<{ id: string; filename: string }>(
      `SELECT id, filename FROM knowledge_base_documents
       WHERE tenant_id = $1 AND id = $2 AND (agent_id = $3 OR agent_id IS NULL)`,
      [input.tenantId, input.documentId, input.agentId],
    );

    if (existing === null) throw new NotFoundError("Документ не найден");

    const chunks = chunkText(input.text);
    if (chunks.length === 0) {
      throw new AppError(400, "EMPTY_DOCUMENT", "Документ не содержит текста");
    }

    if (!this.embeddings.isConfigured) {
      throw new AppError(503, "EMBEDDINGS_UNAVAILABLE", "Векторизация недоступна: на платформе не настроен доступ к моделям.");
    }

    await query(
      `UPDATE knowledge_base_documents
       SET status = 'processing', error_message = ''
       WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.documentId],
    );

    try {
      const vectors = await this.embedChunks(chunks);

      await transaction(async (tx) => {
        // Удаляем старые фрагменты
        await tx.query(
          `DELETE FROM knowledge_base_chunks WHERE tenant_id = $1 AND document_id = $2`,
          [input.tenantId, input.documentId],
        );

        // Вставляем новые фрагменты с новыми эмбеддингами
        for (const [position, chunk] of chunks.entries()) {
          const vector = vectors[position];
          if (vector === undefined) {
            throw new Error(`Missing embedding for chunk ${chunk.index}`);
          }
          await tx.query(
            `INSERT INTO knowledge_base_chunks
               (tenant_id, document_id, agent_id, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4, $5, $6::vector)`,
            [
              input.tenantId,
              input.documentId,
              input.agentId,
              chunk.index,
              chunk.content,
              toVectorLiteral(vector),
            ],
          );
        }

        const newFilename = input.filename?.trim() || existing.filename;
        await tx.query(
          `UPDATE knowledge_base_documents
           SET filename = $1,
               content_text = $2,
               file_size = $3,
               status = 'ready',
               error_message = ''
           WHERE tenant_id = $4 AND id = $5`,
          [
            newFilename,
            input.text,
            Buffer.byteLength(input.text, "utf8"),
            input.tenantId,
            input.documentId,
          ],
        );
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "неизвестная ошибка";
      await query(
        `UPDATE knowledge_base_documents
         SET status = 'failed', error_message = $3
         WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.documentId, reason.slice(0, 500)],
      );
      throw error;
    }

    return this.getDocument(input.tenantId, input.agentId, input.documentId);
  }

  /**
   * Создание черновика документа базы знаний (Human-in-the-loop RAG).
   *
   * Документ сохраняется со статусом 'draft', НЕ нарезается на чанки и НЕ векторизуется,
   * пока пользователь не проверит и не подтвердит его в интерфейсе.
   */
  async createDraftDocument(input: {
    tenantId: string;
    agentId?: string | null;
    filename: string;
    mimeType: string;
    text: string;
    category?: string;
    sourceUrl?: string;
  }): Promise<KnowledgeDocumentDetailDTO> {
    if (input.agentId) {
      await this.assertAgentExists(input.tenantId, input.agentId);
    }

    const category = input.category?.trim() || "general";
    const text = input.text.trim();
    if (text.length === 0) {
      throw new AppError(400, "EMPTY_DOCUMENT", "Текст документа не может быть пустым");
    }

    const created = await queryOne<{ id: string }>(
      `INSERT INTO knowledge_base_documents
         (tenant_id, agent_id, filename, mime_type, file_size, content_text, status, category, source_url)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8)
       RETURNING id`,
      [
        input.tenantId,
        input.agentId ?? null,
        input.filename,
        input.mimeType,
        Buffer.byteLength(text, "utf8"),
        text,
        category,
        input.sourceUrl ?? null,
      ],
    );

    if (created === null) throw new Error("Failed to create draft document");

    return this.getDocument(input.tenantId, input.agentId, created.id);
  }

  /**
   * Подтверждение и индексация черновика документа (Approve & Vectorize).
   *
   * Применяет финальные правки пользователя (если переданы), нарезает на фрагменты,
   * запрашивает эмбеддинги и переводит документ в статус 'ready'.
   */
  async approveAndIndexDocument(input: {
    tenantId: string;
    agentId: string;
    documentId: string;
    text?: string;
    filename?: string;
    category?: string;
  }): Promise<KnowledgeDocumentDetailDTO> {
    await this.assertAgentExists(input.tenantId, input.agentId);

    const existing = await queryOne<{ id: string; content_text: string | null; filename: string; category: string }>(
      `SELECT id, content_text, filename, category FROM knowledge_base_documents
       WHERE tenant_id = $1 AND id = $2 AND (agent_id = $3 OR agent_id IS NULL)`,
      [input.tenantId, input.documentId, input.agentId],
    );

    if (existing === null) throw new NotFoundError("Документ не найден");

    const textToUse = input.text !== undefined ? input.text.trim() : (existing.content_text ?? "").trim();
    const filenameToUse = input.filename?.trim() || existing.filename;
    const categoryToUse = input.category?.trim() || existing.category || "general";

    if (textToUse.length === 0) {
      throw new AppError(400, "EMPTY_DOCUMENT", "Документ не содержит текста для индексации");
    }

    if (!this.embeddings.isConfigured) {
      throw new AppError(
        503,
        "EMBEDDINGS_UNAVAILABLE",
        "Векторизация недоступна: на платформе не настроен доступ к моделям. Обратитесь к администратору.",
      );
    }

    const chunks = chunkText(textToUse);
    if (chunks.length === 0) {
      throw new AppError(400, "EMPTY_DOCUMENT", "Не удалось сформировать текстовые фрагменты");
    }

    await query(
      `UPDATE knowledge_base_documents
       SET status = 'processing',
           content_text = $3,
           filename = $4,
           category = $5,
           file_size = $6,
           error_message = ''
       WHERE tenant_id = $1 AND id = $2`,
      [
        input.tenantId,
        input.documentId,
        textToUse,
        filenameToUse,
        categoryToUse,
        Buffer.byteLength(textToUse, "utf8"),
      ],
    );

    try {
      const vectors = await this.embedChunks(chunks);

      await transaction(async (tx) => {
        await tx.query(
          `DELETE FROM knowledge_base_chunks WHERE tenant_id = $1 AND document_id = $2`,
          [input.tenantId, input.documentId],
        );

        for (const [position, chunk] of chunks.entries()) {
          const vector = vectors[position];
          if (!vector) throw new Error(`Missing embedding for chunk ${chunk.index}`);

          await tx.query(
            `INSERT INTO knowledge_base_chunks
               (tenant_id, document_id, agent_id, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4, $5, $6::vector)`,
            [
              input.tenantId,
              input.documentId,
              input.agentId,
              chunk.index,
              chunk.content,
              toVectorLiteral(vector),
            ],
          );
        }

        await tx.query(
          `UPDATE knowledge_base_documents
           SET status = 'ready', error_message = ''
           WHERE tenant_id = $1 AND id = $2`,
          [input.tenantId, input.documentId],
        );
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "неизвестная ошибка";
      await query(
        `UPDATE knowledge_base_documents
         SET status = 'failed', error_message = $3
         WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.documentId, reason.slice(0, 500)],
      );
      throw error;
    }

    return this.getDocument(input.tenantId, input.agentId, input.documentId);
  }

  // -------------------------------------------------------------------------
  // Запись
  // -------------------------------------------------------------------------

  /**
   * Проверяет, что агент существует у этого арендатора.
   *
   * Отдельным шагом до векторизации: иначе платный вызов эмбеддингов выполнялся
   * бы для несуществующего агента, а отказ приходил бы уже после списания.
   */
  private async assertAgentExists(tenantId: string, agentId: string): Promise<void> {
    const agent = await queryOne<{ id: string }>(
      `SELECT id FROM ai_agents
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, agentId],
    );

    if (agent === null) throw new NotFoundError("AI-агент не найден");
  }

  /**
   * Сохраняет документ и его векторы.
   *
   * Порядок шагов выбран так, чтобы у пользователя не появлялось документов,
   * которых он не видит, и фрагментов без документа:
   *  1. строка документа создаётся сразу со статусом `processing` — она уже видна
   *     в списке, и при долгой векторизации интерфейс показывает прогресс, а не
   *     пустоту;
   *  2. векторизация идёт ВНЕ транзакции: сетевой вызов длится секунды, и
   *     удерживать соединение из пула (max 10) всё это время нельзя;
   *  3. фрагменты вставляются одной транзакцией и статус переводится в `ready`
   *     там же — документ не может оказаться `ready` без фрагментов;
   *  4. отказ провайдера переводит документ в `failed` с причиной, а не удаляет
   *     его: пользователь должен понимать, что произошло, и повторить попытку.
   */
  async addDocument(input: {
    tenantId: string;
    agentId: string;
    filename: string;
    mimeType: string;
    text: string;
    category?: string;
  }): Promise<KnowledgeDocumentDTO> {
    await this.assertAgentExists(input.tenantId, input.agentId);

    const chunks = chunkText(input.text);

    if (chunks.length === 0) {
      throw new AppError(400, "EMPTY_DOCUMENT", "Документ не содержит текста", {
        text: ["Документ не содержит текста"],
      });
    }

    // Проверка до создания строки: документ со статусом `failed` при отключённой
    // векторизации выглядел бы как сбой, тогда как причина — конфигурация
    // платформы.
    if (!this.embeddings.isConfigured) {
      throw new AppError(
        503,
        "EMBEDDINGS_UNAVAILABLE",
        "Векторизация недоступна: на платформе не настроен доступ к моделям. Обратитесь к администратору.",
      );
    }

    const category = input.category?.trim() || "general";
    const created = await queryOne<{ id: string }>(
      `INSERT INTO knowledge_base_documents
         (tenant_id, agent_id, filename, mime_type, file_size, content_text, status, category)
       VALUES ($1, $2, $3, $4, $5, $6, 'processing', $7)
       RETURNING id`,
      [
        input.tenantId,
        input.agentId,
        input.filename,
        input.mimeType,
        Buffer.byteLength(input.text, "utf8"),
        input.text,
        category,
      ],
    );

    if (created === null) throw new Error("Failed to create knowledge document");

    try {
      const vectors = await this.embedChunks(chunks);

      await transaction(async (tx) => {
        for (const [position, chunk] of chunks.entries()) {
          const vector = vectors[position];
          if (vector === undefined) {
            throw new Error(`Missing embedding for chunk ${chunk.index}`);
          }

          await tx.query(
            `INSERT INTO knowledge_base_chunks
               (tenant_id, document_id, agent_id, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4, $5, $6::vector)`,
            [
              input.tenantId,
              created.id,
              input.agentId,
              chunk.index,
              chunk.content,
              toVectorLiteral(vector),
            ],
          );
        }

        await tx.query(
          `UPDATE knowledge_base_documents
           SET status = 'ready', error_message = ''
           WHERE tenant_id = $1 AND id = $2`,
          [input.tenantId, created.id],
        );
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "неизвестная ошибка";

      // Пометка `failed` выполняется отдельным запросом вне упавшей транзакции:
      // внутри неё UPDATE откатился бы вместе с ошибкой, и документ навсегда
      // остался бы в `processing`.
      await query(
        `UPDATE knowledge_base_documents
         SET status = 'failed', error_message = $3
         WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, created.id, reason.slice(0, 500)],
      );

      throw error;
    }

    const row = await queryOne<DocumentRow>(
      `${DOCUMENT_SELECT} WHERE d.tenant_id = $1 AND d.id = $2`,
      [input.tenantId, created.id],
    );

    if (row === null) throw new Error("Knowledge document disappeared after creation");

    return toDTO(row);
  }

  /**
   * Выполняет нарезку на чанки и векторизацию документа в фоне (Background Worker / BullMQ).
   */
  async indexDocument(tenantId: string, documentId: string): Promise<void> {
    const doc = await queryOne<{
      id: string;
      agent_id: string;
      content_text: string | null;
      status: DocumentStatus;
    }>(
      `SELECT id, agent_id, content_text, status FROM knowledge_base_documents
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, documentId],
    );

    if (!doc || !doc.content_text) return;
    const chunks = chunkText(doc.content_text);
    if (chunks.length === 0) return;

    if (!this.embeddings.isConfigured) {
      await query(
        `UPDATE knowledge_base_documents
         SET status = 'failed', error_message = 'Векторизация недоступна: на платформе не настроен доступ к моделям.'
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, documentId],
      );
      return;
    }

    try {
      const vectors = await this.embedChunks(chunks);
      await transaction(async (tx) => {
        await tx.query(
          `DELETE FROM knowledge_base_chunks WHERE tenant_id = $1 AND document_id = $2`,
          [tenantId, documentId],
        );

        for (const [position, chunk] of chunks.entries()) {
          const vector = vectors[position];
          if (!vector) continue;
          await tx.query(
            `INSERT INTO knowledge_base_chunks
               (tenant_id, document_id, agent_id, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4, $5, $6::vector)`,
            [tenantId, documentId, doc.agent_id, chunk.index, chunk.content, toVectorLiteral(vector)],
          );
        }

        await tx.query(
          `UPDATE knowledge_base_documents
           SET status = 'ready', error_message = ''
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, documentId],
        );
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "неизвестная ошибка";
      await query(
        `UPDATE knowledge_base_documents
         SET status = 'failed', error_message = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, documentId, reason.slice(0, 500)],
      );
    }
  }

  /** Векторизация пачками: один вызов на фрагмент дал бы сотни round-trip'ов. */
  private async embedChunks(chunks: readonly TextChunk[]): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const result = await this.embeddings.embed(batch.map((chunk) => chunk.content));
      vectors.push(...result.vectors);
    }

    return vectors;
  }

  /**
   * Удаляет документ вместе с фрагментами.
   *
   * Фрагменты уходят каскадом (`ON DELETE CASCADE` на `document_id`), поэтому
   * отдельный DELETE не нужен: он был бы вторым источником истины о том, что
   * связано с документом.
   */
  async deleteDocument(tenantId: string, agentId: string, documentId: string): Promise<void> {
    await this.assertAgentExists(tenantId, agentId);

    const deleted = await queryOne<{ id: string }>(
      `DELETE FROM knowledge_base_documents
       WHERE tenant_id = $1 AND id = $2 AND (agent_id = $3 OR agent_id IS NULL)
       RETURNING id`,
      [tenantId, documentId, agentId],
    );

    if (deleted === null) throw new NotFoundError("Документ не найден");
  }

  // -------------------------------------------------------------------------
  // Семантический поиск
  // -------------------------------------------------------------------------

  /**
   * Ближайшие к вопросу фрагменты.
   *
   * Общие документы арендатора (`agent_id IS NULL`) участвуют в поиске наравне с
   * документами агента — по той же причине, по которой они видны в списке.
   *
   * Возвращает пустой массив, когда векторизация не настроена: отсутствие базы
   * знаний не должно ломать сам вызов модели, агент просто ответит без контекста.
   */
  async search(input: {
    tenantId: string;
    agentId: string;
    question: string;
    limit?: number;
  }): Promise<KnowledgeSearchHit[]> {
    if (!this.embeddings.isConfigured) return [];
    if (input.question.trim().length === 0) return [];

    const embedded = await this.embeddings.embed([input.question]);
    const vector = embedded.vectors[0];
    if (vector === undefined) return [];

    const effectiveLimit = input.limit && input.limit > 0 ? Math.min(input.limit, 20) : SEARCH_LIMIT;

    const rows = await query<{
      content: string;
      distance: string;
      document_id: string;
      filename: string;
    }>(
      `SELECT ch.content,
              (ch.embedding <=> $4::vector) AS distance,
              ch.document_id,
              d.filename
       FROM knowledge_base_chunks ch
       JOIN knowledge_base_documents d ON d.id = ch.document_id
       WHERE ch.tenant_id = $1
         AND (ch.agent_id = $2 OR ch.agent_id IS NULL)
         AND d.status = 'ready'
         AND (ch.embedding <=> $4::vector) <= $3
       ORDER BY distance ASC
       LIMIT ${effectiveLimit}`,
      [input.tenantId, input.agentId, SEARCH_MAX_DISTANCE, toVectorLiteral(vector)],
    );

    return rows.map((row) => ({
      content: row.content,
      distance: Number(row.distance),
      documentId: row.document_id,
      filename: row.filename,
    }));
  }

  // -------------------------------------------------------------------------
  // Привязка агента к аккаунтам каналов
  // -------------------------------------------------------------------------

  /**
   * Аккаунты каналов арендатора с признаком привязки к агенту.
   *
   * Возвращаются все подключённые аккаунты, а не только привязанные: интерфейсу
   * нужен список для выбора, и второй запрос за «доступными» аккаунтами означал
   * бы два источника одного списка.
   */
  async listChannelBindings(
    tenantId: string,
    agentId: string,
  ): Promise<
    { channelAccountId: string; channel: string; label: string; externalId: string; status: string; isBound: boolean; isEnabled: boolean }[]
  > {
    await this.assertAgentExists(tenantId, agentId);

    const rows = await query<{
      id: string;
      channel: string;
      label: string;
      external_id: string;
      status: string;
      is_bound: boolean;
      is_enabled: boolean | null;
    }>(
      `SELECT ca.id, ca.channel, ca.label, ca.external_id, ca.status,
              (b.agent_id IS NOT NULL) AS is_bound,
              b.is_enabled
       FROM channel_accounts ca
       LEFT JOIN ai_agent_channel_bindings b
              ON b.channel_account_id = ca.id AND b.agent_id = $2
       WHERE ca.tenant_id = $1 AND ca.deleted_at IS NULL
       ORDER BY ca.channel, ca.label`,
      [tenantId, agentId],
    );

    return rows.map((row) => ({
      channelAccountId: row.id,
      channel: row.channel,
      label: row.label,
      externalId: row.external_id,
      status: row.status,
      isBound: row.is_bound,
      isEnabled: row.is_enabled ?? false,
    }));
  }

  /**
   * Заменяет набор привязок агента целиком.
   *
   * Замена, а не добавление: интерфейс отправляет итоговый список отмеченных
   * аккаунтов, и инкрементальные операции требовали бы от него вычислять разницу
   * — источник расхождений при параллельном редактировании.
   *
   * Принадлежность каждого аккаунта арендатору проверяется на сервере: RLS
   * отклонила бы чужой `channel_account_id` ошибкой БД, но невнятной, а не
   * `404`.
   */
  async replaceChannelBindings(input: {
    tenantId: string;
    agentId: string;
    channelAccountIds: readonly string[];
  }): Promise<void> {
    await this.assertAgentExists(input.tenantId, input.agentId);

    const unique = [...new Set(input.channelAccountIds)];

    if (unique.length > 0) {
      const found = await query<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
        [input.tenantId, unique],
      );

      if (found.length !== unique.length) {
        throw new NotFoundError("Один из указанных аккаунтов канала не найден");
      }
    }

    await withTenant(input.tenantId, async (tx) => {
      // Снимаем прежние привязки и ставим новые в одной транзакции: между двумя
      // отдельными запросами агент оказался бы без каналов, и входящее сообщение
      // в этот момент осталось бы без ответа.
      await tx.query(
        `DELETE FROM ai_agent_channel_bindings
         WHERE tenant_id = $1 AND agent_id = $2`,
        [input.tenantId, input.agentId],
      );

      for (const accountId of unique) {
        await tx.query(
          `INSERT INTO ai_agent_channel_bindings
             (tenant_id, agent_id, channel_account_id, is_enabled)
           VALUES ($1, $2, $3, TRUE)`,
          [input.tenantId, input.agentId, accountId],
        );
      }
    });
  }
}
