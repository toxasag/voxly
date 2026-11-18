import {
  buildCsvBuffer,
  buildXlsxBuffer,
  parseCsvText,
  parseXlsxBuffer,
  type ExportColumnDef,
} from "../../warehouse/warehouse-io.service.js";
import { ContactsService } from "./contacts.service.js";
import { DealsService } from "../deals/deals.service.js";
import { CrmEnrichmentService } from "../enrichment.service.js";
import { query, type SqlParam } from "../../../db/client.js";
import { z } from "zod";
import type { CreateContactPayload, ContactPhonePayload, ContactSocialPayload } from "./contacts.types.js";

// ---------------------------------------------------------------------------
// Схемы и типы импорта контактов
// ---------------------------------------------------------------------------

export const contactImportValidateSchema = z.object({
  rows: z.array(z.array(z.string())),
  mapping: z.record(z.string()),
  skipFirstRow: z.boolean().default(true),
});

export type ContactImportValidatePayload = z.infer<typeof contactImportValidateSchema>;

export const contactImportCommitSchema = z.object({
  rows: z.array(z.array(z.string())),
  mapping: z.record(z.string()),
  skipFirstRow: z.boolean().default(true),
  duplicateStrategy: z.enum(["skip", "update", "create_anyway"]).default("skip"),
  createDeal: z.boolean().default(false),
  dealOptions: z
    .object({
      titleMode: z.enum(["field", "random", "template"]).default("field"),
      titleField: z.string().optional(),
      titleTemplate: z.string().optional(),
      pipelineId: z.string().uuid().optional(),
      stageId: z.string().uuid().optional(),
    })
    .optional(),
  triggerResearch: z.boolean().default(true),
});

export type ContactImportCommitPayload = z.infer<typeof contactImportCommitSchema>;

export interface ContactImportParseResultDTO {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  detectedDelimiter?: string;
  suggestedMapping: Record<string, string>;
}

export interface ContactImportDuplicateDTO {
  rowIndex: number;
  existingContactId: string;
  existingName: string;
  field: "phone" | "email";
  value: string;
  rowPreview: string;
}

export interface ContactImportValidateResultDTO {
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  duplicates: ContactImportDuplicateDTO[];
  sampleValid: Array<{
    first_name: string;
    last_name?: string;
    phone?: string;
    email?: string;
    company_name?: string;
  }>;
  errors: Array<{ rowIndex: number; error: string }>;
}

export interface ContactImportCommitResultDTO {
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  dealsCreatedCount: number;
  researchTriggeredCount: number;
  errorCount: number;
  errors: Array<{ rowIndex: number; error: string }>;
}

/**
 * Интеллектуальное сопоставление названия столбца из файла с системным полем контакта.
 */
export function suggestContactFieldMapping(header: string): string | null {
  const h = header.toLowerCase().trim().replace(/[\s_-]+/g, "");
  if (/^(имя|firstname|first_name|first|fname|name|клиент)$/.test(h)) return "first_name";
  if (/^(фамилия|lastname|last_name|last|lname|surname)$/.test(h)) return "last_name";
  if (/^(отчество|middlename|middle_name|patronymic)$/.test(h)) return "middle_name";
  if (/^(фио|fullname|full_name|контакт|фиоклиента|клиентфио|фиоконтакта)$/.test(h)) return "full_name";
  if (/^(телефон|номер|phone|tel|mobile|тел|phone_number|номертелефона|сотовый|мобтел)$/.test(h)) return "phone";
  if (/^(доптелефон|допномер|additionalphone|secondphone|phone2|доптел|рабтел)$/.test(h)) return "additional_phone";
  if (/^(email|почта|e-mail|mail|элпочта|электроннаяпочта)$/.test(h)) return "email";
  if (/^(компания|организация|company|companyname|организацияклиента|фирма|предприятие)$/.test(h)) return "company_name";
  if (/^(должность|позиция|position|jobtitle|job_title|профессия|статус)$/.test(h)) return "job_title";
  if (/^(телеграм|telegram|tg|username|тг|телеграмник)$/.test(h)) return "telegram_username";
  if (/^(ватсап|whatsapp|wa|вацап)$/.test(h)) return "whatsapp";
  if (/^(город|city|населенныйпункт)$/.test(h)) return "city";
  if (/^(адрес|address|улица|адресдоставки|юрадрес)$/.test(h)) return "address";
  if (/^(заметки|комментарий|notes|comment|описание|примечание)$/.test(h)) return "notes";
  return null;
}

