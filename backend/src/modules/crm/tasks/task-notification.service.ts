import { queryOne } from "../../../db/client.js";
import { TelegramService, escapeHtml } from "../../auth/telegram.service.js";

export interface TaskAssignmentNotificationJob {
  tenantId: string;
  taskId: string;
  assigneeId: string;
}

/** Отправляет назначенному сотруднику уведомление о новой/переназначенной задаче. */
export async function notifyTaskAssignment(job: TaskAssignmentNotificationJob): Promise<void> {
  const recipient = await queryOne<{
    title: string;
    description: string;
    due_date: Date | string | null;
    priority: string;
    assignee_name: string;
    telegram_chat_id: string | null;
  }>(
    `SELECT t.title, t.description, t.due_date, t.priority,
            u.name AS assignee_name, u.telegram_chat_id::text AS telegram_chat_id
     FROM crm_tasks t
     JOIN users u ON u.id = t.assignee_id AND u.tenant_id = t.tenant_id
     WHERE t.tenant_id = $1 AND t.id = $2 AND t.assignee_id = $3
       AND t.deleted_at IS NULL AND u.deleted_at IS NULL`,
    [job.tenantId, job.taskId, job.assigneeId],
  );

  if (recipient === null || recipient.telegram_chat_id === null) return;

  const telegram = new TelegramService();
  if (!telegram.isConfigured) return;

  const priorityLabels: Record<string, string> = {
    high: "Высокий",
    medium: "Средний",
    low: "Низкий",
  };
  const dueDate = recipient.due_date === null
    ? "не указан"
    : new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Moscow",
      }).format(new Date(recipient.due_date));

  const lines = [
    `<b>Вам назначена задача</b>`,
    `\n<b>Задача:</b> ${escapeHtml(recipient.title)}`,
    `<b>Приоритет:</b> ${escapeHtml(priorityLabels[recipient.priority] ?? recipient.priority)}`,
    `<b>Срок:</b> ${escapeHtml(dueDate)}`,
  ];
  if (recipient.description.trim() !== "") {
    lines.push(`\n<b>Описание:</b>\n${escapeHtml(recipient.description.trim())}`);
  }
  lines.push(`\n<a href="https://voxly.getvoxly.ru/crm/tasks?record=${job.taskId}">Открыть задачу в CRM</a>`);

  const result = await telegram.sendMessage(recipient.telegram_chat_id, lines.join("\n"), {
    parseMode: "HTML",
  });
  if (!result.delivered) {
    throw new Error(result.reason ?? "Task assignment notification was not delivered");
  }
}
