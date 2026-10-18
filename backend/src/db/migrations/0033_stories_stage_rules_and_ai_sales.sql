-- =============================================================================
-- 0033: Сторис, автоворонки по этапам сделок и обучение ИИ на успешных сделках
-- =============================================================================

-- 1. Таблица публикаций Сторис (Stories Engine: Telegram / MAX / WhatsApp)
CREATE TABLE IF NOT EXISTS story_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_account_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'telegram',
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'photo',
  text TEXT NOT NULL DEFAULT '',
  link_url TEXT,
  link_text TEXT,
  views_count INT NOT NULL DEFAULT 0,
  reactions_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'scheduled', 'published', 'failed')),
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_story_posts_tenant_posted ON story_posts(tenant_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_posts_tenant_status ON story_posts(tenant_id, status);

ALTER TABLE story_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_posts FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'story_posts' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON story_posts
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- 2. Таблица правил автоворонок по этапам сделок (Stage Rules / Bot Broadcasts)
CREATE TABLE IF NOT EXISTS mailing_stage_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id UUID REFERENCES stages(id) ON DELETE CASCADE,
  channel_account_id UUID REFERENCES channel_accounts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'telegram',
  name TEXT NOT NULL,
  delay_seconds INT NOT NULL DEFAULT 0,
  template_text TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mailing_stage_rules_lookup ON mailing_stage_rules(tenant_id, stage_id, is_active);

ALTER TABLE mailing_stage_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailing_stage_rules FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'mailing_stage_rules' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON mailing_stage_rules
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- 3. Добавление ключа идемпотентности в ai_usage_log
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS usage_charge_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_log_charge_key
  ON ai_usage_log (usage_charge_key)
  WHERE usage_charge_key IS NOT NULL;

-- 4. Обучение ИИ на успешных сделках (Closed-Won Sales Examples с векторами pgvector)
CREATE TABLE IF NOT EXISTS ai_sales_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  customer_query TEXT NOT NULL,
  agent_reply TEXT NOT NULL,
  embedding vector(1536),
  source_message_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_sales_examples_tenant ON ai_sales_examples(tenant_id, created_at DESC);

ALTER TABLE ai_sales_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_sales_examples FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_sales_examples' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON ai_sales_examples
      FOR ALL
      USING (tenant_id = current_tenant_id() OR platform_scope())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- Выдача прав непривилегированной роли приложения
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON story_posts TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON mailing_stage_rules TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_sales_examples TO app_user;
  END IF;
END $$;
