import type { FastifyInstance } from "fastify";
import type { TransactionClient } from "../../db/client.js";
import { AppError } from "../../plugins/errorHandler.js";
import { BASE_MODULE_SLUG } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Удаление данных модуля при его отключении.
//
// До этого модуля отключение убирало только строку в `installed_modules`: на неё
// не ссылается ни один внешний ключ и нет триггеров, поэтому заказ-наряды, счета
// и транзакции оставались в БД, а `requireModule` лишь закрывал к ним доступ.
// Интерфейс же собирался предупреждать об удалении — то есть обещал то, чего не
// происходило.
//
// Реализовано мягким удалением с окном восстановления, а не немедленным DELETE:
// отключение модуля — один клик, а сервисный центр за год работы содержит всю
// историю ремонтов. Безвозвратное уничтожение по одному клику несоразмерно
// действию, даже с подтверждением. Повторное включение в течение окна
// восстанавливает ровно те строки, которые скрыло отключение.
// ---------------------------------------------------------------------------

/**
 * Сколько данные хранятся после отключения.
 *
 * 30 дней — тот же порядок, что у refresh-токенов: достаточно, чтобы заметить
 * ошибочное отключение и вернуть модуль, и недостаточно, чтобы «удалённые» данные
 * жили в базе неопределённо долго.
 */
export const PURGE_GRACE_DAYS = 30;

// Реэкспорт: маркетплейс и его роуты уже импортируют константу отсюда, а
// источником истины стал types/index.ts — там же живут MODULE_SLUGS.
export { BASE_MODULE_SLUG };

/**
 * Таблицы, принадлежащие каждому модулю.
 *
 * Порядок внутри массива значим для восстановления и очистки: родители идут
 * первыми, дочерние строки уходят каскадом (`ON DELETE CASCADE`) при
 * окончательной очистке.
 *
 * `core_crm` в карте отсутствует намеренно: его данные (контакты, компании,
 * сделки) — фундамент, на который ссылаются остальные модули
 * (`repair_orders.customer_id` → `contacts`), и он не отключается.
 *
 * Каналы делят одну таблицу `channel_accounts` — отсюда `channelFilter` ниже.
 * Без него отключение Telegram скрыло бы и аккаунты WhatsApp: у пяти модулей
 * общая таблица, и фильтр только по `tenant_id` их не различает.
 */
const MODULE_TABLES: Record<string, readonly string[]> = {
  service_center: ["repair_orders"],
  finance: ["invoices", "transactions", "cash_accounts"],
  // `ai_bots` работает на моках (M4.2.*) — своей таблицы пока нет. Пустой массив
  // осмысленнее отсутствия ключа: отключение проходит, очищать нечего.
  ai_bots: [],
  products_services: [],
  telegram: ["channel_accounts"],
  whatsapp: ["channel_accounts"],
  max: ["channel_accounts"],
  avito: ["channel_accounts"],
  instagram: ["channel_accounts"],
};

/**
 * Дополнительное условие для модулей, чья таблица общая с другими.
 *
 * Возвращает готовый фрагмент SQL со ссылкой на `$2`, а не подставляет значение
 * в текст: слаг приходит из замкнутого множества выше, но параметризация здесь
 * дешевле, чем доверие к этому инварианту при следующей правке.
 */
function channelFilter(slug: string, table: string): { sql: string; param: string | null } {
  if (table !== "channel_accounts") return { sql: "", param: null };
  return { sql: " AND channel = $2", param: slug };
}

/** `pg` отдаёт timestamptz как Date, но тип строки допускает и string. */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export interface PurgeResult {
  /** Сколько строк помечено удалёнными, по таблицам. */
  affected: Record<string, number>;
  /** Дата, после которой данные вычищаются окончательно. */
  purgeAfter: string;
  /** Всего затронуто строк — для текста в интерфейсе. */
  total: number;
}

export class ModuleDataService {
  constructor(private readonly app: FastifyInstance) {}

  /** Есть ли у модуля собственные данные, которые теряются при отключении. */
  static hasData(slug: string): boolean {
    return (MODULE_TABLES[slug] ?? []).length > 0;
  }

  static assertNotBaseModule(slug: string): void {
    if (slug === BASE_MODULE_SLUG) {
      throw new AppError(
        409,
        "BASE_MODULE_REQUIRED",
        "Базовая CRM — основа системы: на её контакты и сделки ссылаются остальные модули. Отключить её нельзя.",
      );
    }
  }

