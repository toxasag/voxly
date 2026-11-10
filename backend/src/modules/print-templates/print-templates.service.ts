import { query, queryOne, withTenant, type SqlParam } from "../../db/client.js";
import { AppError } from "../../plugins/errorHandler.js";
import type {
  PrintTemplateDTO,
  PrintTemplateRow,
  PrintTemplateSlug,
  UpdatePrintTemplatePayload,
} from "./print-templates.types.js";

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

const DEFAULT_TEMPLATES: Record<
  PrintTemplateSlug,
  { name: string; description: string; pageSize: "A4" | "A5" | "thermal_80mm"; body: string }
> = {
  work_order: {
    name: "Заказ-наряд (Приемка)",
    description: "Акт приема техники на диагностику и ремонт",
    pageSize: "A4",
    body: `<div class="doc-header">
  <div class="company-col">
    <h2>{{company_name}}</h2>
    <div class="sub">Тел: {{company_phone}} | ИНН: {{company_inn}}</div>
    <div class="sub">{{company_address}}</div>
  </div>
  <div class="doc-title-col">
    <h1>ЗАКАЗ-НАРЯД №{{ticket_number}}</h1>
    <div class="doc-date">Дата приема: {{date}}</div>
  </div>
</div>

<div class="grid-2">
  <div class="box">
    <div class="box-title">Заказчик / Клиент</div>
    <div class="box-content">
      <strong>{{client_name}}</strong><br>
      Телефон: {{client_phone}}
    </div>
  </div>
  <div class="box">
    <div class="box-title">Оборудование</div>
    <div class="box-content">
      <strong>{{equipment_type}} {{equipment_brand}} {{equipment_model}}</strong><br>
      Серийный номер / IMEI: {{equipment_serial}}
    </div>
  </div>
</div>

<div class="details-section">
  <div class="detail-row"><strong>Заявленная неисправность:</strong> {{defect_description}}</div>
  <div class="detail-row"><strong>Внешний вид / состояние:</strong> {{appearance}}</div>
  <div class="detail-row"><strong>Комплектация:</strong> {{package_contents}}</div>
  <div class="detail-row"><strong>Ответственный мастер:</strong> {{master_name}}</div>
  <div class="detail-row"><strong>Предварительная стоимость:</strong> {{estimated_cost}}</div>
</div>

<div class="rules-text">
  Оборудование принято для проведения диагностики и ремонта. С условиями и сроками ознакомлен и согласен. Сервисный центр не несет ответственности за сохранность данных на цифровых носителях. В случае отказа от ремонта диагностика оплачивается согласно прейскуранту.
</div>

<div class="signatures">
  <div class="sig-col">
    <div>Сдал клиент: ___________________ / {{client_name}}</div>
  </div>
  <div class="sig-col">
    <div>Принял мастер: ___________________ / {{master_name}}</div>
  </div>
</div>`,
  },
  completion_act: {
    name: "Акт выполненных работ",
    description: "Финальный акт с перечнем работ, запчастей, суммами и гарантией",
    pageSize: "A4",
    body: `<div class="doc-header">
  <div class="company-col">
    <h2>{{company_name}}</h2>
    <div class="sub">Тел: {{company_phone}} | ИНН: {{company_inn}}</div>
    <div class="sub">{{company_address}}</div>
  </div>
  <div class="doc-title-col">
    <h1>АКТ ВЫПОЛНЕННЫХ РАБОТ</h1>
    <div class="doc-number">к заказ-наряду №{{ticket_number}}</div>
    <div class="doc-date">от {{date}}</div>
  </div>
</div>

<div class="grid-2">
  <div class="box">
    <div class="box-title">Заказчик</div>
    <div class="box-content">
      <strong>{{client_name}}</strong>, тел: {{client_phone}}
    </div>
  </div>
  <div class="box">
    <div class="box-title">Оборудование</div>
    <div class="box-content">
      <strong>{{equipment_type}} {{equipment_brand}} {{equipment_model}}</strong> (S/N: {{equipment_serial}})
    </div>
  </div>
</div>

<h3>Выполненные работы и услуги</h3>
{{works_table}}

<h3>Использованные запасные части и материалы</h3>
{{parts_table}}

<div class="totals-block">
  <div class="total-line"><span>Итого по работам:</span> <strong>{{works_total}}</strong></div>
  <div class="total-line"><span>Итого по запчастям:</span> <strong>{{parts_total}}</strong></div>
  <div class="total-line grand"><span>ВСЕГО К ОПЛАТЕ:</span> <strong>{{total_cost}}</strong></div>
</div>

<div class="rules-text">
  Вышеперечисленные работы выполнены полностью и в срок. Заказчик претензий по объему, качеству и срокам оказания услуг не имеет. Гарантийный срок на выполненные работы составляет 30 календарных дней со дня выдачи изделия, за исключением случаев механических повреждений и следов попадания влаги.
</div>

<div class="signatures">
  <div class="sig-col">
    <div>Исполнитель: ___________________ / {{master_name}}</div>
    <div class="mp">М.П.</div>
  </div>
  <div class="sig-col">
    <div>Заказчик работу принял: ___________________ / {{client_name}}</div>
  </div>
</div>`,
  },
  warranty_ticket: {
    name: "Гарантийный талон",
    description: "Документ подтверждения гарантийных обязательств",
    pageSize: "A5",
    body: `<div class="doc-header">
  <h2>ГАРАНТИЙНЫЙ ТАЛОН</h2>
  <div class="sub">{{company_name}} | Тел: {{company_phone}}</div>
</div>
<div class="doc-date">Заказ-наряд №{{ticket_number}} от {{date}}</div>

<div class="box">
  <div><strong>Изделие:</strong> {{equipment_type}} {{equipment_brand}} {{equipment_model}}</div>
  <div><strong>Серийный номер:</strong> {{equipment_serial}}</div>
  <div><strong>Клиент:</strong> {{client_name}} (тел: {{client_phone}})</div>
</div>

<h3>Выполненный ремонт:</h3>
{{works_table}}

<div class="rules-text">
  1. Срок гарантии на замененные детали и выполненные работы — 30 дней со дня выдачи.<br>
  2. Гарантия аннулируется при наличии механических повреждений, следов вскрытия третьими лицами или попадания жидкости.<br>
  3. Гарантийный талон действителен при предъявлении паспорта изделия или чека.
</div>

<div class="signatures">
  <div class="sig-col">Мастер: ______________ / {{master_name}}</div>
  <div class="sig-col">М.П.</div>
</div>`,
  },
  receipt: {
    name: "Товарный чек",
    description: "Компактный расчетный документ (подходит для термопринтеров 80 мм)",
    pageSize: "thermal_80mm",
    body: `<div class="thermal-receipt">
  <div class="center bold">{{company_name}}</div>
  <div class="center">Тел: {{company_phone}}</div>
  <div class="divider"></div>
  <div>ЧЕК / НАРЯД №{{ticket_number}}</div>
  <div>Дата: {{date}}</div>
  <div>Клиент: {{client_name}}</div>
  <div class="divider"></div>
  <div class="bold">РАБОТЫ:</div>
  {{works_table}}
  <div class="bold">ДЕТАЛИ:</div>
  {{parts_table}}
  <div class="divider"></div>
  <div class="flex-between bold large">
    <span>ИТОГО:</span>
    <span>{{total_cost}}</span>
  </div>
  <div class="divider"></div>
  <div class="center">Спасибо за обращение!</div>
</div>`,
  },
};

