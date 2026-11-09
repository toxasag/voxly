#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Утилита повторной отправки (resend) учетных данных доступа арендатора.
//
// Использование:
//   node dist/scripts/resend-tenant-credentials.js --slug bankrotstvo
//   node dist/scripts/resend-tenant-credentials.js --slug bankrotstvo --email velengurin88@yandex.ru --password SecretPassword123
// ---------------------------------------------------------------------------

import argon2 from "argon2";
import { query, queryOne } from "../src/db/client.js";
import { EmailService } from "../src/services/email.service.js";

function parseArgs(): {
  slug: string;
  email?: string;
  password?: string;
} {
  const args = process.argv.slice(2);
  let slug = "bankrotstvo";
  let email: string | undefined;
  let password: string | undefined;

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

function generatePassword(length = 12): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function main() {
  const { slug, email, password: providedPassword } = parseArgs();

  console.log(`[ResendCredentials] Поиск тенанта со слагом: "${slug}"...`);

  const tenant = await queryOne<{
    id: string;
    name: string;
    slug: string;
    status: string;
  }>(
    `SELECT id, name, slug, status FROM tenants WHERE slug = $1`,
    [slug],
  );

  if (!tenant) {
    console.error(`[ResendCredentials] ОШИБКА: Тенант со слагом "${slug}" не найден.`);
    process.exit(1);
  }

  console.log(`[ResendCredentials] Найден тенант: ${tenant.name} (ID: ${tenant.id}, статус: ${tenant.status})`);

  let user: {
    id: string;
    email: string;
    name: string;
    role: string;
  } | null = null;

  if (email) {
    user = await queryOne(
      `SELECT id, email, name, role FROM users WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL`,
      [tenant.id, email],
    );
  } else {
    // Находим главного администратора (owner) тенанта
    user = await queryOne(
      `SELECT id, email, name, role FROM users WHERE tenant_id = $1 AND role = 'owner' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
      [tenant.id],
    );
    if (!user) {
      user = await queryOne(
        `SELECT id, email, name, role FROM users WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
        [tenant.id],
      );
    }
  }

  if (!user) {
    console.error(`[ResendCredentials] ОШИБКА: Пользователь для тенанта "${slug}" не найден.`);
    process.exit(1);
  }

  console.log(`[ResendCredentials] Найден администратор: ${user.name} <${user.email}> (роль: ${user.role})`);

  // Генерируем или используем переданный пароль
  const plainPassword = providedPassword || generatePassword(12);
  const passwordHash = await argon2.hash(plainPassword);

  // Обновляем хэш пароля в базе данных
  await query(
    `UPDATE users SET password_hash = $1, activated_at = COALESCE(activated_at, now()), updated_at = now() WHERE id = $2`,
    [passwordHash, user.id],
  );

  console.log(`[ResendCredentials] Хэш пароля успешно обновлен в БД.`);

  // Отправляем приветственное письмо через EmailService
  console.log(`[ResendCredentials] Отправка приветственного письма на ${user.email}...`);

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
  console.log(`Новый пароль:   ${plainPassword}`);
  console.log(`Message-ID:     ${sendResult.messageId}`);
  console.log(`================================================================`);
}

main().catch((err) => {
  console.error("[ResendCredentials] Фатальная ошибка:", err);
  process.exit(1);
});