  /**
   * Считает, сколько строк затронет отключение.
   *
   * Нужен до подтверждения: диалог должен называть число, а не абстрактно
   * предупреждать об «удалении данных» — иначе решение принимается вслепую.
   */
  async preview(tx: TransactionClient, tenantId: string, slug: string): Promise<Record<string, number>> {
    const tables = MODULE_TABLES[slug] ?? [];
    const counts: Record<string, number> = {};

    for (const table of tables) {
      const filter = channelFilter(slug, table);
      const params: string[] = filter.param === null ? [tenantId] : [tenantId, filter.param];

      // Имя таблицы берётся из фиксированной карты выше, а не из входных данных:
      // интерполировать в SQL можно только значения из этого замкнутого множества.
      const row = await tx.queryOne<{ total: string }>(
        `SELECT count(*)::text AS total FROM ${table}
         WHERE tenant_id = $1 AND deleted_at IS NULL${filter.sql}`,
        params,
      );

      const total = Number(row?.total ?? 0);
      if (total > 0) counts[table] = total;
    }

    return counts;
  }

  /**
   * Помечает данные модуля удалёнными и записывает это в журнал.
   *
   * Выполняется в той же транзакции, что удаление строки `installed_modules`:
   * иначе модуль оказался бы отключён, а данные видимы, либо наоборот.
   */
  async softDelete(
    tx: TransactionClient,
    input: { tenantId: string; slug: string; actorId: string },
  ): Promise<PurgeResult> {
    const tables = MODULE_TABLES[input.slug] ?? [];
    const affected: Record<string, number> = {};
    const purgeAfter = new Date(Date.now() + PURGE_GRACE_DAYS * 86_400_000);

    for (const table of tables) {
      const filter = channelFilter(input.slug, table);
      const params: string[] =
        filter.param === null ? [input.tenantId] : [input.tenantId, filter.param];

      const rows = await tx.query<{ id: string }>(
        `UPDATE ${table} SET deleted_at = now()
         WHERE tenant_id = $1 AND deleted_at IS NULL${filter.sql}
         RETURNING id`,
        params,
      );

      if (rows.length > 0) affected[table] = rows.length;
    }

    // Журнал пишется всегда, даже когда затронуто 0 строк: он же служит
    // признаком «модуль отключался», по которому повторное включение решает,
    // восстанавливать данные или нет.
    await tx.query(
      `INSERT INTO module_data_purges (tenant_id, slug, performed_by, affected, purge_after)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [input.tenantId, input.slug, input.actorId, JSON.stringify(affected), purgeAfter],
    );

    const total = Object.values(affected).reduce((sum, value) => sum + value, 0);

    this.app.log.info(
      { tenantId: input.tenantId, slug: input.slug, affected, total },
      "Module data soft-deleted on uninstall",
    );

    return { affected, purgeAfter: purgeAfter.toISOString(), total };
  }

  /**
   * Восстанавливает данные при повторном включении модуля в течение окна.
   *
   * Восстанавливаются только строки, скрытые последним отключением: журнал
   * хранит момент, и `deleted_at` сверяется с ним. Иначе включение модуля
   * «оживило» бы и записи, удалённые пользователем вручную задолго до этого.
   */
  async restore(
    tx: TransactionClient,
    input: { tenantId: string; slug: string },
  ): Promise<{ restored: Record<string, number>; total: number }> {
    const pending = await tx.queryOne<{
      id: string;
      created_at: Date | string;
      affected: Record<string, number>;
    }>(
      `SELECT id, created_at, affected
       FROM module_data_purges
       WHERE tenant_id = $1 AND slug = $2
         AND restored_at IS NULL AND purged_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.tenantId, input.slug],
    );

    if (pending === null) return { restored: {}, total: 0 };

    const tables = MODULE_TABLES[input.slug] ?? [];
    const restored: Record<string, number> = {};

    for (const table of tables) {
      const filter = channelFilter(input.slug, table);
      // Фильтр канала занимает $3: $2 уже отдан моменту отключения.
      const channelSql = filter.sql.replace("$2", "$3");
      const params: (string | Date)[] = [input.tenantId, toDate(pending.created_at)];
      if (filter.param !== null) params.push(filter.param);

      // Окно в одну секунду вокруг момента отключения: `deleted_at` выставлялся
      // одним `now()` на всю транзакцию, но сравнение по точному равенству
      // хрупко к округлению timestamptz.
      const rows = await tx.query<{ id: string }>(
        `UPDATE ${table} SET deleted_at = NULL
         WHERE tenant_id = $1
           AND deleted_at IS NOT NULL
           AND deleted_at BETWEEN $2::timestamptz - interval '1 second'
                              AND $2::timestamptz + interval '1 second'${channelSql}
         RETURNING id`,
        params,
      );

      if (rows.length > 0) restored[table] = rows.length;
    }

    await tx.query(`UPDATE module_data_purges SET restored_at = now() WHERE id = $1`, [pending.id]);

    const total = Object.values(restored).reduce((sum, value) => sum + value, 0);

    this.app.log.info(
      { tenantId: input.tenantId, slug: input.slug, restored, total },
      "Module data restored on reinstall",
    );

    return { restored, total };
  }
}