/**
 * Нормализация номера телефона (только цифры).
 */
function cleanDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Разбор строки полного имени (ФИО) на составляющие:
 * "Иванов Иван Иванович" -> { last_name: "Иванов", first_name: "Иван", middle_name: "Иванович" }
 * "Иван Иванов" -> { first_name: "Иван", last_name: "Иванов", middle_name: "" }
 */
function splitFullName(fullName: string): { first_name: string; last_name: string; middle_name: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { first_name: "Контакт", last_name: "", middle_name: "" };
  }
  if (parts.length === 1) {
    return { first_name: parts[0] || "Контакт", last_name: "", middle_name: "" };
  }
  if (parts.length === 2) {
    // В русской традиции при вводе двух слов часто пишут "Иван Иванов" или "Иванов Иван"
    // Принимаем parts[0] как имя, parts[1] как фамилию
    return { first_name: parts[0] || "Контакт", last_name: parts[1] || "", middle_name: "" };
  }
  // 3 и более слов: фамилия имя отчество
  return {
    last_name: parts[0] || "",
    first_name: parts[1] || "Контакт",
    middle_name: parts.slice(2).join(" "),
  };
}

export class ContactsIOService {
  private readonly contactsService = new ContactsService();
  private readonly dealsService = new DealsService();
  private readonly enrichmentService = new CrmEnrichmentService();

  /**
   * Парсинг файла (CSV или XLSX) в 2D-массив строк с автоподбором колонок.
   */
  async parseImportFile(
    buffer: Buffer,
    filename: string,
    delimiter?: string,
  ): Promise<ContactImportParseResultDTO> {
    const isCsv =
      filename.toLowerCase().endsWith(".csv") ||
      filename.toLowerCase().endsWith(".txt");

    let rows: string[][] = [];
    let detectedDelimiter: string | undefined = delimiter;

    if (isCsv) {
      const parsed = parseCsvText(buffer.toString("utf8"), delimiter);
      rows = parsed.rows;
      detectedDelimiter = parsed.detectedDelimiter;
    } else {
      rows = await parseXlsxBuffer(buffer);
    }

    if (rows.length === 0) {
      return {
        headers: [],
        sampleRows: [],
        totalRows: 0,
        detectedDelimiter,
        suggestedMapping: {},
      };
    }

    const headers = rows[0] || [];
    const sampleRows = rows.slice(1, 6);
    const suggestedMapping: Record<string, string> = {};

    headers.forEach((h, idx) => {
      const matched = suggestContactFieldMapping(h);
      if (matched) {
        suggestedMapping[String(idx)] = matched;
      }
    });

    return {
      headers,
      sampleRows,
      totalRows: rows.length,
      detectedDelimiter,
      suggestedMapping,
    };
  }

