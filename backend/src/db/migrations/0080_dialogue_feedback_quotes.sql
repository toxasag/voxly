-- Добавление структурированных цитат из диалога (Quote Selection UX) в обратную связь обучения
ALTER TABLE agent_dialogue_feedbacks
  ADD COLUMN IF NOT EXISTS selected_quotes JSONB DEFAULT '[]'::jsonb;
