import { withTenant, type SqlParam } from "../../db/client.js";
import { AppError } from "../../plugins/errorHandler.js";
import { ALL_PRESETS, INTAKE_ACT_PRESET } from "./print-presets.js";
import {
  printLayoutConfigSchema,
  type CreatePrintTemplatePayload,
  type PrintLayoutConfig,
  type PrintTemplateDTO,
  type PrintTemplateRow,
  type PrintTemplateSettingsDTO,
  type PrintTemplateSettingsRow,
  type UpdatePrintTemplatePayload,
  type UpdatePrintTemplateSettingsPayload,
} from "./print-templates.types.js";

export function formatTicketNumber(
  rawNumber: string,
  format: "compact" | "full" = "compact",
  prefix: string = "№",
): string {
  if (!rawNumber) return "";
  const clean = rawNumber.trim();
  const match = clean.match(/(?:.*-)?(\d+)$/);
  const digits = match && match[1] ? match[1] : clean.replace(/^[^0-9]+/, "");

  if (format === "full") {
    if (clean.includes("-") && !clean.startsWith("№")) {
      return clean;
    }
    const year = new Date().getFullYear();
    const padDigits = digits ? digits.padStart(4, "0") : "0001";
    return `ЗН-${year}-${padDigits}`;
  }

  const padDigits = digits ? digits.padStart(4, "0") : clean;
  const cleanPrefix = prefix ? prefix.trim() : "№";
  return `${cleanPrefix}${padDigits}`;
}

function parsePageSize(val: string | null | undefined): "A4" | "A5" | "thermal_80mm" {
  if (val === "A5" || val === "thermal_80mm") return val;
  return "A4";
}

function parseOrientation(val: string | null | undefined): "portrait" | "landscape" {
  return val === "landscape" ? "landscape" : "portrait";
}

