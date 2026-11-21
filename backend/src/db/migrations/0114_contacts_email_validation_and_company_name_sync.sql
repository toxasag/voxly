-- =============================================================================
-- Migration 0114: Email validation constraint and company name synchronization
-- =============================================================================

-- 1. Сначала переносим случайно записанные в email названия компаний (ООО, ИП, ЗАО, АО и др. без @)
-- в company_name, если у контакта оно ещё не заполнено нормальным именем
UPDATE companies comp
SET name = c.email
FROM contacts c
WHERE c.company_id = comp.id
  AND c.tenant_id = comp.tenant_id
  AND c.email IS NOT NULL
  AND c.email != ''
  AND c.email !~* '@'
  AND (comp.name LIKE 'Компания ИНН %' OR comp.name = '');

UPDATE contacts c
SET company_name = c.email
WHERE c.email IS NOT NULL
  AND c.email != ''
  AND c.email !~* '@'
  AND (c.company_name LIKE 'Компания ИНН %' OR c.company_name = '');

-- 2. Синхронизируем denormalized c.company_name со свежими названиями из companies
UPDATE contacts c
SET company_name = comp.name
FROM companies comp
WHERE c.company_id = comp.id
  AND c.tenant_id = comp.tenant_id
  AND comp.name IS NOT NULL
  AND comp.name != ''
  AND comp.name NOT LIKE 'Компания ИНН %'
  AND (c.company_name LIKE 'Компания ИНН %' OR c.company_name != comp.name);

-- 3. Очищаем все оставшиеся невалидные email-адреса
UPDATE contacts
SET email = NULL
WHERE email IS NOT NULL
  AND email != ''
  AND email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$';

-- 4. Устанавливаем строгий CHECK constraint на формат email
ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS chk_contacts_email;

ALTER TABLE contacts
  ADD CONSTRAINT chk_contacts_email
  CHECK (email IS NULL OR email = '' OR email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$');
