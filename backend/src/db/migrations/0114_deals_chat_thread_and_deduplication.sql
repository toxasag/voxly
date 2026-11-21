-- Migration 0114: Deals chat thread ID, deal status, contacts generated name, and messenger fields

-- 1. Deals chat_thread_id and status columns for idempotency and lifecycle tracking
ALTER TABLE deals ADD COLUMN IF NOT EXISTS chat_thread_id TEXT;
CREATE INDEX IF NOT EXISTS idx_deals_chat_thread_id ON deals (tenant_id, chat_thread_id) WHERE chat_thread_id IS NOT NULL;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals (tenant_id, status);

-- 2. Contacts generated full name column for direct name queries and API compatibility
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS name TEXT GENERATED ALWAYS AS (NULLIF(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')) STORED;

-- 3. Contacts dedicated messenger columns
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS messenger_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS messenger_name TEXT;

-- 4. Populate chat_thread_id on existing deals from custom_fields where available
UPDATE deals
SET chat_thread_id = custom_fields->>'chat_id'
WHERE chat_thread_id IS NULL AND custom_fields->>'chat_id' IS NOT NULL;

-- 5. Data fix for remtoua Vasiliy duplicate deals and contact linking
DO $$
BEGIN
  -- Link primary deal to real contact and set chat_thread_id
  UPDATE deals
  SET contact_id = '8c21d415-7fb3-49ae-99b9-034272bb73d7',
      chat_thread_id = '120520879',
      status = 'active',
      updated_at = now()
  WHERE id = 'f78d7425-31d3-4fa7-aa88-7de229abf89c';

  -- Mark duplicate deals as duplicate (preserving them in database without deletion)
  UPDATE deals
  SET status = 'duplicate',
      custom_fields = jsonb_set(
        jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{status}', '"duplicate"'),
        '{merged_into}',
        '"f78d7425-31d3-4fa7-aa88-7de229abf89c"'
      ),
      updated_at = now()
  WHERE id IN (
    '57999b0b-707a-4b02-be6c-80e92fd0749b',
    '65b01166-6997-4cf6-a120-ae9b80345b76',
    '90ec971c-c905-4f1c-b483-22487dd676dc'
  );

  -- Re-link messages from duplicate deals into the primary deal
  UPDATE deal_messages
  SET deal_id = 'f78d7425-31d3-4fa7-aa88-7de229abf89c'
  WHERE deal_id IN (
    '57999b0b-707a-4b02-be6c-80e92fd0749b',
    '65b01166-6997-4cf6-a120-ae9b80345b76',
    '90ec971c-c905-4f1c-b483-22487dd676dc'
  )
  AND NOT EXISTS (
    SELECT 1 FROM deal_messages dm2
    WHERE dm2.deal_id = 'f78d7425-31d3-4fa7-aa88-7de229abf89c'
      AND dm2.metadata->>'external_message_id' = deal_messages.metadata->>'external_message_id'
      AND dm2.metadata->>'external_message_id' IS NOT NULL
  );

  -- Update primary contact 8c21d415 with MAX credentials and messenger fields
  UPDATE contacts
  SET messenger_id = '120520879',
      messenger_name = 'Макс',
      channel = 'max',
      custom_fields = jsonb_set(
        jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{max_chat_id}', '"120520879"'),
        '{max_user_id}',
        '"134603146"'
      ),
      updated_at = now()
  WHERE id = '8c21d415-7fb3-49ae-99b9-034272bb73d7';

  -- Mark duplicate contacts with reference to primary contact
  UPDATE contacts
  SET custom_fields = jsonb_set(
        jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{is_duplicate}', 'true'),
        '{merged_into}',
        '"8c21d415-7fb3-49ae-99b9-034272bb73d7"'
      ),
      updated_at = now()
  WHERE id IN (
    'ec691cc2-faf4-40ce-8755-6a3d9bbb7e86',
    '407a5765-65c7-45ce-a4e3-bd73f5d3feed',
    '01f16b96-ec9c-4225-8250-82085b7b6df6',
    'e4062705-912e-4bf1-9228-af17c1567f8c'
  );
END $$;
