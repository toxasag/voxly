import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ContactDedupeService,
  normalizePhoneToE164,
} from "../modules/crm/contacts/dedupe.service.js";
import type { ContactRow } from "../modules/crm/contacts/contacts.types.js";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockTxQuery = vi.fn();
const mockTxQueryOne = vi.fn();

vi.mock("../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  runWithPlatformScope: (fn: () => Promise<unknown>) => fn(),
  withTenant: (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      query: (...args: unknown[]) => mockTxQuery(...args),
      queryOne: (...args: unknown[]) => mockTxQueryOne(...args),
    }),
}));

describe("normalizePhoneToE164", () => {
  it("normalizes Russian numbers with 8 prefix", () => {
    expect(normalizePhoneToE164("8 (999) 123-45-67")).toBe("+79991234567");
    expect(normalizePhoneToE164("89991234567")).toBe("+79991234567");
  });

  it("normalizes Russian numbers with 7 prefix", () => {
    expect(normalizePhoneToE164("+7 (999) 123-45-67")).toBe("+79991234567");
    expect(normalizePhoneToE164("79991234567")).toBe("+79991234567");
  });

  it("normalizes 10-digit numbers starting with 9", () => {
    expect(normalizePhoneToE164("9991234567")).toBe("+79991234567");
    expect(normalizePhoneToE164("916 555 44 33")).toBe("+79165554433");
  });

  it("normalizes international numbers with plus", () => {
    expect(normalizePhoneToE164("+1 (555) 019-2834")).toBe("+15550192834");
    expect(normalizePhoneToE164("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("returns null for invalid or empty inputs", () => {
    expect(normalizePhoneToE164("")).toBeNull();
    expect(normalizePhoneToE164("   ")).toBeNull();
    expect(normalizePhoneToE164(null)).toBeNull();
    expect(normalizePhoneToE164(undefined)).toBeNull();
    expect(normalizePhoneToE164("123")).toBeNull();
    expect(normalizePhoneToE164("abc-def")).toBeNull();
  });
});

describe("ContactDedupeService", () => {
  let dedupeService: ContactDedupeService;

  beforeEach(() => {
    vi.clearAllMocks();
    dedupeService = new ContactDedupeService();
  });

  describe("findDuplicatesByPhone", () => {
    it("returns empty array for invalid phone", async () => {
      const res = await dedupeService.findDuplicatesByPhone("tenant-1", "invalid");
      expect(res).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("queries database using canonical E.164 and last 10 digits", async () => {
      const mockContacts = [
        { id: "c-1", first_name: "Иван", phone: "+79991234567" },
      ] as ContactRow[];
      mockQuery.mockResolvedValueOnce(mockContacts);

      const res = await dedupeService.findDuplicatesByPhone("tenant-1", "8 (999) 123-45-67");
      expect(res).toEqual(mockContacts);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const args = mockQuery.mock.calls[0];
      expect(args?.[1]).toEqual(["tenant-1", null, "+79991234567", "9991234567"]);
    });
  });

  describe("mergeContacts", () => {
    it("returns no-op if no distinct loser IDs provided", async () => {
      const res = await dedupeService.mergeContacts("tenant-1", "c-1", ["c-1"]);
      expect(res.mergedContactIds).toEqual([]);
      expect(res.dealsRetargeted).toBe(0);
      expect(mockTxQuery).not.toHaveBeenCalled();
    });

    it("throws NotFoundError if primary contact is not found", async () => {
      mockTxQueryOne.mockResolvedValueOnce(null);

      await expect(
        dedupeService.mergeContacts("tenant-1", "c-primary", ["c-loser-1"]),
      ).rejects.toThrow("Основной контакт для слияния не найден");
    });

    it("retargets deals, tasks, merges phones and socials, and soft-deletes loser", async () => {
      const primaryContact: ContactRow = {
        id: "c-primary",
        tenant_id: "tenant-1",
        first_name: "Алексей",
        last_name: "Иванов",
        middle_name: "",
        phone: "+79991112233",
        phone_country_code: "RU",
        phone_calling_code: "+7",
        additional_phones: [],
        email: null, // пусто у primary
        telegram_username: null,
        telegram_chat_id: null,
        whatsapp: null,
        socials: [{ kind: "telegram", value: "@alexey" }],
        job_title: "",
        company_name: "",
        company_id: null,
        channel: "phone",
        linkedin_link: "",
        custom_fields: {},
        notes: "",
        created_by: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const loserContact: ContactRow = {
        id: "c-loser-1",
        tenant_id: "tenant-1",
        first_name: "Алексей",
        last_name: "Иванов (дубль)",
        middle_name: "",
        phone: "+79998887766", // дополнительный номер
        phone_country_code: "RU",
        phone_calling_code: "+7",
        additional_phones: [
          { number: "+79995554433", countryCode: "RU", callingCode: "+7" },
        ],
        email: "alexey@example.com", // должен перетечь в primary
        telegram_username: "alex_tg",
        telegram_chat_id: "12345678",
        whatsapp: "+79998887766",
        socials: [{ kind: "vk", value: "id12345" }],
        job_title: "Директор",
        company_name: "ООО Вектор",
        company_id: "comp-1",
        channel: "whatsapp",
        linkedin_link: "",
        custom_fields: {},
        notes: "",
        created_by: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockTxQueryOne.mockResolvedValueOnce(primaryContact);
      mockTxQuery.mockResolvedValueOnce([loserContact]); // losers fetch
      mockTxQuery.mockResolvedValueOnce([{ id: "deal-1" }, { id: "deal-2" }]); // deals retargeted
      mockTxQuery.mockResolvedValueOnce([{ id: "task-1" }]); // tasks retargeted
      mockTxQuery.mockResolvedValueOnce([]); // update contacts
      mockTxQuery.mockResolvedValueOnce([]); // soft delete losers
      mockTxQuery.mockResolvedValueOnce([]); // audit log

      const result = await dedupeService.mergeContacts(
        "tenant-1",
        "c-primary",
        ["c-loser-1"],
        "user-admin",
      );

      expect(result.primaryContactId).toBe("c-primary");
      expect(result.mergedContactIds).toEqual(["c-loser-1"]);
      expect(result.dealsRetargeted).toBe(2);
      expect(result.tasksRetargeted).toBe(1);
      expect(result.phonesAdded).toBe(2); // loser phone + loser additional phone
      expect(result.socialsAdded).toBe(1); // vk

      // Проверяем вызовы SQL
      const calls = mockTxQuery.mock.calls;
      const dealsCall = calls.find((c) => (c[0] as string).includes("UPDATE deals"));
      expect(dealsCall).toBeDefined();
      expect(dealsCall?.[1]).toEqual(["c-primary", "tenant-1", ["c-loser-1"]]);

      const softDeleteCall = calls.find((c) =>
        (c[0] as string).includes("deleted_at = now()"),
      );
      expect(softDeleteCall).toBeDefined();

      const auditCall = calls.find((c) =>
        (c[0] as string).includes("INSERT INTO tenant_audit_log"),
      );
      expect(auditCall).toBeDefined();
      expect(auditCall?.[0]).toContain("'contact.merged'");
      expect(auditCall?.[1]?.[2]).toBe("c-primary");
    });
  });

  describe("suppress_deal_creation", () => {
    it("sets suppress_deal_creation flag for contact", async () => {
      mockQuery.mockResolvedValueOnce([]);
      await dedupeService.setSuppressDealCreation("tenant-1", "c-1", true);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0]?.[1]).toEqual(["tenant-1", "c-1", true]);
    });

    it("checks if contact has suppress_deal_creation flag set", async () => {
      mockQueryOne.mockResolvedValueOnce({ suppress_deal_creation: true });
      const res = await dedupeService.shouldSuppressDeal("tenant-1", "c-1");
      expect(res).toBe(true);

      mockQueryOne.mockResolvedValueOnce(null);
      const resFalse = await dedupeService.shouldSuppressDeal("tenant-1", "c-2");
      expect(resFalse).toBe(false);
    });
  });
});
