-- =============================================================================
-- Поля записей по образцу стандартных объектов Twenty (Opportunity / Person /
-- Company). Переносится смысл, а не типы: суммы остаются NUMERIC (у Twenty
-- CurrencyMetadata с amountMicros — защита от float, у нас ту же роль играет
-- NUMERIC), связи — обычными внешними ключами.
-- =============================================================================

-- Сделки ----------------------------------------------------------------------

-- Ответственный отдельно от создателя: сделку может завести AI-агент из
-- входящего сообщения (created_by = системный пользователь), а вести её — живой
-- менеджер. В Twenty это разные поля `createdBy` (ActorMetadata) и `owner`.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Ожидаемая дата закрытия (Twenty: closeDate). От created_at она независима:
-- по ней строится прогноз выручки, а не история.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS close_date DATE;

-- Порядок карточки внутри колонки канбана (Twenty: position). Без него
-- перетаскивание внутри стадии не сохраняется: после перезагрузки карточки
-- возвращались к сортировке по дате.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_deals_owner_id ON deals(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_stage_position ON deals(tenant_id, stage_id, position);

-- Существующим сделкам ответственным становится создатель: до появления поля
-- именно он и вёл сделку, и NULL здесь читался бы как «никто не ведёт».
UPDATE deals SET owner_id = created_by WHERE owner_id IS NULL;

-- Начальный порядок — по дате создания, чтобы канбан не перемешался при первом
-- открытии после миграции.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY stage_id ORDER BY created_at) AS rn
  FROM deals
  WHERE deleted_at IS NULL
)
UPDATE deals d SET position = ordered.rn
FROM ordered
WHERE d.id = ordered.id AND d.position = 0;

-- Контакты --------------------------------------------------------------------

-- Должность (Twenty: jobTitle) — нужна для B2B-переписки и обращения.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT '';

-- Компании --------------------------------------------------------------------

-- Домен (Twenty: domainName) — естественный ключ дедупликации компаний:
-- «ООО Ромашка» и «Ромашка» пишутся по-разному, romashka.ru — одинаково.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS domain_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_companies_domain_name
  ON companies(tenant_id, domain_name)
  WHERE domain_name <> '';
