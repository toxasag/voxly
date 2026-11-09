#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Утилита повторной отправки (resend) учетных данных доступа арендатора.
//
// Использование внутри контейнера backend:
//   docker exec getvoxly-backend-1 node scripts/resend-tenant-credentials.mjs --slug bankrotstvo
//
// Параметры:
//   --slug <slug>          (по умолчанию: bankrotstvo)
//   --email <email>        (по умолчанию: email владельца тенанта)
//   --password <password>  (по умолчанию: генерируется новый безопасный пароль)
// ---------------------------------------------------------------------------

import argon2 from "argon2";
import pg from "pg";

function parseArgs() {
  const args = process.argv.slice(2);
  let slug = "bankrotstvo";
  let email;
  let password;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--slug" && args[i + 1]) {
      slug = args[++i];
    } else if (arg === "--email" && args[i + 1]) {
      email = args[++i];
    } else if (arg === "--password" && args[i + 1]) {
      password = args[++i];
    }
  }

  return { slug, email, password };
}

function generateStrongPassword(length = 12) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function main() {
  const { slug, email, password: providedPassword } = parseArgs();

  console.log(`[ResendCredentials] Запуск процедуры повторной отправки доступов...`);
  console.log(`[ResendCredentials] Поиск тенанта со слагом: "${slug}"`);

  // Подключение к PostgreSQL
  const connectionString =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://getvoxly:getvoxly@getvoxly-db-1:5432/getvoxly";

  const pool = new pg.Pool({ connectionString });

  try {
    const tenantRes = await pool.query(
      `SELECT id, name, slug, status FROM tenants WHERE slug = $1`,
      [slug],
    );

    if (tenantRes.rows.length === 0) {
      console.error(`[ResendCredentials] ОШИБКА: Тенант со слагом "${slug}" не найден.`);
      process.exit(1);
    }

    const tenant = tenantRes.rows[0];
    console.log(`[ResendCredentials] Найден тенант: ${tenant.name} (ID: ${tenant.id}, статус: ${tenant.status})`);

    let userRes;
    if (email) {
      userRes = await pool.query(
        `SELECT id, email, name, role FROM users WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL`,
        [tenant.id, email],
      );
    } else {
      userRes = await pool.query(
        `SELECT id, email, name, role FROM users WHERE tenant_id = $1 AND role = 'owner' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
        [tenant.id],
      );
      if (userRes.rows.length === 0) {
        userRes = await pool.query(
          `SELECT id, email, name, role FROM users WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
          [tenant.id],
        );
      }
    }

    if (userRes.rows.length === 0) {
      console.error(`[ResendCredentials] ОШИБКА: Пользователь/администратор для тенанта "${slug}" не найден.`);
      process.exit(1);
    }

    const user = userRes.rows[0];
    console.log(`[ResendCredentials] Найден администратор: ${user.name} <${user.email}> (роль: ${user.role})`);

    // Генерация пароля
    const plainPassword = providedPassword || generateStrongPassword(12);
    const passwordHash = await argon2.hash(plainPassword);

    // Обновление хэша пароля
    await pool.query(
      `UPDATE users SET password_hash = $1, activated_at = COALESCE(activated_at, now()), updated_at = now() WHERE id = $2`,
      [passwordHash, user.id],
    );
    console.log(`[ResendCredentials] Хэш пароля успешно обновлен в БД.`);

    // Импортируем скомпилированный EmailService
    const { EmailService } = await import("../dist/services/email.service.js");

    console.log(`[ResendCredentials] Отправка приветственного письма с учетными данными на ${user.email}...`);

    const sendResult = await EmailService.sendTenantCredentialsEmail({
      to: user.email,
      subdomain: tenant.slug,
      companyName: tenant.name,
      adminName: user.name,
      loginEmail: user.email,
      password: plainPassword,
    });

    if (!sendResult.sent) {
      console.error(`[ResendCredentials] ОШИБКА отправки письма:`, sendResult.error);
      process.exit(1);
    }

    console.log(`================================================================`);
    console.log(`[ResendCredentials] УСПЕШНО ДОСТАВЛЕНО!`);
    console.log(`Тенант:         ${tenant.name} (${tenant.slug})`);
    console.log(`Адрес портала:  https://${tenant.slug}.getvoxly.ru`);
    console.log(`Логин (email):  ${user.email}`);
    console.log(`Сгенерир. пароль: ${plainPassword}`);
    console.log(`Message-ID:     ${sendResult.messageId}`);
    console.log(`================================================================`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[ResendCredentials] Фатальная ошибка:", err);
  process.exit(1);
});
