-- Grandfather existing AiAgent rows into paid ai_agent addon seats.
-- Runtime also raises slots lazily; this migration covers tenants who already have agents
-- so they are not blocked the moment the create-gate ships.

INSERT INTO "Addon" ("id", "tenantId", "type", "config", "activeUntil", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  a."tenantId",
  'ai_agent',
  jsonb_build_object('agentSlots', a.cnt),
  NOW() + INTERVAL '10 years',
  'active',
  NOW(),
  NOW()
FROM (
  SELECT "tenantId", COUNT(*)::int AS cnt
  FROM "AiAgent"
  WHERE "status" <> 'archived'
  GROUP BY "tenantId"
) a
WHERE NOT EXISTS (
  SELECT 1 FROM "Addon" x
  WHERE x."tenantId" = a."tenantId" AND x."type" = 'ai_agent'
);

-- Raise seats if an ai_agent addon already exists but is short of active agents
UPDATE "Addon" ad
SET
  "config" = jsonb_set(
    COALESCE(ad."config", '{}'::jsonb),
    '{agentSlots}',
    to_jsonb(GREATEST(
      COALESCE((ad."config"->>'agentSlots')::int, 0),
      sub.cnt
    ))
  ),
  "status" = 'active',
  "activeUntil" = GREATEST(ad."activeUntil", NOW() + INTERVAL '10 years'),
  "updatedAt" = NOW()
FROM (
  SELECT "tenantId", COUNT(*)::int AS cnt
  FROM "AiAgent"
  WHERE "status" <> 'archived'
  GROUP BY "tenantId"
) sub
WHERE ad."tenantId" = sub."tenantId"
  AND ad."type" = 'ai_agent'
  AND COALESCE((ad."config"->>'agentSlots')::int, 0) < sub.cnt;
