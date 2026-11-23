-- =============================================================================
-- 0130: Паспорт компании (Саммери базы знаний) с утверждением пользователем
-- =============================================================================

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS company_profile_summary TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS company_profile_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS company_profile_approved_at TIMESTAMPTZ DEFAULT NULL;