export class PrintTemplatesService {
  async ensureTemplates(tenantId: string): Promise<void> {
    await withTenant(tenantId, async (tx) => {
      for (const [slug, tpl] of Object.entries(DEFAULT_TEMPLATES)) {
        await tx.query(
          `INSERT INTO print_templates (tenant_id, slug, name, description, page_size, body_template, is_default)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           ON CONFLICT (tenant_id, slug) DO NOTHING`,
          [tenantId, slug, tpl.name, tpl.description, tpl.pageSize, tpl.body],
        );
      }
    });
  }

  async list(tenantId: string): Promise<PrintTemplateDTO[]> {
    await this.ensureTemplates(tenantId);

    const rows = await query<PrintTemplateRow>(
      `SELECT id, tenant_id, slug, name, description, page_size, orientation, body_template, is_default, created_at, updated_at
       FROM print_templates
       WHERE tenant_id = $1
       ORDER BY name ASC`,
      [tenantId],
    );

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug as PrintTemplateSlug,
      name: r.name,
      description: r.description,
      pageSize: parsePageSize(r.page_size),
      orientation: parseOrientation(r.orientation),
      bodyTemplate: r.body_template,
      isDefault: r.is_default,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    }));
  }

  async getBySlug(tenantId: string, slug: string): Promise<PrintTemplateDTO | null> {
    await this.ensureTemplates(tenantId);

    const row = await queryOne<PrintTemplateRow>(
      `SELECT id, tenant_id, slug, name, description, page_size, orientation, body_template, is_default, created_at, updated_at
       FROM print_templates
       WHERE tenant_id = $1 AND slug = $2`,
      [tenantId, slug],
    );

    if (!row) return null;

    return {
      id: row.id,
      slug: row.slug as PrintTemplateSlug,
      name: row.name,
      description: row.description,
      pageSize: parsePageSize(row.page_size),
      orientation: parseOrientation(row.orientation),
      bodyTemplate: row.body_template,
      isDefault: row.is_default,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  async update(
    tenantId: string,
    id: string,
    payload: UpdatePrintTemplatePayload,
  ): Promise<PrintTemplateDTO | null> {
    const fields: string[] = [];
    const params: SqlParam[] = [tenantId, id];

    if (payload.name !== undefined) {
      params.push(payload.name);
      fields.push(`name = $${params.length}`);
    }
    if (payload.description !== undefined) {
      params.push(payload.description);
      fields.push(`description = $${params.length}`);
    }
    if (payload.page_size !== undefined) {
      params.push(payload.page_size);
      fields.push(`page_size = $${params.length}`);
    }
    if (payload.orientation !== undefined) {
      params.push(payload.orientation);
      fields.push(`orientation = $${params.length}`);
    }
    if (payload.body_template !== undefined) {
      params.push(payload.body_template);
      fields.push(`body_template = $${params.length}`);
    }

    if (fields.length === 0) return null;

    params.push(new Date());
    fields.push(`updated_at = $${params.length}`);

    return withTenant(tenantId, async (tx) => {
      await tx.query(
        `UPDATE print_templates SET ${fields.join(", ")}
         WHERE tenant_id = $1 AND id = $2`,
        params,
      );

      const rows = await tx.query<PrintTemplateRow>(
        `SELECT id, tenant_id, slug, name, description, page_size, orientation, body_template, is_default, created_at, updated_at
         FROM print_templates
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );

      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        slug: row.slug as PrintTemplateSlug,
        name: row.name,
        description: row.description,
        pageSize: parsePageSize(row.page_size),
        orientation: parseOrientation(row.orientation),
        bodyTemplate: row.body_template,
        isDefault: row.is_default,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
      };
    });
  }

  /**
   * Рендер шаблона с реальными данными наряда
   */
  async renderForOrder(tenantId: string, slug: string, orderId: string): Promise<string> {
    const tpl = await this.getBySlug(tenantId, slug);
    if (!tpl) throw new AppError(404, "TEMPLATE_NOT_FOUND", `Print template "${slug}" not found`);

    // Загружаем данные компании тенанта
    const tenant = await queryOne<{ name: string }>(
      `SELECT name FROM tenants WHERE id = $1`,
      [tenantId],
    );

    // Загружаем данные наряда
    const order = await queryOne<{
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

    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Repair order not found");

    // Загружаем работы
    const works = await query<{
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

    // Загружаем запчасти
    const parts = await query<{
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

    // Формируем HTML таблицы работ
    let worksTableHtml = "";
    let worksSum = 0;
    if (works.length > 0) {
      worksTableHtml = `
      <table class="doc-table">
        <thead>
          <tr>
            <th style="width: 40px;">№</th>
            <th>Наименование работ</th>
            <th style="width: 140px;">Мастер</th>
            <th style="width: 60px; text-align: center;">Кол-во</th>
            <th style="width: 90px; text-align: right;">Цена</th>
            <th style="width: 90px; text-align: right;">Сумма</th>
          </tr>
        </thead>
        <tbody>
          ${works
            .map((w, idx) => {
              const q = Number(w.quantity ?? 1);
              const cost = Number(w.cost);
              const price = w.unit_price ? Number(w.unit_price) : q > 0 ? cost / q : cost;
              worksSum += cost;
              return `
              <tr>
                <td style="text-align: center;">${idx + 1}</td>
                <td><strong>${w.description}</strong></td>
                <td>${w.master_name || "—"}</td>
                <td style="text-align: center;">${q}</td>
                <td style="text-align: right;">${formatMoney(price)}</td>
                <td style="text-align: right;"><strong>${formatMoney(cost)}</strong></td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>`;
    } else {
      worksTableHtml = `<p class="muted">Работы не добавлены</p>`;
    }

    // Формируем HTML таблицы запчастей
    let partsTableHtml = "";
    let partsSum = 0;
    if (parts.length > 0) {
      partsTableHtml = `
      <table class="doc-table">
        <thead>
          <tr>
            <th style="width: 40px;">№</th>
            <th>Наименование запасной части / детали</th>
            <th style="width: 110px;">Артикул</th>
            <th style="width: 60px; text-align: center;">Кол-во</th>
            <th style="width: 90px; text-align: right;">Цена</th>
            <th style="width: 90px; text-align: right;">Сумма</th>
          </tr>
        </thead>
        <tbody>
          ${parts
            .map((p, idx) => {
              const q = Number(p.quantity ?? 1);
              const price = Number(p.retail_price ?? 0);
              const total = q * price;
              partsSum += total;
              return `
              <tr>
                <td style="text-align: center;">${idx + 1}</td>
                <td><strong>${p.name}</strong></td>
                <td class="mono">${p.article || "—"}</td>
                <td style="text-align: center;">${q}</td>
                <td style="text-align: right;">${formatMoney(price)}</td>
                <td style="text-align: right;"><strong>${formatMoney(total)}</strong></td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>`;
    } else {
      partsTableHtml = `<p class="muted">Запасные части не использовались</p>`;
    }

    const totalCost = worksSum + partsSum;

    // Подставляем переменные
    let html = tpl.bodyTemplate;
    const replacements: Record<string, string> = {
      "{{company_name}}": tenant?.name || "Сервисный центр",
      "{{company_phone}}": "+7 (999) 000-00-00",
      "{{company_address}}": "г. Москва, ул. Сервисная, д. 1",
      "{{company_inn}}": "7700000000",
      "{{ticket_number}}": order.ticket_number,
      "{{date}}": formatDateRu(order.received_at),
      "{{client_name}}": order.customer_name || "Не указан",
      "{{client_phone}}": order.customer_phone || "—",
      "{{equipment_type}}": order.equipment_type || "",
      "{{equipment_brand}}": order.equipment_brand || "",
      "{{equipment_model}}": order.equipment_model || "",
      "{{equipment_serial}}": order.equipment_serial || "—",
      "{{defect_description}}": order.defect_description || "—",
      "{{appearance}}": order.appearance || "Без видимых повреждений",
      "{{package_contents}}": order.package_contents || "Аппарат без аксессуаров",
      "{{master_name}}": order.master_name || "Дежурный мастер",
      "{{estimated_cost}}": formatMoney(Number(order.estimated_cost || 0)),
      "{{works_table}}": worksTableHtml,
      "{{parts_table}}": partsTableHtml,
      "{{works_total}}": formatMoney(worksSum),
      "{{parts_total}}": formatMoney(partsSum),
      "{{total_cost}}": formatMoney(totalCost),
    };

    for (const [key, val] of Object.entries(replacements)) {
      html = html.replaceAll(key, val);
    }

    // Оборачиваем в базовую разметку со стилями печати
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${tpl.name} — ${order.ticket_number}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.4;
      color: #111111;
      padding: 24px;
      background: #ffffff;
      max-width: 820px;
      margin: 0 auto;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #111111;
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .company-col h2 { font-size: 16px; font-weight: 700; color: #111111; margin-bottom: 4px; }
    .company-col .sub { font-size: 10px; color: #555555; }
    .doc-title-col { text-align: right; }
    .doc-title-col h1 { font-size: 18px; font-weight: 800; color: #111111; text-transform: uppercase; }
    .doc-title-col .doc-number { font-size: 13px; font-weight: 600; color: #4a38f5; }
    .doc-title-col .doc-date { font-size: 10px; color: #666666; margin-top: 2px; }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    .box {
      border: 1px solid #e5e5e5;
      border-radius: 4px;
      padding: 10px 12px;
      background: #fafafa;
    }
    .box-title {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      color: #777777;
      margin-bottom: 4px;
      letter-spacing: 0.5px;
    }
    .box-content { font-size: 11px; color: #111111; }

    .details-section {
      border: 1px solid #e5e5e5;
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .detail-row { font-size: 11px; }

    h3 {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      color: #111111;
      margin: 14px 0 6px 0;
      letter-spacing: 0.3px;
    }

    .doc-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 10.5px;
    }
    .doc-table th {
      background: #f5f5f5;
      border: 1px solid #dddddd;
      padding: 6px 8px;
      font-weight: 600;
      text-align: left;
      font-size: 9.5px;
      text-transform: uppercase;
      color: #444444;
    }
    .doc-table td {
      border: 1px solid #e5e5e5;
      padding: 6px 8px;
      vertical-align: middle;
    }
    .doc-table tr:nth-child(even) td { background: #fafafa; }
    .mono { font-family: monospace; font-size: 10px; }
    .muted { color: #888888; font-style: italic; margin-bottom: 12px; font-size: 10px; }

    .totals-block {
      margin-left: auto;
      width: 280px;
      border: 1px solid #e5e5e5;
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 16px;
      background: #fafafa;
    }
    .total-line {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      padding: 3px 0;
    }
    .total-line.grand {
      border-top: 2px solid #111111;
      margin-top: 6px;
      padding-top: 6px;
      font-size: 13px;
      font-weight: 800;
      color: #111111;
    }

    .rules-text {
      font-size: 8.5px;
      color: #666666;
      line-height: 1.35;
      border: 1px dashed #cccccc;
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 20px;
      background: #ffffff;
    }

    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
      padding-top: 12px;
    }
    .sig-col { font-size: 10.5px; width: 45%; }
    .mp { margin-top: 14px; font-weight: 700; color: #888888; font-size: 10px; }

    .thermal-receipt {
      max-width: 72mm;
      font-size: 10px;
      line-height: 1.25;
      margin: 0 auto;
    }
    .thermal-receipt .center { text-align: center; }
    .thermal-receipt .bold { font-weight: 700; }
    .thermal-receipt .large { font-size: 13px; }
    .thermal-receipt .divider { border-bottom: 1px dashed #000000; margin: 6px 0; }
    .thermal-receipt .flex-between { display: flex; justify-content: space-between; }

    @media print {
      body { padding: 0; max-width: 100%; }
      @page {
        margin: 10mm;
        size: ${tpl.pageSize === "thermal_80mm" ? "80mm auto" : tpl.pageSize};
      }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;
  }
}

export const printTemplatesService = new PrintTemplatesService();
