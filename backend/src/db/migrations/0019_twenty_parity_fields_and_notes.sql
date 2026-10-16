-- =============================================================================
-- Паритет полей и заметок со стандартными объектами Twenty.
--
-- Источник: packages/twenty-server/src/modules/{person,company}/standard-objects/
-- *.workspace-entity.ts и utils/view-field/compute-standard-*-view-fields.util.ts
-- в исходниках Twenty. Переносится состав полей и их группировка на карточке,
-- а не типы: у Twenty composite-поля (LinksMetadata, AddressMetadata,
-- CurrencyMetadata, ActorMetadata) собираются метаданными объекта, у нас те же
-- данные лежат обычными колонками — карточка читает их напрямую и не требует
-- слоя метаданных.
-- =============================================================================

-- Контакты: группы social и system --------------------------------------------

-- Twenty: person.linkedinLink (группа social на record page). Один URL вместо
-- их LinksMetadata с additionalLinks: второй профиль LinkedIn у человека —
-- редкость, а JSONB здесь заставил бы карточку разбирать структуру ради строки.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_link TEXT NOT NULL DEFAULT '';

-- Twenty: person.createdBy (ActorMetadata, группа system). Кто создал запись:
-- контакт может появиться от AI-агента из входящего сообщения, и в карточке
-- это нужно отличать от ручного ввода. NULL = создано системой/импортом.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Компании: группы business, contact и system ---------------------------------

-- Twenty: company.annualRevenue (CurrencyMetadata, группа business).
-- NUMERIC, а не float: у Twenty ту же роль играет amountMicros — целое число
-- микроединиц, защита от ошибок округления в деньгах.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS annual_revenue NUMERIC(18, 2);

-- Twenty: company.linkedinLink (группа contact).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS linkedin_link TEXT NOT NULL DEFAULT '';

-- Twenty: company.address (AddressMetadata, группа contact) — их подполя
-- addressCity / addressStreet1 / addressCountry / addressPostcode.
-- legal_address оставлен как есть: это юридический адрес из реквизитов, другое
-- по смыслу поле, и совмещать их значило бы терять одно из двух.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_city TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_street TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_country TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_postcode TEXT NOT NULL DEFAULT '';

-- Twenty: company.createdBy (ActorMetadata, группа system).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Заметки ---------------------------------------------------------------------

-- Twenty: объект Note + junction-таблица NoteTarget, где у цели ровно один
-- непустой FK (personId / companyId / opportunityId). Полиморфную связь
-- повторяем тремя nullable FK с CHECK на ровно одну заполненную: это
-- сохраняет ссылочную целостность, которой не даёт пара (target_type, target_id).
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT notes_single_target CHECK (
    (contact_id IS NOT NULL)::int
    + (company_id IS NOT NULL)::int
    + (deal_id IS NOT NULL)::int = 1
  )
);

-- Индексы под запрос «заметки этой записи, свежие сверху»: карточка всегда
-- фильтрует по tenant_id + одной цели и сортирует по created_at DESC.
CREATE INDEX IF NOT EXISTS idx_notes_contact ON notes(tenant_id, contact_id, created_at DESC)
  WHERE deleted_at IS NULL AND contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_company ON notes(tenant_id, company_id, created_at DESC)
  WHERE deleted_at IS NULL AND company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_deal ON notes(tenant_id, deal_id, created_at DESC)
  WHERE deleted_at IS NULL AND deal_id IS NOT NULL;

-- RLS теми же функциями и тем же именем политики, что у остальных таблиц
-- тенанта (0002_rls_enforce.sql): FORCE обязателен — без него владелец таблицы
-- игнорирует политику, и заметки стали бы единственной таблицей CRM, читаемой
-- между тенантами.
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON notes;
CREATE POLICY tenant_isolation ON notes
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

DROP TRIGGER IF EXISTS trg_notes_updated_at ON notes;
CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
