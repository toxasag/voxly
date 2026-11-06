-- =============================================================================
-- 0078: Markdown Knowledge Base, Generative Prompt & Dialogue Feedback Loop
-- =============================================================================

-- 1. Добавляем поля в ai_agents: целевая страница, сгенерированный системный промпт, живая база знаний в Markdown и тумблер сбора обратной связи
ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS target_page_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS generated_system_prompt TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS knowledge_base_md TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS feedback_learning_enabled BOOLEAN NOT NULL DEFAULT true;

-- 2. Таблица обратной связи по диалогам и петли самообучения (Human-in-the-loop)
CREATE TABLE IF NOT EXISTS agent_dialogue_feedbacks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  conversation_id TEXT DEFAULT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  user_comment TEXT NOT NULL,
  clarification_qa JSONB DEFAULT '[]'::jsonb,
  compiled_rule TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индексы для быстрой фильтрации по агенту, тенанту и статусу
CREATE INDEX IF NOT EXISTS idx_agent_dialogue_feedbacks_agent_id ON agent_dialogue_feedbacks(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_dialogue_feedbacks_tenant_id ON agent_dialogue_feedbacks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_dialogue_feedbacks_status ON agent_dialogue_feedbacks(status);

-- Multi-tenant Row-Level Security (RLS)
ALTER TABLE agent_dialogue_feedbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON agent_dialogue_feedbacks;
CREATE POLICY tenant_isolation ON agent_dialogue_feedbacks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
