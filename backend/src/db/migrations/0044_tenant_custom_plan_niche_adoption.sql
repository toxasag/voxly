-- =============================================================================
-- Migration 0044: Individual plan pricing, niche, and adoption metadata for tenants
-- =============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS custom_price_rubles INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_plan_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS business_niche TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_notes TEXT DEFAULT NULL;

COMMENT ON COLUMN tenants.custom_price_rubles IS 'Индивидуальная цена тарифа в рублях/мес (0 для бесплатного, NULL для стандартной цены плана)';
COMMENT ON COLUMN tenants.custom_plan_name IS 'Кастомное название тарифа, назначенное суперадмином (например, «Партнёрский», «VIP»)';
COMMENT ON COLUMN tenants.business_niche IS 'Сфера деятельности/ниша клиента (сервисный центр, юристы, автосервис и т.д.)';
COMMENT ON COLUMN tenants.custom_notes IS 'Внутренние заметки менеджера платформы о клиенте и допродажах';
