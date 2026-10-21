import { beforeEach, describe, expect, it, vi } from "vitest";
import { StageRulesService } from "../modules/crm/deals/stage-rules.service.js";
import * as dbClient from "../db/client.js";
import { registerOutboundSender, clearOutboundSenders } from "../modules/channels/outbound-registry.js";

describe("StageRulesService", () => {
  const service = new StageRulesService();
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const dealId = "deal-999";
  const stageId = "stage-qualified";

  beforeEach(() => {
    vi.restoreAllMocks();
    clearOutboundSenders();
  });

  it("не инициирует отправку, если для этапа нет активных правил", async () => {
    vi.spyOn(dbClient, "query").mockResolvedValueOnce([]);

    const result = await service.fireStageRules({ tenantId, dealId, stageId });
    expect(result.fired).toBe(0);
    expect(result.rules).toEqual([]);
  });

  it("шаблонизирует текст и создает исходящее сообщение при наличии активных правил", async () => {
    const mockRule = {
      id: "rule-1",
      tenant_id: tenantId,
      pipeline_id: "pipe-1",
      stage_id: stageId,
      channel_account_id: "acc-1",
      channel: "telegram",
      name: "Квалификация пройдена",
      delay_seconds: 0,
      template_text: "Здравствуйте, {{name}}! Ваша заявка «{{deal_title}}» на сумму {{budget}} принята в работу.",
      media_url: null,
      media_type: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockDeal = {
      title: "Ремонт MacBook Air M2",
      budget: 18500,
      contact_id: "contact-1",
      first_name: "Алексей",
      last_name: "Смирнов",
    };

    const insertCalls: unknown[][] = [];
    vi.spyOn(dbClient, "query").mockImplementation(async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes("mailing_stage_rules")) {
        return [mockRule] as unknown as never;
      }
      if (sql.includes("INSERT INTO deal_messages")) {
        insertCalls.push(params ? [...params] : []);
        return [] as unknown as never;
      }
      return [] as unknown as never;
    });

    vi.spyOn(dbClient, "queryOne").mockImplementation(async (sql: string) => {
      if (sql.includes("FROM deals")) {
        return mockDeal as unknown as never;
      }
      return null as unknown as never;
    });

    const result = await service.fireStageRules({ tenantId, dealId, stageId });

    expect(result.fired).toBe(1);
    expect(result.rules).toContain("Квалификация пройдена");

    expect(insertCalls).toHaveLength(1);
    const insertArgs = insertCalls[0];
    expect(insertArgs?.[0]).toBe(tenantId);
    expect(insertArgs?.[1]).toBe(dealId);
    expect(insertArgs?.[4]).toBe(
      "Здравствуйте, Алексей Смирнов! Ваша заявка «Ремонт MacBook Air M2» на сумму 18500 руб. принята в работу.",
    );
  });

  it("доставляет сообщение через зарегистрированный отправитель канала при нулевой задержке", async () => {
    const mockRule = {
      id: "rule-1",
      tenant_id: tenantId,
      pipeline_id: "pipe-1",
      stage_id: stageId,
      channel_account_id: "acc-1",
      channel: "telegram",
      name: "Быстрый ответ",
      delay_seconds: 0,
      template_text: "Привет, {{name}}!",
      media_url: null,
      media_type: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockDeal = {
      title: "Заявка",
      budget: 1000,
      contact_id: "contact-1",
      first_name: "Иван",
      last_name: "Иванов",
    };

    const sentMessages: unknown[] = [];
    registerOutboundSender("telegram", async (msg) => {
      sentMessages.push(msg);
      return { ok: true };
    });

    vi.spyOn(dbClient, "query").mockImplementation(async (sql: string) => {
      if (sql.includes("mailing_stage_rules")) {
        return [mockRule] as unknown as never;
      }
      if (sql.includes("INSERT INTO deal_messages")) {
        return [{ id: "msg-123" }] as unknown as never;
      }
      if (sql.includes("FROM deals d") && sql.includes("telegram_chat_id")) {
        return [
          {
            last_channel_account_id: "acc-1",
            telegram_chat_id: "987654321",
            telegram_username: "ivan",
            whatsapp: null,
            phone: "+79991112233",
            socials: null,
          },
        ] as unknown as never;
      }
      return [] as unknown as never;
    });

    vi.spyOn(dbClient, "queryOne").mockImplementation(async (sql: string) => {
      if (sql.includes("FROM deals")) {
        return mockDeal as unknown as never;
      }
      return null as unknown as never;
    });

    const result = await service.fireStageRules({ tenantId, dealId, stageId });
    expect(result.fired).toBe(1);

    // Даем микротаске завершиться
    await new Promise((r) => setTimeout(r, 10));

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      tenantId,
      channelAccountId: "acc-1",
      recipient: "987654321",
      text: "Привет, Иван Иванов!",
    });
  });
});
