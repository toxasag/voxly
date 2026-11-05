-- 0075_equipment_models_brand_relation.sql
-- Establish relational 1:N link between equipment_models and equipment_brands
-- with ON DELETE CASCADE and tenant isolation.

-- 1. Add brand_id to equipment_models
ALTER TABLE equipment_models
  ADD COLUMN IF NOT EXISTS brand_id UUID;

-- 2. Backfill brand_id for existing rows based on brand_name matching equipment_brands
UPDATE equipment_models em
SET brand_id = eb.id
FROM equipment_brands eb
WHERE em.tenant_id = eb.tenant_id
  AND lower(btrim(em.brand_name)) = lower(btrim(eb.name))
  AND em.brand_id IS NULL;

-- 3. If any model has brand_name that doesn't exist in equipment_brands yet, create the brand and link
INSERT INTO equipment_brands (tenant_id, name)
SELECT DISTINCT em.tenant_id, btrim(em.brand_name)
FROM equipment_models em
WHERE em.brand_id IS NULL
  AND btrim(em.brand_name) <> ''
ON CONFLICT (tenant_id, name) DO NOTHING;

UPDATE equipment_models em
SET brand_id = eb.id
FROM equipment_brands eb
WHERE em.tenant_id = eb.tenant_id
  AND lower(btrim(em.brand_name)) = lower(btrim(eb.name))
  AND em.brand_id IS NULL;

-- 4. For any model with empty brand_name, create/link a fallback 'Универсальный' brand if needed
DO $$
DECLARE
  rec RECORD;
  default_brand_id UUID;
BEGIN
  FOR rec IN SELECT DISTINCT tenant_id FROM equipment_models WHERE brand_id IS NULL LOOP
    INSERT INTO equipment_brands (tenant_id, name)
    VALUES (rec.tenant_id, 'Универсальный')
    ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO default_brand_id;

    UPDATE equipment_models
    SET brand_id = default_brand_id,
        brand_name = 'Универсальный'
    WHERE tenant_id = rec.tenant_id AND brand_id IS NULL;
  END LOOP;
END $$;

-- 5. Add Foreign Key constraint
ALTER TABLE equipment_models
  DROP CONSTRAINT IF EXISTS fk_equipment_models_brand;

ALTER TABLE equipment_models
  ADD CONSTRAINT fk_equipment_models_brand
  FOREIGN KEY (brand_id) REFERENCES equipment_brands(id) ON DELETE CASCADE;

-- 6. Ensure brand_id is NOT NULL
ALTER TABLE equipment_models
  ALTER COLUMN brand_id SET NOT NULL;

-- 7. Add Unique index preventing duplicate model per brand per tenant (case-insensitive)
DROP INDEX IF EXISTS uq_model_per_brand_tenant;
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_per_brand_tenant
  ON equipment_models (tenant_id, brand_id, lower(name));

-- 8. Add index for fast lookup by tenant and brand
CREATE INDEX IF NOT EXISTS idx_equipment_models_tenant_brand
  ON equipment_models (tenant_id, brand_id);
