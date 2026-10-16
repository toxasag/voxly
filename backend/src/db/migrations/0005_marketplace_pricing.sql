-- =============================================================================
-- 0005: Тарифная модель маркетплейса и пробный период
--
-- Прежняя схема описывала тариф одним числом `price_monthly`, чего недостаточно:
--   * базовая CRM тарифицируется за пакет + доплата за сотрудников свыше 10;
--   * AI-агенты и каналы интеграций — за каждую подключённую единицу;
--   * сервисные модули — фиксированной суммой.
-- Поэтому вводится `billing_kind` и раздельные поля цен: считать доплату из
-- одного числа невозможно, а хранить формулу в коде означало бы, что цена в БД
-- и цена в интерфейсе могут разойтись.
--
-- Слаг `ai_bots` сознательно НЕ переименован в `ai_agents`: он уже используется
-- типом ModuleSlug, гейтом requireModule, компонентом <Guard> и строками
-- installed_modules у существующих арендаторов. Меняется только отображаемое
-- имя и модель тарификации.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Каталог: модель тарификации
-- -----------------------------------------------------------------------------

ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS billing_kind TEXT NOT NULL DEFAULT 'flat';

-- flat      — фиксированная сумма за модуль (Сервисный центр, Финансы)
-- per_seat  — пакет с включёнными местами + доплата за каждое сверх (базовая CRM)
-- per_unit  — сумма за каждую подключённую единицу (AI-агенты, каналы)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_modules_billing_kind') THEN
    ALTER TABLE marketplace_modules ADD CONSTRAINT marketplace_modules_billing_kind
      CHECK (billing_kind IN ('flat', 'per_seat', 'per_unit'));
  END IF;
END;
$$;

-- Базовая цена пакета. Для per_unit равна 0: там платят только за единицы.
ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS base_price NUMERIC NOT NULL DEFAULT 0;

-- Цена одной единицы: место сверх пакета (per_seat) или аккаунт/агент (per_unit).
ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0;

-- Сколько единиц уже входит в базовую цену (для per_seat — 10 пользователей).
ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS included_units INT NOT NULL DEFAULT 0;

-- Подпись единицы для интерфейса: «пользователь», «агент», «аккаунт».
ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS unit_label TEXT NOT NULL DEFAULT '';

-- Можно ли подключать несколько единиц. Отделено от billing_kind, потому что
-- per_unit-модуль в принципе может быть и одиночным.
ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS is_multi BOOLEAN NOT NULL DEFAULT false;

-- Группировка карточек в UI.
ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'integration';

-- Имя иконки lucide — чтобы соответствие «модуль → иконка» не дублировалось в
-- коде фронтенда для каждого нового канала.
ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT 'Puzzle';

-- Длительность пробного периода в днях. В БД, а не константой в коде: срок
-- может отличаться по модулям и меняться без пересборки.
ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS trial_days INT NOT NULL DEFAULT 14;

-- Особенности модуля для списка в карточке.
ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT '{}';

-- Порядок вывода: ядро первым, интеграции последними.
ALTER TABLE marketplace_modules
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 100;

-- -----------------------------------------------------------------------------
-- 2. Подключения арендатора: количество и пробный период
-- -----------------------------------------------------------------------------

-- Число подключённых единиц (агентов, аккаунтов). Для flat всегда 1.
ALTER TABLE installed_modules
  ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'installed_modules_quantity_positive') THEN
    ALTER TABLE installed_modules ADD CONSTRAINT installed_modules_quantity_positive
      CHECK (quantity >= 1);
  END IF;
END;
$$;

-- Окончание пробного периода. NULL = пробный период не применялся или истёк и
-- был снят вручную; сравнение с now() определяет активность.
ALTER TABLE installed_modules
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Существующим подключениям пробный период не выдаём: они установлены до
-- появления тарификации, и начислять им 14 дней «с сегодня» было бы неверно.

-- -----------------------------------------------------------------------------
-- 3. Каталог модулей и цен
-- -----------------------------------------------------------------------------
-- Прежние записи (Service Center 1990, Finance 2490, AI Bots 3990) остались с
-- английскими названиями и устаревшими ценами, поэтому UPSERT перезаписывает
-- их целиком, а не только добавляет новые строки.

INSERT INTO marketplace_modules
  (slug, name, description, price_monthly, billing_kind, base_price, unit_price,
   included_units, unit_label, is_multi, category, icon, trial_days, features, sort_order, is_available)
