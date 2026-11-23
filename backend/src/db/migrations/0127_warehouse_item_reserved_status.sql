-- Up Migration
ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS reserved BOOLEAN NOT NULL DEFAULT false;

-- Initial sync from existing active reservations
UPDATE warehouse_items wi
SET reserved = true
WHERE EXISTS (
  SELECT 1 FROM warehouse_reservations wr
  WHERE wr.tenant_id = wi.tenant_id AND wr.item_id = wi.id AND wr.status = 'reserved' AND wr.quantity > 0
);
