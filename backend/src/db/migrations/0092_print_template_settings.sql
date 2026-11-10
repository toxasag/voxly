-- 0092_print_template_settings.sql
-- Настройки конструктора печатных форм и синхронизация нумерации

CREATE TABLE IF NOT EXISTS print_template_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Общие: реквизиты и брендинг
  company_name TEXT NOT NULL DEFAULT 'Ремонт инструмента ИП Сагайдак А.Г.',
  company_address TEXT NOT NULL DEFAULT 'Москва 3й проезд Марьиной рощи 40с1, 2 этаж, каб. 214',
  company_phone TEXT NOT NULL DEFAULT '+7 977 628 20 49',
  company_email TEXT NOT NULL DEFAULT '',
  company_website TEXT NOT NULL DEFAULT 'РЕМОНТ-ИНСТРУМЕНТ.РФ',
  company_inn TEXT NOT NULL DEFAULT '',
  company_ogrn TEXT NOT NULL DEFAULT '',
  working_hours TEXT NOT NULL DEFAULT 'Пн-Пт 10:00-19:00',
  logo_url TEXT NOT NULL DEFAULT '/service-logo.png',

  -- Нумерация
  numbering_format TEXT NOT NULL DEFAULT 'compact', -- 'compact' (№0005) или 'full' (ЗН-2026-0005)
  numbering_prefix TEXT NOT NULL DEFAULT '№',

  -- Акт приемки
  intake_terms TEXT NOT NULL DEFAULT '1. Сервисный центр производит диагностику и устранение заявленных дефектов. При обнаружении скрытых повреждений стоимость и сроки согласуются дополнительно.
2. Сервисный центр не несет ответственности за возможную потерю данных на внутренних накопителях.
3. Срок бесплатного хранения готового оборудования — 14 дней с момента уведомления клиента.',
  intake_pdn_consent TEXT NOT NULL DEFAULT 'Заказчик подтверждает согласие на обработку персональных данных в соответствии с ФЗ №152-ФЗ для исполнения договора оказания услуг.',
  show_equipment_serial BOOLEAN NOT NULL DEFAULT true,
  show_appearance BOOLEAN NOT NULL DEFAULT true,
  show_package_contents BOOLEAN NOT NULL DEFAULT true,
  show_defect_description BOOLEAN NOT NULL DEFAULT true,
  show_estimated_cost BOOLEAN NOT NULL DEFAULT true,
  show_client_tear_off_ticket BOOLEAN NOT NULL DEFAULT true,
  show_intake_signatures BOOLEAN NOT NULL DEFAULT true,

  -- Акт выполненных работ
  warranty_terms TEXT NOT NULL DEFAULT '1. Гарантийный срок на выполненные работы и установленные оригинальные запасные части составляет 30 календарных дней со дня выдачи изделия.
2. Гарантия не распространяется при наличии следов попадания влаги, механических повреждений, нарушения пломб или неквалифицированного вмешательства.',
  return_policy TEXT NOT NULL DEFAULT 'Работы выполнены в полном объеме, в установленный срок и с надлежащим качеством. Оборудование протестировано в присутствии Заказчика. Претензий по качеству и комплектности не имею.',
  show_works_table BOOLEAN NOT NULL DEFAULT true,
  show_parts_table BOOLEAN NOT NULL DEFAULT true,
  show_completion_signatures BOOLEAN NOT NULL DEFAULT true,
  show_completion_stamp BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_template_settings_tenant UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_print_template_settings_tenant ON print_template_settings(tenant_id);

ALTER TABLE print_template_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_template_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS print_template_settings_isolation ON print_template_settings;
CREATE POLICY print_template_settings_isolation ON print_template_settings
  FOR ALL
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());
