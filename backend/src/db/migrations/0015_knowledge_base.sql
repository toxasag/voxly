-- =============================================================================
-- 0015: База знаний агентов (RAG на pgvector) и привязка агентов к каналам
--
-- Три связанные вещи:
--   * документы, загруженные арендатором для агента;
--   * их фрагменты с векторными представлениями — по ним идёт семантический
--     поиск перед вызовом модели;
--   * связь «агент ↔ подключённый аккаунт канала», чтобы агент отвечал в
--     конкретном Telegram/MAX-аккаунте, а не во всех сразу.
--
-- Расширение `vector` требует образа БД с pgvector: см.
-- `docker/postgres-pgvector.Dockerfile` (postgres:16-alpine + pgvector 0.8.0 из
-- исходников). Готового alpine-образа с расширением не существует, а переход на
-- Debian сменил бы libc и обесценил бы 66 текстовых индексов существующего тома.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Расширение
-- -----------------------------------------------------------------------------
-- Выполняется владельцем БД: миграции идут под ролью-владельцем (см.
-- migrate-config.cjs), а `app_user` прав на `CREATE EXTENSION` не имеет и не
-- должен иметь.
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- 2. Документы базы знаний
-- -----------------------------------------------------------------------------
-- `agent_id` nullable: документ может быть общим для арендатора, а не для одного
-- агента. Задание допускает NULL, и это осмысленно — регламент компании
-- одинаков для всех агентов.
--
-- `content_text` хранится целиком рядом с фрагментами: без него нельзя
-- перевекторизовать документ при смене модели эмбеддингов, а исходный файл на
-- диске не сохраняется (объектного хранилища в проекте нет, см. M0.13.19).
CREATE TABLE IF NOT EXISTS knowledge_base_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE,

  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INT NOT NULL CHECK (file_size >= 0),
  content_text TEXT,

  -- `processing` — текст извлечён, векторизация идёт; `failed` — провайдер
  -- эмбеддингов отказал. Статус нужен интерфейсу: документ без фрагментов
  -- выглядит как успешно загруженный, но в поиск не попадает.
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('processing', 'ready', 'failed')),
  -- Причина отказа для показа пользователю: «не удалось обработать» без
  -- объяснения не даёт понять, повторять ли попытку.
  error_message TEXT NOT NULL DEFAULT '',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_documents_tenant_agent
  ON knowledge_base_documents (tenant_id, agent_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Фрагменты с эмбеддингами
-- -----------------------------------------------------------------------------
-- `vector(1536)` соответствует `text-embedding-3-small` — проверено живым
-- вызовом провайдера: ответ содержит ровно 1536 значений. Размерность зашита в
-- тип, поэтому смена модели эмбеддингов потребует миграции; это осознанно, иначе
-- в одной таблице оказались бы несравнимые векторы, и поиск молча возвращал бы
-- мусор.
--
-- `tenant_id` дублируется здесь, хотя выводится через `document_id`: поиск
-- фильтрует по нему напрямую, и JOIN ради изоляции на каждом запросе к
-- векторному индексу лишний. Он же несёт RLS-политику.
CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_base_documents(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE,

  chunk_index INT NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Повторная векторизация не должна порождать дубли фрагментов.
  CONSTRAINT knowledge_base_chunks_unique_index UNIQUE (document_id, chunk_index)
);

-- HNSW, а не IVFFlat: IVFFlat требует обучения на уже существующих данных
-- (`lists` подбирается по их количеству) и на пустой таблице даёт негодный
-- индекс, а база знаний наполняется постепенно. `vector_cosine_ops` — оператор
-- `<=>`, которым выполняется поиск.
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding
  ON knowledge_base_chunks USING hnsw (embedding vector_cosine_ops);

-- Обычный btree рядом с векторным: поиск всегда сужается по арендатору и агенту
-- до сравнения векторов, и без этого индекса фильтр читал бы таблицу целиком.
CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant_agent
  ON knowledge_base_chunks (tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_document
  ON knowledge_base_chunks (document_id, chunk_index);

-- -----------------------------------------------------------------------------
-- 4. Привязка агентов к аккаунтам каналов
-- -----------------------------------------------------------------------------
-- Составной первичный ключ: один агент подключается к нескольким аккаунтам, и
-- один аккаунт может обслуживаться несколькими агентами (например разными по
-- расписанию). `is_enabled` вместо удаления строки — отключение сохраняет
-- настройку, чтобы её не приходилось создавать заново.
--
-- `tenant_id` добавлен к заданной структуре: без него RLS-политика этой таблицы
-- невыразима — оба внешних ключа ведут на таблицы под RLS, но политика не может
-- опираться на них, не читая их (а чтение под RLS вернуло бы ноль строк при
-- отсутствии контекста). Оба идентификатора всё равно проверяются на
-- принадлежность арендатору при вставке.
CREATE TABLE IF NOT EXISTS ai_agent_channel_bindings (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  channel_account_id UUID NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, channel_account_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_channel_bindings_tenant
  ON ai_agent_channel_bindings (tenant_id);
-- Обратный поиск «какой агент отвечает в этом аккаунте» — основной запрос
-- обработчика входящих сообщений.
CREATE INDEX IF NOT EXISTS idx_agent_channel_bindings_account
  ON ai_agent_channel_bindings (channel_account_id)
  WHERE is_enabled;

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
-- Через `current_tenant_id()`, а не прямой `current_setting('app.tenant_id')`:
-- функция объявлена в schema.sql, приводит пустую строку к NULL и перехватывает
-- `invalid_text_representation`. Прямой каст падал бы с ошибкой 22P02 на любом
-- запросе вне tenant-контекста вместо того, чтобы просто не вернуть строк.
--
-- `platform_scope()` в USING (чтение платформенной панелью) и его отсутствие в
-- WITH CHECK (панель не пишет от имени арендаторов) — как во всех остальных
-- таблицах данных арендатора.
DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'knowledge_base_documents', 'knowledge_base_chunks', 'ai_agent_channel_bindings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
    -- FORCE обязателен: без него владелец таблицы игнорирует политики, и
    -- изоляция осталась бы декоративной.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_tenant_id() OR platform_scope())
         WITH CHECK (tenant_id = current_tenant_id())',
      target_table
    );
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Права app_user
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_base_documents TO app_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_base_chunks TO app_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ai_agent_channel_bindings TO app_user';
  END IF;
END;
$$;
