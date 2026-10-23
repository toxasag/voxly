import { query, queryOne, runWithPlatformScope, runWithTenantContext } from "../../../db/client.js";
import { TelegramService, escapeHtml } from "../../auth/telegram.service.js";

export interface DueReminderTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  dueDate: string;
  assigneeId: string;
  assigneeName: string;
  dealId: string | null;
  contactId: string | null;
  companyId: string | null;
  isOverdue: boolean;
}

export class TaskRemindersService {
  /**
   * Возвращает список горящих задач тенанта (просроченные или дедлайн в течение N часов).
   */
  async getDueTasks(
    tenantId: string,
    assigneeId?: string,
    withinHours: number = 24,
  ): Promise<DueReminderTask[]> {
    const params: (string | number)[] = [tenantId, withinHours];
    let assigneeFilter = "";

    if (assigneeId) {
      params.push(assigneeId);
      assigneeFilter = `AND t.assignee_id = $${params.length}`;
    }

    const rows = await query<{
      id: string;
      title: string;
      description: string;
      priority: string;
      status: string;
      due_date: Date | string;
      assignee_id: string;
      assignee_name: string;
      deal_id: string | null;
      contact_id: string | null;
      company_id: string | null;
      is_overdue: boolean;
    }>(
      `SELECT
         t.id, t.title, t.description, t.priority, t.status, t.due_date,
         t.assignee_id, u.name AS assignee_name,
         t.deal_id, t.contact_id, t.company_id,
         (t.due_date < now()) AS is_overdue
       FROM crm_tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.tenant_id = $1
         AND t.status <> 'done'
         AND t.deleted_at IS NULL
         AND t.due_date IS NOT NULL
         AND t.due_date <= (now() + ($2 || ' hours')::interval)
         ${assigneeFilter}
       ORDER BY t.due_date ASC`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      dueDate: r.due_date instanceof Date ? r.due_date.toISOString() : String(r.due_date),
      assigneeId: r.assignee_id,
      assigneeName: r.assignee_name ?? "Без исполнителя",
      dealId: r.deal_id,
      contactId: r.contact_id,
      companyId: r.company_id,
      isOverdue: Boolean(r.is_overdue),
    }));
  }

  /**
   * Проверка и триггер уведомлений в Telegram перед наступлением события.
   */
  async checkAndDispatchReminders(tenantId: string): Promise<{ notifiedCount: number }> {
    const telegramService = new TelegramService();
    if (!telegramService.isConfigured) {
      return { notifiedCount: 0 };
    }

    // Ищем задачи, по которым включено notify_telegram и подошло время напоминания (due_date - remind_before_minutes)
    const tasks = await query<{
      id: string;
      tenant_id: string;
      title: string;
      description: string;
      priority: string;
      status: string;
      due_date: Date | string;
      assignee_id: string;
      assignee_name: string | null;
      assignee_telegram_chat_id: string | null;
      deal_id: string | null;
      contact_id: string | null;
      company_id: string | null;
      remind_before_minutes: number | null;
    }>(
      `SELECT
         t.id, t.tenant_id, t.title, t.description, t.priority, t.status, t.due_date,
         t.assignee_id, u.name AS assignee_name, u.telegram_chat_id::text AS assignee_telegram_chat_id,
         t.deal_id, t.contact_id, t.company_id,
         COALESCE(t.remind_before_minutes, 30) AS remind_before_minutes
       FROM crm_tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.tenant_id = $1
         AND t.notify_telegram = TRUE
         AND t.status <> 'done'
         AND t.deleted_at IS NULL
         AND t.due_date IS NOT NULL
         AND t.reminder_sent_at IS NULL
         AND now() >= (t.due_date - (COALESCE(t.remind_before_minutes, 30) || ' minutes')::interval)
         AND now() < (t.due_date + interval '2 hours')
       ORDER BY t.due_date ASC
       LIMIT 50`,
      [tenantId],
    );

    if (tasks.length === 0) {
      return { notifiedCount: 0 };
    }

    let notifiedCount = 0;

    for (const task of tasks) {
      // 1. Получатель: сначала назначенный ответственный
      let recipientChatId = task.assignee_telegram_chat_id;

      // Если у ответственного нет Telegram, шлём администратору тенанта
      if (!recipientChatId) {
        const adminUser = await queryOne<{ telegram_chat_id: string | null }>(
          `SELECT telegram_chat_id::text FROM users
           WHERE tenant_id = $1 AND telegram_chat_id IS NOT NULL AND deleted_at IS NULL
           ORDER BY (CASE WHEN role = 'admin' THEN 0 ELSE 1 END) ASC
           LIMIT 1`,
          [tenantId],
        );
        recipientChatId = adminUser?.telegram_chat_id ?? null;
      }

      if (!recipientChatId) {
        // Некуда отправить — помечаем, чтобы не блокировать цикл
        await query(
          `UPDATE crm_tasks SET reminder_sent_at = now() WHERE id = $1 AND tenant_id = $2`,
          [task.id, tenantId],
        );
        continue;
      }

      // 2. Получаем сведения о связанной сущности
      let linkedInfo: string | null = null;
      if (task.deal_id) {
        const deal = await queryOne<{ title: string }>(
          `SELECT title FROM deals WHERE id = $1 AND tenant_id = $2`,
          [task.deal_id, tenantId],
        );
        if (deal) linkedInfo = `Сделка «${deal.title}»`;
      } else if (task.contact_id) {
        const contact = await queryOne<{ first_name: string; last_name: string }>(
          `SELECT first_name, last_name FROM contacts WHERE id = $1 AND tenant_id = $2`,
          [task.contact_id, tenantId],
        );
        if (contact) {
          linkedInfo = `Контакт «${[contact.first_name, contact.last_name].filter(Boolean).join(" ")}»`;
        }
      } else if (task.company_id) {
        const comp = await queryOne<{ name: string }>(
          `SELECT name FROM companies WHERE id = $1 AND tenant_id = $2`,
          [task.company_id, tenantId],
        );
        if (comp) linkedInfo = `Компания «${comp.name}»`;
      }

      const priorityLabels: Record<string, string> = {
        high: "🔴 Высокий",
        medium: "🟡 Средний",
        low: "⚪ Низкий",
      };

      const msLeft = new Date(task.due_date).getTime() - Date.now();
      let timeLeftStr = "";
      if (msLeft > 0) {
        const minLeft = Math.round(msLeft / 60000);
        if (minLeft < 60) {
          timeLeftStr = `через ${minLeft} мин`;
        } else {
          const hours = Math.floor(minLeft / 60);
          const remMin = minLeft % 60;
          timeLeftStr = `через ${hours} ч${remMin > 0 ? ` ${remMin} мин` : ""}`;
        }
      } else {
        timeLeftStr = "срок наступил";
      }

      const formattedDueDate = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow",
      }).format(new Date(task.due_date));

      let text = `⏰ <b>Напоминание по задаче</b>\n\n`;
      text += `<b>Задача:</b> ${escapeHtml(task.title)}\n`;
      text += `<b>Срок выполнения:</b> ${formattedDueDate} (${timeLeftStr})\n`;
      text += `<b>Приоритет:</b> ${priorityLabels[task.priority] ?? task.priority}\n`;

      if (task.assignee_name) {
        text += `<b>Ответственный:</b> ${escapeHtml(task.assignee_name)}\n`;
      }

      if (linkedInfo) {
        text += `<b>Связь:</b> ${escapeHtml(linkedInfo)}\n`;
      }

      if (task.description && task.description.trim().length > 0) {
        text += `\n<b>Описание:</b>\n${escapeHtml(task.description.trim())}\n`;
      }

      text += `\n🔗 <a href="https://voxly.getvoxly.ru/crm/tasks?record=${task.id}">Открыть задачу в CRM</a>`;

      const sendRes = await telegramService.sendMessage(recipientChatId, text);
      if (sendRes.delivered) {
        notifiedCount++;
      }

      await query(
        `UPDATE crm_tasks SET reminder_sent_at = now() WHERE id = $1 AND tenant_id = $2`,
        [task.id, tenantId],
      );
    }

    return { notifiedCount };
  }
}

