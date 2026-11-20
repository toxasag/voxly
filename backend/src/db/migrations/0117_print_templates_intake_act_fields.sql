-- 0117_print_templates_intake_act_fields.sql
-- Добавление полей tool_info, client_info, comments для актов приёма-передачи и пользовательских шаблонов

ALTER TABLE print_templates
  ADD COLUMN IF NOT EXISTS tool_info TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_info TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS comments TEXT NOT NULL DEFAULT '';