  /**
   * Валидация строк и поиск дубликатов по номеру телефона и email в рамках тенанта.
   */
  async validateImport(
    tenantId: string,
    payload: ContactImportValidatePayload,
  ): Promise<ContactImportValidateResultDTO> {
    const allRows = payload.rows;
    if (allRows.length === 0) {
      return {
        totalRows: 0,
        validCount: 0,
        duplicateCount: 0,
        errorCount: 0,
        duplicates: [],
        sampleValid: [],
        errors: [],
      };
    }

    const dataRows = payload.skipFirstRow ? allRows.slice(1) : allRows;

    // Считываем все существующие контакты тенанта для быстрого O(1) поиска дубликатов
    const existing = await query<{
      id: string;
      first_name: string;
      last_name: string;
      phone: string;
      email: string | null;
    }>(
      `SELECT id, first_name, last_name, phone, email
       FROM contacts
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );

    const existingByPhone = new Map<string, { id: string; name: string }>();
    const existingByEmail = new Map<string, { id: string; name: string }>();

    for (const c of existing) {
      const p = cleanDigits(c.phone);
      const fullName = `${c.first_name} ${c.last_name}`.trim();
      if (p.length >= 7) {
        // Храним последние 10 цифр для надежного сопоставления с кодами +7 / 8
        const key = p.slice(-10);
        existingByPhone.set(key, { id: c.id, name: fullName });
      }
      if (c.email) {
        existingByEmail.set(c.email.toLowerCase().trim(), { id: c.id, name: fullName });
      }
    }

    const duplicates: ContactImportDuplicateDTO[] = [];
    const errors: Array<{ rowIndex: number; error: string }> = [];
    const sampleValid: Array<{
      first_name: string;
      last_name?: string;
      phone?: string;
      email?: string;
      company_name?: string;
    }> = [];

    let validCount = 0;

    dataRows.forEach((row, index) => {
      const rowIndex = payload.skipFirstRow ? index + 2 : index + 1;
      const mapped = this.extractRowFields(row, payload.mapping);

      // Проверка обязательности имени (если нет ни имени, ни полного имени, ни компании, ни телефона — ошибка)
      if (!mapped.first_name && !mapped.full_name && !mapped.company_name && !mapped.phone) {
        errors.push({
          rowIndex,
          error: "Строка не содержит ни имени, ни компании, ни контактных данных",
        });
        return;
      }

      let isDup = false;

      // Проверка по телефону
      if (mapped.phone) {
        const digits = cleanDigits(mapped.phone);
        if (digits.length >= 7) {
          const key = digits.slice(-10);
          const found = existingByPhone.get(key);
          if (found) {
            duplicates.push({
              rowIndex,
              existingContactId: found.id,
              existingName: found.name,
              field: "phone",
              value: mapped.phone,
              rowPreview: `${mapped.first_name || mapped.full_name || ""} (${mapped.phone})`.trim(),
            });
            isDup = true;
          }
        }
      }

      // Проверка по email
      if (mapped.email && !isDup) {
        const cleanEmail = mapped.email.toLowerCase().trim();
        const found = existingByEmail.get(cleanEmail);
        if (found) {
          duplicates.push({
            rowIndex,
            existingContactId: found.id,
            existingName: found.name,
            field: "email",
            value: mapped.email,
            rowPreview: `${mapped.first_name || mapped.full_name || ""} (${mapped.email})`.trim(),
          });
          isDup = true;
        }
      }

      validCount++;

      if (sampleValid.length < 5) {
        sampleValid.push({
          first_name: mapped.first_name || mapped.full_name || "Контакт",
          last_name: mapped.last_name,
          phone: mapped.phone,
          email: mapped.email,
          company_name: mapped.company_name,
        });
      }
    });

    return {
      totalRows: dataRows.length,
      validCount,
      duplicateCount: duplicates.length,
      errorCount: errors.length,
      duplicates,
      sampleValid,
      errors,
    };
  }

  /**
   * Выполнение импорта контактов:
   * 1. Создание/обновление контакта
   * 2. Опциональное создание сделки со сгенерированным/настроенным названием
   * 3. Запуск фонового ресёрча (Telegram, WhatsApp, MAX)
   */
  async commitImport(
    tenantId: string,
    actorId: string,
    payload: ContactImportCommitPayload,
  ): Promise<ContactImportCommitResultDTO> {
    const allRows = payload.rows;
    const dataRows = payload.skipFirstRow ? allRows.slice(1) : allRows;

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let dealsCreatedCount = 0;
    let researchTriggeredCount = 0;
    const errors: Array<{ rowIndex: number; error: string }> = [];

    // Предзагрузка существующих контактов
    const existing = await query<{
      id: string;
      first_name: string;
      last_name: string;
      phone: string;
      email: string | null;
      company_id: string | null;
    }>(
      `SELECT id, first_name, last_name, phone, email, company_id
       FROM contacts
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );

    const existingByPhone = new Map<string, { id: string; companyId: string | null }>();
    const existingByEmail = new Map<string, { id: string; companyId: string | null }>();

    for (const c of existing) {
      const p = cleanDigits(c.phone);
      if (p.length >= 7) {
        existingByPhone.set(p.slice(-10), { id: c.id, companyId: c.company_id });
      }
      if (c.email) {
        existingByEmail.set(c.email.toLowerCase().trim(), { id: c.id, companyId: c.company_id });
      }
    }

    // Предзагрузка дефолтной воронки и стадии, если создаем сделки
    let targetPipelineId = payload.dealOptions?.pipelineId;
    let targetStageId = payload.dealOptions?.stageId;

    if (payload.createDeal && (!targetPipelineId || !targetStageId)) {
      const pipelines = await this.dealsService.listPipelines(tenantId);
      if (pipelines.length > 0 && pipelines[0]) {
        targetPipelineId = targetPipelineId || pipelines[0].id;
        const stages = await query<{ id: string }>(
          `SELECT id FROM stages WHERE pipeline_id = $1 ORDER BY sort_order ASC LIMIT 1`,
          [targetPipelineId],
        );
        if (stages.length > 0 && stages[0]) {
          targetStageId = targetStageId || stages[0].id;
        }
      }
    }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row) continue;
      const rowIndex = payload.skipFirstRow ? i + 2 : i + 1;

