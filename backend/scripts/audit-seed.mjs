import argon2 from "argon2";
import pg from "pg";
import { loadAuditRuntime } from "./audit-runtime.mjs";

const runtime = await loadAuditRuntime();

const client = new pg.Client({
  host: "127.0.0.1",
  port: 5432,
  database: runtime.database,
  user: "postgres",
});
const passwordHash = await argon2.hash("AuditLocal12345");
await client.connect();
try {
  await client.query("BEGIN");
  // Serialize repeats; the entire synthetic seed commits once or rolls back.
  await client.query("SELECT pg_advisory_xact_lock(9821347)");

  const tenants = [
    { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Audit Alpha", slug: "audit-alpha" },
    { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Audit Beta", slug: "audit-beta" },
  ];
  for (const tenant of tenants) {
    await client.query(
      `INSERT INTO tenants (id, name, slug, plan, status, trial_ends_at)
       VALUES ($1, $2, $3, 'pro', 'active', now() + interval '14 days')
       ON CONFLICT (id) DO NOTHING`,
      [tenant.id, tenant.name, tenant.slug],
    );
  }

  const users = [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01",
      tenantId: tenants[0].id,
      email: "owner@audit-alpha.test",
      name: "Алексей Владелец",
      role: "owner",
      permissions: [
        "contacts:read", "contacts:write", "contacts:delete",
        "companies:read", "companies:write", "companies:delete",
        "deals:read", "deals:write", "tasks:read", "tasks:write",
        "service_center:read", "service_center:write", "finance:read",
        "finance:write", "finance:admin", "ai_bots:read", "ai_bots:configure",
        "tenant:admin", "billing:manage",
      ],
    },
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02",
      tenantId: tenants[0].id,
      email: "manager@audit-alpha.test",
      name: "Мария Менеджер",
      role: "manager",
      permissions: [
        "contacts:read", "contacts:write", "companies:read", "companies:write",
        "deals:read", "deals:write", "tasks:read", "tasks:write",
        "service_center:read", "finance:read", "ai_bots:read",
      ],
    },
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03",
      tenantId: tenants[0].id,
      email: "viewer@audit-alpha.test",
      name: "Наблюдатель Audit",
      role: "viewer",
      permissions: ["contacts:read", "companies:read", "deals:read", "tasks:read"],
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01",
      tenantId: tenants[1].id,
      email: "owner@audit-beta.test",
      name: "Бета Владелец",
      role: "owner",
      permissions: ["contacts:read", "contacts:write", "companies:read", "companies:write", "deals:read", "deals:write", "tasks:read", "tasks:write", "tenant:admin", "billing:manage"],
    },
  ];
  users.push({
    ...users[0],
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04",
    email: "platform@audit-alpha.test",
    name: "Платформенный Audit",
    platformRole: "platform_owner",
  });
  for (const user of users) {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, name, role, password_hash, permissions, activated_at, platform_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)
       ON CONFLICT (id) DO NOTHING`,
      [user.id, user.tenantId, user.email, user.name, user.role, passwordHash, user.permissions, user.platformRole ?? null],
    );
  }

  const modules = [
    ["core_crm", "Базовая CRM"], ["service_center", "Сервисный центр"],
    ["finance", "Финансы"], ["ai_bots", "AI-агенты"], ["telegram", "Telegram"],
    ["max", "MAX"],
  ];
  for (const tenant of tenants) {
    for (const [slug, name] of modules) {
      await client.query(
        `INSERT INTO installed_modules (tenant_id, slug, name, quantity, trial_ends_at)
         VALUES ($1, $2, $3, 1, now() + interval '14 days')
         ON CONFLICT (tenant_id, slug) DO NOTHING`,
        [tenant.id, slug, name],
      );
    }
  }

  const existing = await client.query("SELECT id FROM pipelines WHERE tenant_id=$1 LIMIT 1", [tenants[0].id]);
  if (existing.rowCount > 0) {
    await client.query("COMMIT");
    console.log("Audit CRM seed already exists; preserved without duplicate records. Roles ensured.");
    process.exitCode = 0;
  } else {
  const { rows: pipelines } = await client.query(
    `INSERT INTO pipelines (tenant_id, name, sort_order) VALUES ($1, 'Продажи', 0) RETURNING id`,
    [tenants[0].id],
  );
  const pipelineId = pipelines[0].id;
  const stages = [];
  for (const [index, stage] of [
    ["Новый лид", false, false, "amber", true],
    ["Квалификация", false, false, "sky", false],
    ["Предложение", false, false, "violet", false],
    ["Успешно реализовано", true, false, "emerald", true],
    ["Закрыто и не реализовано", false, true, "rose", true],
  ].entries()) {
    const { rows } = await client.query(
      `INSERT INTO stages (pipeline_id, name, sort_order, is_won, is_lost, color, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [pipelineId, stage[0], index, stage[1], stage[2], stage[3], stage[4]],
    );
    stages.push(rows[0].id);
  }

  const companies = [];
  for (const [index, name] of ["Ромашка Audit", "ТехноПром Audit", "СтройГрад Audit"].entries()) {
    const { rows } = await client.query(
      `INSERT INTO companies (tenant_id, name, domain_name, manager_name, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenants[0].id, name, `audit-${index}.test`, users[1].name, users[0].id],
    );
    companies.push(rows[0].id);
  }
  const contacts = [];
  for (const [index, name] of ["Сергей Волков", "Анна Смирнова", "Пётр Иванов", "Мария Кузнецова", "Дмитрий Орлов"].entries()) {
    const [firstName, ...last] = name.split(" ");
    const { rows } = await client.query(
      `INSERT INTO contacts (tenant_id, first_name, last_name, phone, email, company_id, channel, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tenants[0].id, firstName, last.join(" "), `+7999100${String(index).padStart(4, "0")}`, `${firstName.toLowerCase()}@audit.test`, companies[index % companies.length], ["telegram", "whatsapp", "phone", "email", "telegram"][index], users[0].id],
    );
    contacts.push(rows[0].id);
  }
  for (let index = 0; index < 8; index += 1) {
    await client.query(
      `INSERT INTO deals (tenant_id, pipeline_id, stage_id, contact_id, company_id, title, description, budget, created_by, owner_id, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)`,
      [tenants[0].id, pipelineId, stages[index % stages.length], contacts[index % contacts.length], companies[index % companies.length], `Audit сделка ${index + 1}`, index % 2 === 0 ? "Синтетическая проверка карточки и канбана" : "", (index + 1) * 125000, users[0].id, index],
    );
  }
  await client.query(
    `INSERT INTO notes (tenant_id, title, body, contact_id, created_by)
     VALUES ($1, 'Аудит', 'Синтетическая заметка для проверки вкладки карточки.', $2, $3)`,
    [tenants[0].id, contacts[0], users[0].id],
  );
  await client.query(
    `INSERT INTO crm_tasks (tenant_id, contact_id, title, description, priority, status, assignee_id)
     VALUES ($1, $2, 'Проверить карточку контакта', 'Синтетическая задача.', 'high', 'todo', $3)`,
    [tenants[0].id, contacts[0], users[1].id],
  );
  await client.query("COMMIT");
  console.log("Synthetic audit CRM records created. Login instructions are in the audit runbook.");
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally { await client.end(); }
