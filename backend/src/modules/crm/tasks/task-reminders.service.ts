import { query } from "../../../db/client.js";

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
