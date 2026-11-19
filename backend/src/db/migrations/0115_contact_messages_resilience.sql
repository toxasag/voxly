-- Migration 0115: Ensure deal active state and un-delete Vasiliy master deal
UPDATE deals
SET deleted_at = NULL, status = 'active', updated_at = now()
WHERE id = 'f78d7425-31d3-4fa7-aa88-7de229abf89c' AND deleted_at IS NOT NULL;