export interface TaskRemindersLogger {
  info: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

/**
 * Планировщик периодической проверки напоминаний по задачам (Twenty CRM Parity).
 * Запускается в фоне основного процесса с интервалом 60 секунд.
 */
export function scheduleTaskReminders(
  log: TaskRemindersLogger,
  intervalMs = 60 * 1000,
): () => void {
  let stopped = false;
  let interval: NodeJS.Timeout | null = null;
  const remindersService = new TaskRemindersService();

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const tenants = await runWithPlatformScope(async () => {
        const rows = await query<{ tenant_id: string }>(
          `SELECT DISTINCT tenant_id FROM crm_tasks
           WHERE notify_telegram = TRUE
             AND status <> 'done'
             AND deleted_at IS NULL
             AND due_date IS NOT NULL
             AND reminder_sent_at IS NULL
             AND now() >= (due_date - (COALESCE(remind_before_minutes, 30) || ' minutes')::interval)
             AND now() < (due_date + interval '2 hours')`,
        );
        return rows.map((r) => r.tenant_id);
      });

      let totalNotified = 0;
      for (const tId of tenants) {
        if (stopped) break;
        const result = await runWithTenantContext(tId, () =>
          remindersService.checkAndDispatchReminders(tId),
        );
        totalNotified += result.notifiedCount;
      }

      if (totalNotified > 0) {
        log.info({ totalNotified, tenantsCount: tenants.length }, "Task reminders dispatched");
      }
    } catch (error) {
      log.error({ error }, "Task reminders check failed");
    }
  };

  const initial = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), intervalMs);
    interval.unref();
  }, 5_000);
  initial.unref();

  return () => {
    stopped = true;
    clearTimeout(initial);
    if (interval !== null) clearInterval(interval);
  };
}
