-- -----------------------------------------------------------------------------
-- 0036: Конфигурация платформенных интеграций (Robokassa и LLM-провайдеры)
--
-- Позволяет владельцу платформы настраивать ключи Robokassa и API-ключи ИИ-провайдеров
-- прямо из веб-интерфейса админки без необходимости ручной правки .env на сервере.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_integrations_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  -- Платёжный шлюз Robokassa
  robokassa_login TEXT,
  robokassa_password_1 TEXT,
  robokassa_password_2 TEXT,
  robokassa_is_test BOOLEAN NOT NULL DEFAULT true,
  robokassa_hash_algo TEXT NOT NULL DEFAULT 'SHA256',
  robokassa_tax TEXT NOT NULL DEFAULT 'none',
  -- Провайдер искусственного интеллекта (LLM / Embeddings)
  llm_api_base_url TEXT,
  llm_api_key TEXT,
  llm_embedding_model TEXT DEFAULT 'text-embedding-3-small',
  llm_chat_model TEXT DEFAULT 'openai/gpt-4o-mini',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Единственная конфигурационная запись платформы
INSERT INTO platform_integrations_config (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;
