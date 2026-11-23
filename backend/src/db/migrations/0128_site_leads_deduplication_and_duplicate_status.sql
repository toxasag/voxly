-- Migration 0128: Site leads deduplication and merge vertexsiam duplicate deals

DO $$
DECLARE
  v_vertex_primary_id UUID := 'a9dae40a-c037-4fe8-8e41-7ebad6c9d198';
  v_vertex_dup_id UUID := '2d4a26b8-7660-4b35-b069-4adcc535267b';
  v_dup_desc TEXT;
BEGIN
  -- 1. Merge duplicate deal 2d4a26b8 into primary deal a9dae40a for contact Ruslan (+66962095187, vertexsiam)
  IF EXISTS (SELECT 1 FROM deals WHERE id = v_vertex_dup_id) AND EXISTS (SELECT 1 FROM deals WHERE id = v_vertex_primary_id) THEN
    SELECT description INTO v_dup_desc FROM deals WHERE id = v_vertex_dup_id;

    -- Append second form details to primary deal if not already appended
    IF v_dup_desc IS NOT NULL AND v_dup_desc != '' THEN
      UPDATE deals
      SET description = description || E'\n\n---\nПовторная заявка (Modal: Book Audit):\n' || v_dup_desc,
          updated_at = now()
      WHERE id = v_vertex_primary_id
        AND description NOT LIKE '%Modal: Book Audit%';
    END IF;

    -- Re-link messages from duplicate deal to primary deal
    UPDATE deal_messages
    SET deal_id = v_vertex_primary_id
    WHERE deal_id = v_vertex_dup_id;

    -- Re-link activities from duplicate deal to primary deal
    UPDATE contact_activities
    SET deal_id = v_vertex_primary_id
    WHERE deal_id = v_vertex_dup_id;

    -- Mark duplicate deal as duplicate and link to primary deal
    UPDATE deals
    SET status = 'duplicate',
        custom_fields = jsonb_set(
          jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{status}', '"duplicate"'),
          '{merged_into}',
          to_jsonb(v_vertex_primary_id::text)
        ),
        updated_at = now()
    WHERE id = v_vertex_dup_id;
  END IF;

  -- 2. Clean up Tilda test duplicate deals (5d5fb56a) if present
  IF EXISTS (SELECT 1 FROM deals WHERE id = '2f899422-d089-415a-80ce-a2661cf8b284') AND EXISTS (SELECT 1 FROM deals WHERE id = '386de01e-84be-4ad0-9753-c6758913008c') THEN
    UPDATE deal_messages
    SET deal_id = '386de01e-84be-4ad0-9753-c6758913008c'
    WHERE deal_id = '2f899422-d089-415a-80ce-a2661cf8b284';

    UPDATE contact_activities
    SET deal_id = '386de01e-84be-4ad0-9753-c6758913008c'
    WHERE deal_id = '2f899422-d089-415a-80ce-a2661cf8b284';

    UPDATE deals
    SET status = 'duplicate',
        custom_fields = jsonb_set(
          jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{status}', '"duplicate"'),
          '{merged_into}',
          '"386de01e-84be-4ad0-9753-c6758913008c"'
        ),
        updated_at = now()
    WHERE id = '2f899422-d089-415a-80ce-a2661cf8b284';
  END IF;
END $$;
