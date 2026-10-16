// Наполнение локальной БД для проверки страниц CRM в браузере.
//
// Регистрация через API требует кода из Telegram/MAX, а локально ни один
// транспорт не настроен. Поэтому арендатор, пользователь и записи создаются
// напрямую: цель — проверить поведение таблиц и карточек, а не путь регистрации.
import argon2 from "argon2";
import { Client } from "pg";

const client = new Client({
  connectionString: "postgres://postgres@127.0.0.1:5432/getvoxly_local",
});

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

const PERMISSIONS = [
  "contacts:read", "contacts:write", "contacts:delete",
  "companies:read", "companies:write", "companies:delete",
  "deals:read", "deals:write",
  "tasks:read", "tasks:write",
  "tenant:admin", "billing:manage",
];

async function main() {
  await client.connect();

  await client.query("DELETE FROM notes WHERE tenant_id = $1", [TENANT_ID]);
  await client.query("DELETE FROM deals WHERE tenant_id = $1", [TENANT_ID]);
  await client.query("DELETE FROM contacts WHERE tenant_id = $1", [TENANT_ID]);
  await client.query("DELETE FROM companies WHERE tenant_id = $1", [TENANT_ID]);

  await client.query(
    `INSERT INTO tenants (id, name, slug)
     VALUES ($1, 'Локальный Арендатор', 'local')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [TENANT_ID],
  );

  const passwordHash = await argon2.hash("LocalDev12345");

  // activated_at обязателен: `activeUserPredicate` требует его непустым, и без
  // него вход отвечает «User not found» — проверено на этом же скрипте.
  await client.query(
    `INSERT INTO users (id, tenant_id, email, phone, name, role, password_hash, permissions, activated_at)
     VALUES ($1, $2, 'local@test.dev', '+79990000000', 'Локальный Тест', 'owner', $3, $4, now())
     ON CONFLICT (id) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           permissions = EXCLUDED.permissions,
           activated_at = COALESCE(users.activated_at, now())`,
    [USER_ID, TENANT_ID, passwordHash, PERMISSIONS],
  );

  const companies = [
    ["Ромашка", "romashka.ru", "Москва", 12000000],
    ["ТехноПром", "technoprom.ru", "Казань", 4500000],
    ["СтройГрад", "stroygrad.ru", "Сочи", null],
  ];

  const companyIds = [];
  for (const [name, domain, city, revenue] of companies) {
    const { rows } = await client.query(
      `INSERT INTO companies
         (tenant_id, name, domain_name, phone, email, manager_name, annual_revenue,
          linkedin_link, address_city, address_street, address_country, created_by)
       VALUES ($1, $2, $3, '+74951234567', 'info@example.ru', 'Иван Петров', $4,
               'https://linkedin.com/company/demo', $5, 'Ленина 1', 'Россия', $6)
       RETURNING id`,
      [TENANT_ID, name, domain, revenue, city, USER_ID],
    );
    companyIds.push(rows[0].id);
  }

  const people = [
    ["Сергей", "Волков", "Технический директор", "telegram"],
    ["Анна", "Смирнова", "", "whatsapp"],
    ["Пётр", "Иванов", "Закупщик", "phone"],
    ["Мария", "Кузнецова", "Финансовый директор", "email"],
    ["Дмитрий", "Орлов", "", "telegram"],
  ];

  const contactIds = [];
  for (let index = 0; index < people.length; index++) {
    const [first, last, job, channel] = people[index];
    const { rows } = await client.query(
      `INSERT INTO contacts
         (tenant_id, first_name, last_name, phone, email, telegram_username, job_title,
          company_name, company_id, channel, linkedin_link, created_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        TENANT_ID, first, last, `+7999100${String(index).padStart(4, "0")}`,
        index % 2 === 0 ? `${first.toLowerCase()}@example.ru` : null,
        index % 3 === 0 ? `@${first.toLowerCase()}` : null,
        job,
        companies[index % companies.length][0],
        companyIds[index % companyIds.length],
        channel,
        index === 0 ? "https://linkedin.com/in/volkov" : "",
        USER_ID,
        index === 1 ? "Просила перезвонить после 18:00" : "",
      ],
    );
    contactIds.push(rows[0].id);
  }

  // Воронка и стадии: канбан и список сделок без них не отрисуются.
  //
  // Старые воронки удаляются перед вставкой: прерванный прогон оставлял воронку
  // без стадий, UI выбирал именно её и показывал «Pipeline not found or has no
  // stages». Проверено в браузере после первого падения этого скрипта.
  await client.query(`DELETE FROM pipelines WHERE tenant_id = $1`, [TENANT_ID]);

  const { rows: pipelineRows } = await client.query(
    `INSERT INTO pipelines (tenant_id, name, sort_order)
     VALUES ($1, 'Продажи', 0)
     RETURNING id`,
    [TENANT_ID],
  );
  const pipelineId = pipelineRows[0].id;

  const stageNames = [
    ["Новая", false, false, "sky"],
    ["Квалификация", false, false, "amber"],
    ["Предложение", false, false, "violet"],
    ["Выиграна", true, false, "emerald"],
  ];

  const stageIds = [];
  for (let index = 0; index < stageNames.length; index++) {
    const [name, isWon, isLost, color] = stageNames[index];
    // У stages нет tenant_id: изоляция идёт через pipeline_id → pipelines.tenant_id.
    const { rows } = await client.query(
      `INSERT INTO stages (pipeline_id, name, sort_order, is_won, is_lost, color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [pipelineId, name, index, isWon, isLost, color],
    );
    stageIds.push(rows[0].id);
  }

  for (let index = 0; index < 6; index++) {
    await client.query(
      `INSERT INTO deals
         (tenant_id, pipeline_id, stage_id, contact_id, company_id, title, description,
          budget, currency, created_by, owner_id, close_date, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'RUB', $9, $9, $10, $11)`,
      [
        TENANT_ID, pipelineId, stageIds[index % stageIds.length],
        contactIds[index % contactIds.length], companyIds[index % companyIds.length],
        `Сделка ${index + 1}`,
        index % 2 === 0 ? "Поставка оборудования" : "",
        (index + 1) * 150000,
        USER_ID,
        index % 3 === 0 ? new Date(Date.now() + 86400000 * (index + 5)) : null,
        index,
      ],
    );
  }

  await client.query(
    `INSERT INTO notes (tenant_id, body, contact_id, created_by)
     VALUES ($1, 'Первый контакт состоялся на выставке', $2, $3)`,
    [TENANT_ID, contactIds[0], USER_ID],
  );

  console.log("готово: арендатор, пользователь local@test.dev / LocalDev12345,");
  console.log(`компаний ${companyIds.length}, контактов ${contactIds.length}, сделок 6, заметок 1`);

  await client.end();
}

main().catch((error) => {
  console.error("FAILED:", error.message);
  process.exit(1);
});
