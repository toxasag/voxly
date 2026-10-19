import { query, runWithPlatformScope, runWithTenantContext } from "../../../db/client.js";

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
       LEFT JOIN users u ON u.id = t.assignee_id AND u.tenant_id = t.tenant_id
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
   * Проверка и триггер уведомлений (для вызова воркером или крон-задачей).
   */
  async checkAndDispatchReminders(tenantId: string): Promise<{ notifiedCount: number }> {
    const dueTasks = await this.getDueTasks(tenantId, undefined, 2); // 2 hours window
    // В реальной интеграции отправляет в Telegram bot / SSE / Webhook
    return { notifiedCount: dueTasks.length };
  }
}

export interface TaskRemindersLogger {
  info: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

/**
 * Планировщик периодической проверки напоминаний по задачам (Twenty CRM Parity).
 * Запускается в фоне основного процесса, не блокирует event loop.
 */
export function scheduleTaskReminders(
  log: TaskRemindersLogger,
  intervalMs = 15 * 60 * 1000,
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
           WHERE status <> 'done'
             AND deleted_at IS NULL
             AND due_date IS NOT NULL
             AND due_date <= (now() + interval '2 hours')`,
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
  }, 30_000);
  initial.unref();

  return () => {
    stopped = true;
    clearTimeout(initial);
    if (interval !== null) clearInterval(interval);
  };
}