function toIso(val: Date | string | null | undefined): string {
  if (!val) return new Date().toISOString();
  return typeof val === "string" ? new Date(val).toISOString() : val.toISOString();
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatDateRu(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * Сумма прописью на русском языке
 */
export function numberToWordsRu(num: number): string {
  if (num === 0) return "Ноль рублей 00 копеек";
  const units: string[][] = [
    ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
    ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
  ];
  const teens: string[] = [
    "десять",
    "одиннадцать",
    "двенадцать",
    "тринадцать",
    "четырнадцать",
    "пятнадцать",
    "шестнадцать",
    "семнадцать",
    "восемнадцать",
    "девятнадцать",
  ];
  const tens: string[] = [
    "",
    "",
    "двадцать",
    "тридцать",
    "сорок",
    "пятьдесят",
    "шестьдесят",
    "семьдесят",
    "восемьдесят",
    "девяносто",
  ];
  const hundreds: string[] = [
    "",
    "сто",
    "двести",
    "триста",
    "четыреста",
    "пятьсот",
    "шестьсот",
    "семьсот",
    "восемьсот",
    "девяносто",
  ];

  function plural(n: number, forms: [string, string, string]): string {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n100 >= 11 && n100 <= 19) return forms[2];
    if (n10 === 1) return forms[0];
    if (n10 >= 2 && n10 <= 4) return forms[1];
    return forms[2];
  }

  const intPart = Math.floor(Math.abs(num));
  const kopPart = Math.round((Math.abs(num) - intPart) * 100);

  function triad(t: number, gender: 0 | 1): string {
    if (t === 0) return "";
    const h = Math.floor(t / 100);
    const rem = t % 100;
    const d = Math.floor(rem / 10);
    const u = rem % 10;
    const words: string[] = [];
    if (h > 0 && hundreds[h]) words.push(hundreds[h]);
    if (d === 1 && teens[u]) {
      words.push(teens[u]);
    } else {
      if (d > 0 && tens[d]) words.push(tens[d]);
      const genderUnits = units[gender];
      if (genderUnits && u > 0 && genderUnits[u]) words.push(genderUnits[u]);
    }
    return words.join(" ");
  }

  const millions = Math.floor(intPart / 1000000);
  const thousands = Math.floor((intPart % 1000000) / 1000);
  const remainder = intPart % 1000;

  const parts: string[] = [];
  if (millions > 0) {
    const mStr = triad(millions, 0);
    if (mStr) parts.push(mStr);
    parts.push(plural(millions, ["миллион", "миллиона", "миллионов"]));
  }
  if (thousands > 0) {
    const tStr = triad(thousands, 1);
    if (tStr) parts.push(tStr);
    parts.push(plural(thousands, ["тысяча", "тысячи", "тысяч"]));
  }
  if (remainder > 0 || parts.length === 0) {
    const rStr = triad(remainder, 0);
    if (rStr) parts.push(rStr);
  }

  const rublesStr = parts.filter(Boolean).join(" ").trim();
  const rublesForm = plural(intPart, ["рубль", "рубля", "рублей"]);
  const kopForm = plural(kopPart, ["копейка", "копейки", "копеек"]);
  const kopStr = String(kopPart).padStart(2, "0");

  const full = `${rublesStr} ${rublesForm} ${kopStr} ${kopForm}`.trim();
  return full.charAt(0).toUpperCase() + full.slice(1);
}

function toSettingsDto(row: PrintTemplateSettingsRow): PrintTemplateSettingsDTO {
  return {
    id: row.id,
    companyName: row.company_name,
    companyAddress: row.company_address,
    companyPhone: row.company_phone,
    companyEmail: row.company_email,
    companyWebsite: row.company_website,
    companyInn: row.company_inn,
    companyOgrn: row.company_ogrn,
    workingHours: row.working_hours,
    logoUrl: row.logo_url,
    numberingFormat: row.numbering_format === "full" ? "full" : "compact",
    numberingPrefix: row.numbering_prefix || "№",
    intakeTerms: row.intake_terms,
    intakePdnConsent: row.intake_pdn_consent,
    showEquipmentSerial: Boolean(row.show_equipment_serial),
    showAppearance: Boolean(row.show_appearance),
    showPackageContents: Boolean(row.show_package_contents),
    showDefectDescription: Boolean(row.show_defect_description),
    showEstimatedCost: Boolean(row.show_estimated_cost),
    showClientTearOffTicket: Boolean(row.show_client_tear_off_ticket),
    showIntakeSignatures: Boolean(row.show_intake_signatures),
    warrantyTerms: row.warranty_terms,
    returnPolicy: row.return_policy,
    showWorksTable: Boolean(row.show_works_table),
    showPartsTable: Boolean(row.show_parts_table),
    showCompletionSignatures: Boolean(row.show_completion_signatures),
    showCompletionStamp: Boolean(row.show_completion_stamp),
    updatedAt: toIso(row.updated_at),
  };
}

function toTemplateDto(row: PrintTemplateRow): PrintTemplateDTO {
  let parsedConfig: PrintLayoutConfig;
  try {
    const raw =
      typeof row.layout_config === "string"
        ? JSON.parse(row.layout_config)
        : row.layout_config;
    parsedConfig = printLayoutConfigSchema.parse(raw ?? {});
  } catch {
    const preset =
      ALL_PRESETS.find((p) => p.slug === row.slug || p.documentType === row.document_type) ??
      INTAKE_ACT_PRESET;
    parsedConfig = preset.layoutConfig;
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    documentType: row.document_type || row.slug || "work_order",
    pageSize: parsePageSize(row.page_size),
    orientation: parseOrientation(row.orientation),
    bodyTemplate: row.body_template || "",
    layoutConfig: parsedConfig,
    isDefault: Boolean(row.is_default),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class PrintTemplatesService {
  /**
   * Убедиться, что базовые пресеты созданы для тенанта
   */
  async ensureTemplates(tenantId: string): Promise<void> {
    await withTenant(tenantId, async (tx) => {
      for (const preset of ALL_PRESETS) {
        const existing = await tx.query<PrintTemplateRow>(
          `SELECT id, layout_config FROM print_templates WHERE tenant_id = $1 AND document_type = $2 LIMIT 1`,
          [tenantId, preset.documentType],
        );

        const first = existing[0];
        if (!first) {
          await tx.query(
            `INSERT INTO print_templates (
              tenant_id, slug, name, description, document_type, page_size, orientation, body_template, layout_config, is_default
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
            [
              tenantId,
              preset.slug,
              preset.name,
              preset.description,
              preset.documentType,
              preset.pageSize,
              preset.orientation,
              "",
              JSON.stringify(preset.layoutConfig),
            ],
          );
        } else if (
          !first.layout_config ||
          Object.keys(first.layout_config).length === 0
        ) {
          await tx.query(
            `UPDATE print_templates
             SET layout_config = $1, document_type = $2
             WHERE id = $3`,
            [JSON.stringify(preset.layoutConfig), preset.documentType, first.id],
          );
        }
      }
    });
  }

  async list(tenantId: string, documentType?: string): Promise<PrintTemplateDTO[]> {
    await this.ensureTemplates(tenantId);

    return await withTenant(tenantId, async (tx) => {
      const params: SqlParam[] = [tenantId];
      let sql = `
        SELECT id, tenant_id, slug, name, description, document_type, page_size, orientation, body_template, layout_config, is_default, created_at, updated_at
        FROM print_templates
        WHERE tenant_id = $1
      `;

      if (documentType) {
        params.push(documentType);
        sql += ` AND document_type = $2`;
      }

      sql += ` ORDER BY is_default DESC, name ASC`;

      const rows = await tx.query<PrintTemplateRow>(sql, params);
      return rows.map(toTemplateDto);
    });
  }

  async getById(tenantId: string, id: string): Promise<PrintTemplateDTO | null> {
    return await withTenant(tenantId, async (tx) => {
      const row = await tx.queryOne<PrintTemplateRow>(
        `SELECT id, tenant_id, slug, name, description, document_type, page_size, orientation, body_template, layout_config, is_default, created_at, updated_at
         FROM print_templates
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return row ? toTemplateDto(row) : null;
    });
  }

  async getBySlug(tenantId: string, slugOrType: string): Promise<PrintTemplateDTO | null> {
    await this.ensureTemplates(tenantId);

    return await withTenant(tenantId, async (tx) => {
      // 1. Поиск по id (если это UUID)
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          slugOrType,
        );
      if (isUuid) {
        const byId = await tx.queryOne<PrintTemplateRow>(
          `SELECT id, tenant_id, slug, name, description, document_type, page_size, orientation, body_template, layout_config, is_default, created_at, updated_at
           FROM print_templates
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, slugOrType],
        );
        if (byId) return toTemplateDto(byId);
      }

      // 2. Поиск по слагу
      const bySlug = await tx.queryOne<PrintTemplateRow>(
        `SELECT id, tenant_id, slug, name, description, document_type, page_size, orientation, body_template, layout_config, is_default, created_at, updated_at
         FROM print_templates
         WHERE tenant_id = $1 AND slug = $2
         ORDER BY is_default DESC
         LIMIT 1`,
        [tenantId, slugOrType],
      );
      if (bySlug) return toTemplateDto(bySlug);

      // 3. Поиск по document_type (дефолтный шаблон этого типа)
      const byDocType = await tx.queryOne<PrintTemplateRow>(
        `SELECT id, tenant_id, slug, name, description, document_type, page_size, orientation, body_template, layout_config, is_default, created_at, updated_at
         FROM print_templates
         WHERE tenant_id = $1 AND document_type = $2 AND is_default = true
         LIMIT 1`,
        [tenantId, slugOrType],
      );
      if (byDocType) return toTemplateDto(byDocType);

      return null;
    });
  }

  async create(
    tenantId: string,
    payload: CreatePrintTemplatePayload,
  ): Promise<PrintTemplateDTO> {
    return await withTenant(tenantId, async (tx) => {
      let layoutConfig: PrintLayoutConfig;
      let bodyTemplate = payload.body_template || "";
      let pageSize = payload.page_size || "A4";
      let orientation = payload.orientation || "portrait";

      if (payload.clone_from_id) {
        const sourceRows = await tx.query<PrintTemplateRow>(
          `SELECT layout_config, body_template, page_size, orientation FROM print_templates WHERE tenant_id = $1 AND id = $2`,
          [tenantId, payload.clone_from_id],
        );
        const s = sourceRows[0];
        if (s) {
          let parsed: PrintLayoutConfig;
          try {
            const raw = typeof s.layout_config === "string" ? JSON.parse(s.layout_config) : s.layout_config;
            parsed = printLayoutConfigSchema.parse(raw);
          } catch {
            parsed = INTAKE_ACT_PRESET.layoutConfig;
          }
          layoutConfig = payload.layout_config ?? parsed;
          bodyTemplate = s.body_template;
          pageSize = parsePageSize(s.page_size);
          orientation = parseOrientation(s.orientation);
        } else {
          layoutConfig = payload.layout_config ?? INTAKE_ACT_PRESET.layoutConfig;
        }
      } else {
        const preset =
          ALL_PRESETS.find((p) => p.documentType === payload.document_type) ??
          INTAKE_ACT_PRESET;
        layoutConfig = payload.layout_config ?? preset.layoutConfig;
      }

      const docType = payload.document_type || "work_order";
      const slug = `${docType}_${Date.now().toString(36)}`;

      if (payload.is_default) {
        await tx.query(
          `UPDATE print_templates SET is_default = false WHERE tenant_id = $1 AND document_type = $2`,
          [tenantId, docType],
        );
      }

      const rows = await tx.query<PrintTemplateRow>(
        `INSERT INTO print_templates (
          tenant_id, slug, name, description, document_type, page_size, orientation, body_template, layout_config, is_default
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          tenantId,
          slug,
          payload.name,
          payload.description || "",
          docType,
          pageSize,
          orientation,
          bodyTemplate,
          JSON.stringify(layoutConfig),
          Boolean(payload.is_default),
        ],
      );

      const createdRow = rows[0];
      if (!createdRow) {
        throw new AppError(500, "CREATE_FAILED", "Не удалось создать шаблон");
      }
      return toTemplateDto(createdRow);
    });
  }

  async update(
    tenantId: string,
    id: string,
    payload: UpdatePrintTemplatePayload,
  ): Promise<PrintTemplateDTO | null> {
    return await withTenant(tenantId, async (tx) => {
      const existingRows = await tx.query<PrintTemplateRow>(
        `SELECT * FROM print_templates WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const current = existingRows[0];
      if (!current) return null;
      const docType = payload.document_type ?? current.document_type;

      if (payload.is_default) {
        await tx.query(
          `UPDATE print_templates SET is_default = false WHERE tenant_id = $1 AND document_type = $2 AND id != $3`,
          [tenantId, docType, id],
        );
      }

      const name = payload.name ?? current.name;
      const description = payload.description ?? current.description;
      const pageSize = payload.page_size ?? current.page_size;
      const orientation = payload.orientation ?? current.orientation;
      const bodyTemplate = payload.body_template ?? current.body_template;
      const layoutConfig = payload.layout_config ?? current.layout_config;
      const isDefault =
        payload.is_default !== undefined ? payload.is_default : current.is_default;

      const rows = await tx.query<PrintTemplateRow>(
        `UPDATE print_templates
         SET name = $1, description = $2, document_type = $3, page_size = $4, orientation = $5,
             body_template = $6, layout_config = $7, is_default = $8, updated_at = now()
         WHERE tenant_id = $9 AND id = $10
         RETURNING *`,
        [
          name,
          description,
          docType,
          pageSize,
          orientation,
          bodyTemplate,
          JSON.stringify(layoutConfig),
          isDefault,
          tenantId,
          id,
        ],
      );

      const updatedRow = rows[0];
      if (!updatedRow) return null;
      return toTemplateDto(updatedRow);
    });
  }

  async setDefault(tenantId: string, id: string): Promise<PrintTemplateDTO> {
    return await withTenant(tenantId, async (tx) => {
      const tplRows = await tx.query<PrintTemplateRow>(
        `SELECT * FROM print_templates WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const tpl = tplRows[0];
      if (!tpl) {
        throw new AppError(404, "TEMPLATE_NOT_FOUND", "Шаблон не найден");
      }

      await tx.query(
        `UPDATE print_templates
         SET is_default = false
         WHERE tenant_id = $1 AND document_type = $2`,
        [tenantId, tpl.document_type],
      );

      const rows = await tx.query<PrintTemplateRow>(
        `UPDATE print_templates
         SET is_default = true, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, id],
      );

      const updatedRow = rows[0];
      if (!updatedRow) {
        throw new AppError(500, "SET_DEFAULT_FAILED", "Не удалось установить шаблон по умолчанию");
      }
      return toTemplateDto(updatedRow);
    });
  }

  async delete(tenantId: string, id: string): Promise<{ success: boolean; message?: string }> {
    return await withTenant(tenantId, async (tx) => {
      const existingRows = await tx.query<PrintTemplateRow>(
        `SELECT * FROM print_templates WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const tpl = existingRows[0];
      if (!tpl) {
        throw new AppError(404, "TEMPLATE_NOT_FOUND", "Шаблон не найден");
      }

      const countRows = await tx.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM print_templates WHERE tenant_id = $1 AND document_type = $2`,
        [tenantId, tpl.document_type],
      );
      const firstCount = countRows[0];
      const totalCount = firstCount ? parseInt(firstCount.count, 10) : 0;
      if (totalCount <= 1) {
        throw new AppError(
          400,
          "CANNOT_DELETE_LAST",
          "Нельзя удалить единственный шаблон для данного типа документа",
        );
      }

      await tx.query(`DELETE FROM print_templates WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        id,
      ]);

      // Если удален дефолтный шаблон, назначаем оставшийся дефолтным
      if (tpl.is_default) {
        await tx.query(
          `UPDATE print_templates
           SET is_default = true
           WHERE id = (
             SELECT id FROM print_templates
             WHERE tenant_id = $1 AND document_type = $2
             ORDER BY updated_at DESC
             LIMIT 1
           )`,
          [tenantId, tpl.document_type],
        );
      }

      return { success: true };
    });
  }

  // ---------------------------------------------------------------------------
  // Настройки печати тенанта (Print Template Settings)
  // ---------------------------------------------------------------------------

  async getSettings(tenantId: string): Promise<PrintTemplateSettingsDTO> {
    return await withTenant(tenantId, async (tx) => {
      let row = await tx.queryOne<PrintTemplateSettingsRow>(
        `SELECT * FROM print_template_settings WHERE tenant_id = $1`,
        [tenantId],
      );

      if (!row) {
        row = await tx.queryOne<PrintTemplateSettingsRow>(
          `INSERT INTO print_template_settings (tenant_id)
           VALUES ($1)
           ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
           RETURNING *`,
          [tenantId],
        );
      }

      if (!row) {
        throw new AppError(500, "SETTINGS_ERROR", "Не удалось загрузить настройки печати");
      }

      return toSettingsDto(row);
    });
  }

  async updateSettings(
    tenantId: string,
    payload: UpdatePrintTemplateSettingsPayload,
  ): Promise<PrintTemplateSettingsDTO> {
    await this.getSettings(tenantId);

    return await withTenant(tenantId, async (tx) => {
      const fields: string[] = [];
      const values: SqlParam[] = [tenantId];
      let idx = 2;

      const allowedCols: (keyof UpdatePrintTemplateSettingsPayload)[] = [
        "company_name",
        "company_address",
        "company_phone",
        "company_email",
        "company_website",
        "company_inn",
        "company_ogrn",
        "working_hours",
        "logo_url",
        "numbering_format",
        "numbering_prefix",
        "intake_terms",
        "intake_pdn_consent",
        "show_equipment_serial",
        "show_appearance",
        "show_package_contents",
        "show_defect_description",
        "show_estimated_cost",
        "show_client_tear_off_ticket",
        "show_intake_signatures",
        "warranty_terms",
        "return_policy",
        "show_works_table",
        "show_parts_table",
        "show_completion_signatures",
        "show_completion_stamp",
      ];

      for (const col of allowedCols) {
        if (payload[col] !== undefined) {
          fields.push(`${col} = $${idx}`);
          values.push(payload[col] as SqlParam);
          idx++;
        }
      }

      if (fields.length === 0) {
        return this.getSettings(tenantId);
      }

      fields.push("updated_at = now()");

      const row = await tx.queryOne<PrintTemplateSettingsRow>(
        `UPDATE print_template_settings
         SET ${fields.join(", ")}
         WHERE tenant_id = $1
         RETURNING *`,
        values,
      );

      if (!row) {
        throw new AppError(500, "SETTINGS_UPDATE_ERROR", "Не удалось обновить настройки печати");
      }

      return toSettingsDto(row);
    });
  }

  // ---------------------------------------------------------------------------
  // Рендер документов
  // ---------------------------------------------------------------------------

  async renderForOrder(
    tenantId: string,
    templateIdOrSlug: string,
    orderId: string,
  ): Promise<string> {
    const tpl = await this.getBySlug(tenantId, templateIdOrSlug);
    if (!tpl) {
      throw new AppError(404, "TEMPLATE_NOT_FOUND", "Шаблон печати не найден");
    }

    const settings = await this.getSettings(tenantId);

    // Загружаем данные наряда, работы и запчасти с изоляцией тенанта
    const { order, works, parts } = await withTenant(tenantId, async (tx) => {
      const ord = await tx.queryOne<{
        ticket_number: string;
        customer_name: string;
        customer_phone: string;
        equipment_type: string;
        equipment_brand: string;
        equipment_model: string;
        equipment_serial: string;
        defect_description: string;
        appearance: string;
        package_contents: string;
        malfunctions: string[];
        master_name: string;
        estimated_cost: string;
        final_cost: string | null;
        received_at: Date;
        completed_at: Date | null;
      }>(
        `SELECT ticket_number, customer_name, customer_phone,
                equipment_type, equipment_brand, equipment_model, equipment_serial,
                defect_description, appearance, package_contents, malfunctions,
                master_name, estimated_cost, final_cost, received_at, completed_at
         FROM repair_orders
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, orderId],
      );

      if (!ord) {
        throw new AppError(404, "ORDER_NOT_FOUND", "Заказ-наряд не найден");
      }

      const w = await tx.query<{
        description: string;
        master_name: string;
        quantity: string | number;
        unit_price: string | number;
        cost: string | number;
      }>(
        `SELECT description, master_name, quantity, unit_price, cost
         FROM repair_works
         WHERE tenant_id = $1 AND repair_order_id = $2
         ORDER BY created_at ASC`,
        [tenantId, orderId],
      );

      const p = await tx.query<{
        name: string;
        article: string;
        quantity: string | number;
        retail_price: string | number;
      }>(
        `SELECT name, article, quantity, retail_price
         FROM repair_parts
         WHERE tenant_id = $1 AND repair_order_id = $2
         ORDER BY created_at ASC`,
        [tenantId, orderId],
      );

      return { order: ord, works: w, parts: p };
    });

    const cfg = tpl.layoutConfig;
    const cleanNumber = formatTicketNumber(
      order.ticket_number,
      settings.numberingFormat,
      settings.numberingPrefix,
    );

    let worksSum = 0;
    const worksItems = works.map((w, idx) => {
      const q = Number(w.quantity ?? 1);
      const cost = Number(w.cost);
      const price = w.unit_price ? Number(w.unit_price) : q > 0 ? cost / q : cost;
      worksSum += cost;
      return { num: idx + 1, name: w.description, qty: q, unit: "шт.", price, total: cost };
    });

    let partsSum = 0;
    const partsItems = parts.map((p, idx) => {
      const q = Number(p.quantity ?? 1);
      const price = Number(p.retail_price ?? 0);
      const cost = q * price;
      partsSum += cost;
      return { num: idx + 1, name: p.name, qty: q, unit: "шт.", price, total: cost };
    });

    const totalSum = worksSum + partsSum;

    return this.generateA4Html({
      tpl,
      cfg,
      settings,
      order,
      cleanNumber,
      worksItems,
      partsItems,
      worksSum,
      partsSum,
      totalSum,
    });
  }

  /**
   * Генерация HTML страницы документа А4 с идеальной версткой @media print
   */
  private generateA4Html(data: {
    tpl: PrintTemplateDTO;
    cfg: PrintLayoutConfig;
    settings: PrintTemplateSettingsDTO;
    order: {
      customer_name: string;
      customer_phone: string;
      equipment_type: string;
      equipment_brand: string;
      equipment_model: string;
      equipment_serial: string;
      defect_description: string;
      appearance: string;
      package_contents: string;
      master_name: string;
      estimated_cost: string;
      received_at: Date;
      completed_at: Date | null;
    };
    cleanNumber: string;
    worksItems: Array<{ num: number; name: string; qty: number; unit: string; price: number; total: number }>;
    partsItems: Array<{ num: number; name: string; qty: number; unit: string; price: number; total: number }>;
    worksSum: number;
    partsSum: number;
    totalSum: number;
  }): string {
    const { cfg, settings, order, cleanNumber, worksItems, partsItems, worksSum, partsSum, totalSum } = data;

    const companyName = cfg.header.companyName || settings.companyName || "Сервисный центр";
    const companyPhone = cfg.header.companyPhone || settings.companyPhone || "";
    const companyAddress = cfg.header.companyAddress || settings.companyAddress || "";
    const companyInn = cfg.header.companyInn || settings.companyInn || "";
    const companyOgrn = cfg.header.companyOgrn || settings.companyOgrn || "";
    const logoUrl = cfg.header.showLogo ? (cfg.header.logoUrl || settings.logoUrl) : "";
    const dateFormatted = formatDateRu(order.received_at);

    // Margin styles
    const marginMm = cfg.theme.margins === "compact" ? "8mm" : cfg.theme.margins === "spacious" ? "20mm" : "14mm";
    const baseFontSize = cfg.theme.fontSize === "small" ? "11px" : cfg.theme.fontSize === "large" ? "13px" : "12px";

    // Секции по порядку
    const sectionsHtml: string[] = [];
    const orderSections = cfg.sectionsOrder || [
      "header",
      "customer",
      "equipment",
      "works_table",
      "parts_table",
      "totals",
      "terms",
      "signatures",
      "tear_off_ticket",
    ];

    for (const sec of orderSections) {
      if (sec === "header") {
        sectionsHtml.push(`
          <div class="doc-header section-block">
            <div class="header-main">
              ${
                logoUrl
                  ? `<div class="company-logo"><img src="${logoUrl}" style="max-width: ${cfg.header.logoWidth || 140}px; max-height: 60px; object-fit: contain;" alt="Logo" /></div>`
                  : ""
              }
              <div class="company-info">
                <div class="company-title">${companyName}</div>
                ${companyAddress ? `<div class="company-meta">${companyAddress}</div>` : ""}
                <div class="company-meta">
                  ${companyPhone ? `Тел: <strong>${companyPhone}</strong>` : ""}
                  ${companyInn ? ` | ИНН: ${companyInn}` : ""}
                  ${companyOgrn ? ` | ОГРН: ${companyOgrn}` : ""}
                </div>
              </div>
            </div>
            <div class="header-doc-title">
              <h1 class="doc-h1">${cfg.header.documentTitle || "ЗАКАЗ-НАРЯД"}</h1>
              <div class="doc-number-row">
                ${cfg.header.showDocNumber ? `<span class="doc-num-badge">${cleanNumber}</span>` : ""}
                ${cfg.header.showDate ? `<span class="doc-date">от ${dateFormatted}</span>` : ""}
              </div>
              ${cfg.header.documentSubtitle ? `<div class="doc-sub">${cfg.header.documentSubtitle}</div>` : ""}
            </div>
          </div>
        `);
      } else if (sec === "customer" && cfg.customer.visible) {
        sectionsHtml.push(`
          <div class="info-card section-block">
            <div class="card-head">${cfg.customer.title || "Заказчик / Клиент"}</div>
            <div class="card-body grid-2">
              <div><strong>ФИО:</strong> ${order.customer_name || "—"}</div>
              <div><strong>Телефон:</strong> ${order.customer_phone || "—"}</div>
            </div>
          </div>
        `);
      } else if (sec === "equipment" && cfg.equipment.visible) {
        sectionsHtml.push(`
          <div class="info-card section-block">
            <div class="card-head">${cfg.equipment.title || "Оборудование и неисправность"}</div>
            <div class="card-body">
              <div class="grid-2">
                <div><strong>Техника:</strong> ${order.equipment_type || ""} ${order.equipment_brand || ""} ${order.equipment_model || ""}</div>
                ${cfg.equipment.showSerial ? `<div><strong>Серийный номер / IMEI:</strong> ${order.equipment_serial || "—"}</div>` : ""}
              </div>
              ${cfg.equipment.showDefect ? `<div class="mt-1"><strong>Неисправность со слов клиента:</strong> ${order.defect_description || "—"}</div>` : ""}
              ${cfg.equipment.showAppearance ? `<div class="mt-1"><strong>Внешний вид / состояние:</strong> ${order.appearance || "Б/У, следы эксплуатации"}</div>` : ""}
              ${cfg.equipment.showPackage ? `<div class="mt-1"><strong>Комплектация:</strong> ${order.package_contents || "Без комплекта"}</div>` : ""}
              <div class="grid-2 mt-1">
                ${cfg.equipment.showMaster ? `<div><strong>Ответственный мастер:</strong> ${order.master_name || "Назначен дежурный специалист"}</div>` : ""}
                ${cfg.equipment.showEstimatedCost && order.estimated_cost ? `<div><strong>Ориентировочная стоимость:</strong> ${order.estimated_cost}</div>` : ""}
              </div>
            </div>
          </div>
        `);
      } else if (sec === "works_table" && cfg.table.visible && cfg.table.showWorks) {
        sectionsHtml.push(`
          <div class="table-section section-block">
            <div class="table-title">${cfg.table.worksTitle || "Выполненные работы и услуги"}</div>
            ${
              worksItems.length > 0
                ? `
              <table class="data-table">
                <thead>
                  <tr>
                    <th style="width: 35px; text-align: center;">№</th>
                    <th>Наименование работ</th>
                    <th style="width: 60px; text-align: center;">Кол-во</th>
                    <th style="width: 90px; text-align: right;">Цена</th>
                    <th style="width: 95px; text-align: right;">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  ${worksItems
                    .map(
                      (w) => `
                    <tr>
                      <td style="text-align: center;">${w.num}</td>
                      <td><strong>${w.name}</strong></td>
                      <td style="text-align: center;">${w.qty}</td>
                      <td style="text-align: right;">${formatMoney(w.price)}</td>
                      <td style="text-align: right;"><strong>${formatMoney(w.total)}</strong></td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            `
                : `<div class="empty-hint">Работы по наряду не добавлены</div>`
            }
          </div>
        `);
      } else if (sec === "parts_table" && cfg.table.visible && cfg.table.showParts) {
        sectionsHtml.push(`
          <div class="table-section section-block">
            <div class="table-title">${cfg.table.partsTitle || "Использованные запчасти и материалы"}</div>
            ${
              partsItems.length > 0
                ? `
              <table class="data-table">
                <thead>
                  <tr>
                    <th style="width: 35px; text-align: center;">№</th>
                    <th>Наименование запчасти / детали</th>
                    <th style="width: 60px; text-align: center;">Кол-во</th>
                    <th style="width: 90px; text-align: right;">Цена</th>
                    <th style="width: 95px; text-align: right;">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  ${partsItems
                    .map(
                      (p) => `
                    <tr>
                      <td style="text-align: center;">${p.num}</td>
                      <td>${p.name}</td>
                      <td style="text-align: center;">${p.qty}</td>
                      <td style="text-align: right;">${formatMoney(p.price)}</td>
                      <td style="text-align: right;"><strong>${formatMoney(p.total)}</strong></td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            `
                : `<div class="empty-hint">Запасные части не использовались</div>`
            }
          </div>
        `);
      } else if (sec === "totals" && cfg.table.visible && cfg.table.showTotals) {
        sectionsHtml.push(`
          <div class="totals-container section-block page-break-avoid">
            <div class="totals-lines">
              ${worksSum > 0 ? `<div class="tot-row"><span>Итого по работам:</span> <strong>${formatMoney(worksSum)}</strong></div>` : ""}
              ${partsSum > 0 ? `<div class="tot-row"><span>Итого по запчастям:</span> <strong>${formatMoney(partsSum)}</strong></div>` : ""}
              <div class="tot-row grand"><span>ИТОГО К ОПЛАТЕ:</span> <span class="grand-val">${formatMoney(totalSum)}</span></div>
            </div>
            ${
              cfg.table.showGrandTotalWords && totalSum > 0
                ? `<div class="total-words">Сумма прописью: <em>${numberToWordsRu(totalSum)}</em></div>`
                : ""
            }
          </div>
        `);
      } else if (sec === "terms" && cfg.terms.visible) {
        const termsBody = cfg.terms.termsText || settings.warrantyTerms || settings.intakeTerms;
        sectionsHtml.push(`
          <div class="terms-card section-block page-break-avoid">
            <div class="terms-title">${cfg.terms.title || "Условия и гарантийные обязательства"}</div>
            <div class="terms-text">${(termsBody || "").replace(/\n/g, "<br>")}</div>
            ${
              cfg.terms.showPdnConsent && cfg.terms.pdnText
                ? `<div class="pdn-text">${cfg.terms.pdnText}</div>`
                : ""
            }
          </div>
        `);
      } else if (sec === "signatures" && cfg.signatures.visible) {
        sectionsHtml.push(`
          <div class="signatures-block section-block page-break-avoid">
            <div class="sig-side">
              <div>${cfg.signatures.executorTitle || "Исполнитель"}: ________________ / ${order.master_name || "СЦ"}</div>
              ${cfg.signatures.showStamp ? `<div class="stamp-box">${cfg.signatures.stampText || "М.П."}</div>` : ""}
            </div>
            <div class="sig-side">
              <div>${cfg.signatures.clientTitle || "Заказчик"}: ________________ / ${order.customer_name || "Клиент"}</div>
              <div class="sig-hint">(подпись подтверждает согласие с условиями и объемом)</div>
            </div>
          </div>
        `);
      } else if (sec === "tear_off_ticket" && cfg.tearOffTicket.visible) {
        sectionsHtml.push(`
          <div class="tear-off-block section-block page-break-avoid">
            <div class="tear-line">
              <span>✂ - - - - - - - - - - - - - - - - - - - - - - - ЛИНИЯ ОТРЫВА - - - - - - - - - - - - - - - - - - - - - - - ✂</span>
            </div>
            <div class="tear-content">
              <div class="tear-header">
                <strong>${cfg.tearOffTicket.title || "ОТРЫВНОЙ ТАЛОН КЛИЕНТА"}</strong> — Наряд ${cleanNumber} от ${dateFormatted}
              </div>
              <div class="tear-body">
                <div>Клиент: <strong>${order.customer_name || "—"}</strong> (тел: ${order.customer_phone || "—"})</div>
                <div>Принято: <strong>${order.equipment_type || ""} ${order.equipment_brand || ""} ${order.equipment_model || ""}</strong> (S/N: ${order.equipment_serial || "—"})</div>
                <div>Сервис: ${companyName} | Тел: ${companyPhone}</div>
                <div class="tear-note">${cfg.tearOffTicket.customNote || "Сохраняйте данный талон до момента выдачи оборудования."}</div>
              </div>
            </div>
          </div>
        `);
      }
    }

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${cfg.header.documentTitle || "Печатная форма"} ${cleanNumber}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: '${cfg.theme.fontFamily || "Inter"}', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: ${baseFontSize};
      color: #111111;
      background: #f5f5f5;
      line-height: 1.35;
      -webkit-font-smoothing: antialiased;
    }

    .page-sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 15px auto;
      padding: ${marginMm};
      background: #ffffff;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      position: relative;
    }

    .section-block {
      margin-bottom: 9px;
    }

    /* Хедер */
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #111111;
      padding-bottom: 8px;
      gap: 16px;
    }
    .header-main {
      display: flex;
      gap: 12px;
      align-items: center;
      max-width: 58%;
    }
    .company-title {
      font-size: 13px;
      font-weight: 700;
      color: #111111;
      line-height: 1.2;
    }
    .company-meta {
      font-size: 10px;
      color: #555555;
      margin-top: 2px;
    }
    .header-doc-title {
      text-align: right;
    }
    .doc-h1 {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: #111111;
      text-transform: uppercase;
    }
    .doc-number-row {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 6px;
      margin-top: 3px;
    }
    .doc-num-badge {
      font-weight: 700;
      font-size: 13px;
      color: #4a38f5;
      font-family: monospace;
    }
    .doc-date {
      font-size: 11px;
      color: #666666;
    }
    .doc-sub {
      font-size: 9.5px;
      color: #777777;
      margin-top: 2px;
    }

    /* Карточки */
    .info-card {
      border: 1px solid #d5d5d5;
      border-radius: 4px;
      overflow: hidden;
    }
    .card-head {
      background: #f4f4f4;
      font-weight: 600;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      padding: 3px 8px;
      border-bottom: 1px solid #d5d5d5;
      color: #333333;
    }
    .card-body {
      padding: 6px 8px;
      font-size: 11px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .mt-1 {
      margin-top: 4px;
    }

    /* Таблицы */
    .table-section {
      margin-top: 6px;
    }
    .table-title {
      font-weight: 700;
      font-size: 11.5px;
      margin-bottom: 4px;
      color: #111111;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
    }
    .data-table th, .data-table td {
      border: 1px solid #cccccc;
      padding: 4px 6px;
    }
    .data-table th {
      background: #f2f2f2;
      font-weight: 600;
      text-align: left;
    }
    .empty-hint {
      font-size: 10px;
      color: #888888;
      font-style: italic;
      padding: 4px 0;
    }

    /* Итоги */
    .totals-container {
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .totals-lines {
      width: 260px;
      border: 1px solid #d5d5d5;
      border-radius: 4px;
      padding: 6px 8px;
      background: #fafafa;
    }
    .tot-row {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      margin-bottom: 3px;
    }
    .tot-row.grand {
      border-top: 1.5px solid #111111;
      padding-top: 4px;
      margin-top: 4px;
      font-weight: 700;
      font-size: 12.5px;
    }
    .grand-val {
      color: #111111;
    }
    .total-words {
      margin-top: 4px;
      font-size: 10.5px;
      color: #444444;
      text-align: right;
    }

    /* Условия */
    .terms-card {
      border: 1px dashed #cccccc;
      border-radius: 4px;
      padding: 6px 8px;
      background: #fdfdfd;
    }
    .terms-title {
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      color: #555555;
      margin-bottom: 3px;
    }
    .terms-text {
      font-size: 9px;
      color: #444444;
      line-height: 1.3;
    }
    .pdn-text {
      margin-top: 4px;
      font-size: 8.5px;
      color: #666666;
      font-style: italic;
    }

    /* Подписи */
    .signatures-block {
      display: flex;
      justify-content: space-between;
      margin-top: 14px;
      padding-top: 6px;
      gap: 30px;
    }
    .sig-side {
      flex: 1;
      font-size: 10.5px;
      position: relative;
    }
    .sig-hint {
      font-size: 8px;
      color: #888888;
      margin-top: 2px;
    }
    .stamp-box {
      position: absolute;
      right: 15px;
      bottom: -10px;
      width: 55px;
      height: 55px;
      border: 1px dashed #aaaaaa;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      color: #999999;
      pointer-events: none;
    }

    /* Отрывной талон */
    .tear-off-block {
      margin-top: 14px;
    }
    .tear-line {
      text-align: center;
      font-size: 9px;
      color: #888888;
      margin-bottom: 6px;
      overflow: hidden;
      white-space: nowrap;
    }
    .tear-content {
      border: 1px solid #777777;
      border-radius: 4px;
      padding: 6px 8px;
      background: #fafafa;
    }
    .tear-header {
      font-size: 10.5px;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 3px;
      margin-bottom: 4px;
    }
    .tear-body {
      font-size: 9.5px;
      color: #333333;
      line-height: 1.35;
    }
    .tear-note {
      font-weight: 600;
      margin-top: 3px;
      color: #111111;
    }

    /* Печать */
    @page {
      size: A4 portrait;
      margin: 0;
    }

    @media print {
      html, body {
        background: #ffffff !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .page-sheet {
        box-shadow: none !important;
        margin: 0 !important;
        width: 100% !important;
        min-height: auto !important;
        padding: ${marginMm} !important;
      }
      .page-break-avoid {
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="page-sheet">
    ${sectionsHtml.join("\n")}
  </div>
</body>
</html>`;
  }
}

export const printTemplatesService = new PrintTemplatesService();
