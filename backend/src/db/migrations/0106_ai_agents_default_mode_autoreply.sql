-- 0106_ai_agents_default_mode_autoreply.sql
-- Изменение дефолтного режима работы AI-агентов на 'autoreply'
-- (ранее по умолчанию выставлялся 'suggester', блокирующий автоответы в виджетах).

ALTER TABLE ai_agents ALTER COLUMN mode SET DEFAULT 'autoreply';
