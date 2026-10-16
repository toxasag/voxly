-- Системные этапы воронки: первый, «успех» и «провал».
--
-- До этого «Новый лид» ничем не отличался от пользовательского этапа: его можно
-- было переименовать, перекрасить, передвинуть и удалить, хотя на нём стоит
-- вход в воронку. У «успеха» и «провала» защита была только на удаление —
-- перестановка их в середину доски разрешалась, и порядок терял смысл
-- (закрывающие этапы должны быть в конце).
--
-- Флаг, а не вычисление по sort_order: sort_order меняется перестановками, и
-- «первый» перестал бы совпадать с входом в воронку после первого же обмена.

ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- Уже существующие воронки: помечаем терминальные этапы.
UPDATE stages SET is_system = true WHERE is_won = true OR is_lost = true;

-- И первый этап каждой воронки — вход.
UPDATE stages s
SET is_system = true
WHERE s.id IN (
  SELECT DISTINCT ON (pipeline_id) id
  FROM stages
  ORDER BY pipeline_id, sort_order ASC, created_at ASC
);

-- Цвета системных этапов по канону: вход янтарный, успех зелёный, провал красный.
UPDATE stages SET color = 'emerald' WHERE is_won = true;
UPDATE stages SET color = 'rose' WHERE is_lost = true;
UPDATE stages SET color = 'amber'
WHERE is_system = true AND is_won = false AND is_lost = false;

-- Порядок закрывающих этапов: успех предпоследний, провал последний.
-- Номера берутся с запасом от максимума пользовательских, чтобы не совпасть.
WITH bounds AS (
  SELECT pipeline_id, MAX(sort_order) AS max_order
  FROM stages
  WHERE is_won = false AND is_lost = false
  GROUP BY pipeline_id
)
UPDATE stages s
SET sort_order = b.max_order + CASE WHEN s.is_won THEN 1 ELSE 2 END
FROM bounds b
WHERE s.pipeline_id = b.pipeline_id AND (s.is_won = true OR s.is_lost = true);
