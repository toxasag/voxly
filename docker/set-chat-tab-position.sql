-- Voxly: place «Чат» tab right after Home (position 15) on Person/Opportunity layouts.
-- Home=10, Chat=15, Timeline=20, …
UPDATE core."pageLayoutTab" t
SET position = 15
FROM core."pageLayout" pl
WHERE pl.id = t."pageLayoutId"
  AND t.title = 'Чат'
  AND t."deletedAt" IS NULL
  AND (pl.name ILIKE '%Opportunity%' OR pl.name ILIKE '%Person%')
  AND t.position IS DISTINCT FROM 15;
