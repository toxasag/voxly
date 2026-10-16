-- =============================================================================
-- Seed: стартовый владелец тенанта (owner + platform_owner)
--
-- Телефон: +79855014040
-- E-mail:  anton@genadich.com
-- Пароль:  Vx!Adm2026#getvoxly
--
-- Хеш ниже сгенерирован argon2id той же библиотекой, что проверяет пароль
-- (backend argon2 ^0.41), и проверен парой verify(hash, password) = true /
-- verify(hash, "wrong") = false. Предыдущий хеш не соответствовал ни одному
-- известному паролю, из-за чего POST /auth/login возвращал 401 на проде.
-- =============================================================================

INSERT INTO tenants (id, name, slug, plan, status, created_at, updated_at)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Voxly Platform',
  -- Портал владельца платформы: https://voxly.getvoxly.ru
  'voxly',
  'enterprise',
  'active',
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- `activated_at` обязателен: все выборки входа (`findByEmail`, `findByPhone`,
-- `findById` в auth.service.ts) требуют `activated_at IS NOT NULL`, чтобы
-- приглашённый сотрудник без пароля не считался существующим пользователем. Без
-- этого поля сид создавал бы владельца, который не может войти.
INSERT INTO users (id, tenant_id, email, phone, name, role, password_hash, permissions, platform_role, activated_at, created_at, updated_at)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'anton@genadich.com',
  '+79855014040',
  'Антон',
  'owner',
  '$argon2id$v=19$m=65536,t=3,p=4$yFvrULcEQPIotBOxvy3h8Q$LYCwSLIzdkKXSfVlnV6+3U2rNugMYGSWYBIQghQ+Ch4',
  ARRAY[
    'contacts:read','contacts:write','contacts:delete',
    'companies:read','companies:write','companies:delete',
    'deals:read','deals:write',
    'tasks:read','tasks:write',
    'service_center:read','service_center:write',
    'finance:read','finance:write','finance:admin',
    'ai_bots:read','ai_bots:configure',
    'tenant:admin','billing:manage'
  ],
  'platform_owner',
  now(), now(), now()
)
-- Конфликт разрешается по первичному ключу, а не по `(tenant_id, phone)`.
--
-- Прежний вариант перестал работать после миграции 0008: она заменила
-- `UNIQUE (tenant_id, phone)` частичным индексом (`WHERE deleted_at IS NULL AND
-- phone <> ''`), чтобы уволенного сотрудника можно было пригласить снова под тем
-- же номером. `ON CONFLICT` требует ограничения, совпадающего по предикату,
-- поэтому запрос стал падать с `there is no unique or exclusion constraint
-- matching the ON CONFLICT specification`, и владелец на чистой установке не
-- создавался вовсе. Обнаружено при внедрении раннера миграций (M6.2.7).
--
-- `id` здесь фиксированный, а первичный ключ существует всегда и не зависит от
-- частичных индексов, поэтому такая цель конфликта устойчива к дальнейшим
-- изменениям уникальности телефона и e-mail.
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  password_hash = EXCLUDED.password_hash,
  permissions = EXCLUDED.permissions,
  platform_role = EXCLUDED.platform_role,
  -- Активная учётная запись обязана иметь пароль (CHECK
  -- `users_active_needs_password` из миграции 0008), а сид задаёт пароль, значит
  -- пользователь активен.
  activated_at = COALESCE(users.activated_at, now()),
  updated_at = now();

INSERT INTO installed_modules (tenant_id, slug, name, installed_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'service_center', 'Service Center', now()),
  ('a0000000-0000-0000-0000-000000000001', 'finance', 'Finance', now()),
  ('a0000000-0000-0000-0000-000000000001', 'ai_bots', 'AI Bots', now())
ON CONFLICT (tenant_id, slug) DO NOTHING;