      try {
        const mapped = this.extractRowFields(row, payload.mapping);

        // Формируем поля имени
        let firstName = mapped.first_name || "";
        let lastName = mapped.last_name || "";
        let middleName = mapped.middle_name || "";

        if (mapped.full_name) {
          const split = splitFullName(mapped.full_name);
          firstName = firstName || split.first_name;
          lastName = lastName || split.last_name;
          middleName = middleName || split.middle_name;
        }

        if (!firstName) {
          firstName = mapped.company_name || (mapped.phone ? `Клиент ${mapped.phone.slice(-4)}` : "Контакт");
        }

        // Формируем список телефонов
        const phones: ContactPhonePayload[] = [];
        if (mapped.phone) {
          phones.push({ number: mapped.phone });
        }
        if (mapped.additional_phone && mapped.additional_phone !== mapped.phone) {
          phones.push({ number: mapped.additional_phone });
        }

        // Формируем соцсети
        const socials: ContactSocialPayload[] = [];
        if (mapped.telegram_username) {
          socials.push({ kind: "telegram", value: mapped.telegram_username });
        }
        if (mapped.whatsapp) {
          socials.push({ kind: "whatsapp", value: mapped.whatsapp });
        }

        const contactPayload: CreateContactPayload = {
          first_name: firstName,
          last_name: lastName || undefined,
          middle_name: middleName || undefined,
          phones: phones.length > 0 ? phones : undefined,
          email: mapped.email || undefined,
          company_name: mapped.company_name || undefined,
          job_title: mapped.job_title || undefined,
          city: mapped.city || undefined,
          address: mapped.address || undefined,
          notes: mapped.notes || undefined,
          socials: socials.length > 0 ? socials : undefined,
          channel: mapped.telegram_username ? "telegram" : mapped.whatsapp ? "whatsapp" : "phone",
        };

        // Поиск дубликата
        let existingMatch: { id: string; companyId: string | null } | undefined;
        if (mapped.phone) {
          const digits = cleanDigits(mapped.phone);
          if (digits.length >= 7) {
            existingMatch = existingByPhone.get(digits.slice(-10));
          }
        }
        if (!existingMatch && mapped.email) {
          existingMatch = existingByEmail.get(mapped.email.toLowerCase().trim());
        }

        let contactId: string | null = null;
        let companyId: string | null = null;

        if (existingMatch) {
          if (payload.duplicateStrategy === "skip") {
            skippedCount++;
            continue;
          }

          if (payload.duplicateStrategy === "update") {
            const updated = await this.contactsService.update(
              tenantId,
              existingMatch.id,
              contactPayload,
            );
            if (updated) {
              contactId = updated.id;
              companyId = updated.companyId;
              updatedCount++;
            }
          }
        }

        if (!contactId) {
          const created = await this.contactsService.create(tenantId, contactPayload, actorId);
          contactId = created.id;
          companyId = created.companyId;
          importedCount++;

          // Запоминаем новый контакт в локальных картах для проверки последующих строк
          if (mapped.phone && cleanDigits(mapped.phone).length >= 7) {
            existingByPhone.set(cleanDigits(mapped.phone).slice(-10), { id: contactId, companyId });
          }
          if (mapped.email) {
            existingByEmail.set(mapped.email.toLowerCase().trim(), { id: contactId, companyId });
          }
        }

        // Опциональное создание сделки
        let createdDealId: string | undefined;
        if (payload.createDeal && contactId && targetPipelineId && targetStageId) {
          let dealTitle = "Сделка";
          const titleMode = payload.dealOptions?.titleMode || "field";

          if (titleMode === "random") {
            const code = Math.floor(1000 + Math.random() * 9000);
            dealTitle = `Сделка #${code}`;
          } else if (titleMode === "template" && payload.dealOptions?.titleTemplate) {
            dealTitle = payload.dealOptions.titleTemplate
              .replace(/{company}/gi, mapped.company_name || "")
              .replace(/{name}/gi, `${firstName} ${lastName}`.trim())
              .replace(/{phone}/gi, mapped.phone || "")
              .replace(/{email}/gi, mapped.email || "")
              .trim();
            if (!dealTitle) dealTitle = "Сделка";
          } else {
            const field = payload.dealOptions?.titleField || "company_name";
            if (field === "company_name" && mapped.company_name) {
              dealTitle = mapped.company_name;
            } else if (field === "first_name" || field === "full_name") {
              dealTitle = `${firstName} ${lastName}`.trim();
            } else if (field === "phone" && mapped.phone) {
              dealTitle = mapped.phone;
            } else {
              dealTitle = mapped.company_name || `${firstName} ${lastName}`.trim() || "Сделка";
            }
          }

          const deal = await this.dealsService.create(tenantId, actorId, {
            title: dealTitle,
            budget: 0,
            currency: "RUB",
            pipeline_id: targetPipelineId,
            stage_id: targetStageId,
            contact_id: contactId,
            company_id: companyId || undefined,
          });

          createdDealId = deal.id;
          dealsCreatedCount++;
        }

        // Запуск регламентного ресёрча (Contact Enrichment)
        if (payload.triggerResearch !== false && contactId) {
          void this.enrichmentService
            .enrichContact(tenantId, contactId, { dealId: createdDealId })
            .catch(() => {});
          researchTriggeredCount++;
        }
      } catch (err) {
        errors.push({
          rowIndex,
          error: err instanceof Error ? err.message : "Неизвестная ошибка создания контакта",
        });
      }
    }

    return {
      importedCount,
      updatedCount,
      skippedCount,
      dealsCreatedCount,
      researchTriggeredCount,
      errorCount: errors.length,
      errors,
    };
  }

  /**
   * Экспорт контактов в CSV или XLSX.
   */
  async exportContacts(
    tenantId: string,
    options: {
      format?: "csv" | "xlsx";
      search?: string;
      channel?: string;
    } = {},
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const format = options.format || "csv";
    const search = options.search;
    const channel = options.channel;
    const where: string[] = ["tenant_id = $1", "deleted_at IS NULL"];
    const params: SqlParam[] = [tenantId];

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      where.push(
        `(LOWER(first_name) LIKE $${params.length} OR LOWER(last_name) LIKE $${params.length} OR phone LIKE $${params.length} OR LOWER(COALESCE(email, '')) LIKE $${params.length} OR LOWER(company_name) LIKE $${params.length})`,
      );
    }

    if (channel && channel !== "all") {
      params.push(channel);
      where.push(`channel = $${params.length}`);
    }

    const rows = await query<{
      id: string;
      first_name: string;
      last_name: string;
      middle_name: string;
      phone: string;
      email: string | null;
      company_name: string;
      job_title: string;
      channel: string;
      telegram_username: string | null;
      whatsapp: string | null;
      city: string;
      address: string;
      notes: string;
      created_at: string;
    }>(
      `SELECT id, first_name, last_name, middle_name, phone, email,
              company_name, job_title, channel, telegram_username, whatsapp,
              city, address, notes, created_at
       FROM contacts
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC`,
      params,
    );

    const columns: ExportColumnDef<(typeof rows)[0]>[] = [
      { header: "Имя", key: "first_name", width: 18 },
      { header: "Фамилия", key: "last_name", width: 18 },
      { header: "Отчество", key: "middle_name", width: 18 },
      { header: "Телефон", key: "phone", width: 16 },
      { header: "Email", key: (item) => item.email ?? "", width: 22 },
      { header: "Компания", key: "company_name", width: 22 },
      { header: "Должность", key: "job_title", width: 18 },
      { header: "Канал", key: "channel", width: 12 },
      { header: "Telegram", key: (item) => item.telegram_username ? `@${item.telegram_username}` : "", width: 16 },
      { header: "WhatsApp", key: (item) => item.whatsapp ?? "", width: 16 },
      { header: "Город", key: "city", width: 16 },
      { header: "Адрес", key: "address", width: 25 },
      { header: "Заметки", key: "notes", width: 30 },
      { header: "Дата создания", key: (item) => new Date(item.created_at).toISOString().slice(0, 10), width: 14 },
    ];

    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      const buffer = buildCsvBuffer(columns, rows);
      return {
        buffer,
        filename: `contacts-${timestamp}.csv`,
        contentType: "text/csv; charset=utf-8",
      };
    }

    const buffer = await buildXlsxBuffer(columns, rows, "Контакты");
    return {
      buffer,
      filename: `contacts-${timestamp}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  /**
   * Экспорт сделок в CSV или XLSX.
   */
  async exportDeals(
    tenantId: string,
    options: {
      format?: "csv" | "xlsx";
      pipelineId?: string;
      search?: string;
    } = {},
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const format = options.format || "csv";
    const pipelineId = options.pipelineId;
    const search = options.search;
    const where: string[] = ["d.tenant_id = $1", "d.deleted_at IS NULL"];
    const params: SqlParam[] = [tenantId];

    if (pipelineId) {
      params.push(pipelineId);
      where.push(`d.pipeline_id = $${params.length}`);
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      where.push(`LOWER(d.title) LIKE $${params.length}`);
    }

    const rows = await query<{
      id: string;
      title: string;
      budget: string;
      currency: string;
      pipeline_name: string;
      stage_name: string;
      contact_name: string | null;
      company_name: string | null;
      close_date: string | null;
      created_at: string;
    }>(
      `SELECT d.id, d.title, d.budget::text, d.currency,
              p.name AS pipeline_name, s.name AS stage_name,
              c.first_name || ' ' || c.last_name AS contact_name,
              co.name AS company_name,
              d.close_date, d.created_at
       FROM deals d
       JOIN pipelines p ON p.id = d.pipeline_id
       JOIN stages s ON s.id = d.stage_id
       LEFT JOIN contacts c ON c.id = d.contact_id
       LEFT JOIN companies co ON co.id = d.company_id
       WHERE ${where.join(" AND ")}
       ORDER BY d.created_at DESC`,
      params,
    );

    const columns: ExportColumnDef<(typeof rows)[0]>[] = [
      { header: "Название сделки", key: "title", width: 25 },
      { header: "Воронка", key: "pipeline_name", width: 18 },
      { header: "Этап", key: "stage_name", width: 18 },
      { header: "Бюджет", key: "budget", width: 14 },
      { header: "Валюта", key: "currency", width: 8 },
      { header: "Контакт", key: (item) => item.contact_name?.trim() ?? "", width: 20 },
      { header: "Компания", key: (item) => item.company_name ?? "", width: 20 },
      { header: "Дата закрытия", key: (item) => item.close_date ?? "", width: 14 },
      { header: "Дата создания", key: (item) => new Date(item.created_at).toISOString().slice(0, 10), width: 14 },
    ];

    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      const buffer = buildCsvBuffer(columns, rows);
      return {
        buffer,
        filename: `deals-${timestamp}.csv`,
        contentType: "text/csv; charset=utf-8",
      };
    }

    const buffer = await buildXlsxBuffer(columns, rows, "Сделки");
    return {
      buffer,
      filename: `deals-${timestamp}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  private extractRowFields(row: string[], mapping: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [colIdxStr, fieldKey] of Object.entries(mapping)) {
      if (fieldKey === "skip") continue;
      const colIdx = parseInt(colIdxStr, 10);
      if (!Number.isNaN(colIdx) && row[colIdx] !== undefined) {
        result[fieldKey] = row[colIdx].trim();
      }
    }
    return result;
  }
}

export { ContactsIOService as ContactsIoService };
