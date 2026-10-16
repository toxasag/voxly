-- =============================================================================
-- 0012: Подключённые аккаунты каналов связи
--
-- До этой миграции каналы (`telegram`, `whatsapp`, `max`, `avito`, `instagram`)
-- существовали только как тарифные позиции `marketplace_modules`: подключить
-- канал в маркетплейсе было можно, но хранить сами аккаунты — негде. Страницы
-- `/integrations/*` требуют список подключений, поэтому таблица появляется здесь.
--
-- Одна таблица на все каналы, а не пять отдельных: набор полей у них совпадает
-- (внешний идентификатор, отображаемое имя, статус соединения, дата привязки), а
-- различия — в способе авторизации, который лежит в `credentials JSONB`. Пять
-- таблиц с одинаковой структурой означали бы пять почти идентичных сервисов и
-- пять веток в `MODULE_TABLES`.
--
-- Идемпотентна: безопасна к повторному запуску.
-- =============================================================================

CREATE TABLE IF NOT EXISTS channel_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Слаг канала: совпадает со слагом модуля в `marketplace_modules`, поэтому
  -- гейт `requireModule` и очистка данных при отключении работают по одному
  -- значению. CHECK, а не FK на `marketplace_modules(slug)`: там нет уникального
  -- индекса по slug отдельно от каталога, и список закрыт на уровне приложения.
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'whatsapp', 'max', 'avito', 'instagram')),

  -- Отображаемое имя, которое задаёт пользователь: «Основной номер», «Магазин».
  label TEXT NOT NULL,

  -- Идентификатор аккаунта на стороне канала: @username, номер телефона, id
  -- профиля Avito. Формат различается, поэтому TEXT без дополнительных проверок.
  external_id TEXT NOT NULL,

  -- Состояние соединения. `pending` — аккаунт создан, но авторизация не
  -- завершена: это исходное состояние, а не ошибка, поэтому оно отделено от
  -- `error`.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'error', 'disabled')),

  -- Текст последней ошибки соединения — показывается в таблице подключений,
  -- иначе «Требуется авторизация» не объясняет причину.
  status_message TEXT NOT NULL DEFAULT '',

  -- Токены и параметры авторизации. JSONB, потому что набор полей зависит от
  -- канала (bot token у Telegram, номер и сессия у WhatsApp).
  --
  -- ВАЖНО: значения наружу не отдаются — сервис никогда не выбирает эту колонку
  -- в DTO. Хранение секретов в открытом виде остаётся долгом (см. ROADMAP
  -- M7.5.4): шифрование на уровне БД требует ключа, которого в проекте пока нет.
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Момент последнего успешного обмена с каналом: по нему видно «в сети» это
  -- подключение или молчит с прошлой недели.
  last_sync_at TIMESTAMPTZ,

  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Мягкое удаление: те же правила, что у остальных данных модулей. Отключение
  -- канала в маркетплейсе помечает его аккаунты удалёнными, повторное включение
  -- в течение 30 дней возвращает их (см. ModuleDataService).
  deleted_at TIMESTAMPTZ
);

-- Один и тот же аккаунт нельзя привязать дважды: иначе сообщения приходили бы в
-- два подключения, а тариф считал бы два аккаунта. Частичный индекс по живым
-- строкам — удалённое подключение не должно мешать привязать тот же аккаунт снова.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_accounts_unique_external
  ON channel_accounts (tenant_id, channel, external_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_channel_accounts_tenant_channel
  ON channel_accounts (tenant_id, channel)
  WHERE deleted_at IS NULL;

-- updated_at: тот же триггер, что у остальных таблиц (см. schema.sql §7).
DROP TRIGGER IF EXISTS trg_channel_accounts_updated_at ON channel_accounts;
CREATE TRIGGER trg_channel_accounts_updated_at
  BEFORE UPDATE ON channel_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: те же правила, что у остальных данных арендатора
-- -----------------------------------------------------------------------------
-- FORCE обязателен: без него владелец таблицы игнорирует политику (см.
-- комментарий в schema.sql §8).
ALTER TABLE channel_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON channel_accounts;
CREATE POLICY tenant_isolation ON channel_accounts
  USING (tenant_id = current_tenant_id() OR platform_scope())
  WITH CHECK (tenant_id = current_tenant_id());

-- -----------------------------------------------------------------------------
-- Права app_user
-- -----------------------------------------------------------------------------
-- Приложение подключается ролью без прав по умолчанию (миграция 0002), поэтому
-- каждая новая таблица требует явного GRANT — иначе первый же запрос отдаёт
-- `permission denied for table`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON channel_accounts TO app_user';
  END IF;
END;
$$;
