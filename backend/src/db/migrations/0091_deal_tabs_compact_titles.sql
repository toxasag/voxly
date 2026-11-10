-- 0090_deal_tabs_compact_titles.sql
-- Рефакторинг названий вкладок карточки сделки в page_layout_tabs:
-- «Сервисный центр» → «СЦ», «История контакта» → «История».

UPDATE page_layout_tabs
SET title = 'СЦ'
WHERE object_type = 'deal'
  AND tab_key = 'repairs'
  AND (title = 'Сервисный центр' OR title = 'Ремонты');

UPDATE page_layout_tabs
SET title = 'История'
WHERE object_type = 'deal'
  AND tab_key = 'contact-history'
  AND title = 'История контакта';
