-- =============================================================================
-- 0031: Таблицы биллинга платформы: подписки (subscriptions), платежи (billing_payments)
-- и безопасная атомарная последовательность счетов Robokassa (robokassa_inv_id_seq).
-- =============================================================================

-- 1. Атомарный генератор номеров счетов для Robokassa (исключает race conditions)
CREATE SEQUENCE IF NOT EXISTS robokassa_inv_id_seq START 100001;

-- 2. Таблица подписок тенанта на модули/тарифы SaaS
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,
  period_months INT NOT NULL DEFAULT 1,
  seats_included INT NOT NULL DEFAULT 10,
  extra_seats INT NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled', 'past_due')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_ends_at ON subscriptions(ends_at);

-- Включаем RLS с FORCE
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON subscriptions
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- 3. Таблица платежей Robokassa (эквайринг платформы)
CREATE TABLE IF NOT EXISTS billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  robokassa_inv_id INT NOT NULL UNIQUE,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  balance_applied_rub NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  product_code TEXT NOT NULL,
  period_months INT DEFAULT 1,
  description TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  fiscal_receipt JSONB DEFAULT NULL,
  paid_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_tenant_id ON billing_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_status ON billing_payments(status);
CREATE INDEX IF NOT EXISTS idx_billing_payments_robokassa_inv_id ON billing_payments(robokassa_inv_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_idempotency_key ON billing_payments(idempotency_key);

-- Включаем RLS с FORCE
ALTER TABLE billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_payments FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'billing_payments' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON billing_payments
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
