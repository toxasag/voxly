import { query, queryOne, runWithPlatformScope, runWithTenantContext } from "../../db/client.js";
import { EmailService } from "../../services/email.service.js";
import { queueManager } from "../../infrastructure/queue.js";

export interface InvoiceReminderJob {
  tenantId: string;
  invoiceId: string;
}

interface ReminderRow {
  id: string;
  invoice_number: string;
  company_name: string;
  total: string;
  currency: string;
  due_date: Date | string;
  recipient_email: string | null;
}

export async function processInvoiceReminder(job: InvoiceReminderJob): Promise<void> {
  await runWithTenantContext(job.tenantId, async () => {
    const invoice = await queryOne<ReminderRow>(
      `SELECT i.id, i.invoice_number, i.company_name, i.total, i.currency, i.due_date,
              COALESCE(NULLIF(c.email, ''), NULLIF(u.email, '')) AS recipient_email
       FROM invoices i
       LEFT JOIN companies c ON c.id = i.company_id AND c.tenant_id = i.tenant_id
       LEFT JOIN users u ON u.tenant_id = i.tenant_id AND u.role = 'owner' AND u.deleted_at IS NULL
       WHERE i.tenant_id = $1 AND i.id = $2 AND i.deleted_at IS NULL
         AND i.status IN ('sent', 'overdue')
         AND i.reminder_sent_at IS NULL
       ORDER BY u.created_at ASC
       LIMIT 1`,
      [job.tenantId, job.invoiceId],
    );

    if (invoice === null || invoice.recipient_email === null) return;

    const result = await EmailService.sendInvoiceReminderEmail({
      to: invoice.recipient_email,
      invoiceNumber: invoice.invoice_number,
      companyName: invoice.company_name,
      total: Number(invoice.total),
      currency: invoice.currency,
      dueDate: invoice.due_date,
    });

    if (!result.sent) throw new Error(result.error ?? "Invoice reminder was not sent");

    await query(
      `UPDATE invoices SET reminder_sent_at = now(), status = CASE
         WHEN due_date < now() AND status = 'sent' THEN 'overdue' ELSE status END,
         updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND reminder_sent_at IS NULL`,
      [job.tenantId, job.invoiceId],
    );
  });
}

export async function enqueueDueInvoiceReminders(): Promise<number> {
  const invoices = await runWithPlatformScope(() => query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id, id FROM invoices
     WHERE deleted_at IS NULL AND status IN ('sent', 'overdue')
       AND due_date < now() AND reminder_sent_at IS NULL
     ORDER BY due_date ASC LIMIT 100`,
  ));

  for (const invoice of invoices) {
    await queueManager.enqueue<InvoiceReminderJob>({
      queue: "invoice_reminders",
      tenantId: invoice.tenant_id,
      name: "invoice-overdue",
      data: { tenantId: invoice.tenant_id, invoiceId: invoice.id },
    });
  }
  return invoices.length;
}

export function scheduleInvoiceReminders(
  log: { info: (obj: object, message: string) => void; error: (obj: object, message: string) => void },
  intervalMs = 60 * 60 * 1000,
): () => void {
  let stopped = false;
  let interval: NodeJS.Timeout | null = null;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const count = await enqueueDueInvoiceReminders();
      if (count > 0) log.info({ count }, "Invoice reminders queued");
    } catch (error) {
      log.error({ error }, "Invoice reminder scheduling failed");
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