VALUES
  -- Ядро: 600 ₽ за пакет до 10 пользователей, далее +200 ₽ за сотрудника.
  ('core_crm', 'Базовая CRM',
   'Контакты, компании, сделки с Kanban-воронкой и хронологией общения.',
   600, 'per_seat', 600, 200, 10, 'пользователь', false, 'crm', 'Users', 14,
   ARRAY['Контакты и компании', 'Воронка сделок', 'Задачи', 'Хронология и чат'], 10, true),

  ('service_center', 'Сервисный центр',
   'Наряд-заказы, диагностика, учёт работ и запчастей.',
   500, 'flat', 500, 0, 0, '', false, 'service', 'Wrench', 14,
   ARRAY['Приёмка оборудования', 'Диагностика', 'Работы и запчасти', 'Печать квитанций'], 20, true),

  ('finance', 'Финансы и счета',
   'Управленческий учёт, кассы, счёта и отчёт о прибылях и убытках.',
   500, 'flat', 500, 0, 0, '', false, 'finance', 'Receipt', 14,
   ARRAY['Кассы и переводы', 'Журнал операций', 'Выставление счетов', 'Отчёт P&L'], 30, true),

  -- AI-агенты: 500 ₽ за каждого активного агента.
  ('ai_bots', 'AI-агенты',
   'AI-ассистенты для переписки: подсказки ответов и автоответы клиентам. Подключаются к Telegram, WhatsApp и MAX.',
   500, 'per_unit', 0, 500, 0, 'агент', true, 'ai', 'Bot', 14,
   ARRAY['Автоответы и подсказки', 'Шаблоны промптов', 'Выбор модели', 'Учёт токенов'], 40, true),

  -- Каналы: 500 ₽ за каждый подключённый аккаунт, мульти-аккаунт.
  ('telegram', 'Telegram',
   'Приём и отправка сообщений Telegram. Несколько аккаунтов в одном портале.',
   500, 'per_unit', 0, 500, 0, 'аккаунт', true, 'integration', 'Send', 14,
   ARRAY['Мульти-аккаунт', 'Вложения и медиа', 'Автоприветствие', 'История в сделке'], 50, true),

  ('whatsapp', 'WhatsApp',
   'Переписка WhatsApp внутри CRM. Несколько номеров в одном портале.',
   500, 'per_unit', 0, 500, 0, 'аккаунт', true, 'integration', 'MessageCircle', 14,
   ARRAY['Мульти-аккаунт', 'Вложения и медиа', 'Шаблоны сообщений', 'История в сделке'], 60, true),

  ('max', 'MAX',
   'Мессенджер MAX: приём и отправка сообщений. Несколько аккаунтов.',
   500, 'per_unit', 0, 500, 0, 'аккаунт', true, 'integration', 'Hash', 14,
   ARRAY['Мульти-аккаунт', 'Вложения', 'Автоответы', 'История в сделке'], 70, true),

  ('avito', 'Avito',
   'Сообщения и объявления Avito. Несколько аккаунтов в одном портале.',
   500, 'per_unit', 0, 500, 0, 'аккаунт', true, 'integration', 'Store', 14,
   ARRAY['Мульти-аккаунт', 'Чаты по объявлениям', 'Автоответы', 'Лид в сделку'], 80, true),

  ('instagram', 'Instagram',
   'Direct-переписка Instagram. Несколько аккаунтов в одном портале.',
   500, 'per_unit', 0, 500, 0, 'аккаунт', true, 'integration', 'Instagram', 14,
   ARRAY['Мульти-аккаунт', 'Direct и комментарии', 'Автоответы', 'Лид в сделку'], 90, true)

ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  billing_kind = EXCLUDED.billing_kind,
  base_price = EXCLUDED.base_price,
  unit_price = EXCLUDED.unit_price,
  included_units = EXCLUDED.included_units,
  unit_label = EXCLUDED.unit_label,
  is_multi = EXCLUDED.is_multi,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  trial_days = EXCLUDED.trial_days,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  is_available = EXCLUDED.is_available;

-- Названия в installed_modules — денормализованная копия для навигации;
-- приводим её к новым значениям каталога, иначе в сайдбаре остались бы
-- английские подписи у уже установленных модулей.
UPDATE installed_modules i
SET name = m.name
FROM marketplace_modules m
WHERE m.slug = i.slug AND i.name <> m.name;

-- app_user — непривилегированная роль пула (миграция 0002), права на новую
-- таблицу не наследуются автоматически.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT ON marketplace_modules TO app_user';
  END IF;
END;
$$;
