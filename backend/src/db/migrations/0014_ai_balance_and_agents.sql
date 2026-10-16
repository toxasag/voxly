-- =============================================================================
-- 0014: Баланс ИИ, наценка на токены и реальное хранение AI-агентов
--
-- Три связанные вещи, потому что они бессмысленны по отдельности:
--   * агенты должны где-то храниться (сейчас они существуют только в моках
--     фронтенда и исчезают при перезагрузке страницы);
--   * расход ИИ должен списываться с баланса, отдельного от абонентской платы;
--   * платформа зарабатывает на разнице между ценой провайдера и ценой для
--     арендатора, поэтому нужна наценка.
--
-- ДЕНЬГИ ХРАНЯТСЯ В КОПЕЙКАХ (BIGINT), не в рублях с плавающей точкой:
-- 0.1 + 0.2 в double не равно 0.3, и на балансе это со временем даёт расхождение
-- с суммой операций. Тот же подход уже применён в модуле финансов.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Баланс ИИ и наценка на уровне арендатора
-- -----------------------------------------------------------------------------
-- Существующая `tenants.ai_tokens_balance` (BIGINT, штуки токенов) не подходит:
-- у разных моделей цена за 1k токенов различается в 60 раз (DeepSeek против
-- Opus), поэтому «остаток токенов» ничего не говорит о том, на сколько их
-- хватит. Баланс ведётся в деньгах, а токены пересчитываются по прайсу модели.
--
-- Старая колонка не удаляется: на неё ссылаются платформенные экраны и
-- контракт 03_04. Помечена как устаревшая, удаление — отдельной задачей после
-- переноса UI.
COMMENT ON COLUMN tenants.ai_tokens_balance IS
  'УСТАРЕЛО (0014): остаток в штуках токенов. Используйте ai_balance_kopecks — цена 1k токенов различается между моделями в десятки раз.';

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ai_balance_kopecks BIGINT NOT NULL DEFAULT 0;

-- Наценка платформы на стоимость токенов, в процентах от цены провайдера.
-- Управляется владельцем платформы в /admin/tenants, поэтому живёт на арендаторе,
-- а не в конфиге: разным клиентам можно дать разные условия.
--
-- CHECK от -100: отрицательная наценка (скидка) осмысленна как маркетинговый
-- инструмент, но ниже -100% цена стала бы отрицательной и расход пополнял бы
-- баланс.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ai_markup_percent NUMERIC(6, 2) NOT NULL DEFAULT 30
    CONSTRAINT tenants_ai_markup_range CHECK (ai_markup_percent >= -100 AND ai_markup_percent <= 1000);

-- -----------------------------------------------------------------------------
-- 2. Пополнения баланса ИИ
-- -----------------------------------------------------------------------------
-- Журнал операций, а не только текущий остаток: без него нельзя ответить, откуда
-- взялась сумма на балансе, и невозможно свести расчёты с клиентом.
CREATE TABLE IF NOT EXISTS ai_balance_topups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Кто пополнил. NULL — начисление платформой или автоплатёж.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),

  -- `manual` — начисление владельцем платформы, `payment` — оплата клиентом,
  -- `bonus` — промо. Платёжного провайдера в проекте пока нет, поэтому по факту
  -- используется `manual`; поле заведено, чтобы позже не менять схему.
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'payment', 'bonus')),

  -- Идентификатор платежа у провайдера — для сверки, когда оплата появится.
  external_payment_id TEXT,
  comment TEXT NOT NULL DEFAULT '',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_balance_topups_tenant
  ON ai_balance_topups (tenant_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. AI-агенты
-- -----------------------------------------------------------------------------
-- До этой миграции агенты жили в `lib/ai-bots/mock-ai-bots.ts`: карточки
-- «Помощник по продажам» и «Статус ремонта» были захардкожены, одинаковы у всех
-- арендаторов и исчезали при перезагрузке.
CREATE TABLE IF NOT EXISTS ai_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Ключ палитры Tailwind для плашки агента.
  accent TEXT NOT NULL DEFAULT 'amber'
    CHECK (accent IN ('amber', 'sky', 'emerald', 'orange', 'rose')),

  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused')),
  mode TEXT NOT NULL DEFAULT 'suggester'
    CHECK (mode IN ('suggester', 'autoreply', 'disabled')),

  temperature NUMERIC(3, 2) NOT NULL DEFAULT 0.7
    CHECK (temperature >= 0 AND temperature <= 1),
  max_tokens INT NOT NULL DEFAULT 1024 CHECK (max_tokens BETWEEN 128 AND 8192),

  -- Промпт хранится в БД, а не в коде (.cursorrules §13).
  system_prompt TEXT NOT NULL,

  -- Сущности CRM, которые подставляются в контекст перед вызовом модели.
  context_entities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Имя уникально в пределах арендатора: два агента «Продажи» в списке
-- неразличимы. Частичный индекс — удалённое имя можно использовать снова.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agents_unique_name
  ON ai_agents (tenant_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_agents_tenant
  ON ai_agents (tenant_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_ai_agents_updated_at ON ai_agents;
CREATE TRIGGER trg_ai_agents_updated_at
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Журнал вызовов моделей
-- -----------------------------------------------------------------------------
-- Требование .cursorrules §13: каждый вызов LLM логирует tenant_id, user_id,
-- модель, токены и задержку. Здесь же лежит списанная сумма — иначе расход по
-- балансу невозможно объяснить построчно.
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  model TEXT NOT NULL,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,

  -- Себестоимость у провайдера и цена для арендатора с наценкой. Хранятся обе:
  -- по разнице считается маржа платформы, а пересчёт задним числом невозможен —
  -- наценку могли изменить после вызова.
  provider_cost_kopecks BIGINT NOT NULL DEFAULT 0,
  charged_kopecks BIGINT NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  error_message TEXT NOT NULL DEFAULT '',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Расход за период — основной запрос виджета баланса.
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_tenant_created
  ON ai_usage_log (tenant_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_agents;
CREATE POLICY tenant_isolation ON ai_agents
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_usage_log;
CREATE POLICY tenant_isolation ON ai_usage_log
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- Пополнения: платформа обязана видеть их по всем арендаторам (сверка расчётов),
-- поэтому в USING есть platform_scope, а в WITH CHECK — нет.
ALTER TABLE ai_balance_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_balance_topups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_balance_topups;
CREATE POLICY tenant_isolation ON ai_balance_topups
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- -----------------------------------------------------------------------------
-- 6. Права app_user
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ai_agents TO app_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage_log TO app_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ai_balance_topups TO app_user';
  END IF;
END;
$$;
