import { describe, it, expect, vi, beforeEach } from "vitest";
import { printTemplatesService } from "../modules/print-templates/print-templates.service.js";
import { INTAKE_ACT_PRESET } from "../modules/print-templates/print-presets.js";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockTxQuery = vi.fn();
const mockTxQueryOne = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  withTenant: (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      query: (...args: unknown[]) => mockTxQuery(...args),
      queryOne: (...args: unknown[]) => mockTxQueryOne(...args),
    }),
}));

describe("PrintTemplatesService - Act of Acceptance & Master Tear-Off Ticket", () => {
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const templateId = "22222222-2222-2222-2222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("INTAKE_ACT_PRESET matches exact intake contract format", () => {
    expect(INTAKE_ACT_PRESET.layoutConfig.header.documentTitle).toBe("Договор");
    expect(INTAKE_ACT_PRESET.layoutConfig.header.documentSubtitle).toContain("на оказание услуг по ремонту инструмента");
    expect(INTAKE_ACT_PRESET.layoutConfig.terms.title).toBe("ПРЕДМЕТ ДОГОВОРА");
  });

  it("saves toolInfo, clientInfo, comments with RLS condition WHERE tenant_id = $10 AND id = $11", async () => {
    // 1. SELECT existing custom template
    mockTxQuery.mockResolvedValueOnce([
      {
        id: templateId,
        tenant_id: tenantId,
        slug: "work_order_custom_1",
        name: "Акт приема (Кастомный)",
        description: "Тест",
        document_type: "work_order",
        page_size: "A4",
        orientation: "portrait",
        body_template: "",
        layout_config: JSON.stringify(INTAKE_ACT_PRESET.layoutConfig),
        is_default: true,
        is_custom: true,
        is_hidden: false,
        tool_info: "",
        client_info: "",
        comments: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // 2. UPDATE query
    mockTxQuery.mockImplementationOnce((sql: string, params: unknown[]) => {
      // Check RLS clause
      expect(sql).toContain("WHERE tenant_id = $10 AND id = $11");
      expect(params[9]).toBe(tenantId);
      expect(params[10]).toBe(templateId);
      expect(params[11]).toBe("Перфоратор Toua GSN50");
      expect(params[12]).toBe("Тагир (+79289494543)");
      expect(params[13]).toBe("Срочная диагностика до вечера");

      return Promise.resolve([
        {
          id: templateId,
          tenant_id: tenantId,
          slug: "work_order_custom_1",
          name: "Акт приема Toua Service",
          description: "Тест",
          document_type: "work_order",
          page_size: "A4",
          orientation: "portrait",
          body_template: "",
          layout_config: JSON.stringify(INTAKE_ACT_PRESET.layoutConfig),
          is_default: true,
          is_custom: true,
          is_hidden: false,
          tool_info: "Перфоратор Toua GSN50",
          client_info: "Тагир (+79289494543)",
          comments: "Срочная диагностика до вечера",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
    });

    const result = await printTemplatesService.update(tenantId, templateId, {
      name: "Акт приема Toua Service",
      toolInfo: "Перфоратор Toua GSN50",
      clientInfo: "Тагир (+79289494543)",
      comments: "Срочная диагностика до вечера",
    });

    expect(result).not.toBeNull();
    expect(result?.toolInfo).toBe("Перфоратор Toua GSN50");
    expect(result?.clientInfo).toBe("Тагир (+79289494543)");
    expect(result?.comments).toBe("Срочная диагностика до вечера");
  });

  it("renderForOrder renders master ticket with equipment, customer and comments, and no Заказ-наряд in lower section", async () => {
    // 1. SELECT template
    mockTxQueryOne.mockResolvedValueOnce({
      id: templateId,
      tenant_id: tenantId,
      slug: "work_order",
      name: "Акт приема-передачи",
      description: "",
      document_type: "work_order",
      page_size: "A4",
      orientation: "portrait",
      body_template: "",
      layout_config: INTAKE_ACT_PRESET.layoutConfig,
      is_default: true,
      is_custom: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // 2. SELECT settings
    mockTxQueryOne.mockResolvedValueOnce({
      id: "set-1",
      tenant_id: tenantId,
      company_name: "Сервис Toua",
      company_phone: "+7 977 628 20 49",
      numbering_format: "compact",
      numbering_prefix: "№",
    });

    // 3. SELECT repair_order
    mockTxQueryOne.mockResolvedValueOnce({
      ticket_number: "0016",
      customer_name: "Тагир (ref: Leha)",
      customer_phone: "+7 928 949 45 43",
      equipment_type: "Пистолет монтажный",
      equipment_brand: "Toua",
      equipment_model: "GSN50",
      equipment_serial: "7w1241065612",
      defect_description: "Профилактика",
      appearance: "Хорошее",
      package_contents: "Обойма",
      malfunctions: null,
      master_name: "Даниил Доносов",
      estimated_cost: "0",
      final_cost: "0",
      received_at: new Date(),
      completed_at: null,
      notes: "Проверить поршень и смазку",
    });

    // 4. works
    mockTxQuery.mockResolvedValueOnce([]);
    // 5. parts
    mockTxQuery.mockResolvedValueOnce([]);

    const html = await printTemplatesService.renderForOrder(tenantId, templateId, "order-uuid-1");

    // Must contain master lower section
    expect(html).toContain("ТАЛОН ПРИЕМА (ЭКЗЕМПЛЯР МАСТЕРА)");
    expect(html).toContain("Тагир (ref: Leha)");
    expect(html).toContain("Toua GSN50");
    expect(html).toContain("7w1241065612");
    expect(html).toContain("Проверить поршень и смазку");

    // In the tear-off lower block, verify "Заказ-наряд:" is not present
    const tearOffIndex = html.indexOf("tear-off-block");
    expect(tearOffIndex).toBeGreaterThan(-1);
    const tearOffSection = html.slice(tearOffIndex);
    expect(tearOffSection).not.toContain("Заказ-наряд");
  });
});
