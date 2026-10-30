import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldNotifyLead,
  isFirstContactStage,
  type LeadNotificationData,
  LeadNotificationQueueService,
} from "../modules/crm/leads/lead-notification.queue.js";
import { EmailService } from "../services/email.service.js";
import { extractPhoneNumber, extractEmailAddress } from "../modules/crm/channel-identity.js";

describe("Lead Notification Queue & Business Rules (Anti-Spam & Idempotency)", () => {
  it("Test 1: shouldNotifyLead returns false for stage 'Первый контакт' without contacts", () => {
    const lead: LeadNotificationData = {
      id: "deal-001",
      tenant_id: "tenant-001",
      stage_id: "stage-first-contact",
      stage_name: "Первый контакт",
      title: "Анонимный диалог с сайта",
      created_at: new Date(),
      contact_id: null,
      contact_phone: null,
      contact_email: null,
      contact_telegram_chat_id: null,
      custom_fields: {},
      lead_notified_at: null,
    };

    assert.equal(isFirstContactStage(lead.stage_name), true);
    assert.equal(shouldNotifyLead(lead), false);
  });

  it("Test 1b: shouldNotifyLead returns false for stage 'first_contact' even with some phone if still on first contact stage", () => {
    const lead: LeadNotificationData = {
      id: "deal-002",
      tenant_id: "tenant-001",
      stage_id: "stage-first-contact",
      stage_name: "first_contact",
      title: "Анонимный диалог",
      created_at: new Date(),
      contact_phone: "+79991112233",
      lead_notified_at: null,
    };

    assert.equal(isFirstContactStage(lead.stage_name), true);
    assert.equal(shouldNotifyLead(lead), false);
  });

  it("Test 1c: shouldNotifyLead returns false when lead is on qualified stage but has NO contact details", () => {
    const lead: LeadNotificationData = {
      id: "deal-003",
      tenant_id: "tenant-001",
      stage_id: "stage-new-lead",
      stage_name: "Новый лид",
      title: "Заявка без контактов",
      created_at: new Date(),
      contact_phone: null,
      contact_email: null,
      contact_telegram_chat_id: null,
      custom_fields: {},
      lead_notified_at: null,
    };

    assert.equal(isFirstContactStage(lead.stage_name), false);
    assert.equal(shouldNotifyLead(lead), false);
  });

  it("Test 2: shouldNotifyLead returns true when lead is on 'Новый лид' with phone", () => {
    const lead: LeadNotificationData = {
      id: "deal-004",
      tenant_id: "tenant-001",
      stage_id: "stage-new-lead",
      stage_name: "Новый лид",
      title: "Заявка на ремонт",
      created_at: new Date(),
      contact_first_name: "Алексей",
      contact_last_name: "Смирнов",
      contact_phone: "+79990001122",
      contact_email: null,
      custom_fields: {},
      lead_notified_at: null,
    };

    assert.equal(isFirstContactStage(lead.stage_name), false);
    assert.equal(shouldNotifyLead(lead), true);
  });

  it("Test 2b: shouldNotifyLead returns true when lead has contact details in custom_fields", () => {
    const lead: LeadNotificationData = {
      id: "deal-005",
      tenant_id: "tenant-001",
      stage_id: "stage-new-lead",
      stage_name: "Квалификация",
      title: "Заявка с сайта",
      created_at: new Date(),
      custom_fields: { phone: "+79001234567" },
      lead_notified_at: null,
    };

    assert.equal(shouldNotifyLead(lead), true);
  });

  it("Test 3 (Idempotency): shouldNotifyLead returns false if lead_notified_at is already set", () => {
    const lead: LeadNotificationData = {
      id: "deal-006",
      tenant_id: "tenant-001",
      stage_id: "stage-new-lead",
      stage_name: "Новый лид",
      title: "Повторное обновление",
      created_at: new Date(),
      contact_phone: "+79990001122",
      lead_notified_at: new Date(), // Already sent
    };

    assert.equal(shouldNotifyLead(lead), false);
  });

  it("Test 4: BullMQ add enqueue logs exact signature and accepts sendLeadNotificationJob", async () => {
    const queue = LeadNotificationQueueService.getInstance();
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      origLog(...args);
    };

    try {
      const job = await queue.add("sendLeadNotificationJob", {
        tenantId: "test-tenant-123",
        leadId: "test-lead-456",
      });

      assert.ok(job.id);
      const matchingLog = logs.find((l) =>
        l.includes("[BullMQ] Job sendLeadNotificationJob added for lead test-lead-456 (tenant: test-tenant-123)")
      );
      assert.ok(matchingLog, "Expected BullMQ job enqueue log was found");
    } finally {
      console.log = origLog;
    }
  });

  it("Test 5: Email template contains NO emojis, formats MSK time and all lead attributes", () => {
    const rendered = EmailService.renderLeadNotificationEmail({
      tenantName: "Автосервис Премиум",
      leadTitle: "Замена тормозных колодок",
      contactName: "Михаил Иванов",
      phone: "+79991234567",
      email: "mikhail@test.ru",
      telegram: "@mikhail_auto",
      channel: "Онлайн-виджет",
      stageName: "Новый лид",
      budget: 15000,
      currency: "RUB",
      customFields: {
        "Марка авто": "BMW X5",
        "Год выпуска": "2021",
      },
      createdAt: "2026-10-27T10:00:00Z",
      crmUrl: "https://app.getvoxly.ru/crm/deals/deal-004",
    });

    const { subject, html, text } = rendered;

    // Проверка на отсутствие эмодзи
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    assert.equal(emojiRegex.test(subject), false, "Subject must not contain emoji");
    assert.equal(emojiRegex.test(html), false, "HTML must not contain emoji");
    assert.equal(emojiRegex.test(text), false, "Text must not contain emoji");

    // Проверка содержимого карточки
    assert.ok(subject.includes("Новая заявка: Замена тормозных колодок"));
    assert.ok(subject.includes("(Автосервис Премиум)"));
    assert.ok(html.includes("Михаил Иванов"));
    assert.ok(html.includes("+79991234567"));
    assert.ok(html.includes("mikhail@test.ru"));
    assert.ok(html.includes("@mikhail_auto"));
    assert.ok(html.includes("Онлайн-виджет"));
    assert.ok(html.includes("Новый лид"));
    assert.ok(html.includes("15 000 RUB") || html.includes("15 000 RUB"));
    assert.ok(html.includes("BMW X5"));
    assert.ok(html.includes("https://app.getvoxly.ru/crm/deals/deal-004"));
    assert.ok(html.includes("(МСК)"));
  });

  describe("Phone & Email Entity Extraction (Incident Resolution: 79150946944)", () => {
    it("extracts phone starting with 7 without plus (exact user incident case)", () => {
      assert.equal(extractPhoneNumber("79150946944"), "+79150946944");
      assert.equal(extractPhoneNumber("Мой номер 79150946944, наберите"), "+79150946944");
    });

    it("extracts phone starting with 8", () => {
      assert.equal(extractPhoneNumber("89150946944"), "+79150946944");
      assert.equal(extractPhoneNumber("Звоните: 8 (915) 094-69-44"), "+79150946944");
    });

    it("extracts 10-digit mobile phone starting with 9", () => {
      assert.equal(extractPhoneNumber("9150946944"), "+79150946944");
      assert.equal(extractPhoneNumber("контакт (915) 094-69-44"), "+79150946944");
    });

    it("extracts phone with international prefix +7", () => {
      assert.equal(extractPhoneNumber("+79150946944"), "+79150946944");
      assert.equal(extractPhoneNumber("+7 (915) 094-69-44"), "+79150946944");
      assert.equal(extractPhoneNumber("+7 915 094 69 44"), "+79150946944");
    });

    it("extracts other international numbers", () => {
      assert.equal(extractPhoneNumber("+375291234567"), "+375291234567");
      assert.equal(extractPhoneNumber("+77012345678"), "+77012345678");
    });

    it("returns null for non-phone text", () => {
      assert.equal(extractPhoneNumber("Привет, как дела?"), null);
      assert.equal(extractPhoneNumber(""), null);
      assert.equal(extractPhoneNumber(null), null);
      assert.equal(extractPhoneNumber("123"), null);
    });

    it("extracts email addresses correctly", () => {
      assert.equal(extractEmailAddress("user@example.com"), "user@example.com");
      assert.equal(extractEmailAddress("Почта: info.dev@company.ru для связи"), "info.dev@company.ru");
      assert.equal(extractEmailAddress("нет почты"), null);
    });

    it("qualifies lead when phone 79150946944 is extracted and lead moves to 'Новый лид'", () => {
      const extractedPhone = extractPhoneNumber("79150946944");
      assert.equal(extractedPhone, "+79150946944");

      const lead: LeadNotificationData = {
        id: "deal-incident-001",
        tenant_id: "tenant-001",
        stage_id: "stage-new-lead",
        stage_name: "Новый лид",
        title: "Заявка от +79150946944 (Онлайн-чат)",
        created_at: new Date(),
        contact_first_name: "Клиент +79150946944",
        contact_phone: extractedPhone,
        contact_email: null,
        lead_notified_at: null,
      };

      assert.equal(isFirstContactStage(lead.stage_name), false);
      assert.equal(shouldNotifyLead(lead), true);
    });
  });
});
